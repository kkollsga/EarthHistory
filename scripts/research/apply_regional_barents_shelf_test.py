#!/usr/bin/env python3
"""Regression and mutation tests for the Cao Barents shelf lifecycle repair."""

from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cao_package_intern as package_intern  # noqa: E402

MODULE = Path(__file__).with_name("apply_regional_barents_shelf.py")
SPEC = importlib.util.spec_from_file_location("apply_regional_barents_shelf", MODULE)
assert SPEC and SPEC.loader
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)


class RegionalBarentsShelfTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="earthhistory-barents-shelf-")
        self.package = Path(self.temp.name)
        for name in ("core.json", "motion-palette.json", "motion-palette.bin", "manifest.json", "batch-shelf.ehgb"):
            shutil.copy2(repair.DEFAULT_PACKAGE / name, self.package / name)
        correction = self.package / "corrections/material-v1/catalog.json"
        correction.parent.mkdir(parents=True)
        shutil.copy2(repair.DEFAULT_PACKAGE / "corrections/material-v1/catalog.json", correction)
        palette = json.loads((self.package / "motion-palette.json").read_text())
        if any(entry["entryId"].startswith(f"{repair.ENTRY_PREFIX}-")
               for entry in palette["entries"]):
            self.restore_pre_barents_candidate()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def restore_pre_barents_candidate(self) -> None:
        """Reverse this one operation so tests also work after public integration."""
        core_path = self.package / "core.json"
        palette_path = self.package / "motion-palette.json"
        binary_path = self.package / "motion-palette.bin"
        manifest_path = self.package / "manifest.json"
        correction_path = self.package / "corrections/material-v1/catalog.json"
        contract = json.loads(repair.CONTRACT.read_text())
        core = package_intern.read_package_json(core_path)
        palette = json.loads(palette_path.read_text())
        _binary, records = repair.decode_palette(binary_path, palette)
        kept_entries, kept_records = [], []
        for entry in palette["entries"]:
            rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
            if entry["entryId"].startswith(f"{repair.ENTRY_PREFIX}-"):
                continue
            entry["sampleOffset"] = len(kept_records)
            kept_records.extend(rows)
            kept_entries.append(entry)
        palette["entries"] = kept_entries
        palette["sourceIntervalSets"] = [row for row in palette["sourceIntervalSets"]
                                         if row["id"] != repair.INTERVAL_ID]
        binary = bytearray(repair.HEADER_BYTES + repair.RECORD_BYTES * len(kept_records))
        binary[:4] = b"EHMP"
        struct.pack_into("<HHIIIIII", binary, 4, 2, repair.RECORD_BYTES, len(kept_entries),
                         len(kept_records), repair.HEADER_BYTES, 0, 0, 0)
        for index, record in enumerate(kept_records):
            struct.pack_into("<Iffff", binary, repair.HEADER_BYTES + repair.RECORD_BYTES * index,
                             *record)
        binary_path.write_bytes(binary)
        palette["binary"]["bytes"] = len(binary)
        palette["binary"]["sha256"] = repair.sha256(binary)
        palette_path.write_bytes(repair.canonical(palette))
        chart_by_id = {chart["chartId"]: chart for chart in core["charts"]}
        for row in contract["charts"]:
            chart = chart_by_id[row["chartId"]]
            chart["lifecycle"]["validTimeMa"]["oldest"] = 410
            chart["motionBindings"] = [binding for binding in chart["motionBindings"]
                                       if not binding["entryId"].startswith(f"{repair.ENTRY_PREFIX}-")]
            next(binding for binding in chart["motionBindings"]
                 if binding["entryId"] == f"plate-{row['plateId']}-130-505")["validTimeMa"]["oldest"] = 410
            chart["evidence"]["sourceIds"].remove(repair.SOURCE_ID)
            chart["evidence"]["limitations"][1] = repair.BASE_LIMITATION
            chart["surfaceEvidence"]["reason"] = repair.BASE_SURFACE_REASON
        core_path.write_bytes(repair.canonical(package_intern.intern_charts(core)))
        manifest = json.loads(manifest_path.read_text())
        old_core_sha = manifest["core"]["sha256"]
        manifest["core"] = repair.asset(core_path)
        manifest["motionPalette"]["catalog"] = repair.asset(palette_path)
        manifest["motionPalette"]["binary"] = repair.asset(binary_path)
        manifest["scope"] = manifest["scope"].replace(f" {repair.SCOPE_CLAUSE}", "")
        correction_bytes = correction_path.read_bytes().replace(
            old_core_sha.encode(), manifest["core"]["sha256"].encode()
        )
        correction_path.write_bytes(correction_bytes)
        manifest["materialCorrections"]["catalog"] = repair.asset(
            correction_path, str(correction_path.relative_to(self.package))
        )
        manifest_path.write_bytes(repair.canonical(manifest))

    def rebind_core_identity(self, core_path: Path) -> None:
        manifest_path = self.package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        old_sha = manifest["core"]["sha256"]
        manifest["core"] = repair.asset(core_path)
        correction_path = self.package / manifest["materialCorrections"]["catalog"]["url"]
        correction = correction_path.read_bytes()
        correction_path.write_bytes(correction.replace(
            old_sha.encode(), manifest["core"]["sha256"].encode()
        ))
        manifest["materialCorrections"]["catalog"] = repair.asset(
            correction_path, str(correction_path.relative_to(self.package))
        )
        manifest_path.write_bytes(repair.canonical(manifest))

    def test_baseline_reproduces_all_three_422_ma_omissions(self) -> None:
        self.assertEqual(repair.check(self.package)["baselineMissingAt422"], [True, True, True])

    def test_exact_identity_repair_preserves_geometry_and_coast_charts(self) -> None:
        before = package_intern.read_package_json(self.package / "core.json")
        correction_before = json.loads(
            (self.package / "corrections/material-v1/catalog.json").read_text()
        )
        result = repair.apply(self.package)
        after = package_intern.read_package_json(self.package / "core.json")
        correction_after = json.loads(
            (self.package / "corrections/material-v1/catalog.json").read_text()
        )
        self.assertEqual(result["changedChartIndices"], [74, 539, 543])
        self.assertTrue(result["geometryAssetsUnchanged"])
        self.assertTrue(result["nativeCoastChartsUnchanged"])
        self.assertLessEqual(result["maximumQuarterMaMotionResidualRad"], 1e-5)
        changed = [index for index, pair in enumerate(zip(before["charts"], after["charts"]))
                   if pair[0] != pair[1]]
        self.assertEqual(changed, [74, 539, 543])
        self.assertEqual(before["spatialBatches"], after["spatialBatches"])
        correction_before["baseline"]["coreSha256"] = result["core"]["sha256"]
        self.assertEqual(correction_before, correction_after)
        self.assertEqual(result["materialCorrectionCatalogChangedFields"], ["baseline.coreSha256"])
        self.assertTrue(all(chart["surfaceEvidence"]["kind"] == "unknown"
                            for chart in after["charts"] if chart["chartId"] in result["changedChartIds"]))

    def test_repaired_lifecycle_includes_600_and_excludes_older_epsilon(self) -> None:
        result = repair.apply(self.package)
        self.assertEqual(result["lifecycleWitnesses"], {
            "0": [True, True, True],
            "409": [True, True, True],
            "422": [True, True, True],
            "600": [True, True, True],
            "600.000001": [False, False, False],
        })

    def test_source_geometry_mutation_is_rejected(self) -> None:
        original = repair.CONTRACT
        contract = json.loads(original.read_text())
        contract["charts"][0]["sourceGeometryFloat64XyzSha256"] = "0" * 64
        mutated = self.package / "mutated-contract.json"
        mutated.write_text(json.dumps(contract))
        repair.CONTRACT = mutated
        try:
            with self.assertRaisesRegex(repair.BuildError, "source geometry changed"):
                repair.check(self.package)
        finally:
            repair.CONTRACT = original

    def test_chart_identity_mutation_is_rejected(self) -> None:
        core_path = self.package / "core.json"
        core = package_intern.read_package_json(core_path)
        core["charts"][74]["sourceFeatureIds"] = ["GPlates-wrong"]
        core_path.write_text(json.dumps(core))
        self.rebind_core_identity(core_path)
        with self.assertRaisesRegex(repair.BuildError, "chart semantics changed"):
            repair.check(self.package)

    def test_410_lifecycle_mutation_reproduces_the_422_failure(self) -> None:
        repair.apply(self.package)
        core = package_intern.read_package_json(self.package / "core.json")
        target = next(chart for chart in core["charts"]
                      if chart["chartId"] == json.loads(repair.CONTRACT.read_text())["charts"][0]["chartId"])
        target["lifecycle"]["validTimeMa"]["oldest"] = 410
        core_path = self.package / "core.json"
        core_path.write_bytes(repair.canonical(package_intern.intern_charts(core)))
        self.rebind_core_identity(core_path)
        with self.assertRaisesRegex(repair.BuildError, "unexpected repaired lifecycles"):
            repair.validate_applied(self.package)


if __name__ == "__main__":
    unittest.main()

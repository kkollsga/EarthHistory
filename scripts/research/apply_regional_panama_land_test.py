#!/usr/bin/env python3
"""Focused staging, lifecycle, and mutation checks for the Panama land appender."""

from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cao_package_intern as package_intern
import apply_regional_panama_land as appender


class PanamaApplyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="earthhistory-panama-apply-")
        self.package = Path(self.temporary.name) / "cao-v2.4"
        source = appender.PUBLIC
        self.package.mkdir()
        mutable = {"core.json", "manifest.json", "motion-palette.json", "motion-palette.bin", "batch-land.ehgb"}
        for path in source.iterdir():
            target = self.package / path.name
            if path.is_dir():
                if path.name == "corrections":
                    shutil.copytree(path, target)
                else:
                    target.symlink_to(path, target_is_directory=True)
            elif path.name in mutable or path.name.startswith("checkpoint-"):
                shutil.copy2(path, target)
            else:
                target.symlink_to(path)
        self._strip_current_exact_present_extensions()

    def _strip_current_exact_present_extensions(self):
        """Recover the post-native, pre-Panama staging state from public bytes."""
        core_path = self.package / "core.json"
        manifest_path = self.package / "manifest.json"
        palette_path = self.package / "motion-palette.json"
        palette_binary_path = self.package / "motion-palette.bin"
        core = package_intern.read_package_json(core_path)
        manifest = json.loads(manifest_path.read_text())
        palette = json.loads(palette_path.read_text())

        first_panama = next(index for index, row in enumerate(core["charts"])
                            if row["chartId"].startswith(appender.CHART_PREFIX))
        self.assertEqual(first_panama, 4841)
        self.assertTrue(all(row["chartId"].startswith(appender.CHART_PREFIX)
                            or row["chartId"].startswith("country-present-reference:")
                            for row in core["charts"][first_panama:]))
        target_indices = set(range(first_panama, first_panama + 5))
        core["charts"] = core["charts"][:first_panama]

        land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
        land_path = self.package / land_batch["geometryAsset"]["url"]
        geometry = appender.decode_ehgb(land_path.read_bytes())
        target_vertices = [index for index, owner in enumerate(geometry["charts"])
                           if owner in target_indices]
        vertex_offset = target_vertices[0]
        self.assertEqual(target_vertices, list(range(vertex_offset, len(geometry["charts"]))))
        triangle_offset = next(index for index, vertex in enumerate(geometry["indices"])
                               if vertex >= vertex_offset)
        self.assertEqual(triangle_offset % 3, 0)
        stripped = {
            "directions": geometry["directions"][:vertex_offset],
            "seams": geometry["seams"][:vertex_offset],
            "charts": geometry["charts"][:vertex_offset],
            "indices": geometry["indices"][:triangle_offset],
        }
        land_path.write_bytes(appender.encode_ehgb(**stripped))
        land_batch.update({
            "vertexCount": vertex_offset,
            "triangleCount": triangle_offset // 3,
            "geometryAsset": appender.asset(land_path),
        })

        binary, records = appender.decode_palette(palette_binary_path, palette)
        # The public palette also carries the later North Sea restoration entries
        # (appended after Panama); recover the pre-Panama state by dropping both
        # families and repacking the surviving records in entry order.
        removed_entries = [row for row in palette["entries"]
                           if row["entryId"].startswith(appender.ENTRY_PREFIX)
                           or row["entryId"] == "country-present-reference-plate-0-identity"
                           or row["entryId"].startswith("restoration-north-sea-")]
        self.assertEqual(len([row for row in removed_entries
                              if not row["entryId"].startswith("restoration-north-sea-")]), 4)
        removed_ids = {row["entryId"] for row in removed_entries}
        kept_records = []
        kept_entries = []
        for entry in palette["entries"]:
            if entry["entryId"] in removed_ids:
                continue
            rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
            entry = dict(entry, sampleOffset=len(kept_records))
            kept_records.extend(rows)
            kept_entries.append(entry)
        palette["entries"] = kept_entries
        palette["sourceIntervalSets"] = [row for row in palette["sourceIntervalSets"]
                                          if row["id"] not in (
                                              appender.INTERVAL_ID,
                                              "country-present-reference-clock-0-v1",
                                          ) and not row["id"].startswith("north-sea-restoration-clock-")]
        restoration = json.loads((appender.ROOT / "data/corrections/north-sea-restoration/restoration-contract.json").read_text())
        for row in restoration["charts"]:
            chart = core["charts"][row["chartIndex"]]
            self.assertEqual(chart["chartId"], row["chartId"])
            chart["motionBindings"] = [{"paletteId": palette["id"], "entryId": entry_id,
                                        "validTimeMa": {"youngest": youngest, "oldest": oldest}}
                                       for entry_id, youngest, oldest in row["bindings"]]
            chart["evidence"]["limitations"] = [text for text in chart["evidence"]["limitations"]
                                                if not text.startswith("North Sea regional restoration")]
            chart["evidence"]["sourceIds"] = [source for source in chart["evidence"]["sourceIds"]
                                              if source not in restoration["sourceIds"]]
        palette_binary_path.write_bytes(appender.encode_palette(palette, kept_records))
        palette["binary"] = appender.asset(palette_binary_path)
        palette_path.write_bytes(appender.canonical(palette))

        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest["core"] = appender.asset(core_path)
        manifest["motionPalette"]["catalog"] = appender.asset(palette_path)
        manifest["motionPalette"]["binary"] = appender.asset(palette_binary_path)
        for descriptor in manifest["checkpoints"]:
            appender.update_checkpoint(self.package, descriptor, vertex_offset)
        manifest_path.write_bytes(appender.canonical(manifest))

    def tearDown(self):
        self.temporary.cleanup()

    def test_staged_apply_preserves_prefixes_and_exact_age(self):
        result = appender.apply(self.package)
        self.assertEqual((result["charts"], result["addedVertices"], result["addedTriangles"]), (5, 291, 272))
        self.assertEqual(result["chartOffset"], 4841)
        self.assertEqual(result["addedMotionEntries"], [
            "panama-observed-land-plate-229-0",
            "panama-observed-land-plate-230-0",
            "panama-observed-land-plate-911-0",
        ])
        validated = appender.validate_applied(self.package)
        self.assertEqual(validated["charts"], 5)

        core_path = self.package / "core.json"
        core = package_intern.read_package_json(core_path)
        chart = next(row for row in core["charts"] if row["chartId"].startswith(appender.CHART_PREFIX))
        chart["lifecycle"]["validTimeMa"]["oldest"] = 0.000001
        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest_path = self.package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["core"] = appender.asset(core_path)
        manifest_path.write_bytes(appender.canonical(manifest))
        with self.assertRaisesRegex(appender.BuildError, "chart provenance"):
            appender.validate_applied(self.package)

    def test_identity_motion_mutation_is_rejected(self):
        appender.apply(self.package)
        palette_path = self.package / "motion-palette.json"
        palette = json.loads(palette_path.read_text())
        entry = next(row for row in palette["entries"] if row["entryId"] == "panama-observed-land-plate-229-0")
        entry["oldestAgeMa"] = 1
        palette_path.write_bytes(appender.canonical(palette))
        manifest_path = self.package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["motionPalette"]["catalog"] = appender.asset(palette_path)
        manifest_path.write_bytes(appender.canonical(manifest))
        with self.assertRaisesRegex(appender.BuildError, "exact-present identity motion"):
            appender.validate_applied(self.package)

        entry["oldestAgeMa"] = 0
        interval = next(row for row in palette["sourceIntervalSets"] if row["id"] == appender.INTERVAL_ID)
        interval["intervals"] = [interval["intervals"][-1]]
        palette_path.write_bytes(appender.canonical(palette))
        manifest["motionPalette"]["catalog"] = appender.asset(palette_path)
        manifest_path.write_bytes(appender.canonical(manifest))
        with self.assertRaisesRegex(appender.BuildError, "source interval"):
            appender.validate_applied(self.package)

    def test_chart_provenance_and_geometry_remaps_are_rejected(self):
        appender.apply(self.package)
        core_path = self.package / "core.json"
        manifest_path = self.package / "manifest.json"
        core = package_intern.read_package_json(core_path)
        targets = [row for row in core["charts"] if row["chartId"].startswith(appender.CHART_PREFIX)]
        targets[0]["sourceFeatureIds"], targets[1]["sourceFeatureIds"] = (
            targets[1]["sourceFeatureIds"], targets[0]["sourceFeatureIds"]
        )
        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest = json.loads(manifest_path.read_text())
        manifest["core"] = appender.asset(core_path)
        manifest_path.write_bytes(appender.canonical(manifest))
        with self.assertRaisesRegex(appender.BuildError, "chart provenance"):
            appender.validate_applied(self.package)

        targets[0]["sourceFeatureIds"], targets[1]["sourceFeatureIds"] = (
            targets[1]["sourceFeatureIds"], targets[0]["sourceFeatureIds"]
        )
        land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
        land_path = self.package / land_batch["geometryAsset"]["url"]
        decoded = appender.decode_ehgb(land_path.read_bytes())
        first_target = next(index for index, value in enumerate(decoded["charts"])
                            if value == core["charts"].index(targets[0]))
        decoded["charts"][first_target] = core["charts"].index(targets[1])
        land_path.write_bytes(appender.encode_ehgb(**decoded))
        land_batch["geometryAsset"] = appender.asset(land_path)
        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest["core"] = appender.asset(core_path)
        manifest_path.write_bytes(appender.canonical(manifest))
        with self.assertRaisesRegex(appender.BuildError, "mesh payload or per-chart ownership"):
            appender.validate_applied(self.package)

    def test_public_apply_and_double_apply_are_rejected(self):
        with self.assertRaisesRegex(appender.BuildError, "explicit staging package"):
            appender.apply(appender.PUBLIC)
        appender.apply(self.package)
        with self.assertRaisesRegex(appender.BuildError, "already applied"):
            appender.apply(self.package)


if __name__ == "__main__":
    unittest.main()

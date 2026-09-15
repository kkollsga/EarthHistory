#!/usr/bin/env python3
"""Focused staging and mutation checks for the exact-present country appender."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cao_package_intern as package_intern
import apply_cao_modern_country_reference as appender


class ModernCountryReferenceApplyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="earthhistory-country-present-")
        self.package = Path(self.temporary.name) / "cao-v2.4"
        self.package.mkdir()
        mutable = {
            "core.json", "manifest.json", "motion-palette.json", "motion-palette.bin",
            "country-reference.ehgl",
        }
        for source in appender.PUBLIC.iterdir():
            target = self.package / source.name
            if source.name in mutable:
                shutil.copy2(source, target)
            else:
                target.symlink_to(source, target_is_directory=source.is_dir())
        self.strip_current_extension()

    def tearDown(self):
        self.temporary.cleanup()

    def strip_current_extension(self) -> None:
        core_path = self.package / "core.json"
        palette_path = self.package / "motion-palette.json"
        palette_binary_path = self.package / "motion-palette.bin"
        core = package_intern.read_package_json(core_path)
        matches = [index for index, row in enumerate(core["charts"])
                   if row["chartId"].startswith(appender.CHART_PREFIX)]
        self.assertEqual(matches, list(range(matches[0], len(core["charts"]))))
        core["charts"] = core["charts"][:matches[0]]
        line = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
        line_path = self.package / line["geometryAsset"]["url"]
        geometry = appender.decode_ehgl(line_path.read_bytes())
        baseline = json.loads(appender.CONTRACT.read_text())["baselineLineAsset"]
        line_path.write_bytes(appender.encode_ehgl(
            geometry["directions"][:baseline["vertexCount"]],
            geometry["charts"][:baseline["vertexCount"]],
            geometry["indices"][:baseline["segmentCount"] * 2],
        ))
        line["vertexCount"] = baseline["vertexCount"]
        line["segmentCount"] = baseline["segmentCount"]
        line["geometryAsset"] = appender.asset(line_path)

        palette = json.loads(palette_path.read_text())
        _, records = appender.decode_palette(palette_binary_path, palette)
        entry = next(row for row in palette["entries"] if row["entryId"] == appender.ENTRY_ID)
        self.assertEqual(entry["sampleOffset"] + entry["sampleCount"], len(records))
        self.assertEqual(palette["entries"][-1], entry)
        palette["entries"].pop()
        palette["sourceIntervalSets"] = [row for row in palette["sourceIntervalSets"]
                                          if row["id"] != appender.INTERVAL_ID]
        palette_binary_path.write_bytes(appender.encode_palette(palette, records[:entry["sampleOffset"]]))
        palette["binary"] = appender.asset(palette_binary_path)
        palette_path.write_bytes(appender.canonical(palette))
        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest_path = self.package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["core"] = appender.asset(core_path)
        manifest["motionPalette"]["catalog"] = appender.asset(palette_path)
        manifest["motionPalette"]["binary"] = appender.asset(palette_binary_path)
        manifest_path.write_bytes(appender.canonical(manifest))

    def refresh_line_identities(self, core: dict) -> None:
        line = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
        line["geometryAsset"] = appender.asset(self.package / line["geometryAsset"]["url"])
        core_path = self.package / "core.json"
        core_path.write_bytes(appender.canonical(package_intern.intern_charts(core)))
        manifest_path = self.package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["core"] = appender.asset(core_path)
        manifest_path.write_bytes(appender.canonical(manifest))

    def test_append_is_complete_once_only_and_preserves_prefixes(self):
        result = appender.apply(self.package)
        self.assertEqual((result["charts"], result["addedVertices"], result["addedSegments"]),
                         (149, 4062, 2031))
        self.assertEqual((result["totalVertices"], result["totalSegments"]), (24090, 12045))
        self.assertEqual(appender.validate_applied(self.package)["addedSegments"], 2031)
        with self.assertRaisesRegex(appender.BuildError, "already applied"):
            appender.apply(self.package)

    def test_cross_country_vertex_remap_is_rejected(self):
        appender.apply(self.package)
        core = package_intern.read_package_json(self.package / "core.json")
        target_indices = [index for index, row in enumerate(core["charts"])
                          if row["chartId"].startswith(appender.CHART_PREFIX)]
        line = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
        line_path = self.package / line["geometryAsset"]["url"]
        geometry = appender.decode_ehgl(line_path.read_bytes())
        segment_offset = next(offset for offset in range(0, len(geometry["indices"]), 2)
                              if geometry["charts"][geometry["indices"][offset]] == target_indices[0])
        for vertex in geometry["indices"][segment_offset:segment_offset + 2]:
            geometry["charts"][vertex] = target_indices[1]
        line_path.write_bytes(appender.encode_ehgl(**geometry))
        self.refresh_line_identities(core)
        with self.assertRaisesRegex(appender.BuildError, "per-country ownership"):
            appender.validate_applied(self.package)

    def test_lifecycle_extension_and_public_apply_are_rejected(self):
        with self.assertRaisesRegex(appender.BuildError, "explicit staging package"):
            appender.apply(appender.PUBLIC)
        appender.apply(self.package)
        core = package_intern.read_package_json(self.package / "core.json")
        chart = next(row for row in core["charts"] if row["chartId"].startswith(appender.CHART_PREFIX))
        chart["lifecycle"]["validTimeMa"]["oldest"] = 0.000001
        self.refresh_line_identities(core)
        with self.assertRaisesRegex(appender.BuildError, "evidence or motion binding"):
            appender.validate_applied(self.package)

    def test_source_metadata_change_is_rejected(self):
        contract = json.loads(appender.CONTRACT.read_text())
        contract["source"]["url"] = "https://example.invalid/replacement"
        with self.assertRaisesRegex(appender.BuildError, "source url changed"):
            appender.source_rows(contract)


if __name__ == "__main__":
    unittest.main()

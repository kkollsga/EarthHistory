#!/usr/bin/env python3
"""Regression and mutation tests for the composed Iceland shelf package writer."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("apply_regional_iceland_shelf.py")
SPEC = importlib.util.spec_from_file_location("apply_regional_iceland_shelf", MODULE)
assert SPEC and SPEC.loader
writer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writer)


class RegionalIcelandShelfWriterTest(unittest.TestCase):
    def test_source_mesh_is_deterministic_and_clear_at_approved_shelf_shell(self) -> None:
        contract = json.loads(writer.CONTRACT.read_text())
        directions, indices, charts = writer.triangulate_source(contract, 4824)
        self.assertEqual((len(directions), len(indices) // 3), (2348, 2387))
        self.assertEqual(set(charts), {4824, 4825})
        minimum, _ = writer.triangle_radius_extrema({
            "directions": directions, "indices": indices,
        }, writer.SHELF_SHELL_METRES)
        self.assertGreater(minimum, 1 + writer.FLOAT32_ORDER_MARGIN)

    def test_geometry_codec_preserves_every_decoded_array(self) -> None:
        path = writer.DEFAULT_PACKAGE / "batch-shelf.ehgb"
        decoded = writer.decode_ehgb(path.read_bytes())
        self.assertEqual(writer.decode_ehgb(writer.encode_ehgb(**decoded)), decoded)

    def test_clearance_guard_rejects_old_shelf_and_land_shells(self) -> None:
        package = self.applied_public_package()
        report = writer.clearance_report(package)
        writer.assert_clearance(report)
        old_shelf = copy.deepcopy(report)
        old_shelf["shelfMinimumDisplayedRadius"] = report["old80mShelfMinimumDisplayedRadius"]
        with self.assertRaisesRegex(writer.BuildError, "shelf intersects"):
            writer.assert_clearance(old_shelf)
        old_land = copy.deepcopy(report)
        old_land["landMinimumDisplayedRadius"] = report["old400mLandMinimumDisplayedRadius"]
        old_land["minimumLandOverShelfRadiusGap"] = (
            old_land["landMinimumDisplayedRadius"] - old_land["shelfMaximumDisplayedVertexRadius"]
        )
        with self.assertRaisesRegex(writer.BuildError, "land does not clear"):
            writer.assert_clearance(old_land)

    def test_generated_package_rejects_backdating_and_chart_index_drift(self) -> None:
        source = self.applied_public_package()
        with self.package_copy(source) as package:
            core_path = package / "core.json"
            core = json.loads(core_path.read_text())
            target = next(chart for chart in core["charts"] if chart["chartId"].startswith(writer.CHART_PREFIX))
            target["lifecycle"]["validTimeMa"]["oldest"] = 0.000001
            writer.write_atomic(core_path, writer.canonical(core))
            self.rebind_core(package)
            with self.assertRaisesRegex(writer.BuildError, "lifecycle or evidence"):
                writer.validate_applied(package)
        with self.package_copy(source) as package:
            manifest = json.loads((package / "manifest.json").read_text())
            catalog_path = package / manifest["materialCorrections"]["catalog"]["url"]
            catalog = json.loads(catalog_path.read_text())
            observed = next(row for row in catalog["spatialBatches"]
                            if row["batchId"] == "material-correction-observed")
            geometry_path = package / observed["geometryAsset"]["url"]
            geometry = bytearray(geometry_path.read_bytes())
            vertices = struct.unpack_from("<I", geometry, 8)[0]
            chart_offset = writer.HEADER_BYTES + 16 * vertices
            value = struct.unpack_from("<I", geometry, chart_offset)[0]
            struct.pack_into("<I", geometry, chart_offset, value - 2)
            writer.write_atomic(geometry_path, bytes(geometry))
            observed["geometryAsset"] = writer.asset(
                geometry_path, str(geometry_path.relative_to(package))
            )
            writer.write_atomic(catalog_path, writer.canonical(catalog))
            manifest["materialCorrections"]["catalog"] = writer.asset(
                catalog_path, str(catalog_path.relative_to(package))
            )
            writer.write_atomic(package / "manifest.json", writer.canonical(manifest))
            with self.assertRaisesRegex(writer.BuildError, "indices were not shifted exactly"):
                writer.validate_applied(package)

    @staticmethod
    def applied_public_package() -> Path:
        public_core = json.loads((writer.DEFAULT_PACKAGE / "core.json").read_text())
        if not any(chart["chartId"].startswith(writer.CHART_PREFIX) for chart in public_core["charts"]):
            raise AssertionError("shipped Iceland shelf package is absent")
        return writer.DEFAULT_PACKAGE

    @staticmethod
    def package_copy(source: Path):
        temporary = tempfile.TemporaryDirectory(prefix="earthhistory-iceland-shelf-test-")
        root = Path(temporary.name)
        for path in source.rglob("*"):
            if not path.is_file():
                continue
            target = root / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(path.resolve())
        class Owner:
            def __enter__(self):
                self.temporary = temporary
                return root
            def __exit__(self, *_args):
                temporary.cleanup()
        return Owner()

    @staticmethod
    def rebind_core(package: Path) -> None:
        manifest_path = package / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        core_path = package / "core.json"
        manifest["core"] = writer.asset(core_path)
        catalog_path = package / manifest["materialCorrections"]["catalog"]["url"]
        catalog = json.loads(catalog_path.read_text())
        catalog["baseline"]["coreSha256"] = manifest["core"]["sha256"]
        writer.write_atomic(catalog_path, writer.canonical(catalog))
        manifest["materialCorrections"]["catalog"] = writer.asset(
            catalog_path, str(catalog_path.relative_to(package))
        )
        writer.write_atomic(manifest_path, writer.canonical(manifest))


if __name__ == "__main__":
    unittest.main()

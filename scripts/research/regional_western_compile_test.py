#!/usr/bin/env python3
"""Source-level checks for the western Laurentia material candidates."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

import regional_western_compile as western
import regional_western_source450_audit as source450
import regional_western_source490_audit as source490
import regional_western_native_overrides as native_overrides
from cao_material_corrections import CorrectionError, load_stage, target_catalog, validate_manifest
import emit_cao_material_corrections as emitter


ROOT = Path(__file__).resolve().parents[2]


class RegionalWesternCompileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidates, cls.manifest, cls.validation = western.compile_candidate()
        cls.source450_validation, cls.source450_tiles = source450.audit()
        cls.source490_validation, cls.source490_tiles = source490.compile_replacement()
        cls.native_overrides = native_overrides.build()

    def test_candidates_are_reproducible_and_source_qualified(self):
        disk_manifest = json.loads(
            (ROOT / "data/corrections/western-laurentia/manifest.json").read_text()
        )
        self.assertEqual(self.manifest, disk_manifest)
        self.assertEqual(len(self.candidates), 2)
        for row, feature in zip(self.candidates, self.manifest["features"]):
            self.assertEqual(
                feature["geometryAsset"]["sha256"],
                hashlib.sha256(western.canonical_json(row["geojson"])).hexdigest(),
            )
            self.assertIn("usgs-ds898-basement-domains", feature["sourceIds"])
        metadata, directions = load_stage()
        validate_manifest(
            ROOT / "data/corrections/western-laurentia/manifest.json",
            target_catalog(metadata, directions),
            {},
        )

        plate154, plate1731 = self.validation["geometries"]
        self.assertEqual(plate154["plateId"], 154)
        self.assertEqual(plate1731["plateId"], 1731)
        self.assertGreater(plate154["candidateTargetFraction"], 0.65)
        self.assertLess(plate154["candidateTargetFraction"], 0.67)
        self.assertGreater(plate1731["candidateTargetFraction"], 0.04)
        self.assertLess(plate1731["candidateTargetFraction"], 0.05)
        self.assertGreater(
            plate1731["reconciliation"]["acobRemovedByYoungerBasementVetoKm2"], 80_000
        )
        self.assertEqual(plate154["outsideRawKm2"], 0)
        self.assertEqual(plate1731["outsideQualifiedInsetKm2"], 0)
        self.assertLess(plate154["vertexCount"], 300)
        self.assertLess(plate1731["vertexCount"], 100)

    def test_acob_identity_and_endpoint_are_exact(self):
        geometry = western.load_laurentia_acob()
        self.assertFalse(geometry.is_empty)
        self.assertEqual(western.ACOB_VALID_TIME, (1070.0, 410.1))
        self.assertGreater(410.001, 410.0)
        self.assertLess(410.001, western.ACOB_VALID_TIME[1])
        self.assertEqual(self.manifest["features"][0]["supportIntervalMa"]["youngest"], 410)
        self.assertIn("0.1 Ma handoff", self.manifest["features"][0]["uncertainty"]["temporal"])

    def test_source450_tiles_replace_native_geometry_by_domain_age(self):
        audit = self.source450_validation["basementAudit"]
        self.assertEqual(len(self.source450_tiles["features"]), 8)
        self.assertAlmostEqual(audit["predates410Fraction"], 0.09068, places=4)
        self.assertAlmostEqual(audit["mappedFraction"], 1.0, places=4)
        snapshots = {row["ageMa"]: row for row in audit["ageSnapshots"]}
        self.assertIn(540.0, snapshots)
        self.assertIn(410.001, snapshots)
        self.assertIn(0.001, snapshots)
        self.assertEqual(snapshots[410.0]["activeDomains"], ["Mojave", "Salinia"])
        self.assertEqual(snapshots[400.0]["activeDomains"], ["Mojave", "Salinia"])
        self.assertIn("Shoofly-Olds Ferry", snapshots[365.0]["formationUncertainDomains"])
        self.assertNotIn("Siletzia", snapshots[100.0]["activeDomains"])
        self.assertIn("Siletzia", snapshots[50.0]["activeDomains"])
        self.assertEqual(snapshots[540.0]["activeDomains"], ["Mojave", "Salinia"])
        self.assertAlmostEqual(snapshots[1.0]["visibleFraction"], snapshots[0.0]["visibleFraction"], places=10)
        foothills = next(feature for feature in self.source450_tiles["features"]
                         if feature["properties"]["domain"] == "Foothills-Wallowa")
        uncertain = next(row for row in foothills["properties"]["materialStatusIntervalsMa"]
                         if row["status"] == "formation-uncertain")
        self.assertEqual(uncertain["oldest"], 300.0)
        self.assertEqual(audit["presentUnionOutsideTargetKm2"], 0)
        self.assertEqual(audit["presentTargetOutsideUnionKm2"], 0)
        terrane = self.source450_validation["terraneFootprintAudit"]
        self.assertEqual(terrane["mappedEasternKlamath"]["source450OverlapKm2"], 0)
        self.assertEqual(terrane["trinityOrdovician"]["source450OverlapKm2"], 0)

    def test_unqualified_age_class_mutation_fails(self):
        with self.assertRaisesRegex(western.BuildError, "only USGS code Y"):
            western.verify_source_code("Yv")

    def test_source490_replacement_removes_younger_basement_at_the_seam(self):
        audit = self.source490_validation
        self.assertEqual(len(self.source490_tiles["features"]), 27)
        snapshots = {row["ageMa"]: row for row in audit["ageSnapshots"]}
        self.assertIn("qualified-pre-410-basement", snapshots[410.0]["activeDomains"])
        self.assertIn("Coast plutonic complex", snapshots[410.0]["activeDomains"])
        self.assertIn("Methow", snapshots[410.0]["activeDomains"])
        self.assertIn("Harrison", snapshots[410.0]["activeDomains"])
        self.assertLess(snapshots[410.0]["visibleFraction"], 0.108)
        self.assertGreater(snapshots[410.0]["visibleFraction"], 0.105)
        self.assertLess(snapshots[410.001]["visibleFraction"], 0.061)
        self.assertGreater(snapshots[410.001]["visibleFraction"], 0.059)
        self.assertGreater(snapshots[365.0]["visibleFraction"], 0.25)
        self.assertIn("Franciscan", snapshots[100.0]["formationUncertainDomains"])
        self.assertIn("Cascadia", snapshots[50.0]["formationUncertainDomains"])
        self.assertAlmostEqual(snapshots[1.0]["visibleFraction"], snapshots[0.0]["visibleFraction"], places=10)
        coast = next(feature for feature in self.source490_tiles["features"]
                     if feature["properties"]["domain"] == "Coast plutonic complex")
        self.assertIsNone(coast["properties"]["materialOriginRangeMa"])
        self.assertEqual(coast["properties"]["geometryLifecycleMa"]["oldest"], 410.0)
        self.assertEqual(
            coast["properties"]["materialStatusIntervalsMa"][0]["status"],
            "native-source-supported-material-age-unknown",
        )
        repair = audit["residualTriangulationRepair"]
        self.assertEqual(repair["rawComponentCount"], 23)
        self.assertEqual(repair["keptComponentCount"], 17)
        self.assertEqual(repair["droppedComponentCount"], 6)
        self.assertEqual(repair["droppedSourcePartIndexes"], [12, 15, 17, 18, 19, 22])
        self.assertLess(repair["droppedAreaKm2"], repair["presentUnionToleranceKm2"])
        self.assertTrue(repair["withinTolerance"])
        self.assertLessEqual(
            audit["presentUnionSymmetricDifferenceKm2"],
            repair["presentUnionToleranceKm2"],
        )
        self.assertEqual(audit["presentUnionOutsideTargetCoordinateArea"], 0)

    def test_source490_residual_triangulates_in_production_path(self):
        source = next(
            feature for feature in self.source490_tiles["features"]
            if feature["id"] == "source490-unclassified-present-remainder"
        )
        directions = []
        patches = []
        for polygon_index, polygon in enumerate(emitter.polygons(source["geometry"])):
            rings = []
            polygon_directions = []
            for coordinates in polygon:
                if coordinates[0][:2] == coordinates[-1][:2]:
                    coordinates = coordinates[:-1]
                offset = len(directions)
                ring_directions = [
                    emitter.lon_lat_direction(position) for position in coordinates
                ]
                directions.extend(ring_directions)
                polygon_directions.extend(ring_directions)
                rings.append({"offset": offset, "count": len(ring_directions)})
            patches.append({
                "patchId": f"source490-unclassified-present-remainder:qualified:{polygon_index}",
                "rings": rings,
                "interiorDirection": list(emitter.unit(tuple(
                    sum(point[axis] for point in polygon_directions)
                    for axis in range(3)
                ))),
                "chartIndex": 0,
            })
        self.assertEqual(len(patches), 17)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            metadata_path = directory / "rings.json"
            directions_path = directory / "directions.f32"
            output_path = directory / "indices.u32"
            metadata_path.write_bytes(emitter.canonical_json({"patches": patches}))
            raw = bytearray(12 * len(directions))
            for index, direction in enumerate(directions):
                struct.pack_into("<fff", raw, index * 12, *direction)
            directions_path.write_bytes(raw)
            completed = subprocess.run(
                [
                    "node",
                    str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
                    str(metadata_path),
                    str(directions_path),
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            triangulated = json.loads(Path(f"{output_path}.json").read_text())
            self.assertEqual(len(triangulated["patches"]), 17)
            self.assertEqual(
                [row for row in triangulated["patches"] if row["status"] != "candidate"],
                [],
            )

    def test_native_override_gate_rejects_target_identity_mutation(self):
        candidate = deepcopy(self.native_overrides)
        candidate["nativeChartOverrides"][0]["nativeTarget"]["geometrySha256"] = "0" * 64
        with self.assertRaisesRegex(native_overrides.OverrideError, "identity changed"):
            native_overrides.validate(candidate)
        candidate = deepcopy(self.native_overrides)
        candidate["nativeChartOverrides"][0]["nativeTarget"]["plateId"] = 1731
        with self.assertRaisesRegex(native_overrides.OverrideError, "identity changed"):
            native_overrides.validate(candidate)

    def test_source_oracle_rejects_target_hash_mutation(self):
        path = ROOT / "data/corrections/western-laurentia/manifest.json"
        candidate = json.loads(path.read_text())
        candidate["features"][0]["targets"][0]["geometrySha256"] = "0" * 64
        metadata, directions = load_stage()
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", dir=path.parent, delete=True
        ) as temporary:
            json.dump(candidate, temporary)
            temporary.flush()
            with self.assertRaisesRegex(CorrectionError, "does not exactly match"):
                validate_manifest(
                    Path(temporary.name), target_catalog(metadata, directions), {}
                )

    def test_missing_rotation_does_not_fall_back_to_identity(self):
        class MissingRotationModel:
            @staticmethod
            def get_rotation(*args, **kwargs):
                return None

        with self.assertRaisesRegex(western.BuildError, "missing strict Cao rotation"):
            western.strict_rotation(MissingRotationModel(), 411, 154)

    def test_storage_bounds_cover_complete_owned_sources(self):
        source = self.validation["source"]
        self.assertLessEqual(source["ownedDirectoryBytes"], source["directoryMaximumBytes"])
        self.assertLessEqual(
            source["completionDirectoryBytes"], source["completionDirectoryMaximumBytes"]
        )
        self.assertLessEqual(
            source["completePalaeomapStudyBytes"], source["completePalaeomapStudyMaximumBytes"]
        )


if __name__ == "__main__":
    unittest.main()

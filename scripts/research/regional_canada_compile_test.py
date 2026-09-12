#!/usr/bin/env python3
"""Source-level regression checks for the Northern Canada correction candidate."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from unittest import mock

import regional_canada_compile as canada


ROOT = Path(__file__).resolve().parents[2]


class RegionalCanadaCompileTest(unittest.TestCase):
    def test_candidate_is_reproducible_and_preserves_an_uncertain_older_state(self):
        geojson, manifest, validation = canada.compile_candidate()
        expected_geometry = hashlib.sha256(canada.canonical_json(geojson)).hexdigest()
        on_disk = json.loads((ROOT / "data/corrections/canada/manifest.json").read_text())

        self.assertEqual(manifest, on_disk)
        self.assertEqual(validation["summary"]["targetChartCount"], 44)
        union = validation["summary"]["referenceEqualAreaUnion"]
        self.assertGreater(union["candidateCrossCohortOverlapKm2"], 5000)
        self.assertGreater(union["targetCrossCohortOverlapKm2"], 10000)
        self.assertGreater(union["candidateUnionSupportFraction"], 0.84)
        self.assertLess(union["candidateUnionSupportFraction"], 0.86)
        self.assertLessEqual(validation["summary"]["candidateCoordinateCount"], 4000)
        at_411 = next(row for row in validation["nativeCoverage"] if row["ageMa"] == 411)
        self.assertEqual(at_411["ageMa"], 411)
        self.assertEqual(at_411["nativeCoverageBeforeFraction"], 0)
        self.assertAlmostEqual(
            at_411["combinedCoverageAfterFraction"],
            union["candidateUnionSupportFraction"],
            places=4,
        )
        self.assertEqual(at_411["candidateOverlapWithNativeKm2"], 0)
        self.assertEqual(validation["summary"]["pearyaOverlapKm2"], 0)
        self.assertLessEqual(
            validation["source"]["ownedSourceDirectoryBytes"],
            validation["source"]["sourceAcquisitionMaximumBytes"],
        )
        for cohort in validation["cohorts"]:
            self.assertEqual(cohort["finalOutsideQualifiedSourceKm2"], 0)
            self.assertEqual(cohort["finalOutsideTargetKm2"], 0)
            self.assertLessEqual(cohort["mappedUnitSimplificationAreaChangeFraction"], 0.10)
            self.assertLessEqual(cohort["mappedUnitSimplifiedOutsideSourceFraction"], 0.06)
        for feature in manifest["features"]:
            self.assertEqual(feature["geometryAsset"]["sha256"], expected_geometry)
            self.assertEqual(feature["supportIntervalMa"], {
                "youngest": 410,
                "youngestExclusive": True,
                "oldest": 430,
            })
            self.assertEqual(feature["olderEdgePolicy"], "uncertain-beyond-qualified-support")
            self.assertEqual(feature["olderUncertaintyTransitionMa"]["oldest"], 540)
            self.assertEqual(feature["surfaceEvidence"]["kind"], "unknown")
            comparison_411 = feature["pose"]["alignmentWitnesses"][0][
                "olderPoseComparisons"
            ][0]
            self.assertEqual(comparison_411["ageMa"], 411)
            self.assertEqual(len(comparison_411["expectedLonLat"]), 2)
            self.assertLessEqual(
                validation["cohorts"][
                    [row["plateId"] for row in validation["cohorts"]].index(
                        feature["sourceBasis"]["targetPlateIds"][0]
                    )
                ]["maximumPoseResidualKm411To540"],
                1e-6,
            )
        endpoints = {row["ageMa"]: row for row in validation["endpointChecks"]}
        self.assertFalse(endpoints[410.0]["correctionActive"])
        self.assertTrue(endpoints[410.001]["correctionActive"])
        self.assertFalse(endpoints[410.099999]["continentalBoundarySourceActive"])
        self.assertTrue(endpoints[410.1]["continentalBoundarySourceActive"])
        below = next(row for row in validation["nativeCoverage"] if row["ageMa"] == 410.099999)
        exact = next(row for row in validation["nativeCoverage"] if row["ageMa"] == 410.1)
        self.assertLess(abs(below["combinedCoverageAfterFraction"] - exact["combinedCoverageAfterFraction"]), 1e-5)

    def test_pearya_policy_mutation_fails(self):
        mutated_cover = set(canada.COVER_SETTINGS)
        mutated_cover.add("M'Clintock orogen cover, PEARYA TERRANE (Peri-cratonic North America)")
        with self.assertRaisesRegex(canada.BuildError, "forbidden material setting"):
            canada.verify_selection_policy(set(canada.DIRECT_SETTINGS), mutated_cover)

    def test_deep_water_policy_mutation_fails(self):
        mutated_direct = set(canada.DIRECT_SETTINGS)
        mutated_direct.add("Hazen deep water basin")
        with self.assertRaisesRegex(canada.BuildError, "forbidden material setting"):
            canada.verify_selection_policy(mutated_direct, set(canada.COVER_SETTINGS))

    def test_pinned_laurentia_acob_identity_mutation_fails(self):
        rotations = canada.pygplates.RotationModel(
            [
                str(canada.MODEL_ROOT / "1000_0_rotfile.rot"),
                str(canada.MODEL_ROOT / "1800_1000_rotfile.rot"),
            ],
            default_anchor_plate_id=0,
        )
        with mock.patch.object(canada, "LAURENTIA_ACOB_ID", "mutated-source-id"):
            with self.assertRaisesRegex(canada.BuildError, "exactly one pinned"):
                canada.load_laurentia_acob(rotations)

    def test_unit_tiers_separate_ancient_rock_from_younger_cover(self):
        ancient, _ = canada.classify_setting(
            "Franklinian shelf, ARCTIC PLATFORM",
            "CAMBRIAN AND ORDOVICIAN: Middle Cambrian to Early Ordovician",
        )
        younger, _ = canada.classify_setting(
            "Franklinian shelf, ARCTIC PLATFORM",
            "SILURIAN AND DEVONIAN: Ludlow to Early Devonian",
        )
        self.assertEqual(ancient, "direct-ancient-unit")
        self.assertEqual(younger, "younger-cover-substrate-inference")
        sverdrup, _ = canada.classify_setting(
            "Sverdrup deep water basin", "CARBONIFEROUS TO PALEOGENE"
        )
        hazen, _ = canada.classify_setting(
            "Hazen deep water basin", "ORDOVICIAN TO DEVONIAN"
        )
        self.assertEqual(sverdrup, "younger-cover-substrate-inference")
        self.assertIsNone(hazen)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Source-level regression checks for the Pearya scenario candidate."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

import regional_pearya_compile as pearya


ROOT = Path(__file__).resolve().parents[2]


class RegionalPearyaCompileTest(unittest.TestCase):
    def test_candidate_is_reproducible_source_bounded_and_pose_explicit(self):
        geojson, manifest, validation = pearya.compile_candidate()
        expected_geometry = hashlib.sha256(pearya.canada.canonical_json(geojson)).hexdigest()
        on_disk = json.loads((ROOT / "data/corrections/pearya/manifest.json").read_text())

        self.assertEqual(manifest, on_disk)
        self.assertEqual(len(manifest["features"]), 2)
        feature = next(
            row for row in manifest["features"] if row["correctionFeatureId"] == pearya.FEATURE_ID
        )
        laurentian = next(
            row
            for row in manifest["features"]
            if row["correctionFeatureId"] == pearya.LAURENTIAN_FEATURE_ID
        )
        self.assertEqual(len(feature["targets"]), 3)
        self.assertEqual(len(laurentian["targets"]), 3)
        geometry = validation["geometry"]
        self.assertGreater(geometry["targetAreaSupportFractionAt411"], 0.28)
        self.assertLess(geometry["targetAreaSupportFractionAt411"], 0.30)
        self.assertGreaterEqual(geometry["retainedMappedSourceFraction"], 0.90)
        self.assertGreater(geometry["sourceHullGapWithinTargetKm2"], 10_000)
        self.assertGreater(geometry["mappedUnrelatedExcludedKm2"], 3_000)
        self.assertGreater(geometry["inferredIceOrUnmappedGapKm2"], 5_000)
        self.assertEqual(geometry["mappedNonPearyaOverlapKm2"], 0)
        self.assertEqual(geometry["finalOutsideSourceHullKm2"], 0)
        self.assertEqual(geometry["finalOutsideTargetKm2"], 0)
        self.assertLessEqual(geometry["coordinateCount"], 300)
        combined = validation["combined"]
        self.assertGreater(combined["targetAreaSupportFractionAt411"], 0.68)
        self.assertLess(combined["targetAreaSupportFractionAt411"], 0.70)
        self.assertLessEqual(combined["coordinateCount"], 1400)
        laurentian_geometry = validation["laurentianFragment"]
        self.assertEqual(laurentian_geometry["overlapWithPearyaScenarioKm2"], 0)
        self.assertLessEqual(laurentian_geometry["simplificationAreaChangeFraction"], 0.10)
        self.assertLessEqual(
            laurentian_geometry["simplifiedOutsideMappedSourceFraction"], 0.06
        )
        self.assertLessEqual(
            laurentian_geometry["maximumComputationalPlate101Vs124ResidualKm"],
            1e-6,
        )
        self.assertTrue(
            all(
                row["geometryAsset"]["sha256"] == expected_geometry
                for row in manifest["features"]
            )
        )
        self.assertEqual(
            feature["supportIntervalMa"],
            {"youngest": 410, "youngestExclusive": True, "oldest": 416.0},
        )
        self.assertFalse(validation["pose"]["consensusPlacement"])
        self.assertLessEqual(validation["pose"]["maximumComputationalPlate124ResidualKm"], 1e-6)
        endpoints = {row["ageMa"]: row for row in validation["endpointChecks"]}
        self.assertFalse(endpoints[410.0]["correctionActive"])
        self.assertTrue(endpoints[410.001]["correctionActive"])
        self.assertEqual(endpoints[416.0]["poseStyle"], "qualified")
        self.assertEqual(endpoints[416.001]["poseStyle"], "uncertain")
        self.assertEqual(
            laurentian["supportIntervalMa"],
            {"youngest": 410, "youngestExclusive": True, "oldest": 430},
        )
        self.assertEqual(laurentian["pose"]["plateId"], 101)

    def test_domain_policy_mutation_fails(self):
        with self.assertRaisesRegex(pearya.canada.BuildError, "selection policy changed"):
            pearya.verify_domain_policy("Ellesmere-North Greenland fold belt")


if __name__ == "__main__":
    unittest.main()

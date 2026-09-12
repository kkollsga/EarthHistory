#!/usr/bin/env python3
"""Scientific-contract mutation tests for the Barents correction."""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("regional_barents_compile.py")
SPEC = importlib.util.spec_from_file_location("regional_barents_compile", MODULE)
assert SPEC and SPEC.loader
compiler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compiler)


class RegionalBarentsCompileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((compiler.OUT / "manifest.json").read_text())
        cls.geojson = json.loads((compiler.OUT / "barents-pre-540-material.geojson").read_text())
        cls.validation = json.loads(compiler.VALIDATION.read_text())
        cls.policy = json.loads((compiler.OUT / "qualification-policy.json").read_text())

    def validate(self, manifest=None, geojson=None, validation=None) -> None:
        compiler.validate_outputs(
            copy.deepcopy(manifest or self.manifest),
            copy.deepcopy(geojson or self.geojson),
            copy.deepcopy(validation or self.validation),
            copy.deepcopy(self.policy),
        )

    def test_generated_candidate_passes(self) -> None:
        self.validate()

    def test_timan_includes_western_ural_continental_margin_domain(self) -> None:
        feature = {"properties": {"DOMAIN_R_2": "Urals foredeep, Western Ural Mountains", "AGE_DESCRI": "Cambrian"}}
        accepted, reason = compiler.classify(feature, "timan", self.policy)
        self.assertTrue(accepted)
        self.assertEqual(reason, "western-ural-baltican-passive-margin-substrate")

    def test_timan_direct_ural_old_units_require_pre_542_minimum_age(self) -> None:
        old = {"properties": {"DOMAIN_R_2": "Urals folded region", "AGE_DESCRI": "Neoproterozoic", "MIN_AGE_Ab": 542}}
        young = {"properties": {"DOMAIN_R_2": "Urals folded region", "AGE_DESCRI": "Devonian", "MIN_AGE_Ab": 359}}
        eastern = {"properties": {"DOMAIN_R_2": "Eastern Ural Mountains", "AGE_DESCRI": "Ordovician", "MIN_AGE_Ab": 444}}
        self.assertEqual(compiler.classify(old, "timan", self.policy), (True, "direct-proterozoic-western-ural-material"))
        self.assertEqual(compiler.classify(young, "timan", self.policy), (False, "excluded-ural-folded-unit-younger-than-direct-old-threshold"))
        self.assertEqual(compiler.classify(eastern, "timan", self.policy), (False, "excluded-non-timanian-affinity"))

    def test_timan_western_ural_policy_mutation_excludes_the_domain(self) -> None:
        policy = copy.deepcopy(self.policy)
        policy["sourceSelection"]["timanWesternContinentalMarginDomains"] = []
        feature = {"properties": {"DOMAIN_R_2": "Urals foredeep, Western Ural Mountains", "AGE_DESCRI": "Cambrian"}}
        self.assertEqual(compiler.classify(feature, "timan", policy), (False, "excluded-non-timanian-affinity"))

    def test_novaya_ice_is_footprint_inference(self) -> None:
        feature = {"properties": {"DOMAIN_R_2": "ice", "AGE_DESCRI": "ice"}}
        self.assertEqual(compiler.classify(feature, "novaya", self.policy), (True, "ice-mask-over-coherent-novaya-block"))

    def test_novaya_restoration_preserves_the_complete_guarded_mask(self) -> None:
        metric = self.validation["cohorts"]["novaya"]
        self.assertAlmostEqual(
            metric["guardedBeforeNativeDedupAreaSquareKilometres"],
            69178.74542049418,
            places=9,
        )
        self.assertEqual(metric["nativeDeduplicationAreaSquareKilometres"], 0)
        self.assertAlmostEqual(
            metric["nativeOverlapPreservedForRendererPrecedenceSquareKilometres"],
            42561.50452928311,
            places=9,
        )
        self.assertEqual(
            metric["supportedMaterialOmittedForCrossPhaseDeduplicationSquareKilometres"],
            0,
        )
        self.assertEqual(
            metric["deliveredAreaSquareKilometres"],
            metric["guardedBeforeNativeDedupAreaSquareKilometres"],
        )

    def test_novaya_cross_phase_omission_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        validation = copy.deepcopy(self.validation)
        metric = validation["cohorts"]["novaya"]
        metric["supportedMaterialOmittedForCrossPhaseDeduplicationSquareKilometres"] = 1
        feature = next(
            row for row in manifest["features"]
            if row["correctionFeatureId"] == "barents-novaya-pre-540-material-plate-373"
        )
        feature["geometryProcessing"][
            "supportedMaterialOmittedForCrossPhaseDeduplicationSquareKilometres"
        ] = 1
        with self.assertRaisesRegex(compiler.BuildError, "Novaya still omits"):
            self.validate(manifest=manifest, validation=validation)

    def test_unexpected_novaya_native_overlap_feature_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        validation = copy.deepcopy(self.validation)
        source = {
            "featureId": "GPlates-unexpected-native-feature",
            "name": "Unexpected native feature",
            "plateId": 999,
            "polygonCount": 1,
        }
        metric = validation["cohorts"]["novaya"]
        overlap = next(
            row for row in metric["postDedupNativeCoastOverlap"].values()
            if row["intersectingSources"]
        )
        overlap["intersectingSources"].append(source)
        feature = next(
            row for row in manifest["features"]
            if row["correctionFeatureId"] == "barents-novaya-pre-540-material-plate-373"
        )
        feature["geometryProcessing"] = copy.deepcopy(metric)
        with self.assertRaisesRegex(compiler.BuildError, "outside the renderer-precedence exception"):
            self.validate(manifest=manifest, validation=validation)

    def test_exposed_land_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["surfaceEvidence"]["kind"] = "exposed-land"
        with self.assertRaisesRegex(compiler.BuildError, "surface semantics"):
            self.validate(manifest=manifest)

    def test_geometry_mutation_is_rejected(self) -> None:
        geojson = copy.deepcopy(self.geojson)
        geojson["features"][0]["geometry"]["coordinates"][0][0][0][0] += 0.01
        with self.assertRaisesRegex(compiler.BuildError, "geometry asset hash"):
            self.validate(geojson=geojson)

    def test_pose_boundary_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][1]["poseConfidenceIntervalsMa"][0]["oldest"] = 429
        with self.assertRaisesRegex(compiler.BuildError, "pose confidence"):
            self.validate(manifest=manifest)

    def test_area_mutation_is_rejected(self) -> None:
        validation = copy.deepcopy(self.validation)
        validation["cohorts"]["timan"]["deliveredAreaSquareKilometres"] += 1
        with self.assertRaisesRegex(compiler.BuildError, "manifest and validation"):
            self.validate(validation=validation)

    def test_missing_overlap_age_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        validation = copy.deepcopy(self.validation)
        validation["cohorts"]["fjl"]["postDedupNativeCoastOverlap"].pop("415.0")
        match = next(feature for feature in manifest["features"] if feature["correctionFeatureId"] == "barents-fjl-pre-540-material-plate-311")
        match["geometryProcessing"]["postDedupNativeCoastOverlap"].pop("415.0")
        with self.assertRaisesRegex(compiler.BuildError, "overlap sweep"):
            self.validate(manifest=manifest, validation=validation)


if __name__ == "__main__":
    unittest.main()

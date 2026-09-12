#!/usr/bin/env python3
"""Mutation tests for the source-qualified Svalbard material candidate."""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("regional_svalbard_compile.py")
SPEC = importlib.util.spec_from_file_location("regional_svalbard_compile", MODULE_PATH)
assert SPEC and SPEC.loader
compiler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compiler)


class RegionalSvalbardCompileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = json.loads((compiler.SOURCE / compiler.SOURCE_GEOJSON).read_text())
        cls.manifest = json.loads((compiler.OUT / "manifest.json").read_text())
        cls.geojson = json.loads((compiler.OUT / "svalbard-pre-540-material.geojson").read_text())
        cls.targets = compiler.source_targets()[1]

    def validate(self, manifest=None, geojson=None, source=None) -> None:
        manifest = copy.deepcopy(manifest if manifest is not None else self.manifest)
        geojson = copy.deepcopy(geojson if geojson is not None else self.geojson)
        source = copy.deepcopy(source if source is not None else self.source)
        geojson_bytes = compiler.canonical_json(geojson)
        for feature in manifest["features"]:
            feature["geometryAsset"]["sha256"] = compiler.sha256(geojson_bytes)
        compiler.validate_candidate(manifest, geojson, geojson_bytes, source, self.targets)

    def test_generated_candidate_passes(self) -> None:
        self.validate()

    def test_young_source_age_mutation_is_rejected(self) -> None:
        source = copy.deepcopy(self.source)
        selected_id = self.geojson["features"][0]["properties"]["sourceMembers"][0]["objectId"]
        match = next(feature for feature in source["features"] if feature["properties"]["OBJECTID"] == selected_id)
        match["properties"]["AGE_PERIOD"] = "Devonian"
        with self.assertRaises(AssertionError):
            self.validate(source=source)

    def test_hard_430_ma_edge_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["supportIntervalMa"]["oldest"] = 430
        manifest["features"][0]["olderEdgePolicy"] = "uncertain-beyond-qualified-support"
        with self.assertRaises(AssertionError):
            self.validate(manifest=manifest)

    def test_exposed_land_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["surfaceEvidence"]["kind"] = "exposed-land"
        with self.assertRaises(AssertionError):
            self.validate(manifest=manifest)

    def test_source_geometry_mutation_is_rejected(self) -> None:
        geojson = copy.deepcopy(self.geojson)
        geojson["features"][0]["geometry"]["coordinates"][0][0][0][0] += 0.001
        with self.assertRaises(AssertionError):
            self.validate(geojson=geojson)

    def test_wrong_plate_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["plateId"] = 404
        with self.assertRaises(AssertionError):
            self.validate(manifest=manifest)

    def test_pose_confidence_boundary_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["poseConfidenceIntervalsMa"][0]["oldest"] = 429
        with self.assertRaises(AssertionError):
            self.validate(manifest=manifest)

    def test_delivered_geometry_metrics_mutation_is_rejected(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["features"][0]["geometryProcessing"]["deliveredVertexCount"] += 1
        with self.assertRaises(AssertionError):
            self.validate(manifest=manifest)

    def test_east_closed_boundary_identity_mutation_is_rejected(self) -> None:
        cohorts, _ = compiler.source_targets()
        policy = json.loads((compiler.OUT / "qualification-policy.json").read_text())
        original = compiler.EAST_COB_ID
        try:
            compiler.EAST_COB_ID = "GPlates-mutated-east-svalbard-boundary"
            with self.assertRaisesRegex(AssertionError, "East Svalbard closed"):
                compiler.derive_cob_geometry(cohorts[311], policy, 311)
        finally:
            compiler.EAST_COB_ID = original

    def test_outside_source_part_fails_area_gate(self) -> None:
        cohorts, _ = compiler.source_targets()
        policy = json.loads((compiler.OUT / "qualification-policy.json").read_text())
        outside = {
            "coordinates": [
                [
                    [29.9, 74.9],
                    [30.1, 74.9],
                    [30.1, 75.1],
                    [29.9, 75.1],
                    [29.9, 74.9],
                ]
            ],
            "sourceObjectId": -1,
            "sourcePartOrder": 0,
        }
        with self.assertRaises(AssertionError):
            compiler.derive_delivered_geometry(
                [outside], cohorts[309], cohorts[311], policy
            )


if __name__ == "__main__":
    unittest.main()

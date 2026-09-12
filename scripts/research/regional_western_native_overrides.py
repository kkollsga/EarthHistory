#!/usr/bin/env python3
"""Emit the reviewed native-chart replacement handoff for shared integration."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from cao_material_corrections import load_stage, target_catalog
import regional_western_compile as western
import regional_western_source450_audit as source450


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "data/corrections/western-laurentia/native-overrides.json"
TARGET_450 = source450.TARGET_PATCH_ID
TARGET_490 = western.PURCELL_PATCH


class OverrideError(ValueError):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    metadata, directions = load_stage()
    catalog = target_catalog(metadata, directions)
    specs = [
        {
            "overrideId": "western-source450-domain-fragment-replacement-v1",
            "correctionId": "earthhistory-regional-western-source450-native-v1",
            "patchId": TARGET_450,
            "asset": "western-source450-domain-tiles-v1.geojson",
            "sourceIds": ["usgs-ds898-basement-domains", "usgs-ofr2012-1228-redding-map", "cao-2024-v2.4"],
            "reason": "the East Klamath-labelled chart is a modern California basement mosaic; only 9.07% of its DS898-mapped basement predates 410 Ma, and the mapped Eastern Klamath terrane has zero overlap",
            "presentUnion": "exact native target in reference-coordinate topology",
        },
        {
            "overrideId": "western-source490-domain-fragment-replacement-v1",
            "correctionId": "earthhistory-regional-western-source490-native-v1",
            "patchId": TARGET_490,
            "asset": "western-source490-domain-tiles-v1.geojson",
            "sourceIds": ["usgs-ds898-basement-domains", "northern-cordillera-terranes", "cao-2024-v2.4-laurentia-acob", "cao-2024-v2.4"],
            "reason": "the Purcell-labelled chart includes large independently mapped post-410 US and Canadian terranes; the replacement retains the qualified old baseline and admits DS898 and Northern Cordillera domains by source age",
            "presentUnion": "native target within 0.001 km2 after removing six untriangulatable sub-100 m2 overlay slivers",
        },
    ]
    overrides = []
    for spec in specs:
        target = catalog[spec["patchId"]]
        asset_path = OUTPUT.parent / spec["asset"]
        native_target = {key: target[key] for key in (
            "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder",
            "geometrySha256", "plateId",
        )}
        native_target.update({
            "sourceCollection": "shapes_coasts.gpmlz",
            "sourceCollectionSha256": western.SOURCE_COLLECTION_SHA,
        })
        overrides.append({
            "overrideId": spec["overrideId"],
            "operation": "domain-fragment-replacement",
            "correctionId": spec["correctionId"],
            "nativeTarget": native_target,
            "nativeChart": {
                "chartId": spec["patchId"], "chartRevision": "cao-foundation-v1",
                "materialId": spec["patchId"], "fragmentOrCohortId": spec["patchId"],
            },
            "suppression": {"validTimeMa": {"youngest": 0.0, "oldest": 410.0}},
            "replacementAsset": {
                "path": spec["asset"], "bytes": asset_path.stat().st_size,
                "sha256": sha256(asset_path),
            },
            "replacementPolicy": {
                "materialOriginRange": "per-feature",
                "materialStatusIntervals": "per-feature",
                "pose": f"Cao plate {target['plateId']} partition motion, explicit model inference",
                "surfaceEvidence": "unknown",
                "presentUnion": spec["presentUnion"],
            },
            "sourceIds": spec["sourceIds"],
            "reason": spec["reason"],
        })
    output = {
        "schemaVersion": 1,
        "version": "1.0.0-candidate",
        "nativeChartOverrides": overrides,
    }
    validate(output, catalog)
    return output


def validate(output, catalog=None):
    if catalog is None:
        metadata, directions = load_stage()
        catalog = target_catalog(metadata, directions)
    rows = output.get("nativeChartOverrides", [])
    if output.get("schemaVersion") != 1 or len(rows) != 2:
        raise OverrideError("western native override set must contain exactly two records")
    if {row.get("nativeTarget", {}).get("patchId") for row in rows} != {TARGET_450, TARGET_490}:
        raise OverrideError("western native override target set changed")
    for row in rows:
        patch_id = row["nativeTarget"]["patchId"]
        target = catalog[patch_id]
        expected = {key: target[key] for key in (
            "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder",
            "geometrySha256", "plateId",
        )}
        expected.update({
            "sourceCollection": "shapes_coasts.gpmlz",
            "sourceCollectionSha256": western.SOURCE_COLLECTION_SHA,
        })
        if row["nativeTarget"] != expected:
            raise OverrideError(f"native target identity changed for {patch_id}")
        if row.get("operation") != "domain-fragment-replacement":
            raise OverrideError(f"unsupported override operation for {patch_id}")
        if row.get("suppression") != {"validTimeMa": {"youngest": 0.0, "oldest": 410.0}}:
            raise OverrideError(f"native suppression must cover the complete source lifecycle for {patch_id}")
        asset = row["replacementAsset"]
        path = OUTPUT.parent / asset["path"]
        if path.stat().st_size != asset["bytes"] or sha256(path) != asset["sha256"]:
            raise OverrideError(f"replacement asset changed for {patch_id}")
        data = json.loads(path.read_text())
        for feature in data.get("features", []):
            properties = feature.get("properties", {})
            if (properties.get("targetPatchId") != patch_id
                    or properties.get("surfaceEvidence") != "unknown"
                    or "materialOriginRangeMa" not in properties
                    or "materialStatusIntervalsMa" not in properties
                    or "geometryLifecycleMa" not in properties):
                raise OverrideError(f"replacement feature contract changed for {patch_id}")
    return output


def main():
    output = build()
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"overrides": len(output["nativeChartOverrides"])}, sort_keys=True))


if __name__ == "__main__":
    main()

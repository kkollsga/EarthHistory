#!/usr/bin/env python3
"""Validate source-qualified material charts and guarded replacements for Cao v2.4."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
CORRECTIONS = ROOT / "data/corrections"
TRACKED_TARGETS = CORRECTIONS / "cao-v2.4-targets.json"
SOURCE_COLLECTION = "shapes_coasts.gpmlz"
SOURCE_SHA256 = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
SHA256 = re.compile(r"^[a-f0-9]{64}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$")
FRAME = {
    "absoluteFrameId": "palaeomagnetic",
    "anchorPlateId": 0,
    "axisConvention": "gplates-x0e-y90e-znorth",
    "rotationSha256": "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f",
    "topologySha256": "3a3021b8d60bbcff64ce4018198a5693ddc018de7a5a8b3c30c33a48d51c044c",
}
TOPOLOGY_SOURCES = [
    {"path": "250-0_plate_boundaries.gpml", "sha256": "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4"},
    {"path": "410-250_plate_boundaries.gpml", "sha256": "6516dbac4d7928e7ad71244b0bbabc65eb25e6e89dc79d4becb9a82a25a6fc91"},
    {"path": "1000-410_plate_boundaries.gpml", "sha256": "488e4b6330e2586fc363a1ad8dada659ac1409742846186fc275a213db306fb1"},
    {"path": "1800-1000_plate_boundaries.gpml", "sha256": "759a76605bc907197928214f4101403dd6221e7ba8d4ecacde57999bc3675dce"},
    {"path": "TopologyBuildingBlocks.gpml", "sha256": "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297"},
]
GEOMETRY_HASH_DOMAIN = b"earthhistory-cao-staged-geometry-f32le-xyz-rings-v1\0"


class CorrectionError(ValueError):
    pass


def fail(path: str, message: str) -> None:
    raise CorrectionError(f"{path}: {message}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lon_lat_direction(position: list[float]) -> tuple[float, float, float]:
    longitude, latitude = map(math.radians, position)
    radius = math.cos(latitude)
    return radius * math.cos(longitude), radius * math.sin(longitude), math.sin(latitude)


def angular_degrees(left: list[float] | tuple[float, ...],
                    right: list[float] | tuple[float, ...]) -> float:
    dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(left, right))))
    return math.degrees(math.acos(dot))


def require_dict(value, path: str) -> dict:
    if not isinstance(value, dict):
        fail(path, "must be an object")
    return value


def require_list(value, path: str) -> list:
    if not isinstance(value, list) or not value:
        fail(path, "must be a nonempty array")
    return value


def require_string(value, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(path, "must be a nonempty string")
    return value


def require_sha(value, path: str) -> str:
    value = require_string(value, path)
    if not SHA256.fullmatch(value):
        fail(path, "must be a lowercase SHA-256")
    return value


def require_age(value, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(path, "must be a finite age")
    if value < 0 or value > 1_800:
        fail(path, "is outside 0-1800 Ma")
    return float(value)


def feature_phase_intervals(feature: dict, path: str) -> list[tuple[str, float, float]]:
    """Return display phases while keeping material support separate from pose confidence."""
    replacement = feature.get("replacementPhaseLifecycles")
    if replacement is not None:
        rows = []
        for phase in ("qualified", "uncertain", "model-pose", "formation"):
            lifecycle = replacement.get(phase)
            if lifecycle is None:
                continue
            valid = require_dict(lifecycle, f"{path}.replacementPhaseLifecycles.{phase}").get("validTimeMa")
            valid = require_dict(valid, f"{path}.replacementPhaseLifecycles.{phase}.validTimeMa")
            youngest = require_age(valid.get("youngest"), f"{path}.replacementPhaseLifecycles.{phase}.youngest")
            oldest = require_age(valid.get("oldest"), f"{path}.replacementPhaseLifecycles.{phase}.oldest")
            if oldest < youngest:
                fail(f"{path}.replacementPhaseLifecycles.{phase}", "has reversed bounds")
            if phase == "formation" and lifecycle.get("youngestExclusive") is not True:
                fail(f"{path}.replacementPhaseLifecycles.{phase}",
                     "formation uncertainty must exclude its younger supported boundary")
            rows.append((phase, youngest, oldest))
        if not rows:
            fail(f"{path}.replacementPhaseLifecycles", "must contain a display interval")
        return rows
    support = feature["supportIntervalMa"]
    declared = feature.get("poseConfidenceIntervalsMa")
    if declared is None:
        phases = [("qualified", support["youngest"], support["oldest"])]
        if support["oldest"] < 540:
            phases.append(("uncertain", support["oldest"], 540))
        return phases
    intervals = require_list(declared, f"{path}.poseConfidenceIntervalsMa")
    if len(intervals) != 2:
        fail(f"{path}.poseConfidenceIntervalsMa", "must contain one qualified and one uncertain interval")
    expected_statuses = ("qualified", "uncertain-continuation")
    parsed = []
    for index, (item_raw, status) in enumerate(zip(intervals, expected_statuses)):
        item = require_dict(item_raw, f"{path}.poseConfidenceIntervalsMa[{index}]")
        youngest = require_age(item.get("youngest"), f"{path}.poseConfidenceIntervalsMa[{index}].youngest")
        oldest = require_age(item.get("oldest"), f"{path}.poseConfidenceIntervalsMa[{index}].oldest")
        if item.get("status") != status or item.get("youngestExclusive") is not True or oldest <= youngest:
            fail(f"{path}.poseConfidenceIntervalsMa[{index}]", "has invalid status or bounds")
        parsed.append(("qualified" if index == 0 else "uncertain", youngest, oldest))
    if (parsed[0][1] != support["youngest"] or parsed[0][2] != parsed[1][1]
            or parsed[1][2] != support["oldest"]):
        fail(f"{path}.poseConfidenceIntervalsMa", "must partition the complete material-support interval")
    display = require_dict(feature.get("uncertaintyDisplay"), f"{path}.uncertaintyDisplay")
    if display != {"olderThanMa": parsed[0][2], "style": "uncertain"}:
        fail(f"{path}.uncertaintyDisplay", "must identify the pose-confidence transition")
    return parsed


def load_stage() -> tuple[dict, bytes]:
    source_path = MODEL / SOURCE_COLLECTION
    if not source_path.is_file() or sha256(source_path) != SOURCE_SHA256:
        fail("baseline.sourceSha256", "pinned Cao coastline source is missing or changed")
    metadata = json.loads((STAGE / "coast-patches.json").read_text())
    directions = (STAGE / "coast-reference-directions.f32").read_bytes()
    if metadata.get("geometry", {}).get("directions", {}).get("sha256") != hashlib.sha256(directions).hexdigest():
        fail("stage.geometry", "staged Cao directions do not match their catalog")
    return metadata, directions


def staged_geometry_hash(patch: dict, directions: bytes) -> str:
    digest = hashlib.sha256(GEOMETRY_HASH_DOMAIN)
    for ring in patch["rings"]:
        count = ring["count"]
        start = ring["offset"] * 12
        end = start + count * 12
        if count < 3 or start < 0 or end > len(directions):
            fail(patch["patchId"], "invalid staged ring range")
        digest.update(struct.pack("<I", count))
        digest.update(directions[start:end])
    return digest.hexdigest()


def target_catalog(metadata: dict, directions: bytes) -> dict[str, dict]:
    catalog = {}
    for patch in metadata["patches"]:
        source_id = patch["sourceFeatureIds"][0]
        try:
            prefix, feature_order, geometry_order = patch["patchId"].rsplit(":", 2)
        except ValueError:
            fail(patch.get("patchId", "stage.patch"), "cannot parse source orders")
        if not prefix.endswith(source_id):
            fail(patch["patchId"], "patch ID and feature ID disagree")
        catalog[patch["patchId"]] = {
            "patchId": patch["patchId"],
            "sourceFeatureId": source_id,
            "sourceFeatureOrder": int(feature_order),
            "geometryOrder": int(geometry_order),
            "plateId": patch["plateId"],
            "geometrySha256": staged_geometry_hash(patch, directions),
            "originalValidTimeMa": {
                "youngest": patch["lifecycle"]["youngestAgeMa"],
                "oldest": patch["lifecycle"]["oldestAgeMa"],
            },
            "sourceName": patch["sourceName"],
            "sourceAreaSteradians": patch["sourceAreaSteradians"],
        }
    return catalog


def load_tracked_targets() -> dict[str, dict]:
    try:
        data = json.loads(TRACKED_TARGETS.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(str(TRACKED_TARGETS.relative_to(ROOT)), f"cannot read target witness catalog: {error}")
    if (data.get("schemaVersion") != 2 or data.get("sourceCollection") != SOURCE_COLLECTION
            or data.get("sourceSha256") != SOURCE_SHA256
            or data.get("coordinateFrame") != FRAME
            or data.get("topologySources") != TOPOLOGY_SOURCES
            or data.get("geometryHashEncoding") != GEOMETRY_HASH_DOMAIN[:-1].decode()):
        fail(str(TRACKED_TARGETS.relative_to(ROOT)), "invalid Cao target witness authority")
    rows = require_list(data.get("targets"), "cao-v2.4-targets.targets")
    catalog = {require_string(row.get("patchId"), "cao-v2.4-targets.targets[].patchId"): row for row in rows}
    if len(catalog) != len(rows):
        fail("cao-v2.4-targets.targets", "contains duplicate patch IDs")
    return catalog


def exact_json_equal(left, right) -> bool:
    return json.dumps(left, sort_keys=True, separators=(",", ":")) == json.dumps(
        right, sort_keys=True, separators=(",", ":")
    )


def validate_geojson(path: Path, expected_sha: str, feature_id: str, label: str) -> None:
    if not path.is_file():
        fail(label, f"asset missing: {path}")
    if sha256(path) != expected_sha:
        fail(label, "asset SHA-256 mismatch")
    try:
        data = json.loads(path.read_text())
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(label, f"invalid GeoJSON: {error}")
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        fail(label, "must be a GeoJSON FeatureCollection")
    matches = [feature for feature in data["features"] if
               str(feature.get("id", feature.get("properties", {}).get("correctionFeatureId"))) == feature_id]
    if len(matches) != 1:
        fail(label, f"expected exactly one GeoJSON feature {feature_id!r}")
    geometry = matches[0].get("geometry", {})
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        fail(label, "correction geometry must be Polygon or MultiPolygon")
    polygons = [geometry.get("coordinates")] if geometry.get("type") == "Polygon" else geometry.get("coordinates")
    if not isinstance(polygons, list) or not polygons:
        fail(label, "geometry has no polygons")
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            fail(label, "polygon has no rings")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                fail(label, "rings must be closed and contain at least four positions")
            for position in ring:
                if (not isinstance(position, list) or len(position) < 2
                        or any(isinstance(value, bool) or not isinstance(value, (int, float))
                               or not math.isfinite(value) for value in position[:2])
                        or not -180 <= position[0] <= 180 or not -90 <= position[1] <= 90):
                    fail(label, "invalid WGS84 lon/lat position")


def validate_manifest(path: Path, targets: dict[str, dict], seen_targets: dict[tuple, str]) -> dict:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(str(path), f"cannot read manifest: {error}")
    base = str(path.relative_to(ROOT))
    if manifest.get("schemaVersion") != 1:
        fail(f"{base}.schemaVersion", "must equal 1")
    require_string(manifest.get("correctionId"), f"{base}.correctionId")
    version = manifest.get("version")
    if not ((isinstance(version, str) and version.strip())
            or (isinstance(version, int) and not isinstance(version, bool) and version > 0)):
        fail(f"{base}.version", "must be a nonempty string or positive integer")
    baseline = require_dict(manifest.get("baseline"), f"{base}.baseline")
    expected_baseline = {
        "modelId": "cao-et-al-2024",
        "modelVersion": "2.4",
        "sourceCollection": SOURCE_COLLECTION,
        "sourceSha256": SOURCE_SHA256,
        "coordinateFrame": FRAME,
    }
    if not exact_json_equal(baseline, expected_baseline):
        fail(f"{base}.baseline", "does not exactly identify the pinned Cao source and frame")
    source_ids = set()
    for index, raw in enumerate(require_list(manifest.get("sourceAssets"), f"{base}.sourceAssets")):
        source = require_dict(raw, f"{base}.sourceAssets[{index}]")
        source_id = require_string(source.get("sourceId"), f"{base}.sourceAssets[{index}].sourceId")
        if source_id in source_ids:
            fail(f"{base}.sourceAssets[{index}].sourceId", "is duplicated")
        source_ids.add(source_id)
        url = require_string(source.get("url"), f"{base}.sourceAssets[{index}].url")
        if urlparse(url).scheme not in {"http", "https"}:
            fail(f"{base}.sourceAssets[{index}].url", "must be HTTP(S)")
        for field in ("citation", "publicationOrVersionDate", "license", "attribution"):
            require_string(source.get(field), f"{base}.sourceAssets[{index}].{field}")
        retrieved = require_string(source.get("retrievedAt"), f"{base}.sourceAssets[{index}].retrievedAt")
        if not DATE.fullmatch(retrieved):
            fail(f"{base}.sourceAssets[{index}].retrievedAt", "must be an ISO UTC date")
        role = source.get("evidenceRole")
        if role not in {"continental-or-crustal-extent", "geological-unit-extent", "material-affinity"}:
            fail(f"{base}.sourceAssets[{index}].evidenceRole",
                 "must independently evidence crust/material; plate topology is not accepted")
        size = source.get("bytes")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            fail(f"{base}.sourceAssets[{index}].bytes", "must record the acquired source byte count")
        source_sha = require_sha(source.get("sha256"), f"{base}.sourceAssets[{index}].sha256")
        if "path" in source:
            local = (path.parent / require_string(source.get("path"), f"{base}.sourceAssets[{index}].path")).resolve()
            try:
                local.relative_to(path.parent.resolve())
            except ValueError:
                fail(f"{base}.sourceAssets[{index}].path", "must remain inside the regional correction directory")
            if not local.is_file() or local.stat().st_size != size:
                fail(f"{base}.sourceAssets[{index}].bytes", "does not match the local source asset")
            if sha256(local) != source_sha:
                fail(f"{base}.sourceAssets[{index}].sha256", "does not match the local source asset")

    feature_ids = set()
    for index, raw in enumerate(require_list(manifest.get("features"), f"{base}.features")):
        feature = require_dict(raw, f"{base}.features[{index}]")
        label = f"{base}.features[{index}]"
        feature_id = require_string(feature.get("correctionFeatureId"), f"{label}.correctionFeatureId")
        if feature_id in feature_ids:
            fail(f"{label}.correctionFeatureId", "is duplicated")
        feature_ids.add(feature_id)
        exact_targets = []
        endpoint = None
        for target_index, raw_target in enumerate(require_list(feature.get("targets"), f"{label}.targets")):
            target = require_dict(raw_target, f"{label}.targets[{target_index}]")
            patch_id = require_string(target.get("patchId"), f"{label}.targets[{target_index}].patchId")
            expected = targets.get(patch_id)
            if expected is None:
                fail(f"{label}.targets[{target_index}]", "does not address a staged Cao polygon")
            identity = {key: target.get(key) for key in (
                "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder", "plateId",
                "geometrySha256", "originalValidTimeMa", "expectedMatches")}
            expected_identity = {key: expected[key] for key in (
                "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder", "plateId",
                "geometrySha256", "originalValidTimeMa")}
            expected_identity["expectedMatches"] = 1
            if not exact_json_equal(identity, expected_identity):
                fail(f"{label}.targets[{target_index}]", "does not exactly match the pinned staged Cao geometry")
            key = tuple(identity[name] if name != "originalValidTimeMa" else
                        json.dumps(identity[name], sort_keys=True) for name in identity)
            owner = seen_targets.get(key)
            if owner is not None and owner != manifest["correctionId"]:
                fail(f"{label}.targets[{target_index}]", "duplicates a target in another correction operation")
            seen_targets[key] = manifest["correctionId"]
            exact_targets.append(expected)
            oldest = expected["originalValidTimeMa"]["oldest"]
            if oldest is None:
                fail(f"{label}.targets[{target_index}]", "cannot continue an unbounded native target")
            endpoint = oldest if endpoint is None else endpoint
            if oldest != endpoint:
                fail(f"{label}.targets", "all targets must share one native oldest endpoint")

        geometry = require_dict(feature.get("geometryAsset"), f"{label}.geometryAsset")
        geometry_path = (path.parent / require_string(geometry.get("path"), f"{label}.geometryAsset.path")).resolve()
        try:
            geometry_path.relative_to(path.parent.resolve())
        except ValueError:
            fail(f"{label}.geometryAsset.path", "must remain inside the regional correction directory")
        geometry_sha = require_sha(geometry.get("sha256"), f"{label}.geometryAsset.sha256")
        geo_feature_id = require_string(geometry.get("featureId"), f"{label}.geometryAsset.featureId")
        if geo_feature_id != feature_id:
            fail(f"{label}.geometryAsset.featureId", "must equal correctionFeatureId")
        validate_geojson(geometry_path, geometry_sha, geo_feature_id, f"{label}.geometryAsset")
        coordinate_frame = feature.get("coordinateFrame")
        reference_age = require_age(feature.get("geometryReferenceAgeMa"), f"{label}.geometryReferenceAgeMa")
        if not ((coordinate_frame == "WGS84-reference-coordinates" and reference_age == 0)
                or (coordinate_frame == "cao-v2.4-reconstructed-palaeomagnetic" and reference_age == endpoint)):
            fail(f"{label}.coordinateFrame",
                 "must identify either present-day WGS84 or a Cao-reconstructed native-endpoint basis")
        pose = require_dict(feature.get("pose"), f"{label}.pose")
        if not isinstance(pose.get("plateId"), int) or isinstance(pose.get("plateId"), bool):
            fail(f"{label}.pose.plateId", "must be an integer")
        if pose.get("method") not in {"cao-rigid-plate-motion", "regional-model-hypothesis"}:
            fail(f"{label}.pose.method", "must name the motion authority")
        require_string(pose.get("sourceOrHypothesis"), f"{label}.pose.sourceOrHypothesis")
        if reference_age != 0:
            basis = require_dict(feature.get("sourceBasis"), f"{label}.sourceBasis")
            if (basis.get("kind") != "reconstructed-target-union"
                    or basis.get("normalization") != "qPose(0)*inverse(qPose(referenceAge))*dReference"):
                fail(f"{label}.sourceBasis", "must declare the reference-age normalization transform")
            plate_ids = require_list(basis.get("targetPlateIds"), f"{label}.sourceBasis.targetPlateIds")
            if any(not isinstance(value, int) or isinstance(value, bool) for value in plate_ids):
                fail(f"{label}.sourceBasis.targetPlateIds", "must contain integer Cao plate IDs")
            witnesses = require_list(pose.get("alignmentWitnesses"), f"{label}.pose.alignmentWitnesses")
            for witness_index, witness in enumerate(witnesses):
                item = require_dict(witness, f"{label}.pose.alignmentWitnesses[{witness_index}]")
                require_string(item.get("witnessId"), f"{label}.pose.alignmentWitnesses[{witness_index}].witnessId")
                lon_lat = item.get("referenceLonLat")
                if (not isinstance(lon_lat, list) or len(lon_lat) != 2
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                               for v in lon_lat)
                        or not -180 <= lon_lat[0] <= 180 or not -90 <= lon_lat[1] <= 90):
                    fail(f"{label}.pose.alignmentWitnesses[{witness_index}].referenceLonLat",
                         "must be a finite lon/lat in the reference-age geometry")
                comparisons = require_list(item.get("olderPoseComparisons"),
                                           f"{label}.pose.alignmentWitnesses[{witness_index}].olderPoseComparisons")
                at_411 = [comparison for comparison in comparisons if comparison.get("ageMa") == 411]
                if len(at_411) != 1 or at_411[0].get("counterfactualCaoPlateId") not in plate_ids:
                    fail(f"{label}.pose.alignmentWitnesses[{witness_index}].olderPoseComparisons",
                         "must contain one independently computed 411 Ma target-plate witness")
                expected_lon_lat = at_411[0].get("expectedLonLat")
                if (not isinstance(expected_lon_lat, list) or len(expected_lon_lat) != 2
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                               for v in expected_lon_lat)
                        or not -180 <= expected_lon_lat[0] <= 180 or not -90 <= expected_lon_lat[1] <= 90):
                    fail(f"{label}.pose.alignmentWitnesses[{witness_index}].olderPoseComparisons",
                         "411 Ma witness must carry an independent expected lon/lat")
        if feature.get("materialRole") != "continental-material-support":
            fail(f"{label}.materialRole", "must be continental-material-support")
        support = require_dict(feature.get("supportIntervalMa"), f"{label}.supportIntervalMa")
        youngest = require_age(support.get("youngest"), f"{label}.supportIntervalMa.youngest")
        oldest = require_age(support.get("oldest"), f"{label}.supportIntervalMa.oldest")
        if youngest != endpoint or support.get("youngestExclusive") is not True or oldest <= youngest or oldest > 540:
            fail(f"{label}.supportIntervalMa",
                 "must start strictly older than the inclusive native endpoint and end by 540 Ma")
        edge_policy = feature.get("olderEdgePolicy")
        if ((oldest < 540 and edge_policy != "uncertain-beyond-qualified-support")
                or (oldest == 540 and edge_policy != "qualified-through-product-oldest-age")):
            fail(f"{label}.olderEdgePolicy",
                 "must continue uncertain material to 540 Ma or qualify material through 540 Ma")
        feature_phase_intervals(feature, label)
        selection = require_dict(feature.get("sourceUnitSelection"), f"{label}.sourceUnitSelection")
        for group in ("included", "excluded"):
            units = selection.get(group)
            if not isinstance(units, list):
                fail(f"{label}.sourceUnitSelection.{group}", "must be an array")
            for unit_index, unit in enumerate(units):
                item = require_dict(unit, f"{label}.sourceUnitSelection.{group}[{unit_index}]")
                if not any(item.get(field) is not None for field in ("unitId", "geoCode", "agePeriod", "count")):
                    fail(f"{label}.sourceUnitSelection.{group}[{unit_index}]", "must identify an included/excluded source class")
                require_string(item.get("reason"), f"{label}.sourceUnitSelection.{group}[{unit_index}].reason")
        references = require_list(feature.get("sourceIds"), f"{label}.sourceIds")
        if not any(reference in source_ids for reference in references):
            fail(f"{label}.sourceIds", "must cite at least one declared source asset")
        surface = require_dict(feature.get("surfaceEvidence"), f"{label}.surfaceEvidence")
        if (feature.get("epistemicStatus") != "model-inference" or surface.get("kind") != "unknown"
                or not isinstance(surface.get("reason"), str) or not surface["reason"].strip()):
            fail(label, "must declare model-inference and unknown surface evidence")
        uncertainty = require_dict(feature.get("uncertainty"), f"{label}.uncertainty")
        for field in ("spatial", "temporal", "exposure"):
            require_string(uncertainty.get(field), f"{label}.uncertainty.{field}")
        for condition_index, condition in enumerate(require_list(
                feature.get("rejectionConditions"), f"{label}.rejectionConditions")):
            require_string(condition, f"{label}.rejectionConditions[{condition_index}]")
    return manifest


def validate_native_layer_evidence(core: dict) -> None:
    """Keep source-collection labels aligned with each native Cao chart layer."""
    expected = {
        "cao-coast:": (
            "Cao coastline-class model geometry is not observed exposed land",
            "native Cao coastline-class geometry; exposed-land and height evidence unavailable",
        ),
        "cao-continent:": (
            "Cao continental-outline model geometry is not observed exposed land",
            "native Cao continental-outline geometry; exposed-land and height evidence unavailable",
        ),
    }
    counts = {prefix: 0 for prefix in expected}
    for chart in core.get("charts", []):
        prefix = next((candidate for candidate in expected if chart.get("chartId", "").startswith(candidate)), None)
        if prefix is None:
            continue
        counts[prefix] += 1
        limitation, reason = expected[prefix]
        if (limitation not in chart.get("evidence", {}).get("limitations", [])
                or chart.get("surfaceEvidence", {}).get("reason") != reason):
            fail(chart.get("chartId", "native Cao chart"),
                 "source-collection layer and evidence label disagree")
    if any(count == 0 for count in counts.values()):
        fail("public Cao core", "must contain both coastline and continental-outline source layers")


def validate_chart_binding_partition(chart: dict) -> None:
    life = chart.get("lifecycle", {}).get("validTimeMa", {})
    youngest, oldest = life.get("youngest"), life.get("oldest")
    bindings = sorted(chart.get("motionBindings", []), key=lambda binding: (
        binding.get("validTimeMa", {}).get("youngest", math.inf),
        binding.get("validTimeMa", {}).get("oldest", math.inf),
    ))
    if not isinstance(youngest, (int, float)) or not isinstance(oldest, (int, float)) or not bindings:
        fail(chart.get("chartId", "correction chart"), "has no valid motion-binding partition")
    if youngest == oldest:
        interval = bindings[0].get("validTimeMa", {})
        if len(bindings) != 1 or interval != {"youngest": youngest, "oldest": oldest}:
            fail(chart.get("chartId", "correction chart"),
                 "instantaneous motion binding must equal the chart lifecycle")
        return
    cursor = youngest
    for binding in bindings:
        interval = binding.get("validTimeMa", {})
        if interval.get("youngest") != cursor or not isinstance(interval.get("oldest"), (int, float)) \
                or interval["oldest"] <= cursor:
            fail(chart.get("chartId", "correction chart"),
                 "motion bindings must form one exact contiguous, non-overlapping partition")
        cursor = interval["oldest"]
    if cursor != oldest:
        fail(chart.get("chartId", "correction chart"),
             "motion bindings must cover the complete chart lifecycle")


def validate_generated_catalog(manifests: list[dict]) -> None:
    package_path = ROOT / "public/data/reconstruction/cao-v2.4/manifest.json"
    package = json.loads(package_path.read_text())
    core_path = package_path.parent / require_string(package.get("core", {}).get("url"),
                                                     "public Cao manifest.core.url")
    if (not core_path.is_file() or core_path.stat().st_size != package["core"].get("bytes")
            or sha256(core_path) != package["core"].get("sha256")):
        fail("public Cao manifest.core", "core asset identity mismatch")
    validate_native_layer_evidence(json.loads(core_path.read_text()))
    descriptor = require_dict(package.get("materialCorrections"), "public Cao manifest.materialCorrections")
    catalog_path = package_path.parent / require_string(descriptor.get("catalog", {}).get("url"),
                                                        "materialCorrections.catalog.url")
    catalog_asset = descriptor["catalog"]
    if (not catalog_path.is_file() or catalog_path.stat().st_size != catalog_asset.get("bytes")
            or sha256(catalog_path) != catalog_asset.get("sha256")):
        fail("public Cao manifest.materialCorrections", "catalog asset identity mismatch")
    catalog = json.loads(catalog_path.read_text())
    raw_overrides = []
    for override_path in sorted(CORRECTIONS.glob("*/native-overrides.json")):
        document = json.loads(override_path.read_text())
        for row in document.get("nativeChartOverrides", []):
            raw_overrides.append((override_path, row))
    expected_ids = sorted({*(manifest["correctionId"] for manifest in manifests),
                           *(row["correctionId"] for _, row in raw_overrides)})
    if catalog.get("schemaVersion") != 1 or catalog.get("id") != descriptor.get("id") \
            or catalog.get("correctionIds") != expected_ids:
        fail("material correction catalog", "regional correction identity set mismatch")
    if catalog.get("baseline") != {
        "packageId": package["packageId"], "revision": package["revision"],
        "coreSha256": package["core"]["sha256"], "motionPaletteId": package["motionPalette"]["id"],
        "frame": package["frame"],
    }:
        fail("material correction catalog.baseline", "does not match the immutable public base package")
    charts = {chart["chartId"]: chart for chart in catalog.get("charts", [])}
    for chart in charts.values():
        validate_chart_binding_partition(chart)
    expected_chart_ids = set()
    expected_witness_ids = set()
    for manifest in manifests:
        for feature in manifest["features"]:
            for suffix, youngest, oldest in feature_phase_intervals(feature, feature["correctionFeatureId"]):
                phase = ("source-qualified-material" if suffix == "qualified" else
                         "formation-uncertain" if suffix == "formation" else "uncertain-continuation")
                chart_id = f"correction:{manifest['correctionId']}:{feature['correctionFeatureId']}:{suffix}"
                expected_chart_ids.add(chart_id)
                chart = charts.get(chart_id)
                expected_lifecycle = {"validTimeMa": {"youngest": youngest, "oldest": oldest}}
                expected_lifecycle["youngestExclusive"] = True
                expected_correction = {"correctionId": manifest["correctionId"], "phase": phase}
                if (not chart or chart.get("lifecycle") != expected_lifecycle
                        or chart.get("evidence", {}).get("correction") != expected_correction
                        or chart.get("surfaceEvidence", {}).get("kind") != "unknown"
                        or chart.get("geometryReferenceAgeMa") != 0
                        or sorted(chart.get("sourceFeatureIds", [])) !=
                            sorted(target["sourceFeatureId"] for target in feature["targets"])):
                    fail(chart_id, "generated support phase does not match its validated regional source record")
            if feature["geometryReferenceAgeMa"] != 0:
                qualified_chart_id = f"correction:{manifest['correctionId']}:{feature['correctionFeatureId']}:qualified"
                for source_witness in feature["pose"]["alignmentWitnesses"]:
                    witness_id = source_witness["witnessId"]
                    expected_witness_ids.add(witness_id)
                    rows = [row for row in catalog.get("alignmentWitnesses", [])
                            if row.get("witnessId") == witness_id]
                    expected_411 = next(row for row in source_witness["olderPoseComparisons"]
                                        if row["ageMa"] == 411)
                    if len(rows) != 1:
                        fail(witness_id, "generated catalog must contain exactly one alignment witness")
                    witness = rows[0]
                    if (witness.get("correctionId") != manifest["correctionId"]
                            or witness.get("chartId") != qualified_chart_id
                            or witness.get("referenceLonLat") != source_witness["referenceLonLat"]
                            or witness.get("oracle") != "tracked-pygplates-target-plate-witness"
                            or witness.get("targetPlateId") != expected_411["counterfactualCaoPlateId"]
                            or witness.get("posePlateId") != feature["pose"]["plateId"]
                            or witness.get("normalizationAngularDegrees", 0) < 1
                            or witness.get("targetPoseResidualAt411Degrees", math.inf) > 1e-5
                            or witness.get("paletteTargetResidualAt411Degrees", math.inf) > 1e-5
                            or angular_degrees(witness.get("expectedDirectionAt411Ma", []),
                                               lon_lat_direction(expected_411["expectedLonLat"])) > 1e-5):
                        fail(witness_id, "generated pose does not match its independent pyGPlates witness")
    emitted_overrides = {row.get("overrideId"): row for row in catalog.get("nativeChartOverrides", [])}
    if len(emitted_overrides) != len(raw_overrides):
        fail("material correction catalog.nativeChartOverrides", "override identity set mismatch")
    targets = load_tracked_targets()
    for override_path, raw in raw_overrides:
        emitted = emitted_overrides.get(raw.get("overrideId"))
        target = raw.get("nativeTarget", {})
        expected_target = targets.get(target.get("patchId"))
        replacement = raw.get("replacementAsset", {})
        replacement_path = override_path.parent / replacement.get("path", "")
        if (not emitted or expected_target is None
                or any(target.get(key) != expected_target.get(key) for key in (
                    "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder", "plateId",
                    "geometrySha256"))
                or emitted.get("nativeTarget") != target
                or emitted.get("nativeChart") != raw.get("nativeChart")
                or emitted.get("suppression") != raw.get("suppression")
                or emitted.get("sourceIds") != raw.get("sourceIds")
                or not replacement_path.is_file()
                or replacement_path.stat().st_size != replacement.get("bytes")
                or sha256(replacement_path) != replacement.get("sha256")
                or emitted.get("replacementAssetSha256") != replacement.get("sha256")
                or emitted.get("dependentConsumers", {}).get("countryReferences")
                    != "spatial-segment-remap"
                or not emitted.get("dependentConsumers", {}).get("sourceCountryChartIds")
                or emitted.get("dependentConsumers", {}).get("maximumSegmentSampleDegrees") != 0.1
                or emitted.get("dependentConsumers", {}).get("maximumDomainMatchKm") != 12
                or emitted.get("dependentConsumers", {}).get("expectedSourceSegmentCount", 0) < 1
                or len(emitted.get("dependentConsumers", {}).get("countrySegmentBindings", []))
                    != emitted.get("dependentConsumers", {}).get("expectedSourceSegmentCount")
                or emitted.get("dependentConsumers", {}).get("anchors") != "require-none"):
            fail(raw.get("overrideId", str(override_path)), "generated native override changed source contract")
        replacement_ids = emitted.get("replacementChartIds", [])
        if not replacement_ids:
            fail(raw["overrideId"], "native override replacement charts are missing")
        expected_chart_ids.update(replacement_ids)
        for chart_id in replacement_ids:
            replacement_chart = charts.get(chart_id)
            if (not replacement_chart
                    or replacement_chart.get("sourceFeatureTypes") != ["EarthHistoryDomainFragmentReplacement"]
                    or replacement_chart.get("evidence", {}).get("correction", {}).get("correctionId")
                        != raw["correctionId"]):
                fail(chart_id, "generated domain-fragment chart changed override ownership")
    if set(charts) != expected_chart_ids:
        fail("material correction catalog.charts", "contains missing or untracked derived charts")
    if {row.get("witnessId") for row in catalog.get("alignmentWitnesses", [])} != expected_witness_ids:
        fail("material correction catalog.alignmentWitnesses", "contains missing or untracked witnesses")
    for batch in require_list(catalog.get("spatialBatches"), "material correction catalog.spatialBatches"):
        if batch.get("staticDisplayControl", {}).get("displayHeightMetres") != 0:
            fail(batch.get("batchId", "correction batch"), "physical display height must remain unknown/zero")
        if batch.get("overlapPolicy") != "native-visual-and-picking-precedence":
            fail(batch.get("batchId", "correction batch"), "native visual and picking precedence is required")
        geometry = batch.get("geometryAsset", {})
        geometry_path = package_path.parent / require_string(geometry.get("url"), "correction geometry.url")
        if (not geometry_path.is_file() or geometry_path.stat().st_size != geometry.get("bytes")
                or sha256(geometry_path) != geometry.get("sha256") or geometry_path.stat().st_size >= 8 * 1024 * 1024):
            fail(batch.get("batchId", "correction batch"), "geometry asset identity or size bound failed")


def validate_all(paths: list[Path] | None = None, *, validate_runtime: bool = True) -> list[dict]:
    targets = load_tracked_targets()
    selected = paths if paths is not None else sorted(CORRECTIONS.glob("*/manifest.json"))
    if not selected:
        fail("data/corrections", "no regional correction manifests found")
    seen_targets: dict[tuple, str] = {}
    manifests = [validate_manifest(path.resolve(), targets, seen_targets) for path in selected]
    ids = [manifest["correctionId"] for manifest in manifests]
    if len(ids) != len(set(ids)):
        fail("data/corrections", "correctionId is duplicated")
    if validate_runtime:
        validate_generated_catalog(manifests)
    return manifests


def self_test() -> None:
    """Prove the tracked-input validator rejects representative scientific-contract mutations."""
    targets = load_tracked_targets()
    source_path = sorted(CORRECTIONS.glob("*/manifest.json"))[0]
    source = json.loads(source_path.read_text())
    cases = {
        "target identity": lambda value: value["features"][0]["targets"][0].update(
            {"geometrySha256": "0" * 64}),
        "coordinate frame": lambda value: value["baseline"]["coordinateFrame"].update(
            {"rotationSha256": "0" * 64}),
        "exclusive age boundary": lambda value: value["features"][0]["supportIntervalMa"].update(
            {"youngestExclusive": False}),
        "source-unit selection": lambda value: value["features"][0]["sourceUnitSelection"]["included"][0].update(
            {"reason": ""}),
    }
    scratch_root = ROOT / "dev-docs/temp"
    scratch_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="correction-contract-", dir=scratch_root) as temporary:
        folder = Path(temporary)
        geometry_name = source["features"][0]["geometryAsset"]["path"]
        (folder / geometry_name).write_bytes((source_path.parent / geometry_name).read_bytes())
        for label, mutate in cases.items():
            candidate = deepcopy(source)
            mutate(candidate)
            path = folder / f"{label.replace(' ', '-')}.json"
            path.write_text(json.dumps(candidate))
            try:
                validate_manifest(path, targets, {})
            except CorrectionError:
                continue
            fail("self-test", f"{label} mutation was accepted")
    package_path = ROOT / "public/data/reconstruction/cao-v2.4/manifest.json"
    package = json.loads(package_path.read_text())
    core = json.loads((package_path.parent / package["core"]["url"]).read_text())
    validate_native_layer_evidence(core)
    mutated = deepcopy(core)
    coast = next(chart for chart in mutated["charts"] if chart["chartId"].startswith("cao-coast:"))
    coast["surfaceEvidence"]["reason"] = (
        "native Cao continental-outline geometry; exposed-land and height evidence unavailable"
    )
    try:
        validate_native_layer_evidence(mutated)
    except CorrectionError:
        pass
    else:
        fail("self-test", "source-collection evidence-label mutation was accepted")
    catalog_path = package_path.parent / package["materialCorrections"]["catalog"]["url"]
    catalog = json.loads(catalog_path.read_text())
    partitioned = next(chart for chart in catalog["charts"] if len(chart["motionBindings"]) > 1)
    validate_chart_binding_partition(partitioned)
    mutated = deepcopy(partitioned)
    mutated["motionBindings"][0]["validTimeMa"]["oldest"] += 1
    try:
        validate_chart_binding_partition(mutated)
    except CorrectionError:
        pass
    else:
        fail("self-test", "overlapping correction motion-binding mutation was accepted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", action="append", type=Path)
    parser.add_argument("--print-target", action="append", default=[])
    parser.add_argument("--source-oracle", action="store_true")
    parser.add_argument("--refresh-targets", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
            print("cao-material-corrections: mutation self-test passed")
            return 0
        if args.print_target or args.source_oracle or args.refresh_targets:
            metadata, directions = load_stage()
            targets = target_catalog(metadata, directions)
        else:
            targets = load_tracked_targets()
        if args.print_target:
            for patch_id in args.print_target:
                if patch_id not in targets:
                    fail("--print-target", f"unknown patch {patch_id}")
                print(json.dumps(targets[patch_id], sort_keys=True))
            return 0
        if args.refresh_targets:
            manifest_paths = args.manifest or sorted(CORRECTIONS.glob("*/manifest.json"))
            patch_ids = []
            for manifest_path in manifest_paths:
                raw = json.loads(manifest_path.read_text())
                patch_ids.extend(target["patchId"] for feature in raw.get("features", [])
                                 for target in feature.get("targets", []))
            for override_path in sorted(CORRECTIONS.glob("*/native-overrides.json")):
                raw = json.loads(override_path.read_text())
                patch_ids.extend(override["nativeTarget"]["patchId"]
                                 for override in raw.get("nativeChartOverrides", []))
            missing = sorted(set(patch_ids) - set(targets))
            if missing:
                fail("--refresh-targets", f"unknown Cao targets: {', '.join(missing)}")
            TRACKED_TARGETS.parent.mkdir(parents=True, exist_ok=True)
            TRACKED_TARGETS.write_text(json.dumps({
                "schemaVersion": 2,
                "sourceCollection": SOURCE_COLLECTION,
                "sourceSha256": SOURCE_SHA256,
                "coordinateFrame": FRAME,
                "topologySources": TOPOLOGY_SOURCES,
                "geometryHashEncoding": GEOMETRY_HASH_DOMAIN[:-1].decode(),
                "targets": [targets[patch_id] for patch_id in sorted(set(patch_ids))],
            }, indent=2) + "\n")
            print(f"cao-material-corrections: wrote {len(set(patch_ids))} target witnesses")
            return 0
        if args.source_oracle:
            tracked = load_tracked_targets()
            for patch_id, record in tracked.items():
                if patch_id not in targets or not exact_json_equal(record, targets[patch_id]):
                    fail("--source-oracle", f"tracked target differs from immutable Cao source: {patch_id}")
        manifests = validate_all(args.manifest)
        print(f"cao-material-corrections: {len(manifests)} manifests validated")
        return 0
    except (CorrectionError, OSError, json.JSONDecodeError) as error:
        print(f"cao-material-corrections: FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

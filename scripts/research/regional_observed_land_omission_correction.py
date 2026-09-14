#!/usr/bin/env python3
"""Validate the global exact-present observed-land omission correction.

The correction covers observed modern land that no emitted Cao v2.4 coast chart
and no Cao continental-outline polygon reaches at 0 Ma, so the opaque ocean
sphere would otherwise be visible through the surface. It runs from a clean
checkout against tracked inputs only; ``--runtime`` additionally checks the
generated public correction catalog and the batch that owns each chart.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import tempfile
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/observed-land-omission"
MANIFEST = REGION / "observed-land-manifest.json"
REPORT = ROOT / "docs/research/regional-observed-land-omission-validation.json"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"

CORRECTION_ID = "earthhistory-observed-land-omission-v1"
SOURCE_IDS = {"natural-earth-countries-50m", "cao-v2.4-native-coasts",
              "cao-v2.4-native-continents", "cao-v2.4-static-partitions"}
NATURAL_EARTH_SHA256 = "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"
COAST_SHA256 = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
CONTINENT_SHA256 = "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"
STATIC_SHA256 = "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"
ROTATION_SHA256 = "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"

SELECTION_POLICY = {
    "minimumComponentSquareKilometres": 1000.0,
    "maximumShelfFraction": 0.5,
    "requiresSinglePresentStaticPartition": True,
    "requiresQualifiedPresentPaletteBinding": True,
    "polarLimitDegrees": 84.0,
    "maximumLongitudeSpanDegrees": 180.0,
}

# The exact emitted inventory: owning Cao static partition, its ordered source-geometry
# digest, and the emitted component/vertex budget for the feature it owns.
EXPECTED_FEATURES = {
    "observed-land-omission-229-289": (
        229, "GPlates-2d916a07-b2ba-4953-a1e8-49bedd5fac8e",
        "ae4b667c947fa6b9c01a710e96bf29362b1184a05261a3ecd574ac8058aa0c2c",
        1, 30),
    "observed-land-omission-306-150": (
        306, "GPlates-99ac3a99-8443-496f-b9fb-24e082021181",
        "f019e88a98ba4c59dfdd8894dbbe1144c67dc7d93f451bdb08da6b07e03b61e7",
        1, 17),
    "observed-land-omission-503-0": (
        503, "GPlates-ab540888-8aac-44a4-ae8d-c0bd87b9a0b4",
        "91ccfe2931656231719265a45b4ce444cff97d084394ee84dd6667df514972eb",
        1, 53),
    "observed-land-omission-701-439": (
        701, "GPlates-3bd5b2a6-df84-4d7f-b736-b1bdf6cd2f54",
        "969f050de12d1d29c1da6f45e299d0e8a84046b13ebd40776743cfc7776a129c",
        4, 207),
    "observed-land-omission-701-1035": (
        701, "GPlates-d2d52c0d-da9f-481c-817b-974cd50a791d",
        "9fa244dcbeb35f5390bb792077f35b3395ba588413a31463afc7f169656c0bd7",
        1, 13),
    "observed-land-omission-704-1022": (
        704, "GPlates-0456b246-6676-4f0e-85a6-745ae202eee7",
        "0ea25b95f9abf0fb9862ad04964c420a4f3cca85b12404de3d8ff1f2819779d9",
        1, 18),
    "observed-land-omission-704-1026": (
        704, "GPlates-dd237dc0-3daa-4e0f-a04d-96e1cd449f50",
        "93f6484b63691bc7ddc10a51f1f0df044e7a2c3d75f3a65a1cbe859a243888f5",
        1, 14),
    "observed-land-omission-709-545": (
        709, "GPlates-c8a38b13-ecf5-4a81-8685-014f2ec98984",
        "706f91d4314f49aa18dfd5f2643cd703c9213599ec2d4dbefc6058ed12532ca7",
        1, 18),
    "observed-land-omission-714-230": (
        714, "GPlates-f1e43feb-fc2e-4b5f-8277-42a2815a3454",
        "1541cdaae1559629f0c48232838eb0293196e067de025d92a477ec7701d1dbd2",
        3, 46),
    "observed-land-omission-714-236": (
        714, "GPlates-65cf358f-346c-444f-95fb-ecac00ec9ee9",
        "dde2894923fa5cd74f2fca74f3591b9e0d50ec177e27b6c513aad7b3376189d4",
        1, 44),
    "observed-land-omission-802-1409": (
        802, "GPlates-329f4e06-b5af-4781-a398-a2026c40bbb9",
        "6f7cf857951349c1a51b7ff03b580d2f51de7c12f65139f09e6cd2d067d282e9",
        1, 98),
    "observed-land-omission-836-572": (
        836, "GPlates-ab782c49-40cf-4662-ab78-6d3cbf07e970",
        "4a3aae87a4bbb62fd5b057d1b1e6603a4169778aac249469a72200adc068efe7",
        1, 20),
    "observed-land-omission-911-1246": (
        911, "GPlates-e28aafd5-4156-4754-8a25-f7d5080fe556",
        "e533ff5ef9ab5a9d5f16610164554696bb2710baae9b6ddd792aff84ff38c88d",
        1, 31),
}
# Reported defects the correction exists to repair; every one must pick corrected land.
DEFECT_WITNESSES = {
    "southwest-arabia-highlands": [45.0, 17.0],
    "southwest-arabia-sanaa-north": [44.0, 16.0],
    "southwest-arabia-asir": [44.0, 20.0],
    "southwest-arabia-taizz": [44.5, 13.0],
    "niger-delta": [6.5, 5.0],
    "niger-delta-east": [7.5, 4.8],
}
# Native Cao land just outside the omissions; the correction must not absorb it.
NATIVE_WITNESSES = {
    "arabia-interior": [47.0, 15.5],
    "arabia-hadhramaut": [50.0, 19.0],
    "arabia-riyadh": [46.0, 24.0],
    "arabia-asir-coast": [43.5, 17.0],
    "nigeria-interior": [8.0, 9.0],
    "angola-interior": [17.0, -12.0],
}
INACTIVE_AGES = (0.000001, 1, 5, 74)
MIN_TOTAL_AREA_KM2 = 180_000.0
MAX_TOTAL_AREA_KM2 = 181_000.0
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class CorrectionError(ValueError):
    pass


def fail(label: str, message: str) -> None:
    raise CorrectionError(f"{label}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def active(lifecycle: dict, age: float) -> bool:
    valid = lifecycle.get("validTimeMa", {})
    return valid.get("youngest") <= age <= valid.get("oldest")


def rings_of(geometry: dict):
    kind = geometry.get("type")
    polygons = [geometry.get("coordinates")] if kind == "Polygon" else geometry.get("coordinates")
    if kind not in {"Polygon", "MultiPolygon"} or not isinstance(polygons, list) or not polygons:
        fail("geometry", "must be a nonempty Polygon or MultiPolygon")
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            fail("geometry", "polygon has no rings")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                fail("geometry", "ring must be closed with at least four positions")
            for position in ring:
                if (not isinstance(position, list) or len(position) != 2
                        or any(isinstance(value, bool) or not isinstance(value, (int, float))
                               or not math.isfinite(value) for value in position)
                        or not -180 <= position[0] <= 180
                        or abs(position[1]) > SELECTION_POLICY["polarLimitDegrees"]):
                    fail("geometry", "position left the declared WGS84 envelope")
            yield ring


def polygons_of(geometry: dict):
    kind = geometry.get("type")
    return [geometry["coordinates"]] if kind == "Polygon" else geometry["coordinates"]


def point_in_polygon(polygon: list, longitude: float, latitude: float) -> bool:
    """Even-odd containment for one ring list; interior rings punch holes."""
    def inside(ring):
        crossings = False
        for index in range(len(ring) - 1):
            x1, y1 = ring[index]
            x2, y2 = ring[index + 1]
            if (y1 > latitude) != (y2 > latitude):
                if x1 + (latitude - y1) * (x2 - x1) / (y2 - y1) > longitude:
                    crossings = not crossings
        return crossings
    if not inside(polygon[0]):
        return False
    return not any(inside(hole) for hole in polygon[1:])


def contains(document: dict, longitude: float, latitude: float) -> bool:
    for feature in document["features"]:
        for polygon in polygons_of(feature["geometry"]):
            if point_in_polygon(polygon, longitude, latitude):
                return True
    return False


def validate_document(manifest: dict, *, check_assets: bool = True,
                      region: Path | None = None) -> dict:
    if (manifest.get("schemaVersion") != 1 or manifest.get("version") != "1"
            or manifest.get("correctionId") != CORRECTION_ID
            or manifest.get("attribution") != "Made with Natural Earth; Cao et al. (2024)."):
        fail("manifest", "identity, version, or attribution changed")

    baseline = manifest.get("baseline", {})
    witness = baseline.get("omissionWitness", {})
    if (baseline.get("modelId") != "cao-et-al-2024" or baseline.get("modelVersion") != "2.4"
            or baseline.get("coastSourceSha256") != COAST_SHA256
            or baseline.get("continentSourceSha256") != CONTINENT_SHA256
            or baseline.get("staticSourceSha256") != STATIC_SHA256
            or baseline.get("rotationSourceSha256") != ROTATION_SHA256
            or baseline.get("coordinateFrame", {}).get("anchorPlateId") != 0
            or baseline.get("coordinateFrame", {}).get("absoluteFrameId") != "palaeomagnetic"
            or "no Cao continental-outline polygon covers" not in baseline.get("omission", "")):
        fail("baseline", "pinned Cao source identity, reference frame, or omission claim changed")
    if (witness.get("ageMa") != 0
            or witness.get("uncoveredWitnessLonLat") != DEFECT_WITNESSES
            or witness.get("nativeWitnessLonLat") != NATIVE_WITNESSES):
        fail("baseline.omissionWitness", "the recorded defect or native witness set changed")

    sources = manifest.get("sourceAssets", [])
    if {row.get("sourceId") for row in sources} != SOURCE_IDS or len(sources) != 4:
        fail("sourceAssets", "required source set changed")
    natural_earth = next(row for row in sources if row["sourceId"] == "natural-earth-countries-50m")
    if (natural_earth.get("path") != "ne_50m_admin_0_countries.zip"
            or natural_earth.get("publicationOrVersionDate") != "5.1.1"
            or natural_earth.get("retrievedAt") != "2026-09-12"
            or natural_earth.get("license") != "Public domain"
            or natural_earth.get("temporalRangeMa") != [0, 0]
            or natural_earth.get("bytes") != 799734
            or natural_earth.get("sha256") != NATURAL_EARTH_SHA256):
        fail("sourceAssets.naturalEarth", "identity, license, frame, or exact-present scope changed")
    cao_rows = {row["sourceId"]: row for row in sources if row["sourceId"].startswith("cao-")}
    if any(row.get("retrievedAt") != "2026-09-09" or row.get("license") != "CC BY 4.0"
           or row.get("publicationOrVersionDate") != "2.4"
           or "anchor plate 0" not in row.get("geographicBasis", "")
           for row in cao_rows.values()):
        fail("sourceAssets.cao", "version, license, retrieval date, or frame changed")
    if (cao_rows["cao-v2.4-native-coasts"].get("sha256") != COAST_SHA256
            or cao_rows["cao-v2.4-native-continents"].get("sha256") != CONTINENT_SHA256):
        fail("sourceAssets.cao.geometry", "native coast or continent identity changed")
    members = {row.get("path"): row for row in cao_rows["cao-v2.4-static-partitions"].get("members", [])}
    if (members.get("static_polygons.gpmlz", {}).get("sha256") != STATIC_SHA256
            or members.get("1000_0_rotfile.rot", {}).get("sha256") != ROTATION_SHA256):
        fail("sourceAssets.cao.static", "static partition or rotation identity changed")

    processing = manifest.get("geometryProcessing", {})
    if (processing.get("selectionPolicy") != SELECTION_POLICY
            or "minus the emitted Cao shapes_coasts chart footprint" not in processing.get("operation", "")
            or "retain native coast charts" not in processing.get("nativeOverlapPrecedence", "")
            or processing.get("waterSemantics") != "no shelf, shallow-water, palaeoshoreline, or bathymetric claim"
            or "does not alter any country reference chart" not in processing.get("countryReferenceImplication", "")
            or "no buffer or inferred bridge" not in processing.get("shorelineMismatchHandling", "")
            or "keeps the model's own shelf class" not in processing.get("shorelineMismatchHandling", "")
            or processing.get("roundingDecimalDegrees") != 6):
        fail("geometryProcessing", "selection policy, native precedence, country consumer, "
                                   "or no-depth contract changed")

    partitions = {row.get("sourceOrder"): row for row in processing.get("platePartitions", [])}
    if len(partitions) != len(processing.get("platePartitions", [])):
        fail("geometryProcessing.platePartitions", "duplicate static source order")
    skipped = processing.get("skippedComponents", [])
    if not skipped or any(not row.get("reason") for row in skipped):
        fail("geometryProcessing.skippedComponents", "every rejected component must record its reason")

    features = {row.get("correctionFeatureId"): row for row in manifest.get("features", [])}
    if set(features) != set(EXPECTED_FEATURES):
        fail("features", "emitted correction inventory changed")
    asset_rows = {(row.get("geometryAsset", {}).get("path"), row.get("geometryAsset", {}).get("bytes"),
                   row.get("geometryAsset", {}).get("sha256")) for row in features.values()}
    if len(asset_rows) != 1:
        fail("features.geometryAsset", "every feature must share one tracked geometry asset")
    geometry_name, geometry_bytes, geometry_sha = next(iter(asset_rows))
    if not isinstance(geometry_bytes, int) or geometry_bytes <= 0 or not SHA256.fullmatch(geometry_sha or ""):
        fail("features.geometryAsset", "invalid geometry bytes or SHA-256")

    for identifier, (plate, source_feature, digest, components, vertices) in EXPECTED_FEATURES.items():
        feature = features[identifier]
        lifecycle = feature.get("phaseLifecycles", {}).get("observed")
        pose = feature.get("pose", {})
        partition = partitions.get(pose.get("sourceOrder"))
        if (feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("epistemicStatus") != "observed-generalized"
                or feature.get("materialRole") != "observed-modern-land"
                or set(feature.get("phaseLifecycles", {})) != {"observed"}
                or lifecycle != {"validTimeMa": {"youngest": 0, "oldest": 0}}
                or feature.get("surfaceEvidence", {}).get("kind") != "observed"
                or feature.get("surfaceEvidence", {}).get("surfaceClass") != "land"
                or feature.get("surfaceEvidence", {}).get("sourceIds") != ["natural-earth-countries-50m"]
                or pose.get("plateId") != plate
                or pose.get("method") != "cao-static-polygon-identity-at-present"
                or pose.get("motionBinding") != "reuse-present-binding"
                or "never backdated" not in pose.get("warning", "")
                or pose.get("sourceFeatureId") != source_feature
                or feature.get("uncertainty", {}).get("temporal") != "exact modern reference only"
                or feature.get("uncertainty", {}).get("exposure") != "observed modern land classification"
                or feature.get("uncertainty", {}).get("depth") != "no shallow-water or bathymetric claim"):
            fail(identifier, "evidence, lifecycle, pose, or material semantics changed")
        if not active(lifecycle, 0) or any(active(lifecycle, age) for age in INACTIVE_AGES):
            fail(identifier, "exact-present lifecycle changed")
        if (partition is None or partition.get("plateId") != plate
                or partition.get("featureId") != pose.get("sourceFeatureId")
                or partition.get("geometrySha256") != digest
                or partition.get("validTimeMa", [0, 1])[1] != 0
                or partition.get("correctedComponentCount") != components
                or partition.get("correctedVertexCount") != vertices
                or partition.get("hasCoastCounterpart") is not False
                or partition.get("hasContinentCounterpart") is not False):
            fail(identifier, "owning static partition identity, ordered geometry proof, "
                             "budget, or omission evidence changed")

    total = sum(row.get("correctedAreaSquareKilometres", 0)
                for row in processing.get("platePartitions", []))
    if not MIN_TOTAL_AREA_KM2 < total < MAX_TOTAL_AREA_KM2:
        fail("geometryProcessing.platePartitions", "total corrected area left its reviewed bound")

    if check_assets:
        path = (region or REGION) / (geometry_name or "")
        if not path.is_file() or path.stat().st_size != geometry_bytes or sha(path) != geometry_sha:
            fail("features.geometryAsset", "tracked geometry identity changed")
        document = json.loads(path.read_text())
        rows = {row.get("id"): row for row in document.get("features", [])}
        if document.get("type") != "FeatureCollection" or set(rows) != set(EXPECTED_FEATURES):
            fail("geometry", "tracked correction feature set changed")
        for identifier, (plate, _, _, components, vertices) in EXPECTED_FEATURES.items():
            row = rows[identifier]
            properties = row.get("properties", {})
            geometry = row.get("geometry", {})
            if (properties.get("correctionFeatureId") != identifier
                    or properties.get("plateId") != plate
                    or properties.get("surfaceClass") != "land"
                    or properties.get("sourceClass") != "natural-earth-observed-modern-land"
                    or properties.get("validTimeMa") != {"youngest": 0, "oldest": 0}
                    or len(polygons_of(geometry)) != components
                    or sum(len(ring) - 1 for ring in rings_of(geometry)) != vertices):
                fail(identifier, "geometry properties, envelope, or vertex budget changed")
        for label, (longitude, latitude) in DEFECT_WITNESSES.items():
            if not contains(document, longitude, latitude):
                fail("geometry", f"reported defect witness {label} is not corrected")
        for label, (longitude, latitude) in NATIVE_WITNESSES.items():
            if contains(document, longitude, latitude):
                fail("geometry", f"native witness {label} was absorbed by the correction")
    return {"features": len(features), "geometryBytes": geometry_bytes,
            "partitions": len(partitions), "correctedAreaSquareKilometres": round(total, 3)}


def validate_report() -> dict:
    report = json.loads(REPORT.read_text())
    result = report.get("result", {})
    if (report.get("schemaVersion") != 1 or report.get("correctionId") != CORRECTION_ID
            or report.get("ageWitnesses") != {"activeMa": [0], "inactiveMa": list(INACTIVE_AGES)}
            or report.get("selectionPolicy") != SELECTION_POLICY
            or report.get("defectWitnesses") != DEFECT_WITNESSES
            or report.get("nativeWitnesses") != NATIVE_WITNESSES
            or result.get("features") != len(EXPECTED_FEATURES)
            or not MIN_TOTAL_AREA_KM2 < result.get("correctedAreaSquareKilometres", 0) < MAX_TOTAL_AREA_KM2
            or result.get("nativeOverlapSquareKilometres", 1) > 1e-4
            or result.get("partitionPairOverlapSquareKilometres", 1) > 1e-6
            or result.get("priorCorrectionOverlapSquareKilometres", 1) > 1e-6
            or result.get("skippedComponentCount", 0) < 1
            or "NGA" not in result.get("countries", [])
            or "YEM" not in result.get("countries", [])):
        fail("validation report", "coverage, overlap, witness, or selection evidence changed")
    geometry = report.get("geometry", {})
    path = REGION / geometry.get("path", "")
    if geometry.get("bytes") != path.stat().st_size or geometry.get("sha256") != sha(path):
        fail("validation report", "geometry identity changed")
    recorded = report.get("manifest", {})
    if (recorded.get("path") != MANIFEST.name or recorded.get("bytes") != MANIFEST.stat().st_size
            or recorded.get("sha256") != sha(MANIFEST)):
        fail("validation report", "manifest identity changed")
    return report


def batch_chart_indices(path: Path, vertex_count: int) -> set[int]:
    payload = path.read_bytes()
    expected_bytes = 32 + 20 * vertex_count
    if payload[:4] != b"EHGB" or len(payload) < expected_bytes:
        fail(path.name, "invalid correction geometry header")
    chart_offset = 32 + 16 * vertex_count
    return {int.from_bytes(payload[offset:offset + 4], "little")
            for offset in range(chart_offset, chart_offset + 4 * vertex_count, 4)}


def validate_generated_catalog(manifest: dict, catalog: dict, package_dir: Path | None = None) -> dict:
    # Plate ownership is checked against the shared palette rather than the entry
    # name: an exact-[0,0] identity entry may have been appended by an earlier
    # correction and still be the correct present binding for this plate.
    palette_plates: dict[str, int] = {}
    if package_dir is not None:
        palette = json.loads((package_dir / "motion-palette.json").read_text())
        palette_plates = {entry["entryId"]: entry["plateId"] for entry in palette["entries"]}
    expected = {}
    for feature in manifest["features"]:
        identifier = feature["correctionFeatureId"]
        expected[f"correction:{CORRECTION_ID}:{identifier}:observed"] = feature
    charts = {chart["chartId"]: chart for chart in catalog.get("charts", [])
              if chart.get("evidence", {}).get("correction", {}).get("correctionId") == CORRECTION_ID}
    if set(charts) != set(expected):
        fail("generated catalog", "observed-land omission chart set changed")
    for chart_id, feature in expected.items():
        chart = charts[chart_id]
        bindings = chart.get("motionBindings", [])
        plate = feature["pose"]["plateId"]
        if (chart.get("lifecycle") != feature["phaseLifecycles"]["observed"]
                or chart.get("surfaceEvidence") != feature["surfaceEvidence"]
                or chart.get("geometryReferenceAgeMa") != 0
                or chart.get("evidence", {}).get("correction", {}).get("phase") != "observed-exposed-land"
                or chart.get("sourceFeatureTypes") != ["EarthHistoryObservedModernLandCorrection"]
                or chart.get("fragmentOrCohortId") != feature["correctionFeatureId"]
                or len(bindings) != 1
                or bindings[0].get("paletteId") != catalog.get("baseline", {}).get("motionPaletteId")
                or bindings[0].get("validTimeMa") != {"youngest": 0, "oldest": 0}
                or (palette_plates and palette_plates.get(bindings[0].get("entryId")) != plate)):
            fail(chart_id, "generated lifecycle, evidence, or motion binding changed")
    if CORRECTION_ID not in catalog.get("correctionIds", []):
        fail("generated catalog", "correction identity is absent from the catalog")
    if package_dir is not None:
        core = json.loads((package_dir / "core.json").read_text())
        indices = {row["chartId"]: len(core["charts"]) + index
                   for index, row in enumerate(catalog["charts"])}
        by_id = {batch["batchId"]: batch for batch in catalog["spatialBatches"]}
        members = {}
        for batch_id, batch in by_id.items():
            geometry = package_dir / batch["geometryAsset"]["url"]
            if (not geometry.is_file() or geometry.stat().st_size != batch["geometryAsset"]["bytes"]
                    or sha(geometry) != batch["geometryAsset"]["sha256"]):
                fail(batch_id, "geometry identity changed")
            members[batch_id] = batch_chart_indices(geometry, batch["vertexCount"])
        for chart_id in expected:
            containing = [batch_id for batch_id, rows in members.items()
                          if indices[chart_id] in rows]
            if containing != ["material-correction-observed"]:
                fail(chart_id, f"expected only material-correction-observed, found {containing}")
    return {"charts": len(charts)}


def validate(runtime: bool, package_dir: Path = PUBLIC) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    result = validate_document(manifest)
    validate_report()
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog_path = package_dir / package["materialCorrections"]["catalog"]["url"]
        result["generated"] = validate_generated_catalog(
            manifest, json.loads(catalog_path.read_text()), package_dir)
    return result


def self_test(runtime: bool = False, package_dir: Path = PUBLIC) -> dict:
    source = json.loads(MANIFEST.read_text())
    cases = {
        "backdated land": lambda value: value["features"][0]["phaseLifecycles"]["observed"]
            ["validTimeMa"].update({"oldest": 0.001}),
        "shallow-water relabel": lambda value: value["features"][0]["surfaceEvidence"]
            .update({"surfaceClass": "shallow-marine"}),
        "natural earth identity drift": lambda value: next(
            row for row in value["sourceAssets"]
            if row["sourceId"] == "natural-earth-countries-50m").update({"sha256": "0" * 64}),
        "static source drift": lambda value: value["baseline"].update({"staticSourceSha256": "0" * 64}),
        "source geometry drift": lambda value: value["geometryProcessing"]["platePartitions"][0]
            .update({"geometrySha256": "0" * 64}),
        "plate drift": lambda value: value["features"][0]["pose"].update({"plateId": 999}),
        "selection policy widened": lambda value: value["geometryProcessing"]["selectionPolicy"]
            .update({"minimumComponentSquareKilometres": 1.0}),
        "shelf policy dropped": lambda value: value["geometryProcessing"]["selectionPolicy"]
            .update({"maximumShelfFraction": 1.0}),
        "unbounded palette requirement": lambda value: value["geometryProcessing"]["selectionPolicy"]
            .update({"requiresQualifiedPresentPaletteBinding": False}),
        "omission witness erased": lambda value: value["baseline"]["omissionWitness"]
            .update({"uncoveredWitnessLonLat": {"niger-delta": [6.5, 5.0]}}),
        "silent rejection": lambda value: value["geometryProcessing"]["skippedComponents"][0].pop("reason"),
        "feature dropped": lambda value: value["features"].pop(),
        "partition counterpart claim": lambda value: value["geometryProcessing"]["platePartitions"][0]
            .update({"hasCoastCounterpart": True}),
        "unbounded area": lambda value: value["geometryProcessing"]["platePartitions"][0]
            .update({"correctedAreaSquareKilometres": 5_000_000.0}),
        "country claim": lambda value: value["geometryProcessing"]
            .update({"countryReferenceImplication": "country outlines repaired"}),
    }
    caught = []
    for label, mutate in cases.items():
        candidate = deepcopy(source)
        mutate(candidate)
        try:
            validate_document(candidate, check_assets=False)
        except (CorrectionError, KeyError, IndexError):
            caught.append(label)
        else:
            fail("self-test", f"mutation survived: {label}")

    drifted = deepcopy(source)
    drifted["features"][0]["geometryAsset"].update({"sha256": "0" * 64})
    try:
        validate_document(drifted, check_assets=True)
    except CorrectionError:
        caught.append("tracked geometry drift")
    else:
        fail("self-test", "mutation survived: tracked geometry drift")

    document = json.loads((REGION / source["features"][0]["geometryAsset"]["path"]).read_text())
    square = [[[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.1], [0.0, 0.0]]]
    world = [[[-179.0, -80.0], [179.0, -80.0], [179.0, 80.0], [-179.0, 80.0], [-179.0, -80.0]]]
    geometry_cases = {
        "defect witness uncovered": lambda value: next(
            row for row in value["features"]
            if row["id"] == "observed-land-omission-701-439")["geometry"].update(
                {"type": "Polygon", "coordinates": square}),
        "native witness absorbed": lambda value: next(
            row for row in value["features"]
            if row["id"] == "observed-land-omission-503-0")["geometry"].update(
                {"type": "Polygon", "coordinates": world}),
        "surface class relabel": lambda value: value["features"][0]["properties"]
            .update({"surfaceClass": "shallow-marine"}),
    }
    for label, mutate in geometry_cases.items():
        candidate_document = deepcopy(document)
        mutate(candidate_document)
        payload = (json.dumps(candidate_document, ensure_ascii=False, sort_keys=True,
                              separators=(",", ":")) + "\n").encode()
        with tempfile.TemporaryDirectory(prefix="earthhistory-omission-selftest-") as scratch:
            path = Path(scratch) / source["features"][0]["geometryAsset"]["path"]
            path.write_bytes(payload)
            candidate = deepcopy(source)
            candidate["features"][0]["geometryAsset"].update(
                {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
            try:
                validate_document(candidate, check_assets=True, region=Path(scratch))
            except CorrectionError:
                caught.append(label)
            else:
                fail("self-test", f"mutation survived: {label}")

    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog = json.loads((package_dir / package["materialCorrections"]["catalog"]["url"]).read_text())
        runtime_cases = {
            "generated backdating": lambda value: next(
                row for row in value["charts"] if row["chartId"].startswith(f"correction:{CORRECTION_ID}:")
            )["lifecycle"]["validTimeMa"].update({"oldest": 0.001}),
            "generated surface relabel": lambda value: next(
                row for row in value["charts"] if row["chartId"].startswith(f"correction:{CORRECTION_ID}:")
            )["surfaceEvidence"].update({"surfaceClass": "shallow-marine"}),
            "generated chart dropped": lambda value: value["charts"].remove(next(
                row for row in value["charts"] if row["chartId"].startswith(f"correction:{CORRECTION_ID}:"))),
        }
        for label, mutate in runtime_cases.items():
            candidate = deepcopy(catalog)
            mutate(candidate)
            try:
                validate_generated_catalog(source, candidate, package_dir)
            except CorrectionError:
                caught.append(label)
            else:
                fail("self-test", f"generated mutation survived: {label}")
    return {"mutationsCaught": caught}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--runtime", action="store_true")
    parser.add_argument("--package", type=Path, default=PUBLIC)
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps({"status": "ok", **self_test(args.runtime, args.package)}))
        return
    print(json.dumps({"status": "ok", **validate(args.runtime, args.package)},
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate the isolated exact-present Panama observed-land source contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/panama"
CONTRACT = REGION / "source-contract.json"
REPORT = ROOT / "docs/research/regional-panama-validation.json"
CORRECTION_ID = "earthhistory-regional-panama-observed-land-v1"
EXPECTED = {
    "panama-observed-land-229-289": (229, 109),
    "panama-observed-land-911-532": (911, 13),
    "panama-observed-land-911-533": (911, 12),
    "panama-observed-land-230-798": (230, 91),
    "panama-observed-land-231-2032": (231, 47),
}
SOURCE_IDS = {"natural-earth-countries-50m", "cao-v2.4-native-coasts", "cao-v2.4-static-partitions"}
EXPECTED_PARTITIONS = {
    289: (229, "ae4b667c947fa6b9c01a710e96bf29362b1184a05261a3ecd574ac8058aa0c2c"),
    532: (911, "da032d5a70456e96d5924ed57f5295ef4c0138aed6245d0e0e6f801a05011239"),
    533: (911, "1033525cae1b6d829a721ae2989a48f16f45b9e7c175ffefa900786d566e7a81"),
    798: (230, "0b35619db8d801db9c832a18b1a87aa958e1f8eb1b323469de0565d65460aca4"),
    2032: (231, "bb7b64329162b9321cdddf5558d62f39eefe7970b5a82aecc0a62cd3e8042cf7"),
    2033: (201, "a1b1d46d6baad6f5d24c04ff3c460a8b209a572fa3ae8a9698ddde9cbcb32502"),
}
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


def positions(geometry: dict):
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
            for position in ring[:-1]:
                if (not isinstance(position, list) or len(position) != 2
                        or any(isinstance(value, bool) or not isinstance(value, (int, float))
                               or not math.isfinite(value) for value in position)
                        or not -84 <= position[0] <= -76 or not 6.5 <= position[1] <= 10.5):
                    fail("geometry", "position left bounded Panama WGS84 envelope")
                yield position


def validate_document(contract: dict, *, check_assets: bool = True) -> dict:
    if (contract.get("schemaVersion") != 1 or contract.get("version") != "1"
            or contract.get("correctionId") != CORRECTION_ID
            or contract.get("attribution") != "Made with Natural Earth; Cao et al. (2024)."):
        fail("contract", "identity, version, or attribution changed")
    sources = contract.get("sourceAssets", [])
    if {row.get("sourceId") for row in sources} != SOURCE_IDS or len(sources) != 3:
        fail("sources", "required source set changed")
    natural_earth = next(row for row in sources if row["sourceId"] == "natural-earth-countries-50m")
    if (natural_earth.get("path") != "ne_50m_admin_0_countries.zip"
            or natural_earth.get("publicationOrVersionDate") != "5.1.1"
            or natural_earth.get("retrievedAt") != "2026-09-12"
            or natural_earth.get("license") != "Public domain"
            or natural_earth.get("temporalRangeMa") != [0, 0]
            or natural_earth.get("bytes") != 799734
            or natural_earth.get("sha256") != "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"):
        fail("sources.naturalEarth", "identity, license, frame, or exact-present scope changed")
    cao_rows = {row["sourceId"]: row for row in sources if row["sourceId"].startswith("cao-")}
    if any(row.get("retrievedAt") != "2026-09-09" or row.get("license") != "CC BY 4.0"
           or row.get("publicationOrVersionDate") != "2.4" or "anchor plate 0" not in row.get("geographicBasis", "")
           for row in cao_rows.values()):
        fail("sources.cao", "version, license, retrieval date, or frame changed")
    if (cao_rows["cao-v2.4-native-coasts"].get("sha256") !=
            "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"):
        fail("sources.cao.coasts", "native coast identity changed")
    members = {row.get("path"): row for row in cao_rows["cao-v2.4-static-partitions"].get("members", [])}
    if (members.get("static_polygons.gpmlz", {}).get("sha256") !=
            "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"
            or members.get("1000_0_rotfile.rot", {}).get("sha256") !=
            "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"):
        fail("sources.cao.static", "static partition or rotation identity changed")

    processing = contract.get("geometryProcessing", {})
    if ("minus the emitted Cao shapes_coasts chart footprint" not in processing.get("operation", "")
            or "retain native coast charts" not in processing.get("nativeOverlapPrecedence", "")
            or processing.get("waterSemantics") != "no shelf, shallow-water, palaeoshoreline, or bathymetric claim"
            or "land applicator does not alter country:pan" not in processing.get("countryReferenceImplication", "")
            or processing.get("roundingDecimalDegrees") != 6):
        fail("geometryProcessing", "native precedence, country consumer, or no-depth contract changed")
    if processing.get("emittedNativeChartIds") != [
        "cao-coast:GPlates-37c480a5-4c44-4641-8411-7614f5185976:481:0",
        "cao-coast:GPlates-a30199da-5274-4c42-819c-802fa8ae72d4:553:1",
    ]:
        fail("geometryProcessing.emittedNativeChartIds", "native runtime witness changed")
    partitions = processing.get("platePartitions", [])
    actual_partitions = {row.get("sourceOrder"): (row.get("plateId"), row.get("geometrySha256"))
                         for row in partitions}
    if actual_partitions != EXPECTED_PARTITIONS:
        fail("geometryProcessing.platePartitions", "source identity or ordered geometry proof changed")

    features = {row.get("correctionFeatureId"): row for row in contract.get("features", [])}
    if set(features) != set(EXPECTED) or len(features) != 5:
        fail("features", "expected five exact-present static-partition pieces")
    asset_rows = {(row.get("geometryAsset", {}).get("path"), row.get("geometryAsset", {}).get("bytes"),
                   row.get("geometryAsset", {}).get("sha256")) for row in features.values()}
    if len(asset_rows) != 1:
        fail("features.geometryAsset", "every feature must share one tracked geometry asset")
    geometry_name, geometry_bytes, geometry_sha = next(iter(asset_rows))
    if not isinstance(geometry_bytes, int) or geometry_bytes <= 0 or not SHA256.fullmatch(geometry_sha or ""):
        fail("features.geometryAsset", "invalid geometry bytes or SHA-256")
    for identifier, (plate, _) in EXPECTED.items():
        feature = features[identifier]
        lifecycle = feature.get("phaseLifecycles", {}).get("observed")
        pose = feature.get("pose", {})
        if (feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("epistemicStatus") != "observed-generalized"
                or feature.get("materialRole") != "observed-modern-land"
                or lifecycle != {"validTimeMa": {"youngest": 0, "oldest": 0}}
                or feature.get("surfaceEvidence") != {"kind": "observed", "surfaceClass": "land",
                                                        "sourceIds": ["natural-earth-countries-50m"]}
                or pose.get("plateId") != plate or pose.get("method") != "cao-static-polygon-identity-at-present"
                or pose.get("motionBinding") != ("reuse-present-binding" if plate == 231 else "add-exact-0-Ma-identity-binding")
                or feature.get("uncertainty", {}).get("temporal") != "exact modern reference only"
                or feature.get("uncertainty", {}).get("depth") != "no shallow-water or bathymetric claim"):
            fail(identifier, "evidence, lifecycle, pose, or material semantics changed")
        if not active(lifecycle, 0) or any(active(lifecycle, age) for age in (0.000001, 1, 5, 74)):
            fail(identifier, "exact-present lifecycle changed")
    if check_assets:
        path = REGION / geometry_name
        if not path.is_file() or path.stat().st_size != geometry_bytes or sha(path) != geometry_sha:
            fail("features.geometryAsset", "tracked geometry identity changed")
        document = json.loads(path.read_text())
        rows = {row.get("id"): row for row in document.get("features", [])}
        if document.get("type") != "FeatureCollection" or set(rows) != set(EXPECTED) or len(rows) != 5:
            fail("geometry", "expected five unique correction features")
        for identifier, (plate, count) in EXPECTED.items():
            row = rows[identifier]
            props = row.get("properties", {})
            if (props.get("correctionFeatureId") != identifier or props.get("plateId") != plate
                    or props.get("surfaceClass") != "land"
                    or props.get("validTimeMa") != {"youngest": 0, "oldest": 0}
                    or sum(1 for _ in positions(row.get("geometry", {}))) != count):
                fail(identifier, "geometry properties, envelope, or vertex count changed")
    return {"features": len(features), "geometryBytes": geometry_bytes, "partitions": len(partitions)}


def validate_report() -> dict:
    report = json.loads(REPORT.read_text())
    source = report.get("sourceGeometry", {})
    if (report.get("schemaVersion") != 1 or report.get("correctionId") != CORRECTION_ID
            or report.get("ageWitnesses") != {"activeMa": [0], "inactiveMa": [0.000001, 1, 5, 74]}
            or source.get("naturalEarthBounds") != [-83.027344, 7.220068, -77.195996, 9.597852]
            or source.get("naturalEarthComponentCount") != 5 or source.get("naturalEarthVertexCount") != 241
            or not 0.1387 < source.get("nativeLandCoverageFraction", 0) < 0.1389
            or not 63_941 < source.get("correctionAreaSquareKilometres", 0) < 63_943
            or source.get("correctionComponentCount") != 13 or source.get("correctionVertexCount") != 250
            or source.get("partitionGapSquareKilometres", 1) > 0.05
            or source.get("partitionPairOverlapSquareKilometres", 1) > 1e-6
            or source.get("nativeOverlapSquareKilometres", 1) > 1e-6
            or source.get("fullOverlayComparison", {}).get("nativeDuplicateAreaSquareKilometres", 0) < 10_300):
        fail("validation report", "coverage, geometry budget, overlap, or age witness changed")
    geometry = report.get("geometry", {})
    path = REGION / geometry.get("path", "")
    if geometry.get("bytes") != path.stat().st_size or geometry.get("sha256") != sha(path):
        fail("validation report", "geometry identity changed")
    contract = report.get("contract", {})
    if contract.get("path") != CONTRACT.name or contract.get("bytes") != CONTRACT.stat().st_size or contract.get("sha256") != sha(CONTRACT):
        fail("validation report", "contract identity changed")
    return report


def self_test(contract: dict) -> dict:
    cases = {
        "backdated land": lambda value: value["features"][0]["phaseLifecycles"]["observed"]["validTimeMa"].update({"oldest": 0.001}),
        "shallow-water relabel": lambda value: value["features"][0]["surfaceEvidence"].update({"surfaceClass": "shallow-marine"}),
        "source identity drift": lambda value: value["sourceAssets"][0].update({"sha256": "0" * 64}),
        "source geometry drift": lambda value: value["geometryProcessing"]["platePartitions"][0].update({"geometrySha256": "0" * 64}),
        "tracked geometry drift": lambda value: value["features"][0]["geometryAsset"].update({"sha256": "0" * 64}),
        "plate drift": lambda value: value["features"][0]["pose"].update({"plateId": 230}),
        "country claim": lambda value: value["geometryProcessing"].update({"countryReferenceImplication": "country:pan repaired"}),
    }
    caught = []
    for label, mutate in cases.items():
        candidate = deepcopy(contract)
        mutate(candidate)
        try:
            validate_document(candidate, check_assets=False)
        except CorrectionError:
            caught.append(label)
        else:
            fail("self-test", f"mutation survived: {label}")
    return {"mutationsCaught": caught}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    contract = json.loads(CONTRACT.read_text())
    result = validate_document(contract)
    validate_report()
    if args.self_test:
        result.update(self_test(contract))
    print(json.dumps({"status": "ok", **result}))


if __name__ == "__main__":
    main()

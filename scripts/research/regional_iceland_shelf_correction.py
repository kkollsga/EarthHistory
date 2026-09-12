#!/usr/bin/env python3
"""Validate Iceland's exact-modern generalized shallow-marine correction."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import zipfile
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/iceland-shallow-shelf"
CONTRACT = REGION / "source-contract.json"
REPORT = ROOT / "docs/research/regional-iceland-shallow-shelf-validation.json"
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/regional-iceland-shallow-shelf-v1/source-inputs"
CORRECTION_ID = "earthhistory-regional-iceland-shallow-marine-v1"
SOURCE_ID = "natural-earth-bathymetry-10m-l0-k200-v4.1.0"
PLATES = (101, 301)
SHA256 = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_ARCHIVES = {
    "ne_10m_bathymetry_L_0.zip": (3_000_229, "3a950927bde293cd7a59e2618a9ee99cff1ad8422a886e9e8b47538a1de6f36b",
                                       "ne_10m_bathymetry_L_0.VERSION.txt"),
    "ne_10m_bathymetry_K_200.zip": (1_197_185, "68fe55b9ac57bd8255696d83259f5856594a60c582dd395de9c1772179337887",
                                         "ne_10m_bathymetry_K_200.VERSION.txt"),
}
EXPECTED_COUNTS = {101: 1065, 301: 1248}


class CorrectionError(ValueError):
    pass


def fail(label: str, message: str) -> None:
    raise CorrectionError(f"{label}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
                        or not -27 <= position[0] <= -11.5 or not 63 <= position[1] <= 67.5):
                    fail("geometry", "position left bounded Iceland WGS84 envelope")
                yield position


def active(lifecycle: dict, age: float) -> bool:
    valid = lifecycle.get("validTimeMa", {})
    return valid.get("youngest") <= age <= valid.get("oldest")


def validate_document(contract: dict, *, check_assets: bool = True, check_external: bool = False) -> dict:
    if (contract.get("schemaVersion") != 1 or contract.get("version") != "1"
            or contract.get("correctionId") != CORRECTION_ID
            or contract.get("attribution") != "Made with Natural Earth."):
        fail("contract", "identity, version, or attribution changed")
    sources = contract.get("sourceAssets", [])
    if len(sources) != 1 or sources[0].get("sourceId") != SOURCE_ID:
        fail("sourceAssets", "expected one paired Natural Earth source")
    source = sources[0]
    members = {row.get("path"): row for row in source.get("members", [])}
    if (set(members) != set(EXPECTED_ARCHIVES)
            or source.get("license") != "Public domain"
            or source.get("temporalRangeMa") != [0, 0]
            or source.get("retrievedAt") != "2026-09-12"
            or "4.1.0" not in source.get("publicationOrVersionDate", "")
            or "WGS84" not in source.get("geographicBasis", "")
            or "L_0 minus K_200" not in source.get("evidenceRole", "")):
        fail("sourceAssets", "version, license, frame, time, or evidence role changed")
    for name, (size, expected_sha, version_member) in EXPECTED_ARCHIVES.items():
        row = members[name]
        if row.get("bytes") != size or row.get("sha256") != expected_sha:
            fail(f"sourceAssets.{name}", "pinned archive identity changed")
        if check_external:
            path = POOL / name
            if not path.is_file() or path.stat().st_size != size or sha(path) != expected_sha:
                fail(f"sourceAssets.{name}", "external source archive identity changed")
            with zipfile.ZipFile(path) as archive:
                if archive.read(version_member).decode("ascii").strip() != "4.1.0":
                    fail(f"sourceAssets.{name}", "embedded archive version changed")
    reference_ids = {row.get("sourceId") for row in contract.get("references", [])}
    if reference_ids != {"hardarson-et-al-2008", "hafro-southern-shelf-slopes-2026"}:
        fail("references", "shelf extent, age-history, or irregular-depth evidence changed")
    for reference in contract["references"]:
        if (not reference.get("url", "").startswith("https://")
                or not reference.get("publicationOrVersionDate")
                or reference.get("retrievedAt") != "2026-09-12"
                or not reference.get("license") or not reference.get("geographicBasis")
                or not reference.get("evidenceRole")
                or not isinstance(reference.get("temporalRangeMa"), list)
                or len(reference["temporalRangeMa"]) != 2):
            fail(reference.get("sourceId", "reference"), "provenance metadata is incomplete")
    processing = contract.get("geometryProcessing", {})
    if (processing.get("depthSemantics") != "generalized nominal 0-200 m shallow-marine context"
            or processing.get("simplificationToleranceDegrees") != 0.005
            or "do not buffer or snap" not in processing.get("coastlineMismatchHandling", "")
            or "preserve every K_200" not in processing.get("deeperPocketPolicy", "")
            or processing.get("platePartition", {}).get("plateIds") != [101, 301]
            or processing.get("platePartition", {}).get("ridgeFeatureIds") != [
                "GPlates-0830a0e7-382a-4fe4-989c-02e27dab7c91",
                "GPlates-9a090a65-e45a-4bb0-9876-a106dfc0664a",
            ]):
        fail("geometryProcessing", "depth, shoreline, deeper-pocket, or Cao partition contract changed")

    features = {row.get("correctionFeatureId"): row for row in contract.get("features", [])}
    expected_ids = {f"iceland-shallow-marine-plate-{plate}" for plate in PLATES}
    if set(features) != expected_ids or len(features) != 2:
        fail("features", "expected exact two-plate shallow-marine matrix")
    asset_rows = {(row.get("geometryAsset", {}).get("path"), row.get("geometryAsset", {}).get("bytes"),
                   row.get("geometryAsset", {}).get("sha256")) for row in features.values()}
    if len(asset_rows) != 1:
        fail("features.geometryAsset", "both plate pieces must share one geometry asset")
    geometry_name, geometry_bytes, geometry_sha = next(iter(asset_rows))
    if not isinstance(geometry_bytes, int) or geometry_bytes <= 0 or not SHA256.fullmatch(geometry_sha or ""):
        fail("features.geometryAsset", "invalid bytes or SHA-256")
    for plate in PLATES:
        identifier = f"iceland-shallow-marine-plate-{plate}"
        feature = features[identifier]
        lifecycle = feature.get("phaseLifecycles", {}).get("classified-shallow-marine")
        uncertainty = feature.get("uncertainty", {})
        if (feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("epistemicStatus") != "cartographic-generalization"
                or feature.get("materialRole") != "generalized-modern-shallow-marine-context"
                or lifecycle != {"validTimeMa": {"youngest": 0, "oldest": 0}}
                or feature.get("pose", {}).get("plateId") != plate
                or feature.get("pose", {}).get("method") != "cao-rigid-plate-motion"
                or feature.get("sourceIds") != [SOURCE_ID]
                or feature.get("surfaceEvidence") != {
                    "kind": "classified", "surfaceClass": "shallow-marine", "sourceIds": [SOURCE_ID]
                }
                or "not a measured depth" not in uncertainty.get("depth", "")
                or uncertainty.get("temporal") != "exact modern reference only"
                or "no palaeoshoreline" not in uncertainty.get("exposure", "")):
            fail(identifier, "lifecycle, plate, surface class, or uncertainty semantics changed")
        if not active(lifecycle, 0) or any(active(lifecycle, age) for age in (0.000001, 0.001, 1, 16.3)):
            fail(identifier, "exact-modern lifecycle changed")

    if check_assets:
        geometry_path = REGION / geometry_name
        if (not geometry_path.is_file() or geometry_path.stat().st_size != geometry_bytes
                or sha(geometry_path) != geometry_sha):
            fail("features.geometryAsset", "tracked geometry identity changed")
        document = json.loads(geometry_path.read_text())
        geometry_features = {row.get("id"): row for row in document.get("features", [])}
        if (document.get("type") != "FeatureCollection" or set(geometry_features) != expected_ids
                or len(geometry_features) != 2):
            fail("geometry", "expected exactly two unique plate features")
        for plate in PLATES:
            identifier = f"iceland-shallow-marine-plate-{plate}"
            row = geometry_features[identifier]
            properties = row.get("properties", {})
            count = sum(1 for _ in positions(row.get("geometry", {})))
            if (properties.get("correctionFeatureId") != identifier
                    or properties.get("plateId") != plate
                    or properties.get("sourceId") != SOURCE_ID
                    or properties.get("surfaceClass") != "shallow-marine"
                    or properties.get("validTimeMa") != {"youngest": 0, "oldest": 0}
                    or count != EXPECTED_COUNTS[plate]):
                fail(identifier, "compiled geometry properties or vertex count changed")
    return {"features": len(features), "sourceArchives": len(members), "geometryBytes": geometry_bytes}


def validate_report() -> dict:
    report = json.loads(REPORT.read_text())
    source = report.get("sourceGeometry", {})
    if (report.get("schemaVersion") != 1 or report.get("correctionId") != CORRECTION_ID
            or report.get("ageWitnesses") != {"activeMa": [0], "inactiveMa": [0.000001, 0.001, 1, 16.3]}
            or source.get("bounds") != [-26.753285, 63.150824, -11.869252, 67.261115]
            or source.get("componentCount") != 1 or source.get("holeCount") != 7
            or source.get("rawVertexCount") != 4388 or source.get("simplifiedVertexCount") != 2291
            or source.get("plateVertexCounts") != {"101": 1065, "301": 1248}
            or source.get("relativeAreaError", 1) > 0.0002
            or source.get("hausdorffDistanceDegrees", 1) > 0.005
            or not 113_000 < source.get("rawAreaSquareKilometres", 0) < 114_000):
        fail("validation report", "source topology, simplification, area, or age witnesses changed")
    contract_row = report.get("contract", {})
    if (contract_row.get("path") != CONTRACT.name or contract_row.get("bytes") != CONTRACT.stat().st_size
            or contract_row.get("sha256") != sha(CONTRACT)):
        fail("validation report", "contract identity changed")
    return report


def self_test(contract: dict) -> dict:
    mutations = []
    cases = {
        "backdated shelf": lambda value: value["features"][0]["phaseLifecycles"][
            "classified-shallow-marine"]["validTimeMa"].update({"oldest": 0.001}),
        "land relabel": lambda value: value["features"][0]["surfaceEvidence"].update(
            {"surfaceClass": "land"}),
        "source drift": lambda value: value["sourceAssets"][0]["members"][0].update(
            {"sha256": "0" * 64}),
        "buffer permission": lambda value: value["geometryProcessing"].update(
            {"coastlineMismatchHandling": "buffer the land to close gaps"}),
        "depth certainty": lambda value: value["features"][0]["uncertainty"].update(
            {"depth": "measured exact depths"}),
    }
    for label, mutate in cases.items():
        changed = deepcopy(contract)
        mutate(changed)
        try:
            validate_document(changed, check_assets=False)
        except CorrectionError:
            mutations.append(label)
        else:
            fail("self-test", f"mutation survived: {label}")
    return {"rejectedMutations": mutations}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", action="store_true", help="also verify external source archive bytes")
    parser.add_argument("--self-test", action="store_true", help="prove key semantic mutations fail")
    args = parser.parse_args()
    contract = json.loads(CONTRACT.read_text())
    output = validate_document(contract, check_external=args.sources)
    output["report"] = validate_report()["sourceGeometry"]
    if args.self_test:
        output["selfTest"] = self_test(contract)
    print(json.dumps(output))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate Iceland's observed-modern and age-qualified material correction."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/iceland"
MANIFEST = REGION / "surface-manifest.json"
REPORT = ROOT / "docs/research/regional-iceland-validation.json"
MOTION_REPORT = ROOT / "docs/research/regional-iceland-motion-validation.json"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/regional-iceland-correction-v1/source-inputs"
CORRECTION_ID = "earthhistory-regional-iceland-surface-v1"
PLATES = (101, 301)
KINDS = ("modern", "gold", "gnew", "hraun", "mob")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_PHASES = {
    "modern": {"observed": {"validTimeMa": {"youngest": 0, "oldest": 0}}},
    "gold": {
        "model-pose": {"validTimeMa": {"youngest": 0, "oldest": 3.3}, "youngestExclusive": True},
        "formation": {"validTimeMa": {"youngest": 3.3, "oldest": 16.3}, "youngestExclusive": True},
    },
    "gnew": {
        "model-pose": {"validTimeMa": {"youngest": 0, "oldest": 0.8}, "youngestExclusive": True},
        "formation": {"validTimeMa": {"youngest": 0.8, "oldest": 3.3}, "youngestExclusive": True},
    },
    "hraun": {"formation": {"validTimeMa": {"youngest": 0, "oldest": 0.8},
                              "youngestExclusive": True, "oldestExclusive": True}},
    "mob": {"formation": {"validTimeMa": {"youngest": 0, "oldest": 0.8},
                            "youngestExclusive": True, "oldestExclusive": True}},
}
EXPECTED_ACTIVE = {
    0: {"observed": 2, "model-pose": 0, "formation": 0},
    0.001: {"observed": 0, "model-pose": 4, "formation": 4},
    0.021: {"observed": 0, "model-pose": 4, "formation": 4},
    0.8: {"observed": 0, "model-pose": 4, "formation": 0},
    1: {"observed": 0, "model-pose": 2, "formation": 2},
    3: {"observed": 0, "model-pose": 2, "formation": 2},
    3.3: {"observed": 0, "model-pose": 2, "formation": 2},
    5: {"observed": 0, "model-pose": 0, "formation": 2},
    16.3: {"observed": 0, "model-pose": 0, "formation": 2},
    16.300001: {"observed": 0, "model-pose": 0, "formation": 0},
    20: {"observed": 0, "model-pose": 0, "formation": 0},
}


class CorrectionError(ValueError):
    pass


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fail(label: str, message: str) -> None:
    raise CorrectionError(f"{label}: {message}")


def active(lifecycle: dict, age: float) -> bool:
    valid = lifecycle["validTimeMa"]
    return (valid["youngest"] <= age <= valid["oldest"]
            and not (lifecycle.get("youngestExclusive") is True and age == valid["youngest"])
            and not (lifecycle.get("oldestExclusive") is True and age == valid["oldest"]))


def positions(geometry: dict):
    polygons = [geometry.get("coordinates")] if geometry.get("type") == "Polygon" else geometry.get("coordinates")
    if geometry.get("type") not in {"Polygon", "MultiPolygon"} or not isinstance(polygons, list) or not polygons:
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
                        or not -25 <= position[0] <= -13 or not 63 <= position[1] <= 67):
                    fail("geometry", "position left bounded Iceland WGS84 envelope")
                yield position


def validate_document(manifest: dict, *, check_assets: bool = True, check_external: bool = False) -> dict:
    if manifest.get("schemaVersion") != 1 or manifest.get("correctionId") != CORRECTION_ID:
        fail("manifest", "identity changed")
    baseline = manifest.get("baseline", {})
    if (baseline.get("modelId") != "cao-et-al-2024" or baseline.get("modelVersion") != "2.4"
            or baseline.get("coordinateFrame", {}).get("anchorPlateId") != 0
            or baseline.get("coordinateFrame", {}).get("absoluteFrameId") != "palaeomagnetic"
            or baseline.get("omission") !=
            "neither native source contains a polygon covering central Iceland at 0 Ma"):
        fail("baseline", "model frame or reproduced omission changed")
    omission = baseline.get("omissionWitness", {})
    omission_sources = omission.get("sources", [])
    if (omission.get("witnessLatLon") != [64.9, -18.9] or omission.get("ageMa") != 0
            or [row.get("sourceCollection") for row in omission_sources]
            != ["shapes_coasts.gpmlz", "shapes_continents.gpmlz"]
            or any(row.get("coveringPolygonCount") != 0
                   or row.get("nearestGeometryDistanceKilometres", 0) < 300
                   or not SHA256.fullmatch(row.get("sha256", "")) for row in omission_sources)):
        fail("baseline.omissionWitness", "raw Cao central-Iceland omission is not executable and bounded")
    source_ids = {row.get("sourceId") for row in manifest.get("sourceAssets", [])}
    reference_ids = {row.get("sourceId") for row in manifest.get("references", [])}
    if (source_ids != {"natural-earth-countries-50m", "iinh-iceland-bedrock-age-500k"}
            or reference_ids != {"moorbath-et-al-1968", "hardarson-et-al-2008", "blischke-et-al-2022"}):
        fail("sources", "required geometry, age, and ridge-history sources changed")
    natural_earth = next(row for row in manifest["sourceAssets"]
                         if row["sourceId"] == "natural-earth-countries-50m")
    if (natural_earth.get("path") != "ne_50m_admin_0_countries.zip"
            or natural_earth.get("publicationOrVersionDate") != "5.1.1"
            or natural_earth.get("bytes") != 799734
            or natural_earth.get("sha256") !=
            "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"):
        fail("sources.naturalEarth", "pinned 1:50m archive identity or version changed")
    iinh = next(row for row in manifest["sourceAssets"]
                if row["sourceId"] == "iinh-iceland-bedrock-age-500k")
    expected_members = {"bedrock-old.geojson", "bedrock-young.geojson", "wfs-capabilities.xml",
                        "wms-capabilities.xml", "bedrock-style.sld", "bedrock-metadata.xml"}
    if ({row.get("path") for row in iinh.get("members", [])} != expected_members
            or "2014" not in iinh.get("publicationOrVersionDate", "")):
        fail("sources.iinh", "2014 revision or complete pinned evidence-member inventory is missing")
    for source in [*manifest["sourceAssets"], *manifest["references"]]:
        temporal = source.get("temporalRangeMa")
        if (not source.get("publicationOrVersionDate") or not source.get("retrievedAt")
                or not source.get("geographicBasis") or not source.get("license")
                or not isinstance(temporal, list) or len(temporal) != 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float))
                       or not math.isfinite(value) for value in temporal)
                or temporal[0] < temporal[1]):
            fail(source.get("sourceId", "source"), "provenance metadata is incomplete")
    if "16.0 ± 0.3 Ma" not in next(row for row in manifest["references"]
            if row["sourceId"] == "moorbath-et-al-1968")["evidenceRole"]:
        fail("references.moorbath", "oldest exposed-rock uncertainty is missing")
    geometry_assets = {(feature["geometryAsset"]["path"], feature["geometryAsset"]["bytes"],
                        feature["geometryAsset"]["sha256"]) for feature in manifest.get("features", [])}
    if len(geometry_assets) != 1:
        fail("features.geometryAsset", "all features must share one exact compact asset")
    geometry_name, geometry_bytes, geometry_sha = next(iter(geometry_assets))
    if not isinstance(geometry_bytes, int) or geometry_bytes <= 0 or not SHA256.fullmatch(geometry_sha or ""):
        fail("features.geometryAsset", "invalid bytes or SHA-256")
    if check_assets:
        geometry_path = REGION / geometry_name
        if (not geometry_path.is_file() or geometry_path.stat().st_size != geometry_bytes
                or sha(geometry_path) != geometry_sha):
            fail("features.geometryAsset", "tracked asset identity changed")
        document = json.loads(geometry_path.read_text())
        geometry_features = {feature.get("id"): feature for feature in document.get("features", [])}
        if document.get("type") != "FeatureCollection" or len(geometry_features) != 10:
            fail("geometry", "expected ten unique plate-partitioned features")
    else:
        geometry_features = {}
    expected_ids = {f"iceland-{kind}-plate-{plate}" for kind in KINDS for plate in PLATES}
    feature_rows = {feature.get("correctionFeatureId"): feature for feature in manifest.get("features", [])}
    if set(feature_rows) != expected_ids or len(feature_rows) != 10:
        fail("features", "expected exact kind-by-plate feature matrix")
    for identifier in sorted(expected_ids):
        feature = feature_rows[identifier]
        kind = identifier.split("-")[1]
        plate = int(identifier.rsplit("-", 1)[1])
        observed = kind == "modern"
        if (feature.get("phaseLifecycles") != EXPECTED_PHASES[kind]
                or feature.get("pose", {}).get("plateId") != plate
                or feature.get("pose", {}).get("method") != "cao-rigid-plate-motion"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("materialRole") !=
                    ("observed-exposed-land" if observed else "volcanic-island-material-support")
                or feature.get("epistemicStatus") != ("observed" if observed else "model-inference")
                or feature.get("surfaceEvidence", {}).get("kind") != ("observed" if observed else "unknown")
                or (observed and feature.get("surfaceEvidence", {}).get("surfaceClass") != "land")
                or (observed and feature.get("surfaceEvidence", {}).get("sourceIds")
                    != ["natural-earth-countries-50m"])):
            fail(identifier, "lifecycle, plate, or evidence semantics changed")
        if check_assets:
            source = geometry_features.get(identifier)
            if (source is None or source.get("properties", {}).get("plateId") != plate
                    or source.get("properties", {}).get("sourceClass") != kind
                    or not any(True for _ in positions(source.get("geometry", {})))):
                fail(identifier, "compiled geometry identity changed")
    counts = {}
    for age, expected in EXPECTED_ACTIVE.items():
        actual = {phase: 0 for phase in expected}
        for feature in feature_rows.values():
            for phase, lifecycle in feature["phaseLifecycles"].items():
                if active(lifecycle, age):
                    actual[phase] += 1
        if actual != expected:
            fail(f"age {age}", f"expected {expected}, found {actual}")
        counts[str(age)] = actual
    if check_assets:
        for source in manifest["sourceAssets"] if check_external else []:
            members = source.get("members", [source])
            for member in members:
                path = POOL / member["path"]
                if (not path.is_file() or path.stat().st_size != member["bytes"]
                        or sha(path) != member["sha256"]):
                    fail(member["path"], "offline source fixture changed")
        report = json.loads(REPORT.read_text())
        source_geometry = report.get("sourceGeometry", {})
        if (report.get("correctionId") != CORRECTION_ID
                or report.get("geometry") != {"path": geometry_name, "bytes": geometry_bytes,
                                                "sha256": geometry_sha}
                or not 0.62 < source_geometry.get(
                    "selectedBedrockCoverageOfModernGeneralizedLandFraction", 0) < 0.65
                or source_geometry.get("naturalEarthIcelandVertexCount", 0) < 400
                or "1:110m" not in source_geometry.get("historicalCoverageMetricBasis", "")
                or source_geometry.get("uncoveredSemantics") !=
                    "unclassified by this bounded correction; not confirmed sea or absent substrate"
                or report.get("baselineOmissionWitness") != omission):
            fail("validation report", "coverage or gap semantics changed")
    return {"features": len(feature_rows), "activeChartCounts": counts,
            "geometrySha256": geometry_sha}


def batch_chart_indices(path: Path, vertex_count: int) -> set[int]:
    payload = path.read_bytes()
    expected_bytes = 32 + 20 * vertex_count
    if payload[:4] != b"EHGB" or len(payload) < expected_bytes:
        fail(path.name, "invalid correction geometry header")
    chart_offset = 32 + 16 * vertex_count
    return {int.from_bytes(payload[offset:offset + 4], "little")
            for offset in range(chart_offset, chart_offset + 4 * vertex_count, 4)}


def validate_generated_catalog(manifest: dict, catalog: dict, package_dir: Path | None = None) -> dict:
    expected = {}
    for feature in manifest["features"]:
        for phase, lifecycle in feature["phaseLifecycles"].items():
            emitted = ("observed-exposed-land" if phase == "observed" else
                       "source-qualified-material" if phase in {"qualified", "model-pose"} else
                       "formation-uncertain")
            expected[f"correction:{CORRECTION_ID}:{feature['correctionFeatureId']}:{phase}"] = (
                emitted, lifecycle, feature["pose"]["plateId"], feature["surfaceEvidence"])
    charts = {chart["chartId"]: chart for chart in catalog.get("charts", [])
              if chart.get("evidence", {}).get("correction", {}).get("correctionId") == CORRECTION_ID}
    if set(charts) != set(expected):
        fail("generated catalog", "Iceland chart set changed")
    for chart_id, (phase, lifecycle, plate, surface) in expected.items():
        chart = charts[chart_id]
        bindings = chart.get("motionBindings", [])
        if (chart.get("lifecycle") != lifecycle or chart.get("surfaceEvidence") != surface
                or chart.get("evidence", {}).get("correction", {}).get("phase") != phase
                or (phase != "observed-exposed-land"
                    and chart.get("evidence", {}).get("correction", {}).get("poseStatus") != "model-inference")
                or not bindings or any(binding.get("paletteId") != catalog.get("baseline", {}).get(
                    "motionPaletteId") for binding in bindings)
                or chart.get("fragmentOrCohortId") != chart_id.split(":")[-2]
                or not all(binding.get("entryId", "").startswith(f"plate-{plate}-") for binding in bindings)):
            fail(chart_id, "generated lifecycle, evidence, or motion binding changed")
    batches = {batch.get("batchId") for batch in catalog.get("spatialBatches", [])}
    if not {"material-correction-observed", "material-correction-qualified",
            "material-correction-uncertain"}.issubset(batches):
        fail("generated catalog", "observed, qualified, or uncertain batch missing")
    expected_colors = {
        "material-correction-observed": [0.45, 0.55, 0.3],
        "material-correction-qualified": [0.45, 0.55, 0.3],
        "material-correction-uncertain": [0.45, 0.55, 0.3],
    }
    by_id = {batch["batchId"]: batch for batch in catalog["spatialBatches"]}
    for batch_id, color in expected_colors.items():
        if by_id[batch_id].get("staticDisplayControl", {}).get("baseColorRgb") != color:
            fail(batch_id, "uniform land color changed")
    if package_dir is not None:
        core = json.loads((package_dir / "core.json").read_text())
        native_count = len(core["charts"])
        chart_indices = {chart["chartId"]: native_count + index
                         for index, chart in enumerate(catalog["charts"])}
        actual = {}
        for batch_id, batch in by_id.items():
            geometry = package_dir / batch["geometryAsset"]["url"]
            if (not geometry.is_file() or geometry.stat().st_size != batch["geometryAsset"]["bytes"]
                    or sha(geometry) != batch["geometryAsset"]["sha256"]):
                fail(batch_id, "geometry identity changed")
            actual[batch_id] = batch_chart_indices(geometry, batch["vertexCount"])
        for chart_id, expected_batch in ((chart_id,
                "material-correction-observed" if chart_id.endswith(":observed")
                else "material-correction-uncertain") for chart_id in expected):
            index = chart_indices[chart_id]
            containing = [batch_id for batch_id, indices in actual.items() if index in indices]
            if containing != [expected_batch]:
                fail(chart_id, f"expected only {expected_batch}, found {containing}")
    return {"charts": len(charts), "batches": sorted(batches)}


def validate(runtime: bool, package_dir: Path = PUBLIC, external_sources: bool = False) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    result = validate_document(manifest, check_external=external_sources)
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog_path = package_dir / package["materialCorrections"]["catalog"]["url"]
        result["generated"] = validate_generated_catalog(
            manifest, json.loads(catalog_path.read_text()), package_dir)
        motion = json.loads(MOTION_REPORT.read_text())
        assets = motion.get("packageAssets", {})
        if (motion.get("correctionId") != CORRECTION_ID
                or motion.get("testedPlateIds") != list(PLATES)
                or motion.get("maximumAngularResidualRadians", math.inf)
                    > motion.get("acceptanceLimitRadians", 0)
                or assets.get("core") != package.get("core")
                or assets.get("motionPaletteCatalog") != package.get("motionPalette", {}).get("catalog")
                or assets.get("motionPaletteBinary") != package.get("motionPalette", {}).get("binary")
                or assets.get("materialCorrectionCatalog")
                    != package.get("materialCorrections", {}).get("catalog")):
            fail("motion validation", "direct Cao 101/301 oracle or package identity changed")
        result["motion"] = {"maximumAngularResidualRadians":
                            motion["maximumAngularResidualRadians"]}
    return result


def self_test(runtime: bool = False, package_dir: Path = PUBLIC) -> None:
    source = json.loads(MANIFEST.read_text())
    cases = {
        "source hash": lambda value: value["features"][0]["geometryAsset"].update({"sha256": "0" * 64}),
        "Natural Earth archive": lambda value: next(row for row in value["sourceAssets"]
            if row["sourceId"] == "natural-earth-countries-50m").update({"sha256": "0" * 64}),
        "plate partition": lambda value: value["features"][0]["pose"].update({"plateId": 102}),
        "modern backdating": lambda value: value["features"][0]["phaseLifecycles"]["observed"]
            ["validTimeMa"].update({"oldest": 0.001}),
        "false pale exposure": lambda value: value["features"][2]["surfaceEvidence"].update({"kind": "observed"}),
        "formation endpoint": lambda value: value["features"][2]["phaseLifecycles"]["formation"]
            ["validTimeMa"].update({"oldest": 20}),
        "omission witness": lambda value: value["baseline"]["omissionWitness"]["sources"][0]
            .update({"coveringPolygonCount": 1}),
        "reference time basis": lambda value: value["references"][0].update({"temporalRangeMa": []}),
    }
    for label, mutate in cases.items():
        candidate = deepcopy(source)
        mutate(candidate)
        try:
            validate_document(candidate, check_assets=False)
        except CorrectionError:
            continue
        fail("self-test", f"{label} mutation was accepted")
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog_path = package_dir / package["materialCorrections"]["catalog"]["url"]
        catalog = json.loads(catalog_path.read_text())
        cases = {
            "inferred pose relabel": lambda value: next(chart for chart in value["charts"]
                if chart["chartId"].startswith(f"correction:{CORRECTION_ID}:")
                and chart["chartId"].endswith(":model-pose"))["evidence"]["correction"]
                .update({"poseStatus": "source-qualified"}),
            "uncertain color": lambda value: next(batch for batch in value["spatialBatches"]
                if batch["batchId"] == "material-correction-uncertain")["staticDisplayControl"]
                .update({"baseColorRgb": [0.58, 0.52, 0.28]}),
            "generated observed backdating": lambda value: next(chart for chart in value["charts"]
                if chart["chartId"].startswith(f"correction:{CORRECTION_ID}:")
                and chart["chartId"].endswith(":observed"))["lifecycle"]["validTimeMa"]
                .update({"oldest": 0.001}),
        }
        for label, mutate in cases.items():
            candidate = deepcopy(catalog)
            mutate(candidate)
            try:
                validate_generated_catalog(source, candidate, package_dir)
            except CorrectionError:
                continue
            fail("self-test", f"generated {label} mutation was accepted")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--runtime", action="store_true")
    parser.add_argument("--sources", action="store_true")
    parser.add_argument("--package", type=Path, default=PUBLIC)
    args = parser.parse_args()
    if args.self_test:
        self_test(args.runtime, args.package)
        print("regional-iceland-correction: mutation self-test passed")
        return
    print(json.dumps(validate(args.runtime, args.package, args.sources), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

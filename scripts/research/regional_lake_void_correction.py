#!/usr/bin/env python3
"""Validate the lake-void infill correction.

The correction fills, with the land appearance, the voids that large modern
lakes leave between Cao v2.4 coast polygons, but only at ages older than each
lake's cited onset (present-only by default). It runs from a clean checkout
against tracked inputs only; ``--runtime`` additionally checks the generated
public correction catalog and the batch that owns each chart.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/lake-voids"
MANIFEST = REGION / "lake-voids-manifest.json"
ONSETS = REGION / "lake-onsets.json"
REPORT = ROOT / "docs/research/regional-lake-void-infill-validation.json"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"

CORRECTION_ID = "earthhistory-lake-void-infill-v1"
SOURCE_TYPE = "EarthHistoryLakeVoidInfill"
GEOMETRY_NAME = "lake-voids-v1.geojson"
REQUIRED_SOURCE_IDS = {"natural-earth-lakes-10m", "cao-v2.4-native-coasts",
                       "cao-v2.4-native-continents", "cao-v2.4-static-partitions"}
NATURAL_EARTH_SHA256 = "2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9"
COAST_SHA256 = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
CONTINENT_SHA256 = "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"
STATIC_SHA256 = "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"
ROTATION_SHA256 = "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"
PACKAGE_OLDEST_MA = 1800.0

SELECTION_POLICY = {
    "minimumLakeSquareKilometres": 100.0,
    "minimumVoidFraction": 0.5,
    "minimumComponentLakeFraction": 0.6,
    "minimumEmittedPartSquareKilometres": 25.0,
    "clipBufferDegrees": 0.02,
}

# Reviewed inventory bounds: 48 lakes at 1:10m, 101 partition pieces, about
# 715,000 km² of void. The exact feature-id set is pinned below.
EXPECTED_FEATURE_COUNT = 101
EXPECTED_LAKE_COUNT = 48
MIN_TOTAL_AREA_KM2 = 650_000.0
MAX_TOTAL_AREA_KM2 = 780_000.0

# Lakes the user reported, plus three controls on other continents. Each witness
# point must be covered by an infill piece bound to one of the listed plates.
LAKE_WITNESSES = {
    "victoria": ((33.0, -1.0), {712}),
    "tanganyika": ((29.7, -6.0), {701, 712}),
    "malawi": ((34.5, -12.0), {701, 713, 77011}),
    "turkana": ((36.1, 3.5), {709, 712}),
    "albert": ((30.9, 1.7), {701, 712}),
    "superior": ((-87.5, 47.7), {101}),
    "baikal": ((108.0, 53.5), {401}),
    "ladoga": ((31.5, 60.9), {30202}),
}
# Native Cao land near the lakes; the infill must never absorb it.
NATIVE_WITNESSES = {
    "kampala": (32.6, 0.3),
    "nairobi": (36.8, -1.3),
    "dodoma": (35.7, -6.2),
    "kigoma": (29.63, -4.88),
    "lilongwe": (33.8, -13.98),
    "irkutsk": (104.3, 52.3),
    "thunder-bay": (-89.25, 48.38),
}
# The present day is never filled; these ages must always find every chart
# inactive at 0 Ma and active at every age older than its onset.
PRESENT_AGES = (0,)
OLDER_PROBE_AGES = (0.000001, 0.021, 5, 74, 300)


class CorrectionError(ValueError):
    pass


def fail(label: str, message: str) -> None:
    raise CorrectionError(f"{label}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def active(lifecycle: dict, age: float) -> bool:
    valid = lifecycle["validTimeMa"]
    lower = valid["youngest"] < age if lifecycle.get("youngestExclusive") else valid["youngest"] <= age
    upper = age < valid["oldest"] if lifecycle.get("oldestExclusive") else age <= valid["oldest"]
    return lower and upper


def rings_of(geometry: dict):
    if geometry.get("type") == "Polygon":
        return list(geometry.get("coordinates", []))
    if geometry.get("type") == "MultiPolygon":
        return [ring for polygon in geometry.get("coordinates", []) for ring in polygon]
    return []


def polygons_of(geometry: dict):
    if geometry.get("type") == "Polygon":
        return [geometry.get("coordinates", [])]
    if geometry.get("type") == "MultiPolygon":
        return list(geometry.get("coordinates", []))
    return []


def point_in_ring(ring: list, longitude: float, latitude: float) -> bool:
    inside = False
    count = len(ring)
    for index in range(count - 1):
        x1, y1 = ring[index][:2]
        x2, y2 = ring[index + 1][:2]
        if (y1 > latitude) != (y2 > latitude):
            crossing = x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)
            if crossing > longitude:
                inside = not inside
    return inside


def polygon_contains(polygon: list, longitude: float, latitude: float) -> bool:
    if not polygon or not point_in_ring(polygon[0], longitude, latitude):
        return False
    return not any(point_in_ring(hole, longitude, latitude) for hole in polygon[1:])


def containing_features(document: dict, longitude: float, latitude: float) -> list[dict]:
    return [feature for feature in document.get("features", [])
            if any(polygon_contains(polygon, longitude, latitude)
                   for polygon in polygons_of(feature.get("geometry", {})))]


def validate_document(manifest: dict, *, check_assets: bool = True,
                      region: Path | None = None) -> dict:
    if (manifest.get("schemaVersion") != 1 or manifest.get("version") != "1"
            or manifest.get("correctionId") != CORRECTION_ID
            or manifest.get("attribution") != "Made with Natural Earth; Cao et al. (2024)."):
        fail("manifest", "identity, version, or attribution changed")
    baseline = manifest.get("baseline", {})
    if (baseline.get("modelId") != "cao-et-al-2024" or baseline.get("modelVersion") != "2.4"
            or baseline.get("coastSourceSha256") != COAST_SHA256
            or baseline.get("continentSourceSha256") != CONTINENT_SHA256
            or baseline.get("staticSourceSha256") != STATIC_SHA256
            or baseline.get("rotationSourceSha256") != ROTATION_SHA256
            or baseline.get("coordinateFrame", {}).get("anchorPlateId") != 0
            or baseline.get("coordinateFrame", {}).get("absoluteFrameId") != "palaeomagnetic"
            or "inside the continental-outline underlay" not in baseline.get("defect", "")):
        fail("baseline", "pinned Cao source identity, reference frame, or defect claim changed")

    sources = {row.get("sourceId"): row for row in manifest.get("sourceAssets", [])}
    if set(sources) != REQUIRED_SOURCE_IDS:
        fail("sourceAssets", "required source set changed")
    lakes_source = sources["natural-earth-lakes-10m"]
    if (lakes_source.get("sha256") != NATURAL_EARTH_SHA256 or lakes_source.get("bytes") != 5043554
            or lakes_source.get("license") != "Public domain" or lakes_source.get("retrievedAt") != "2026-09-14"
            or lakes_source.get("temporalRangeMa") != [0, 0]):
        fail("sourceAssets.naturalEarth", "identity, license, or exact-present scope changed")
    if (sources["cao-v2.4-native-coasts"].get("sha256") != COAST_SHA256
            or sources["cao-v2.4-native-continents"].get("sha256") != CONTINENT_SHA256):
        fail("sourceAssets.cao.geometry", "native coast or continent identity changed")
    members = {row.get("path"): row for row in sources["cao-v2.4-static-partitions"].get("members", [])}
    if (members.get("static_polygons.gpmlz", {}).get("sha256") != STATIC_SHA256
            or members.get("1000_0_rotfile.rot", {}).get("sha256") != ROTATION_SHA256):
        fail("sourceAssets.cao.static", "static partition or rotation identity changed")
    if any(row.get("license") != "CC BY 4.0" for key, row in sources.items() if key.startswith("cao-")):
        fail("sourceAssets.cao", "license changed")

    policy = manifest.get("onsetPolicy", {})
    if "present-only" not in policy.get("default", "") or not isinstance(policy.get("curatedOnsets"), list):
        fail("onsetPolicy", "default onset policy or curated table changed shape")
    curated = {row.get("lake"): row for row in policy["curatedOnsets"]}
    for name, row in curated.items():
        if (not isinstance(row.get("onsetMa"), (int, float)) or row["onsetMa"] <= 0
                or not row.get("sourceIds") or not row.get("evidence")):
            fail(f"onsetPolicy.curatedOnsets.{name}", "a curated onset needs a positive age, evidence and sources")

    processing = manifest.get("geometryProcessing", {})
    if (processing.get("selectionPolicy") != SELECTION_POLICY
            or "minus the Cao coast polygons active at 0 Ma" not in processing.get("operation", "")
            or "retain native coast charts" not in processing.get("nativeOverlapPrecedence", "")
            or "no lake, shelf, shallow-water" not in processing.get("waterSemantics", "")
            or "does not alter any country reference chart" not in processing.get("countryReferenceImplication", "")
            or processing.get("roundingDecimalDegrees") != 6):
        fail("geometryProcessing", "selection policy, native precedence, water semantics, or consumer contract changed")
    if any(not row.get("reason") for row in processing.get("skippedLakes", [])):
        fail("geometryProcessing.skippedLakes", "every skipped lake must record its reason")

    features = {row.get("correctionFeatureId"): row for row in manifest.get("features", [])}
    if len(features) != EXPECTED_FEATURE_COUNT or len(features) != len(manifest.get("features", [])):
        fail("features", f"emitted inventory changed ({len(features)} != {EXPECTED_FEATURE_COUNT})")
    lakes = {row.get("lake") for row in features.values()}
    if len(lakes) != EXPECTED_LAKE_COUNT:
        fail("features", f"lake count changed ({len(lakes)} != {EXPECTED_LAKE_COUNT})")
    asset_rows = {(row.get("geometryAsset", {}).get("path"), row.get("geometryAsset", {}).get("bytes"),
                   row.get("geometryAsset", {}).get("sha256")) for row in features.values()}
    if len(asset_rows) != 1:
        fail("features.geometryAsset", "every feature must share one tracked geometry asset")
    geometry_name, geometry_bytes, geometry_sha = next(iter(asset_rows))
    if geometry_name != GEOMETRY_NAME or not isinstance(geometry_bytes, int) or geometry_bytes <= 0:
        fail("features.geometryAsset", "invalid geometry asset")

    for identifier, feature in features.items():
        phases = feature.get("phaseLifecycles", {})
        lifecycle = phases.get("qualified")
        pose = feature.get("pose", {})
        onset = feature.get("onset", {})
        if (feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("epistemicStatus") != "model-inference"
                or feature.get("materialRole") != "lake-void-infill"
                or set(phases) != {"qualified"} or not isinstance(lifecycle, dict)
                or lifecycle.get("youngestExclusive") is not True
                or feature.get("surfaceEvidence", {}).get("kind") != "unknown"
                or not isinstance(pose.get("plateId"), int) or isinstance(pose.get("plateId"), bool)
                or pose.get("method") != "cao-rigid-plate-motion"
                or not pose.get("touchingNativeCoastChartIds")
                or "never a reconstructed shoreline" not in pose.get("warning", "")
                or not REQUIRED_SOURCE_IDS <= set(feature.get("sourceIds", []))
                or not feature.get("rejectionConditions")
                or "the infill is active at 0 Ma" not in feature["rejectionConditions"]):
            fail(identifier, "evidence, lifecycle, pose, or material semantics changed")
        valid = lifecycle.get("validTimeMa", {})
        youngest, oldest = valid.get("youngest"), valid.get("oldest")
        if (not isinstance(youngest, (int, float)) or not isinstance(oldest, (int, float))
                or youngest < 0 or oldest <= youngest or oldest > PACKAGE_OLDEST_MA):
            fail(identifier, "lifecycle must run from the onset to at most the package oldest age")
        if onset.get("ageMa") != youngest:
            fail(identifier, "lifecycle youngest must equal the recorded onset age")
        if youngest == 0 and onset.get("evidence") != "present-only default":
            fail(identifier, "a zero onset must be the present-only default")
        if youngest > 0:
            row = curated.get(feature.get("lake"))
            if row is None or row["onsetMa"] != youngest or set(row["sourceIds"]) - set(feature["sourceIds"]):
                fail(identifier, "a curated onset must match the onset table and cite its sources")
        if any(active(lifecycle, age) for age in PRESENT_AGES):
            fail(identifier, "the infill is active at 0 Ma")
        if not all(active(lifecycle, age) for age in OLDER_PROBE_AGES if youngest < age <= oldest):
            fail(identifier, "the infill is inactive inside its own lifecycle")

    if check_assets:
        path = (region or REGION) / geometry_name
        if not path.is_file() or path.stat().st_size != geometry_bytes or sha(path) != geometry_sha:
            fail("features.geometryAsset", "tracked geometry identity changed")
        document = json.loads(path.read_text())
        rows = {row.get("id"): row for row in document.get("features", [])}
        if document.get("type") != "FeatureCollection" or set(rows) != set(features):
            fail("geometry", "tracked correction feature set changed")
        total = 0.0
        for identifier, feature in features.items():
            row = rows[identifier]
            properties = row.get("properties", {})
            lifecycle = feature["phaseLifecycles"]["qualified"]["validTimeMa"]
            if (properties.get("correctionFeatureId") != identifier
                    or properties.get("plateId") != feature["pose"]["plateId"]
                    or properties.get("lake") != feature.get("lake")
                    or properties.get("surfaceClass") != "land"
                    or properties.get("sourceClass") != "cao-void-inside-continental-outline"
                    or properties.get("validTimeMa", {}).get("youngest") != lifecycle["youngest"]
                    or properties.get("validTimeMa", {}).get("oldest") != lifecycle["oldest"]
                    or properties.get("validTimeMa", {}).get("youngestExclusive") is not True
                    or not polygons_of(row.get("geometry", {}))
                    or any(len(ring) < 4 or ring[0][:2] != ring[-1][:2] for ring in rings_of(row["geometry"]))):
                fail(identifier, "geometry properties, lifecycle, or rings changed")
            total += float(properties.get("emittedAreaSquareKilometres", 0))
        if not MIN_TOTAL_AREA_KM2 < total < MAX_TOTAL_AREA_KM2:
            fail("geometry", f"total emitted area {total:.0f} km² left its reviewed bound")
        for label, ((longitude, latitude), plates) in LAKE_WITNESSES.items():
            hits = containing_features(document, longitude, latitude)
            if len(hits) != 1:
                fail("geometry", f"lake witness {label} is covered by {len(hits)} infill pieces, expected 1")
            if hits[0]["properties"].get("plateId") not in plates:
                fail("geometry", f"lake witness {label} is bound to plate {hits[0]['properties'].get('plateId')}")
        for label, (longitude, latitude) in NATIVE_WITNESSES.items():
            if containing_features(document, longitude, latitude):
                fail("geometry", f"native witness {label} was absorbed by the infill")
    return {"features": len(features), "lakes": len(lakes), "geometryBytes": geometry_bytes,
            "curatedOnsets": len(curated)}


def batch_chart_indices(path: Path, vertex_count: int) -> set[int]:
    import struct
    data = path.read_bytes()
    offset = 32 + vertex_count * 16
    return set(struct.unpack_from(f"<{vertex_count}I", data, offset))


def validate_generated_catalog(manifest: dict, catalog: dict, package_dir: Path | None = None) -> dict:
    palette_plates: dict[str, int] = {}
    entries: dict[str, dict] = {}
    if package_dir is not None:
        palette = json.loads((package_dir / "motion-palette.json").read_text())
        entries = {entry["entryId"]: entry for entry in palette["entries"]}
        palette_plates = {entry_id: entry["plateId"] for entry_id, entry in entries.items()}
    expected = {f"correction:{CORRECTION_ID}:{feature['correctionFeatureId']}:qualified": feature
                for feature in manifest["features"]}
    charts = {chart["chartId"]: chart for chart in catalog.get("charts", [])
              if chart.get("evidence", {}).get("correction", {}).get("correctionId") == CORRECTION_ID}
    if set(charts) != set(expected):
        fail("generated catalog", "lake-void infill chart set changed")
    for chart_id, feature in expected.items():
        chart = charts[chart_id]
        bindings = chart.get("motionBindings", [])
        plate = feature["pose"]["plateId"]
        lifecycle = feature["phaseLifecycles"]["qualified"]
        correction = chart.get("evidence", {}).get("correction", {})
        if (chart.get("lifecycle") != lifecycle
                or chart.get("surfaceEvidence") != feature["surfaceEvidence"]
                or chart.get("geometryReferenceAgeMa") != 0
                or correction.get("phase") != "source-qualified-material"
                or correction.get("materialStatus") != "supported"
                or correction.get("poseStatus") != "model-inference"
                or correction.get("lakeOnsetMa") != lifecycle["validTimeMa"]["youngest"]
                or chart.get("sourceFeatureTypes") != [SOURCE_TYPE]
                or chart.get("fragmentOrCohortId") != feature["correctionFeatureId"]
                or not bindings
                or any(binding.get("paletteId") != catalog.get("baseline", {}).get("motionPaletteId")
                       for binding in bindings)
                or (palette_plates and any(palette_plates.get(binding.get("entryId")) != plate
                                           for binding in bindings))):
            fail(chart_id, "generated lifecycle, evidence, or motion binding changed")
        ordered = sorted(bindings, key=lambda binding: binding["validTimeMa"]["youngest"])
        cursor = lifecycle["validTimeMa"]["youngest"]
        for binding in ordered:
            if binding["validTimeMa"]["youngest"] != cursor:
                fail(chart_id, "motion bindings do not partition the lifecycle")
            cursor = binding["validTimeMa"]["oldest"]
        if cursor != lifecycle["validTimeMa"]["oldest"]:
            fail(chart_id, "motion bindings stop before the lifecycle oldest age")
    if CORRECTION_ID not in catalog.get("correctionIds", []):
        fail("generated catalog", "correction identity is absent from the catalog")
    if package_dir is not None:
        core = json.loads((package_dir / "core.json").read_text())
        indices = {row["chartId"]: len(core["charts"]) + index
                   for index, row in enumerate(catalog["charts"])}
        members = {}
        for batch in catalog["spatialBatches"]:
            geometry = package_dir / batch["geometryAsset"]["url"]
            if (not geometry.is_file() or geometry.stat().st_size != batch["geometryAsset"]["bytes"]
                    or sha(geometry) != batch["geometryAsset"]["sha256"]):
                fail(batch["batchId"], "geometry identity changed")
            members[batch["batchId"]] = batch_chart_indices(geometry, batch["vertexCount"])
        for chart_id in expected:
            containing = [batch_id for batch_id, rows in members.items() if indices[chart_id] in rows]
            if containing != ["material-correction-qualified"]:
                fail(chart_id, f"expected only material-correction-qualified, found {containing}")
    return {"charts": len(charts)}


def validate(runtime: bool, package_dir: Path = PUBLIC) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    result = validate_document(manifest)
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog = json.loads((package_dir / package["materialCorrections"]["catalog"]["url"]).read_text())
        result |= validate_generated_catalog(manifest, catalog, package_dir)
    return result


def expect_failure(label: str, manifest: dict, *, region: Path | None = None) -> None:
    try:
        validate_document(manifest, region=region)
    except CorrectionError:
        return
    raise CorrectionError(f"self-test: mutation {label!r} was accepted")


def self_test(runtime: bool = False, package_dir: Path = PUBLIC) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    validate_document(manifest)
    mutations = []

    mutated = deepcopy(manifest)
    mutated["features"][0]["phaseLifecycles"]["qualified"]["youngestExclusive"] = False
    mutations.append(("infill active at 0 Ma", mutated))

    mutated = deepcopy(manifest)
    mutated["features"][0]["phaseLifecycles"]["qualified"]["validTimeMa"]["oldest"] = 1801
    mutated["features"][0]["onset"]["ageMa"] = mutated["features"][0]["phaseLifecycles"]["qualified"]["validTimeMa"]["youngest"]
    mutations.append(("lifecycle beyond the package oldest age", mutated))

    mutated = deepcopy(manifest)
    mutated["features"][0]["phaseLifecycles"]["qualified"]["validTimeMa"]["youngest"] = 9.0
    mutated["features"][0]["onset"]["ageMa"] = 9.0
    mutations.append(("uncited onset", mutated))

    mutated = deepcopy(manifest)
    mutated["features"][0]["pose"]["plateId"] += 1
    mutations.append(("plate changed against geometry", mutated))

    mutated = deepcopy(manifest)
    mutated["features"] = mutated["features"][1:]
    mutations.append(("feature removed", mutated))

    mutated = deepcopy(manifest)
    mutated["baseline"]["coastSourceSha256"] = "0" * 64
    mutations.append(("native coast source changed", mutated))

    for label, document in mutations:
        expect_failure(label, document)

    with tempfile.TemporaryDirectory(prefix="earthhistory-lake-voids-") as scratch:
        region = Path(scratch)
        geometry = json.loads((REGION / GEOMETRY_NAME).read_text())
        victim = next(feature for feature in geometry["features"]
                      if feature["properties"]["lake"] == "Lake Victoria"
                      and feature["properties"]["emittedAreaSquareKilometres"] > 10_000)
        for polygon in polygons_of(victim["geometry"]):
            for ring in polygon:
                for position in ring:
                    position[0] += 3.0
        path = region / GEOMETRY_NAME
        path.write_text(json.dumps(geometry))
        mutated = deepcopy(manifest)
        for feature in mutated["features"]:
            feature["geometryAsset"]["bytes"] = path.stat().st_size
            feature["geometryAsset"]["sha256"] = sha(path)
        expect_failure("lake witness moved off Lake Victoria", mutated, region=region)

    result = {"mutationsRejected": len(mutations) + 1}
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog = json.loads((package_dir / package["materialCorrections"]["catalog"]["url"]).read_text())
        validate_generated_catalog(manifest, catalog, package_dir)
        broken = deepcopy(catalog)
        target = next(chart for chart in broken["charts"]
                      if chart["evidence"]["correction"]["correctionId"] == CORRECTION_ID)
        target["lifecycle"]["youngestExclusive"] = False
        try:
            validate_generated_catalog(manifest, broken, package_dir)
        except CorrectionError:
            result["runtimeMutationRejected"] = True
        else:
            raise CorrectionError("self-test: a present-active generated chart was accepted")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--runtime", action="store_true")
    parser.add_argument("--package", type=Path, default=PUBLIC)
    parser.add_argument("--report", action="store_true", help="write the tracked validation record")
    args = parser.parse_args()
    result = self_test(args.runtime, args.package) if args.self_test else validate(args.runtime, args.package)
    if args.report:
        REPORT.write_text(json.dumps({"correctionId": CORRECTION_ID, "validatedAt": "2026-09-14",
                                      "runtime": args.runtime, **result}, indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

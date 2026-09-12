#!/usr/bin/env python3
"""Validate and apply six exact-identity Cao shelf lifecycle repairs at 422 Ma."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import pygplates

sys.path.insert(0, str(Path(__file__).resolve().parent))
import emit_cao_foundation_package as foundation


ROOT = Path(__file__).resolve().parents[2]
MODEL = foundation.MODEL
CONTRACT = ROOT / "data/corrections/cao-shelf-422/lifecycle-contract.json"
DEFAULT_PACKAGE = ROOT / "public/data/reconstruction/cao-v2.4"
SOURCE_ID = "cao-v2.4:COBfile_1800_0.gpml"
INTERVAL_PREFIX = "cao-shelf-422-clock"
ENTRY_PREFIX = "cao-shelf-422-plate"
SCOPE_CLAUSE = (
    "Six exact-identity Cao 422 Ma continental-outline shelf lifecycles use "
    "COBfile validity through 600 Ma; depth and exposure remain unknown."
)
BASE_LIMITATION = "Cao continental-outline model geometry is not observed exposed land"
BASE_SURFACE_REASON = "native Cao continental-outline geometry; exposed-land and height evidence unavailable"
REPAIRED_LIMITATION = (
    "Cao continental-outline model geometry with same-identity lifecycle from "
    "COBfile_1800_0.gpml; water depth and exposure remain unknown"
)
HEADER_BYTES = 32
RECORD_BYTES = 20
CP = foundation.load_coordinate()


class BuildError(ValueError):
    pass


def extension_entry_id(row: dict) -> str:
    if row["plateId"] in (305,):
        return f"plate-{row['plateId']}-505-753"
    youngest = extension_youngest(row)
    return f"{ENTRY_PREFIX}-{row['plateId']}-{youngest}-600"


def extension_youngest(row: dict, contract: dict | None = None) -> int:
    if row["plateId"] == 305:
        return 505
    source = contract or json.loads(CONTRACT.read_text())
    return source["motionExtensionMa"]["newEntryYoungestMaByPlate"][str(row["plateId"])]


def interval_id(youngest: int) -> str:
    return f"{INTERVAL_PREFIX}-{youngest}-600-v1"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha(path: Path) -> str:
    return sha256(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def geometry_digest(geometry: pygplates.PolygonOnSphere) -> str:
    payload = bytearray()
    for point in geometry.get_points():
        payload.extend(struct.pack("<ddd", *point.to_xyz()))
    return sha256(payload)


def active(lifecycle: dict, age_ma: float) -> bool:
    valid = lifecycle["validTimeMa"]
    return (
        age_ma >= valid["youngest"]
        and age_ma <= valid["oldest"]
        and not (lifecycle.get("youngestExclusive") is True and age_ma == valid["youngest"])
        and not (lifecycle.get("oldestExclusive") is True and age_ma == valid["oldest"])
    )


def source_feature(collection: Path, feature_id: str):
    matches = []
    for feature in pygplates.FeatureCollection(str(collection)):
        if str(feature.get_feature_id()) != feature_id:
            continue
        geometries = [geometry for geometry in feature.get_all_geometries()
                      if isinstance(geometry, pygplates.PolygonOnSphere)]
        matches.extend((feature, geometry) for geometry in geometries)
    if len(matches) != 1:
        raise BuildError(f"{collection.name}: expected one polygon for {feature_id}, found {len(matches)}")
    return matches[0]


def decode_palette(path: Path, catalog: dict):
    data = path.read_bytes()
    if data[:4] != b"EHMP" or len(data) < HEADER_BYTES:
        raise BuildError("invalid motion palette binary")
    version, record_bytes, entry_count, sample_count, header_bytes, *reserved = struct.unpack_from(
        "<HHIIIIII", data, 4
    )
    if (version, record_bytes, entry_count, sample_count, header_bytes) != (
        2, RECORD_BYTES, len(catalog["entries"]), (len(data) - HEADER_BYTES) // RECORD_BYTES, HEADER_BYTES
    ) or any(reserved):
        raise BuildError("motion palette header/catalog mismatch")
    return data, [struct.unpack_from("<Iffff", data, HEADER_BYTES + index * RECORD_BYTES)
                  for index in range(sample_count)]


def quaternion_at(entry: dict, records: list[tuple], age_ma: float):
    rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
    target = round(age_ma * 1_000_000)
    upper = next((index for index, row in enumerate(rows) if row[0] >= target), len(rows) - 1)
    older = rows[upper]
    younger = rows[max(0, upper - 1)]
    if older[0] == younger[0]:
        return foundation.unit(older[1:])
    fraction = (target - younger[0]) / (older[0] - younger[0])
    return CP.slerp(younger[1:], older[1:], fraction)


def angular(left, right) -> float:
    left = foundation.unit(left)
    right = foundation.unit(right)
    cosine = abs(sum(a * b for a, b in zip(left, right)))
    return 2 * math.acos(max(-1.0, min(1.0, cosine)))


def exact_relative(cp, rotation, plate: int, age_ma: float):
    reference = cp.exact_quaternion(rotation, 0, plate)
    posed = cp.exact_quaternion(rotation, age_ma, plate)
    if reference is None or posed is None:
        raise BuildError(f"plate {plate}: missing strict Cao rotation at {age_ma} Ma")
    return foundation.compose(posed, foundation.inverse(reference))


def load_and_validate(package: Path):
    contract = json.loads(CONTRACT.read_text())
    core_path = package / "core.json"
    palette_path = package / "motion-palette.json"
    binary_path = package / "motion-palette.bin"
    manifest_path = package / "manifest.json"
    core = json.loads(core_path.read_text())
    palette = json.loads(palette_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    for descriptor, path in (
        (manifest["core"], core_path),
        (manifest["motionPalette"]["catalog"], palette_path),
        (manifest["motionPalette"]["binary"], binary_path),
    ):
        if (descriptor["url"] != path.name or descriptor["bytes"] != path.stat().st_size
                or descriptor["sha256"] != sha(path)):
            raise BuildError(f"{path.name}: package asset identity mismatch")
    correction_descriptor = manifest.get("materialCorrections", {}).get("catalog")
    if not isinstance(correction_descriptor, dict):
        raise BuildError("missing regional material correction catalog")
    correction_path = package / correction_descriptor["url"]
    if (not correction_path.is_file() or correction_descriptor["bytes"] != correction_path.stat().st_size
            or correction_descriptor["sha256"] != sha(correction_path)):
        raise BuildError("regional material correction catalog identity mismatch")
    correction_catalog = json.loads(correction_path.read_text())
    correction_baseline = correction_catalog.get("baseline", {})
    if (correction_baseline.get("coreSha256") != manifest["core"]["sha256"]
            or correction_baseline.get("packageId") != core["packageId"]
            or correction_baseline.get("revision") != core["revision"]
            or correction_baseline.get("motionPaletteId") != palette["id"]
            or correction_baseline.get("frame") != manifest["frame"]):
        raise BuildError("regional material correction catalog is not bound to this native package")
    source_paths = {
        key: MODEL / row["member"] for key, row in contract["sources"].items()
    }
    for key, path in source_paths.items():
        declared = contract["sources"][key]
        if not path.is_file() or path.stat().st_size != declared["bytes"] or sha(path) != declared["sha256"]:
            raise BuildError(f"{key}: pinned Cao source changed")
    frame = contract["model"]["frame"]
    if any(manifest["frame"].get(key) != value for key, value in frame.items()):
        raise BuildError("package and Cao 422 Ma shelf frame differ")
    if (manifest["packageId"] != core["packageId"] or manifest["revision"] != core["revision"]
            or palette["id"] != manifest["motionPalette"]["id"]):
        raise BuildError("package core/palette identity mismatch")
    binary, records = decode_palette(binary_path, palette)
    chart_by_id = {chart["chartId"]: (index, chart) for index, chart in enumerate(core["charts"])}
    if len(chart_by_id) != len(core["charts"]):
        raise BuildError("duplicate chart identity")
    shelf_indices = set()
    shelf_batch = next((row for row in core["spatialBatches"] if row["batchId"] == "batch-shelf"), None)
    if shelf_batch is None:
        raise BuildError("missing native shelf batch")
    shelf_bytes = (package / shelf_batch["geometryAsset"]["url"]).read_bytes()
    vertex_count = struct.unpack_from("<I", shelf_bytes, 8)[0]
    chart_offset = HEADER_BYTES + 16 * vertex_count
    shelf_indices.update(struct.unpack_from(
        f"<{vertex_count}I", shelf_bytes, chart_offset
    ))
    for row in contract["charts"]:
        compiled_feature, compiled_geometry = source_feature(
            source_paths["compiledShelfCollection"], row["sourceFeatureId"]
        )
        authority_feature, authority_geometry = source_feature(
            source_paths["lifecycleAuthority"], row["sourceFeatureId"]
        )
        identities = (
            compiled_feature.get_name() == authority_feature.get_name() == row["name"]
            and compiled_feature.get_reconstruction_plate_id(None)
            == authority_feature.get_reconstruction_plate_id(None) == row["plateId"]
            and str(compiled_feature.get_feature_type()).split(":")[-1]
            == str(authority_feature.get_feature_type()).split(":")[-1] == row["sourceFeatureType"]
        )
        if not identities:
            raise BuildError(f"{row['sourceFeatureId']}: source identity changed")
        compiled_valid = compiled_feature.get_valid_time()
        authority_valid = authority_feature.get_valid_time()
        if compiled_valid[0] != row["compiledOldestMa"] or authority_valid[0] != 600:
            raise BuildError(
                f"{row['sourceFeatureId']}: expected {row['compiledOldestMa']}/600 Ma lifecycle mismatch"
            )
        digests = (geometry_digest(compiled_geometry), geometry_digest(authority_geometry))
        if (digests[0] != digests[1] or digests[0] != row["sourceGeometryFloat64XyzSha256"]
                or len(compiled_geometry.get_points()) != row["sourceVertexCount"]
                or len(authority_geometry.get_points()) != row["sourceVertexCount"]):
            raise BuildError(f"{row['sourceFeatureId']}: source geometry changed")
        witness_lon, witness_lat = row["witnessReferenceLongitudeLatitude"]
        witness = pygplates.PointOnSphere(witness_lat, witness_lon)
        if (not compiled_geometry.is_point_in_polygon(witness)
                or not authority_geometry.is_point_in_polygon(witness)):
            raise BuildError(f"{row['sourceFeatureId']}: reference witness left source geometry")
        match = chart_by_id.get(row["chartId"])
        if match is None or match[0] != row["compiledChartIndex"] or match[0] not in shelf_indices:
            raise BuildError(f"{row['chartId']}: compiled shelf chart identity changed")
        chart = match[1]
        if (chart["role"] != "model-geography" or chart["sourceFeatureIds"] != [row["sourceFeatureId"]]
                or chart["sourceFeatureTypes"] != [row["sourceFeatureType"]]
                or chart["surfaceEvidence"]["kind"] != "unknown"):
            raise BuildError(f"{row['chartId']}: chart semantics changed")
        limitation = chart.get("evidence", {}).get("limitations", [])
        semantics = (limitation[1] if len(limitation) > 1 else None,
                     chart["surfaceEvidence"].get("reason"))
        if semantics not in {
            (BASE_LIMITATION, BASE_SURFACE_REASON),
            (REPAIRED_LIMITATION, contract["semantics"]["surfaceEvidence"]["reason"]),
        }:
            raise BuildError(f"{row['chartId']}: shelf evidence wording changed")
        if chart["lifecycle"]["validTimeMa"]["youngest"] != 0:
            raise BuildError(f"{row['chartId']}: unexpected youngest lifecycle")
    return contract, core, palette, binary, records, manifest, correction_catalog, correction_path


def build_motion_rows(contract: dict):
    cp = CP
    rotation = pygplates.RotationModel(
        [str(MODEL / name) for name in foundation.ROTATION_FILES], default_anchor_plate_id=0
    )
    bounds = contract["motionExtensionMa"]
    oldest = bounds["oldest"]
    output = {}
    clocks = {}
    for plate_text, youngest in bounds["newEntryYoungestMaByPlate"].items():
        plate = int(plate_text)
        source_clock = sorted({youngest, oldest, *(age for name in foundation.ROTATION_FILES
            for age in cp.all_source_rotation_times(MODEL / name, youngest, oldest))})
        clocks[youngest] = source_clock
        nodes = foundation.adaptive(cp, rotation, plate, source_clock)
        relative = []
        for age, quaternion in sorted(nodes.items()):
            relative.append((round(age * 1_000_000), *cp.float32_quaternion(
                foundation.compose(quaternion, foundation.inverse(cp.exact_quaternion(rotation, 0, plate)))
            )))
        output[plate] = relative
    return cp, rotation, clocks, output


def validate_applied(package: Path) -> dict:
    contract, core, palette, _binary, records, _manifest, correction_catalog, _correction_path = load_and_validate(package)
    chart_by_id = {chart["chartId"]: chart for chart in core["charts"]}
    entry_by_id = {entry["entryId"]: entry for entry in palette["entries"]}
    cp = CP
    rotation = pygplates.RotationModel(
        [str(MODEL / name) for name in foundation.ROTATION_FILES], default_anchor_plate_id=0
    )
    oracle_max = 0.0
    oracle_age = None
    oracle_plate = None
    lifecycle = {}
    for age in (0, 409, 410, 410.000001, 419.999999, 420, 420.000001,
                422, 600, 600.000001):
        lifecycle[str(age)] = [active(chart_by_id[row["chartId"]]["lifecycle"], age)
                               for row in contract["charts"]]
    expected_lifecycle = {
        "0": [True] * 6, "409": [True] * 6, "410": [True] * 6,
        "410.000001": [True] * 6, "419.999999": [True] * 6,
        "420": [True] * 6, "420.000001": [True] * 6, "422": [True] * 6,
        "600": [True] * 6, "600.000001": [False] * 6,
    }
    if lifecycle != expected_lifecycle:
        raise BuildError(f"unexpected repaired lifecycles: {lifecycle}")
    for row in contract["charts"]:
        chart = chart_by_id[row["chartId"]]
        expected_bindings = [
            (f"plate-{row['plateId']}-0-130", 0.0, 130.0),
            (f"plate-{row['plateId']}-130-505", 130.0,
             row["compiledOldestMa"] if extension_youngest(row, contract) < 505 else 505),
            (extension_entry_id(row), extension_youngest(row, contract), 600),
        ]
        actual_bindings = [(binding["entryId"], binding["validTimeMa"]["youngest"],
                            binding["validTimeMa"]["oldest"])
                           for binding in chart["motionBindings"]]
        if actual_bindings != expected_bindings or SOURCE_ID not in chart["evidence"]["sourceIds"]:
            raise BuildError(f"{row['chartId']}: repaired source or motion bindings changed")
        if (chart["evidence"]["limitations"][1] != REPAIRED_LIMITATION
                or chart["surfaceEvidence"]["reason"]
                != contract["semantics"]["surfaceEvidence"]["reason"]):
            raise BuildError(f"{row['chartId']}: repaired shelf evidence wording changed")
        oracle_ages = {quarter / 4 for quarter in
                       range(int(row["compiledOldestMa"] * 4), 600 * 4 + 1)}
        for binding in chart["motionBindings"]:
            if binding["validTimeMa"]["oldest"] < row["compiledOldestMa"]:
                continue
            entry = entry_by_id[binding["entryId"]]
            entry_rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
            for sample in entry_rows:
                knot = sample[0] / 1_000_000
                for age in (knot - 0.000001, knot, knot + 0.000001):
                    if row["compiledOldestMa"] <= age <= 600:
                        oracle_ages.add(age)
        for age in sorted(oracle_ages):
            matches = [binding for binding in chart["motionBindings"]
                       if binding["validTimeMa"]["youngest"] <= age
                       <= binding["validTimeMa"]["oldest"]]
            if not matches:
                raise BuildError(f"{row['chartId']}: missing motion at {age} Ma")
            binding = max(matches, key=lambda item: item["validTimeMa"]["youngest"])
            entry = entry_by_id.get(binding["entryId"])
            if entry is None:
                raise BuildError(f"{row['chartId']}: missing palette entry {binding['entryId']}")
            error = angular(exact_relative(cp, rotation, row["plateId"], age),
                            quaternion_at(entry, records, age))
            if error > oracle_max:
                oracle_max, oracle_age, oracle_plate = error, age, row["plateId"]
    bounds = contract["motionExtensionMa"]
    if oracle_max > bounds["angularErrorLimitRad"]:
        raise BuildError(f"Cao 422 Ma shelf motion residual {oracle_max} exceeds contract")
    return {
        "maximumQuarterMaMotionResidualRad": oracle_max,
        "maximumResidualAgeMa": oracle_age,
        "maximumResidualPlateId": oracle_plate,
        "lifecycleWitnesses": lifecycle,
        "materialCorrectionCatalogCoreSha256": correction_catalog["baseline"]["coreSha256"],
    }


def apply(package: Path) -> dict:
    (contract, core, palette, binary, records, manifest,
     correction_catalog, correction_path) = load_and_validate(package)
    target_ids = {row["chartId"] for row in contract["charts"]}
    before_core = copy.deepcopy(core)
    before_geometry = copy.deepcopy(core["spatialBatches"])
    before_palette_entries = copy.deepcopy(palette["entries"])
    before_interval_sets = copy.deepcopy(palette["sourceIntervalSets"])
    before_coasts = [copy.deepcopy(chart) for chart in core["charts"]
                     if chart["chartId"].startswith("cao-coast:")]
    before_correction_catalog = copy.deepcopy(correction_catalog)
    cp, rotation, source_clocks, rows_by_plate = build_motion_rows(contract)
    if any(entry["entryId"].startswith(f"{ENTRY_PREFIX}-") for entry in palette["entries"]):
        raise BuildError("Cao 422 Ma shelf motion entries already exist")
    new_interval_ids = {interval_id(age) for age in source_clocks}
    if any(interval["id"] in new_interval_ids for interval in palette["sourceIntervalSets"]):
        raise BuildError("Cao 422 Ma shelf motion interval already exists")
    base_count = len(records)
    appended_entries = []
    for plate, new_rows in rows_by_plate.items():
        youngest = contract["motionExtensionMa"]["newEntryYoungestMaByPlate"][str(plate)]
        offset = len(records)
        records.extend(new_rows)
        entry = {
            "entryId": f"{ENTRY_PREFIX}-{plate}-{youngest}-600",
            "plateId": plate,
            "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
            "youngestAgeMa": youngest,
            "oldestAgeMa": 600,
            "sampleOffset": offset,
            "sampleCount": len(new_rows),
            "sourceIds": ["doi:10.5281/zenodo.13628813"],
            "sourceIntervalSetId": interval_id(youngest),
        }
        palette["entries"].append(entry)
        appended_entries.append(entry)
    for youngest, source_clock in source_clocks.items():
        palette["sourceIntervalSets"].append({
            "id": interval_id(youngest),
            "intervals": [
                {"youngestAgeMa": youngest, "oldestAgeMa": 600, "kind": "smooth-motion"},
                *({"youngestAgeMa": age, "oldestAgeMa": age, "kind": "source-knot"}
                  for age in source_clock),
            ],
        })
    chart_by_id = {chart["chartId"]: chart for chart in core["charts"]}
    for row in contract["charts"]:
        chart = chart_by_id[row["chartId"]]
        if chart["lifecycle"]["validTimeMa"]["oldest"] != row["compiledOldestMa"]:
            raise BuildError(
                f"{row['chartId']}: baseline lifecycle is not {row['compiledOldestMa']} Ma"
            )
        if (chart["evidence"]["limitations"][1] != BASE_LIMITATION
                or chart["surfaceEvidence"]["reason"] != BASE_SURFACE_REASON):
            raise BuildError(f"{row['chartId']}: baseline shelf evidence wording changed")
        bindings = chart["motionBindings"]
        older = next((binding for binding in bindings
                      if binding["entryId"] == f"plate-{row['plateId']}-130-505"), None)
        if older is None or older["validTimeMa"] != {
            "youngest": 130.0,
            "oldest": row["compiledOldestMa"],
        }:
            raise BuildError(f"{row['chartId']}: expected clipped native 130-505 binding")
        chart["lifecycle"]["validTimeMa"]["oldest"] = 600
        extension_start = extension_youngest(row, contract)
        if extension_start == 505:
            older["validTimeMa"]["oldest"] = 505
        bindings.append({
            "paletteId": palette["id"],
            "entryId": extension_entry_id(row),
            "validTimeMa": {"youngest": extension_start, "oldest": 600},
        })
        if SOURCE_ID not in chart["evidence"]["sourceIds"]:
            chart["evidence"]["sourceIds"].append(SOURCE_ID)
        chart["evidence"]["limitations"][1] = REPAIRED_LIMITATION
        chart["surfaceEvidence"]["reason"] = contract["semantics"]["surfaceEvidence"]["reason"]
    changed = [index for index, (before, after) in enumerate(zip(before_core["charts"], core["charts"]))
               if before != after]
    expected = sorted(row["compiledChartIndex"] for row in contract["charts"])
    if changed != expected or core["spatialBatches"] != before_geometry:
        raise BuildError("repair changed geometry or charts outside the six exact targets")
    after_coasts = [chart for chart in core["charts"] if chart["chartId"].startswith("cao-coast:")]
    if before_coasts != after_coasts:
        raise BuildError("native coastline charts changed")

    out_binary = bytearray(HEADER_BYTES + RECORD_BYTES * len(records))
    out_binary[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", out_binary, 4, 2, RECORD_BYTES, len(palette["entries"]),
                     len(records), HEADER_BYTES, 0, 0, 0)
    for index, record in enumerate(records):
        struct.pack_into("<Iffff", out_binary, HEADER_BYTES + RECORD_BYTES * index, *record)
    if (palette["entries"][:len(before_palette_entries)] != before_palette_entries
            or palette["sourceIntervalSets"][:len(before_interval_sets)] != before_interval_sets
            or out_binary[HEADER_BYTES:len(binary)] != binary[HEADER_BYTES:]):
        raise BuildError("existing palette entries, interval sets, or sample bytes changed")
    binary_path = package / "motion-palette.bin"
    binary_path.write_bytes(out_binary)
    palette["binary"]["bytes"] = len(out_binary)
    palette["binary"]["sha256"] = sha256(out_binary)
    palette_path = package / "motion-palette.json"
    palette_path.write_bytes(canonical(palette))
    core_path = package / "core.json"
    core_path.write_bytes(canonical(core))
    old_core_sha = correction_catalog["baseline"]["coreSha256"]
    new_core_sha = sha(core_path)
    correction_catalog["baseline"]["coreSha256"] = new_core_sha
    expected_correction_catalog = copy.deepcopy(before_correction_catalog)
    expected_correction_catalog["baseline"]["coreSha256"] = new_core_sha
    if correction_catalog != expected_correction_catalog:
        raise BuildError("regional material correction catalog changed beyond native core rebinding")
    correction_bytes = correction_path.read_bytes()
    old_token, new_token = old_core_sha.encode(), new_core_sha.encode()
    if len(old_token) != len(new_token) or correction_bytes.count(old_token) != 1:
        raise BuildError("regional material correction catalog core binding is not uniquely replaceable")
    correction_path.write_bytes(correction_bytes.replace(old_token, new_token))
    manifest["core"] = asset(core_path)
    manifest["motionPalette"]["catalog"] = asset(palette_path)
    manifest["motionPalette"]["binary"] = asset(binary_path)
    manifest["materialCorrections"]["catalog"] = asset(
        correction_path, str(correction_path.relative_to(package))
    )
    if SCOPE_CLAUSE not in manifest["scope"]:
        manifest["scope"] = f"{manifest['scope']} {SCOPE_CLAUSE}"
    manifest_path = package / "manifest.json"
    manifest_path.write_bytes(canonical(manifest))

    applied = validate_applied(package)
    return {
        "correctionId": contract["correctionId"],
        "changedChartIndices": changed,
        "changedChartIds": sorted(target_ids),
        "geometryAssetsUnchanged": before_geometry == core["spatialBatches"],
        "nativeCoastChartsUnchanged": before_coasts == after_coasts,
        "nativeCoastChartCount": len(before_coasts),
        "materialCorrectionCatalogChangedFields": ["baseline.coreSha256"],
        "appendedMotionEntries": [entry["entryId"] for entry in appended_entries],
        "appendedMotionSamples": len(records) - base_count,
        **applied,
        "core": asset(package / "core.json"),
        "motionPaletteCatalog": asset(package / "motion-palette.json"),
        "motionPaletteBinary": asset(package / "motion-palette.bin"),
        "materialCorrectionCatalog": asset(correction_path),
        "manifest": asset(package / "manifest.json"),
    }


def check(package: Path) -> dict:
    contract, core, _palette, _binary, _records, _manifest, _catalog, _catalog_path = load_and_validate(package)
    charts = {chart["chartId"]: chart for chart in core["charts"]}
    return {
        "correctionId": contract["correctionId"],
        "sourceIdentityAndGeometryMatch": True,
        "baselineMissingAt422": [not active(charts[row["chartId"]]["lifecycle"], 422)
                                 for row in contract["charts"]],
        "targetChartIds": [row["chartId"] for row in contract["charts"]],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--validate-applied", action="store_true")
    args = parser.parse_args()
    if args.apply and args.validate_applied:
        parser.error("--apply and --validate-applied are mutually exclusive")
    if args.apply and (args.package is None or args.package.resolve() == DEFAULT_PACKAGE.resolve()):
        parser.error("--apply requires an explicit non-public staging --package directory")
    package = args.package or DEFAULT_PACKAGE
    result = (apply(package) if args.apply else validate_applied(package)
              if args.validate_applied else check(package))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

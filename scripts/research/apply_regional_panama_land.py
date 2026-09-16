#!/usr/bin/env python3
"""Append the exact-present Panama observed-land charts to a staged Cao package."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import emit_cao_material_corrections as material
import regional_panama_correction as source_contract
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
CONTRACT = ROOT / "data/corrections/panama/source-contract.json"
FEATURE_ORDER = (
    "panama-observed-land-229-289",
    "panama-observed-land-911-532",
    "panama-observed-land-911-533",
    "panama-observed-land-230-798",
    "panama-observed-land-231-2032",
)
NEW_PLATES = (229, 230, 911)
CHART_PREFIX = "correction:earthhistory-regional-panama-observed-land-v1:"
ENTRY_PREFIX = "panama-observed-land-plate"
INTERVAL_ID = "panama-observed-land-clock-0-v1"
SOURCE_TYPE = "EarthHistoryObservedModernLandCorrection"
SOURCE_ID = "natural-earth-countries-50m"
HEADER_BYTES = 32
MOTION_RECORD_BYTES = 20
LAND_SHELL_METRES = 800
# The native Cao chart inventory the Panama block is appended to. Re-recorded on
# 2026-09-16 from 4826: the modern-country overlay was rebuilt from Natural Earth 1:50m
# and its charts are re-appended at the core tail, after this block, so they no longer
# count towards the base. A package with fewer native charts predates the approved
# baseline and is refused.
EXPECTED_BASE_CHARTS = 3809
SCOPE_CLAUSE = (
    " Natural Earth 1:50m supplies five exact-modern observed Panama land charts only where "
    "the emitted Cao coast footprint is absent; no historical coast or water depth is inferred."
)


class BuildError(ValueError):
    pass


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha(path: Path) -> str:
    return sha256(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, payload: bytes) -> None:
    temporary = path.with_name(path.name + ".panama-stage")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def decode_ehgb(data: bytes) -> dict:
    if len(data) < HEADER_BYTES or data[:4] != b"EHGB":
        raise BuildError("invalid EHGB geometry")
    version, header, vertices, triangles, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if (version, header) != (2, HEADER_BYTES) or any(reserved):
        raise BuildError("unsupported EHGB geometry header")
    if len(data) != HEADER_BYTES + 20 * vertices + 12 * triangles:
        raise BuildError("EHGB byte count changed")
    directions = [struct.unpack_from("<fff", data, HEADER_BYTES + 12 * index) for index in range(vertices)]
    offset = HEADER_BYTES + 12 * vertices
    seams = list(struct.unpack_from(f"<{vertices}I", data, offset)); offset += 4 * vertices
    charts = list(struct.unpack_from(f"<{vertices}I", data, offset)); offset += 4 * vertices
    indices = list(struct.unpack_from(f"<{3 * triangles}I", data, offset))
    return {"directions": directions, "seams": seams, "charts": charts, "indices": indices}


def encode_ehgb(directions, seams, charts, indices) -> bytes:
    vertices = len(directions)
    if len(seams) != vertices or len(charts) != vertices or len(indices) % 3:
        raise BuildError("inconsistent EHGB arrays")
    triangles = len(indices) // 3
    payload = bytearray(HEADER_BYTES + 20 * vertices + 12 * triangles)
    payload[:4] = b"EHGB"
    struct.pack_into("<HHIIIIII", payload, 4, 2, HEADER_BYTES, vertices, triangles, 0, 0, 0, 0)
    offset = HEADER_BYTES
    for row in directions:
        struct.pack_into("<fff", payload, offset, *row); offset += 12
    for rows in (seams, charts, indices):
        for value in rows:
            struct.pack_into("<I", payload, offset, value); offset += 4
    return bytes(payload)


def float32_rows(rows) -> list[tuple]:
    """Round direction rows exactly as EHGB serialization does."""
    return [struct.unpack("<fff", struct.pack("<fff", *row)) for row in rows]


def decode_palette(path: Path, catalog: dict) -> tuple[bytes, list[tuple]]:
    data = path.read_bytes()
    if data[:4] != b"EHMP" or len(data) < HEADER_BYTES:
        raise BuildError("invalid motion palette binary")
    version, record_bytes, entries, samples, header_bytes, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if ((version, record_bytes, entries, header_bytes) !=
            (2, MOTION_RECORD_BYTES, len(catalog["entries"]), HEADER_BYTES)
            or samples != (len(data) - HEADER_BYTES) // MOTION_RECORD_BYTES or any(reserved)):
        raise BuildError("motion palette header/catalog mismatch")
    rows = [struct.unpack_from("<Iffff", data, HEADER_BYTES + index * MOTION_RECORD_BYTES)
            for index in range(samples)]
    return data, rows


def encode_palette(catalog: dict, records: list[tuple]) -> bytes:
    payload = bytearray(HEADER_BYTES + MOTION_RECORD_BYTES * len(records))
    payload[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", payload, 4, 2, MOTION_RECORD_BYTES, len(catalog["entries"]),
                     len(records), HEADER_BYTES, 0, 0, 0)
    for index, record in enumerate(records):
        struct.pack_into("<Iffff", payload, HEADER_BYTES + MOTION_RECORD_BYTES * index, *record)
    return bytes(payload)


def find_feature(collection: dict, identifier: str) -> dict:
    matches = [row for row in collection.get("features", []) if row.get("id") == identifier]
    if len(matches) != 1:
        raise BuildError(f"{identifier}: expected one geometry feature")
    return matches[0]


def triangulate(contract: dict, chart_offset: int) -> tuple[list, list, list]:
    declared = contract["features"][0]["geometryAsset"]
    path = CONTRACT.parent / declared["path"]
    if path.stat().st_size != declared["bytes"] or sha(path) != declared["sha256"]:
        raise BuildError("Panama geometry identity changed")
    collection = json.loads(path.read_text())
    directions, patches = [], []
    for local_chart, identifier in enumerate(FEATURE_ORDER):
        source = find_feature(collection, identifier)
        for polygon_index, polygon in enumerate(material.polygons(source["geometry"])):
            rings, all_directions = [], []
            for coordinates in polygon:
                if coordinates[0][:2] == coordinates[-1][:2]:
                    coordinates = coordinates[:-1]
                offset = len(directions)
                ring = [material.unit(material.lon_lat_direction(point)) for point in coordinates]
                directions.extend(ring); all_directions.extend(ring)
                rings.append({"offset": offset, "count": len(ring)})
            patches.append({
                "patchId": f"{identifier}:{polygon_index}", "rings": rings,
                "interiorDirection": list(material.unit(tuple(
                    sum(point[axis] for point in all_directions) for axis in range(3)
                ))),
                "chartIndex": chart_offset + local_chart,
            })
    with tempfile.TemporaryDirectory(prefix="earthhistory-panama-land-") as scratch_value:
        scratch = Path(scratch_value)
        metadata, direction_path, index_path = scratch / "rings.json", scratch / "directions.f32", scratch / "indices.u32"
        metadata.write_bytes(material.canonical_json({"patches": patches}))
        raw = bytearray(12 * len(directions))
        for index, direction in enumerate(directions):
            struct.pack_into("<fff", raw, index * 12, *direction)
        direction_path.write_bytes(raw)
        subprocess.run(["node", str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
                        str(metadata), str(direction_path), str(index_path)], check=True)
        report = json.loads(Path(str(index_path) + ".json").read_text())
        failures = [row for row in report["patches"] if row["status"] != "candidate"]
        if failures:
            raise BuildError(f"Panama triangulation failed for {len(failures)} patches")
        indices = list(struct.unpack(f"<{index_path.stat().st_size // 4}I", index_path.read_bytes()))
    vertex_charts = [0] * len(directions)
    by_patch = {row["patchId"]: row for row in patches}
    for row in report["patches"]:
        patch = by_patch[row["patchId"]]
        for ring in patch["rings"]:
            vertex_charts[ring["offset"]:ring["offset"] + ring["count"]] = [patch["chartIndex"]] * ring["count"]
    old_shell = material.DISPLAY_SHELL_OFFSET_METRES
    try:
        material.DISPLAY_SHELL_OFFSET_METRES = LAND_SHELL_METRES
        return material.refine_triangle_edges(directions, indices, vertex_charts)
    finally:
        material.DISPLAY_SHELL_OFFSET_METRES = old_shell


def append_motion(palette: dict, records: list[tuple]) -> list[str]:
    if any(entry["entryId"].startswith(ENTRY_PREFIX) for entry in palette["entries"]):
        raise BuildError("Panama motion entries already applied")
    if any(row["id"] == INTERVAL_ID for row in palette["sourceIntervalSets"]):
        raise BuildError("Panama motion interval already applied")
    added = []
    for plate in NEW_PLATES:
        identifier = f"{ENTRY_PREFIX}-{plate}-0"
        palette["entries"].append({
            "entryId": identifier, "plateId": plate,
            "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
            "youngestAgeMa": 0, "oldestAgeMa": 0, "sampleOffset": len(records), "sampleCount": 1,
            "sourceIds": ["doi:10.5281/zenodo.13628813"], "sourceIntervalSetId": INTERVAL_ID,
        })
        records.append((0, 1.0, 0.0, 0.0, 0.0)); added.append(identifier)
    palette["sourceIntervalSets"].append({
        "id": INTERVAL_ID,
        "intervals": [
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "smooth-motion"},
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "source-knot"},
        ],
    })
    return added


def chart(contract: dict, feature: dict, palette_id: str) -> dict:
    identifier = feature["correctionFeatureId"]
    plate = feature["pose"]["plateId"]
    entry_id = "plate-231-0-43.8" if plate == 231 else f"{ENTRY_PREFIX}-{plate}-0"
    return {
        "kind": "rigid", "role": "model-geography", "chartId": CHART_PREFIX + identifier,
        "chartRevision": contract["correctionId"] + "@" + contract["version"],
        "materialId": CHART_PREFIX + identifier, "fragmentOrCohortId": identifier,
        "lifecycle": copy.deepcopy(feature["phaseLifecycles"]["observed"]),
        "geometryReferenceAgeMa": 0,
        "motionBindings": [{"paletteId": palette_id, "entryId": entry_id,
                            "validTimeMa": {"youngest": 0, "oldest": 0}}],
        "sourceFeatureIds": [feature["pose"]["sourceFeatureId"]],
        "sourceFeatureTypes": [SOURCE_TYPE],
        "evidence": {
            "status": "derived-overlay", "sourceIds": list(feature["sourceIds"]),
            "limitations": [feature["uncertainty"][key] for key in ("spatial", "temporal", "depth")],
        },
        "surfaceEvidence": copy.deepcopy(feature["surfaceEvidence"]),
    }


def update_checkpoint(package: Path, descriptor: dict, land_vertices: int) -> None:
    path = package / descriptor["url"]
    before = path.stat().st_size
    value = json.loads(path.read_text())
    control = next((row for row in value["batchControls"] if row["batchId"] == "batch-land"), None)
    if control is None:
        raise BuildError(f"{path.name}: missing land batch control")
    control["vertexCount"] = land_vertices
    write_atomic(path, canonical(value))
    descriptor["bytes"], descriptor["sha256"] = path.stat().st_size, sha(path)
    descriptor["transitiveBytes"] += path.stat().st_size - before


def apply(package: Path, *, regenerate_material: bool = True) -> dict:
    package = package.resolve()
    if package == PUBLIC:
        raise BuildError("--apply requires an explicit staging package; public in-place writes are rejected")
    contract = json.loads(CONTRACT.read_text())
    source_contract.validate_document(contract)
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    palette_path, palette_binary_path = package / "motion-palette.json", package / "motion-palette.bin"
    core, manifest, palette = (package_intern.read_package_json(core_path),
                               json.loads(manifest_path.read_text()), json.loads(palette_path.read_text()))
    if any(row["chartId"].startswith(CHART_PREFIX) for row in core["charts"]):
        raise BuildError("Panama charts already applied")
    if len(core["charts"]) < EXPECTED_BASE_CHARTS:
        raise BuildError("native chart inventory predates the approved baseline")
    if manifest["core"] != asset(core_path) or manifest["motionPalette"]["catalog"] != asset(palette_path):
        raise BuildError("package catalog identities are stale")
    old_palette_bytes, records = decode_palette(palette_binary_path, palette)
    old_palette_entries = copy.deepcopy(palette["entries"])
    old_intervals = copy.deepcopy(palette["sourceIntervalSets"])
    added_entries = append_motion(palette, records)
    land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
    land_path = package / land_batch["geometryAsset"]["url"]
    original = decode_ehgb(land_path.read_bytes())
    original_charts = copy.deepcopy(core["charts"])
    chart_offset = len(original_charts)
    additions, indices, vertex_charts = triangulate(contract, chart_offset)
    vertex_offset = len(original["directions"])
    combined = {
        "directions": [*original["directions"], *additions],
        "seams": [*original["seams"], *(2_200_000_000 + index for index in range(len(additions)))],
        "charts": [*original["charts"], *vertex_charts],
        "indices": [*original["indices"], *(vertex_offset + index for index in indices)],
    }
    write_atomic(land_path, encode_ehgb(**combined))
    core["charts"].extend(chart(contract, row, palette["id"]) for row in contract["features"])
    land_batch["vertexCount"] = len(combined["directions"])
    land_batch["triangleCount"] = len(combined["indices"]) // 3
    land_batch["geometryAsset"] = asset(land_path)
    write_atomic(core_path, canonical(package_intern.intern_charts(core)))
    palette_binary = encode_palette(palette, records)
    write_atomic(palette_binary_path, palette_binary)
    palette["binary"] = asset(palette_binary_path)
    write_atomic(palette_path, canonical(palette))
    manifest["core"] = asset(core_path)
    manifest["motionPalette"]["catalog"] = asset(palette_path)
    manifest["motionPalette"]["binary"] = asset(palette_binary_path)
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        manifest["scope"] += SCOPE_CLAUSE
    for descriptor in manifest["checkpoints"]:
        update_checkpoint(package, descriptor, land_batch["vertexCount"])
    write_atomic(manifest_path, canonical(manifest))
    if regenerate_material:
        subprocess.run([sys.executable, str(ROOT / "scripts/research/emit_cao_material_corrections.py"),
                        "--package", str(package), "--skip-root-manifest"], check=True)
    result = validate_applied(package, original_geometry=original, original_charts=original_charts,
                              old_palette_entries=old_palette_entries, old_intervals=old_intervals,
                              old_palette_bytes=old_palette_bytes)
    result.update({"addedMotionEntries": added_entries, "addedVertices": len(additions),
                   "addedTriangles": len(indices) // 3, "chartOffset": chart_offset})
    return result


def validate_applied(package: Path, *, original_geometry=None, original_charts=None,
                     old_palette_entries=None, old_intervals=None, old_palette_bytes=None) -> dict:
    package = package.resolve()
    contract = json.loads(CONTRACT.read_text())
    core = package_intern.read_package_json(package / "core.json")
    manifest = json.loads((package / "manifest.json").read_text())
    palette = json.loads((package / "motion-palette.json").read_text())
    binary, records = decode_palette(package / "motion-palette.bin", palette)
    if manifest["core"] != asset(package / "core.json"):
        raise BuildError("applied core identity is stale")
    for key, name in (("catalog", "motion-palette.json"), ("binary", "motion-palette.bin")):
        if manifest["motionPalette"][key] != asset(package / name):
            raise BuildError(f"applied {name} identity is stale")
    matches = [(index, row) for index, row in enumerate(core["charts"])
               if row["chartId"].startswith(CHART_PREFIX)]
    if len(matches) != 5 or [row["chartId"] for _, row in matches] != [CHART_PREFIX + value for value in FEATURE_ORDER]:
        raise BuildError("Panama chart identity/order changed")
    if [index for index, _ in matches] != list(range(matches[0][0], matches[0][0] + 5)):
        raise BuildError("Panama charts are not contiguous")
    expected_charts = [chart(contract, feature, palette["id"])
                       for feature in contract["features"]]
    if [row for _, row in matches] != expected_charts:
        raise BuildError("Panama chart provenance, motion, age, or evidence changed")
    entries = {row["entryId"]: row for row in palette["entries"]}
    interval_matches = [row for row in palette["sourceIntervalSets"] if row["id"] == INTERVAL_ID]
    expected_intervals = [
        {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "smooth-motion"},
        {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "source-knot"},
    ]
    if len(interval_matches) != 1 or interval_matches[0]["intervals"] != expected_intervals:
        raise BuildError("Panama exact-present source interval changed")
    for plate in NEW_PLATES:
        entry = entries.get(f"{ENTRY_PREFIX}-{plate}-0")
        if (entry is None or entry["plateId"] != plate or entry["youngestAgeMa"] != 0
                or entry["oldestAgeMa"] != 0 or entry["sampleCount"] != 1
                or tuple(records[entry["sampleOffset"]]) != (0, 1.0, 0.0, 0.0, 0.0)):
            raise BuildError(f"plate {plate}: exact-present identity motion changed")
    land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
    land_path = package / land_batch["geometryAsset"]["url"]
    if land_batch["geometryAsset"] != asset(land_path):
        raise BuildError("Panama land geometry identity is stale")
    decoded = decode_ehgb(land_path.read_bytes())
    target_indices = {index for index, _ in matches}
    bound_targets = set(decoded["charts"]) & target_indices
    suffix_targets = (set(decoded["charts"][len(original_geometry["charts"]):])
                      if original_geometry is not None else bound_targets)
    if (land_batch["vertexCount"] != len(decoded["directions"])
            or land_batch["triangleCount"] != len(decoded["indices"]) // 3
            or bound_targets != target_indices or suffix_targets != target_indices):
        raise BuildError("Panama land geometry chart binding changed")
    expected_directions, expected_indices, expected_vertex_charts = triangulate(
        contract, matches[0][0]
    )
    target_vertices = [index for index, chart_index in enumerate(decoded["charts"])
                       if chart_index in target_indices]
    if not target_vertices:
        raise BuildError("Panama land mesh payload is absent")
    vertex_offset = target_vertices[0]
    if (target_vertices != list(range(vertex_offset, len(decoded["directions"])))
            or decoded["directions"][vertex_offset:] != float32_rows(expected_directions)
            or decoded["charts"][vertex_offset:] != expected_vertex_charts):
        raise BuildError("Panama land mesh payload or per-chart ownership changed")
    triangle_offset = next((index for index, vertex in enumerate(decoded["indices"])
                            if vertex >= vertex_offset), len(decoded["indices"]))
    if (triangle_offset % 3
            or any(vertex >= vertex_offset for vertex in decoded["indices"][:triangle_offset])
            or decoded["indices"][triangle_offset:] != [vertex_offset + value for value in expected_indices]):
        raise BuildError("Panama land mesh triangles changed")
    if original_geometry is not None:
        old_vertices, old_indices = len(original_geometry["directions"]), len(original_geometry["indices"])
        for key in ("directions", "seams", "charts"):
            if decoded[key][:old_vertices] != original_geometry[key]:
                raise BuildError(f"existing land {key} changed")
        if decoded["indices"][:old_indices] != original_geometry["indices"]:
            raise BuildError("existing land triangles changed")
    if original_charts is not None and core["charts"][:len(original_charts)] != original_charts:
        raise BuildError("existing core charts changed")
    if old_palette_entries is not None and palette["entries"][:len(old_palette_entries)] != old_palette_entries:
        raise BuildError("existing palette entry prefix changed")
    if old_intervals is not None and palette["sourceIntervalSets"][:len(old_intervals)] != old_intervals:
        raise BuildError("existing source interval prefix changed")
    if old_palette_bytes is not None:
        old_samples = struct.unpack_from("<I", old_palette_bytes, 12)[0]
        prefix = HEADER_BYTES + MOTION_RECORD_BYTES * old_samples
        if binary[HEADER_BYTES:prefix] != old_palette_bytes[HEADER_BYTES:prefix]:
            raise BuildError("existing palette record bytes changed")
    for descriptor in manifest["checkpoints"]:
        value = json.loads((package / descriptor["url"]).read_text())
        land_control = next(row for row in value["batchControls"] if row["batchId"] == "batch-land")
        if land_control["vertexCount"] != len(decoded["directions"]):
            raise BuildError("checkpoint land inventory is stale")
    return {"charts": len(matches), "landVertices": len(decoded["directions"]),
            "landTriangles": len(decoded["indices"]) // 3, "motionEntries": len(palette["entries"])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-material-regeneration", action="store_true")
    args = parser.parse_args()
    if args.apply and args.package is None:
        parser.error("--apply requires explicit --package staging directory")
    if args.skip_material_regeneration and not args.apply:
        parser.error("--skip-material-regeneration requires --apply")
    package = args.package.resolve() if args.package else PUBLIC
    result = (apply(package, regenerate_material=not args.skip_material_regeneration)
              if args.apply else validate_applied(package))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

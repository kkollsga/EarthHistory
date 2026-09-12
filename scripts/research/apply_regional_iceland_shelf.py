#!/usr/bin/env python3
"""Append the exact-modern Iceland shallow-marine charts to the Cao shelf batch."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import emit_cao_material_corrections as material


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PACKAGE = ROOT / "public/data/reconstruction/cao-v2.4"
CONTRACT = ROOT / "data/corrections/iceland-shallow-shelf/source-contract.json"
FEATURE_ORDER = (
    "iceland-shallow-marine-plate-101",
    "iceland-shallow-marine-plate-301",
)
CHART_PREFIX = "correction:earthhistory-regional-iceland-shallow-marine-v1:"
SOURCE_TYPE = "EarthHistoryGeneralizedModernShallowMarineCorrection"
SOURCE_ID = "natural-earth-bathymetry-10m-l0-k200-v4.1.0"
SCOPE_CLAUSE = (
    " Natural Earth 1:10m L_0-minus-K_200 supplies two exact-modern generalized "
    "Iceland shallow-marine charts; it is not a palaeoshoreline or growth model."
)
HEADER_BYTES = 32
SHELF_SHELL_METRES = 400
LAND_SHELL_METRES = 800
EARTH_RADIUS_METRES = 6_371_000
FLOAT32_ORDER_MARGIN = 1e-7
MAX_TOTAL_VERTICES = 400_000
MAX_TOTAL_TRIANGLES = 600_000
EXPECTED_ADDED_VERTICES = 2_348
EXPECTED_ADDED_TRIANGLES = 2_387
OLD_HEIGHT_LIMITATION = "physical height unknown; 400 m is render-only shell separation"
HEIGHT_LIMITATION = "physical height unknown; renderer-only shell offsets are not source elevation"


class BuildError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha(path: Path) -> str:
    return sha256(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, payload: bytes) -> None:
    temporary = path.with_name(path.name + ".iceland-shelf-stage")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def decode_ehgb(data: bytes) -> dict:
    if len(data) < HEADER_BYTES or data[:4] != b"EHGB":
        raise BuildError("invalid EHGB geometry")
    version, header, vertices, triangles, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if (version, header) != (2, HEADER_BYTES) or any(reserved):
        raise BuildError("unsupported EHGB geometry header")
    expected = HEADER_BYTES + 20 * vertices + 12 * triangles
    if len(data) != expected:
        raise BuildError("EHGB geometry byte count changed")
    directions = [struct.unpack_from("<fff", data, HEADER_BYTES + 12 * index)
                  for index in range(vertices)]
    seam_offset = HEADER_BYTES + 12 * vertices
    seams = list(struct.unpack_from(f"<{vertices}I", data, seam_offset))
    chart_offset = seam_offset + 4 * vertices
    charts = list(struct.unpack_from(f"<{vertices}I", data, chart_offset))
    index_offset = chart_offset + 4 * vertices
    indices = list(struct.unpack_from(f"<{3 * triangles}I", data, index_offset))
    return {"directions": directions, "seams": seams, "charts": charts, "indices": indices}


def encode_ehgb(directions, seams, charts, indices) -> bytes:
    vertices = len(directions)
    if len(seams) != vertices or len(charts) != vertices or len(indices) % 3:
        raise BuildError("inconsistent shelf geometry arrays")
    triangles = len(indices) // 3
    payload = bytearray(HEADER_BYTES + 20 * vertices + 12 * triangles)
    payload[:4] = b"EHGB"
    struct.pack_into("<HHIIIIII", payload, 4, 2, HEADER_BYTES, vertices, triangles, 0, 0, 0, 0)
    offset = HEADER_BYTES
    for direction in directions:
        struct.pack_into("<fff", payload, offset, *direction)
        offset += 12
    for value in seams:
        struct.pack_into("<I", payload, offset, value)
        offset += 4
    for value in charts:
        struct.pack_into("<I", payload, offset, value)
        offset += 4
    for value in indices:
        struct.pack_into("<I", payload, offset, value)
        offset += 4
    return bytes(payload)


def find_feature(collection: dict, feature_id: str) -> dict:
    matches = [row for row in collection["features"] if row.get("id") == feature_id]
    if len(matches) != 1:
        raise BuildError(f"{feature_id}: expected one source feature")
    return matches[0]


def triangulate_source(contract: dict, chart_offset: int) -> tuple[list, list, list]:
    geometry_path = CONTRACT.parent / contract["features"][0]["geometryAsset"]["path"]
    declared = contract["features"][0]["geometryAsset"]
    if (geometry_path.stat().st_size != declared["bytes"]
            or sha(geometry_path) != declared["sha256"]):
        raise BuildError("Iceland shallow-marine GeoJSON identity changed")
    collection = json.loads(geometry_path.read_text())
    directions, patches = [], []
    for local_chart, feature_id in enumerate(FEATURE_ORDER):
        source = find_feature(collection, feature_id)
        for polygon_index, polygon in enumerate(material.polygons(source["geometry"])):
            rings, polygon_directions = [], []
            for coordinates in polygon:
                if coordinates[0][:2] == coordinates[-1][:2]:
                    coordinates = coordinates[:-1]
                offset = len(directions)
                ring_directions = [material.unit(material.lon_lat_direction(point)) for point in coordinates]
                directions.extend(ring_directions)
                polygon_directions.extend(ring_directions)
                rings.append({"offset": offset, "count": len(ring_directions)})
            patches.append({
                "patchId": f"{feature_id}:{polygon_index}",
                "rings": rings,
                "interiorDirection": list(material.unit(tuple(
                    sum(point[axis] for point in polygon_directions) for axis in range(3)
                ))),
                "chartIndex": chart_offset + local_chart,
            })
    with tempfile.TemporaryDirectory(prefix="earthhistory-iceland-shelf-") as scratch_value:
        scratch = Path(scratch_value)
        metadata = scratch / "rings.json"
        direction_path = scratch / "directions.f32"
        index_path = scratch / "indices.u32"
        metadata.write_bytes(material.canonical_json({"patches": patches}))
        raw = bytearray(12 * len(directions))
        for index, direction in enumerate(directions):
            struct.pack_into("<fff", raw, 12 * index, *direction)
        direction_path.write_bytes(raw)
        subprocess.run(["node", str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
                        str(metadata), str(direction_path), str(index_path)], check=True)
        report = json.loads(Path(str(index_path) + ".json").read_text())
        failures = [row for row in report["patches"] if row["status"] != "candidate"]
        if failures:
            raise BuildError(f"Iceland shelf triangulation failed for {len(failures)} patches")
        indices = list(struct.unpack(f"<{index_path.stat().st_size // 4}I", index_path.read_bytes()))
    vertex_charts = [0] * len(directions)
    for row in report["patches"]:
        source = next(item for item in patches if item["patchId"] == row["patchId"])
        for ring in source["rings"]:
            vertex_charts[ring["offset"]:ring["offset"] + ring["count"]] = [source["chartIndex"]] * ring["count"]
    old_shell = material.DISPLAY_SHELL_OFFSET_METRES
    try:
        material.DISPLAY_SHELL_OFFSET_METRES = SHELF_SHELL_METRES
        directions, indices, vertex_charts = material.refine_triangle_edges(
            directions, indices, vertex_charts
        )
    finally:
        material.DISPLAY_SHELL_OFFSET_METRES = old_shell
    return directions, indices, vertex_charts


def chart(contract: dict, feature: dict, palette_id: str) -> dict:
    feature_id = feature["correctionFeatureId"]
    plate_id = feature["pose"]["plateId"]
    limitations = [feature["uncertainty"][key] for key in ("spatial", "temporal", "depth", "exposure")]
    return {
        "kind": "rigid",
        "role": "model-geography",
        "chartId": CHART_PREFIX + feature_id,
        "chartRevision": contract["correctionId"] + "@" + contract["version"],
        "materialId": CHART_PREFIX + feature_id,
        "fragmentOrCohortId": feature_id,
        "lifecycle": copy.deepcopy(feature["phaseLifecycles"]["classified-shallow-marine"]),
        "geometryReferenceAgeMa": 0,
        "motionBindings": [{
            "paletteId": palette_id,
            "entryId": f"plate-{plate_id}-0-1800" if plate_id == 101 else f"plate-{plate_id}-0-130",
            "validTimeMa": {"youngest": 0, "oldest": 0},
        }],
        "sourceFeatureIds": [feature_id],
        "sourceFeatureTypes": [SOURCE_TYPE],
        "evidence": {
            "status": "derived-overlay",
            "sourceIds": list(feature["sourceIds"]),
            "limitations": limitations,
        },
        "surfaceEvidence": copy.deepcopy(feature["surfaceEvidence"]),
    }


def triangle_radius_extrema(data: dict, shell_metres: float) -> tuple[float, float]:
    shell = 1 + shell_metres / EARTH_RADIUS_METRES
    directions = data["directions"]
    minimum = math.inf
    for offset in range(0, len(data["indices"]), 3):
        points = [directions[data["indices"][offset + local]] for local in range(3)]
        minimum = min(minimum, material.triangle_minimum_radius(*points) * shell)
    maximum = max(math.sqrt(material.dot(point, point)) * shell for point in directions)
    return minimum, maximum


def clearance_report(package: Path) -> dict:
    catalog = json.loads((package / "corrections/material-v1/catalog.json").read_text())
    shelf = decode_ehgb((package / "batch-shelf.ehgb").read_bytes())
    land = decode_ehgb((package / "batch-land.ehgb").read_bytes())
    shelf_min, shelf_max = triangle_radius_extrema(shelf, SHELF_SHELL_METRES)
    land_min, _ = triangle_radius_extrema(land, LAND_SHELL_METRES)
    correction_minima = {}
    for batch in catalog["spatialBatches"]:
        value = decode_ehgb((package / batch["geometryAsset"]["url"]).read_bytes())
        correction_minima[batch["batchId"]] = triangle_radius_extrema(value, LAND_SHELL_METRES)[0]
    all_land_min = min(land_min, *correction_minima.values())
    old_shelf_min, _ = triangle_radius_extrema(shelf, 80)
    old_land_min, _ = triangle_radius_extrema(land, 400)
    return {
        "shelfShellMetres": SHELF_SHELL_METRES,
        "landShellMetres": LAND_SHELL_METRES,
        "shelfMinimumDisplayedRadius": shelf_min,
        "shelfMaximumDisplayedVertexRadius": shelf_max,
        "landMinimumDisplayedRadius": all_land_min,
        "minimumLandOverShelfRadiusGap": all_land_min - shelf_max,
        "old80mShelfMinimumDisplayedRadius": old_shelf_min,
        "old400mLandMinimumDisplayedRadius": old_land_min,
        "correctionLandMinimumDisplayedRadii": correction_minima,
    }


def assert_clearance(report: dict) -> None:
    if report["old80mShelfMinimumDisplayedRadius"] > 1:
        raise BuildError("old 80 m shelf mutation no longer reproduces globe intersection")
    if report["old400mLandMinimumDisplayedRadius"] > report["shelfMaximumDisplayedVertexRadius"]:
        raise BuildError("old 400 m land mutation no longer reproduces shelf ordering failure")
    if report["shelfMinimumDisplayedRadius"] <= 1 + FLOAT32_ORDER_MARGIN:
        raise BuildError("400 m shelf intersects or lacks float32 clearance above opaque globe")
    if report["minimumLandOverShelfRadiusGap"] <= FLOAT32_ORDER_MARGIN:
        raise BuildError("800 m land does not clear the maximum shelf vertex radius")


def update_checkpoint(package: Path, descriptor: dict, shelf_vertices: int) -> None:
    path = package / descriptor["url"]
    before_size = path.stat().st_size
    value = json.loads(path.read_text())
    shelf = next((row for row in value["batchControls"] if row["batchId"] == "batch-shelf"), None)
    if shelf is None:
        raise BuildError(f"{path.name}: missing shelf batch control")
    shelf["vertexCount"] = shelf_vertices
    write_atomic(path, canonical(value))
    descriptor["bytes"] = path.stat().st_size
    descriptor["sha256"] = sha(path)
    descriptor["transitiveBytes"] += path.stat().st_size - before_size


def correction_invariance_snapshot(package: Path, manifest: dict) -> tuple[dict, dict[str, dict]]:
    catalog_path = package / manifest["materialCorrections"]["catalog"]["url"]
    catalog = json.loads(catalog_path.read_text())
    geometry = {
        batch["batchId"]: decode_ehgb((package / batch["geometryAsset"]["url"]).read_bytes())
        for batch in catalog["spatialBatches"]
    }
    return catalog, geometry


def assert_correction_index_only_regeneration(
    before_catalog: dict,
    before_geometry: dict[str, dict],
    after_catalog: dict,
    after_geometry: dict[str, dict],
) -> None:
    for key in ("correctionIds", "nativeChartOverrides", "alignmentWitnesses", "charts"):
        if before_catalog[key] != after_catalog[key]:
            raise BuildError(f"material correction {key} changed during shelf append")
    before_batches = {row["batchId"]: row for row in before_catalog["spatialBatches"]}
    after_batches = {row["batchId"]: row for row in after_catalog["spatialBatches"]}
    if before_batches.keys() != after_batches.keys():
        raise BuildError("material correction batch identities changed")
    for batch_id, before in before_batches.items():
        after = after_batches[batch_id]
        if ((before["vertexCount"], before["triangleCount"], before["encoding"], before["overlapPolicy"])
                != (after["vertexCount"], after["triangleCount"], after["encoding"], after["overlapPolicy"])):
            raise BuildError(f"{batch_id}: material correction batch semantics changed")
        if after["staticDisplayControl"] != {"displayHeightMetres": 0, "baseColorRgb": material.LAND_COLOR}:
            raise BuildError(f"{batch_id}: material correction display is not the uniform land palette")
        old, new = before_geometry[batch_id], after_geometry[batch_id]
        for key in ("directions", "seams", "indices"):
            if old[key] != new[key]:
                raise BuildError(f"{batch_id}: decoded correction {key} changed")
        if any(right != left + 2 for left, right in zip(old["charts"], new["charts"])):
            raise BuildError(f"{batch_id}: correction chart indices did not shift exactly by two")


def apply(package: Path) -> dict:
    package = package.resolve()
    contract = json.loads(CONTRACT.read_text())
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    core, manifest = json.loads(core_path.read_text()), json.loads(manifest_path.read_text())
    palette_hashes = {name: sha(package / name) for name in ("motion-palette.json", "motion-palette.bin")}
    before_catalog, before_correction_geometry = correction_invariance_snapshot(package, manifest)
    if any(chart["chartId"].startswith(CHART_PREFIX) for chart in core["charts"]):
        raise BuildError("Iceland shallow-marine charts are already applied")
    if manifest["core"] != asset(core_path):
        raise BuildError("package core identity mismatch")
    shelf_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-shelf")
    shelf_path = package / shelf_batch["geometryAsset"]["url"]
    original = decode_ehgb(shelf_path.read_bytes())
    old_vertices, old_triangles = len(original["directions"]), len(original["indices"]) // 3
    chart_offset = len(core["charts"])
    if chart_offset != 4824:
        raise BuildError(f"expected 4824 composed charts before Iceland shelf, found {chart_offset}")
    additions, indices, charts = triangulate_source(contract, chart_offset)
    if (len(additions), len(indices) // 3) != (EXPECTED_ADDED_VERTICES, EXPECTED_ADDED_TRIANGLES):
        raise BuildError("Iceland shelf compiled mesh inventory changed")
    vertex_offset = old_vertices
    combined = {
        "directions": [*original["directions"], *additions],
        "seams": [*original["seams"], *(2_100_000_000 + index for index in range(len(additions)))],
        "charts": [*original["charts"], *charts],
        "indices": [*original["indices"], *(vertex_offset + index for index in indices)],
    }
    write_atomic(shelf_path, encode_ehgb(**combined))
    replaced_height_limitations = 0
    for existing in core["charts"]:
        limitations = existing.get("evidence", {}).get("limitations", [])
        if OLD_HEIGHT_LIMITATION in limitations:
            limitations[limitations.index(OLD_HEIGHT_LIMITATION)] = HEIGHT_LIMITATION
            replaced_height_limitations += 1
    if replaced_height_limitations != 3_784:
        raise BuildError("native render-only shell metadata inventory changed")
    core["charts"].extend(chart(contract, feature, manifest["motionPalette"]["id"])
                          for feature in contract["features"])
    shelf_batch["vertexCount"] = len(combined["directions"])
    shelf_batch["triangleCount"] = len(combined["indices"]) // 3
    shelf_batch["geometryAsset"] = asset(shelf_path)
    write_atomic(core_path, canonical(core))
    manifest["core"] = asset(core_path)
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        manifest["scope"] += SCOPE_CLAUSE
    for descriptor in manifest["checkpoints"]:
        update_checkpoint(package, descriptor, shelf_batch["vertexCount"])
    write_atomic(manifest_path, canonical(manifest))
    python = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python"
    subprocess.run([str(python), str(ROOT / "scripts/research/emit_cao_material_corrections.py"),
                    "--package", str(package), "--skip-root-manifest"], check=True)
    updated_manifest = json.loads(manifest_path.read_text())
    after_catalog, after_correction_geometry = correction_invariance_snapshot(package, updated_manifest)
    assert_correction_index_only_regeneration(
        before_catalog, before_correction_geometry, after_catalog, after_correction_geometry
    )
    result = validate_applied(package, original_geometry=original)
    result.update({
        "addedVertices": len(additions),
        "addedTriangles": len(indices) // 3,
        "oldShelfVertices": old_vertices,
        "oldShelfTriangles": old_triangles,
        "replacedHeightLimitations": replaced_height_limitations,
        "motionPaletteByteIdentical": all(sha(package / name) == digest
                                           for name, digest in palette_hashes.items()),
        "correctionGeometryIndexOnlyRegeneration": True,
    })
    if not result["motionPaletteByteIdentical"]:
        raise BuildError("motion palette changed during Iceland shelf integration")
    return result


def validate_applied(package: Path, original_geometry: dict | None = None) -> dict:
    package = package.resolve()
    contract = json.loads(CONTRACT.read_text())
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    core, manifest = json.loads(core_path.read_text()), json.loads(manifest_path.read_text())
    if manifest["core"] != asset(core_path):
        raise BuildError("applied core identity mismatch")
    shelf_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-shelf")
    shelf_path = package / shelf_batch["geometryAsset"]["url"]
    if shelf_batch["geometryAsset"] != asset(shelf_path):
        raise BuildError("applied shelf identity mismatch")
    decoded = decode_ehgb(shelf_path.read_bytes())
    if (shelf_batch["vertexCount"] != len(decoded["directions"])
            or shelf_batch["triangleCount"] != len(decoded["indices"]) // 3):
        raise BuildError("applied shelf counts mismatch")
    matches = [(index, value) for index, value in enumerate(core["charts"])
               if value["chartId"].startswith(CHART_PREFIX)]
    if [index for index, _ in matches] != [4824, 4825]:
        raise BuildError("Iceland shelf chart indices changed")
    expected_ids = [CHART_PREFIX + value for value in FEATURE_ORDER]
    if [value["chartId"] for _, value in matches] != expected_ids:
        raise BuildError("Iceland shelf chart identities changed")
    for (_, value), feature in zip(matches, contract["features"]):
        if (value["lifecycle"] != {"validTimeMa": {"youngest": 0, "oldest": 0}}
                or value["surfaceEvidence"] != feature["surfaceEvidence"]
                or value["sourceFeatureTypes"] != [SOURCE_TYPE]
                or value["evidence"]["sourceIds"] != [SOURCE_ID]):
            raise BuildError("Iceland shelf lifecycle or evidence changed")
    if (len(decoded["directions"]) - 153_904 != EXPECTED_ADDED_VERTICES
            or len(decoded["indices"]) // 3 - 251_187 != EXPECTED_ADDED_TRIANGLES):
        raise BuildError("Iceland shelf appended mesh inventory changed")
    if set(decoded["charts"][153_904:]) != {4824, 4825}:
        raise BuildError("Iceland shelf geometry is not bound to both exact charts")
    old_count = sum(OLD_HEIGHT_LIMITATION in value.get("evidence", {}).get("limitations", [])
                    for value in core["charts"])
    new_count = sum(HEIGHT_LIMITATION in value.get("evidence", {}).get("limitations", [])
                    for value in core["charts"])
    if old_count != 0 or new_count != 3_784:
        raise BuildError("render-only shell metadata was not rebound exactly")
    if original_geometry is not None:
        old_v, old_i = len(original_geometry["directions"]), len(original_geometry["indices"])
        for key in ("directions", "seams", "charts"):
            if decoded[key][:old_v] != original_geometry[key]:
                raise BuildError(f"existing shelf {key} changed")
        if decoded["indices"][:old_i] != original_geometry["indices"]:
            raise BuildError("existing shelf triangles changed")
    for descriptor in manifest["checkpoints"]:
        checkpoint = package / descriptor["url"]
        if (descriptor["bytes"] != checkpoint.stat().st_size or descriptor["sha256"] != sha(checkpoint)
                or next(row for row in json.loads(checkpoint.read_text())["batchControls"]
                        if row["batchId"] == "batch-shelf")["vertexCount"] != len(decoded["directions"])):
            raise BuildError("checkpoint shelf inventory is stale")
    catalog_path = package / manifest["materialCorrections"]["catalog"]["url"]
    if manifest["materialCorrections"]["catalog"] != asset(
            catalog_path, str(catalog_path.relative_to(package))):
        raise BuildError("material correction catalog identity mismatch")
    catalog = json.loads(catalog_path.read_text())
    if catalog["baseline"]["coreSha256"] != manifest["core"]["sha256"]:
        raise BuildError("material correction baseline is stale")
    land_color = material.LAND_COLOR
    if any(row["staticDisplayControl"]["baseColorRgb"] != land_color
           for row in catalog["spatialBatches"]):
        raise BuildError("material correction land display colors diverge")
    chart_indices = []
    for batch in catalog["spatialBatches"]:
        geometry = decode_ehgb((package / batch["geometryAsset"]["url"]).read_bytes())
        chart_indices.extend(geometry["charts"])
    expected_correction_indices = set(range(4826, 4826 + len(catalog["charts"])))
    if set(chart_indices) != expected_correction_indices:
        raise BuildError("material correction chart indices were not shifted exactly after shelf append")
    for key in ("catalog", "binary"):
        descriptor = manifest["motionPalette"][key]
        path = package / descriptor["url"]
        if descriptor != asset(path):
            raise BuildError("motion palette descriptor is stale")
    total_vertices = sum(row["vertexCount"] for row in core["spatialBatches"]) + sum(
        row["vertexCount"] for row in catalog["spatialBatches"])
    total_triangles = sum(row["triangleCount"] for row in core["spatialBatches"]) + sum(
        row["triangleCount"] for row in catalog["spatialBatches"])
    if total_vertices >= MAX_TOTAL_VERTICES or total_triangles >= MAX_TOTAL_TRIANGLES:
        raise BuildError("composed geometry exceeds runtime budget")
    report = clearance_report(package)
    assert_clearance(report)
    return {
        "core": manifest["core"],
        "shelf": shelf_batch["geometryAsset"],
        "shelfVertices": shelf_batch["vertexCount"],
        "shelfTriangles": shelf_batch["triangleCount"],
        "totalVertices": total_vertices,
        "totalTriangles": total_triangles,
        "classifiedShallowMarineCharts": len(matches),
        "clearance": report,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--apply", action="store_true")
    action.add_argument("--validate-applied", action="store_true")
    action.add_argument("--clearance", action="store_true")
    args = parser.parse_args()
    if args.apply:
        if args.package.resolve() == DEFAULT_PACKAGE.resolve():
            raise BuildError("apply only to a staged package; promote the validated bundle atomically")
        value = apply(args.package)
    elif args.validate_applied:
        value = validate_applied(args.package)
    else:
        value = clearance_report(args.package)
        assert_clearance(value)
    print(json.dumps(value, indent=2))


if __name__ == "__main__":
    main()

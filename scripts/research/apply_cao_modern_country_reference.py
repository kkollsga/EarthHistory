#!/usr/bin/env python3
"""Append the exact-present Natural Earth complement to a staged Cao line batch."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import struct
from copy import deepcopy
from pathlib import Path
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
SOURCE = POOL / "source-inputs/natural-earth-countries.geojson"
CONTRACT = ROOT / "data/corrections/country-reference/exact-present-extension-v1.json"
CHART_PREFIX = "country-present-reference:"
ENTRY_ID = "country-present-reference-plate-0-identity"
INTERVAL_ID = "country-present-reference-clock-0-v1"
HEADER_BYTES = 32
MOTION_RECORD_BYTES = 20
MAX_EDGE_RADIANS = math.radians(1)
SCOPE_CLAUSE = (
    " Natural Earth 1:110m completes the modern-country locator at exact 0 Ma; "
    "unassigned segments remain unavailable at every older age."
)
EXPECTED_SOURCE_METADATA = {
    "sourceId": "natural-earth-countries-110m",
    "title": "Natural Earth 1:110m Admin 0 Countries",
    "url": "https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/",
    "path": "natural-earth-countries.geojson",
    "bytes": 838726,
    "sha256": "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
    "publicationOrVersionDate": "5.1.1",
    "retrievedAt": "2026-09-09",
    "license": "Public domain",
    "temporalRangeMa": [0, 0],
    "geographicBasis": (
        "WGS84 generalized present-day country polygons subdivided to at most "
        "1 degree angular edges"
    ),
    "evidenceRole": "exact-present modern-country locator linework only",
}


class BuildError(ValueError):
    pass


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha(path: Path) -> str:
    return sha256(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, value: bytes) -> None:
    temporary = path.with_name(path.name + ".country-present-stage")
    temporary.write_bytes(value)
    os.replace(temporary, path)


def unit(vector):
    length = math.sqrt(sum(value * value for value in vector))
    return tuple(value / length for value in vector)


def angle(left, right):
    return math.acos(max(-1, min(1, sum(a * b for a, b in zip(left, right)))))


def xyz(longitude: float, latitude: float):
    lon, lat = math.radians(longitude), math.radians(latitude)
    return math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)


def slerp(left, right, fraction: float):
    distance = angle(left, right)
    if distance < 1e-12:
        return left
    return unit(tuple(
        math.sin((1 - fraction) * distance) / math.sin(distance) * a
        + math.sin(fraction * distance) / math.sin(distance) * b
        for a, b in zip(left, right)
    ))


def float32(vector):
    return tuple(struct.unpack("<f", struct.pack("<f", value))[0] for value in vector)


def rings(geometry):
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon
    else:
        raise BuildError("Natural Earth country geometry is not polygonal")


def validate_contract(contract: dict) -> None:
    if (contract.get("schemaVersion") != 1
            or contract.get("extensionId") != "earthhistory-country-reference-exact-present-v1"):
        raise BuildError("exact-present country contract identity changed")
    declared = contract["source"]
    for key, expected in EXPECTED_SOURCE_METADATA.items():
        if declared.get(key) != expected:
            raise BuildError(f"exact-present country source {key} changed")


def source_rows(contract: dict) -> list[dict]:
    validate_contract(contract)
    declared = contract["source"]
    if (not SOURCE.is_file() or SOURCE.stat().st_size != declared["bytes"]
            or sha(SOURCE) != declared["sha256"]):
        raise BuildError("pinned Natural Earth country source is unavailable or changed")
    source = json.loads(SOURCE.read_text())
    rows = []
    for feature_index, feature in enumerate(source["features"]):
        properties = feature["properties"]
        identifiers = [properties.get("ADM0_A3"), properties.get("ISO_A3"),
                       properties.get("NE_ID"), feature_index]
        country = str(next(value for value in identifiers if value not in (None, "", -99, "-99"))).lower()
        for part, ring in enumerate(rings(feature["geometry"])):
            for edge, (start, end) in enumerate(zip(ring, ring[1:])):
                left, right = xyz(*start), xyz(*end)
                count = max(1, math.ceil(angle(left, right) / MAX_EDGE_RADIANS))
                for subdivision in range(count):
                    rows.append({
                        "countryId": country,
                        "part": part,
                        "edge": edge,
                        "subdivision": subdivision,
                        "left": float32(slerp(left, right, subdivision / count)),
                        "right": float32(slerp(left, right, (subdivision + 1) / count)),
                    })
    return rows


def geometry_key(left, right) -> tuple:
    return tuple(left) + tuple(right)


def row_key(row: dict) -> dict:
    return {key: row[key] for key in ("countryId", "part", "edge", "subdivision")}


def country_from_chart(core: dict, chart_index: int) -> str:
    chart_value = core["charts"][chart_index]
    material_id = chart_value.get("materialId", "")
    if chart_value.get("role") != "country-reference" or not material_id.startswith("country:"):
        raise BuildError("country line vertex references a non-country chart")
    return material_id[len("country:"):]


def complement(rows: list[dict], geometry: dict, core: dict) -> list[dict]:
    present = collections.Counter()
    for offset in range(0, len(geometry["indices"]), 2):
        left, right = geometry["indices"][offset:offset + 2]
        if geometry["charts"][left] != geometry["charts"][right]:
            raise BuildError("country line segment crosses chart ownership")
        present[(
            country_from_chart(core, geometry["charts"][left]),
            geometry_key(geometry["directions"][left], geometry["directions"][right]),
        )] += 1
    result = []
    for row in rows:
        key = (row["countryId"], geometry_key(row["left"], row["right"]))
        if present[key]:
            present[key] -= 1
        else:
            result.append(row)
    if sum(present.values()):
        raise BuildError("country line batch contains geometry outside the pinned Natural Earth subdivision corpus")
    return result


def validate_complement(contract: dict, rows: list[dict], missing: list[dict]) -> None:
    expected = contract["exactPresentComplement"]
    key_hash = sha256(canonical([row_key(row) for row in missing]))
    geometry_hash = sha256(b"".join(
        struct.pack("<6f", *(row["left"] + row["right"])) for row in missing
    ))
    undirected = collections.defaultdict(list)
    for row in missing:
        undirected[tuple(sorted((tuple(row["left"]), tuple(row["right"]))))].append(row)
    shared = [group for group in undirected.values() if len(group) > 1]
    if any(
        len(group) != 2
        or group[0]["countryId"] == group[1]["countryId"]
        or group[0]["left"] != group[1]["right"]
        or group[0]["right"] != group[1]["left"]
        for group in shared
    ):
        raise BuildError("exact-present shared-border country identity changed")
    if (len(rows) != expected["sourceSubdivisionCount"]
            or len(missing) != expected["segmentCount"]
            or len({row["countryId"] for row in missing}) != expected["countryCount"]
            or len(shared) != expected["reverseSharedBorderPairCount"]
            or key_hash != expected["sourceKeySha256"]
            or geometry_hash != expected["float32GeometrySha256"]):
        raise BuildError("exact-present country complement identity changed")


def decode_ehgl(data: bytes) -> dict:
    if len(data) < HEADER_BYTES or data[:4] != b"EHGL":
        raise BuildError("invalid EHGL geometry")
    version, header, vertices, segments, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if (version, header) != (2, HEADER_BYTES) or any(reserved):
        raise BuildError("unsupported EHGL geometry header")
    if len(data) != HEADER_BYTES + 16 * vertices + 8 * segments:
        raise BuildError("EHGL byte count changed")
    offset = HEADER_BYTES
    directions = [struct.unpack_from("<fff", data, offset + 12 * index) for index in range(vertices)]
    offset += 12 * vertices
    charts = list(struct.unpack_from(f"<{vertices}I", data, offset)); offset += 4 * vertices
    indices = list(struct.unpack_from(f"<{2 * segments}I", data, offset))
    return {"directions": directions, "charts": charts, "indices": indices}


def encode_ehgl(directions, charts, indices) -> bytes:
    vertices = len(directions)
    if len(charts) != vertices or len(indices) % 2:
        raise BuildError("inconsistent EHGL arrays")
    segments = len(indices) // 2
    payload = bytearray(HEADER_BYTES + 16 * vertices + 8 * segments)
    payload[:4] = b"EHGL"
    struct.pack_into("<HHIIIIII", payload, 4, 2, HEADER_BYTES, vertices, segments, 0, 0, 0, 0)
    offset = HEADER_BYTES
    for row in directions:
        struct.pack_into("<fff", payload, offset, *row); offset += 12
    for value in charts:
        struct.pack_into("<I", payload, offset, value); offset += 4
    for value in indices:
        struct.pack_into("<I", payload, offset, value); offset += 4
    return bytes(payload)


def decode_palette(path: Path, catalog: dict) -> tuple[bytes, list[tuple]]:
    data = path.read_bytes()
    if len(data) < HEADER_BYTES or data[:4] != b"EHMP":
        raise BuildError("invalid motion palette binary")
    version, record_bytes, entries, samples, header, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if ((version, record_bytes, entries, header) !=
            (2, MOTION_RECORD_BYTES, len(catalog["entries"]), HEADER_BYTES)
            or len(data) != HEADER_BYTES + samples * MOTION_RECORD_BYTES or any(reserved)):
        raise BuildError("motion palette header/catalog mismatch")
    records = [struct.unpack_from("<Iffff", data, HEADER_BYTES + index * MOTION_RECORD_BYTES)
               for index in range(samples)]
    return data, records


def encode_palette(catalog: dict, records: list[tuple]) -> bytes:
    payload = bytearray(HEADER_BYTES + MOTION_RECORD_BYTES * len(records))
    payload[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", payload, 4, 2, MOTION_RECORD_BYTES,
                     len(catalog["entries"]), len(records), HEADER_BYTES, 0, 0, 0)
    for index, record in enumerate(records):
        struct.pack_into("<Iffff", payload, HEADER_BYTES + MOTION_RECORD_BYTES * index, *record)
    return bytes(payload)


def chart(country: str, palette_id: str) -> dict:
    return {
        "kind": "rigid",
        "role": "country-reference",
        "chartId": CHART_PREFIX + country,
        "chartRevision": "earthhistory-country-reference-exact-present-v1@1",
        "materialId": "country:" + country,
        "fragmentOrCohortId": CHART_PREFIX + country,
        "lifecycle": {"validTimeMa": {"youngest": 0, "oldest": 0}},
        "geometryReferenceAgeMa": 0,
        "motionBindings": [{
            "paletteId": palette_id,
            "entryId": ENTRY_ID,
            "validTimeMa": {"youngest": 0, "oldest": 0},
        }],
        "sourceFeatureIds": [country],
        "sourceFeatureTypes": ["NaturalEarthAdmin0Reference"],
        "evidence": {
            "status": "derived-overlay",
            "sourceIds": ["natural-earth-countries-110m"],
            "limitations": [
                "present-day locator only; not historical borders",
                "no Cao static-fragment ownership; inactive at every age greater than 0 Ma",
                "reverse-oriented shared borders retain each source country's locator identity",
            ],
        },
        "surfaceEvidence": {"kind": "unknown", "reason": "line overlay has no surface-height evidence"},
    }


def apply(package: Path) -> dict:
    package = package.resolve()
    if package == PUBLIC:
        raise BuildError("--apply requires an explicit staging package; public in-place writes are rejected")
    contract = json.loads(CONTRACT.read_text())
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    palette_path, palette_binary_path = package / "motion-palette.json", package / "motion-palette.bin"
    core, manifest, palette = (package_intern.read_package_json(core_path),
                               json.loads(manifest_path.read_text()), json.loads(palette_path.read_text()))
    if any(row["chartId"].startswith(CHART_PREFIX) for row in core["charts"]):
        raise BuildError("exact-present country extension already applied")
    if any(row["entryId"] == ENTRY_ID for row in palette["entries"]):
        raise BuildError("exact-present country identity entry already applied")
    if manifest["core"] != asset(core_path) or manifest["motionPalette"]["catalog"] != asset(palette_path):
        raise BuildError("package catalog identities are stale")
    line_batch = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
    line_path = package / line_batch["geometryAsset"]["url"]
    baseline = contract["baselineLineAsset"]
    if (line_batch["geometryAsset"] != asset(line_path)
            or line_path.stat().st_size != baseline["bytes"] or sha(line_path) != baseline["sha256"]
            or line_batch["vertexCount"] != baseline["vertexCount"]
            or line_batch["segmentCount"] != baseline["segmentCount"]):
        raise BuildError("released country line baseline changed before exact-present append")
    original_geometry = decode_ehgl(line_path.read_bytes())
    original_charts = deepcopy(core["charts"])
    old_palette_entries = deepcopy(palette["entries"])
    old_intervals = deepcopy(palette["sourceIntervalSets"])
    old_palette_bytes, records = decode_palette(palette_binary_path, palette)
    rows = source_rows(contract)
    missing = complement(rows, original_geometry, core)
    validate_complement(contract, rows, missing)

    country_order = list(dict.fromkeys(row["countryId"] for row in missing))
    chart_offset = len(core["charts"])
    chart_index = {country: chart_offset + index for index, country in enumerate(country_order)}
    directions = list(original_geometry["directions"])
    charts = list(original_geometry["charts"])
    indices = list(original_geometry["indices"])
    for row in missing:
        vertex_offset = len(directions)
        directions.extend((row["left"], row["right"]))
        charts.extend((chart_index[row["countryId"]], chart_index[row["countryId"]]))
        indices.extend((vertex_offset, vertex_offset + 1))
    write_atomic(line_path, encode_ehgl(directions, charts, indices))
    core["charts"].extend(chart(country, palette["id"]) for country in country_order)
    line_batch["vertexCount"] = len(directions)
    line_batch["segmentCount"] = len(indices) // 2
    line_batch["geometryAsset"] = asset(line_path)

    sample_offset = len(records)
    records.append((0, 1.0, 0.0, 0.0, 0.0))
    palette["entries"].append({
        "entryId": ENTRY_ID,
        "plateId": 0,
        "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
        "youngestAgeMa": 0,
        "oldestAgeMa": 0,
        "sampleOffset": sample_offset,
        "sampleCount": 1,
        "sourceIds": ["natural-earth-countries-110m"],
        "sourceIntervalSetId": INTERVAL_ID,
    })
    palette["sourceIntervalSets"].append({
        "id": INTERVAL_ID,
        "intervals": [
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "smooth-motion"},
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "source-knot"},
        ],
    })
    palette_binary = encode_palette(palette, records)
    write_atomic(palette_binary_path, palette_binary)
    palette["binary"] = asset(palette_binary_path)
    write_atomic(palette_path, canonical(palette))
    write_atomic(core_path, canonical(package_intern.intern_charts(core)))
    manifest["core"] = asset(core_path)
    manifest["motionPalette"]["catalog"] = asset(palette_path)
    manifest["motionPalette"]["binary"] = asset(palette_binary_path)
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        manifest["scope"] += SCOPE_CLAUSE
    write_atomic(manifest_path, canonical(manifest))
    return validate_applied(
        package,
        original_geometry=original_geometry,
        original_charts=original_charts,
        old_palette_entries=old_palette_entries,
        old_intervals=old_intervals,
        old_palette_bytes=old_palette_bytes,
    )


def validate_applied(package: Path, *, original_geometry=None, original_charts=None,
                     old_palette_entries=None, old_intervals=None, old_palette_bytes=None) -> dict:
    package = package.resolve()
    contract = json.loads(CONTRACT.read_text())
    validate_contract(contract)
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    palette_path, palette_binary_path = package / "motion-palette.json", package / "motion-palette.bin"
    core, manifest, palette = (package_intern.read_package_json(core_path),
                               json.loads(manifest_path.read_text()), json.loads(palette_path.read_text()))
    if (manifest["core"] != asset(core_path)
            or manifest["motionPalette"]["catalog"] != asset(palette_path)
            or manifest["motionPalette"]["binary"] != asset(palette_binary_path)):
        raise BuildError("applied package identities are stale")
    line_batch = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
    line_path = package / line_batch["geometryAsset"]["url"]
    if line_batch["geometryAsset"] != asset(line_path):
        raise BuildError("applied country line identity is stale")
    geometry = decode_ehgl(line_path.read_bytes())
    matches = [(index, row) for index, row in enumerate(core["charts"])
               if row["chartId"].startswith(CHART_PREFIX)]
    expected_country_count = contract["exactPresentComplement"]["countryCount"]
    if len(matches) != expected_country_count or [index for index, _ in matches] != list(
            range(matches[0][0], matches[0][0] + expected_country_count)):
        raise BuildError("exact-present country chart identity/order changed")
    country_order = [row["chartId"][len(CHART_PREFIX):] for _, row in matches]
    if [row for _, row in matches] != [chart(country, palette["id"]) for country in country_order]:
        raise BuildError("exact-present country chart evidence or motion binding changed")
    # The complement occupies the contiguous tail after the released native
    # baseline. Its segment geometry, order and country identity are pinned
    # here; which chart inside a country owns a complement segment is the
    # separate source-fragment bridge contract, so this validator reads country
    # identity from the owning chart's materialId rather than assuming the
    # exact-present locator chart.
    target_indices = {index for index, _ in matches}
    expected = contract["exactPresentComplement"]
    baseline_segments = contract["baselineLineAsset"]["segmentCount"]
    target_segments = []
    for offset in range(baseline_segments * 2, len(geometry["indices"]), 2):
        left_index, right_index = geometry["indices"][offset:offset + 2]
        left_chart, right_chart = geometry["charts"][left_index], geometry["charts"][right_index]
        if left_chart != right_chart:
            raise BuildError("exact-present country segment crosses chart ownership")
        target_segments.append((
            geometry["directions"][left_index], geometry["directions"][right_index], left_chart,
        ))
    for offset in range(0, baseline_segments * 2, 2):
        if any(geometry["charts"][vertex] in target_indices
               for vertex in geometry["indices"][offset:offset + 2]):
            raise BuildError("released native country segment carries an exact-present locator chart")
    if len(target_segments) != expected["segmentCount"]:
        raise BuildError("exact-present country segment inventory changed")
    exact_present_bound = sum(1 for _, _, index in target_segments if index in target_indices)
    if exact_present_bound != expected["exactPresentBoundSegmentCount"]:
        raise BuildError("exact-present bound complement inventory changed")
    chart_country = {index: country_from_chart(core, index)
                     for _, _, index in target_segments}
    geometry_hash = sha256(b"".join(
        struct.pack("<6f", *(left + right)) for left, right, _ in target_segments
    ))
    ownership_hash = sha256(b"".join(
        chart_country[chart_index].encode() + b"\0" + struct.pack("<6f", *(left + right))
        for left, right, chart_index in target_segments
    ))
    country_order_hash = sha256(canonical(country_order))
    shared = collections.defaultdict(list)
    for left, right, chart_index in target_segments:
        shared[tuple(sorted((tuple(left), tuple(right))))].append(
            (chart_country[chart_index], left, right)
        )
    shared_pairs = [group for group in shared.values() if len(group) > 1]
    if (geometry_hash != expected["float32GeometrySha256"]
            or ownership_hash != expected["float32CountryGeometrySha256"]
            or country_order_hash != expected["countryOrderSha256"]
            or len(shared_pairs) != expected["reverseSharedBorderPairCount"]
            or any(len(group) != 2 or group[0][0] == group[1][0]
              or group[0][1] != group[1][2] or group[0][2] != group[1][1]
              for group in shared_pairs)):
        raise BuildError("exact-present country geometry or per-country ownership changed")
    baseline = contract["baselineLineAsset"]
    baseline_vertices = baseline["vertexCount"]
    baseline_indices = baseline["segmentCount"] * 2
    baseline_bytes = encode_ehgl(
        geometry["directions"][:baseline_vertices],
        geometry["charts"][:baseline_vertices],
        geometry["indices"][:baseline_indices],
    )
    if (len(baseline_bytes) != baseline["bytes"] or sha256(baseline_bytes) != baseline["sha256"]
            or len(geometry["directions"]) != baseline_vertices + expected["vertexCount"]
            or len(geometry["indices"]) != baseline_indices + expected["segmentCount"] * 2):
        raise BuildError("historical country line prefix or final inventory changed")
    for offset in range(0, len(geometry["indices"]), 2):
        chart_index = geometry["charts"][geometry["indices"][offset]]
        lifecycle = core["charts"][chart_index]["lifecycle"]["validTimeMa"]
        if not lifecycle["youngest"] <= 0 <= lifecycle["oldest"]:
            raise BuildError("country segment is inactive at exact present")

    entry = next((row for row in palette["entries"] if row["entryId"] == ENTRY_ID), None)
    binary, records = decode_palette(palette_binary_path, palette)
    if (entry is None or entry["plateId"] != 0 or entry["youngestAgeMa"] != 0
            or entry["oldestAgeMa"] != 0 or entry["sampleCount"] != 1
            or tuple(records[entry["sampleOffset"]]) != (0, 1.0, 0.0, 0.0, 0.0)):
        raise BuildError("exact-present country identity motion changed")
    interval = next((row for row in palette["sourceIntervalSets"] if row["id"] == INTERVAL_ID), None)
    if interval != {"id": INTERVAL_ID, "intervals": [
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "smooth-motion"},
            {"youngestAgeMa": 0, "oldestAgeMa": 0, "kind": "source-knot"},
    ]}:
        raise BuildError("exact-present country source interval changed")

    if original_geometry is not None:
        vertex_count = len(original_geometry["directions"])
        index_count = len(original_geometry["indices"])
        if (geometry["directions"][:vertex_count] != original_geometry["directions"]
                or geometry["charts"][:vertex_count] != original_geometry["charts"]
                or geometry["indices"][:index_count] != original_geometry["indices"]):
            raise BuildError("existing country geometry changed")
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
            raise BuildError("existing palette records changed")
    return {
        "charts": len(matches),
        "addedVertices": expected["vertexCount"],
        "addedSegments": expected["segmentCount"],
        "totalVertices": len(geometry["directions"]),
        "totalSegments": len(geometry["indices"]) // 2,
        "motionEntries": len(palette["entries"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and args.package is None:
        parser.error("--apply requires an explicit --package staging directory")
    package = args.package.resolve() if args.package else PUBLIC
    result = apply(package) if args.apply else validate_applied(package)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

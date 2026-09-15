#!/usr/bin/env python3
"""Gate the published Cao 2017 palaeo-coastline bytes against both manifests.

`palaeo_coastlines_correction.py` is the compile oracle: it needs the pinned
pyGPlates environment, the source zips and the offline store, none of which a
checkout has. This is the half that can run anywhere, and it is the half that
protects what a browser downloads - that the package manifest's
``palaeoCoastlines`` section, the two columnar class catalogs and the outline
tone tables all describe the files actually published, byte for byte.

The LGM lowstand state is gated here too, because the rest of its pipeline needs
the pinned ETOPO crops and this does not: the tracked contract's pinned crop
digests, its contour datum, its window, its footprint bounds and its measured
areas are all re-checked, and the published payload is decoded and probed at
named witnesses. A checkout carries no raster, so the crop digests are pinned in
this file: re-deriving from a different download has to be a deliberate edit
here, not a silent change of what the globe draws.

``--self-test`` proves each gate can fail: a payload byte flipped under an
unchanged catalog, a catalog digest that no longer matches the package manifest,
an interval dropped from one class only, a relaxed edge bound, a reservation
below the worst interval, an outer-manifest row that was never refreshed, a
changed LGM contour datum, a corrupted LGM crop digest and a flipped LGM witness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path("public/data/reconstruction/cao-v2.4")
PALAEO = PACKAGE / "palaeo-coastlines"
OUTER_MANIFEST = Path("public/data/manifest.json")
OUTER_INPUT_KEY = "cao-2017-palaeogeography-v1"

CATALOG_SCHEMA_VERSION = 2
CATALOG_ENCODING = "palaeo-class-catalog-columnar-v1"
BINDING_ENTRY_RULE = "palaeo-binding-entry-v1"
# 24 Cao 2017 map intervals plus the detached LGM lowstand state.
PUBLISHED_INTERVALS = 25
CAO_2017_INTERVALS = 24
# The outer envelope of both bands; the 2 Myr between them carries no map and
# the catalogs' own interval table is what says so.
AGE_DOMAIN_MA = {"youngest": 0.0195, "oldest": 402.0}

LGM_CONTRACT = Path("data/corrections/palaeo-coastlines/lgm/lgm-lowstand-v1.manifest.json")
LGM_INTERVAL_ID = "lgm"
LGM_OLDEST_MA = 0.0265
LGM_YOUNGEST_EXCLUSIVE_MA = 0.0195
LGM_DATUM_METRES = -120.0
LGM_METHOD = "etopo-2022-eustatic-lowstand-contour-v1"
LGM_PAYLOAD_SHA256 = "d0ea558730a5b85157cedcd74967bb698dba3ebfa8642c68cded9ae6d8023aac"
# The exact ETOPO 2022 60 arc-second surface crops the polygons were contoured
# from, pinned so a re-download cannot change the coastline unnoticed.
LGM_CROPS = {
    "north-sea": ("34053ab92fcd485a179d865abe3401950b4fdc8e957450397b0f7ab84ca2643f",
                  3280847, [-6.0, 49.0, 12.0, 62.0], 1080, 780),
    "sundaland": ("75ac3196f54ad01569c2a1643c312941c1eb677cdfd3a6e7bcff8dbe123e9bd8",
                  6745767, [95.0, -10.0, 120.0, 12.0], 1500, 1320),
    "beringia-west": ("7e3a547e708275caefe5143c58be93a6ba7af961cae5fd02b3f21bbee9a34588",
                      4248056, [160.0, 55.0, 180.0, 72.0], 1200, 1020),
    "beringia-east": ("01d115f2f132e6461a29ff3fa49de30078b0d6369b6d58b971b3f07abe997b44",
                      5627501, [-180.0, 55.0, -150.0, 72.0], 1800, 1020),
}
LGM_FOOTPRINT_BOUNDS = {
    "north-sea": [-6.0, 49.0, 12.0, 62.0],
    "sundaland": [95.0, -10.0, 120.0, 12.0],
    # Beringia is the one footprint that spans the antimeridian, so its eastern
    # bound is numerically smaller than its western one.
    "beringia": [160.0, 55.0, -150.0, 72.0],
}
# Measured by `palaeo_coastlines_lgm_derive.py` from the pinned crops. The
# published payload is cookie-cut, quantised to the int16 ring grid and has
# sub-25 km2 pieces dropped, so it is compared within a tolerance rather than
# for equality; 1 % is far tighter than the drift any of those steps produces.
LGM_FOOTPRINT_LAND_KM2 = {"north-sea": 1_398_252.4, "sundaland": 4_085_716.8,
                          "beringia": 3_641_313.9}
LGM_TOTAL_LAND_KM2 = sum(LGM_FOOTPRINT_LAND_KM2.values())
LGM_AREA_TOLERANCE_PERCENT = 1.0
LGM_REQUIRED_SOURCE_IDS = ("noaa-etopo-2022", "lambeck-2014-sea-level", "clark-lgm-2009",
                           "coles-1998-doggerland", "gaffney-2009-doggerland")
# Every limitation the layer must keep saying out loud, matched as a substring.
LGM_REQUIRED_LIMITATIONS = ("eustatic only", "no glacio-isostatic adjustment",
                            "ice sheets are not drawn", "modern bathymetry", "regional")
# (id, longitude, latitude, expected land at 0.021 Ma, why)
LGM_WITNESSES = (
    ("dogger-bank", 2.5, 54.7, True, "Dogger Bank, a shallow bank today"),
    ("sunda-shelf", 108.0, 2.0, True, "central Sunda shelf"),
    ("bering-land-bridge", -170.0, 65.0, True, "Bering land bridge"),
    ("london", -0.1, 51.5, True, "London: present-day land, unchanged by a lowstand"),
    ("norwegian-trench", 4.0, 58.5, False, "Norwegian Trench, far below the datum"),
    ("makassar-strait", 118.5, -2.0, False, "Makassar Strait, never closed by a lowstand"),
    ("aleutian-basin", -175.0, 57.0, False, "deep Aleutian Basin"),
    ("outside-every-footprint", -60.0, -20.0, False,
     "Atlantic off Brazil: outside all three footprints, so the mode falls back there"),
)
EARTH_RADIUS_KM = 6371.0088
EHPR_MAGIC = b"EHPR"
EHPR_HEADER_BYTES = 32
EHPR_PIECE_BYTES = 12
EHPR_RING_BYTES = 2
EHPR_LONGITUDE_SCALE = 32767.0 / 180.0
EHPR_LATITUDE_SCALE = 32767.0 / 90.0
MAXIMUM_EDGE_DEGREES = 1.0
# The interval store holds at most two resident intervals at a time.
RESIDENT_INTERVAL_MULTIPLE = 2
TONE_MAGIC = b"EHPT"


class RuntimeAssetError(ValueError):
    """A published palaeo-coastline asset disagrees with a manifest that indexes it."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeAssetError(message)


def check_asset(root: Path, base: Path, asset: dict, label: str) -> Path:
    path = root / base / asset["url"]
    require(path.is_file(), f"{label}: {asset['url']} is not published")
    require(path.stat().st_size == asset["bytes"],
            f"{label}: {asset['url']} is {path.stat().st_size} bytes, manifest says {asset['bytes']}")
    require(sha256(path) == asset["sha256"], f"{label}: {asset['url']} sha256 does not match the manifest")
    return path


def interval_rows(catalog: dict) -> list[dict]:
    table = catalog["intervals"]
    columns = [key for key in table if key != "count"]
    for column in columns:
        require(len(table[column]) == table["count"],
                f"interval column {column} disagrees with its row count")
    return [{column: table[column][index] for column in columns}
            for index in range(table["count"])]


def check_class(root: Path, entry: dict) -> dict:
    """One class: its catalog identity, its schedule and every payload it indexes."""
    class_name = entry["surfaceClass"]
    catalog_path = check_asset(root, PACKAGE, entry["catalog"], f"class {class_name} catalog")
    catalog = json.loads(catalog_path.read_text())
    require(catalog.get("schemaVersion") == CATALOG_SCHEMA_VERSION
            and catalog.get("encoding") == CATALOG_ENCODING,
            f"class {class_name}: catalog is not the columnar schemaVersion 2 document")
    require("charts" not in catalog,
            f"class {class_name}: the shipped catalog must carry no source-record chart table")
    require(catalog.get("entrySelection", {}).get("rule") == BINDING_ENTRY_RULE,
            f"class {class_name}: catalog does not declare {BINDING_ENTRY_RULE}")
    require(catalog.get("maximumEdgeDegrees", 0) > 0
            and catalog["maximumEdgeDegrees"] <= MAXIMUM_EDGE_DEGREES,
            f"class {class_name}: catalog edge bound is above the chord-sag contract")
    template = catalog["payloadNameTemplate"]
    rows = interval_rows(catalog)
    require(len(rows) == PUBLISHED_INTERVALS,
            f"class {class_name}: {len(rows)} intervals published, expected {PUBLISHED_INTERVALS}")
    directory = PACKAGE / Path(entry["catalog"]["url"]).parent
    bytes_total = catalog_path.stat().st_size
    for row in rows:
        payload = {"url": template.replace("<intervalId>", row["intervalId"]),
                   "bytes": row["bytes"], "sha256": row["sha256"]}
        path = check_asset(root, directory, payload, f"class {class_name} interval {row['intervalId']}")
        bytes_total += path.stat().st_size
    return {"class": class_name, "rows": rows, "bytes": bytes_total}


def check_tone_tables(root: Path, palaeo: dict) -> int:
    catalog_path = check_asset(root, PACKAGE, palaeo["outlineTones"]["catalog"], "outline tone catalog")
    binary_path = check_asset(root, PACKAGE, palaeo["outlineTones"]["binary"], "outline tone payload")
    catalog = json.loads(catalog_path.read_text())
    payload = binary_path.read_bytes()
    require(payload[:4] == TONE_MAGIC, "outline tone payload is not an EHPT file")
    version, header_bytes = struct.unpack_from("<HH", payload, 4)
    tables, segments, per_table = struct.unpack_from("<III", payload, 8)
    require(version == 1 and header_bytes == 32, "unsupported EHPT version")
    require(tables == PUBLISHED_INTERVALS and tables == catalog["tableCount"],
            "outline tone table count is not the published interval count")
    require(segments == catalog["segmentCount"] and per_table == catalog["bytesPerTable"]
            and per_table == -(-segments // 4),
            "outline tone header disagrees with its catalog")
    require(len(payload) == header_bytes + tables * per_table,
            "outline tone payload length disagrees with its header")
    return catalog_path.stat().st_size + binary_path.stat().st_size


# --------------------------------------------------------------------------
# the LGM lowstand state
# --------------------------------------------------------------------------

def decode_ehpr(payload: bytes) -> dict:
    """EHPR v1 header, pieces and lon/lat rings. The format spec is in docs/data."""
    require(payload[:4] == EHPR_MAGIC, "payload is not an EHPR file")
    version, header_bytes = struct.unpack_from("<HH", payload, 4)
    pieces, rings, vertices = struct.unpack_from("<III", payload, 8)
    class_code, interval_index = struct.unpack_from("<HH", payload, 20)
    oldest, youngest = struct.unpack_from("<ff", payload, 24)
    require(version == 1 and header_bytes == EHPR_HEADER_BYTES, "unsupported EHPR version")
    ring_offset = EHPR_HEADER_BYTES + EHPR_PIECE_BYTES * pieces
    vertex_offset = ring_offset + EHPR_RING_BYTES * rings
    require(len(payload) == vertex_offset + 4 * vertices,
            "EHPR payload length disagrees with its header")
    ring_counts = [struct.unpack_from("<H", payload, ring_offset + EHPR_RING_BYTES * index)[0]
                   for index in range(rings)]
    consumed_rings = 0
    consumed_vertices = 0
    decoded_pieces = []
    for index in range(pieces):
        piece_rings = struct.unpack_from("<H", payload,
                                         EHPR_HEADER_BYTES + EHPR_PIECE_BYTES * index + 10)[0]
        shape = []
        for offset in range(piece_rings):
            packed = ring_counts[consumed_rings + offset]
            count = packed & 0x7FFF
            hole = bool(packed & 0x8000)
            ring = []
            for vertex in range(count):
                position = vertex_offset + 4 * (consumed_vertices + vertex)
                x, y = struct.unpack_from("<hh", payload, position)
                ring.append((x / EHPR_LONGITUDE_SCALE, y / EHPR_LATITUDE_SCALE))
            shape.append((ring, hole))
            consumed_vertices += count
        consumed_rings += piece_rings
        decoded_pieces.append(shape)
    require(consumed_rings == rings and consumed_vertices == vertices,
            "EHPR ring or vertex table has records no piece owns")
    return {"classCode": class_code, "intervalIndex": interval_index,
            "intervalOldestAgeMa": oldest, "intervalYoungestAgeMa": youngest,
            "pieces": decoded_pieces, "ringCount": rings, "vertexCount": vertices}


def ring_area_km2(ring: list[tuple[float, float]]) -> float:
    """Spherical excess of one closed ring, in square kilometres.

    The shoelace-on-a-sphere form (Chamberlain & Duquette 2007). The published
    footprints are far from a pole and none spans more than 30 degrees of
    longitude, so the planar antimeridian split the compiler applies leaves every
    ring's longitude differences small and this sum is stable.
    """
    if len(ring) < 3:
        return 0.0
    total = 0.0
    for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:] + ring[:1]):
        delta = math.radians(lon_b - lon_a)
        total += delta * (2 + math.sin(math.radians(lat_a)) + math.sin(math.radians(lat_b)))
    return abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2.0)


def point_in_ring(ring: list[tuple[float, float]], lon: float, lat: float) -> bool:
    inside = False
    for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:] + ring[:1]):
        if (lat_a > lat) != (lat_b > lat):
            crossing = lon_a + (lat - lat_a) / (lat_b - lat_a) * (lon_b - lon_a)
            if lon < crossing:
                inside = not inside
    return inside


def point_in_payload(decoded: dict, lon: float, lat: float) -> bool:
    for shape in decoded["pieces"]:
        exterior, holes = shape[0][0], [ring for ring, hole in shape[1:] if hole]
        if point_in_ring(exterior, lon, lat) and not any(point_in_ring(hole, lon, lat)
                                                         for hole in holes):
            return True
    return False


def check_lgm(root: Path, rows_by_class: dict[str, list[dict]]) -> dict:
    """The tracked LGM contract, the published payload it produced, and the witnesses."""
    contract_path = root / LGM_CONTRACT
    require(contract_path.is_file(), "the LGM lowstand contract is not tracked in the repository")
    contract = json.loads(contract_path.read_text())
    geojson = contract_path.parent / contract["payload"]["path"]
    require(geojson.is_file(), "the LGM lowstand GeoJSON is not tracked beside its manifest")
    require(sha256(geojson) == contract["payload"]["sha256"] == LGM_PAYLOAD_SHA256,
            "the LGM lowstand GeoJSON is not the payload its manifest and this gate pin")
    require(contract["intervalId"] == LGM_INTERVAL_ID
            and contract["oldestMa"] == LGM_OLDEST_MA
            and contract["youngestExclusiveMa"] == LGM_YOUNGEST_EXCLUSIVE_MA,
            "the LGM lowstand window is not 26.5-19.5 ka")
    require(contract["window"]["sourceId"] == "clark-lgm-2009",
            "the LGM window does not cite the paper it comes from")
    require(contract["datum"]["metres"] == LGM_DATUM_METRES
            and contract["datum"]["sourceId"] == "lambeck-2014-sea-level",
            f"the LGM contour datum is not {LGM_DATUM_METRES} m after Lambeck et al. 2014")
    require(contract["method"]["id"] == LGM_METHOD, "the LGM method id changed")
    require(contract["evidence"]["status"] == "derived-from-published-source",
            "the LGM state must ship as a derived overlay, never as an observation")
    declared_sources = set(contract["evidence"]["sourceIds"])
    missing = [source_id for source_id in LGM_REQUIRED_SOURCE_IDS
               if source_id not in declared_sources]
    require(not missing, f"the LGM state does not cite {missing}")
    limitations = " | ".join(contract["limitations"]).lower()
    absent = [line for line in LGM_REQUIRED_LIMITATIONS if line not in limitations]
    require(not absent, f"the LGM state no longer states its limitations: {absent}")

    crops = {row["id"]: row for row in contract["source"]["crops"]}
    require(set(crops) == set(LGM_CROPS), "the LGM contract names different ETOPO crops")
    for identifier, (digest, size, bounds, width, height) in LGM_CROPS.items():
        row = crops[identifier]
        require(row["sha256"] == digest and row["bytes"] == size,
                f"LGM crop {identifier} is not the pinned ETOPO 2022 raster")
        require(row["bounds"] == bounds and row["width"] == width and row["height"] == height,
                f"LGM crop {identifier} does not cover its pinned footprint at the source grid")
        require(row.get("sourceUrl", "").startswith("https://") and row.get("retrievedUtc"),
                f"LGM crop {identifier} records no source url or retrieval time")
    footprints = contract["regional"]["footprints"]
    require({name: entry["bounds"] for name, entry in footprints.items()} == LGM_FOOTPRINT_BOUNDS,
            "the LGM footprints are not the three pinned boxes")
    measured = contract["measurements"]["footprints"]
    for name, expected in LGM_FOOTPRINT_LAND_KM2.items():
        require(abs(measured[name]["landSquareKilometres"] - expected) <= 1.0,
                f"the LGM contract reports a different land area for {name}")

    for class_name, rows in rows_by_class.items():
        row = next((row for row in rows if row["intervalId"] == LGM_INTERVAL_ID), None)
        require(row is not None, f"class {class_name} publishes no {LGM_INTERVAL_ID} interval")
        require(row["fromAgeMa"] == LGM_OLDEST_MA and row["toAgeMa"] == LGM_YOUNGEST_EXCLUSIVE_MA,
                f"class {class_name}: the {LGM_INTERVAL_ID} interval is not 26.5-19.5 ka")
    require(all(row["intervalId"] != LGM_INTERVAL_ID
                for rows in rows_by_class.values() for row in rows[:CAO_2017_INTERVALS]),
            "the LGM interval is not the last row of the published schedule")

    land = decode_ehpr((root / PALAEO / "lm/palaeo-lm-lgm.ehpr").read_bytes())
    sea = decode_ehpr((root / PALAEO / "sm/palaeo-sm-lgm.ehpr").read_bytes())
    require(land["classCode"] == 1 and sea["classCode"] == 2, "an LGM payload is the wrong class")
    require(land["intervalIndex"] == CAO_2017_INTERVALS
            and sea["intervalIndex"] == CAO_2017_INTERVALS,
            "an LGM payload does not carry the detached interval index")
    require(sea["pieces"] == [] and sea["ringCount"] == 0 and sea["vertexCount"] == 0,
            "the LGM shallow-marine payload is not empty: a eustatic contour maps land, not sea")
    # Witnesses first: a total area can survive a shift that moves a coastline
    # onto the wrong ground, and the named place is the more specific answer.
    witnesses = []
    for identifier, lon, lat, expected, note in LGM_WITNESSES:
        actual = point_in_payload(land, lon, lat)
        require(actual == expected,
                f"LGM witness {identifier} ({lon}, {lat}) is "
                f"{'land' if actual else 'not land'} at 0.021 Ma, expected "
                f"{'land' if expected else 'not land'}: {note}")
        witnesses.append({"id": identifier, "lon": lon, "lat": lat, "land": actual})
    area = sum(ring_area_km2(ring) * (-1 if hole else 1)
               for shape in land["pieces"] for ring, hole in shape)
    drift = 100.0 * abs(area - LGM_TOTAL_LAND_KM2) / LGM_TOTAL_LAND_KM2
    require(drift <= LGM_AREA_TOLERANCE_PERCENT,
            f"the published LGM land area is {area:.0f} km2 against the contract's "
            f"{LGM_TOTAL_LAND_KM2:.0f} km2 ({drift:.3f} % apart)")
    # 0 Ma is outside every published interval, so the same ground is the
    # present-day composition there and nothing this layer draws.
    require(not any(row["toAgeMa"] < 0 <= row["fromAgeMa"]
                    for rows in rows_by_class.values() for row in rows),
            "a published interval covers 0 Ma; the present day must fall back")
    return {"payloadBytes": (root / PALAEO / "lm/palaeo-lm-lgm.ehpr").stat().st_size,
            "pieces": len(land["pieces"]), "vertices": land["vertexCount"],
            "landSquareKilometres": round(area, 1),
            "areaDriftPercent": round(drift, 4),
            "shallowMarinePayloadBytes": (root / PALAEO / "sm/palaeo-sm-lgm.ehpr").stat().st_size,
            "witnesses": witnesses}


def check_outer_manifest(root: Path, published: list[Path]) -> None:
    manifest = json.loads((root / OUTER_MANIFEST).read_text())
    entry = manifest.get("inputs", {}).get(OUTER_INPUT_KEY)
    require(entry is not None, f"the outer data manifest declares no {OUTER_INPUT_KEY} input")
    require(entry.get("license"), f"{OUTER_INPUT_KEY} declares no licence")
    declared = {row["path"]: row for row in entry.get("outputs", [])}
    for path in published:
        relative = str(path.relative_to(root))
        row = declared.pop(relative, None)
        require(row is not None, f"outer manifest does not declare {relative}")
        require(row["bytes"] == path.stat().st_size and row["sha256"] == sha256(path),
                f"outer manifest row for {relative} was not refreshed")
    require(not declared,
            f"outer manifest declares palaeo files that are not published: {sorted(declared)}")


def validate(root: Path = ROOT) -> dict:
    package = json.loads((root / PACKAGE / "manifest.json").read_text())
    palaeo = package.get("palaeoCoastlines")
    require(palaeo is not None, "the package manifest declares no palaeoCoastlines section")
    require(palaeo["ageDomainMa"] == AGE_DOMAIN_MA,
            "the palaeo age envelope is not the Cao 2017 band plus the LGM lowstand state")
    reservation = palaeo["reservation"]
    require(0 < reservation["maxEdgeDegrees"] <= MAXIMUM_EDGE_DEGREES,
            "the declared edge bound is above the chord-sag contract")
    classes = [check_class(root, entry) for entry in palaeo["classes"]]
    schedule = [row["intervalId"] for row in classes[0]["rows"]]
    for entry in classes[1:]:
        require([row["intervalId"] for row in entry["rows"]] == schedule,
                f"class {entry['class']} publishes a different interval schedule")
    worst_triangles = max(sum(entry["rows"][index]["estimatedTrianglesAtOneDegree"]
                              for entry in classes) for index in range(len(schedule)))
    worst_bytes = max(sum(entry["rows"][index]["bytes"] for entry in classes)
                      for index in range(len(schedule)))
    require(reservation["maxIntervalTriangles"] >= worst_triangles,
            "the declared triangle reservation is below the worst interval the catalogs index")
    require(reservation["maxResidentSourceBytes"] >= worst_bytes * RESIDENT_INTERVAL_MULTIPLE,
            "the declared resident byte bound cannot hold two intervals")
    for entry in classes:
        require(json.loads((root / PACKAGE / next(
            row["catalog"]["url"] for row in palaeo["classes"]
            if row["surfaceClass"] == entry["class"])).read_text())
            .get("detachedIntervalIds") == [LGM_INTERVAL_ID],
            f"class {entry['class']} does not declare the LGM interval as detached")
    lgm = check_lgm(root, {entry["class"]: entry["rows"] for entry in classes})
    tone_bytes = check_tone_tables(root, palaeo)
    published = sorted(path for path in (root / PALAEO).rglob("*") if path.is_file())
    check_outer_manifest(root, published)
    total = sum(path.stat().st_size for path in published)
    require(total == sum(entry["bytes"] for entry in classes) + tone_bytes,
            "the published palaeo directory holds files no catalog or manifest indexes")
    return {
        "status": "pass",
        "classes": {entry["class"]: {"intervals": len(entry["rows"]), "bytes": entry["bytes"]}
                    for entry in classes},
        "outlineToneBytes": tone_bytes,
        "lgmLowstand": lgm,
        "files": len(published),
        "bytes": total,
        "worstIntervalEstimatedTriangles": worst_triangles,
        "reservation": reservation,
    }


def expect_failure(label: str, root: Path) -> str:
    try:
        validate(root)
    except (RuntimeAssetError, KeyError, json.JSONDecodeError) as error:
        return f"{label}: rejected ({error})"
    raise SystemExit(f"self-test: {label} was accepted")


def self_test() -> dict:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        for relative in (PACKAGE / "manifest.json", OUTER_MANIFEST, LGM_CONTRACT,
                         LGM_CONTRACT.parent / "lgm-lowstand-v1.geojson"):
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, root / relative)
        shutil.copytree(ROOT / PALAEO, root / PALAEO)
        validate(root)
        package_path = root / PACKAGE / "manifest.json"
        outer_path = root / OUTER_MANIFEST
        clean_package = package_path.read_bytes()
        clean_outer = outer_path.read_bytes()
        rejections = []

        payload = root / PALAEO / "lm/palaeo-lm-94-81.ehpr"
        clean_payload = payload.read_bytes()
        flipped = bytearray(clean_payload)
        flipped[64] ^= 0xFF
        payload.write_bytes(bytes(flipped))
        rejections.append(expect_failure("a payload byte flipped under an unchanged catalog", root))
        payload.write_bytes(clean_payload)

        catalog_path = root / PALAEO / "sm/palaeo-sm-catalog.json"
        clean_catalog = catalog_path.read_bytes()
        catalog_path.write_bytes(clean_catalog + b"\n")
        rejections.append(expect_failure("a class catalog edited without a manifest update", root))
        catalog_path.write_bytes(clean_catalog)

        catalog = json.loads(clean_catalog)
        for column in catalog["intervals"]:
            if column != "count":
                catalog["intervals"][column] = catalog["intervals"][column][:-1]
        catalog["intervals"]["count"] -= 1
        dropped = json.dumps(catalog).encode()
        catalog_path.write_bytes(dropped)
        package = json.loads(clean_package)
        for entry in package["palaeoCoastlines"]["classes"]:
            if entry["surfaceClass"] == "sm":
                entry["catalog"]["bytes"] = len(dropped)
                entry["catalog"]["sha256"] = hashlib.sha256(dropped).hexdigest()
        package_path.write_text(json.dumps(package))
        rejections.append(expect_failure("one class missing an interval the other publishes", root))
        catalog_path.write_bytes(clean_catalog)
        package_path.write_bytes(clean_package)

        for field, value, label in (
            ("maxEdgeDegrees", 1.28, "an edge bound relaxed past the chord-sag contract"),
            ("maxIntervalTriangles", 1_000, "a triangle reservation below the worst interval"),
            ("maxResidentSourceBytes", 1_000, "a resident byte bound too small for two intervals"),
        ):
            package = json.loads(clean_package)
            package["palaeoCoastlines"]["reservation"][field] = value
            package_path.write_text(json.dumps(package))
            rejections.append(expect_failure(label, root))
            package_path.write_bytes(clean_package)

        outer = json.loads(clean_outer)
        outer["inputs"][OUTER_INPUT_KEY]["outputs"][0]["sha256"] = "0" * 64
        outer_path.write_text(json.dumps(outer))
        rejections.append(expect_failure("an outer-manifest row that was never refreshed", root))
        outer = json.loads(clean_outer)
        outer["inputs"][OUTER_INPUT_KEY]["outputs"].pop()
        outer_path.write_text(json.dumps(outer))
        rejections.append(expect_failure("a published file the outer manifest does not declare", root))
        outer_path.write_bytes(clean_outer)

        # The LGM lowstand state: its datum, the rasters it was contoured from,
        # and what it claims is land.
        contract_path = root / LGM_CONTRACT
        clean_contract = contract_path.read_bytes()
        for mutate, label in (
            (lambda body: body["datum"].update({"metres": -130.0}),
             "the LGM contour datum changed without a re-derivation"),
            (lambda body: body["source"]["crops"][0].update({"sha256": "0" * 64}),
             "a corrupted LGM ETOPO crop digest"),
            (lambda body: body["measurements"]["footprints"]["north-sea"].update(
                {"landSquareKilometres": 1_000_000.0}),
             "an LGM footprint area that no longer matches the published polygons"),
            (lambda body: body["limitations"].remove(next(
                line for line in body["limitations"] if "glacio-isostatic" in line)),
             "the glacio-isostatic limitation dropped from the LGM contract"),
            (lambda body: body["evidence"]["sourceIds"].remove("lambeck-2014-sea-level"),
             "the LGM eustatic reference dropped from the contract"),
        ):
            body = json.loads(clean_contract)
            mutate(body)
            contract_path.write_text(json.dumps(body))
            rejections.append(expect_failure(label, root))
            contract_path.write_bytes(clean_contract)

        # Two payload mutations, republished through every digest that indexes
        # them so the checksum gates all pass and only the geometry gates are
        # left to catch them. Half a degree east keeps the area inside its
        # tolerance and turns the Norwegian Trench into land; twenty degrees
        # does not, and the area total is what says so.
        lgm_payload = root / PALAEO / "lm/palaeo-lm-lgm.ehpr"
        lgm_catalog = root / PALAEO / "lm/palaeo-lm-catalog.json"
        clean_lgm = lgm_payload.read_bytes()
        clean_lgm_catalog = lgm_catalog.read_bytes()
        vertex_offset = (EHPR_HEADER_BYTES
                         + EHPR_PIECE_BYTES * struct.unpack_from("<I", clean_lgm, 8)[0]
                         + EHPR_RING_BYTES * struct.unpack_from("<I", clean_lgm, 12)[0])
        vertex_count = struct.unpack_from("<I", clean_lgm, 16)[0]
        for degrees, label in (
            (0.5, "an LGM witness flipped by a payload shifted half a degree east"),
            (20.0, "an LGM payload shifted twenty degrees east"),
        ):
            shifted = bytearray(clean_lgm)
            step = int(round(degrees * EHPR_LONGITUDE_SCALE))
            for index in range(vertex_count):
                position = vertex_offset + 4 * index
                longitude = struct.unpack_from("<h", shifted, position)[0]
                struct.pack_into("<h", shifted, position,
                                 max(-32767, min(32767, longitude + step)))
            lgm_payload.write_bytes(bytes(shifted))
            catalog = json.loads(clean_lgm_catalog)
            row = catalog["intervals"]["intervalId"].index(LGM_INTERVAL_ID)
            catalog["intervals"]["sha256"][row] = hashlib.sha256(bytes(shifted)).hexdigest()
            catalog["intervals"]["bytes"][row] = len(shifted)
            rewritten = json.dumps(catalog).encode()
            lgm_catalog.write_bytes(rewritten)
            package = json.loads(clean_package)
            for entry in package["palaeoCoastlines"]["classes"]:
                if entry["surfaceClass"] == "lm":
                    entry["catalog"]["bytes"] = len(rewritten)
                    entry["catalog"]["sha256"] = hashlib.sha256(rewritten).hexdigest()
            package_path.write_text(json.dumps(package))
            outer = json.loads(clean_outer)
            for row_entry in outer["inputs"][OUTER_INPUT_KEY]["outputs"]:
                for path in (lgm_payload, lgm_catalog):
                    if row_entry["path"] == str(path.relative_to(root)):
                        row_entry["bytes"] = path.stat().st_size
                        row_entry["sha256"] = sha256(path)
            outer_path.write_text(json.dumps(outer))
            rejections.append(expect_failure(label, root))
            lgm_payload.write_bytes(clean_lgm)
            lgm_catalog.write_bytes(clean_lgm_catalog)
            package_path.write_bytes(clean_package)
            outer_path.write_bytes(clean_outer)

        restored = validate(root)
    return {"status": "pass", "rejections": rejections, "restored": restored["status"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.self_test else validate()
    except RuntimeAssetError as error:
        print(f"validate-palaeo-coastlines-runtime: FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

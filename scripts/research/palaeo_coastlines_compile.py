#!/usr/bin/env python3
"""Compile the Cao et al. (2017) palaeogeography classes into EHPR v1 ring payloads.

The Cao 2017 package stores landmass (``lm``), shallow marine (``sm``) and
mountain (``m``) polygons in present-day WGS84 with a ``PLATEID1`` and a
published map interval in the ``FROMAGE``/``TOAGE`` DBF fields. EarthHistory
renders the Cao et al. (2024) v2.4 model, so each source ring is cut by the
present-day Cao 2024 static partitions and every piece rides one plate.

Pipeline, per class and per canonical map interval:

1. stream the rings from the pinned archive (never extracted);
2. apply the basin edit contracts in ``data/corrections/palaeo-coastlines/basins``
   (schema, window, declared intervals, references and citations are validated
   first; an operation may only touch the intervals the contract declares, its
   geometry may only lie inside the declared window, and a record it edits may
   not stay active outside those intervals);
3. densify every edge on great circles and split the two wide partition
   polygons at the antimeridian before any planar Boolean;
4. cookie-cut against the present-day static partitions with **exactly one
   owner per piece**: the 441 overlapping partition pairs are resolved by
   giving the shared ground to the smaller partition polygon (see
   ``owner_priority``);
5. bind each piece to its owner plate, except the audit-measured
   ``overrides.json`` plates which are bound by ``PLATEID1``, and except pieces
   on the North Sea partitions 303/315, which bind to the
   ``restoration-north-sea-*`` palette entries inside the restoration window
   exactly as the native charts do; pieces whose binding plate has no gap-free
   palette coverage are dropped and counted; a piece more than 250 km from its
   ``PLATEID1`` position at the interval mid-age is flagged ``frame-conflict``;
6. give every piece the half-open ``(TOAGE, FROMAGE]`` lifecycle of its own
   source record, so an off-schedule record appears in every canonical interval
   it overlaps with its own lifecycle; zero-length and reversed records are
   quarantined;
7. emit the unsimplified ``original`` payload to the offline store and the
   node-reduced ``simplified`` payload to the staging directory, both as
   **EHPR v1** binaries (``docs/data/palaeo-coastlines-format.md``), with the
   country-outline tone tables and, per class, two documents: the columnar
   runtime catalog the browser downloads, and the offline provenance sidecar it
   pins by sha256, which holds the source-record provenance and every compile
   measurement the runtime does not read.

Nothing here writes into ``public/`` or ``src/``. Run with the pinned pyGPlates
environment (see ``docs/research/palaeo-coastlines-cao2017.md``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import pygplates
import shapely
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "data/corrections/palaeo-coastlines"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
STORE = ROOT.parent / "EarthHistory-data/palaeomap-study/palaeo-coastlines"

FORMAT_ID = "EHPR"
FORMAT_VERSION = 1
HEADER_BYTES = 32
PIECE_BYTES = 12
RING_BYTES = 2
# Every per-class catalog array a piece points at is indexed by a u16 field.
CATALOG_INDEX_CEILING = 0x10000
# A ring record is one u16: bit 15 marks a hole, bits 0-14 carry the vertex count.
RING_HOLE_BIT = 0x8000
RING_VERTEX_CEILING = 0x8000
# The runtime catalog is columnar (`pack_columns`) and carries no source-record
# provenance; the sidecar it names by digest carries that and every offline
# measurement the validator re-derives.
CATALOG_SCHEMA_VERSION = 2
CATALOG_ENCODING = "palaeo-class-catalog-columnar-v1"
PROVENANCE_SCHEMA_VERSION = 1
PROVENANCE_ENCODING = "palaeo-class-provenance-columnar-v1"
BINDING_ENTRY_RULE = "palaeo-binding-entry-v1"
BINDING_KINDS = ("partition", "override", "restoration", "recovery")
BINDING_FIELDS = ("bindingPlateId", "partitionPlateId", "kind", "gapSet")
INTERVAL_FIELDS = ("intervalId", "intervalIndex", "fromAgeMa", "toAgeMa", "midAgeMa",
                   "bytes", "sha256", "pieces", "rings", "vertices", "collapsedRings",
                   "baseTriangles", "estimatedTrianglesAtOneDegree")
# `contractId` names the tracked contract a synthetic source record came from:
# null for a Cao 2017 shapefile record, `lgm-lowstand-v1` for an LGM lowstand
# polygon. It is what lets the validator tell a record the archive genuinely
# does not have from one it should have had.
CHART_PROVENANCE_FIELDS = ("sourceRecordIndex", "plateId1", "fromAgeMa", "toAgeMa",
                           "featureIdRef", "offSchedule", "basinOpId", "contractId")

CLASS_CODES = {"lm": 1, "sm": 2, "m": 3}
# What `promote_palaeo_coastlines.py` publishes today. The mountain class stays
# compiled and validated offline (user decision 2026-09-15), so it must not reach
# the outline-tone tables or their interval index. `--shipped-classes` overrides
# this; the promote script re-asserts the staged list against its own.
SHIPPED_CLASSES = ("lm", "sm")
CLASS_NAMES = {"lm": "landmass", "sm": "shallow-marine", "m": "mountain"}
SURFACE_APPEARANCE = {"lm": "palaeo-land", "sm": "palaeo-shallow-marine", "m": "palaeo-mountain"}

LON_SCALE = 32767.0 / 180.0
LAT_SCALE = 32767.0 / 90.0

MIN_PIECE_KM2 = audit.MIN_PIECE_KM2
FRAME_CONFLICT_KM = audit.CO_MOVING_FAR_KM
RESTORATION_PREFIX = "restoration-"
RECOVERY_PREFIX = "native-recovery-plate-"
# The editorial line every basin-edited chart carries, and the prefix each
# operation in a basin contract has to declare for itself. `evidence_record`
# builds the shipped line from the same constant, so the contract and the
# emitted evidence cannot drift apart.
EDITORIAL_PREFIX = "EarthHistory modification after "
NORTH_SEA_PARTITION_PLATES = (303, 315)
MAX_REFINEMENT_EDGE_DEGREES = 1.0
REFINEMENT_TRIANGLE_CAP = 1 << 20

FLAG_FRAME_CONFLICT = 1 << 0
FLAG_PLATEID1_OVERRIDE = 1 << 1
FLAG_RESTORATION_BOUND = 1 << 2
FLAG_OFF_SCHEDULE = 1 << 3
FLAG_PROTECTED_WINDOW = 1 << 4
FLAG_RETAINED_UNSIMPLIFIED = 1 << 5

COMPILER_METHOD = "present-day-class-reattached-to-cao2024-partition-v1"
MAP_INTERVAL_LIMITATION = (
    "a Cao et al. (2017) map interval records the minimum land and maximum flooding mapped "
    "anywhere in that bin, not a shoreline at one moment")
SHALLOW_MARINE_LIMITATION = (
    "maximum transgression over the map interval; an environment class, not a water depth")
MOUNTAIN_LIMITATION = (
    "mapped relief class of the map interval; neither an elevation nor a modern topographic surface")
COOKIE_CUT_LIMITATION = (
    "the present-day polygon is cut by the present-day Cao et al. (2024) v2.4 static partitions and "
    "each piece rides one plate; it is not the authors' own reconstruction with the Matthews et al. "
    "(2016) rotations")
FRAME_CONFLICT_LIMITATION = (
    "frame conflict: at the interval mid-age this piece sits more than 250 km from where its own "
    "Cao 2017 PLATEID1 would place it; the two reconstructions disagree about this ground")
OVERRIDE_LIMITATION = (
    "posed by the source PLATEID1 rather than by the Cao 2024 partition that owns the ground, "
    "because the partition owner is in a different reconstruction frame here (overrides.json)")
RESTORATION_LIMITATION = (
    "inside 130-430 Ma this piece follows the EarthHistory rigid UK-block North Sea restoration "
    "(earthhistory-north-sea-restoration-v1), a regional model hypothesis, not a deforming reconstruction")
OFF_SCHEDULE_LIMITATION = (
    "the source record's FROMAGE/TOAGE pair is not one of the 24 published map intervals; it is "
    "drawn in every canonical interval it overlaps, with its own lifecycle")

# --------------------------------------------------------------------------
# the LGM lowstand interval (plan Phase 9)
#
# One interval younger than the whole Cao 2017 band, compiled from the tracked
# contract `data/corrections/palaeo-coastlines/lgm/` that
# `palaeo_coastlines_lgm_derive.py` writes from the pinned ETOPO 2022 crops. It
# is *detached*: the schedule from 402-380 to 11-2 Ma is contiguous, this one
# sits 2 Myr younger with nothing in between, and the runtime, the validator and
# the catalog all have to say so rather than treat the gap as a compiler fault.
# Only the landmass class carries geometry; the shallow-marine payload for this
# interval is deliberately empty, because a eustatic contour says where land
# was, not where a shallow sea was.
# --------------------------------------------------------------------------
LGM_CONTRACT_DIRECTORY = CONFIG / "lgm"
LGM_INTERVAL_ID = "lgm"
LGM_CLASS = "lm"
LGM_METHOD = "etopo-2022-eustatic-lowstand-contour-v1"
LGM_GPGIM_TYPE = "EarthHistoryLgmLowstand"
LGM_LIMITATIONS = (
    "a eustatic lowstand state, not a reconstruction: ETOPO 2022 present-day surface elevation "
    "at or above -120 m (Lambeck et al. 2014) inside three footprints and nowhere else",
    "no glacio-isostatic adjustment; relative sea level around an ice margin differed from the "
    "eustatic value by more than 100 m and varied over tens of kilometres",
    "ice sheets are not drawn: ground under the Fennoscandian, British-Irish and Laurentide ice "
    "sheets is shown as exposed land, which it was not",
    "ETOPO 2022 is modern bathymetry; sediment deposited, eroded and reworked since the Last "
    "Glacial Maximum is not removed, so the present-day sea bed is not the lowstand land surface",
    "regional: only the southern and central North Sea, the Sunda shelf and Beringia are drawn, "
    "and every other coastline at this age keeps the present-day composition",
)
LGM_INTERVAL_LIMITATION = (
    "the LGM lowstand interval is not a Cao et al. (2017) map interval; it is 2 Myr younger than "
    "the whole published band and is drawn over the present-day composition, not instead of it")


class CompileError(ValueError):
    """An input, contract or measured result the compiler must not ship."""


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def canonical(value: object) -> bytes:
    return (json.dumps(value, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def polygon_parts(geometry):
    return audit.polygon_parts(geometry)


def polygonal(geometry):
    return audit.polygonal(geometry)


def area_km2(geometry) -> float:
    return audit.area_km2(geometry)


# --------------------------------------------------------------------------
# columnar tables
# --------------------------------------------------------------------------

def pack_columns(rows: list[dict], fields: tuple[str, ...]) -> dict:
    """One table as parallel arrays plus its row count.

    The runtime catalog ships every table this way: repeating a key name once per
    row cost more than the values did (the v1 ``bindings`` table spent 1.7 MiB of
    ``lm`` on 7,079 rows of the same six keys). ``count`` is carried explicitly so
    a decoder can reject a table whose columns disagree instead of silently
    truncating to the shortest one.
    """
    for row in rows:
        missing = [field for field in fields if field not in row]
        if missing:
            raise CompileError(f"columnar table row is missing {missing}")
    return {"count": len(rows), **{field: [row[field] for row in rows] for field in fields}}


def intern_chart_provenance(rows: list[dict]) -> dict:
    """Source-record provenance as a columnar table with the feature ids interned.

    Thousands of cut pieces share one GPlates feature id, so the id is a
    dictionary reference (the ``<field>Ref`` convention of
    ``scripts/research/cao_package_intern.py``) rather than a repeated 45-byte
    string. This table never ships: it is the offline sidecar.
    """
    strings: list[str] = []
    index: dict[str, int] = {}
    prepared: list[dict] = []
    for row in rows:
        feature_id = row.get("featureId")
        if feature_id is None:
            reference = None
        else:
            if feature_id not in index:
                index[feature_id] = len(strings)
                strings.append(feature_id)
            reference = index[feature_id]
        prepared.append({**{field: row.get(field) for field in CHART_PROVENANCE_FIELDS},
                         "featureIdRef": reference})
    return {"encoding": PROVENANCE_ENCODING, "featureIds": strings,
            **pack_columns(prepared, CHART_PROVENANCE_FIELDS)}


def expand_chart_provenance(block: dict) -> list[dict]:
    """Chart provenance rows with the feature id resolved, the inverse of the above."""
    if block.get("encoding") != PROVENANCE_ENCODING:
        raise CompileError("unknown palaeo chart provenance encoding")
    strings = block["featureIds"]
    rows = unpack_columns({key: value for key, value in block.items()
                           if key not in ("encoding", "featureIds")})
    for row in rows:
        reference = row.pop("featureIdRef")
        if reference is not None and not 0 <= reference < len(strings):
            raise CompileError(f"palaeo chart provenance feature id reference {reference} is out of range")
        row["featureId"] = None if reference is None else strings[reference]
    return rows


def unpack_columns(block: dict) -> list[dict]:
    """Rows of a columnar table, the inverse of :func:`pack_columns`."""
    count = block["count"]
    fields = [name for name in block if name != "count"]
    for field in fields:
        if len(block[field]) != count:
            raise CompileError(f"columnar table column {field} has {len(block[field])} of {count} rows")
    return [{field: block[field][index] for field in fields} for index in range(count)]


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------

def load_json(path: Path) -> dict:
    if not path.is_file():
        raise CompileError(f"missing configuration file: {path}")
    return json.loads(path.read_text())


def verify_sources(manifest: dict) -> dict:
    """Confirm every pinned input still matches its recorded size and sha256."""
    pool = ROOT.parent / "EarthHistory-data/palaeomap-study"
    checked: list[dict] = []
    archive_path = None
    for source in manifest["sources"]:
        entries: list[tuple[Path, dict]] = []
        if "archive" in source:
            archive_path = pool / source["archive"]["path"]
            entries.append((archive_path, source["archive"]))
        if "path" in source and "sha256" in source:
            entries.append((ROOT / source["path"], source))
        for member in source.get("members", []):
            if "rootDirectory" in source or source["sourceId"] == "cao-v2.4-static-partitions":
                entries.append((pool / member["path"], member))
        for path, descriptor in entries:
            if not path.is_file():
                raise CompileError(f"pinned input missing: {path}")
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if len(payload) != descriptor["bytes"] or digest != descriptor["sha256"]:
                raise CompileError(
                    f"pinned input changed: {path.name} ({len(payload)} bytes, sha256 {digest})")
            checked.append({"path": str(path.relative_to(ROOT.parent)), "bytes": len(payload),
                            "sha256": digest})
    if archive_path is None:
        raise CompileError("the source manifest names no archive")
    archive_members = [member for source in manifest["sources"] if "archive" in source
                       for member in source["members"]]
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive_members:
            payload = archive.read(member["path"])
            digest = sha256_bytes(payload)
            if len(payload) != member["bytes"] or digest != member["sha256"]:
                raise CompileError(
                    f"pinned archive member changed: {member['path']} "
                    f"({len(payload)} bytes, sha256 {digest})")
            checked.append({"path": member["path"], "bytes": len(payload), "sha256": digest})
    return {"archive": str(archive_path.relative_to(ROOT.parent)), "verifiedInputs": len(checked),
            "inputs": sorted(checked, key=lambda row: row["path"])}


def validate_overrides(overrides: dict) -> dict:
    """Every override plate needs a justification and a citation (Phase 2 gate)."""
    for class_name, block in overrides["classes"].items():
        listed = block["overridePlateIds"]
        if listed != [row["plateId1"] for row in block["plates"]]:
            raise CompileError(f"{class_name}: override index disagrees with the plate table")
        for row in block["plates"]:
            if not row.get("justification"):
                raise CompileError(f"{class_name} override {row['plateId1']}: no justification")
            if not row.get("sourceIds"):
                raise CompileError(f"{class_name} override {row['plateId1']}: no sourceIds")
    return {class_name: list(block["overridePlateIds"])
            for class_name, block in overrides["classes"].items()}


def validate_basin(basin: dict, interval_ids: set[str]) -> None:
    """Validate one basin edit contract against the D3 schema.

    Two separate scopes are enforced, because a violation of either would put an
    edit somewhere its citations do not reach: the geometry must lie inside the
    declared window bbox, and every operation may only name an interval the
    contract's own ``intervals`` list declares. The declared list is what the
    research record and the map key describe, so an operation that reaches past
    it would edit an age nothing in the record accounts for.
    """
    window = basin["window"]["bbox"]
    if len(window) != 4 or window[0] >= window[2] or window[1] >= window[3]:
        raise CompileError(f"basin {basin['basinId']}: malformed window bbox")
    known = {reference["sourceId"] for reference in basin["references"]}
    if not known:
        raise CompileError(f"basin {basin['basinId']}: no references")
    for reference in basin["references"]:
        for field in ("citation", "url", "year", "constrains", "claimOrInference"):
            if not reference.get(field):
                raise CompileError(
                    f"basin {basin['basinId']} reference {reference.get('sourceId')}: missing {field}")
    declared = list(basin.get("intervals", []))
    unknown_declared = sorted(set(declared) - interval_ids)
    if unknown_declared:
        raise CompileError(
            f"basin {basin['basinId']}: declared intervals {unknown_declared} are not canonical")
    if basin["ops"] and not declared:
        raise CompileError(
            f"basin {basin['basinId']}: operations are present but no interval is declared")
    kinds = set(basin["opSchema"]["kinds"])
    window_box = shapely.box(*window)
    for op in basin["ops"]:
        for field in basin["opSchema"]["requiredFields"]:
            if field not in op:
                raise CompileError(f"basin {basin['basinId']} op {op.get('opId')}: missing {field}")
        if op["kind"] not in kinds:
            raise CompileError(f"basin {basin['basinId']} op {op['opId']}: unknown kind {op['kind']}")
        if not op["references"]:
            raise CompileError(f"basin {basin['basinId']} op {op['opId']}: no reference")
        for source_id in op["references"]:
            if source_id not in known:
                raise CompileError(
                    f"basin {basin['basinId']} op {op['opId']}: reference {source_id} is not in the contract")
        if not op["intervalIds"]:
            raise CompileError(f"basin {basin['basinId']} op {op['opId']}: no interval")
        unknown_intervals = sorted(set(op["intervalIds"]) - interval_ids)
        if unknown_intervals:
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: {unknown_intervals} are not canonical intervals")
        undeclared = sorted(set(op["intervalIds"]) - set(declared))
        if undeclared:
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: {undeclared} are not in the contract's "
                "declared intervals")
        editorial = op.get("editorial", "")
        if not editorial.startswith(EDITORIAL_PREFIX):
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: editorial must start with "
                f"{EDITORIAL_PREFIX!r}")
        uncertainty = op.get("spatialUncertaintyKilometres")
        if not isinstance(uncertainty, (int, float)) or uncertainty <= 0:
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: spatialUncertaintyKilometres must be "
                "a positive number")
        geometry = polygonal(shape(op["geometry"]))
        if geometry.is_empty:
            raise CompileError(f"basin {basin['basinId']} op {op['opId']}: empty geometry")
        minimum_lon, _, maximum_lon, _ = geometry.bounds
        if maximum_lon - minimum_lon >= 180.0:
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: geometry spans the antimeridian")
        if not window_box.contains(geometry):
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: geometry leaves the basin window")
        if op["kind"] == "replace-ring" and "targetRecordIndex" not in op:
            raise CompileError(
                f"basin {basin['basinId']} op {op['opId']}: replace-ring needs targetRecordIndex")


def load_basins(interval_ids: set[str]) -> list[dict]:
    basins = []
    directory = CONFIG / "basins"
    for path in sorted(directory.glob("*.json")):
        basin = load_json(path)
        validate_basin(basin, interval_ids)
        basin["_path"] = str(path.relative_to(ROOT))
        basin["_sha256"] = sha256_path(path)
        basins.append(basin)
    return basins


# --------------------------------------------------------------------------
# source records
# --------------------------------------------------------------------------

def interval_is_detached(interval: dict) -> bool:
    """Whether an interval sits outside the contiguous Cao 2017 schedule."""
    return bool(interval.get("detached"))


def lgm_evidence_record(source_ids: list[str], editorial: str) -> dict:
    """The LGM lowstand evidence row: none of the Cao 2017 authority applies to it."""
    return {
        "status": "derived-from-published-source",
        "surfaceClass": CLASS_NAMES[LGM_CLASS],
        "appearance": SURFACE_APPEARANCE[LGM_CLASS],
        "method": LGM_METHOD,
        "sourceIds": list(source_ids),
        "limitations": [LGM_INTERVAL_LIMITATION, *LGM_LIMITATIONS],
        "editorial": editorial,
    }


def load_lgm_contract(directory: Path = LGM_CONTRACT_DIRECTORY) -> dict | None:
    """The tracked LGM lowstand contract, or None where it has not been derived.

    The manifest pins its own GeoJSON by digest and pins the sha256 of every
    ETOPO crop the polygons came from; both are re-checked here, so a hand-edited
    payload or a re-downloaded raster fails the compile instead of shipping.
    """
    manifest_path = directory / "lgm-lowstand-v1.manifest.json"
    if not manifest_path.exists():
        return None
    manifest = load_json(manifest_path)
    payload_path = directory / manifest["payload"]["path"]
    payload = payload_path.read_bytes()
    if sha256_bytes(payload) != manifest["payload"]["sha256"]:
        raise CompileError(f"{payload_path} does not match the sha256 its manifest pins")
    if len(payload) != manifest["payload"]["bytes"]:
        raise CompileError(f"{payload_path} is {len(payload)} bytes, manifest says "
                           f"{manifest['payload']['bytes']}")
    if manifest["intervalId"] != LGM_INTERVAL_ID:
        raise CompileError("the LGM contract declares a different interval id")
    if not (manifest["oldestMa"] > manifest["youngestExclusiveMa"] > 0):
        raise CompileError("the LGM contract lifecycle is empty or reversed")
    if manifest["evidence"]["status"] != "derived-from-published-source":
        raise CompileError("the LGM contract must ship as a derived overlay")
    declared = {reference["sourceId"] for reference in manifest["references"]}
    missing = [source_id for source_id in manifest["evidence"]["sourceIds"]
               if source_id not in declared]
    if missing:
        raise CompileError(f"the LGM contract cites {missing} with no reference record")
    editorial = manifest["evidence"]["editorial"]
    if not editorial.startswith(EDITORIAL_PREFIX):
        raise CompileError("the LGM contract editorial line does not carry the shipped prefix")
    named = [part.strip() for part in editorial[len(EDITORIAL_PREFIX):].split(",")]
    if [source_id for source_id in named if source_id not in declared]:
        raise CompileError("the LGM contract editorial line names an undeclared reference")
    for reference in manifest["references"]:
        if not reference.get("citation") or not reference.get("constrains") \
                or not reference.get("claimOrInference"):
            raise CompileError(f"LGM reference {reference['sourceId']} is missing its citation, "
                               "what it constrains, or its claim/inference tag")
    collection = json.loads(payload)
    footprints = {name: entry for name, entry in
                  ((feature["properties"]["footprintId"], feature) for feature
                   in collection["features"])}
    if set(footprints) != set(manifest["regional"]["footprints"]):
        raise CompileError("the LGM payload and manifest disagree about the footprints")
    return {"manifest": manifest, "collection": collection, "directory": directory,
            "payloadSha256": manifest["payload"]["sha256"]}


def lgm_interval(contract: dict) -> dict:
    manifest = contract["manifest"]
    oldest = float(manifest["oldestMa"])
    youngest = float(manifest["youngestExclusiveMa"])
    return {"intervalId": LGM_INTERVAL_ID, "fromAgeMa": oldest, "toAgeMa": youngest,
            "midAgeMa": round((oldest + youngest) / 2.0, 6), "detached": True,
            "title": manifest["title"]}


def lgm_rows(contract: dict, first_index: int) -> list[dict]:
    """One source row per polygon part of the contract, in footprint order.

    A row looks like a Cao source record with no ``PLATEID1``: the pieces are
    bound by the Cao 2024 partition that owns the ground, exactly like every
    other piece, and a partition owner is the only frame a present-day contour
    has. ``preSimplified`` tells the node reduction to leave the rings alone —
    the contract is already reduced at 0.02 degrees against the source grid, and
    reducing it twice would move a coastline the derivation measured.
    """
    manifest = contract["manifest"]
    oldest = float(manifest["oldestMa"])
    youngest = float(manifest["youngestExclusiveMa"])
    source_ids = list(manifest["evidence"]["sourceIds"])
    editorial = manifest["evidence"]["editorial"]
    rows: list[dict] = []
    index = first_index
    for feature in contract["collection"]["features"]:
        footprint = feature["properties"]["footprintId"]
        geometry = shape(feature["geometry"])
        for part in polygon_parts(geometry):
            rings = [list(part.exterior.coords)]
            rings.extend(list(interior.coords) for interior in part.interiors)
            rows.append({
                "index": index, "class": LGM_CLASS, "fromAge": oldest, "toAge": youngest,
                "timeMa": None, "plateId1": None, "gpgimType": LGM_GPGIM_TYPE,
                "featureId": f"{LGM_INTERVAL_ID}:{footprint}:{index - first_index}",
                "rings": rings, "lgm": True, "preSimplified": True,
                "contractId": manifest["contractId"],
                "lgmFootprintId": footprint, "lgmSourceIds": source_ids,
                "lgmEditorial": editorial,
            })
            index += 1
    if not rows:
        raise CompileError("the LGM contract carries no polygon")
    return rows


def record_polygon(row: dict, densify: bool):
    """Planar image of one source record; the audit's antimeridian assertion applies."""
    rings = row["rings"]
    for ring in rings:
        for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:]):
            if abs(lon_b - lon_a) > 180.0 and not (audit._is_pole(lat_a) and audit._is_pole(lat_b)):
                raise CompileError(
                    f"{row['class']} record {row['index']} crosses the antimeridian away from a pole")
    exterior = list(rings[0])
    holes = [list(ring) for ring in rings[1:]]
    if densify:
        return polygonal(Polygon(audit.densify(exterior), [audit.densify(hole) for hole in holes]))
    return polygonal(Polygon(exterior, holes))


def densify_geometry(geometry):
    parts = []
    for part in polygon_parts(geometry):
        exterior = audit.densify(list(part.exterior.coords))
        holes = [audit.densify(list(interior.coords)) for interior in part.interiors]
        parts.append(Polygon(exterior, holes))
    if not parts:
        return Polygon()
    return polygonal(parts[0] if len(parts) == 1 else MultiPolygon(parts))


def quarantine(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split off the lifecycles a half-open (TOAGE, FROMAGE] rule cannot express."""
    kept, rejected = [], []
    for row in rows:
        from_age, to_age = row["fromAge"], row["toAge"]
        if from_age is None or to_age is None:
            rejected.append({"recordIndex": row["index"], "reason": "undated record",
                             "fromAgeMa": from_age, "toAgeMa": to_age})
        elif to_age > from_age:
            rejected.append({"recordIndex": row["index"], "reason": "reversed lifecycle",
                             "fromAgeMa": from_age, "toAgeMa": to_age})
        elif to_age == from_age:
            rejected.append({"recordIndex": row["index"], "reason": "zero-length lifecycle",
                             "fromAgeMa": from_age, "toAgeMa": to_age})
        else:
            kept.append(row)
    return kept, rejected


def apply_basin_ops(class_name: str, rows: list[dict], geometries: dict[int, object],
                    basins: list[dict], intervals: list[dict]) -> tuple[list[dict], dict[int, object], list[dict]]:
    """Apply the basin edit contracts to the source geometry.

    ``remove-*`` subtracts the operation geometry from every record of the class
    it names, ``add-*`` introduces one synthetic record with the operation's own
    lifecycle, and ``replace-ring`` swaps the geometry of one named record inside
    the basin window. Every operation records the area it changed.

    Two scope rules are enforced here rather than trusted:

    * the operation's declared intervals have to be contiguous in the canonical
      schedule, because an ``add-*`` record carries one ``(TOAGE, FROMAGE]``
      lifecycle and a gap in the list would silently edit the interval between;
    * a record an operation edits has to stay inside that lifecycle. Geometry is
      held per source record, not per interval, so editing a record that is also
      active outside the declared intervals would move the coastline at an age
      the contract never cites. The compiler refuses instead of leaking.

    Every record an operation actually changes carries that operation's
    ``references``, so its evidence record is interned with the edit's citations
    in ``sourceIds`` and the map key shows them whenever the piece is on screen.
    """
    by_id = {interval["intervalId"]: interval for interval in intervals}
    order = {interval["intervalId"]: index for index, interval in enumerate(intervals)}
    report: list[dict] = []
    next_index = (max((row["index"] for row in rows), default=-1) + 1)
    for basin in basins:
        if class_name not in basin.get("classes", []):
            continue
        window = shapely.box(*basin["window"]["bbox"])
        for op in basin["ops"]:
            kind = op["kind"]
            target_class = "lm" if kind.endswith("land") else "sm" if kind.endswith("shallow") else class_name
            if kind != "replace-ring" and target_class != class_name:
                continue
            geometry = densify_geometry(polygonal(shape(op["geometry"])))
            positions = sorted(order[interval_id] for interval_id in op["intervalIds"])
            if positions != list(range(positions[0], positions[0] + len(positions))):
                raise CompileError(
                    f"basin {basin['basinId']} op {op['opId']}: {op['intervalIds']} are not "
                    "contiguous in the canonical schedule")
            touched = [by_id[interval_id] for interval_id in op["intervalIds"]]
            oldest = max(interval["fromAgeMa"] for interval in touched)
            youngest = min(interval["toAgeMa"] for interval in touched)
            def window_areas() -> tuple[float, float]:
                """Class area inside the basin window over the operation's own intervals.

                Restricted to the records active in ``(youngest, oldest]``, because
                every other record is untouched and its area would only dilute the
                measurement. Two figures: the summed one counts each record
                separately, so records of one class that overlap are counted twice;
                the dissolved one is the ground the class actually covers inside the
                window, which is what "area changed" means to a reader of the
                research record.
                """
                parts = [geometries[row["index"]] for row in rows
                         if row["toAge"] < oldest and youngest < row["fromAge"]
                         and geometries[row["index"]].intersects(window)]
                summed = sum(area_km2(part.intersection(window)) for part in parts)
                dissolved = shapely.union_all(parts).intersection(window) if parts else None
                return summed, (area_km2(dissolved) if dissolved is not None else 0.0)

            before, dissolved_before = window_areas()
            edited_records = 0
            if kind.startswith("remove"):
                for row in rows:
                    if not (row["toAge"] < oldest and youngest < row["fromAge"]):
                        continue
                    current = geometries[row["index"]]
                    if not current.intersects(geometry):
                        continue
                    if not (oldest >= row["fromAge"] and youngest <= row["toAge"]):
                        raise CompileError(
                            f"basin {basin['basinId']} op {op['opId']}: record {row['index']} is "
                            f"active over ({row['toAge']}, {row['fromAge']}], which reaches outside "
                            f"the operation's ({youngest}, {oldest}] intervals")
                    geometries[row["index"]] = polygonal(current.difference(geometry))
                    row["references"] = sorted(set(row.get("references", [])) | set(op["references"]))
                    row["basinId"] = basin["basinId"]
                    row["basinOpId"] = "+".join(
                        sorted(set((row.get("basinOpId") or "").split("+")) - {""} | {op["opId"]}))
                    edited_records += 1
            elif kind.startswith("add"):
                rows.append({"index": next_index, "class": class_name, "fromAge": oldest,
                             "toAge": youngest, "timeMa": None, "plateId1": op.get("plateId1"),
                             "gpgimType": "EarthHistoryBasinEdit", "featureId": op["opId"],
                             "rings": [], "basinOpId": op["opId"], "basinId": basin["basinId"],
                             "references": op["references"]})
                geometries[next_index] = geometry
                next_index += 1
                edited_records = 1
            else:  # replace-ring
                target = op["targetRecordIndex"]
                if target not in geometries:
                    raise CompileError(f"op {op['opId']}: record {target} is not in class {class_name}")
                target_row = next(row for row in rows if row["index"] == target)
                if not (oldest >= target_row["fromAge"] and youngest <= target_row["toAge"]):
                    raise CompileError(
                        f"basin {basin['basinId']} op {op['opId']}: record {target} is active over "
                        f"({target_row['toAge']}, {target_row['fromAge']}], which reaches outside "
                        f"the operation's ({youngest}, {oldest}] intervals")
                current = geometries[target]
                geometries[target] = polygonal(
                    polygonal(current.difference(window)).union(geometry))
                target_row["references"] = sorted(
                    set(target_row.get("references", [])) | set(op["references"]))
                target_row["basinId"] = basin["basinId"]
                target_row["basinOpId"] = "+".join(
                    sorted(set((target_row.get("basinOpId") or "").split("+")) - {""} | {op["opId"]}))
                edited_records = 1
            after, dissolved_after = window_areas()
            report.append({"basinId": basin["basinId"], "opId": op["opId"], "kind": kind,
                           "class": class_name, "intervalIds": op["intervalIds"],
                           "references": op["references"],
                           "spatialUncertaintyKilometres": op["spatialUncertaintyKilometres"],
                           "editedRecords": edited_records,
                           "areaBeforeSquareKilometres": round(before, 3),
                           "areaAfterSquareKilometres": round(after, 3),
                           "areaChangeSquareKilometres": round(after - before, 3),
                           "dissolvedAreaBeforeSquareKilometres": round(dissolved_before, 3),
                           "dissolvedAreaAfterSquareKilometres": round(dissolved_after, 3),
                           "dissolvedAreaChangeSquareKilometres": round(
                               dissolved_after - dissolved_before, 3)})
    return rows, geometries, report


# --------------------------------------------------------------------------
# cookie cut with exactly one owner per piece
# --------------------------------------------------------------------------

def owner_priority(partition: dict) -> tuple:
    """Deterministic claim order where two present-day static polygons overlap.

    441 partition pairs overlap (1.51 Mkm2, 0.295 % of the partition area). The
    smaller polygon claims the shared ground first: where a terrane polygon sits
    inside a block polygon the finer plate identity is the more specific one, and
    a duplicated polygon of identical area is decided by the lower plate id so the
    result is reproducible.
    """
    return (partition["areaSquareKilometres"], partition["plateId"],
            partition["sourceOrder"], partition["geometryIndex"])


def cut_record(geometry, partitions: list[dict], tree: STRtree) -> tuple[list[tuple[int, object, float]], float, int]:
    """Cut one source ring into disjoint pieces, each owned by exactly one partition."""
    candidates = sorted((int(index) for index in tree.query(geometry)),
                        key=lambda index: owner_priority(partitions[index]))
    pieces: list[tuple[int, object, float]] = []
    dropped_area = 0.0
    dropped_pieces = 0
    remaining = geometry
    for index in candidates:
        if remaining.is_empty:
            break
        partition = partitions[index]
        piece = polygonal(remaining.intersection(partition["geometry"]))
        if piece.is_empty:
            continue
        remaining = polygonal(remaining.difference(partition["geometry"]))
        value = area_km2(piece)
        if value < MIN_PIECE_KM2:
            dropped_area += value
            dropped_pieces += 1
            continue
        pieces.append((index, piece, value))
    if not remaining.is_empty:
        value = area_km2(remaining)
        if value > 0:
            dropped_area += value
            dropped_pieces += 1
    return pieces, dropped_area, dropped_pieces


# --------------------------------------------------------------------------
# palette binding
# --------------------------------------------------------------------------

def load_palette() -> tuple[dict, dict[int, list[dict]]]:
    catalog = json.loads((PUBLIC / "motion-palette.json").read_text())
    by_plate: dict[int, list[dict]] = defaultdict(list)
    for entry in catalog["entries"]:
        by_plate[entry["plateId"]].append(entry)
    for entries in by_plate.values():
        entries.sort(key=lambda entry: (entry["youngestAgeMa"], entry["oldestAgeMa"], entry["entryId"]))
    return catalog, by_plate


def plate_source_seams(by_plate: dict[int, list[dict]], plate: int) -> list[dict]:
    """The declared source-rotation discontinuities between a plate's recovery entries.

    A seam is a property of the plate, not of any one piece's window, so the
    collapsed binding row ships the plate's whole set and the validator intersects
    it with each lifecycle. Both ends are exclusive: the entries on either side
    stop and start at those ages, and nothing covers the open interval between
    them.
    """
    recovery = sorted((entry for entry in by_plate.get(plate, [])
                       if entry["entryId"].startswith(RECOVERY_PREFIX)),
                      key=lambda entry: (entry["youngestAgeMa"], entry["oldestAgeMa"], entry["entryId"]))
    return [{"youngestMa": float(left["oldestAgeMa"]), "oldestMa": float(right["youngestAgeMa"]),
             "reason": "source-seam"}
            for left, right in zip(recovery, recovery[1:])
            if float(right["youngestAgeMa"]) > float(left["oldestAgeMa"])]


def binding_kind(by_plate: dict[int, list[dict]], plate: int, override: bool) -> str:
    """Which preference branch :func:`select_palette_entry` takes for a binding plate.

    ``restoration`` and ``recovery`` name plates whose palette carries entries that
    displace the native motion; ``override`` and ``partition`` name where the
    binding plate itself came from. The four are exclusive in the shipped palette
    and the compiler refuses to ship a plate that is both, because one enum field
    could not then say which branch the runtime must take.
    """
    entry_ids = [entry["entryId"] for entry in by_plate.get(plate, [])]
    restoration = any(entry_id.startswith(RESTORATION_PREFIX) for entry_id in entry_ids)
    recovery = any(entry_id.startswith(RECOVERY_PREFIX) for entry_id in entry_ids)
    if restoration and recovery:
        raise CompileError(f"plate {plate} carries both restoration and recovery palette entries")
    if (restoration or recovery) and override:
        raise CompileError(
            f"plate {plate} is a PLATEID1 override target and a "
            f"{'restoration' if restoration else 'recovery'} plate; the binding kind is ambiguous")
    if restoration:
        return "restoration"
    if recovery:
        return "recovery"
    return "override" if override else "partition"


def select_palette_entry(by_plate: dict[int, list[dict]], plate: int, age: float) -> dict | None:
    """The one palette entry a piece on ``plate`` takes at ``age``, or ``None``.

    This is the pointwise form of :func:`binding_entries` and the rule the runtime
    implements from the shipped binding row; ``docs/data/palaeo-coastlines-format.md``
    states it normatively and the validator asserts the two agree over every
    lifecycle a shipped piece carries.

    Coverage is closed, ``youngestAgeMa <= age <= oldestAgeMa``, and where two
    entries of the same preference class meet, the one with the larger
    ``youngestAgeMa`` wins: that is the entry the chain walks into going older, and
    it is what keeps the oldest age of a lifecycle - which is inclusive - posed
    when nothing starts above it.
    """
    entries = by_plate.get(plate, [])
    if not entries:
        return None
    covering = [entry for entry in entries
                if float(entry["youngestAgeMa"]) <= age <= float(entry["oldestAgeMa"])]

    def newest(candidates: list[dict]) -> dict:
        return max(candidates, key=lambda entry: (float(entry["youngestAgeMa"]), entry["entryId"]))

    restoration = [entry for entry in covering if entry["entryId"].startswith(RESTORATION_PREFIX)]
    if restoration:
        return newest(restoration)
    if any(entry["entryId"].startswith(RECOVERY_PREFIX) for entry in entries):
        # A recovery plate never falls back to the native motion
        # `apply_cao_native_triangulation_repair` rejected: outside its recovery
        # entries the piece is unposable, and the gap is a declared source seam.
        recovery = [entry for entry in covering if entry["entryId"].startswith(RECOVERY_PREFIX)]
        return newest(recovery) if recovery else None
    corrections = [entry for entry in covering if entry["entryId"].startswith("correction-plate-")]
    natives = [entry for entry in covering if not entry["entryId"].startswith("correction-plate-")]
    matches = corrections if (age >= 410 and corrections) else natives if natives else covering
    return newest(matches) if matches else None


def resolve_binding_coverage(by_plate: dict[int, list[dict]], plate: int, youngest: float,
                             oldest: float) -> tuple[list[tuple[str, float, float]],
                                                     list[tuple[float, float]]]:
    """Walk :func:`select_palette_entry` across ``[youngest, oldest]``.

    Returns the entry runs and the holes: ages inside the window at which the
    plate has no entry the rule will take. A hole is legitimate only where the
    binding row declares that source seam; anything else is a piece the runtime
    would silently stop drawing while its lifecycle says it is still there.
    """
    edges = {float(youngest), float(oldest)}
    for entry in by_plate.get(plate, []):
        for value in (float(entry["youngestAgeMa"]), float(entry["oldestAgeMa"])):
            if youngest < value < oldest:
                edges.add(value)
    ordered = sorted(edges)
    segments: list[tuple[str, float, float]] = []
    holes: list[tuple[float, float]] = []
    for low, high in zip(ordered, ordered[1:]):
        entry = select_palette_entry(by_plate, plate, 0.5 * (low + high))
        if entry is None:
            if holes and holes[-1][1] == low:
                holes[-1] = (holes[-1][0], high)
            else:
                holes.append((low, high))
        elif segments and segments[-1][0] == entry["entryId"] and segments[-1][2] == low:
            segments[-1] = (entry["entryId"], segments[-1][1], high)
        else:
            segments.append((entry["entryId"], low, high))
    # The oldest bound of a lifecycle is inclusive, so the piece is still drawn at
    # exactly that age and an entry has to cover it.
    if select_palette_entry(by_plate, plate, float(oldest)) is None:
        holes.append((float(oldest), float(oldest)))
    return segments, holes


def binding_entries(by_plate: dict[int, list[dict]], plate: int, youngest: float,
                    oldest: float) -> tuple[list[tuple[str, float, float]], list[dict]] | None:
    """Palette partition of [youngest, oldest] for one plate, or None.

    Returns the ordered segments and the source-seam gaps the segments step over.
    Entry preference at each age is taken from the emitters that already bind
    native charts:

    * ``restoration-`` wins inside its own window, which is how the native North
      Sea charts are bound (``apply_north_sea_restoration.expected_bindings``):
      below 130 Ma the native entries carry the chart and from 130 Ma the
      restoration entry does;
    * on the eight plates that carry ``native-recovery-plate-`` entries, those
      entries are the *only* motion allowed, because
      ``apply_cao_native_triangulation_repair`` rejects any chart on those plates
      that keeps a ``plate-`` binding ("same-plate charts retain inaccurate native
      motion"). Its own ``native_bindings`` builds a chart's bindings from the
      recovery entries alone and its ``validate_binding_coverage`` tolerates only
      the plate's declared ``SOURCE_DISCONTINUITY_GAPS`` between them, so a palaeo
      piece steps over the same seams and records them instead of filling them
      with the native motion that was rejected;
    * otherwise the material-correction emitter's preference between ``plate-``
      and ``correction-plate-`` at 410 Ma applies. The palaeo schedule stops at
      402 Ma, so that last branch is not reached by this compiler.
    """
    entries = by_plate.get(plate, [])
    if not entries:
        return None
    restoration = [entry for entry in entries if entry["entryId"].startswith(RESTORATION_PREFIX)]
    recovery = [entry for entry in entries if entry["entryId"].startswith(RECOVERY_PREFIX)]
    native = [entry for entry in entries
              if not entry["entryId"].startswith((RESTORATION_PREFIX, RECOVERY_PREFIX))]
    # The seams between consecutive recovery entries are the source rotation's own
    # discontinuities; the repair emitter lists the same pairs in
    # SOURCE_DISCONTINUITY_GAPS and records them as chart motionSupportGaps.
    seams = [(float(left["oldestAgeMa"]), float(right["youngestAgeMa"]))
             for left, right in zip(recovery, recovery[1:])
             if float(right["youngestAgeMa"]) > float(left["oldestAgeMa"])]
    segments: list[tuple[str, float, float]] = []
    crossed: list[dict] = []
    cursor = float(youngest)
    guard = 0
    while cursor < oldest:
        guard += 1
        if guard > 64:
            return None
        chosen = next((entry for entry in restoration
                       if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]), None)
        if chosen is None:
            chosen = next((entry for entry in recovery
                           if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]), None)
        if chosen is None and recovery:
            # A recovery plate never falls back to its rejected native motion: the
            # cursor either stands on a declared source seam and steps over it, or
            # the piece is unposable.
            seam = next((pair for pair in seams if pair[0] == cursor), None)
            if seam is None or seam[1] >= oldest:
                return None
            crossed.append({"validTimeMa": {"youngest": seam[0], "oldest": seam[1]},
                            "youngestExclusive": True, "oldestExclusive": True,
                            "reason": "source-seam"})
            cursor = seam[1]
            continue
        if chosen is None:
            matches = [entry for entry in native
                       if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]]
            corrections = [entry for entry in matches
                           if entry["entryId"].startswith("correction-plate-")]
            natives = [entry for entry in matches
                       if not entry["entryId"].startswith("correction-plate-")]
            if cursor >= 410 and corrections:
                matches = corrections
            elif cursor < 410 and natives:
                matches = natives
            if len(matches) != 1:
                return None
            chosen = matches[0]
        following = min(float(chosen["oldestAgeMa"]), float(oldest))
        # A preferred entry that starts inside the chosen one's span must cut it
        # short, or a lower-preference entry would carry the piece past the age
        # where the preferred one takes over.
        starts = [entry["youngestAgeMa"] for entry in restoration + recovery
                  if cursor < entry["youngestAgeMa"] < following]
        if starts:
            following = min(starts)
        if following <= cursor:
            return None
        segments.append((chosen["entryId"], cursor, following))
        cursor = following
    return segments, crossed


# --------------------------------------------------------------------------
# node reduction
# --------------------------------------------------------------------------

def class_simplification(config: dict, class_name: str) -> dict:
    """The simplification config as one class sees it.

    ``classAreaClasses`` lets a class carry its own tolerance ladder. Everything
    else - the vertex cap, the per-piece area guard, the protected windows and the
    narrow-feature witnesses - is shared, so only the ladder is substituted.
    """
    ladder = config.get("classAreaClasses", {}).get(class_name)
    if ladder is None:
        return config
    return {**config, "areaClasses": ladder}


def tolerance_for(area: float, config: dict) -> float:
    tolerance = config["areaClasses"][0]["toleranceDegrees"]
    for row in config["areaClasses"]:
        if area >= row["minimumAreaSquareKilometres"]:
            tolerance = row["toleranceDegrees"]
    return tolerance


def simplify_component(part, config: dict) -> tuple[list, dict]:
    """Reduce one connected component, or keep it exactly.

    Three rules act in order. The area class sets the starting tolerance; a
    component still above the vertex cap is retried at a larger tolerance; and a
    component whose own area moves by more than ``perPieceAreaErrorPercent`` is
    retried at half the tolerance down to ``minimumToleranceDegrees``. A component
    that is still outside the guard at the minimum tolerance, or that Douglas-
    Peucker empties, is emitted unsimplified rather than distorted or lost.

    Working per component is what stops shapely dropping a small island from a
    multi-part piece: measured before this rule, a 202 km2 component vanished from
    an 842,373 km2 piece 1.8 degrees away, inside the piece's own 0.1 % area guard.
    """
    part_area = area_km2(part)
    tolerance = tolerance_for(part_area, config)
    escalation = config["vertexCapEscalation"]
    cap = config["vertexCapPerPiece"]
    guard = config["perPieceAreaErrorPercent"]
    floor = config["minimumToleranceDegrees"]
    escalations = 0
    reductions = 0
    simplified = polygonal(part.simplify(tolerance, preserve_topology=True))
    while (not simplified.is_empty
           and int(shapely.get_coordinates(simplified).shape[0]) > cap
           and tolerance * escalation["factor"] <= escalation["maximumToleranceDegrees"]):
        tolerance *= escalation["factor"]
        escalations += 1
        simplified = polygonal(part.simplify(tolerance, preserve_topology=True))
    value = area_km2(simplified) if not simplified.is_empty else 0.0
    while (not simplified.is_empty and part_area > 0 and tolerance > floor
           and abs(value - part_area) / part_area * 100.0 > guard):
        tolerance = max(floor, tolerance / 2.0)
        reductions += 1
        simplified = polygonal(part.simplify(tolerance, preserve_topology=True))
        value = area_km2(simplified) if not simplified.is_empty else 0.0
    reason = None
    if simplified.is_empty or part_area <= 0:
        reason = "emptied"
    elif abs(value - part_area) / part_area * 100.0 > guard:
        reason = "area-guard-at-minimum-tolerance"
    elif len(polygon_parts(simplified)) != 1:
        reason = "component-split"
    elif len(polygon_parts(simplified)[0].interiors) != len(part.interiors):
        reason = "hole-dropped"
    if reason is not None:
        simplified = part
        value = part_area
        tolerance = 0.0
    return polygon_parts(simplified), {"toleranceDegrees": tolerance, "retained": reason is not None,
                                       "retainReason": reason, "escalations": escalations,
                                       "reductions": reductions, "areaSquareKilometres": value}


def simplify_piece(piece, area: float, config: dict, protected: bool) -> tuple[object, dict]:
    """Reduce every component of one cut piece under the tracked simplification config."""
    source_vertices = int(shapely.get_coordinates(piece).shape[0])
    if protected:
        return piece, {"toleranceDegrees": 0.0, "protected": True, "retained": False,
                       "components": len(polygon_parts(piece)), "retainedComponents": 0,
                       "escalations": 0, "reductions": 0, "sourceVertices": source_vertices,
                       "vertices": source_vertices, "areaSquareKilometres": area}
    parts: list = []
    value = 0.0
    tolerance = 0.0
    escalations = 0
    reductions = 0
    retained_components = 0
    reasons: dict[str, int] = {}
    components = polygon_parts(piece)
    for part in components:
        reduced, meta = simplify_component(part, config)
        parts.extend(reduced)
        value += meta["areaSquareKilometres"]
        tolerance = max(tolerance, meta["toleranceDegrees"])
        escalations += meta["escalations"]
        reductions += meta["reductions"]
        if meta["retained"]:
            retained_components += 1
            reasons[meta["retainReason"]] = reasons.get(meta["retainReason"], 0) + 1
    if not parts:
        simplified = piece
        value = area
        retained_components = len(components)
        reasons["assembly-empty"] = reasons.get("assembly-empty", 0) + 1
    else:
        simplified = parts[0] if len(parts) == 1 else MultiPolygon(parts)
        # Components are simplified independently, so two of them can end up
        # touching or overlapping by a fraction of the tolerance. Repairing that
        # with make_valid restructures the piece: measured once, a 717,486 km2
        # Antarctic component came back as a main part, a sub-grid sliver and a
        # new hole. A piece that does not reassemble into exactly its own
        # components keeps its unsimplified rings instead.
        rebuilt = polygon_parts(simplified) if simplified.is_valid else []
        if (len(rebuilt) != len(components)
                or sum(len(part.interiors) for part in rebuilt)
                != sum(len(part.interiors) for part in components)):
            simplified = piece
            value = area
            retained_components = len(components)
            reasons["assembly-restructured"] = reasons.get("assembly-restructured", 0) + 1
        else:
            simplified = polygonal(simplified)
    return simplified, {"toleranceDegrees": tolerance, "protected": False,
                        "retained": retained_components > 0,
                        "components": len(components), "retainedComponents": retained_components,
                        "retainReasons": reasons,
                        "escalations": escalations, "reductions": reductions,
                        "sourceVertices": source_vertices,
                        "vertices": int(shapely.get_coordinates(simplified).shape[0]),
                        "areaSquareKilometres": value}


# --------------------------------------------------------------------------
# triangle reservation estimate
# --------------------------------------------------------------------------

def _edge_degrees(a, b) -> float:
    dot = max(-1.0, min(1.0, float(np.dot(a, b))))
    return math.degrees(math.acos(dot))


def refined_triangle_count(first: float, second: float, third: float,
                           limit: float = MAX_REFINEMENT_EDGE_DEGREES) -> int:
    """Triangles the emitter's longest-edge bisection produces for one triangle.

    ``project_cao_triangle_refinement.projected_counts`` splits the longest edge
    at its midpoint until every edge is inside the threshold. The recursion below
    reproduces that structure from the three edge lengths alone, using the planar
    median length for the new edge; at these sizes the planar and spherical median
    agree to far better than the 1 degree threshold, and ``--verify-refinement``
    measures the agreement against the emitter itself.
    """
    stack = [(first, second, third)]
    total = 0
    while stack:
        if total > REFINEMENT_TRIANGLE_CAP:
            return REFINEMENT_TRIANGLE_CAP
        longest, middle, short = sorted(stack.pop(), reverse=True)
        if longest <= limit:
            total += 1
            continue
        median = 0.5 * math.sqrt(max(0.0, 2.0 * middle * middle + 2.0 * short * short
                                     - longest * longest))
        if median <= 0.0:
            total += 1
            continue
        half = longest / 2.0
        stack.append((half, middle, median))
        stack.append((half, short, median))
    return total


def piece_triangle_estimate(piece) -> tuple[int, int]:
    """Base and 1-degree-refined triangle counts for one piece.

    The base triangulation is a Delaunay triangulation of the ring vertices with
    the triangles outside the piece removed. It is an estimate of the runtime's
    ear-clipping output, not a reproduction of it: the count is what the renderer
    reservation needs, and a Delaunay triangulation of the same vertices has the
    same triangle count as any other triangulation of a simple polygon.
    """
    base = 0
    refined = 0
    for part in polygon_parts(piece):
        try:
            triangles = shapely.get_parts(shapely.delaunay_triangles(part))
        except Exception:
            triangles = []
        inside = [triangle for triangle in triangles
                  if part.contains(triangle.representative_point())]
        if not inside:
            count = max(0, int(shapely.get_coordinates(part).shape[0]) - 2)
            base += count
            refined += count
            continue
        for triangle in inside:
            coordinates = list(triangle.exterior.coords)[:3]
            directions = [audit._unit(lon, lat) for lon, lat in coordinates]
            edges = (_edge_degrees(directions[0], directions[1]),
                     _edge_degrees(directions[1], directions[2]),
                     _edge_degrees(directions[2], directions[0]))
            base += 1
            refined += refined_triangle_count(*edges)
    return base, refined


# --------------------------------------------------------------------------
# EHPR v1 writer
# --------------------------------------------------------------------------

def quantise_ring(coordinates) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for lon, lat in coordinates:
        x = max(-32767, min(32767, int(round(lon * LON_SCALE))))
        y = max(-32767, min(32767, int(round(lat * LAT_SCALE))))
        if not out or out[-1] != (x, y):
            out.append((x, y))
    while len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


class LifecycleTable:
    """The per-class catalog array of distinct ``(TOAGE, FROMAGE]`` pairs.

    A piece stores a u16 index into this array instead of two f32 ages: the Cao
    2017 schedule has 24 canonical pairs and 44 off-schedule ones, so tens of
    thousands of pieces share a few dozen lifecycles.
    """

    def __init__(self, rows: list[dict] | None = None):
        self.rows: list[dict] = []
        self._index: dict[tuple[float, float], int] = {}
        for row in rows or []:
            self.index(row["youngestExclusiveMa"], row["oldestMa"])

    @classmethod
    def from_catalog(cls, catalog: dict) -> "LifecycleTable":
        return cls(catalog_lifecycles(catalog))

    def index(self, youngest: float, oldest: float) -> int:
        key = (round(float(youngest), 6), round(float(oldest), 6))
        found = self._index.get(key)
        if found is None:
            found = len(self.rows)
            if found >= CATALOG_INDEX_CEILING:
                raise CompileError("lifecycle catalog exceeds the u16 piece field")
            self._index[key] = found
            self.rows.append({"youngestExclusiveMa": key[0], "oldestMa": key[1]})
        return found


def encode_ehpr(class_name: str, interval: dict, interval_index: int,
                pieces: list[dict], lifecycles: LifecycleTable) -> tuple[bytes, dict]:
    """EHPR v1: header, piece table, ring table, int16 lon/lat vertices."""
    piece_rows: list[tuple] = []
    ring_rows: list[int] = []
    vertices: list[tuple[int, int]] = []
    collapsed_rings = 0
    dropped: list[int] = []
    for order, piece in enumerate(pieces):
        rings: list[tuple[list[tuple[int, int]], bool]] = []
        for part in polygon_parts(piece["geometry"]):
            exterior = quantise_ring(part.exterior.coords)
            if len(exterior) < 3:
                collapsed_rings += 1
                continue
            rings.append((exterior, False))
            for interior in part.interiors:
                hole = quantise_ring(interior.coords)
                if len(hole) < 3:
                    collapsed_rings += 1
                    continue
                rings.append((hole, True))
        if not rings:
            dropped.append(order)
            continue
        lifecycle = piece.get("lifecycleIndex")
        if lifecycle is None:
            lifecycle = lifecycles.index(piece["lifecycleYoungestMa"], piece["lifecycleOldestMa"])
        row = (piece["chartIndex"], piece["bindingIndex"], piece["evidenceIndex"], lifecycle,
               piece["flags"], len(rings))
        if any(value >= CATALOG_INDEX_CEILING for value in row):
            raise CompileError(f"{class_name}: a piece field does not fit u16: {row}")
        piece_rows.append(row)
        for ring, hole in rings:
            if len(ring) >= RING_VERTEX_CEILING:
                raise CompileError(
                    f"{class_name}: a ring of {len(ring)} vertices does not fit the u16 ring record")
            ring_rows.append(len(ring) | (RING_HOLE_BIT if hole else 0))
            vertices.extend(ring)
    payload = bytearray(HEADER_BYTES + PIECE_BYTES * len(piece_rows)
                        + RING_BYTES * len(ring_rows) + 4 * len(vertices))
    payload[0:4] = FORMAT_ID.encode()
    struct.pack_into("<HHIIIHHff", payload, 4, FORMAT_VERSION, HEADER_BYTES,
                     len(piece_rows), len(ring_rows), len(vertices),
                     CLASS_CODES[class_name], interval_index,
                     float(interval["fromAgeMa"]), float(interval["toAgeMa"]))
    offset = HEADER_BYTES
    for row in piece_rows:
        struct.pack_into("<HHHHHH", payload, offset, *row)
        offset += PIECE_BYTES
    for packed_count in ring_rows:
        struct.pack_into("<H", payload, offset, packed_count)
        offset += RING_BYTES
    for x, y in vertices:
        struct.pack_into("<hh", payload, offset, x, y)
        offset += 4
    if offset != len(payload):
        raise CompileError("EHPR writer produced a short buffer")
    return bytes(payload), {"pieces": len(piece_rows), "rings": len(ring_rows),
                            "vertices": len(vertices), "collapsedRings": collapsed_rings,
                            "droppedPieceIndices": dropped}


def decode_ehpr(payload: bytes, catalog: dict | None = None) -> dict:
    """Decode an EHPR v1 payload back to lon/lat rings (used by QC and the validator).

    A piece always carries ``lifecycleIndex``. Pass the class catalog to resolve it
    into ``lifecycleYoungestMa``/``lifecycleOldestMa``; an index the catalog does
    not have is a decode failure, not a silent miss.
    """
    if payload[:4] != FORMAT_ID.encode():
        raise CompileError("not an EHPR payload")
    (version, header_bytes, piece_count, ring_count, vertex_count,
     class_code, interval_index, from_age, to_age) = struct.unpack_from("<HHIIIHHff", payload, 4)
    if version != FORMAT_VERSION or header_bytes != HEADER_BYTES:
        raise CompileError(f"unsupported EHPR version {version}")
    piece_offset = HEADER_BYTES
    ring_offset = piece_offset + PIECE_BYTES * piece_count
    vertex_offset = ring_offset + RING_BYTES * ring_count
    if vertex_offset + 4 * vertex_count != len(payload):
        raise CompileError("EHPR payload length disagrees with its header")
    raw = np.frombuffer(payload, dtype="<i2", count=2 * vertex_count, offset=vertex_offset)
    coordinates = raw.reshape(-1, 2).astype(np.float64)
    coordinates[:, 0] /= LON_SCALE
    coordinates[:, 1] /= LAT_SCALE
    rings = []
    start = 0
    for index in range(ring_count):
        packed = struct.unpack_from("<H", payload, ring_offset + RING_BYTES * index)[0]
        count = packed & (RING_HOLE_BIT - 1)
        rings.append((start, count, bool(packed & RING_HOLE_BIT)))
        start += count
    if start != vertex_count:
        raise CompileError("EHPR ring vertex counts do not sum to the header vertex count")
    lifecycles = catalog_lifecycles(catalog) if catalog is not None else None
    pieces = []
    cursor = 0
    for index in range(piece_count):
        (chart, binding, evidence, lifecycle, flags, ring_total) = struct.unpack_from(
            "<HHHHHH", payload, piece_offset + PIECE_BYTES * index)
        piece = {"chartIndex": chart, "bindingIndex": binding, "evidenceIndex": evidence,
                 "lifecycleIndex": lifecycle, "flags": flags,
                 "rings": rings[cursor:cursor + ring_total]}
        if lifecycles is not None:
            if lifecycle >= len(lifecycles):
                raise CompileError(
                    f"EHPR piece {index} names lifecycle {lifecycle}; the catalog has "
                    f"{len(lifecycles)}")
            piece["lifecycleYoungestMa"] = float(lifecycles[lifecycle]["youngestExclusiveMa"])
            piece["lifecycleOldestMa"] = float(lifecycles[lifecycle]["oldestMa"])
        pieces.append(piece)
        cursor += ring_total
    if cursor != ring_count:
        raise CompileError("EHPR ring table is not partitioned by the piece table")
    return {"classCode": class_code, "intervalIndex": interval_index, "fromAgeMa": from_age,
            "toAgeMa": to_age, "pieces": pieces, "coordinates": coordinates,
            "vertexCount": vertex_count}


def piece_geometry(decoded: dict, piece: dict):
    coordinates = decoded["coordinates"]
    parts = []
    current = None
    holes: list = []
    for start, count, hole in piece["rings"]:
        ring = coordinates[start:start + count]
        if len(ring) < 3:
            continue
        loop = [(float(x), float(y)) for x, y in ring]
        if hole:
            holes.append(loop)
        else:
            if current is not None:
                parts.append(Polygon(current, holes))
                holes = []
            current = loop
    if current is not None:
        parts.append(Polygon(current, holes))
    if not parts:
        return Polygon()
    return polygonal(parts[0] if len(parts) == 1 else MultiPolygon(parts))


# --------------------------------------------------------------------------
# evidence interning
# --------------------------------------------------------------------------

def evidence_record(class_name: str, basin_references: list[str], edited: bool) -> dict:
    limitations = [MAP_INTERVAL_LIMITATION, COOKIE_CUT_LIMITATION]
    if class_name == "sm":
        limitations.insert(0, SHALLOW_MARINE_LIMITATION)
    if class_name == "m":
        limitations.insert(0, MOUNTAIN_LIMITATION)
    source_ids = ["cao-2017-paleogeography", "matthews-2016-plate-boundaries",
                  "cao-v2.4-static-partitions"]
    record = {
        "status": "derived-from-published-source" if edited else "classified-map-polygon",
        "surfaceClass": CLASS_NAMES[class_name],
        "appearance": SURFACE_APPEARANCE[class_name],
        "method": COMPILER_METHOD,
        "sourceIds": source_ids + sorted(basin_references),
        "limitations": limitations,
    }
    if edited:
        record["editorial"] = EDITORIAL_PREFIX + ", ".join(sorted(basin_references))
    return record


# --------------------------------------------------------------------------
# outline tone tables
# --------------------------------------------------------------------------

TONE_DARK = 0
TONE_LIGHT_SHELF = 1
TONE_LIGHT_DEEP = 2
TONE_INACTIVE = 3


def load_cao2024_crust() -> list[dict]:
    """Cao 2024 continental crust polygons with their plate, for the shelf tone class."""
    rows = []
    for feature in pygplates.FeatureCollection(str(audit.CONTINENTS)):
        begin, end = feature.get_valid_time()
        plate = feature.get_reconstruction_plate_id(None)
        if plate is None:
            continue
        for geometry in feature.get_geometries():
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            planar, _ = audit.planar_geometry(geometry)
            if planar.is_empty:
                continue
            rows.append({"plateId": plate, "beginMa": begin, "endMa": end, "geometry": planar})
    return rows


def read_core() -> dict:
    """Read ``core.json`` in either the expanded or the interned package form.

    The package compilers intern the repeated chart fields; ``cao_package_intern``
    is the reader that understands both forms, so the tone table keeps working
    across that change.
    """
    path = PUBLIC / "core.json"
    try:
        import cao_package_intern
    except ImportError:
        return json.loads(path.read_text())
    return cao_package_intern.read_package_json(path)


def load_country_segments() -> dict:
    """Decode country-reference.ehgl into segment midpoints with their plate and lifecycle."""
    binary = (PUBLIC / "country-reference.ehgl").read_bytes()
    if binary[:4] != b"EHGL":
        raise CompileError("country-reference.ehgl is not an EHGL payload")
    version, header, vertex_count, segment_count, *_ = struct.unpack_from("<HHIIIIII", binary, 4)
    if version != 2:
        raise CompileError(f"unsupported EHGL version {version}")
    positions = np.frombuffer(binary, dtype="<f4", count=3 * vertex_count,
                              offset=header).reshape(-1, 3).astype(np.float64)
    chart_offset = header + 12 * vertex_count
    charts = np.frombuffer(binary, dtype="<u4", count=vertex_count, offset=chart_offset)
    index_offset = chart_offset + 4 * vertex_count
    indices = np.frombuffer(binary, dtype="<u4", count=2 * segment_count,
                            offset=index_offset).reshape(-1, 2)
    left = positions[indices[:, 0]]
    right = positions[indices[:, 1]]
    midpoints = left + right
    midpoints /= np.linalg.norm(midpoints, axis=1, keepdims=True)
    longitudes = np.degrees(np.arctan2(midpoints[:, 1], midpoints[:, 0]))
    latitudes = np.degrees(np.arcsin(np.clip(midpoints[:, 2], -1.0, 1.0)))
    chart_rows = read_core()["charts"]
    segment_charts = charts[indices[:, 0]]
    plates = np.zeros(segment_count, dtype=np.int64)
    youngest = np.zeros(segment_count)
    oldest = np.zeros(segment_count)
    for index in range(segment_count):
        chart = chart_rows[int(segment_charts[index])]
        if chart.get("role") != "country-reference":
            raise CompileError(
                f"segment {index} points at chart {chart.get('chartId')}, which is not a country reference")
        parts = chart["chartId"].split(":")
        # The segment-bridge contract adds present-day locator charts that carry no
        # Cao static fragment and are valid only at exactly 0 Ma; they are inactive
        # in every palaeo interval and never take a land tone.
        plates[index] = int(parts[parts.index("plate") + 1]) if "plate" in parts else -1
        youngest[index] = chart["lifecycle"]["validTimeMa"]["youngest"]
        oldest[index] = chart["lifecycle"]["validTimeMa"]["oldest"]
    return {"segmentCount": int(segment_count), "longitudes": longitudes, "latitudes": latitudes,
            "plateIds": plates, "youngestMa": youngest, "oldestMa": oldest,
            "geometrySha256": sha256_bytes(binary), "coreSha256": sha256_path(PUBLIC / "core.json")}


def build_tone_tables(segments: dict, intervals: list[dict],
                      land_by_interval: dict[str, list[tuple[int, object]]],
                      shelf_by_interval: dict[str, list[tuple[int, object]]],
                      crust: list[dict]) -> tuple[bytes, dict]:
    """The country-outline tone tables: two bits per segment per interval.

    Layout (little-endian): a 32-byte header — magic ``EHPT``, u16 version 1,
    u16 header bytes 32, u32 table count, u32 segment count, u32 bytes per table,
    twelve reserved zero bytes — followed by ``tableCount`` tables of
    ``bytesPerTable`` bytes. Segment ``i`` lives in byte ``i >> 2`` at bit offset
    ``(i & 3) * 2``, least significant pair first. Tables run oldest to youngest,
    the same order as the canonical interval list.

    Tone 0 is dark ink: the segment midpoint is inside a landmass or mountain
    piece owned by the same plate as the segment's own static fragment. Tone 1 is
    light over shallow ground: mapped shallow marine of the same plate, or Cao
    2024 continental crust of that plate, whose depth the model does not state.
    Tone 2 is light over deep or unmapped ground. Tone 3 means the
    country-reference chart is not active at the interval mid-age.
    """
    count = segments["segmentCount"]
    stride = (count + 3) // 4
    payload = bytearray(32 + stride * len(intervals))
    payload[0:4] = b"EHPT"
    struct.pack_into("<HHIII", payload, 4, 1, 32, len(intervals), count, stride)
    points = [shapely.Point(float(lon), float(lat))
              for lon, lat in zip(segments["longitudes"], segments["latitudes"])]
    rows = []
    for order, interval in enumerate(intervals):
        age = interval["midAgeMa"]
        # A detached interval draws over the present-day composition instead of
        # replacing it: native land is still on screen, so the two-tone device -
        # dark over reconstructed land, light over a mapped sea - has no
        # composition to read. Its table is therefore the same all-dark ink the
        # overlay carries with the mode off, and the only thing it still honours
        # is a country-reference chart that is not active at all.
        if interval_is_detached(interval):
            base = 32 + stride * order
            counters = [0, 0, 0, 0]
            for index in range(count):
                tone = (TONE_DARK
                        if segments["youngestMa"][index] <= age <= segments["oldestMa"][index]
                        else TONE_INACTIVE)
                counters[tone] += 1
                payload[base + (index >> 2)] |= tone << ((index & 3) * 2)
            rows.append({"intervalId": interval["intervalId"], "detached": True,
                         "fromAgeMa": interval["fromAgeMa"], "toAgeMa": interval["toAgeMa"],
                         "darkSegments": counters[TONE_DARK],
                         "lightShelfSegments": counters[TONE_LIGHT_SHELF],
                         "lightDeepSegments": counters[TONE_LIGHT_DEEP],
                         "inactiveSegments": counters[TONE_INACTIVE]})
            continue
        dark_entries = land_by_interval.get(interval["intervalId"], [])
        shelf_entries = list(shelf_by_interval.get(interval["intervalId"], []))
        shelf_entries.extend((row["plateId"], row["geometry"]) for row in crust
                             if row["endMa"] <= age <= row["beginMa"])
        dark_tree = STRtree([geometry for _, geometry in dark_entries]) if dark_entries else None
        shelf_tree = STRtree([geometry for _, geometry in shelf_entries]) if shelf_entries else None
        base = 32 + stride * order
        counters = [0, 0, 0, 0]
        for index, point in enumerate(points):
            plate = int(segments["plateIds"][index])
            if not (segments["youngestMa"][index] <= age <= segments["oldestMa"][index]):
                tone = TONE_INACTIVE
            elif dark_tree is not None and any(
                    dark_entries[candidate][0] == plate
                    and dark_entries[candidate][1].contains(point)
                    for candidate in dark_tree.query(point)):
                tone = TONE_DARK
            elif shelf_tree is not None and any(
                    shelf_entries[candidate][0] == plate
                    and shelf_entries[candidate][1].contains(point)
                    for candidate in shelf_tree.query(point)):
                tone = TONE_LIGHT_SHELF
            else:
                tone = TONE_LIGHT_DEEP
            counters[tone] += 1
            payload[base + (index >> 2)] |= tone << ((index & 3) * 2)
        rows.append({"intervalId": interval["intervalId"], "detached": False,
                     "fromAgeMa": interval["fromAgeMa"], "toAgeMa": interval["toAgeMa"],
                     "darkSegments": counters[TONE_DARK],
                     "lightShelfSegments": counters[TONE_LIGHT_SHELF],
                     "lightDeepSegments": counters[TONE_LIGHT_DEEP],
                     "inactiveSegments": counters[TONE_INACTIVE]})
    catalog = {
        "schemaVersion": 1,
        "toneTableId": "palaeo-outline-tone-v1",
        "segmentCount": count,
        "tableCount": len(intervals),
        "bitsPerSegment": 2,
        "bytesPerTable": stride,
        "headerBytes": 32,
        "byteOrder": "little-endian",
        "bitLayout": "segment i in byte (i >> 2) at bit offset (i & 3) * 2, least significant pair first",
        "tableOrder": "oldest to youngest, the canonical interval order",
        "values": {
            "0": "dark ink: the segment midpoint is inside a landmass or mountain piece of the same plate",
            "1": "light over shallow ground: mapped shallow marine of the same plate, or Cao 2024 "
                 "continental crust of that plate whose depth the model does not state",
            "2": "light over deep or unmapped ground",
            "3": "inactive: the country-reference chart is not active at the interval mid-age",
        },
        "method": ("midpoint of every country-reference segment, decoded from country-reference.ehgl, "
                   "tested against the simplified pieces whose owning static partition carries the same "
                   "plate id as the segment's own static fragment; evaluated at the interval mid-age"),
        "limitations": ["a tone is a legibility aid over the palaeo classes, never evidence that the "
                        "modern country existed",
                        "a detached interval - the LGM lowstand state - draws over the present-day "
                        "composition rather than replacing it, so its table is the same all-dark ink "
                        "the overlay carries with the mode off",
                        "the plate match is by plate id, not by static fragment identity",
                        "the tone is evaluated at the interval mid-age, so it does not follow an "
                        "off-schedule record's own lifecycle inside the interval"],
        "sourceGeometrySha256": segments["geometrySha256"],
        "observedCoreSha256": segments["coreSha256"],
        "observedCoreNote": ("core.json is re-emitted by the package compilers, so its digest is recorded "
                             "as an observation at compile time and is not a pinned gate"),
        "perInterval": rows,
    }
    return bytes(payload), catalog


# --------------------------------------------------------------------------
# compile one class
# --------------------------------------------------------------------------

def compile_class(class_name: str, rows: list[dict], intervals: list[dict], partitions: list[dict],
                  tree: STRtree, rotations, by_plate: dict[int, list[dict]], palette: dict,
                  overrides: dict[str, list[int]], simplification: dict, basins: list[dict],
                  store: Path, staging: Path, estimate_triangles: bool,
                  canonical_intervals: list[dict] | None = None,
                  lgm_contract: dict | None = None) -> dict:
    started = time.time()
    kept_rows, quarantined = quarantine(rows)
    geometries = {row["index"]: record_polygon(row, densify=True) for row in kept_rows}
    # Basin ops resolve their lifecycles against the full published schedule, not
    # against a development `--intervals` subset: an edit's ages are a property of
    # the contract, so a partial run must emit the same geometry for the intervals
    # it does compile.
    kept_rows, geometries, basin_report = apply_basin_ops(
        class_name, kept_rows, geometries, basins, canonical_intervals or intervals)
    # The LGM contract's rows come last, after the basin ops have taken their own
    # synthetic indices: appending them earlier would renumber every `add-*`
    # record and change payload bytes in intervals this contract never touches.
    if lgm_contract is not None and class_name == LGM_CLASS:
        for row in lgm_rows(lgm_contract,
                            max((row["index"] for row in kept_rows), default=-1) + 1):
            kept_rows.append(row)
            geometries[row["index"]] = record_polygon(row, densify=True)

    canonical_pairs = {(interval["fromAgeMa"], interval["toAgeMa"]) for interval in intervals}
    override_plates = set(overrides.get(class_name, []))
    simplification = class_simplification(simplification, class_name)
    protected_boxes = [shapely.box(*window["bbox"])
                       for window in simplification["protectedWindows"]]

    source_area = 0.0
    cut_area = 0.0
    dropped_area = 0.0
    dropped_pieces = 0
    straddling_rings = 0
    cuts: dict[int, list[dict]] = {}
    dropped_by_record: dict[int, tuple[float, int]] = {}
    for row in kept_rows:
        geometry = geometries[row["index"]]
        if geometry.is_empty:
            continue
        value = area_km2(geometry)
        source_area += value
        pieces, lost_area, lost_count = cut_record(geometry, partitions, tree)
        dropped_area += lost_area
        dropped_pieces += lost_count
        dropped_by_record[row["index"]] = (lost_area, lost_count)
        if len(pieces) > 1:
            straddling_rings += 1
        entries = []
        # A contract compiled against its own source grid ships its own node
        # reduction; running Douglas-Peucker over it a second time would move a
        # coastline the derivation already measured and reported.
        pre_simplified = bool(row.get("preSimplified"))
        for index, piece, piece_area in pieces:
            cut_area += piece_area
            protected = pre_simplified or any(piece.intersects(box) for box in protected_boxes)
            simplified, meta = simplify_piece(piece, piece_area, simplification, protected)
            entries.append({"partitionIndex": index, "original": piece, "simplified": simplified,
                            "areaSquareKilometres": piece_area,
                            "simplifiedAreaSquareKilometres": meta["areaSquareKilometres"],
                            "simplification": meta})
        cuts[row["index"]] = entries

    # interned tables
    evidence_table: list[dict] = []
    evidence_index: dict[str, int] = {}

    def intern_evidence(record: dict) -> int:
        key = json.dumps(record, sort_keys=True)
        if key not in evidence_index:
            evidence_index[key] = len(evidence_table)
            evidence_table.append(record)
        return evidence_index[key]

    # The shipped binding row is (plate, partition, kind, seams): the gap-free
    # palette chain a piece takes is resolved at the requested age from the
    # palette catalog, not carried per piece-window. Keying on the chain instead
    # cost 7,079 rows and 1.7 MiB on `lm` alone.
    binding_table: list[dict] = []
    binding_index: dict[tuple, int] = {}
    gap_sets: list[list[dict]] = [[]]

    def intern_gap_set(gaps: list[dict]) -> int:
        key = json.dumps(gaps, sort_keys=True)
        for index, existing in enumerate(gap_sets):
            if json.dumps(existing, sort_keys=True) == key:
                return index
        gap_sets.append(gaps)
        return len(gap_sets) - 1

    def intern_binding(plate: int, partition: int, override: bool) -> int:
        kind = binding_kind(by_plate, plate, override)
        key = (plate, partition, kind)
        if key not in binding_index:
            binding_index[key] = len(binding_table)
            binding_table.append({"bindingPlateId": plate, "partitionPlateId": partition,
                                  "kind": kind,
                                  "gapSet": intern_gap_set(plate_source_seams(by_plate, plate))})
        return binding_index[key]

    chart_table: list[dict] = []
    chart_index: dict[int, int] = {}
    for row in kept_rows:
        chart_index[row["index"]] = len(chart_table)
        chart_table.append({
            "sourceRecordIndex": row["index"],
            "plateId1": row["plateId1"],
            "fromAgeMa": row["fromAge"],
            "toAgeMa": row["toAge"],
            "featureId": row.get("featureId"),
            "offSchedule": (row["fromAge"], row["toAge"]) not in canonical_pairs,
            "basinOpId": row.get("basinOpId"),
            "contractId": row.get("contractId"),
        })

    rotation_cache: dict[tuple[float, int], object] = {}

    def rotation(age: float, plate: int):
        key = (age, plate)
        if key not in rotation_cache:
            rotation_cache[key] = rotations.get_rotation(age, plate)
        return rotation_cache[key]

    unposable_area = 0.0
    unposable_pieces = 0
    unposable_plates: dict[int, float] = defaultdict(float)
    co_moving = {"near": 0.0, "mid": 0.0, "far": 0.0}
    restoration_bound_pieces = 0
    seam_crossing_pieces = 0
    restoration_bound_area = 0.0
    override_bound_pieces = 0
    per_interval: list[dict] = []
    lifecycle_table = LifecycleTable()
    land_by_interval: dict[str, list[tuple[int, object]]] = {}
    shelf_by_interval: dict[str, list[tuple[int, object]]] = {}
    store.mkdir(parents=True, exist_ok=True)
    staging.mkdir(parents=True, exist_ok=True)

    for interval_order, interval in enumerate(intervals):
        selected = [row for row in kept_rows
                    if row["toAge"] < interval["fromAgeMa"] and interval["toAgeMa"] < row["fromAge"]]
        original_pieces: list[dict] = []
        simplified_pieces: list[dict] = []
        land_entries: list[tuple[int, object]] = []
        shelf_entries: list[tuple[int, object]] = []
        interval_source_area = 0.0
        interval_cut_area = 0.0
        interval_unposable_area = 0.0
        interval_unposable_pieces = 0
        interval_below_floor_area = 0.0
        interval_below_floor_pieces = 0
        interval_simplified_area = 0.0
        interval_lost_pieces = 0
        interval_largest_lost = 0.0
        interval_retained = 0
        interval_protected = 0
        interval_retain_reasons: dict[str, int] = {}
        base_triangles = 0
        refined_triangles = 0
        for row in selected:
            interval_source_area += area_km2(geometries[row["index"]])
            lost_area, lost_count = dropped_by_record.get(row["index"], (0.0, 0))
            interval_below_floor_area += lost_area
            interval_below_floor_pieces += lost_count
            basin_references = row.get("references", [])
            evidence = intern_evidence(
                lgm_evidence_record(row["lgmSourceIds"], row["lgmEditorial"]) if row.get("lgm")
                else evidence_record(class_name, basin_references, bool(basin_references)))
            for entry in cuts.get(row["index"], []):
                partition = partitions[entry["partitionIndex"]]
                owner = partition["plateId"]
                source_plate = row["plateId1"]
                flags = 0
                binding_plate = owner
                if source_plate is not None and source_plate in override_plates:
                    binding_plate = source_plate
                    flags |= FLAG_PLATEID1_OVERRIDE
                window_youngest = max(float(row["toAge"]), float(interval["toAgeMa"]))
                window_oldest = min(float(row["fromAge"]), float(interval["fromAgeMa"]))
                binding_result = binding_entries(by_plate, binding_plate,
                                                 window_youngest, window_oldest)
                if binding_result is None:
                    unposable_area += entry["areaSquareKilometres"]
                    unposable_pieces += 1
                    unposable_plates[binding_plate] += entry["areaSquareKilometres"]
                    interval_unposable_area += entry["areaSquareKilometres"]
                    interval_unposable_pieces += 1
                    continue
                segments, motion_gaps = binding_result
                if motion_gaps:
                    seam_crossing_pieces += 1
                restoration = any(entry_id.startswith(RESTORATION_PREFIX)
                                  for entry_id, _, _ in segments)
                if restoration:
                    flags |= FLAG_RESTORATION_BOUND
                    restoration_bound_pieces += 1
                    restoration_bound_area += entry["areaSquareKilometres"]
                if flags & FLAG_PLATEID1_OVERRIDE:
                    override_bound_pieces += 1
                if chart_table[chart_index[row["index"]]]["offSchedule"]:
                    flags |= FLAG_OFF_SCHEDULE
                if entry["simplification"]["protected"]:
                    flags |= FLAG_PROTECTED_WINDOW
                    interval_protected += 1
                if entry["simplification"]["retained"]:
                    flags |= FLAG_RETAINED_UNSIMPLIFIED
                    interval_retained += 1
                    for reason, hits in entry["simplification"].get("retainReasons", {}).items():
                        interval_retain_reasons[reason] = interval_retain_reasons.get(reason, 0) + hits
                point = entry["original"].representative_point()
                probe = pygplates.PointOnSphere(point.y, point.x)
                separation = audit.great_circle_km(
                    rotation(interval["midAgeMa"], binding_plate) * probe,
                    rotation(interval["midAgeMa"], source_plate) * probe) if source_plate is not None else 0.0
                bucket = ("near" if separation < audit.CO_MOVING_NEAR_KM
                          else "mid" if separation <= FRAME_CONFLICT_KM else "far")
                co_moving[bucket] += entry["areaSquareKilometres"]
                if bucket == "far":
                    flags |= FLAG_FRAME_CONFLICT
                binding = intern_binding(binding_plate, owner,
                                         bool(flags & FLAG_PLATEID1_OVERRIDE))
                shared = {"chartIndex": chart_index[row["index"]], "bindingIndex": binding,
                          "evidenceIndex": evidence, "flags": flags,
                          "areaSquareKilometres": entry["areaSquareKilometres"],
                          "lifecycleYoungestMa": float(row["toAge"]),
                          "lifecycleOldestMa": float(row["fromAge"])}
                original_pieces.append(dict(shared, geometry=entry["original"]))
                simplified_pieces.append(dict(shared, geometry=entry["simplified"]))
                interval_cut_area += entry["areaSquareKilometres"]
                interval_simplified_area += entry["simplifiedAreaSquareKilometres"]
                if class_name in ("lm", "m"):
                    land_entries.append((owner, entry["simplified"]))
                else:
                    shelf_entries.append((owner, entry["simplified"]))
                if estimate_triangles:
                    if "triangles" not in entry:
                        entry["triangles"] = piece_triangle_estimate(entry["simplified"])
                    base, refined = entry["triangles"]
                    base_triangles += base
                    refined_triangles += refined
        land_by_interval[interval["intervalId"]] = land_entries
        shelf_by_interval[interval["intervalId"]] = shelf_entries

        original_payload, original_stats = encode_ehpr(class_name, interval, interval_order,
                                                       original_pieces, lifecycle_table)
        simplified_payload, simplified_stats = encode_ehpr(class_name, interval, interval_order,
                                                           simplified_pieces, lifecycle_table)
        name = f"palaeo-{class_name}-{interval['intervalId']}.ehpr"
        (store / name).write_bytes(original_payload)
        (staging / name).write_bytes(simplified_payload)
        lost_indices = simplified_stats.pop("droppedPieceIndices")
        original_stats.pop("droppedPieceIndices")
        interval_lost_pieces = len(lost_indices)
        interval_largest_lost = max(
            (simplified_pieces[index]["areaSquareKilometres"] for index in lost_indices), default=0.0)
        if interval_source_area > 0:
            area_error = 100.0 * (interval_simplified_area - interval_cut_area) / interval_cut_area
        else:
            area_error = 0.0
        per_interval.append({
            "intervalId": interval["intervalId"],
            "intervalIndex": interval_order,
            "fromAgeMa": interval["fromAgeMa"],
            "toAgeMa": interval["toAgeMa"],
            "midAgeMa": interval["midAgeMa"],
            "detached": interval_is_detached(interval),
            "sourceRecords": len(selected),
            "sourceAreaSquareKilometres": round(interval_source_area, 3),
            "emittedAreaSquareKilometres": round(interval_cut_area, 3),
            "cutAreaSquareKilometres": round(
                interval_cut_area + interval_unposable_area + interval_below_floor_area, 3),
            "unposableAreaSquareKilometres": round(interval_unposable_area, 3),
            "unposablePieces": interval_unposable_pieces,
            "droppedBelowFloorSquareKilometres": round(interval_below_floor_area, 3),
            "droppedBelowFloorPieces": interval_below_floor_pieces,
            "areaRatioPercent": round(
                100.0 * (interval_cut_area + interval_unposable_area + interval_below_floor_area)
                / interval_source_area, 4) if interval_source_area else 0.0,
            "simplifiedAreaSquareKilometres": round(interval_simplified_area, 3),
            "simplificationAreaErrorPercent": round(area_error, 5),
            "lostPieces": interval_lost_pieces,
            "largestLostPieceSquareKilometres": round(interval_largest_lost, 3),
            "retainedUnsimplifiedPieces": interval_retained,
            "retainedComponentReasons": interval_retain_reasons,
            "protectedPieces": interval_protected,
            "simplified": {"url": name, "bytes": len(simplified_payload),
                           "sha256": sha256_bytes(simplified_payload), **simplified_stats},
            "original": {"url": name, "bytes": len(original_payload),
                         "sha256": sha256_bytes(original_payload), **original_stats},
            "reservation": {"vertices": simplified_stats["vertices"],
                            "baseTriangles": base_triangles,
                            "estimatedTrianglesAtOneDegree": refined_triangles,
                            "maximumEdgeDegrees": MAX_REFINEMENT_EDGE_DEGREES},
        })

    # Every catalog array a piece indexes is reached through a u16 field.
    for label, table in (("chart", chart_table), ("binding", binding_table),
                         ("evidence", evidence_table), ("lifecycle", lifecycle_table.rows)):
        if len(table) >= CATALOG_INDEX_CEILING:
            raise CompileError(
                f"{class_name}: {len(table)} {label} records exceed the u16 piece field")

    total_cut = sum(row["emittedAreaSquareKilometres"] for row in per_interval)
    provenance = {
        "schemaVersion": PROVENANCE_SCHEMA_VERSION,
        "provenanceId": f"palaeo-coastlines-{class_name}-provenance-v1",
        "catalogId": f"palaeo-coastlines-{class_name}-v{CATALOG_SCHEMA_VERSION}",
        "class": class_name,
        "className": CLASS_NAMES[class_name],
        "appearance": SURFACE_APPEARANCE[class_name],
        "format": {"magic": FORMAT_ID, "version": FORMAT_VERSION,
                   "specification": "docs/data/palaeo-coastlines-format.md"},
        "method": {
            "id": COMPILER_METHOD,
            "cookieCut": ("every source ring is cut by the present-day Cao 2024 static partitions; "
                          "overlapping partitions are resolved so each piece has exactly one owner, "
                          "the smaller partition polygon claiming the shared ground first"),
            "densification": f"great-circle samples every {audit.DENSIFY_DEGREES} degree before any planar Boolean",
            "lifecycleRule": "(TOAGE, FROMAGE]: youngest bound exclusive, oldest bound inclusive",
            "minimumPieceSquareKilometres": MIN_PIECE_KM2,
            "frameConflictKilometres": FRAME_CONFLICT_KM,
        },
        "sourceRecords": {
            "records": len(rows),
            "compiled": len(kept_rows),
            "quarantined": quarantined,
            "offScheduleCharts": sum(1 for chart in chart_table if chart["offSchedule"]),
        },
        "areaAudit": {
            "weighting": ("interval-weighted: a record active in several canonical intervals is "
                          "counted once per interval, on both sides of the ratio"),
            "sourceAreaSquareKilometres": round(
                sum(row["sourceAreaSquareKilometres"] for row in per_interval), 3),
            "cutAreaSquareKilometres": round(
                sum(row["cutAreaSquareKilometres"] for row in per_interval), 3),
            "emittedAreaSquareKilometres": round(
                sum(row["emittedAreaSquareKilometres"] for row in per_interval), 3),
            "unposableAreaSquareKilometres": round(
                sum(row["unposableAreaSquareKilometres"] for row in per_interval), 3),
            "droppedBelowFloorSquareKilometres": round(
                sum(row["droppedBelowFloorSquareKilometres"] for row in per_interval), 3),
            "areaRatioPercent": round(
                100.0 * sum(row["cutAreaSquareKilometres"] for row in per_interval)
                / sum(row["sourceAreaSquareKilometres"] for row in per_interval), 4)
                if per_interval else 0.0,
            "emittedRatioPercent": round(
                100.0 * sum(row["emittedAreaSquareKilometres"] for row in per_interval)
                / sum(row["sourceAreaSquareKilometres"] for row in per_interval), 4)
                if per_interval else 0.0,
            "perRecordCookieCut": {
                "sourceAreaSquareKilometres": round(source_area, 3),
                "cutAreaSquareKilometres": round(cut_area, 3),
                "areaRatioPercent": round(100.0 * cut_area / source_area, 4) if source_area else 0.0,
                "droppedBelowFloorSquareKilometres": round(dropped_area, 3),
                "droppedBelowFloorPieces": dropped_pieces,
                "weighting": "each source record counted once, whatever number of intervals it spans",
            },
            "straddlingRings": straddling_rings,
        },
        "poseAudit": {
            "coMovingAreaPercent": {
                "under25Km": round(100.0 * co_moving["near"] / total_cut, 3) if total_cut else 0.0,
                "from25To250Km": round(100.0 * co_moving["mid"] / total_cut, 3) if total_cut else 0.0,
                "over250Km": round(100.0 * co_moving["far"] / total_cut, 3) if total_cut else 0.0,
            },
            "overrideBoundPieces": override_bound_pieces,
            "overridePlateIds": sorted(override_plates),
            "restorationBoundPieces": restoration_bound_pieces,
            "seamCrossingPieces": seam_crossing_pieces,
            "restorationBoundAreaSquareKilometres": round(restoration_bound_area, 3),
            "restorationPartitionPlateIds": list(NORTH_SEA_PARTITION_PLATES),
            "unposable": {
                "pieces": unposable_pieces,
                "areaSquareKilometres": round(unposable_area, 3),
                "areaPercentOfCut": round(100.0 * unposable_area / cut_area, 4) if cut_area else 0.0,
                "plates": [{"bindingPlateId": plate, "areaSquareKilometres": round(value, 3)}
                           for plate, value in sorted(unposable_plates.items(),
                                                      key=lambda item: -item[1])[:25]],
            },
        },
        "simplification": {
            "config": "data/corrections/palaeo-coastlines/simplification.json",
            "configSha256": sha256_path(CONFIG / "simplification.json"),
            "areaClasses": simplification["areaClasses"],
            "areaErrorPercent": round(
                100.0 * (sum(row["simplifiedAreaSquareKilometres"] for row in per_interval)
                         - total_cut) / total_cut, 5) if total_cut else 0.0,
            "retainedUnsimplifiedPieces": sum(row["retainedUnsimplifiedPieces"] for row in per_interval),
            "retainedComponentReasons": {
                reason: sum(row["retainedComponentReasons"].get(reason, 0) for row in per_interval)
                for reason in sorted({key for row in per_interval
                                      for key in row["retainedComponentReasons"]})},
            "protectedPieces": sum(row["protectedPieces"] for row in per_interval),
        },
        "flags": {
            "1": "frame-conflict: more than 250 km from the PLATEID1 position at the interval mid-age",
            "2": "bound by the source PLATEID1 override rather than by the owner partition",
            "4": "bound to a North Sea restoration palette entry",
            "8": "the source record is off the published 24-interval schedule",
            "16": "inside a protected basin window; never simplified",
            "32": "retained unsimplified because simplification would have lost the piece",
        },
        "flagLimitations": {
            "1": FRAME_CONFLICT_LIMITATION,
            "2": OVERRIDE_LIMITATION,
            "4": RESTORATION_LIMITATION,
            "8": OFF_SCHEDULE_LIMITATION,
        },
        "charts": intern_chart_provenance(chart_table),
        "bindings": pack_columns(binding_table, BINDING_FIELDS),
        "gapSets": gap_sets,
        "evidence": evidence_table,
        "lifecycles": lifecycle_table.rows,
        "basinEdits": basin_report,
        "basinContracts": [{"basinId": basin["basinId"], "path": basin["_path"],
                            "sha256": basin["_sha256"], "ops": len(basin["ops"]),
                            "referenceSourceIds": [reference["sourceId"]
                                                   for reference in basin["references"]]}
                           for basin in basins],
        "intervals": per_interval,
        "totals": {
            "pieces": sum(row["simplified"]["pieces"] for row in per_interval),
            "vertices": sum(row["simplified"]["vertices"] for row in per_interval),
            "simplifiedBytes": sum(row["simplified"]["bytes"] for row in per_interval),
            "originalBytes": sum(row["original"]["bytes"] for row in per_interval),
            "estimatedTrianglesAtOneDegree": sum(row["reservation"]["estimatedTrianglesAtOneDegree"]
                                                 for row in per_interval),
            "worstIntervalByVertices": max(per_interval, key=lambda row: row["simplified"]["vertices"])["intervalId"],
            "worstIntervalVertices": max(row["simplified"]["vertices"] for row in per_interval),
            "worstIntervalEstimatedTriangles": max(row["reservation"]["estimatedTrianglesAtOneDegree"]
                                                   for row in per_interval),
        },
        "elapsedSeconds": round(time.time() - started, 2),
    }
    catalog = runtime_catalog(class_name, palette, provenance, binding_table, gap_sets,
                              evidence_table, lifecycle_table.rows, per_interval, by_plate)
    return {"catalog": catalog, "provenance": provenance,
            "landByInterval": land_by_interval, "shelfByInterval": shelf_by_interval}


# --------------------------------------------------------------------------
# runtime catalog
# --------------------------------------------------------------------------

def runtime_catalog(class_name: str, palette: dict, provenance: dict, bindings: list[dict],
                    gap_sets: list[list[dict]], evidence: list[dict], lifecycles: list[dict],
                    per_interval: list[dict], by_plate: dict[int, list[dict]]) -> dict:
    """The document the browser downloads: the tables a piece index resolves into.

    Everything a piece's u16 fields point at is here; every measurement the
    validator re-derives, and every source-record identifier the map key does not
    read, is in the provenance sidecar the ``provenance`` block names by digest.
    The tables are columnar because the per-row key names, not the values, were
    what the v1 catalog spent its megabytes on.
    """
    restoration_entry_ids = sorted(entry["entryId"] for entries in by_plate.values()
                                   for entry in entries
                                   if entry["entryId"].startswith(RESTORATION_PREFIX))
    recovery_plate_ids = sorted({plate for plate, entries in by_plate.items()
                                 if any(entry["entryId"].startswith(RECOVERY_PREFIX)
                                        for entry in entries)})
    return {
        "schemaVersion": CATALOG_SCHEMA_VERSION,
        "encoding": CATALOG_ENCODING,
        "catalogId": provenance["catalogId"],
        "class": class_name,
        "className": CLASS_NAMES[class_name],
        "appearance": SURFACE_APPEARANCE[class_name],
        "format": {"magic": FORMAT_ID, "version": FORMAT_VERSION,
                   "specification": "docs/data/palaeo-coastlines-format.md"},
        "paletteId": palette["id"],
        "lifecycleRule": "(TOAGE, FROMAGE]: youngest bound exclusive, oldest bound inclusive",
        # Intervals that do not abut their neighbour in the published schedule.
        # The runtime refuses a schedule gap it was not told about, so a compiler
        # that dropped an interval still fails; this names the one gap the
        # contract intends, between 11-2 Ma and the LGM lowstand state.
        "detachedIntervalIds": [row["intervalId"] for row in per_interval if row.get("detached")],
        "payloadNameTemplate": f"palaeo-{class_name}-<intervalId>.ehpr",
        "maximumEdgeDegrees": MAX_REFINEMENT_EDGE_DEGREES,
        # A piece's u16 chartIndex is the source-record ordinal: the sidecar's
        # charts table has one row per index, in the same order.
        "chartCount": provenance["charts"]["count"],
        "flagLimitations": {
            "1": FRAME_CONFLICT_LIMITATION,
            "2": OVERRIDE_LIMITATION,
            "4": RESTORATION_LIMITATION,
            "8": OFF_SCHEDULE_LIMITATION,
        },
        "entrySelection": {
            "rule": BINDING_ENTRY_RULE,
            "coverage": "youngestAgeMa <= ageMa <= oldestAgeMa",
            "tieBreak": "largest youngestAgeMa, then entryId",
            "preference": [RESTORATION_PREFIX, RECOVERY_PREFIX, "correction-plate-", "plate-"],
            "correctionPreferenceAgeMa": 410.0,
            "restorationEntryIds": restoration_entry_ids,
            "recoveryPlateIds": recovery_plate_ids,
            "recoveryFallback": "unposable",
        },
        "bindingKinds": list(BINDING_KINDS),
        "bindings": pack_columns(
            [dict(row, kind=BINDING_KINDS.index(row["kind"])) for row in bindings],
            BINDING_FIELDS),
        "gapSets": gap_sets,
        "evidence": evidence,
        "lifecycles": pack_columns(lifecycles, ("youngestExclusiveMa", "oldestMa")),
        "intervals": pack_columns([{
            "intervalId": row["intervalId"],
            "intervalIndex": row["intervalIndex"],
            "fromAgeMa": row["fromAgeMa"],
            "toAgeMa": row["toAgeMa"],
            "midAgeMa": row["midAgeMa"],
            "bytes": row["simplified"]["bytes"],
            "sha256": row["simplified"]["sha256"],
            "pieces": row["simplified"]["pieces"],
            "rings": row["simplified"]["rings"],
            "vertices": row["simplified"]["vertices"],
            "collapsedRings": row["simplified"]["collapsedRings"],
            "baseTriangles": row["reservation"]["baseTriangles"],
            "estimatedTrianglesAtOneDegree": row["reservation"]["estimatedTrianglesAtOneDegree"],
        } for row in per_interval], INTERVAL_FIELDS),
    }


def catalog_intervals(catalog: dict) -> list[dict]:
    """Interval rows of a runtime catalog, oldest first, in the payload shape."""
    return unpack_columns(catalog["intervals"])


def catalog_bindings(catalog: dict) -> list[dict]:
    """Binding rows with ``kind`` back as its name and the gap set resolved."""
    rows = unpack_columns(catalog["bindings"])
    for row in rows:
        row["kind"] = catalog["bindingKinds"][row["kind"]]
        row["motionSupportGaps"] = catalog["gapSets"][row["gapSet"]]
    return rows


def catalog_lifecycles(catalog: dict) -> list[dict]:
    return unpack_columns(catalog["lifecycles"])


def payload_url(class_name: str, interval_id: str) -> str:
    return f"palaeo-{class_name}-{interval_id}.ehpr"


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def compile_all(classes: list[str], store: Path, estimate_triangles: bool,
                interval_filter: set[str] | None, shipped: list[str]) -> dict:
    started = time.time()
    manifest = load_json(CONFIG / "sources.json")
    inputs = verify_sources(manifest)
    overrides = validate_overrides(load_json(CONFIG / "overrides.json"))
    simplification = load_json(CONFIG / "simplification.json")

    archive_path = ROOT.parent / "EarthHistory-data/palaeomap-study" / next(
        source["archive"]["path"] for source in manifest["sources"] if "archive" in source)
    with zipfile.ZipFile(archive_path) as archive:
        rows_by_class = {name: audit.read_class(archive, name) for name in ("lm", "sm", "m")}
    intervals = audit.canonical_schedule(rows_by_class)
    audit.checkpoint_report(rows_by_class, intervals)
    # Basin edit contracts address the published Cao schedule only; the LGM
    # lowstand state is its own contract with its own geometry and references,
    # so it is appended after `load_basins` has validated against the 24.
    interval_ids = {interval["intervalId"] for interval in intervals}
    basins = load_basins(interval_ids)
    lgm = load_lgm_contract()
    if lgm is not None:
        intervals.append(lgm_interval(lgm))
    canonical_intervals = list(intervals)
    if interval_filter:
        unknown = sorted(interval_filter - {interval["intervalId"] for interval in intervals})
        if unknown:
            raise CompileError(f"unknown intervals {unknown}")
        intervals = [interval for interval in intervals if interval["intervalId"] in interval_filter]

    rotations = pygplates.RotationModel([str(audit.ROTATION_YOUNG), str(audit.ROTATION_OLD)],
                                        default_anchor_plate_id=0)
    rotation_check = audit.check_rotation_model([audit.ROTATION_YOUNG, audit.ROTATION_OLD])
    partitions, splits = audit.load_partitions()
    tree = STRtree([partition["geometry"] for partition in partitions])
    palette, by_plate = load_palette()

    store.mkdir(parents=True, exist_ok=True)
    summary: dict[str, dict] = {}
    catalogs: dict[str, dict] = {}
    land_by_interval: dict[str, list[tuple[int, object]]] = {
        interval["intervalId"]: [] for interval in intervals}
    shelf_by_interval: dict[str, list[tuple[int, object]]] = {
        interval["intervalId"]: [] for interval in intervals}
    for class_name in classes:
        result = compile_class(class_name, rows_by_class[class_name], intervals, partitions, tree,
                               rotations, by_plate, palette, overrides, simplification, basins,
                               store / "original" / class_name, store / "staging" / class_name,
                               estimate_triangles, canonical_intervals, lgm)
        catalog = result["catalog"]
        provenance = result["provenance"]
        provenance["inputs"] = inputs
        provenance["rotationCheck"] = rotation_check
        provenance["partitions"] = {"polygons": len(partitions), "datelineSplits": splits,
                                    "ownerRule": ("smallest present-day partition polygon claims shared "
                                                  "ground first; ties by plate id, then source order, "
                                                  "then geometry index")}
        provenance["generatedBy"] = "scripts/research/palaeo_coastlines_compile.py"
        provenance["generatedAt"] = "2026-09-15"
        provenance["runtime"] = {"pygplates": pygplates.__version__, "shapely": shapely.__version__,
                                 "numpy": np.__version__, "python": sys.version.split()[0]}
        # The sidecar is written first: the catalog names it by digest, so the
        # bytes have to exist before the catalog that pins them.
        provenance_directory = store / "provenance"
        provenance_directory.mkdir(parents=True, exist_ok=True)
        provenance_path = provenance_directory / f"palaeo-{class_name}-provenance.json"
        provenance_bytes = canonical(provenance)
        provenance_path.write_bytes(provenance_bytes)
        catalog["provenance"] = {
            "path": str(provenance_path.relative_to(store)),
            "bytes": len(provenance_bytes),
            "sha256": sha256_bytes(provenance_bytes),
            "records": catalog["chartCount"],
            "store": ("offline only: the source-record provenance and every compile measurement "
                      "live in the owned palaeo-coastlines store and never ship with the app"),
        }
        path = store / "staging" / class_name / f"palaeo-{class_name}-catalog.json"
        path.write_bytes(canonical(catalog))
        (store / "original" / class_name / f"palaeo-{class_name}-catalog.json").write_bytes(
            canonical(catalog))
        catalogs[class_name] = catalog
        # A tone table is read against what the browser actually draws. A class
        # that is compiled but not promoted contributes no pixels, so it must not
        # darken an outline segment either.
        if class_name in shipped:
            for interval_id, entries in result["landByInterval"].items():
                land_by_interval[interval_id].extend(entries)
            for interval_id, entries in result["shelfByInterval"].items():
                shelf_by_interval[interval_id].extend(entries)
        summary[class_name] = {
            "simplifiedBytes": provenance["totals"]["simplifiedBytes"],
            "originalBytes": provenance["totals"]["originalBytes"],
            "pieces": provenance["totals"]["pieces"],
            "vertices": provenance["totals"]["vertices"],
            "worstInterval": provenance["totals"]["worstIntervalByVertices"],
            "worstIntervalVertices": provenance["totals"]["worstIntervalVertices"],
            "worstIntervalEstimatedTriangles": provenance["totals"]["worstIntervalEstimatedTriangles"],
            "areaRatioPercent": provenance["areaAudit"]["areaRatioPercent"],
            "simplificationAreaErrorPercent": provenance["simplification"]["areaErrorPercent"],
            "coMovingUnder25KmPercent": provenance["poseAudit"]["coMovingAreaPercent"]["under25Km"],
            "unposablePieces": provenance["poseAudit"]["unposable"]["pieces"],
            "restorationBoundPieces": provenance["poseAudit"]["restorationBoundPieces"],
            "bindings": catalog["bindings"]["count"],
            "catalog": str(path.relative_to(store)),
            "catalogBytes": len(canonical(catalog)),
            "provenance": str(provenance_path.relative_to(store)),
            "provenanceBytes": len(provenance_bytes),
            "elapsedSeconds": provenance["elapsedSeconds"],
        }

    tone_summary = None
    shipped_compiled = [name for name in classes if name in shipped]
    if {"lm", "m"} & set(shipped_compiled):
        segments = load_country_segments()
        crust = load_cao2024_crust()
        payload, tone_catalog = build_tone_tables(segments, intervals, land_by_interval,
                                                  shelf_by_interval, crust)
        tone_path = store / "staging" / "outline-tones.ehpt"
        tone_path.write_bytes(payload)
        tone_catalog["geometryAsset"] = {"url": tone_path.name, "bytes": len(payload),
                                         "sha256": sha256_bytes(payload)}
        tone_catalog["darkClassesUsed"] = sorted({"lm", "m"} & set(shipped_compiled))
        tone_catalog["shelfClassesUsed"] = sorted(
            ({"sm"} & set(shipped_compiled)) | {"cao-2024-continental-crust"})
        tone_catalog["shippedClasses"] = list(shipped_compiled)
        # The legend has to name the classes this table was actually built from,
        # or it would promise dark ink over a class the build does not publish.
        tone_catalog["values"]["0"] = (
            "dark ink: the segment midpoint is inside a "
            + " or ".join(CLASS_NAMES[name] for name in tone_catalog["darkClassesUsed"])
            + " piece of the same plate")
        tone_catalog["values"]["1"] = (
            "light over shallow ground: mapped "
            + " or ".join(CLASS_NAMES[name] for name in tone_catalog["shelfClassesUsed"]
                          if name in CLASS_NAMES)
            + " of the same plate, or Cao 2024 continental crust of that plate whose depth the "
              "model does not state")
        tone_catalog["intervals"] = interval_index(
            intervals, {name: catalogs[name] for name in shipped_compiled})
        (store / "staging" / "outline-tones.json").write_bytes(canonical(tone_catalog))
        tone_summary = {"url": tone_path.name, "bytes": len(payload),
                        "sha256": tone_catalog["geometryAsset"]["sha256"],
                        "segmentCount": tone_catalog["segmentCount"],
                        "tableCount": tone_catalog["tableCount"],
                        "bytesPerTable": tone_catalog["bytesPerTable"],
                        "darkClassesUsed": tone_catalog["darkClassesUsed"],
                        "perInterval": tone_catalog["perInterval"]}

    return {"classes": summary, "outlineTone": tone_summary,
            "intervals": [interval["intervalId"] for interval in intervals],
            "store": str(store), "elapsedSeconds": round(time.time() - started, 2)}


def interval_index(intervals: list[dict], catalogs: dict[str, dict]) -> list[dict]:
    """The per-interval file index, oldest to youngest, one entry per **shipped** class.

    `compile_all` passes only the classes the promote script publishes. Indexing a
    compiled-but-unshipped class here would name a payload URL the package never
    serves, and the vertex and triangle totals below would reserve for geometry
    the browser never receives.
    """
    by_class = {name: {row["intervalId"]: row for row in catalog_intervals(catalog)}
                for name, catalog in catalogs.items()}
    rows = []
    for order, interval in enumerate(intervals):
        entry = {"intervalId": interval["intervalId"], "tableIndex": order,
                 "oldestAgeMa": interval["fromAgeMa"], "youngestAgeMa": interval["toAgeMa"],
                 "midAgeMa": interval["midAgeMa"], "youngestExclusive": True,
                 "detached": interval_is_detached(interval), "classes": {}}
        for name, rows_by_id in by_class.items():
            row = rows_by_id.get(interval["intervalId"])
            if row is None:
                continue
            entry["classes"][name] = {
                "path": f"{name}/{payload_url(name, row['intervalId'])}",
                "bytes": row["bytes"],
                "sha256": row["sha256"],
                "pieces": row["pieces"],
                "vertices": row["vertices"],
                "estimatedTriangles": row["estimatedTrianglesAtOneDegree"],
            }
        entry["vertices"] = sum(row["vertices"] for row in entry["classes"].values())
        entry["estimatedTriangles"] = sum(row["estimatedTriangles"] for row in entry["classes"].values())
        rows.append(entry)
    return rows


def verify_refinement(samples: int = 24) -> dict:
    """Measure the triangle-count recursion against the emitter's own subdivision."""
    import project_cao_triangle_refinement as emitter
    rng = np.random.default_rng(20260915)
    rows = []
    for _ in range(samples):
        directions = []
        base_lon = float(rng.uniform(-180, 180))
        base_lat = float(rng.uniform(-70, 70))
        span = float(rng.uniform(0.2, 12.0))
        for _ in range(3):
            directions.append(audit._unit(base_lon + float(rng.uniform(-span, span)),
                                          base_lat + float(rng.uniform(-span, span))))
        exact = emitter.projected_counts(
            [tuple(float(value) for value in direction) for direction in directions],
            [(0, 1, 2, 0)], math.radians(MAX_REFINEMENT_EDGE_DEGREES))[1]
        edges = (_edge_degrees(directions[0], directions[1]),
                 _edge_degrees(directions[1], directions[2]),
                 _edge_degrees(directions[2], directions[0]))
        rows.append({"edgesDegrees": [round(value, 4) for value in edges],
                     "emitterTriangles": exact,
                     "estimateTriangles": refined_triangle_count(*edges)})
    worst = max(abs(row["estimateTriangles"] - row["emitterTriangles"]) for row in rows)
    exact_matches = sum(1 for row in rows if row["estimateTriangles"] == row["emitterTriangles"])
    return {"samples": samples, "exactMatches": exact_matches,
            "worstAbsoluteDifference": worst, "rows": rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classes", default="lm,sm,m",
                        help="comma-separated subset of lm,sm,m (default: all three)")
    parser.add_argument("--shipped-classes", default=",".join(SHIPPED_CLASSES),
                        help=("comma-separated classes the promote script publishes; only these "
                              "appear in the outline-tone interval index and colour a tone table "
                              f"(default: {','.join(SHIPPED_CLASSES)})"))
    parser.add_argument("--intervals", default=None,
                        help="comma-separated canonical interval ids, for development runs")
    parser.add_argument("--store", type=Path, default=STORE,
                        help="offline store root (default: the owned palaeo-coastlines store)")
    parser.add_argument("--no-triangle-estimate", action="store_true",
                        help="skip the 1-degree triangle reservation estimate")
    parser.add_argument("--verify-refinement", action="store_true",
                        help="measure the triangle recursion against project_cao_triangle_refinement")
    args = parser.parse_args()
    if args.verify_refinement:
        print(json.dumps(verify_refinement(), indent=1))
        return
    classes = [name.strip() for name in args.classes.split(",") if name.strip()]
    unknown = [name for name in classes if name not in CLASS_CODES]
    if unknown:
        parser.error(f"unknown classes {unknown}")
    shipped = [name.strip() for name in args.shipped_classes.split(",") if name.strip()]
    unknown = [name for name in shipped if name not in CLASS_CODES]
    if unknown:
        parser.error(f"unknown shipped classes {unknown}")
    interval_filter = ({name.strip() for name in args.intervals.split(",") if name.strip()}
                       if args.intervals else None)
    result = compile_all(classes, args.store, not args.no_triangle_estimate, interval_filter,
                         shipped)
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()

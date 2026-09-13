#!/usr/bin/env python3
"""Emit optional 25 Ma motion tiles from a verified Cao motion palette.

The tiles copy source palette records byte-for-byte. They accelerate the first
requested-age frame while the unchanged all-age palette remains authoritative.
"""

from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import json
import math
import os
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
CONTRACT = ROOT / "data/corrections/requested-age-motion-tiles/source-contract.json"
HEADER_BYTES = 32
DESCRIPTOR_BYTES = 8
RECORD_BYTES = 20
WINDOW_MICRO_MA = 25_000_000
TILE_ID = "cao-requested-age-motion-tiles-v1"
SELECTION = "youngest-inclusive-oldest-exclusive-final-oldest-inclusive"


class TileError(ValueError):
    pass


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def asset(path: Path, url: str) -> dict:
    return {"url": url, "bytes": path.stat().st_size, "sha256": sha256(path)}


def write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".requested-age-stage")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def micro_ma(value: float) -> int:
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise TileError(f"invalid age: {value!r}")
    result = math.floor(value * 1_000_000 + 0.5)
    if abs(result / 1_000_000 - value) > 1e-9:
        raise TileError(f"age is not representable to one micro-Ma: {value!r}")
    return result


def interval(chart: dict) -> tuple[int, int]:
    valid = chart["lifecycle"]["validTimeMa"]
    return micro_ma(valid["youngest"]), micro_ma(valid["oldest"])


def binding_rows(chart: dict) -> list[dict]:
    rows = chart.get("motionBindings")
    if rows is not None:
        return rows
    row = chart.get("motionBinding")
    if row is None:
        return []
    youngest, oldest = interval(chart)
    return [{**row, "validTimeMa": {
        "youngest": youngest / 1_000_000,
        "oldest": oldest / 1_000_000,
    }}]


def overlaps(youngest: int, oldest: int, window_youngest: int, window_oldest: int) -> bool:
    return max(youngest, window_youngest) <= min(oldest, window_oldest)


def load_contract() -> dict:
    value = json.loads(CONTRACT.read_text())
    if (value.get("schemaVersion") != 1
            or value.get("id") != TILE_ID
            or value.get("windowSizeMicroMa") != WINDOW_MICRO_MA):
        raise TileError("requested-age motion tile contract identity changed")
    return value


def verify_asset(package: Path, row: dict, label: str) -> Path:
    path = package / row["url"]
    if (not path.is_file() or path.stat().st_size != row["bytes"]
            or sha256(path) != row["sha256"]):
        raise TileError(f"verified package asset changed: {label}")
    return path


def load_source(package: Path, contract: dict) -> dict:
    package = package.resolve()
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise TileError(f"package manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    expected = contract["sourcePackage"]
    identity = {
        "packageId": manifest.get("packageId"),
        "revision": manifest.get("revision"),
        "ageDomainMa": manifest.get("ageDomainMa"),
        "frame": manifest.get("frame"),
        "core": manifest.get("core"),
        "motionPalette": {
            key: manifest.get("motionPalette", {}).get(key)
            for key in ("id", "catalog", "binary")
        },
        "materialCorrections": manifest.get("materialCorrections"),
    }
    if identity != expected:
        raise TileError("source package identity differs from the pinned tile contract")
    core_path = verify_asset(package, manifest["core"], "core")
    catalog_path = verify_asset(package, manifest["motionPalette"]["catalog"], "motion catalog")
    binary_path = verify_asset(package, manifest["motionPalette"]["binary"], "motion binary")
    correction = manifest.get("materialCorrections")
    correction_path = verify_asset(package, correction["catalog"], "material corrections") if correction else None

    core = json.loads(core_path.read_text())
    catalog = json.loads(catalog_path.read_text())
    corrections = json.loads(correction_path.read_text()) if correction_path else None
    charts = list(core["charts"]) + (list(corrections["charts"]) if corrections else [])
    binary = binary_path.read_bytes()
    if len(binary) < HEADER_BYTES or binary[:4] != b"EHMP":
        raise TileError("invalid source motion palette binary")
    version, record_bytes, entry_count, record_count, header_bytes, r0, r1, r2 = struct.unpack_from(
        "<HHIIIIII", binary, 4)
    if ((version, record_bytes, header_bytes) != (2, RECORD_BYTES, HEADER_BYTES)
            or entry_count != len(catalog["entries"])
            or len(binary) != HEADER_BYTES + record_count * RECORD_BYTES
            or any((r0, r1, r2))):
        raise TileError("source motion palette header/catalog mismatch")
    entries_by_id = {row["entryId"]: (index, row)
                     for index, row in enumerate(catalog["entries"])}
    if len(entries_by_id) != len(catalog["entries"]):
        raise TileError("duplicate source motion palette entry ID")
    for index, entry in enumerate(catalog["entries"]):
        offset, count = entry["sampleOffset"], entry["sampleCount"]
        if count < 1 or offset < 0 or offset + count > record_count:
            raise TileError(f"invalid source sample range: {entry['entryId']}")
        ages = [struct.unpack_from("<I", binary, HEADER_BYTES + (offset + i) * RECORD_BYTES)[0]
                for i in range(count)]
        if ages != sorted(set(ages)):
            raise TileError(f"non-monotonic source samples: {entry['entryId']}")
        if ages[0] != micro_ma(entry["youngestAgeMa"]) or ages[-1] != micro_ma(entry["oldestAgeMa"]):
            raise TileError(f"source sample extent mismatch: {entry['entryId']}")
        for i in range(count):
            record = struct.unpack_from("<Iffff", binary,
                                        HEADER_BYTES + (offset + i) * RECORD_BYTES)
            norm = math.sqrt(sum(value * value for value in record[1:]))
            if not math.isfinite(norm) or abs(norm - 1) > 2e-6:
                raise TileError(f"invalid source quaternion: {entry['entryId']}")
    for chart in charts:
        for binding in binding_rows(chart):
            if binding.get("paletteId") != catalog["id"] or binding.get("entryId") not in entries_by_id:
                raise TileError(f"chart references an unknown palette entry: {chart['chartId']}")
    return {
        "package": package,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "core": core,
        "catalog": catalog,
        "corrections": corrections,
        "charts": charts,
        "binary": binary,
        "entriesById": entries_by_id,
    }


def tile_name(youngest: int, oldest: int) -> str:
    return f"tile-{youngest // 1_000_000:04d}-{oldest // 1_000_000:04d}ma.ehmt"


def expected_tiles(source: dict) -> list[dict]:
    domain = source["manifest"]["ageDomainMa"]
    domain_youngest = micro_ma(domain["youngest"])
    domain_oldest = micro_ma(domain["oldest"])
    if domain_youngest != 0 or domain_oldest % WINDOW_MICRO_MA:
        raise TileError("source age domain does not form canonical 25 Ma windows")
    result = []
    for window_youngest in range(domain_youngest, domain_oldest, WINDOW_MICRO_MA):
        window_oldest = min(domain_oldest, window_youngest + WINDOW_MICRO_MA)
        entry_ids: set[str] = set()
        for chart in source["charts"]:
            life_youngest, life_oldest = interval(chart)
            if not overlaps(life_youngest, life_oldest, window_youngest, window_oldest):
                continue
            for binding in binding_rows(chart):
                valid = binding["validTimeMa"]
                if overlaps(micro_ma(valid["youngest"]), micro_ma(valid["oldest"]),
                            window_youngest, window_oldest):
                    entry_ids.add(binding["entryId"])
        selected = sorted(source["entriesById"][entry_id] for entry_id in entry_ids)
        descriptors = bytearray()
        records = bytearray()
        source_indices = []
        for entry_index, entry in selected:
            start, count = entry["sampleOffset"], entry["sampleCount"]
            ages = [struct.unpack_from("<I", source["binary"],
                                       HEADER_BYTES + (start + i) * RECORD_BYTES)[0]
                    for i in range(count)]
            left = max(0, bisect.bisect_left(ages, window_youngest) - 1)
            right = min(count - 1, bisect.bisect_right(ages, window_oldest))
            chosen = list(range(left, right + 1))
            descriptors.extend(struct.pack("<II", entry_index, len(chosen)))
            for local_index in chosen:
                global_index = start + local_index
                offset = HEADER_BYTES + global_index * RECORD_BYTES
                records.extend(source["binary"][offset:offset + RECORD_BYTES])
                source_indices.append(global_index)
        entry_count = len(selected)
        record_count = len(source_indices)
        if entry_count < 1 or record_count < entry_count:
            raise TileError("canonical requested-age tile is empty")
        record_offset = HEADER_BYTES + entry_count * DESCRIPTOR_BYTES
        header = b"EHMT" + struct.pack("<HHIIIIII", 1, RECORD_BYTES, entry_count,
                                        record_count, HEADER_BYTES, record_offset, 0, 0)
        payload = header + descriptors + records
        if len(payload) != record_offset + record_count * RECORD_BYTES:
            raise TileError("internal requested-age tile size mismatch")
        name = tile_name(window_youngest, window_oldest)
        indices_payload = b"".join(struct.pack("<I", value) for value in source_indices)
        result.append({
            "name": name,
            "payload": payload,
            "sourceRecordIndices": source_indices,
            "descriptor": {
                "tileId": name.removesuffix(".ehmt"),
                "validTimeMa": {
                    "youngest": window_youngest / 1_000_000,
                    "oldest": window_oldest / 1_000_000,
                    "oldestExclusive": window_oldest != domain_oldest,
                },
                "asset": {
                    "url": f"motion-tiles/{name}",
                    "bytes": len(payload),
                    "sha256": sha256_bytes(payload),
                },
                "entryCount": entry_count,
                "recordCount": record_count,
                "sourceRecordIndicesSha256": sha256_bytes(indices_payload),
            },
        })
    return result


def expected_index(source: dict, tiles: list[dict]) -> dict:
    manifest = source["manifest"]
    correction = manifest.get("materialCorrections")
    return {
        "schemaVersion": 1,
        "id": TILE_ID,
        "packageId": manifest["packageId"],
        "revision": manifest["revision"],
        "frame": manifest["frame"],
        "ageDomainMa": manifest["ageDomainMa"],
        "windowSizeMicroMa": WINDOW_MICRO_MA,
        "windowSelection": SELECTION,
        "sourceIdentity": {
            "coreSha256": manifest["core"]["sha256"],
            "materialCorrectionCatalogSha256": correction["catalog"]["sha256"] if correction else None,
            "motionPaletteId": manifest["motionPalette"]["id"],
            "motionPaletteCatalogSha256": manifest["motionPalette"]["catalog"]["sha256"],
            "motionPaletteBinarySha256": manifest["motionPalette"]["binary"]["sha256"],
            "motionPaletteBinaryBytes": manifest["motionPalette"]["binary"]["bytes"],
        },
        "tiles": [row["descriptor"] for row in tiles],
    }


def staged_manifest(source: dict, index_path: Path) -> dict:
    result = copy.deepcopy(source["manifest"])
    result["motionPalette"]["requestedAgeTiles"] = asset(
        index_path, "motion-tiles/index.json")
    return result


def emit(package: Path, out: Path, manifest_out: Path | None = None) -> dict:
    contract = load_contract()
    source = load_source(package, contract)
    if out.resolve() == (PUBLIC / "motion-tiles").resolve():
        raise TileError("emit to an isolated stage; public promotion is a separate validated step")
    tiles = expected_tiles(source)
    out.mkdir(parents=True, exist_ok=True)
    expected_names = {"index.json", *(row["name"] for row in tiles)}
    unexpected = [path for path in out.iterdir() if path.is_file() and path.name not in expected_names]
    if unexpected:
        raise TileError(f"stage contains unrelated files: {unexpected[0].name}")
    for row in tiles:
        write_atomic(out / row["name"], row["payload"])
    index_path = out / "index.json"
    write_atomic(index_path, canonical(expected_index(source, tiles)))
    measured = {
        "expectedTileCount": len(tiles),
        "expectedTilePayloadBytes": sum(len(row["payload"]) for row in tiles),
        "expectedRecordCount": sum(row["descriptor"]["recordCount"] for row in tiles),
        "expectedEntryDescriptorCount": sum(row["descriptor"]["entryCount"] for row in tiles),
        "expectedIndexBytes": index_path.stat().st_size,
        "expectedIndexSha256": sha256(index_path),
    }
    declared = {key: contract["derivation"].get(key) for key in measured}
    if measured != declared:
        raise TileError("requested-age tile output differs from the reviewed size/identity contract")
    if manifest_out is not None:
        write_atomic(manifest_out, canonical(staged_manifest(source, index_path)))
    return {
        "tileCount": len(tiles),
        "tileBytes": sum(len(row["payload"]) for row in tiles),
        "index": {"bytes": index_path.stat().st_size, "sha256": sha256(index_path)},
        "records": sum(row["descriptor"]["recordCount"] for row in tiles),
        "descriptors": sum(row["descriptor"]["entryCount"] for row in tiles),
        "manifestOut": str(manifest_out) if manifest_out else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True,
                        help="verified Cao package without requested-age tiles")
    parser.add_argument("--out", type=Path, required=True,
                        help="isolated output directory for index and EHMT tiles")
    parser.add_argument("--manifest-out", type=Path,
                        help="optional staged package manifest with the tile index registered")
    args = parser.parse_args()
    print(json.dumps(emit(args.package, args.out, args.manifest_out), sort_keys=True))


if __name__ == "__main__":
    main()

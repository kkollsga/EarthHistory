#!/usr/bin/env python3
"""Merge coasts (land) + continents (shelf) foundation emits into one layered package."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

from cao_domain import CAO_SOURCE_OLDEST_MA, CAO_SOURCE_YOUNGEST_MA, display_checkpoint_ages_ma

ROOT = Path(__file__).resolve().parents[2]
STAGE = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)
SHELF_COLOR = [0.0431, 0.2863, 0.3922]
LAND_COLOR = [0.45, 0.55, 0.3]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset(path: Path) -> dict:
    return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def read_ehgb(path: Path):
    data = bytearray(path.read_bytes())
    assert data[:4] == b"EHGB"
    _ver, _hdr, verts, tris, *_rest = struct.unpack_from("<HHIIIIII", data, 4)
    return data, verts, tris


def remap_chart_indices(data: bytearray, verts: int, offset: int) -> bytearray:
    # layout: 32 + 12*verts xyz + 4*verts seams + 4*verts charts + 12*tris
    chart_off = 32 + 12 * verts + 4 * verts
    for i in range(verts):
        (value,) = struct.unpack_from("<I", data, chart_off + 4 * i)
        struct.pack_into("<I", data, chart_off + 4 * i, value + offset)
    return data


def load_palette_samples(package: Path):
    meta = json.loads((package / "motion-palette.json").read_text())
    binary = (package / "motion-palette.bin").read_bytes()
    assert binary[:4] == b"EHMP"
    samples = {}
    for entry in meta["entries"]:
        rows = []
        for i in range(entry["sampleCount"]):
            age_u, w, x, y, z = struct.unpack_from(
                "<Iffff", binary, 32 + 20 * (entry["sampleOffset"] + i)
            )
            rows.append((age_u / 1e6, (w, x, y, z)))
        samples[entry["entryId"]] = (entry, rows, meta)
    return meta, samples


def merge_palettes(shelf_pkg: Path, land_pkg: Path, out: Path):
    shelf_meta, shelf_samples = load_palette_samples(shelf_pkg)
    land_meta, land_samples = load_palette_samples(land_pkg)
    merged = {}
    interval_sets = {}
    for source in (shelf_samples, land_samples):
        for entry_id, (entry, rows, meta) in source.items():
            if entry_id in merged:
                continue
            merged[entry_id] = (entry, rows)
            for interval in meta.get("sourceIntervalSets", []):
                if interval["id"] not in interval_sets:
                    interval_sets[interval["id"]] = interval
    # Keep deterministic order: shelf entries first, then land-only.
    order = []
    seen = set()
    for entry_id in list(shelf_samples) + list(land_samples):
        if entry_id not in seen:
            order.append(entry_id)
            seen.add(entry_id)
    records = []
    entries = []
    for entry_id in order:
        entry, rows = merged[entry_id]
        offset = len(records)
        records.extend(rows)
        rewritten = dict(entry)
        rewritten["sampleOffset"] = offset
        rewritten["sampleCount"] = len(rows)
        entries.append(rewritten)
    binary = bytearray(32 + 20 * len(records))
    binary[:4] = b"EHMP"
    struct.pack_into(
        "<HHIIIIII", binary, 4, 2, 20, len(entries), len(records), 32, 0, 0, 0
    )
    for i, (age, q) in enumerate(records):
        struct.pack_into("<Iffff", binary, 32 + 20 * i, round(age * 1e6), *q)
    bin_path = out / "motion-palette.bin"
    bin_path.write_bytes(binary)
    palette = {
        "schemaVersion": 2,
        "id": shelf_meta["id"],
        "packageId": shelf_meta["packageId"],
        "revision": shelf_meta["revision"],
        "frame": shelf_meta["frame"],
        "binary": {
            "bytes": len(binary),
            "sha256": sha(bin_path),
            "timeEncoding": "uint32-micro-ma",
            "quaternionEncoding": "float32-wxyz",
        },
        "entries": entries,
        "sourceIntervalSets": [interval_sets[i] for i in sorted(interval_sets)],
    }
    json_path = out / "motion-palette.json"
    json_path.write_text(json.dumps(palette, separators=(",", ":")) + "\n")
    return palette, asset(json_path), asset(bin_path)


def model_charts(core: dict, prefix: str):
    return [c for c in core["charts"] if c["role"] == "model-geography" and c["chartId"].startswith(prefix)]


def main(shelf_pkg: Path, land_pkg: Path, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for path in out.iterdir():
        if path.is_file():
            path.unlink()

    shelf_core = json.loads((shelf_pkg / "core.json").read_text())
    land_core = json.loads((land_pkg / "core.json").read_text())
    shelf_manifest = json.loads((shelf_pkg / "manifest.json").read_text())
    land_manifest = json.loads((land_pkg / "manifest.json").read_text())
    assert shelf_manifest["frame"] == land_manifest["frame"]

    shelf_charts = model_charts(shelf_core, "cao-continent")
    land_charts = model_charts(land_core, "cao-coast")
    if len(shelf_charts) == 0 or len(land_charts) == 0:
        raise SystemExit("expected continent and coast model-geography charts")

    shelf_data, shelf_verts, shelf_tris = read_ehgb(shelf_pkg / "batch-0.ehgb")
    land_data, land_verts, land_tris = read_ehgb(land_pkg / "batch-0.ehgb")
    land_data = remap_chart_indices(land_data, land_verts, len(shelf_charts))

    shelf_path = out / "batch-shelf.ehgb"
    land_path = out / "batch-land.ehgb"
    shelf_path.write_bytes(shelf_data)
    land_path.write_bytes(land_data)

    palette, palette_catalog, palette_binary = merge_palettes(shelf_pkg, land_pkg, out)

    charts = shelf_charts + land_charts
    core = {
        "schemaVersion": 2,
        "packageId": shelf_core["packageId"],
        "revision": shelf_core["revision"],
        "frame": shelf_core["frame"],
        "charts": charts,
        "spatialBatches": [
            {
                "batchId": "batch-shelf",
                "vertexCount": shelf_verts,
                "triangleCount": shelf_tris,
                "geometryAsset": asset(shelf_path),
                "encoding": "ehgb-v2-f32xyz-u32",
            },
            {
                "batchId": "batch-land",
                "vertexCount": land_verts,
                "triangleCount": land_tris,
                "geometryAsset": asset(land_path),
                "encoding": "ehgb-v2-f32xyz-u32",
            },
        ],
    }
    core_path = out / "core.json"
    core_path.write_text(json.dumps(core, separators=(",", ":")) + "\n")

    ages = display_checkpoint_ages_ma(CAO_SOURCE_OLDEST_MA)
    # Prefer ages from shelf manifest if present and matching schedule.
    shelf_ages = [row["ageMa"] for row in shelf_manifest["checkpoints"]]
    if shelf_ages == ages:
        pass
    elif set(shelf_ages) == set(ages):
        ages = shelf_ages
    checkpoints = []
    for age in ages:
        checkpoint = {
            "schemaVersion": 2,
            "packageId": core["packageId"],
            "revision": core["revision"],
            "frame": core["frame"],
            "ageMa": age,
            "batchControls": [
                {
                    "batchId": "batch-shelf",
                    "vertexCount": shelf_verts,
                    "state": {
                        "kind": "uniform",
                        "displayHeightMetres": 0,
                        "baseColorRgb": SHELF_COLOR,
                    },
                },
                {
                    "batchId": "batch-land",
                    "vertexCount": land_verts,
                    "state": {
                        "kind": "uniform",
                        "displayHeightMetres": 0,
                        "baseColorRgb": LAND_COLOR,
                    },
                },
            ],
        }
        path = out / f"checkpoint-{age:g}ma.json"
        path.write_text(json.dumps(checkpoint, separators=(",", ":")) + "\n")
        checkpoints.append({"ageMa": age, **asset(path)})

    oldest = max(ages)
    youngest = min(ages)
    manifest = {
        "schemaVersion": 2,
        "packageId": core["packageId"],
        "revision": core["revision"],
        "frame": core["frame"],
        "ageDomainMa": {"youngest": float(youngest), "oldest": float(oldest)},
        "core": asset(core_path),
        "motionPalette": {
            "id": palette["id"],
            "catalog": palette_catalog,
            "binary": palette_binary,
        },
        "checkpoints": checkpoints,
        "scope": (
            "native Cao layered coastline-class land over continental-outline shelf "
            f"geometry with strict {int(youngest)}-{int(oldest)} Ma motion support; "
            "surface exposure, relief, and seafloor age remain unknown"
        ),
    }
    # Prefer authored source domain constants when schedule includes them.
    if youngest == CAO_SOURCE_YOUNGEST_MA and oldest == CAO_SOURCE_OLDEST_MA:
        manifest["ageDomainMa"] = {
            "youngest": CAO_SOURCE_YOUNGEST_MA,
            "oldest": CAO_SOURCE_OLDEST_MA,
        }
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    print(
        json.dumps(
            {
                "shelfCharts": len(shelf_charts),
                "landCharts": len(land_charts),
                "paletteEntries": len(palette["entries"]),
                "checkpoints": len(checkpoints),
                "ageDomainMa": manifest["ageDomainMa"],
                "packageBytes": sum(p.stat().st_size for p in out.iterdir() if p.is_file()),
                "coreBytes": core_path.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--shelf",
        type=Path,
        default=STAGE / "layer-continents",
        help="continents foundation package (becomes batch-shelf)",
    )
    parser.add_argument(
        "--land",
        type=Path,
        default=STAGE / "layer-coasts",
        help="coasts foundation package (becomes batch-land)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=STAGE / "full-package",
        help="layered package output directory",
    )
    args = parser.parse_args()
    main(args.shelf, args.land, args.out)

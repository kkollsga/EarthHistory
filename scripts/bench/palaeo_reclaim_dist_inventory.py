#!/usr/bin/env python3
"""Exact dist byte inventory and cheap reclaim options for the palaeo budget.

Phase 1 of ``dev-docs/plans/palaeo-coastlines-polygons.md``; stop rule in
``dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md``. Read-only:
it never writes into ``dist/``, ``public/`` or ``src/``.

Counts raw bytes exactly as ``scripts/check-app-artifacts.py`` does (every
regular non-symlink file under ``dist``), groups them by directory and by asset
class, and measures the demonstrated reclaim for the JSON catalogs that ship
with redundant structure: ``boundary-*.json`` / ``ownership-*.json`` pairs,
``checkpoint-*.json`` and the material-correction ``catalog.json``.

Usage:
    python3 scripts/bench/palaeo_reclaim_dist_inventory.py [--json OUT]
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
PKG = ROOT / "public" / "data" / "reconstruction" / "cao-v2.4"
MIB = 1024 * 1024


def encode(document: object) -> int:
    return len(json.dumps(document, separators=(",", ":")).encode("utf-8")) + 1


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def class_of(relative: str) -> str:
    name = Path(relative).name
    if relative.startswith("assets/"):
        return "js-css-bundle"
    if name.endswith(".ehgb"):
        return "spatial-geometry-ehgb"
    if name.endswith(".ehgl"):
        return "country-line-ehgl"
    if name.endswith(".ehmt"):
        return "motion-tiles-ehmt"
    if name.endswith(".ehnb"):
        return "native-point-ehnb"
    if name.endswith(".ehto"):
        return "ownership-point-ehto"
    if name == "core.json":
        return "core-json"
    if name.startswith("motion-palette"):
        return "motion-palette"
    if name.startswith("boundary-") and name.endswith(".json"):
        return "boundary-catalog-json"
    if name.startswith("ownership-") and name.endswith(".json"):
        return "ownership-catalog-json"
    if name.startswith("checkpoint-"):
        return "checkpoint-json"
    if name == "catalog.json":
        return "corrections-catalog-json"
    if name == "index.json":
        return "motion-tile-index-json"
    if name in ("manifest.json", "anchors.json"):
        return "manifest-anchors-json"
    return "other"


def intern_records(documents: list[tuple[str, dict]], list_key: str,
                   fields: tuple[str, ...]) -> dict:
    """Bytes saved by interning per-record `fields` into a per-file dictionary."""
    before = 0
    after = 0
    distinct_overall: dict[str, set[str]] = {field: set() for field in fields}
    for _, document in documents:
        before += encode(document)
        tables: dict[str, list[object]] = {field: [] for field in fields}
        index: dict[str, dict[str, int]] = {field: {} for field in fields}
        records = []
        for record in document.get(list_key, []):
            copy = dict(record)
            for field in fields:
                if field in copy:
                    key = canonical(copy[field])
                    distinct_overall[field].add(key)
                    if key not in index[field]:
                        index[field][key] = len(tables[field])
                        tables[field].append(copy[field])
                    copy[f"{field}Ref"] = index[field].pop(key) if False else index[field][key]
                    del copy[field]
            records.append(copy)
        reduced = {k: v for k, v in document.items() if k != list_key}
        reduced["dictionaries"] = {field: table for field, table in tables.items() if table}
        reduced[list_key] = records
        after += encode(reduced)
    return {"beforeBytes": before, "afterBytes": after, "savedBytes": before - after,
            "distinctValues": {field: len(values) for field, values in distinct_overall.items()}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    files = sorted(path for path in DIST.rglob("*") if path.is_file() and not path.is_symlink())
    total = sum(path.stat().st_size for path in files)
    by_dir: dict[str, dict] = defaultdict(lambda: {"bytes": 0, "files": 0})
    by_class: dict[str, dict] = defaultdict(lambda: {"bytes": 0, "files": 0})
    largest = []
    for path in files:
        relative = str(path.relative_to(DIST))
        size = path.stat().st_size
        parent = str(path.parent.relative_to(DIST)) or "."
        by_dir[parent]["bytes"] += size
        by_dir[parent]["files"] += 1
        klass = class_of(relative)
        by_class[klass]["bytes"] += size
        by_class[klass]["files"] += 1
        largest.append((size, relative))
    largest.sort(reverse=True)

    # --- cheap reclaim probes on the JSON catalogs (source tree, read-only) ---
    boundary = [(p.name, json.loads(p.read_text())) for p in sorted(PKG.glob("boundary-*.json"))]
    ownership = [(p.name, json.loads(p.read_text())) for p in sorted(PKG.glob("ownership-*.json"))]
    checkpoints = [(p.name, json.loads(p.read_text())) for p in sorted(PKG.glob("checkpoint-*.json"))]
    corrections_path = PKG / "corrections" / "material-v1" / "catalog.json"
    corrections = json.loads(corrections_path.read_text())

    def list_key_of(document: dict) -> str:
        for key in ("boundaries", "segments", "features", "ownership", "records", "entries", "charts"):
            if isinstance(document.get(key), list):
                return key
        lists = [key for key, value in document.items() if isinstance(value, list) and value
                 and isinstance(value[0], dict)]
        return lists[0] if lists else ""

    boundary_key = list_key_of(boundary[0][1]) if boundary else ""
    ownership_key = list_key_of(ownership[0][1]) if ownership else ""

    def record_fields(documents, key, limit=12):
        counts: dict[str, set[str]] = defaultdict(set)
        totals: dict[str, int] = defaultdict(int)
        for _, document in documents:
            for record in document.get(key, []):
                for field, value in record.items():
                    counts[field].add(canonical(value))
                    totals[field] += 1
        return {field: {"distinct": len(values), "occurrences": totals[field]}
                for field, values in sorted(counts.items(), key=lambda item: -totals[item[0]])[:limit]}

    boundary_fields = record_fields(boundary, boundary_key) if boundary_key else {}
    ownership_fields = record_fields(ownership, ownership_key) if ownership_key else {}

    boundary_intern = intern_records(
        boundary, boundary_key,
        tuple(field for field, stats in boundary_fields.items()
              if stats["distinct"] * 12 < stats["occurrences"])) if boundary_key else {}
    ownership_intern = intern_records(
        ownership, ownership_key,
        tuple(field for field, stats in ownership_fields.items()
              if stats["distinct"] * 12 < stats["occurrences"])) if ownership_key else {}

    checkpoint_bytes = sum(encode(document) for _, document in checkpoints)
    corrections_fields = record_fields([("catalog.json", corrections)], "charts")
    corrections_intern = intern_records(
        [("catalog.json", corrections)], "charts",
        ("evidence", "lifecycle", "surfaceEvidence", "motionBindings"))

    result = {
        "measurement": "palaeo-coastlines Phase 1 dist inventory",
        "stopRule": "dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md",
        "distTotalBytes": total,
        "distTotalMiB": round(total / MIB, 4),
        "distFileCount": len(files),
        "distMaxMiB": 50,
        "headroomBytes": 50 * MIB - total,
        "byDirectory": {name: {"bytes": stats["bytes"], "MiB": round(stats["bytes"] / MIB, 4),
                               "files": stats["files"]}
                        for name, stats in sorted(by_dir.items(), key=lambda item: -item[1]["bytes"])},
        "byClass": {name: {"bytes": stats["bytes"], "MiB": round(stats["bytes"] / MIB, 4),
                           "files": stats["files"]}
                    for name, stats in sorted(by_class.items(), key=lambda item: -item[1]["bytes"])},
        "largestFiles": [{"path": name, "bytes": size} for size, name in largest[:15]],
        "catalogProbes": {
            "boundaryListKey": boundary_key,
            "boundaryFieldCardinality": boundary_fields,
            "boundaryIntern": boundary_intern,
            "ownershipListKey": ownership_key,
            "ownershipFieldCardinality": ownership_fields,
            "ownershipIntern": ownership_intern,
            "checkpointReencodedBytes": checkpoint_bytes,
            "checkpointOnDiskBytes": sum(p.stat().st_size for p in PKG.glob("checkpoint-*.json")),
            "correctionsCatalogBytes": corrections_path.stat().st_size,
            "correctionsChartCount": len(corrections.get("charts", [])),
            "correctionsFieldCardinality": corrections_fields,
            "correctionsIntern": corrections_intern,
        },
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

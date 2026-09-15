#!/usr/bin/env python3
"""Measure lossless reclaim in the boundary/ownership/corrections JSON catalogs.

Phase 1 of ``dev-docs/plans/palaeo-coastlines-polygons.md``; stop rule in
``dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md``. Read-only
with respect to ``public/`` and ``src/``.

Each reclaim here is proved reversible: the script re-expands its own reduced
form and compares the result to the shipped catalog with a canonical encoding,
so nothing is scored that has not round-tripped. Two mutations (a corrupt
dictionary reference and a tampered derivable id) must be rejected (R1).

Reclaims measured
  * boundary-*.json (235 files, 19,805 segments)
      - `segmentId` is exactly `"<sourceAgeMa>:<sourceFeatureId>:part:<sourcePart>"`
        for every segment, so it is derivable and need not ship.
      - GPlates UUID strings (`sourceFeatureId`, `rightTopologyId`,
        `leftTopologyId`) and the low-cardinality enums/valid-times intern into
        per-file tables.
  * ownership-*.json (235 files, 3,838 rings)
      - `polygonId` is `"<sourceAgeMa>:<topologyId>"` and `ringId` is
        `"<polygonId>:<ordinal within the polygon>"`; both derivable.
  * corrections/material-v1/catalog.json (212 charts)
      - the same chart interning as core.json.

Usage:
    python3 scripts/bench/palaeo_reclaim_catalogs.py [--json OUT]
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "public" / "data" / "reconstruction" / "cao-v2.4"
MIB = 1024 * 1024

BOUNDARY_STRING_FIELDS = ("sourceFeatureId", "rightTopologyId", "leftTopologyId")
BOUNDARY_DICT_FIELDS = ("validTimeMa", "sourceFeatureType", "kind", "polarity",
                        "ownershipStatus", "sourcePart", "rightPlateId", "leftPlateId")
CHART_DICT_FIELDS = ("evidence", "lifecycle", "surfaceEvidence", "motionBindings")


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def encode(document: object) -> bytes:
    return json.dumps(document, separators=(",", ":")).encode("utf-8") + b"\n"


def age_token(age: float) -> str:
    return f"{age:g}"


def reduce_boundary(catalog: dict) -> dict:
    age = age_token(catalog["sourceAgeMa"])
    strings: dict[str, int] = {}
    tables: dict[str, dict[str, int]] = {field: {} for field in BOUNDARY_DICT_FIELDS}
    values: dict[str, list[object]] = {field: [] for field in BOUNDARY_DICT_FIELDS}
    segments = []
    for segment in catalog["segments"]:
        expected = f"{age}:{segment['sourceFeatureId']}:part:{segment['sourcePart']}"
        if segment["segmentId"] != expected:
            raise ValueError(f"segmentId is not derivable: {segment['segmentId']}")
        record = dict(segment)
        del record["segmentId"]
        for field in BOUNDARY_STRING_FIELDS:
            value = record.pop(field)
            if value is not None:
                strings.setdefault(value, len(strings))
                record[f"{field}Ref"] = strings[value]
            else:
                record[f"{field}Ref"] = None
        for field in BOUNDARY_DICT_FIELDS:
            if field not in record:
                continue
            key = canonical(record[field])
            if key not in tables[field]:
                tables[field][key] = len(values[field])
                values[field].append(record[field])
            record[f"{field}Ref"] = tables[field][key]
            del record[field]
        segments.append(record)
    reduced = {key: value for key, value in catalog.items() if key != "segments"}
    reduced["segmentIdEncoding"] = "age-sourceFeatureId-part-v1"
    reduced["strings"] = list(strings)
    reduced["dictionaries"] = {field: values[field] for field in BOUNDARY_DICT_FIELDS if values[field]}
    reduced["segments"] = segments
    return reduced


def expand_boundary(reduced: dict) -> dict:
    age = age_token(reduced["sourceAgeMa"])
    strings: list[str] = reduced["strings"]
    dictionaries: dict[str, list[object]] = reduced.get("dictionaries", {})
    segments = []
    for record in reduced["segments"]:
        segment = dict(record)
        for field in BOUNDARY_STRING_FIELDS:
            index = segment.pop(f"{field}Ref")
            if index is None:
                segment[field] = None
                continue
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(strings):
                raise ValueError(f"boundary string reference out of range: {field}[{index!r}]")
            segment[field] = strings[index]
        for field, table in dictionaries.items():
            key = f"{field}Ref"
            if key in segment:
                index = segment.pop(key)
                if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(table):
                    raise ValueError(f"boundary dictionary reference out of range: {field}[{index!r}]")
                segment[field] = copy.deepcopy(table[index])
        segment["segmentId"] = f"{age}:{segment['sourceFeatureId']}:part:{segment['sourcePart']}"
        segments.append(segment)
    catalog = {key: value for key, value in reduced.items()
               if key not in ("segments", "strings", "dictionaries", "segmentIdEncoding")}
    catalog["segments"] = segments
    return catalog


def reduce_ownership(catalog: dict) -> dict:
    age = age_token(catalog["sourceAgeMa"])
    ordinals: dict[str, int] = {}
    rings = []
    for ring in catalog["rings"]:
        polygon = f"{age}:{ring['topologyId']}"
        if ring["polygonId"] != polygon:
            raise ValueError(f"polygonId is not derivable: {ring['polygonId']}")
        ordinal = ordinals.get(polygon, 0)
        ordinals[polygon] = ordinal + 1
        if ring["ringId"] != f"{polygon}:{ordinal}":
            raise ValueError(f"ringId is not derivable: {ring['ringId']}")
        record = dict(ring)
        del record["ringId"]
        del record["polygonId"]
        rings.append(record)
    reduced = {key: value for key, value in catalog.items() if key != "rings"}
    reduced["ringIdEncoding"] = "age-topologyId-ordinal-v1"
    reduced["rings"] = rings
    return reduced


def expand_ownership(reduced: dict) -> dict:
    age = age_token(reduced["sourceAgeMa"])
    ordinals: dict[str, int] = {}
    rings = []
    for record in reduced["rings"]:
        ring = dict(record)
        polygon = f"{age}:{ring['topologyId']}"
        ordinal = ordinals.get(polygon, 0)
        ordinals[polygon] = ordinal + 1
        ring["polygonId"] = polygon
        ring["ringId"] = f"{polygon}:{ordinal}"
        rings.append({key: ring[key] for key in ("ringId", "polygonId", *record.keys())})
    catalog = {key: value for key, value in reduced.items() if key not in ("rings", "ringIdEncoding")}
    catalog["rings"] = rings
    return catalog


def reduce_charts(catalog: dict) -> dict:
    tables: dict[str, dict[str, int]] = {field: {} for field in CHART_DICT_FIELDS}
    values: dict[str, list[object]] = {field: [] for field in CHART_DICT_FIELDS}
    charts = []
    for chart in catalog["charts"]:
        record = dict(chart)
        for field in CHART_DICT_FIELDS:
            if field not in record:
                continue
            key = canonical(record[field])
            if key not in tables[field]:
                tables[field][key] = len(values[field])
                values[field].append(record[field])
            record[f"{field}Ref"] = tables[field][key]
            del record[field]
        for field in ("fragmentOrCohortId", "materialId"):
            if record.get(field) == record.get("chartId"):
                record[f"{field}IsChartId"] = True
                del record[field]
        charts.append(record)
    reduced = {key: value for key, value in catalog.items() if key != "charts"}
    reduced["chartDictionaries"] = {field: values[field] for field in CHART_DICT_FIELDS if values[field]}
    reduced["chartIdCollapse"] = "v1"
    reduced["charts"] = charts
    return reduced


def expand_charts(reduced: dict) -> dict:
    dictionaries = reduced.get("chartDictionaries", {})
    charts = []
    for record in reduced["charts"]:
        chart = dict(record)
        for field, table in dictionaries.items():
            key = f"{field}Ref"
            if key in chart:
                index = chart.pop(key)
                if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(table):
                    raise ValueError(f"chart dictionary reference out of range: {field}[{index!r}]")
                chart[field] = copy.deepcopy(table[index])
        for field in ("fragmentOrCohortId", "materialId"):
            if chart.pop(f"{field}IsChartId", False):
                chart[field] = chart["chartId"]
        charts.append(chart)
    catalog = {key: value for key, value in reduced.items()
               if key not in ("charts", "chartDictionaries", "chartIdCollapse")}
    catalog["charts"] = charts
    return catalog


def measure(paths: list[Path], reduce, expand, label: str) -> dict:
    before = 0
    after = 0
    round_tripped = 0
    failures: list[str] = []
    for path in paths:
        original = json.loads(path.read_text())
        before += path.stat().st_size
        reduced = reduce(original)
        after += len(encode(reduced))
        restored = expand(json.loads(encode(reduced)))
        if canonical(restored) == canonical(original):
            round_tripped += 1
        else:
            failures.append(path.name)
    return {"item": label, "files": len(paths), "beforeBytes": before, "afterBytes": after,
            "savedBytes": before - after, "savedMiB": round((before - after) / MIB, 4),
            "roundTrippedFiles": round_tripped, "roundTripFailures": failures[:5],
            "lossless": round_tripped == len(paths)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    boundary_paths = sorted(PKG.glob("boundary-*.json"))
    ownership_paths = sorted(PKG.glob("ownership-*.json"))
    checkpoint_paths = sorted(PKG.glob("checkpoint-*.json"))
    corrections_path = PKG / "corrections" / "material-v1" / "catalog.json"

    results = [
        measure(boundary_paths, reduce_boundary, expand_boundary, "boundary-*.json"),
        measure(ownership_paths, reduce_ownership, expand_ownership, "ownership-*.json"),
        measure([corrections_path], reduce_charts, expand_charts, "corrections/material-v1/catalog.json"),
    ]

    # R1 mutations on the boundary reclaim: both must be rejected or detected.
    sample = json.loads(boundary_paths[0].read_text())
    reduced = reduce_boundary(sample)
    corrupt = json.loads(encode(reduced))
    corrupt["segments"][0]["kindRef"] = len(corrupt["dictionaries"]["kind"])
    try:
        expand_boundary(corrupt)
        corrupt_rejected = False
    except ValueError:
        corrupt_rejected = True
    tampered = json.loads(encode(reduced))
    tampered["segments"][0]["sourcePartRef"] = (tampered["segments"][0]["sourcePartRef"] + 1) \
        % len(tampered["dictionaries"]["sourcePart"])
    tamper_detected = canonical(expand_boundary(tampered)) != canonical(sample)
    restored_ok = canonical(expand_boundary(json.loads(encode(reduced)))) == canonical(sample)

    checkpoint_bytes = sum(path.stat().st_size for path in checkpoint_paths)
    total_saved = sum(record["savedBytes"] for record in results if record["lossless"])

    result = {
        "measurement": "palaeo-coastlines Phase 1 JSON catalog reclaim",
        "stopRule": "dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md",
        "items": results,
        "checkpointJson": {"files": len(checkpoint_paths), "bytes": checkpoint_bytes,
                           "note": "235 files, 1,316 bytes each on average; already minified and "
                                   "non-repetitive. No reclaim worth a format change."},
        "mutations": {"corruptDictionaryReferenceRejected": corrupt_rejected,
                      "tamperedDerivableReferenceDetected": tamper_detected,
                      "restoredRoundTrips": restored_ok},
        "totalLosslessSavedBytes": total_saved,
        "totalLosslessSavedMiB": round(total_saved / MIB, 4),
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text)
    print(text)
    return 0 if all(record["lossless"] for record in results) and corrupt_rejected \
        and tamper_detected and restored_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

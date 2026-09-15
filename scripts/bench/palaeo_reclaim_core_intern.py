#!/usr/bin/env python3
"""Measure exact recoverable bytes in the Cao v2.4 ``core.json`` by interning.

Phase 1 of ``dev-docs/plans/palaeo-coastlines-polygons.md``; the stop rule is
``dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md`` (written
first). Measurement only: this script never writes into ``public/`` or ``src/``.

It builds cumulative variants of ``core.json``, records their exact byte
lengths, writes the fully interned candidate to
``dev-docs/temp/palaeo-coastlines/core.interned.json``, and proves that a
decoder recovers deep-equal chart objects for every chart. A deliberate
corrupt-index mutation must be rejected by the decoder (R1).

Usage:
    python3 scripts/bench/palaeo_reclaim_core_intern.py [--json OUT]
"""

from __future__ import annotations

import argparse
import copy
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "public" / "data" / "reconstruction" / "cao-v2.4" / "core.json"
TEMP = ROOT / "dev-docs" / "temp" / "palaeo-coastlines"

# Chart fields interned into top-level dictionaries. Each becomes "<name>Ref".
# `evidenceLimitations` is the nested `evidence.limitations` array.
DICT_FIELDS = ("lifecycle", "surfaceEvidence", "motionBindings")
EVIDENCE_DICT_FIELDS = ("limitations", "sourceIds")


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def encode(document: object) -> bytes:
    """Byte-for-byte the emitters' own encoding (see emit_cao_foundation_package.py)."""
    return json.dumps(document, separators=(",", ":")).encode("utf-8") + b"\n"


class Interner:
    def __init__(self) -> None:
        self.values: list[object] = []
        self._index: dict[str, int] = {}

    def ref(self, value: object) -> int:
        key = canonical(value)
        if key not in self._index:
            self._index[key] = len(self.values)
            self.values.append(value)
        return self._index[key]


def intern_core(core: dict, *, fields: tuple[str, ...], evidence_fields: tuple[str, ...],
                collapse_ids: bool) -> dict:
    """Produce the interned candidate. Pure function of `core`; `core` is untouched."""
    out = {key: value for key, value in core.items() if key != "charts"}
    dictionaries: dict[str, list[object]] = {}
    interners = {name: Interner() for name in fields}
    evidence_interners = {name: Interner() for name in evidence_fields}
    charts: list[dict] = []
    for chart in core["charts"]:
        record = dict(chart)
        for name in fields:
            if name in record:
                record[f"{name}Ref"] = interners[name].ref(record.pop(name))
        if evidence_fields and "evidence" in record:
            evidence = dict(record["evidence"])
            for name in evidence_fields:
                if name in evidence:
                    evidence[f"{name}Ref"] = evidence_interners[name].ref(evidence.pop(name))
            record["evidence"] = evidence
        if collapse_ids:
            # `fragmentOrCohortId`/`materialId` equal to `chartId` are implied.
            for name in ("fragmentOrCohortId", "materialId"):
                if record.get(name) == record.get("chartId"):
                    record[f"{name}IsChartId"] = True
                    record.pop(name)
        charts.append(record)
    for name in fields:
        dictionaries[name] = interners[name].values
    for name in evidence_fields:
        dictionaries[f"evidence.{name}"] = evidence_interners[name].values
    if dictionaries:
        out["chartDictionaries"] = dictionaries
    out["charts"] = charts
    if collapse_ids:
        out["chartIdCollapse"] = "v1"
    return out


def decode_core(interned: dict) -> dict:
    """The decoder loaderV2.ts would need. Rejects any out-of-range reference."""
    dictionaries = interned.get("chartDictionaries", {})
    collapse = interned.get("chartIdCollapse") == "v1"
    out = {key: value for key, value in interned.items()
           if key not in ("charts", "chartDictionaries", "chartIdCollapse")}
    charts: list[dict] = []
    for record in interned["charts"]:
        chart = dict(record)
        for name, table in dictionaries.items():
            if name.startswith("evidence."):
                continue
            key = f"{name}Ref"
            if key in chart:
                index = chart.pop(key)
                if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(table):
                    raise ValueError(f"chart dictionary reference out of range: {name}[{index!r}]")
                chart[name] = copy.deepcopy(table[index])
        if "evidence" in chart:
            evidence = dict(chart["evidence"])
            for name, table in dictionaries.items():
                if not name.startswith("evidence."):
                    continue
                field = name.split(".", 1)[1]
                key = f"{field}Ref"
                if key in evidence:
                    index = evidence.pop(key)
                    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(table):
                        raise ValueError(f"evidence dictionary reference out of range: {name}[{index!r}]")
                    evidence[field] = copy.deepcopy(table[index])
            chart["evidence"] = evidence
        if collapse:
            for name in ("fragmentOrCohortId", "materialId"):
                if chart.pop(f"{name}IsChartId", False):
                    chart[name] = chart["chartId"]
        charts.append(chart)
    out["charts"] = charts
    return out


def columnar_estimate(core: dict) -> dict:
    """Bytes for a binary EHCC-style columnar chart table plus a residual JSON catalog.

    Columns that are pure dictionary references become uint16/uint32 arrays; the
    dictionaries themselves and every free-form string stay in a small JSON
    sidecar. This is an estimate of a *format change*, not a demonstrated file.
    """
    charts = core["charts"]
    count = len(charts)
    tables = {name: Interner() for name in
              ("lifecycle", "surfaceEvidence", "motionBindings", "kind", "role",
               "chartRevision", "sourceFeatureTypes", "geometryReferenceAgeMa")}
    evidence_tables = {name: Interner() for name in ("limitations", "sourceIds", "status")}
    for chart in charts:
        for name, interner in tables.items():
            interner.ref(chart.get(name))
        evidence = chart.get("evidence", {})
        for name, interner in evidence_tables.items():
            interner.ref(evidence.get(name))
    column_bytes = 0
    widths: dict[str, int] = {}
    for name, interner in list(tables.items()) + [(f"evidence.{k}", v) for k, v in evidence_tables.items()]:
        width = 1 if len(interner.values) <= 0xFF else (2 if len(interner.values) <= 0xFFFF else 4)
        widths[name] = width
        column_bytes += width * count
    # Identity flags for fragmentOrCohortId/materialId: 1 byte of bit flags per chart.
    column_bytes += count
    # chartId and any non-collapsed id strings stay textual; sourceFeatureIds too.
    residual: dict[str, object] = {
        "chartIds": [chart["chartId"] for chart in charts],
        "fragmentOrCohortIds": [chart["fragmentOrCohortId"] for chart in charts
                                if chart.get("fragmentOrCohortId") != chart.get("chartId")],
        "materialIds": [chart["materialId"] for chart in charts
                        if chart.get("materialId") != chart.get("chartId")],
        "sourceFeatureIds": [chart["sourceFeatureIds"] for chart in charts],
        "motionSupportGaps": {str(index): chart["motionSupportGaps"]
                              for index, chart in enumerate(charts) if "motionSupportGaps" in chart},
        "dictionaries": {name: interner.values for name, interner in tables.items()}
        | {f"evidence.{name}": interner.values for name, interner in evidence_tables.items()},
    }
    residual_bytes = len(encode(residual))
    header_bytes = 32 + struct.calcsize("<I") * len(widths)
    non_chart = {key: value for key, value in core.items() if key != "charts"}
    return {
        "chartColumnBytes": column_bytes + header_bytes,
        "residualJsonBytes": residual_bytes,
        "nonChartJsonBytes": len(encode(non_chart)),
        "totalBytes": column_bytes + header_bytes + residual_bytes + len(encode(non_chart)),
        "columnWidths": widths,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=None)
    parser.add_argument("--emit-sourceids-variant", action="store_true",
                        help="also write the larger evidence.sourceIds variant (2.8 MiB); off by "
                             "default to keep dev-docs/temp inside DEV_DOCS_MAX_MB (R4)")
    args = parser.parse_args()

    raw = CORE.read_bytes()
    core = json.loads(raw)
    charts = core["charts"]

    # (c) Minification. The emitters already use separators=(",",":"); prove it.
    reencoded = encode(core)
    minify_saving = len(raw) - len(reencoded)

    variants: list[dict] = []

    def measure(label: str, document: dict, note: str) -> dict:
        size = len(encode(document))
        record = {"variant": label, "bytes": size, "savedBytes": len(raw) - size,
                  "savedMiB": round((len(raw) - size) / (1024 * 1024), 4), "note": note}
        variants.append(record)
        return record

    measure("v0-current", core, "as shipped")
    measure("a1-limitations", intern_core(core, fields=(), evidence_fields=("limitations",),
                                          collapse_ids=False),
            "intern evidence.limitations only (13 distinct)")
    measure("a2-surfaceEvidence", intern_core(core, fields=("surfaceEvidence",),
                                              evidence_fields=("limitations",), collapse_ids=False),
            "+ surfaceEvidence (7 distinct)")
    measure("a3-lifecycle", intern_core(core, fields=("surfaceEvidence", "lifecycle"),
                                        evidence_fields=("limitations",), collapse_ids=False),
            "+ lifecycle (183 distinct)")
    measure("a4-motionBindings", intern_core(core, fields=DICT_FIELDS,
                                             evidence_fields=("limitations",), collapse_ids=False),
            "+ motionBindings (938 distinct) = task item (a)")
    measure("b-collapse-id-triples", intern_core(core, fields=DICT_FIELDS,
                                                 evidence_fields=("limitations",), collapse_ids=True),
            "(a) + collapse identical chartId/fragmentOrCohortId/materialId = task item (b)")
    full = intern_core(core, fields=DICT_FIELDS, evidence_fields=EVIDENCE_DICT_FIELDS, collapse_ids=True)
    measure("b+sourceIds", full, "(a)+(b) plus evidence.sourceIds (848 distinct), beyond the task list")

    # Round-trip proof on the recommended candidate (a)+(b).
    candidate = intern_core(core, fields=DICT_FIELDS, evidence_fields=("limitations",), collapse_ids=True)
    decoded = decode_core(json.loads(encode(candidate)))
    mismatches = [index for index, (left, right) in enumerate(zip(charts, decoded["charts"]))
                  if canonical(left) != canonical(right)]
    round_trip = {
        "chartCount": len(charts),
        "decodedChartCount": len(decoded["charts"]),
        "deepEqualCharts": len(charts) - len(mismatches),
        "mismatchIndices": mismatches[:10],
        "nonChartKeysEqual": canonical({k: v for k, v in core.items() if k != "charts"})
                             == canonical({k: v for k, v in decoded.items() if k != "charts"}),
        "wholeDocumentEqual": canonical(core) == canonical(decoded),
    }

    # R1: a deliberate corrupt reference must be rejected, then restored.
    mutated = json.loads(encode(candidate))
    mutated["charts"][0]["lifecycleRef"] = len(mutated["chartDictionaries"]["lifecycle"])
    try:
        decode_core(mutated)
        mutation_rejected = False
    except ValueError:
        mutation_rejected = True
    mutated["charts"][0]["lifecycleRef"] = candidate["charts"][0]["lifecycleRef"]
    restored_ok = canonical(decode_core(mutated)["charts"][0]) == canonical(charts[0])

    TEMP.mkdir(parents=True, exist_ok=True)
    interned_path = TEMP / "core.interned.json"
    interned_path.write_bytes(encode(candidate))
    full_path = TEMP / "core.interned-with-sourceids.json"
    if args.emit_sourceids_variant:
        full_path.write_bytes(encode(full))

    result = {
        "measurement": "palaeo-coastlines Phase 1 core.json interning",
        "stopRule": "dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md",
        "source": str(CORE.relative_to(ROOT)),
        "currentBytes": len(raw),
        "currentMiB": round(len(raw) / (1024 * 1024), 4),
        "chartCount": len(charts),
        "minification": {
            "alreadyMinified": minify_saving == 0,
            "savedBytes": minify_saving,
            "evidence": "emit_cao_foundation_package.py and merge_cao_layered_package.py "
                        "write json.dumps(separators=(',',':')) + '\\n'",
        },
        "variants": variants,
        "recommendedCandidate": "b-collapse-id-triples",
        "roundTrip": round_trip,
        "mutation": {"corruptLifecycleRefRejected": mutation_rejected, "restoredDecodes": restored_ok},
        "columnarEstimate": columnar_estimate(core),
        "artifacts": {
            "interned": str(interned_path.relative_to(ROOT)),
            "internedWithSourceIds": str(full_path.relative_to(ROOT))
                                     if args.emit_sourceids_variant else "not emitted (--emit-sourceids-variant)",
        },
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text)
    print(text)
    return 0 if round_trip["wholeDocumentEqual"] and mutation_rejected and restored_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

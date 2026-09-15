#!/usr/bin/env python3
"""Lossless interning codec for the shipped Cao v2.4 package JSON.

The shipped package repeats a small number of distinct values across thousands
of records. ``core.json`` carries 4,995 charts that share 13 distinct
``evidence.limitations`` arrays, 7 ``surfaceEvidence`` objects, 183
``lifecycle`` objects and 938 ``motionBindings`` arrays, and 3,799 of them
repeat one identifier three times. The native layer catalogs repeat GPlates
UUID strings and rebuild ``segmentId``/``polygonId``/``ringId`` out of fields
that already ship beside them.

This module is the single authority for that encoding. It is *not* a
compression scheme: every value, source id, citation, limitation string,
lifecycle bound and digest survives, and ``expand`` of an interned document is
deep-equal to the document that was interned (proved by ``--self-test`` against
the shipped package, and by the measurement in
``dev-docs/bench/results/palaeo-coastlines-reclaim-measurement.json``).

Encodings
  * ``interned charts`` (``core.json``, ``corrections/material-v1/catalog.json``)
    ``chartDictionaries`` maps a chart field name to its distinct values in
    first-appearance order, and ``chartColumns`` maps the same name to one
    reference per chart, in chart order. A dotted name such as
    ``evidence.limitations`` addresses a field of the chart's ``evidence``
    object. Only a field every chart carries becomes a column, so a column is
    always dense and exactly as long as ``charts``; a field some charts lack
    stays written out in the chart. With ``chartIdCollapse: "v1"`` a chart
    whose ``fragmentOrCohortId``/``materialId`` equals its ``chartId`` ships
    ``fragmentOrCohortIdIsChartId``/``materialIdIsChartId`` instead. The
    columns are what make the encoding pay: the per-chart key names
    (``"sourceFeatureTypesRef":0,`` and its twelve siblings) cost more than the
    references they introduce.
  * ``segmentIdEncoding: "age-sourceFeatureId-part-v1"`` (``boundary-*.json``)
    ``segmentId`` is rebuilt as ``<sourceAgeMa>:<sourceFeatureId>:part:<sourcePart>``;
    the three GPlates UUID fields index a per-file ``strings`` table and the
    low-cardinality fields index per-file ``dictionaries``.
  * ``ringIdEncoding: "age-topologyId-ordinal-v1"`` (``ownership-*.json``)
    ``polygonId`` is ``<sourceAgeMa>:<topologyId>`` and ``ringId`` appends the
    ring's ordinal within its polygon. Rings of one polygon must be
    contiguous, which is what makes the ordinal recoverable.

The runtime decoder is ``src/reconstruction/packageIntern.ts`` and must stay in
step with this file; ``cao_package_intern.py --self-test`` and
``src/reconstruction/packageIntern.test.ts`` are the two halves of that gate.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"

#: Chart fields interned in ``core.json``, in emission order. Every one of them
#: repeats: the 4,995 charts carry 183 distinct lifecycles, 938 motion-binding
#: arrays, 848 source-id lists, 1,985 source-feature-id lists, 14 feature-type
#: lists, 13 limitation arrays, 7 surface-evidence objects, 5 chart revisions,
#: 3 roles and one each of ``kind`` and ``geometryReferenceAgeMa``.
#: ``motionSupportGaps`` is deliberately absent: only 4 charts carry it, so it
#: cannot be a dense column and is cheaper written out.
CORE_CHART_FIELDS = ("lifecycle", "surfaceEvidence", "motionBindings", "evidence.limitations",
                     "evidence.sourceIds", "evidence.status", "sourceFeatureIds",
                     "sourceFeatureTypes", "kind", "role", "chartRevision",
                     "geometryReferenceAgeMa")
#: Chart fields interned in the material-correction catalog. The catalog's 212
#: charts repeat whole ``evidence`` objects, so the object is interned entire
#: and its parts are not interned separately.
CORRECTION_CHART_FIELDS = ("lifecycle", "surfaceEvidence", "motionBindings", "evidence",
                           "sourceFeatureIds", "sourceFeatureTypes", "kind", "role",
                           "chartRevision", "geometryReferenceAgeMa")
#: Identifier fields implied by ``chartId`` under ``chartIdCollapse: "v1"``.
COLLAPSED_ID_FIELDS = ("fragmentOrCohortId", "materialId")

BOUNDARY_STRING_FIELDS = ("sourceFeatureId", "rightTopologyId", "leftTopologyId")
BOUNDARY_DICT_FIELDS = ("validTimeMa", "sourceFeatureType", "kind", "polarity",
                        "ownershipStatus", "sourcePart", "rightPlateId", "leftPlateId")
SEGMENT_ID_ENCODING = "age-sourceFeatureId-part-v1"
RING_ID_ENCODING = "age-topologyId-ordinal-v1"


class InterningError(ValueError):
    """A document cannot be interned losslessly, or an interned document is invalid."""


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def age_token(age: float) -> str:
    """The identifier spelling of a source age, matching the shipped catalogs."""
    if not isinstance(age, (int, float)) or isinstance(age, bool):
        raise InterningError(f"invalid source age: {age!r}")
    return f"{age:g}"


class _Interner:
    def __init__(self) -> None:
        self.values: list[object] = []
        self._index: dict[str, int] = {}

    def ref(self, value: object) -> int:
        key = canonical(value)
        if key not in self._index:
            self._index[key] = len(self.values)
            self.values.append(value)
        return self._index[key]


def _reference(index: object, table: list, label: str) -> None:
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(table):
        raise InterningError(f"dictionary reference out of range: {label}[{index!r}]")


# --------------------------------------------------------------------------- charts


def _carries(chart: dict, name: str) -> bool:
    """Whether one chart holds the named field, plain or dotted."""
    if "." not in name:
        return name in chart
    parent, field = name.split(".", 1)
    return isinstance(chart.get(parent), dict) and field in chart[parent]


def _take(record: dict, name: str) -> object:
    """Remove the named field from a chart record and return its value."""
    if "." not in name:
        return record.pop(name)
    parent, field = name.split(".", 1)
    nested = dict(record[parent])
    value = nested.pop(field)
    record[parent] = nested
    return value


def intern_charts(document: dict, fields: tuple[str, ...] = CORE_CHART_FIELDS) -> dict:
    """Return an interned copy of a document with a ``charts`` array."""
    charts_in = document["charts"]
    columnar = [name for name in fields
                if all(_carries(chart, name) for chart in charts_in)]
    interners = {name: _Interner() for name in columnar}
    columns: dict[str, list[int]] = {name: [] for name in columnar}
    charts: list[dict] = []
    for chart in charts_in:
        record = dict(chart)
        for name in columnar:
            columns[name].append(interners[name].ref(_take(record, name)))
        for name in COLLAPSED_ID_FIELDS:
            if record.get(name) == record.get("chartId"):
                record[f"{name}IsChartId"] = True
                record.pop(name)
        charts.append(record)
    result = {key: value for key, value in document.items() if key != "charts"}
    result["chartDictionaries"] = {name: interners[name].values for name in columnar}
    result["chartColumns"] = columns
    result["chartIdCollapse"] = "v1"
    result["charts"] = charts
    return result


def expand_charts(document: dict) -> dict:
    """Restore the chart objects an interned document encodes."""
    dictionaries = document.get("chartDictionaries", {})
    columns = document.get("chartColumns", {})
    collapse = document.get("chartIdCollapse") == "v1"
    records = document["charts"]
    for name, column in columns.items():
        if name not in dictionaries:
            raise InterningError(f"chart column {name} has no dictionary")
        if not isinstance(column, list) or len(column) != len(records):
            raise InterningError(f"chart column {name} does not span the charts")
    charts: list[dict] = []
    for position, record in enumerate(records):
        chart = dict(record)
        for name, column in columns.items():
            table = dictionaries[name]
            index = column[position]
            _reference(index, table, name)
            value = copy.deepcopy(table[index])
            if "." in name:
                parent, field = name.split(".", 1)
                nested = dict(chart.get(parent) or {})
                nested[field] = value
                chart[parent] = nested
            else:
                chart[name] = value
        if collapse:
            for name in COLLAPSED_ID_FIELDS:
                if chart.pop(f"{name}IsChartId", False):
                    chart[name] = chart["chartId"]
        charts.append(chart)
    result = {key: value for key, value in document.items()
              if key not in ("charts", "chartDictionaries", "chartColumns", "chartIdCollapse")}
    result["charts"] = charts
    return result


# ------------------------------------------------------------------------ boundary


def intern_boundary(catalog: dict) -> dict:
    age = age_token(catalog["sourceAgeMa"])
    strings: dict[str, int] = {}
    tables: dict[str, _Interner] = {field: _Interner() for field in BOUNDARY_DICT_FIELDS}
    segments = []
    for segment in catalog["segments"]:
        expected = f"{age}:{segment['sourceFeatureId']}:part:{segment['sourcePart']}"
        if segment["segmentId"] != expected:
            raise InterningError(f"segmentId is not derivable: {segment['segmentId']!r}")
        record = dict(segment)
        del record["segmentId"]
        for field in BOUNDARY_STRING_FIELDS:
            value = record.pop(field)
            if value is None:
                record[f"{field}Ref"] = None
            else:
                strings.setdefault(value, len(strings))
                record[f"{field}Ref"] = strings[value]
        for field in BOUNDARY_DICT_FIELDS:
            if field in record:
                record[f"{field}Ref"] = tables[field].ref(record.pop(field))
        segments.append(record)
    result = {key: value for key, value in catalog.items() if key != "segments"}
    result["segmentIdEncoding"] = SEGMENT_ID_ENCODING
    result["strings"] = list(strings)
    result["dictionaries"] = {field: tables[field].values for field in BOUNDARY_DICT_FIELDS
                              if tables[field].values}
    result["segments"] = segments
    return result


def expand_boundary(document: dict) -> dict:
    if document.get("segmentIdEncoding") != SEGMENT_ID_ENCODING:
        raise InterningError("unknown boundary segment id encoding")
    age = age_token(document["sourceAgeMa"])
    strings = document["strings"]
    dictionaries = document.get("dictionaries", {})
    segments = []
    for record in document["segments"]:
        segment = dict(record)
        for field in BOUNDARY_STRING_FIELDS:
            index = segment.pop(f"{field}Ref")
            if index is None:
                segment[field] = None
                continue
            _reference(index, strings, field)
            segment[field] = strings[index]
        for field, table in dictionaries.items():
            if f"{field}Ref" in segment:
                index = segment.pop(f"{field}Ref")
                _reference(index, table, field)
                segment[field] = copy.deepcopy(table[index])
        segment["segmentId"] = f"{age}:{segment['sourceFeatureId']}:part:{segment['sourcePart']}"
        segments.append(segment)
    result = {key: value for key, value in document.items()
              if key not in ("segments", "strings", "dictionaries", "segmentIdEncoding")}
    result["segments"] = segments
    return result


# ----------------------------------------------------------------------- ownership


def intern_ownership(catalog: dict) -> dict:
    age = age_token(catalog["sourceAgeMa"])
    ordinals: dict[str, int] = {}
    closed: set[str] = set()
    current: str | None = None
    rings = []
    for ring in catalog["rings"]:
        polygon = f"{age}:{ring['topologyId']}"
        if ring["polygonId"] != polygon:
            raise InterningError(f"polygonId is not derivable: {ring['polygonId']!r}")
        if polygon != current:
            if polygon in closed:
                raise InterningError(f"polygon rings are not contiguous: {polygon!r}")
            if current is not None:
                closed.add(current)
            current = polygon
        ordinal = ordinals.get(polygon, 0)
        ordinals[polygon] = ordinal + 1
        if ring["ringId"] != f"{polygon}:{ordinal}":
            raise InterningError(f"ringId is not derivable: {ring['ringId']!r}")
        record = dict(ring)
        del record["ringId"]
        del record["polygonId"]
        rings.append(record)
    result = {key: value for key, value in catalog.items() if key != "rings"}
    result["ringIdEncoding"] = RING_ID_ENCODING
    result["rings"] = rings
    return result


def expand_ownership(document: dict) -> dict:
    if document.get("ringIdEncoding") != RING_ID_ENCODING:
        raise InterningError("unknown ownership ring id encoding")
    age = age_token(document["sourceAgeMa"])
    ordinals: dict[str, int] = {}
    closed: set[str] = set()
    current: str | None = None
    rings = []
    for record in document["rings"]:
        polygon = f"{age}:{record['topologyId']}"
        if polygon != current:
            if polygon in closed:
                raise InterningError(f"polygon rings are not contiguous: {polygon!r}")
            if current is not None:
                closed.add(current)
            current = polygon
        ordinal = ordinals.get(polygon, 0)
        ordinals[polygon] = ordinal + 1
        rings.append({"ringId": f"{polygon}:{ordinal}", "polygonId": polygon, **record})
    result = {key: value for key, value in document.items()
              if key not in ("rings", "ringIdEncoding")}
    result["rings"] = rings
    return result


# ------------------------------------------------------------------------ dispatch


def is_interned(document: object) -> bool:
    return isinstance(document, dict) and (
        "chartDictionaries" in document
        or document.get("segmentIdEncoding") is not None
        or document.get("ringIdEncoding") is not None
    )


def expand_package_document(document: object) -> object:
    """Expand any interned Cao package document; other documents pass through."""
    if not isinstance(document, dict):
        return document
    if "chartDictionaries" in document:
        return expand_charts(document)
    if document.get("segmentIdEncoding") is not None:
        return expand_boundary(document)
    if document.get("ringIdEncoding") is not None:
        return expand_ownership(document)
    return document


def read_package_json(path: Path) -> dict:
    """Read a package JSON file in either the interned or the expanded form."""
    return expand_package_document(json.loads(Path(path).read_text()))


# ----------------------------------------------------------------------- self-test


def _round_trip(label: str, original: dict, interned: dict, expand) -> int:
    restored = expand(json.loads(json.dumps(interned)))
    if canonical(restored) != canonical(original):
        raise InterningError(f"{label}: interned form does not round-trip")
    return len(json.dumps(interned, sort_keys=True, separators=(",", ":")).encode()) + 1


def _rejects(label: str, expand, document: dict) -> None:
    try:
        expand(document)
    except InterningError:
        return
    raise InterningError(f"self-test: {label} was accepted")


def self_test(package: Path) -> dict:
    """Round-trip every shipped catalog and prove the decoder rejects mutations."""
    report: dict[str, object] = {}
    core_path = package / "core.json"
    if core_path.is_file():
        original = expand_package_document(json.loads(core_path.read_text()))
        interned = intern_charts(original, CORE_CHART_FIELDS)
        report["coreBytes"] = _round_trip("core.json", original, interned, expand_charts)
        report["coreCharts"] = len(original["charts"])
        corrupt = json.loads(json.dumps(interned))
        corrupt["chartColumns"]["lifecycle"][0] = len(corrupt["chartDictionaries"]["lifecycle"])
        _rejects("corrupt lifecycle column reference", expand_charts, corrupt)
        corrupt = json.loads(json.dumps(interned))
        corrupt["chartColumns"]["evidence.limitations"][0] = -1
        _rejects("negative evidence.limitations column reference", expand_charts, corrupt)
        corrupt = json.loads(json.dumps(interned))
        corrupt["chartColumns"]["role"].pop()
        _rejects("chart column shorter than the charts", expand_charts, corrupt)
        corrupt = json.loads(json.dumps(interned))
        del corrupt["chartDictionaries"]["kind"]
        _rejects("chart column without its dictionary", expand_charts, corrupt)

    catalog_path = package / "corrections/material-v1/catalog.json"
    if catalog_path.is_file():
        original = expand_package_document(json.loads(catalog_path.read_text()))
        interned = intern_charts(original, CORRECTION_CHART_FIELDS)
        report["correctionCatalogBytes"] = _round_trip(
            "catalog.json", original, interned, expand_charts)
        corrupt = json.loads(json.dumps(interned))
        corrupt["chartColumns"]["evidence"][0] = len(corrupt["chartDictionaries"]["evidence"])
        _rejects("corrupt evidence column reference", expand_charts, corrupt)

    boundary_bytes = 0
    boundary_files = sorted(package.glob("boundary-*.json"))
    for path in boundary_files:
        original = expand_package_document(json.loads(path.read_text()))
        boundary_bytes += _round_trip(path.name, original, intern_boundary(original), expand_boundary)
    if boundary_files:
        report["boundaryFiles"] = len(boundary_files)
        report["boundaryBytes"] = boundary_bytes
        interned = intern_boundary(expand_package_document(
            json.loads(boundary_files[0].read_text())))
        corrupt = json.loads(json.dumps(interned))
        corrupt["segments"][0]["kindRef"] = len(corrupt["dictionaries"]["kind"])
        _rejects("corrupt kindRef", expand_boundary, corrupt)
        corrupt = json.loads(json.dumps(interned))
        corrupt["segments"][0]["sourceFeatureIdRef"] = len(corrupt["strings"])
        _rejects("corrupt sourceFeatureIdRef", expand_boundary, corrupt)

    ownership_bytes = 0
    ownership_files = sorted(package.glob("ownership-*.json"))
    for path in ownership_files:
        original = expand_package_document(json.loads(path.read_text()))
        ownership_bytes += _round_trip(path.name, original, intern_ownership(original),
                                       expand_ownership)
    if ownership_files:
        report["ownershipFiles"] = len(ownership_files)
        report["ownershipBytes"] = ownership_bytes
        interned = intern_ownership(expand_package_document(
            json.loads(ownership_files[0].read_text())))
        scrambled = json.loads(json.dumps(interned))
        rings = scrambled["rings"]
        moved = next((index for index in range(1, len(rings))
                      if rings[index]["topologyId"] != rings[0]["topologyId"]), None)
        if moved is None:
            raise InterningError("self-test: ownership fixture has one polygon only")
        rings.insert(moved + 1, copy.deepcopy(rings[0]))
        _rejects("ring shipped outside its polygon group", expand_ownership, scrambled)

    report["status"] = "pass"
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=PUBLIC)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not args.self_test:
        parser.error("cao_package_intern is a library; run with --self-test")
    print(json.dumps(self_test(args.package), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

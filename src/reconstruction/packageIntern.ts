/**
 * Decoder for the interned form of the shipped Cao v2.4 package JSON.
 *
 * The offline codec is `scripts/research/cao_package_intern.py`; the two must
 * stay in step. Interning is lossless: every value, source id, citation,
 * limitation, lifecycle bound and digest the expanded document carries is
 * still present, so nothing downstream of this decoder changes. See
 * `docs/data/README.md` for the wire format.
 *
 * A document that carries none of the encoding markers passes through
 * untouched, so the decoder can sit on every verified JSON load.
 */

const COLLAPSED_ID_FIELDS = ["fragmentOrCohortId", "materialId"] as const;
const BOUNDARY_STRING_FIELDS = ["sourceFeatureId", "rightTopologyId", "leftTopologyId"] as const;
const SEGMENT_ID_ENCODING = "age-sourceFeatureId-part-v1";
const RING_ID_ENCODING = "age-topologyId-ordinal-v1";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Dictionary values are shared by every record that references them, so they ship frozen. */
function frozenTable(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Cao package dictionary ${name} is not an array`);
  return deepFreeze(value) as readonly unknown[];
}

function resolve(index: unknown, table: readonly unknown[], name: string): unknown {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= table.length) {
    throw new Error(`Cao package dictionary reference out of range: ${name}`);
  }
  return table[index];
}

/** The identifier spelling of a source age; matches the offline codec's `%g`. */
function ageToken(age: unknown): string {
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0 || age > 1_800) {
    throw new Error("invalid Cao native source age");
  }
  return age.toPrecision(6).replace(/\.?0+$/, "");
}

function expandCharts(document: Row): Row {
  const dictionaries = document.chartDictionaries;
  if (!isRow(dictionaries)) throw new Error("Cao package chart dictionaries are malformed");
  const columnsRow = document.chartColumns;
  if (!isRow(columnsRow)) throw new Error("Cao package chart columns are malformed");
  const collapse = document.chartIdCollapse === "v1";
  const charts = document.charts;
  if (!Array.isArray(charts)) throw new Error("Cao package charts are malformed");
  // A column is dense by construction: one reference per chart, in chart order.
  const columns = Object.entries(columnsRow).map(([name, value]) => {
    if (!Array.isArray(value) || value.length !== charts.length) {
      throw new Error(`Cao package chart column ${name} does not span the charts`);
    }
    const table = dictionaries[name];
    if (table === undefined) throw new Error(`Cao package chart column ${name} has no dictionary`);
    const dot = name.indexOf(".");
    return { name, column: value as readonly unknown[], table: frozenTable(table, name),
      parent: dot >= 0 ? name.slice(0, dot) : null, field: dot >= 0 ? name.slice(dot + 1) : name };
  });
  const expanded = charts.map((record, position) => {
    if (!isRow(record)) throw new Error("Cao package chart is malformed");
    const chart: Row = { ...record };
    for (const { name, column, table, parent, field } of columns) {
      const value = resolve(column[position], table, name);
      if (parent === null) {
        chart[field] = value;
        continue;
      }
      const nested = chart[parent];
      chart[parent] = { ...(isRow(nested) ? nested : {}), [field]: value };
    }
    if (collapse) {
      for (const name of COLLAPSED_ID_FIELDS) {
        if (chart[`${name}IsChartId`] === true) chart[name] = chart.chartId;
        delete chart[`${name}IsChartId`];
      }
    }
    return chart;
  });
  const result: Row = { ...document, charts: expanded };
  delete result.chartDictionaries;
  delete result.chartColumns;
  delete result.chartIdCollapse;
  return result;
}

function expandBoundary(document: Row): Row {
  if (document.segmentIdEncoding !== SEGMENT_ID_ENCODING) {
    throw new Error("unknown Cao boundary segment id encoding");
  }
  const age = ageToken(document.sourceAgeMa);
  const strings = frozenTable(document.strings, "strings");
  const dictionaries = isRow(document.dictionaries) ? document.dictionaries : {};
  const tables = Object.entries(dictionaries).map(([name, value]) =>
    [name, frozenTable(value, name)] as const);
  const segments = document.segments;
  if (!Array.isArray(segments)) throw new Error("Cao boundary segments are malformed");
  const expanded = segments.map((record) => {
    if (!isRow(record)) throw new Error("Cao boundary segment is malformed");
    const segment: Row = { ...record };
    for (const name of BOUNDARY_STRING_FIELDS) {
      const index = segment[`${name}Ref`];
      segment[name] = index === null ? null : resolve(index, strings, name);
      delete segment[`${name}Ref`];
    }
    for (const [name, table] of tables) {
      if (!(`${name}Ref` in segment)) continue;
      segment[name] = resolve(segment[`${name}Ref`], table, name);
      delete segment[`${name}Ref`];
    }
    segment.segmentId = `${age}:${segment.sourceFeatureId}:part:${segment.sourcePart}`;
    return segment;
  });
  const result: Row = { ...document, segments: expanded };
  delete result.strings;
  delete result.dictionaries;
  delete result.segmentIdEncoding;
  return result;
}

function expandOwnership(document: Row): Row {
  if (document.ringIdEncoding !== RING_ID_ENCODING) {
    throw new Error("unknown Cao ownership ring id encoding");
  }
  const age = ageToken(document.sourceAgeMa);
  const rings = document.rings;
  if (!Array.isArray(rings)) throw new Error("Cao ownership rings are malformed");
  // The ordinal is only recoverable while a polygon's rings stay contiguous, so
  // a ring shipped outside its group is rejected rather than given a wrong id.
  const closed = new Set<string>();
  let current: string | null = null;
  let ordinal = 0;
  const expanded = rings.map((record) => {
    if (!isRow(record) || typeof record.topologyId !== "string" || !record.topologyId
        || "ringId" in record || "polygonId" in record) {
      throw new Error("Cao ownership ring is malformed");
    }
    const polygonId = `${age}:${record.topologyId}`;
    if (polygonId !== current) {
      if (closed.has(polygonId)) throw new Error("Cao ownership polygon rings are not contiguous");
      if (current !== null) closed.add(current);
      current = polygonId;
      ordinal = 0;
    }
    return { ringId: `${polygonId}:${ordinal++}`, polygonId, ...record };
  });
  const result: Row = { ...document, rings: expanded };
  delete result.ringIdEncoding;
  return result;
}

/**
 * Expands an interned Cao package document. Documents without an encoding
 * marker — checkpoints, manifests, the motion palette catalog, tile indices —
 * are returned unchanged, so this is safe on every verified JSON load.
 */
export function expandInternedPackageDocument(value: unknown): unknown {
  if (!isRow(value)) return value;
  if ("chartDictionaries" in value) return expandCharts(value);
  if (value.segmentIdEncoding !== undefined) return expandBoundary(value);
  if (value.ringIdEncoding !== undefined) return expandOwnership(value);
  return value;
}

/**
 * Synthetic EHPR v1 payloads and class catalogs for the palaeo-coastline tests.
 *
 * The decoder is only worth trusting if something independent writes the bytes,
 * so this encoder is written from `docs/data/palaeo-coastlines-format.md`
 * rather than from the decoder, and every header and table field it emits can
 * be corrupted deliberately by a test.
 */

import {
  PALAEO_RING_LATITUDE_SCALE,
  PALAEO_RING_LONGITUDE_SCALE,
  PALAEO_SURFACE_CLASS_APPEARANCES,
  PALAEO_SURFACE_CLASS_CODES,
  PALAEO_SURFACE_CLASS_NAMES,
  decodePalaeoCoastlineClassCatalog,
  type PalaeoCoastlineClassCatalog,
  type PalaeoSurfaceClass,
} from "../palaeoRings";

const HEADER_BYTES = 32;
const PIECE_BYTES = 12;
const RING_BYTES = 2;
const HOLE_BIT = 0x8000;

export type LonLat = readonly [number, number];

export interface PalaeoRingFixtureRing {
  readonly lonLat: readonly LonLat[];
  readonly hole?: boolean;
}

export interface PalaeoRingFixturePiece {
  readonly chartIndex?: number;
  readonly bindingIndex?: number;
  readonly evidenceIndex?: number;
  readonly lifecycleIndex?: number;
  readonly flags?: number;
  readonly rings: readonly PalaeoRingFixtureRing[];
}

export interface PalaeoRingFixtureOptions {
  readonly surfaceClass?: PalaeoSurfaceClass;
  readonly intervalIndex?: number;
  readonly fromAgeMa?: number;
  readonly toAgeMa?: number;
  readonly pieces: readonly PalaeoRingFixturePiece[];
  /** Deliberate corruption hooks; each overrides one emitted header field. */
  readonly magic?: string;
  readonly version?: number;
  readonly headerBytes?: number;
  readonly classCode?: number;
  readonly declaredPieceCount?: number;
  readonly declaredRingCount?: number;
  readonly declaredVertexCount?: number;
  /** Emits one ring's vertex count as this value without changing the vertices. */
  readonly ringVertexCountOverride?: { readonly ringIndex: number; readonly value: number };
}

function quantise(value: number, scale: number): number {
  return Math.max(-32_767, Math.min(32_767, Math.round(value * scale)));
}

export function encodePalaeoRingPayload(options: PalaeoRingFixtureOptions): ArrayBuffer {
  const rings = options.pieces.flatMap((piece) => piece.rings);
  const vertices = rings.flatMap((ring) => ring.lonLat);
  const byteLength = HEADER_BYTES + PIECE_BYTES * options.pieces.length
    + RING_BYTES * rings.length + 4 * vertices.length;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  const magic = options.magic ?? "EHPR";
  for (let index = 0; index < 4; index += 1) view.setUint8(index, magic.charCodeAt(index));
  view.setUint16(4, options.version ?? 1, true);
  view.setUint16(6, options.headerBytes ?? HEADER_BYTES, true);
  view.setUint32(8, options.declaredPieceCount ?? options.pieces.length, true);
  view.setUint32(12, options.declaredRingCount ?? rings.length, true);
  view.setUint32(16, options.declaredVertexCount ?? vertices.length, true);
  view.setUint16(20, options.classCode
    ?? PALAEO_SURFACE_CLASS_CODES[options.surfaceClass ?? "lm"], true);
  view.setUint16(22, options.intervalIndex ?? 0, true);
  view.setFloat32(24, options.fromAgeMa ?? 402, true);
  view.setFloat32(28, options.toAgeMa ?? 380, true);
  let offset = HEADER_BYTES;
  for (const piece of options.pieces) {
    view.setUint16(offset, piece.chartIndex ?? 0, true);
    view.setUint16(offset + 2, piece.bindingIndex ?? 0, true);
    view.setUint16(offset + 4, piece.evidenceIndex ?? 0, true);
    view.setUint16(offset + 6, piece.lifecycleIndex ?? 0, true);
    view.setUint16(offset + 8, piece.flags ?? 0, true);
    view.setUint16(offset + 10, piece.rings.length, true);
    offset += PIECE_BYTES;
  }
  for (const [index, ring] of rings.entries()) {
    const count = options.ringVertexCountOverride?.ringIndex === index
      ? options.ringVertexCountOverride.value : ring.lonLat.length;
    view.setUint16(offset, (count & 0x7fff) | (ring.hole ? HOLE_BIT : 0), true);
    offset += RING_BYTES;
  }
  for (const [longitude, latitude] of vertices) {
    view.setInt16(offset, quantise(longitude, PALAEO_RING_LONGITUDE_SCALE), true);
    view.setInt16(offset + 2, quantise(latitude, PALAEO_RING_LATITUDE_SCALE), true);
    offset += 4;
  }
  if (offset !== byteLength) throw new Error("EHPR fixture writer produced a short buffer");
  return buffer;
}

export interface PalaeoCatalogFixtureOptions {
  readonly surfaceClass?: PalaeoSurfaceClass;
  readonly catalogId?: string;
  /** The plate every fixture binding rides; `palaeo-binding-entry-v1` starts from it. */
  readonly bindingPlateId?: number;
  readonly chartCount?: number;
  readonly recoveryPlateIds?: readonly number[];
  readonly gapSets?: readonly (readonly { readonly youngestMa: number; readonly oldestMa: number;
    readonly reason: "source-seam" }[])[];
  readonly bindings?: readonly { readonly bindingPlateId: number; readonly partitionPlateId: number;
    readonly kind: number; readonly gapSet: number }[];
  readonly lifecycles?: readonly { readonly youngestExclusiveMa: number; readonly oldestMa: number }[];
  readonly intervals?: readonly {
    readonly intervalId: string;
    readonly intervalIndex: number;
    readonly fromAgeMa: number;
    readonly toAgeMa: number;
    readonly bytes: number;
    readonly sha256: string;
    readonly pieces: number;
    readonly rings: number;
    readonly vertices: number;
  }[];
}

/** Packs row objects into the columnar table shape a shipped catalog carries. */
function packColumns(rows: readonly Record<string, unknown>[], columns: readonly string[]):
Record<string, unknown> {
  return { count: rows.length,
    ...Object.fromEntries(columns.map((column) => [column, rows.map((row) => row[column])])) };
}

/**
 * The document a build actually ships: schemaVersion 2, columnar, no chart
 * table. Written from `docs/data/palaeo-coastlines-format.md` rather than from
 * the decoder, so a test can corrupt any single field of it.
 */
export function palaeoClassCatalogDocumentFixture(
  options: PalaeoCatalogFixtureOptions = {},
): Record<string, unknown> {
  const surfaceClass = options.surfaceClass ?? "lm";
  const bindingPlateId = options.bindingPlateId ?? 101;
  const intervals = options.intervals ?? [{ intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402,
    toAgeMa: 380, bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 3 }];
  return {
    schemaVersion: 2,
    encoding: "palaeo-class-catalog-columnar-v1",
    catalogId: options.catalogId ?? `palaeo-coastlines-${surfaceClass}-v2`,
    class: surfaceClass,
    className: PALAEO_SURFACE_CLASS_NAMES[surfaceClass],
    appearance: PALAEO_SURFACE_CLASS_APPEARANCES[surfaceClass],
    format: { magic: "EHPR", version: 1, specification: "docs/data/palaeo-coastlines-format.md" },
    paletteId: "cao-v2.4-shared-motion-v1",
    lifecycleRule: "(TOAGE, FROMAGE]: youngest bound exclusive, oldest bound inclusive",
    payloadNameTemplate: `palaeo-${surfaceClass}-<intervalId>.ehpr`,
    maximumEdgeDegrees: 1,
    chartCount: options.chartCount ?? 1,
    provenance: { path: `provenance/palaeo-${surfaceClass}-provenance.json`, bytes: 1,
      sha256: "b".repeat(64), records: 1, store: "offline only" },
    flagLimitations: {
      1: "drawn where its partition owner puts it while its own PLATEID1 disagrees by more than 250 km",
      2: "bound by the source PLATEID1 override rather than by the owner partition",
      4: "bound to a North Sea restoration palette entry",
      8: "the source record is off the published 24-interval schedule",
    },
    entrySelection: {
      rule: "palaeo-binding-entry-v1",
      coverage: "youngestAgeMa <= ageMa <= oldestAgeMa",
      tieBreak: "largest youngestAgeMa, then entryId",
      preference: ["restoration-", "native-recovery-plate-", "correction-plate-", "plate-"],
      correctionPreferenceAgeMa: 410,
      restorationEntryIds: ["restoration-north-sea-plate-303-130-600",
        "restoration-north-sea-plate-315-130-420"],
      recoveryPlateIds: options.recoveryPlateIds ?? [626, 801],
      recoveryFallback: "unposable",
    },
    bindingKinds: ["partition", "override", "restoration", "recovery"],
    bindings: packColumns(options.bindings
      ?? [{ bindingPlateId, partitionPlateId: bindingPlateId, kind: 0, gapSet: 0 }],
      ["bindingPlateId", "partitionPlateId", "kind", "gapSet"]),
    gapSets: options.gapSets ?? [[]],
    evidence: [{ status: "classified-map-polygon",
      surfaceClass: PALAEO_SURFACE_CLASS_NAMES[surfaceClass],
      appearance: PALAEO_SURFACE_CLASS_APPEARANCES[surfaceClass],
      method: "present-day-class-reattached-to-cao2024-partition-v1",
      sourceIds: ["cao-2017-paleogeography"],
      limitations: ["minimum land and maximum flooding mapped anywhere in the interval"] }],
    lifecycles: packColumns(
      (options.lifecycles ?? [{ youngestExclusiveMa: 380, oldestMa: 402 }]) as unknown as Record<string, unknown>[],
      ["youngestExclusiveMa", "oldestMa"]),
    intervals: packColumns(intervals.map((interval) => ({
      intervalId: interval.intervalId,
      intervalIndex: interval.intervalIndex,
      fromAgeMa: interval.fromAgeMa,
      toAgeMa: interval.toAgeMa,
      midAgeMa: (interval.fromAgeMa + interval.toAgeMa) / 2,
      bytes: interval.bytes,
      sha256: interval.sha256,
      pieces: interval.pieces,
      rings: interval.rings,
      vertices: interval.vertices,
      collapsedRings: 0,
      baseTriangles: interval.vertices - 2,
      estimatedTrianglesAtOneDegree: interval.vertices * 8,
    })), ["intervalId", "intervalIndex", "fromAgeMa", "toAgeMa", "midAgeMa", "bytes", "sha256",
      "pieces", "rings", "vertices", "collapsedRings", "baseTriangles",
      "estimatedTrianglesAtOneDegree"]),
  };
}

/** The same fixture expanded through the runtime decoder; tests corrupt one row at a time. */
export function palaeoClassCatalogFixture(
  options: PalaeoCatalogFixtureOptions = {},
): PalaeoCoastlineClassCatalog {
  return decodePalaeoCoastlineClassCatalog(palaeoClassCatalogDocumentFixture(options));
}

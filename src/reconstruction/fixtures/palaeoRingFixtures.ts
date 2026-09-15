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
  type PalaeoCoastlineClassCatalog,
  type PalaeoSurfaceClass,
} from "../palaeoRings";

const HEADER_BYTES = 32;
const PIECE_BYTES = 12;
const RING_BYTES = 4;
const HOLE_BIT = 0x8000_0000;

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
    view.setUint32(offset, (count & 0x7fff_ffff) | (ring.hole ? HOLE_BIT : 0), true);
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
  readonly entryId?: string;
  readonly lifecycles?: readonly { readonly youngestExclusiveMa: number; readonly oldestMa: number }[];
  readonly intervals?: readonly {
    readonly intervalId: string;
    readonly intervalIndex: number;
    readonly fromAgeMa: number;
    readonly toAgeMa: number;
    readonly url: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly pieces: number;
    readonly rings: number;
    readonly vertices: number;
  }[];
}

/** A minimal but fully valid class catalog; tests corrupt one field at a time. */
export function palaeoClassCatalogFixture(
  options: PalaeoCatalogFixtureOptions = {},
): PalaeoCoastlineClassCatalog {
  const surfaceClass = options.surfaceClass ?? "lm";
  const entryId = options.entryId ?? "plate-101-0-1800";
  return {
    schemaVersion: 1,
    catalogId: options.catalogId ?? `palaeo-coastlines-${surfaceClass}-v1`,
    class: surfaceClass,
    className: PALAEO_SURFACE_CLASS_NAMES[surfaceClass],
    appearance: PALAEO_SURFACE_CLASS_APPEARANCES[surfaceClass],
    format: { magic: "EHPR", version: 1 },
    flagLimitations: {
      1: "drawn where its partition owner puts it while its own PLATEID1 disagrees by more than 250 km",
      2: "bound by the source PLATEID1 override rather than by the owner partition",
      4: "bound to a North Sea restoration palette entry",
      8: "the source record is off the published 24-interval schedule",
    },
    charts: [{ sourceRecordIndex: 0, plateId1: 101, fromAgeMa: 402, toAgeMa: 380,
      featureId: "GPlates-fixture", offSchedule: false, basinOpId: null }],
    bindings: [{ paletteId: "cao-v2.4-shared-motion-v1", bindingPlateId: 101, partitionPlateId: 101,
      bindingSource: "owner-partition",
      entries: [{ entryId, validTimeMa: { youngest: 0, oldest: 1_800 } }] }],
    evidence: [{ status: "classified-map-polygon", surfaceClass: PALAEO_SURFACE_CLASS_NAMES[surfaceClass],
      appearance: PALAEO_SURFACE_CLASS_APPEARANCES[surfaceClass],
      method: "present-day-class-reattached-to-cao2024-partition-v1",
      sourceIds: ["cao-2017-paleogeography"],
      limitations: ["minimum land and maximum flooding mapped anywhere in the interval"] }],
    lifecycles: options.lifecycles ?? [{ youngestExclusiveMa: 380, oldestMa: 402 }],
    intervals: (options.intervals ?? [{ intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402,
      toAgeMa: 380, url: "palaeo-lm-402-380.ehpr", bytes: 1, sha256: "a".repeat(64),
      pieces: 1, rings: 1, vertices: 3 }]).map((interval) => ({
      intervalId: interval.intervalId,
      intervalIndex: interval.intervalIndex,
      fromAgeMa: interval.fromAgeMa,
      toAgeMa: interval.toAgeMa,
      midAgeMa: (interval.fromAgeMa + interval.toAgeMa) / 2,
      simplified: { url: interval.url, bytes: interval.bytes, sha256: interval.sha256,
        pieces: interval.pieces, rings: interval.rings, vertices: interval.vertices,
        collapsedRings: 0 },
      reservation: { vertices: interval.vertices, baseTriangles: interval.vertices - 2,
        estimatedTrianglesAtOneDegree: interval.vertices * 8, maximumEdgeDegrees: 1 },
    })),
  };
}

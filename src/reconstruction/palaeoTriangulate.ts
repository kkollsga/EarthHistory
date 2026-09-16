/**
 * Ear-clipping and 1 degree edge refinement for EHPR v1 ring payloads.
 *
 * The palaeo-coastline layer streams rings, not triangles: 24 pre-triangulated
 * intervals of the landmass class alone would be 45-96 MiB, while the ring
 * payloads are about 3 MiB. The cost of that is this module, which must turn
 * rings into the prepared static-geometry shape the surface renderer consumes
 * without blocking the frame loop, so the whole pass runs in a worker with a
 * main-thread fallback and every function here stays pure and testable.
 *
 * Two steps, matching the offline reservation model in
 * `scripts/research/palaeo_coastlines_compile.py`:
 *
 * 1. Ear-clip each piece in planar lon/lat, holes included. The compiler cut,
 *    simplified and area-audited every piece in the same planar lon/lat space
 *    (rings are densified to 1 degree of great circle before any planar
 *    Boolean, and never cross the antimeridian), and its triangle reservation
 *    is a planar lon/lat Delaunay of the same vertices.
 * 2. Conformingly bisect every edge longer than 1 degree of arc, reproducing
 *    `refine_triangle_edges` in `scripts/research/emit_cao_material_corrections.py`:
 *    all violating edges of a round are split at once at the normalised 3D
 *    midpoint, and the eight-case split table keeps neighbouring triangles
 *    sharing the same split points, so a refined mesh has no cracks. The
 *    1 degree bound is what keeps a flat chord from sinking 242.6 m into the
 *    opaque globe at the 400 m shelf shell.
 */

import { Earcut } from "three/src/extras/Earcut.js";
import {
  decodePalaeoRingPayload,
  palaeoRingPayloadMetadata,
  palaeoVertexLatitude,
  palaeoVertexLongitude,
  palaeoLonLatDirection,
  type DecodedPalaeoRingPayload,
  type PalaeoPieceRecord,
  type PalaeoRingPayloadMetadata,
} from "./palaeoRings";

/** Maximum triangle edge, in degrees of arc, the renderer's chord-sag guard allows. */
export const PALAEO_MAX_EDGE_DEGREES = 1;

/**
 * Seam ids are unique per palaeo vertex: a cookie-cut piece shares no vertex
 * with any other, so no two palaeo vertices are ever welded. The array is built
 * and transferred here with the rest of the geometry, because building it on
 * the main thread put a `vertexCount * 4` byte allocation into the one frame
 * that publishes an incoming interval.
 */
export const PALAEO_SEAM_ID_BASE = 2_000_000_000;

/**
 * Ceilings of the palaeo surface renderer instance; a payload above them cannot
 * be drawn.
 *
 * Measured 2026-09-15 over the 24 promoted `lm`+`sm` intervals: the worst
 * interval (29-20 Ma) refines to 300,697 vertices and 483,487 triangles with
 * all three classes shipped, 1.88x the compiler's
 * `estimatedTrianglesAtOneDegree`. The compiler models
 * per-triangle longest-edge bisection; this module bisects conformingly, so a
 * split propagates into neighbours that were already short enough, and the
 * earcut diagonals it starts from are long. The 1 degree bound is the chord-sag
 * contract and cannot be relaxed, so the ceilings were raised to cover the
 * measurement with about 20 % headroom instead.
 */
export const PALAEO_TRIANGULATION_MAX_VERTICES = 500_000;
export const PALAEO_TRIANGULATION_MAX_TRIANGLES = 760_000;

/** The reference implementation's own bound on conforming refinement rounds. */
const MAX_REFINEMENT_ROUNDS = 32;

export interface PalaeoPieceTriangleRange {
  readonly pieceIndex: number;
  readonly firstTriangle: number;
  readonly triangleCount: number;
}

export interface PreparedPalaeoIntervalGeometry {
  /** Unit directions at the payload's present-day reference frame, xyz per vertex. */
  readonly referenceDirections: Float32Array;
  readonly indices: Uint32Array;
  /** Owning piece of every vertex; a triangle never spans two pieces. */
  readonly pieceIndices: Uint32Array;
  /** `PALAEO_SEAM_ID_BASE + vertex`, in the renderer's seam-id shape. */
  readonly seamIds: Uint32Array;
  readonly pieceTriangleRanges: readonly PalaeoPieceTriangleRange[];
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly maximumEdgeDegrees: number;
}

export interface PreparedPalaeoRingPayload {
  readonly metadata: PalaeoRingPayloadMetadata;
  readonly geometry: PreparedPalaeoIntervalGeometry;
}

export interface PalaeoTriangulationOptions {
  readonly maxEdgeDegrees?: number;
  readonly maxVertices?: number;
  readonly maxTriangles?: number;
}

function unitDirection(longitude: number, latitude: number): [number, number, number] {
  const [x, y, z] = palaeoLonLatDirection(longitude, latitude);
  const length = Math.hypot(x, y, z);
  // Rounding to f32 here, not at copy time, means the edge lengths measured by
  // the refinement are the edge lengths the renderer will actually draw.
  return [Math.fround(x / length), Math.fround(y / length), Math.fround(z / length)];
}

function angularDistance(directions: readonly number[], left: number, right: number): number {
  const a = left * 3;
  const b = right * 3;
  const dot = directions[a]! * directions[b]! + directions[a + 1]! * directions[b + 1]!
    + directions[a + 2]! * directions[b + 2]!;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function pushNormalisedMidpoint(directions: number[], left: number, right: number): void {
  const a = left * 3;
  const b = right * 3;
  const x = directions[a]! + directions[b]!;
  const y = directions[a + 1]! + directions[b + 1]!;
  const z = directions[a + 2]! + directions[b + 2]!;
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-12)) throw new Error("palaeo-coastline edge has antipodal endpoints");
  directions.push(Math.fround(x / length), Math.fround(y / length), Math.fround(z / length));
}

/**
 * Conforming longest-edge bisection to a maximum arc length. Ported from
 * `refine_triangle_edges`: every edge above the threshold is split in the same
 * round, at the normalised 3D midpoint, and both triangles sharing an edge use
 * the one midpoint vertex, so the refined mesh stays watertight.
 */
export function refinePalaeoTriangleEdges(
  directions: number[],
  triangles: readonly number[],
  maxEdgeRadians: number,
  maxTriangles: number = PALAEO_TRIANGULATION_MAX_TRIANGLES,
): { readonly directions: number[]; readonly triangles: number[] } {
  let current = [...triangles];
  for (let round = 0; ; round += 1) {
    const violating = new Map<string, readonly [number, number]>();
    for (let offset = 0; offset < current.length; offset += 3) {
      const corners = [current[offset]!, current[offset + 1]!, current[offset + 2]!];
      for (let corner = 0; corner < 3; corner += 1) {
        const first = corners[corner]!;
        const second = corners[(corner + 1) % 3]!;
        const left = Math.min(first, second);
        const right = Math.max(first, second);
        const key = `${left},${right}`;
        if (violating.has(key)) continue;
        if (angularDistance(directions, left, right) > maxEdgeRadians + 1e-12) {
          violating.set(key, [left, right]);
        }
      }
    }
    if (violating.size === 0) return { directions, triangles: current };
    if (round >= MAX_REFINEMENT_ROUNDS) {
      throw new Error("palaeo-coastline edge refinement did not converge");
    }
    // Sorted numerically, so two runs over the same payload allocate the same
    // vertex indices and emit byte-identical buffers.
    const ordered = [...violating.values()].sort((left, right) =>
      left[0] - right[0] || left[1] - right[1]);
    const midpoints = new Map<string, number>();
    for (const [left, right] of ordered) {
      midpoints.set(`${left},${right}`, directions.length / 3);
      pushNormalisedMidpoint(directions, left, right);
    }
    const refined: number[] = [];
    const midpoint = (left: number, right: number): number | undefined =>
      midpoints.get(`${Math.min(left, right)},${Math.max(left, right)}`);
    for (let offset = 0; offset < current.length; offset += 3) {
      const a = current[offset]!;
      const b = current[offset + 1]!;
      const c = current[offset + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      const mask = (ab === undefined ? 0 : 1) | (bc === undefined ? 0 : 2) | (ca === undefined ? 0 : 4);
      if (mask === 0) refined.push(a, b, c);
      else if (mask === 1) refined.push(a, ab!, c, ab!, b, c);
      else if (mask === 2) refined.push(b, bc!, a, bc!, c, a);
      else if (mask === 4) refined.push(c, ca!, b, ca!, a, b);
      else if (mask === 3) refined.push(b, bc!, ab!, a, ab!, c, ab!, bc!, c);
      else if (mask === 6) refined.push(c, ca!, bc!, b, bc!, a, bc!, ca!, a);
      else if (mask === 5) refined.push(a, ab!, ca!, c, ca!, b, ca!, ab!, b);
      else refined.push(a, ab!, ca!, ab!, b, bc!, ca!, bc!, c, ab!, bc!, ca!);
    }
    if (refined.length / 3 > maxTriangles) {
      throw new Error("palaeo-coastline edge refinement exceeds the renderer triangle ceiling");
    }
    current = refined;
  }
}

interface PieceMesh {
  readonly directions: number[];
  readonly triangles: number[];
}

/** Ear-clips one piece in planar lon/lat: each exterior ring with the holes that follow it. */
function earClipPiece(piece: PalaeoPieceRecord, vertices: Int16Array): PieceMesh {
  const directions: number[] = [];
  const triangles: number[] = [];
  let partStart = -1;
  for (let ringIndex = 0; ringIndex < piece.rings.length; ringIndex += 1) {
    if (piece.rings[ringIndex]!.hole) continue;
    if (partStart >= 0) appendPart(piece, vertices, partStart, ringIndex, directions, triangles);
    partStart = ringIndex;
  }
  if (partStart >= 0) appendPart(piece, vertices, partStart, piece.rings.length, directions, triangles);
  return { directions, triangles };
}

function appendPart(
  piece: PalaeoPieceRecord,
  vertices: Int16Array,
  exteriorRing: number,
  ringEnd: number,
  directions: number[],
  triangles: number[],
): void {
  const coordinates: number[] = [];
  const longitudes: number[] = [];
  const latitudes: number[] = [];
  const holeIndices: number[] = [];
  for (let ringIndex = exteriorRing; ringIndex < ringEnd; ringIndex += 1) {
    const ring = piece.rings[ringIndex]!;
    if (ringIndex > exteriorRing) holeIndices.push(coordinates.length / 2);
    for (let vertex = 0; vertex < ring.vertexCount; vertex += 1) {
      const payloadVertex = ring.firstVertex + vertex;
      const longitude = palaeoVertexLongitude(vertices[payloadVertex * 2]!);
      const latitude = palaeoVertexLatitude(vertices[payloadVertex * 2 + 1]!);
      coordinates.push(longitude, latitude);
      longitudes.push(longitude);
      latitudes.push(latitude);
    }
  }
  const clipped = Earcut.triangulate(coordinates, holeIndices, 2);
  // A part whose rings collapse under quantisation produces no ears. It carries
  // no drawable area, so it contributes no vertices either, rather than leaving
  // unreferenced vertices in the renderer's retained copy.
  if (clipped.length === 0) return;
  const base = directions.length / 3;
  for (let local = 0; local < longitudes.length; local += 1) {
    directions.push(...unitDirection(longitudes[local]!, latitudes[local]!));
  }
  for (const index of clipped) triangles.push(base + index);
}

/**
 * Decodes, triangulates and refines one EHPR payload. Pure: the same bytes
 * always produce byte-identical buffers, which is what lets the worker result
 * and the main-thread fallback be interchangeable.
 */
export function preparePalaeoRingPayload(
  buffer: ArrayBuffer,
  options: PalaeoTriangulationOptions = {},
): PreparedPalaeoRingPayload {
  return preparePalaeoRingGeometry(decodePalaeoRingPayload(buffer), options);
}

export function preparePalaeoRingGeometry(
  payload: DecodedPalaeoRingPayload,
  options: PalaeoTriangulationOptions = {},
): PreparedPalaeoRingPayload {
  const maxEdgeDegrees = options.maxEdgeDegrees ?? PALAEO_MAX_EDGE_DEGREES;
  const maxVertices = options.maxVertices ?? PALAEO_TRIANGULATION_MAX_VERTICES;
  const maxTriangles = options.maxTriangles ?? PALAEO_TRIANGULATION_MAX_TRIANGLES;
  if (!(maxEdgeDegrees > 0) || maxEdgeDegrees > PALAEO_MAX_EDGE_DEGREES) {
    throw new Error("palaeo-coastline refinement edge bound must be inside 1 degree");
  }
  const maxEdgeRadians = maxEdgeDegrees * Math.PI / 180;
  const directions: number[] = [];
  const indices: number[] = [];
  const pieceIndices: number[] = [];
  const pieceTriangleRanges: PalaeoPieceTriangleRange[] = [];
  for (const [pieceIndex, piece] of payload.pieces.entries()) {
    const mesh = earClipPiece(piece, payload.vertices);
    if (mesh.triangles.length === 0) continue;
    const refined = refinePalaeoTriangleEdges(mesh.directions, mesh.triangles, maxEdgeRadians,
      maxTriangles - indices.length / 3);
    const base = directions.length / 3;
    if (base + refined.directions.length / 3 > maxVertices) {
      throw new Error("palaeo-coastline interval exceeds the renderer vertex ceiling");
    }
    for (const value of refined.directions) directions.push(value);
    for (let vertex = 0; vertex < refined.directions.length / 3; vertex += 1) pieceIndices.push(pieceIndex);
    pieceTriangleRanges.push(Object.freeze({ pieceIndex, firstTriangle: indices.length / 3,
      triangleCount: refined.triangles.length / 3 }));
    for (const index of refined.triangles) indices.push(base + index);
  }
  const seamIds = new Uint32Array(pieceIndices.length);
  for (let vertex = 0; vertex < seamIds.length; vertex += 1) seamIds[vertex] = PALAEO_SEAM_ID_BASE + vertex;
  return Object.freeze({
    metadata: palaeoRingPayloadMetadata(payload),
    geometry: Object.freeze({
      referenceDirections: new Float32Array(directions),
      indices: new Uint32Array(indices),
      pieceIndices: new Uint32Array(pieceIndices),
      seamIds,
      pieceTriangleRanges: Object.freeze(pieceTriangleRanges),
      vertexCount: directions.length / 3,
      triangleCount: indices.length / 3,
      maximumEdgeDegrees: maxEdgeDegrees,
    }),
  });
}

// ---------------------------------------------------------------------------
// worker scheduling
// ---------------------------------------------------------------------------

export interface PalaeoTriangulationRunner {
  /** Consumes `buffer`: the worker path transfers it and leaves it detached. */
  run(buffer: ArrayBuffer, options?: PalaeoTriangulationOptions,
    signal?: AbortSignal): Promise<PreparedPalaeoRingPayload>;
  readonly usesWorker: boolean;
  dispose(): void;
}

export interface PalaeoTriangulationRequest {
  readonly requestId: number;
  readonly buffer: ArrayBuffer;
  readonly options: PalaeoTriangulationOptions;
}

export type PalaeoTriangulationResponse =
  | { readonly requestId: number; readonly ok: true; readonly metadata: PalaeoRingPayloadMetadata;
    readonly geometry: PreparedPalaeoIntervalGeometry }
  | { readonly requestId: number; readonly ok: false; readonly message: string };

/** Handles one worker message; shared by the worker entry point and its tests. */
export function handlePalaeoTriangulationRequest(
  request: PalaeoTriangulationRequest,
): { readonly response: PalaeoTriangulationResponse; readonly transfer: readonly ArrayBuffer[] } {
  try {
    const prepared = preparePalaeoRingPayload(request.buffer, request.options);
    return {
      response: { requestId: request.requestId, ok: true, metadata: prepared.metadata,
        geometry: prepared.geometry },
      transfer: [prepared.geometry.referenceDirections.buffer as ArrayBuffer,
        prepared.geometry.indices.buffer as ArrayBuffer,
        prepared.geometry.pieceIndices.buffer as ArrayBuffer,
        prepared.geometry.seamIds.buffer as ArrayBuffer],
    };
  } catch (error) {
    return { response: { requestId: request.requestId, ok: false,
      message: error instanceof Error ? error.message : "palaeo-coastline triangulation failed" },
    transfer: [] };
  }
}

function mainThreadRunner(): PalaeoTriangulationRunner {
  return {
    usesWorker: false,
    async run(buffer, options, signal) {
      if (signal?.aborted) throw new DOMException("palaeo-coastline triangulation aborted", "AbortError");
      // Yielding first keeps the fallback off the same task as its caller, so a
      // renderer without worker support still gets one frame boundary.
      await Promise.resolve();
      if (signal?.aborted) throw new DOMException("palaeo-coastline triangulation aborted", "AbortError");
      return preparePalaeoRingPayload(buffer, options);
    },
    dispose() {},
  };
}

/**
 * One module worker for every payload; requests are multiplexed by id. Falls
 * back to the main thread wherever `Worker` is unavailable or construction
 * fails, which is also how the node test environment runs the pure path.
 */
export function createPalaeoTriangulationRunner(): PalaeoTriangulationRunner {
  if (typeof Worker !== "function") return mainThreadRunner();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./palaeoTriangulate.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return mainThreadRunner();
  }
  const pending = new Map<number, { resolve(value: PreparedPalaeoRingPayload): void;
    reject(error: unknown): void }>();
  let nextRequestId = 0;
  let disposed = false;
  worker.onmessage = (event: MessageEvent<PalaeoTriangulationResponse>) => {
    const response = event.data;
    const record = pending.get(response.requestId);
    if (!record) return;
    pending.delete(response.requestId);
    if (response.ok) record.resolve(Object.freeze({ metadata: response.metadata, geometry: response.geometry }));
    else record.reject(new Error(response.message));
  };
  worker.onerror = () => {
    for (const record of [...pending.values()]) record.reject(new Error("palaeo-coastline triangulation worker failed"));
    pending.clear();
  };
  return {
    usesWorker: true,
    run(buffer, options = {}, signal) {
      if (disposed) throw new Error("palaeo-coastline triangulation runner disposed");
      if (signal?.aborted) throw new DOMException("palaeo-coastline triangulation aborted", "AbortError");
      const requestId = nextRequestId += 1;
      return new Promise<PreparedPalaeoRingPayload>((resolve, reject) => {
        const onAbort = () => {
          // The worker keeps running to completion; only the result is dropped.
          pending.delete(requestId);
          reject(new DOMException("palaeo-coastline triangulation aborted", "AbortError"));
        };
        pending.set(requestId, {
          resolve: (value) => { signal?.removeEventListener("abort", onAbort); resolve(value); },
          reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); },
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ requestId, buffer, options } satisfies PalaeoTriangulationRequest, [buffer]);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of [...pending.values()]) {
        record.reject(new DOMException("palaeo-coastline triangulation runner disposed", "AbortError"));
      }
      pending.clear();
      worker.terminate();
    },
  };
}

import { describe, expect, it } from "vitest";
import {
  PALAEO_MAX_EDGE_DEGREES,
  createPalaeoTriangulationRunner,
  handlePalaeoTriangulationRequest,
  preparePalaeoRingPayload,
  refinePalaeoTriangleEdges,
  type PreparedPalaeoIntervalGeometry,
} from "./palaeoTriangulate";
import { palaeoLonLatDirection } from "./palaeoRings";
import { encodePalaeoRingPayload, type LonLat } from "./fixtures/palaeoRingFixtures";

type Vector = readonly [number, number, number];

function cross(left: Vector, right: Vector): Vector {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]];
}

function dot(left: Vector, right: Vector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/** Signed spherical excess (Van Oosterom & Strackee), in steradians. */
function sphericalTriangleArea(a: Vector, b: Vector, c: Vector): number {
  const numerator = dot(a, cross(b, c));
  const denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(numerator, denominator);
}

/** Fan-summed signed area of a simple spherical polygon with great-circle edges. */
function sphericalPolygonArea(ring: readonly LonLat[]): number {
  const directions = ring.map(([longitude, latitude]) =>
    palaeoLonLatDirection(longitude, latitude) as Vector);
  let area = 0;
  for (let index = 1; index + 1 < directions.length; index += 1) {
    area += sphericalTriangleArea(directions[0]!, directions[index]!, directions[index + 1]!);
  }
  return Math.abs(area);
}

function toLonLat(direction: Vector): LonLat {
  return [Math.atan2(direction[1], direction[0]) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180 / Math.PI];
}

function insideRing(ring: readonly LonLat[], [longitude, latitude]: LonLat): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index]!;
    const [bx, by] = ring[previous]!;
    if ((ay > latitude) !== (by > latitude)
      && longitude < (bx - ax) * (latitude - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function geometryVertex(geometry: PreparedPalaeoIntervalGeometry, index: number): Vector {
  return [geometry.referenceDirections[index * 3]!, geometry.referenceDirections[index * 3 + 1]!,
    geometry.referenceDirections[index * 3 + 2]!];
}

function triangleCorners(geometry: PreparedPalaeoIntervalGeometry, triangle: number):
readonly [Vector, Vector, Vector] {
  return [geometryVertex(geometry, geometry.indices[triangle * 3]!),
    geometryVertex(geometry, geometry.indices[triangle * 3 + 1]!),
    geometryVertex(geometry, geometry.indices[triangle * 3 + 2]!)];
}

/** A concave L with a hole in its lower arm, and a separate square piece. */
const concaveExterior: readonly LonLat[] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
const hole: readonly LonLat[] = [[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]];
const detached: readonly LonLat[] = [[10, 10], [13, 10], [13, 13], [10, 13]];
const holeCentre: LonLat = [3.5, 1];

const fixture = () => encodePalaeoRingPayload({
  surfaceClass: "lm", intervalIndex: 3, fromAgeMa: 300, toAgeMa: 280,
  pieces: [
    { rings: [{ lonLat: concaveExterior }, { lonLat: hole, hole: true }] },
    { chartIndex: 1, rings: [{ lonLat: detached }] },
  ],
});

describe("palaeo-coastline triangulation", () => {
  it("keeps every refined edge inside one degree of arc", () => {
    const { geometry } = preparePalaeoRingPayload(fixture());
    expect(geometry.triangleCount).toBeGreaterThan(100);
    let maximumEdgeDegrees = 0;
    for (let triangle = 0; triangle < geometry.triangleCount; triangle += 1) {
      const corners = triangleCorners(geometry, triangle);
      for (let corner = 0; corner < 3; corner += 1) {
        const arc = Math.acos(Math.max(-1, Math.min(1,
          dot(corners[corner]!, corners[(corner + 1) % 3]!))));
        maximumEdgeDegrees = Math.max(maximumEdgeDegrees, arc * 180 / Math.PI);
      }
    }
    expect(maximumEdgeDegrees).toBeLessThanOrEqual(PALAEO_MAX_EDGE_DEGREES + 1e-6);
    // The fixture is 6 degrees across, so refinement really ran.
    expect(maximumEdgeDegrees).toBeGreaterThan(0.1);
  });

  it("tiles each piece's spherical area to within 0.5 per cent", () => {
    const { geometry } = preparePalaeoRingPayload(fixture());
    const expected = [
      sphericalPolygonArea(concaveExterior) - sphericalPolygonArea(hole),
      sphericalPolygonArea(detached),
    ];
    for (const range of geometry.pieceTriangleRanges) {
      let area = 0;
      for (let offset = 0; offset < range.triangleCount; offset += 1) {
        area += Math.abs(sphericalTriangleArea(...triangleCorners(geometry, range.firstTriangle + offset)));
      }
      const reference = expected[range.pieceIndex]!;
      expect(Math.abs(area - reference) / reference).toBeLessThan(0.005);
    }
  });

  it("never lets a triangle cross a piece", () => {
    const { geometry } = preparePalaeoRingPayload(fixture());
    expect(geometry.pieceTriangleRanges.map((range) => range.pieceIndex)).toEqual([0, 1]);
    for (let triangle = 0; triangle < geometry.triangleCount; triangle += 1) {
      const pieces = new Set([geometry.pieceIndices[geometry.indices[triangle * 3]!],
        geometry.pieceIndices[geometry.indices[triangle * 3 + 1]!],
        geometry.pieceIndices[geometry.indices[triangle * 3 + 2]!]]);
      expect(pieces.size).toBe(1);
      const range = geometry.pieceTriangleRanges.find((candidate) =>
        triangle >= candidate.firstTriangle && triangle < candidate.firstTriangle + candidate.triangleCount)!;
      expect([...pieces][0]).toBe(range.pieceIndex);
      // A triangle of the concave piece stays inside that piece, not across its notch.
      if (range.pieceIndex !== 0) continue;
      const corners = triangleCorners(geometry, triangle);
      const centroid = toLonLat([0, 1, 2].map((axis) =>
        (corners[0]![axis]! + corners[1]![axis]! + corners[2]![axis]!) / 3) as unknown as Vector);
      expect(insideRing(concaveExterior, centroid)).toBe(true);
    }
  });

  it("leaves the interior ring uncovered", () => {
    const { geometry } = preparePalaeoRingPayload(fixture());
    const covered = (point: LonLat) => {
      for (let triangle = 0; triangle < geometry.triangleCount; triangle += 1) {
        const ring = triangleCorners(geometry, triangle).map(toLonLat);
        if (insideRing(ring, point)) return true;
      }
      return false;
    };
    expect(covered(holeCentre)).toBe(false);
    expect(covered([1, 1])).toBe(true);
    expect(covered([1, 5])).toBe(true);
    // The notch of the L was never part of the piece.
    expect(covered([5, 5])).toBe(false);
  });

  it("produces byte-identical buffers across two runs of the same payload", () => {
    const first = preparePalaeoRingPayload(fixture()).geometry;
    const second = preparePalaeoRingPayload(fixture()).geometry;
    const bytes = (geometry: PreparedPalaeoIntervalGeometry) => [
      new Uint8Array(geometry.referenceDirections.buffer.slice(0)),
      new Uint8Array(geometry.indices.buffer.slice(0)),
      new Uint8Array(geometry.pieceIndices.buffer.slice(0)),
    ];
    expect(bytes(first)).toEqual(bytes(second));
    expect(first.pieceTriangleRanges).toEqual(second.pieceTriangleRanges);
  });

  it("refuses a refinement that would exceed the renderer triangle ceiling", () => {
    const triangle = [[0, 0], [40, 0], [0, 40]].map(([longitude, latitude]) =>
      palaeoLonLatDirection(longitude!, latitude!));
    const directions = triangle.flatMap((direction) => [...direction]);
    expect(() => refinePalaeoTriangleEdges([...directions], [0, 1, 2],
      PALAEO_MAX_EDGE_DEGREES * Math.PI / 180, 64)).toThrow(/triangle ceiling/);
    const refined = refinePalaeoTriangleEdges([...directions], [0, 1, 2],
      PALAEO_MAX_EDGE_DEGREES * Math.PI / 180);
    expect(refined.triangles.length / 3).toBeGreaterThan(1_000);
  });

  it("reports a malformed payload as a worker failure rather than throwing across the boundary", () => {
    const failure = handlePalaeoTriangulationRequest({ requestId: 4,
      buffer: new ArrayBuffer(64), options: {} });
    expect(failure.response).toMatchObject({ requestId: 4, ok: false });
    expect(failure.transfer).toHaveLength(0);
    const success = handlePalaeoTriangulationRequest({ requestId: 5, buffer: fixture(), options: {} });
    expect(success.response.ok).toBe(true);
    // Reference directions, triangle indices, piece indices and seam ids: the
    // seam ids are built here too, so a crossing does not allocate them in the
    // frame that publishes the incoming interval.
    expect(success.transfer).toHaveLength(4);
  });

  it("falls back to the main thread where no worker exists and matches the pure path", async () => {
    const runner = createPalaeoTriangulationRunner();
    expect(runner.usesWorker).toBe(false);
    const prepared = await runner.run(fixture());
    expect(prepared.metadata.pieces).toHaveLength(2);
    expect(prepared.geometry.triangleCount)
      .toBe(preparePalaeoRingPayload(fixture()).geometry.triangleCount);
    const controller = new AbortController();
    controller.abort();
    await expect(runner.run(fixture(), {}, controller.signal)).rejects.toThrow(/aborted/);
    runner.dispose();
  });

  it("refuses an edge bound the chord-sag guard does not allow", () => {
    expect(() => preparePalaeoRingPayload(fixture(), { maxEdgeDegrees: 1.28 }))
      .toThrow(/inside 1 degree/);
    expect(() => preparePalaeoRingPayload(fixture(), { maxVertices: 8 }))
      .toThrow(/vertex ceiling/);
  });
});

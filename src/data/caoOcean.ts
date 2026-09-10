import {
  createPlateRotationEvaluator,
  type PaleomapPlateRotationEvaluator,
  type PaleomapRotationSample,
  type PlateRotationSequence,
  type QuaternionWxyz,
  type UnitDirection,
} from "./paleomapMotion";

export interface CaoTopologySlot {
  sourceFeatureId: string;
  plateId: number;
  coordinateOffset: number;
  coordinateCount: number;
  boundingCap: { centreXyz: UnitDirection; radiusRadians: number };
  interiorPointXyz: UnitDirection;
}

export interface CaoOceanAgeRecord {
  ageMa: number;
  topologySlotIdentitySha256: string;
  topologySlots: CaoTopologySlot[];
  segmentOffset: number;
  segmentCount: number;
  coverage: Record<string, number>;
}

export interface CaoBoundaryFeature {
  sourceFeatureId: string;
  featureType: string;
  plateId: number | null;
  validTimeMa: { oldest: number | null; youngest: number | null };
  subductionPolarity: "Left" | "Right" | null;
}

export interface CaoBoundarySegment {
  ageIndex: number;
  sourceFeatureIndex: number;
  coordinateOffset: number;
  coordinateCount: number;
  leftPlateIds: number[];
  rightPlateIds: number[];
  overridingPlateId?: number | null;
  subductingPlateId?: number | null;
}

export interface CaoBoundaryLink {
  youngerAgeIndex: number;
  youngerSegmentIndex: number;
  olderSegmentIndex: number;
  maximumResampledAngularDistanceRadians: number;
}

interface CaoRotationSequenceSource extends Omit<PlateRotationSequence, "sourceOrder"> {}

export interface CaoOceanMotionCatalog {
  schemaVersion: 1;
  id: "cao-ocean-motion-v1";
  model: {
    id: string;
    version: string;
    sourceRecord: string;
    sourceArchiveSha256: string;
    license: string;
    referenceFrame: "palaeomagnetic";
    anchorPlateId: number;
  };
  binary: {
    path: string;
    bytes: number;
    sha256: string;
    header: string;
    topologyGrid: string;
    continentMask: string;
    coordinates: string;
  };
  grid: { width: number; height: number; longitudes: string; latitudes: string; scaleDegrees: number };
  timeContract: Record<string, unknown>;
  coverage: Record<string, unknown>;
  features: CaoBoundaryFeature[];
  segments: CaoBoundarySegment[];
  boundaryLinks: CaoBoundaryLink[];
  ages: CaoOceanAgeRecord[];
  rotationSequences: CaoRotationSequenceSource[];
  rotationSequenceOrdering: string;
  epistemicStatus: string;
}

export interface CaoOceanMotionData {
  readonly catalog: CaoOceanMotionCatalog;
  readonly topologyRowOffsets: Uint32Array;
  readonly topologyRuns: Uint8Array;
  readonly continentMask: Uint8Array;
  readonly coordinates: Int16Array;
  /** Optional conservative sparse cells appended after the coordinate block. */
  readonly boundaryCandidateAgeOffsets?: Uint32Array;
  readonly boundaryCandidateRecords?: Uint8Array;
}

export type CaoTopologyOwnership =
  | { status: "unknown" }
  | { status: "ambiguous"; topologyIds: string[] }
  | { status: "resolved"; slotIndex: number; topology: CaoTopologySlot };

export interface ResolvedCaoMaterial {
  materialId: string;
  lifecycleId: string;
  seedChart: {
    id: "cao-et-al-2024:plate-rotation-reference";
    direction: UnitDirection;
  };
  kind: "continental-crust" | "oceanic-crust";
  plateId: number;
  referenceAgeMa: number;
  referenceDirection: UnitDirection;
  youngerDirection: UnitDirection;
  olderDirection: UnitDirection;
  youngerTopologyId: string;
  olderTopologyId: string;
  youngerTopologySlotIndex: number;
  olderTopologySlotIndex: number;
  topologyIntervalMa: readonly [number, number];
}

export interface CaoOceanIntervalResolver {
  readonly requestedAgeMa: number;
  readonly youngerAgeMa: number;
  readonly olderAgeMa: number;
  resolveAt(directionAtRequested: UnitDirection): ResolvedCaoMaterial | null;
}

interface DecodedTopology extends CaoTopologySlot {
  slotIndex: number;
  ring: UnitDirection[];
  edgeCrosses: UnitDirection[];
  edgeDots: number[];
  capCosine: number;
  interiorWindingSign: number;
  interiorPoint: UnitDirection;
}

interface BoundaryCellCandidates {
  readonly wordsPerCell: number;
  readonly masks: Uint32Array;
  readonly fullScanCells: Uint8Array;
}

const HEADER_BYTES = 32;
const AGE_STATE_CACHE_LIMIT = 3;
const BOUNDARY_EPSILON = 1e-9;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalize(direction: UnitDirection): UnitDirection {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length < Number.EPSILON) throw new RangeError("direction must be finite and non-zero");
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function dot(left: UnitDirection, right: UnitDirection): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: UnitDirection, right: UnitDirection): UnitDirection {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function inverseQuaternion([w, x, y, z]: QuaternionWxyz): QuaternionWxyz {
  return [w, -x, -y, -z];
}

function composeQuaternion(
  [aw, ax, ay, az]: QuaternionWxyz,
  [bw, bx, by, bz]: QuaternionWxyz,
): QuaternionWxyz {
  const raw: QuaternionWxyz = [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
  const length = Math.hypot(...raw);
  return [raw[0] / length, raw[1] / length, raw[2] / length, raw[3] / length];
}

function rotateUnitDirection([w, x, y, z]: QuaternionWxyz, direction: UnitDirection): UnitDirection {
  const quaternionVector: UnitDirection = [x, y, z];
  const uv = cross(quaternionVector, direction);
  const uuv = cross(quaternionVector, uv);
  return [
    direction[0] + 2 * (w * uv[0] + uuv[0]),
    direction[1] + 2 * (w * uv[1] + uuv[1]),
    direction[2] + 2 * (w * uv[2] + uuv[2]),
  ];
}

function windingNumber(topology: Pick<DecodedTopology, "ring" | "edgeCrosses" | "edgeDots">, direction: UnitDirection): number {
  let winding = 0;
  for (let index = 0; index < topology.ring.length; index += 1) {
    const start = topology.ring[index]!;
    const end = topology.ring[(index + 1) % topology.ring.length]!;
    const startDot = dot(start, direction);
    const endDot = dot(end, direction);
    // A query at a ring vertex is on the boundary. Its antipode makes the
    // tangent-plane projection singular too, but is not a boundary hit.
    if (1 - startDot * startDot < BOUNDARY_EPSILON) {
      return startDot > 0 ? Number.POSITIVE_INFINITY : Number.NaN;
    }
    if (1 - endDot * endDot < BOUNDARY_EPSILON) {
      return endDot > 0 ? Number.POSITIVE_INFINITY : Number.NaN;
    }
    winding += Math.atan2(
      dot(direction, topology.edgeCrosses[index]!),
      topology.edgeDots[index]! - startDot * endDot,
    );
  }
  return winding;
}

function contains(topology: DecodedTopology, direction: UnitDirection): boolean {
  if (dot(topology.boundingCap.centreXyz, direction) + BOUNDARY_EPSILON < topology.capCosine) return false;
  const winding = windingNumber(topology, direction);
  if (winding === Number.POSITIVE_INFINITY || winding * topology.interiorWindingSign > Math.PI) return true;
  if (Number.isNaN(winding)) {
    return topology.capCosine === -1 && hasEvenCrossingParityToInterior(topology, direction);
  }
  if (Math.abs(winding) > Math.PI) return false;
  // A convex bounding cap narrower than a hemisphere makes zero winding an
  // unambiguous exterior result. Reserve the more expensive parity fallback
  // for source polygons whose selected interior spans more than a hemisphere.
  if (topology.capCosine !== -1) return false;
  return hasEvenCrossingParityToInterior(topology, direction);
}

function hasEvenCrossingParityToInterior(topology: DecodedTopology, direction: UnitDirection): boolean {
  let interior = topology.interiorPoint;
  let pathNormal = cross(direction, interior);
  if (Math.hypot(...pathNormal) < 1e-8) {
    if (dot(direction, interior) > 0) return true;
    interior = normalize([interior[0] + 1e-6, interior[1] - 2e-6, interior[2] + 3e-6]);
    pathNormal = cross(direction, interior);
  }
  const intersections: UnitDirection[] = [];
  const liesOnArc = (start: UnitDirection, point: UnitDirection, end: UnitDirection, normal: UnitDirection) =>
    dot(cross(start, point), normal) >= -BOUNDARY_EPSILON &&
    dot(cross(point, end), normal) >= -BOUNDARY_EPSILON;
  for (let index = 0; index < topology.ring.length; index += 1) {
    const start = topology.ring[index]!;
    const end = topology.ring[(index + 1) % topology.ring.length]!;
    const edgeNormal = topology.edgeCrosses[index]!;
    const rawIntersection = cross(pathNormal, edgeNormal);
    if (Math.hypot(...rawIntersection) < BOUNDARY_EPSILON) continue;
    const intersection = normalize(rawIntersection);
    for (const candidate of [intersection, [-intersection[0], -intersection[1], -intersection[2]] as UnitDirection]) {
      if (!liesOnArc(direction, candidate, interior, pathNormal) || !liesOnArc(start, candidate, end, edgeNormal)) continue;
      if (dot(candidate, direction) > 1 - 1e-12 || dot(candidate, interior) > 1 - 1e-12) return true;
      if (!intersections.some((existing) => dot(existing, candidate) > 1 - 1e-12)) intersections.push(candidate);
    }
  }
  return intersections.length % 2 === 0;
}

export function decodeCaoOceanCatalog(value: unknown): CaoOceanMotionCatalog {
  if (!record(value) || value.schemaVersion !== 1 || value.id !== "cao-ocean-motion-v1") {
    throw new Error("unsupported Cao ocean motion catalog");
  }
  if (
    !Array.isArray(value.ages) || value.ages.length !== 109 ||
    !Array.isArray(value.rotationSequences) || !Array.isArray(value.segments) || !Array.isArray(value.boundaryLinks)
  ) {
    throw new Error("Cao ocean motion catalog is missing ages, rotations, or boundary segments");
  }
  const segments = value.segments.map((encoded, index): CaoBoundarySegment => {
    if (
      !Array.isArray(encoded) || encoded.length !== 8 ||
      !encoded.slice(0, 4).every(Number.isInteger) ||
      !Array.isArray(encoded[4]) || !encoded[4].every(Number.isInteger) ||
      !Array.isArray(encoded[5]) || !encoded[5].every(Number.isInteger) ||
      !(encoded[6] === null || Number.isInteger(encoded[6])) ||
      !(encoded[7] === null || Number.isInteger(encoded[7]))
    ) throw new Error(`invalid Cao boundary segment tuple ${index}`);
    return {
      ageIndex: encoded[0] as number,
      sourceFeatureIndex: encoded[1] as number,
      coordinateOffset: encoded[2] as number,
      coordinateCount: encoded[3] as number,
      leftPlateIds: encoded[4] as number[],
      rightPlateIds: encoded[5] as number[],
      overridingPlateId: encoded[6] as number | null,
      subductingPlateId: encoded[7] as number | null,
    };
  });
  const boundaryLinks = value.boundaryLinks.map((encoded, index): CaoBoundaryLink => {
    if (
      !Array.isArray(encoded) || encoded.length !== 4 ||
      !encoded.slice(0, 3).every(Number.isInteger) ||
      !Number.isFinite(encoded[3]) || encoded[3] < 0
    ) throw new Error(`invalid Cao boundary link tuple ${index}`);
    return {
      youngerAgeIndex: encoded[0] as number,
      youngerSegmentIndex: encoded[1] as number,
      olderSegmentIndex: encoded[2] as number,
      maximumResampledAngularDistanceRadians: encoded[3] as number,
    };
  });
  const catalog = { ...value, segments, boundaryLinks } as unknown as CaoOceanMotionCatalog;
  for (let index = 0; index < catalog.ages.length; index += 1) {
    if (catalog.ages[index]!.ageMa !== index * 5 || catalog.ages[index]!.topologySlots.length >= 255) {
      throw new Error(`invalid Cao topology age ${index}`);
    }
  }
  for (const link of catalog.boundaryLinks) {
    const younger = catalog.segments[link.youngerSegmentIndex];
    const older = catalog.segments[link.olderSegmentIndex];
    if (
      link.youngerAgeIndex < 0 || link.youngerAgeIndex >= catalog.ages.length - 1 ||
      younger?.ageIndex !== link.youngerAgeIndex || older?.ageIndex !== link.youngerAgeIndex + 1
    ) throw new Error("invalid Cao boundary link ages");
  }
  return catalog;
}

export function decodeCaoOceanBinary(catalog: CaoOceanMotionCatalog, buffer: ArrayBuffer): CaoOceanMotionData {
  if (buffer.byteLength !== catalog.binary.bytes || buffer.byteLength < HEADER_BYTES) {
    throw new Error("Cao ocean binary byte length mismatch");
  }
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "EHCO" || view.getUint16(4, true) !== 1) {
    throw new Error("unsupported Cao ocean binary");
  }
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const ageCount = view.getUint16(10, true);
  const gridOffset = view.getUint32(12, true);
  const continentOffset = view.getUint32(16, true);
  const coordinateOffset = view.getUint32(20, true);
  const coordinatePairCount = view.getUint32(24, true);
  const boundaryCandidateOffset = view.getUint32(28, true);
  const rowCount = ageCount * height;
  const rowOffsetBytes = (rowCount + 1) * 4;
  if (
    width !== catalog.grid.width || height !== catalog.grid.height || ageCount !== catalog.ages.length ||
    gridOffset !== HEADER_BYTES || continentOffset < gridOffset + rowOffsetBytes ||
    coordinateOffset !== continentOffset + Math.ceil(width * height * ageCount / 8) ||
    (boundaryCandidateOffset === 0
      ? coordinateOffset + coordinatePairCount * 4 !== buffer.byteLength
      : coordinateOffset + coordinatePairCount * 4 !== boundaryCandidateOffset) ||
    boundaryCandidateOffset > buffer.byteLength
  ) throw new Error("invalid Cao ocean binary layout");
  const topologyRowOffsets = new Uint32Array(buffer, gridOffset, rowCount + 1);
  const topologyRuns = new Uint8Array(buffer, gridOffset + rowOffsetBytes, continentOffset - gridOffset - rowOffsetBytes);
  if (topologyRowOffsets[0] !== 0 || topologyRowOffsets[rowCount] !== topologyRuns.length) {
    throw new Error("invalid Cao topology RLE bounds");
  }
  for (let row = 0; row < rowCount; row += 1) {
    const start = topologyRowOffsets[row]!;
    const end = topologyRowOffsets[row + 1]!;
    if (end < start || end > topologyRuns.length || (end - start) % 2 !== 0) {
      throw new Error(`invalid Cao topology RLE offsets at row ${row}`);
    }
  }
  let boundaryCandidateAgeOffsets: Uint32Array | undefined;
  let boundaryCandidateRecords: Uint8Array | undefined;
  if (boundaryCandidateOffset !== 0) {
    const ageOffsetBytes = (ageCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
    if (boundaryCandidateOffset + ageOffsetBytes > buffer.byteLength) {
      throw new Error("invalid Cao boundary candidate offset table");
    }
    boundaryCandidateAgeOffsets = Uint32Array.from(
      { length: ageCount + 1 },
      (_, index) => view.getUint32(boundaryCandidateOffset + index * 4, true),
    );
    boundaryCandidateRecords = new Uint8Array(
      buffer,
      boundaryCandidateOffset + ageOffsetBytes,
      buffer.byteLength - boundaryCandidateOffset - ageOffsetBytes,
    );
    if (
      boundaryCandidateAgeOffsets[0] !== 0 ||
      boundaryCandidateAgeOffsets[ageCount] !== boundaryCandidateRecords.length
    ) throw new Error("invalid Cao boundary candidate bounds");
    for (let ageIndex = 0; ageIndex < ageCount; ageIndex += 1) {
      let offset = boundaryCandidateAgeOffsets[ageIndex]!;
      const end = boundaryCandidateAgeOffsets[ageIndex + 1]!;
      let previousCell = -1;
      if (end < offset || end > boundaryCandidateRecords.length) {
        throw new Error(`invalid Cao boundary candidate age ${ageIndex}`);
      }
      while (offset < end) {
        if (offset + 3 > end) throw new Error(`truncated Cao boundary candidate age ${ageIndex}`);
        const cellIndex = boundaryCandidateRecords[offset]! |
          (boundaryCandidateRecords[offset + 1]! << 8);
        const slotCount = boundaryCandidateRecords[offset + 2]!;
        offset += 3;
        if (
          cellIndex <= previousCell || cellIndex >= width * height ||
          offset + slotCount > end
        ) throw new Error(`invalid Cao boundary candidate record at age ${ageIndex}`);
        previousCell = cellIndex;
        let previousSlot = 0;
        for (let slotOffset = 0; slotOffset < slotCount; slotOffset += 1) {
          const slot = boundaryCandidateRecords[offset + slotOffset]!;
          if (slot <= previousSlot || slot > catalog.ages[ageIndex]!.topologySlots.length) {
            throw new Error(`invalid Cao boundary candidate slot at age ${ageIndex}`);
          }
          previousSlot = slot;
        }
        offset += slotCount;
      }
      if (offset !== end) throw new Error(`invalid Cao boundary candidate terminator at age ${ageIndex}`);
    }
  }
  return {
    catalog,
    topologyRowOffsets,
    topologyRuns,
    continentMask: new Uint8Array(buffer, continentOffset, coordinateOffset - continentOffset),
    coordinates: new Int16Array(buffer, coordinateOffset, coordinatePairCount * 2),
    boundaryCandidateAgeOffsets,
    boundaryCandidateRecords,
  };
}

export async function loadCaoOceanMotionData(
  metadataUrl: string,
  signal?: AbortSignal,
): Promise<CaoOceanMotionData> {
  const metadataResponse = await fetch(metadataUrl, { signal });
  if (!metadataResponse.ok) throw new Error(`Cao ocean metadata request failed: ${metadataResponse.status}`);
  const catalog = decodeCaoOceanCatalog(await metadataResponse.json());
  const binaryUrl = new URL(catalog.binary.path, metadataUrl).toString();
  const binaryResponse = await fetch(binaryUrl, { signal });
  if (!binaryResponse.ok) throw new Error(`Cao ocean binary request failed: ${binaryResponse.status}`);
  return decodeCaoOceanBinary(catalog, await binaryResponse.arrayBuffer());
}

export function createCaoOceanMotionModel(data: CaoOceanMotionData) {
  const ageStateCache = new Map<number, DecodedTopology[]>();
  const ageGridCache = new Map<number, Uint8Array>();
  const boundaryCellCache = new Map<number, BoundaryCellCandidates>();
  const rotationSequences: PlateRotationSequence[] = data.catalog.rotationSequences.map((sequence, sourceOrder) => ({
    ...sequence,
    sourceOrder,
    samples: sequence.samples as PaleomapRotationSample[],
  }));
  const evaluateRotation: PaleomapPlateRotationEvaluator = createPlateRotationEvaluator(
    rotationSequences,
    data.catalog.model.anchorPlateId,
  );
  const longitudeStepDegrees = 360 / data.catalog.grid.width;
  const latitudeStepDegrees = 180 / (data.catalog.grid.height - 1);
  const longitudeStepRadians = longitudeStepDegrees * Math.PI / 180;
  const latitudeStepRadians = latitudeStepDegrees * Math.PI / 180;
  const boundarySampleStepRadians = Math.min(longitudeStepRadians, latitudeStepRadians) / 4;
  // A query assigned to a nearest grid centre can be at most one half-step
  // away in latitude plus one half-step along its parallel. Add half the
  // maximum boundary sample spacing. The sum is deliberately conservative:
  // every cell touched by a packed great-circle edge is therefore unsafe.
  const unsafeCentreRadiusRadians = latitudeStepRadians / 2 + longitudeStepRadians / 2 + boundarySampleStepRadians / 2 + 1e-9;
  const unsafeCentreCosine = Math.cos(unsafeCentreRadiusRadians);
  const unsafeRowRadius = Math.ceil(unsafeCentreRadiusRadians / latitudeStepRadians) + 1;
  const gridCentres: UnitDirection[] = Array.from(
    { length: data.catalog.grid.width * data.catalog.grid.height },
    (_, cellIndex) => {
      const row = Math.floor(cellIndex / data.catalog.grid.width);
      const column = cellIndex % data.catalog.grid.width;
      const longitude = (-180 + longitudeStepDegrees * column) * Math.PI / 180;
      const latitude = (90 - latitudeStepDegrees * row) * Math.PI / 180;
      const cosLatitude = Math.cos(latitude);
      return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)];
    },
  );

  const getAgeState = (ageIndex: number): DecodedTopology[] => {
    const cached = ageStateCache.get(ageIndex);
    if (cached) {
      ageStateCache.delete(ageIndex);
      ageStateCache.set(ageIndex, cached);
      return cached;
    }
    const scale = data.catalog.grid.scaleDegrees * Math.PI / 180;
    const state = data.catalog.ages[ageIndex]!.topologySlots.map((topology, slotIndex): DecodedTopology => {
      const ring = Array.from({ length: topology.coordinateCount }, (_, pointIndex): UnitDirection => {
        const offset = (topology.coordinateOffset + pointIndex) * 2;
        const longitude = data.coordinates[offset]! * scale;
        const latitude = data.coordinates[offset + 1]! * scale;
        const cosLatitude = Math.cos(latitude);
        return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)];
      });
      const edgeCrosses = ring.map((start, index) => cross(start, ring[(index + 1) % ring.length]!));
      const edgeDots = ring.map((start, index) => dot(start, ring[(index + 1) % ring.length]!));
      const windingAtInterior = windingNumber({ ring, edgeCrosses, edgeDots }, normalize(topology.interiorPointXyz));
      return {
        ...topology,
        slotIndex,
        ring,
        edgeCrosses,
        edgeDots,
        // A cap wider than a hemisphere is not geodesically convex, so its
        // boundary does not safely bound every point in the selected interior.
        capCosine: topology.boundingCap.radiusRadians > Math.PI / 2
          ? -1
          : Math.cos(topology.boundingCap.radiusRadians + 2 * scale),
        interiorWindingSign: windingAtInterior < 0 ? -1 : 1,
        interiorPoint: normalize(topology.interiorPointXyz),
      };
    });
    if (ageStateCache.size >= AGE_STATE_CACHE_LIMIT) ageStateCache.delete(ageStateCache.keys().next().value!);
    ageStateCache.set(ageIndex, state);
    return state;
  };

  const gridCellNormalized = ([x, y, z]: UnitDirection): [number, number] => {
    const longitude = Math.atan2(y, x) * 180 / Math.PI;
    const latitude = Math.asin(z) * 180 / Math.PI;
    return [
      Math.round((longitude + 180) / 2) % data.catalog.grid.width,
      Math.max(0, Math.min(data.catalog.grid.height - 1, Math.round((90 - latitude) / 2))),
    ];
  };

  const getBoundaryCells = (ageIndex: number): BoundaryCellCandidates => {
    const cached = boundaryCellCache.get(ageIndex);
    if (cached) {
      boundaryCellCache.delete(ageIndex);
      boundaryCellCache.set(ageIndex, cached);
      return cached;
    }
    const { width, height } = data.catalog.grid;
    const state = getAgeState(ageIndex);
    const wordsPerCell = Math.max(1, Math.ceil(state.length / 32));
    const masks = new Uint32Array(width * height * wordsPerCell);
    const fullScanCells = new Uint8Array(width * height);
    const precomputedOffsets = data.boundaryCandidateAgeOffsets;
    const precomputedRecords = data.boundaryCandidateRecords;
    if (precomputedOffsets !== undefined && precomputedRecords !== undefined) {
      let offset = precomputedOffsets[ageIndex]!;
      const end = precomputedOffsets[ageIndex + 1]!;
      while (offset < end) {
        const cellIndex = precomputedRecords[offset]! | (precomputedRecords[offset + 1]! << 8);
        const slotCount = precomputedRecords[offset + 2]!;
        offset += 3;
        if (slotCount === 0) {
          fullScanCells[cellIndex] = 1;
        } else {
          for (let slotOffset = 0; slotOffset < slotCount; slotOffset += 1) {
            const slotIndex = precomputedRecords[offset + slotOffset]! - 1;
            masks[cellIndex * wordsPerCell + (slotIndex >> 5)]! |= 1 << (slotIndex & 31);
          }
        }
        offset += slotCount;
      }
      const result = { wordsPerCell, masks, fullScanCells };
      if (boundaryCellCache.size >= AGE_STATE_CACHE_LIMIT) boundaryCellCache.delete(boundaryCellCache.keys().next().value!);
      boundaryCellCache.set(ageIndex, result);
      return result;
    }
    const mark = (direction: UnitDirection, slotIndex: number) => {
      const [, row] = gridCellNormalized(direction);
      for (let rowDelta = -unsafeRowRadius; rowDelta <= unsafeRowRadius; rowDelta += 1) {
        const markedRow = row + rowDelta;
        if (markedRow < 0 || markedRow >= height) continue;
        const rowOffset = markedRow * width;
        for (let markedColumn = 0; markedColumn < width; markedColumn += 1) {
          if (dot(direction, gridCentres[rowOffset + markedColumn]!) >= unsafeCentreCosine) {
            const cellIndex = rowOffset + markedColumn;
            masks[cellIndex * wordsPerCell + (slotIndex >> 5)]! |= 1 << (slotIndex & 31);
          }
        }
      }
    };
    for (const topology of state) {
      for (let index = 0; index < topology.ring.length; index += 1) {
        const start = topology.ring[index]!;
        const end = topology.ring[(index + 1) % topology.ring.length]!;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(start, end))));
        const steps = Math.max(1, Math.ceil(angle / boundarySampleStepRadians));
        const sine = Math.sin(angle);
        for (let step = 0; step <= steps; step += 1) {
          const fraction = step / steps;
          const point = sine < 1e-12
            ? start
            : normalize([
              (Math.sin((1 - fraction) * angle) * start[0] + Math.sin(fraction * angle) * end[0]) / sine,
              (Math.sin((1 - fraction) * angle) * start[1] + Math.sin(fraction * angle) * end[1]) / sine,
              (Math.sin((1 - fraction) * angle) * start[2] + Math.sin(fraction * angle) * end[2]) / sine,
            ]);
          mark(point, topology.slotIndex);
        }
      }
    }
    const result = { wordsPerCell, masks, fullScanCells };
    if (boundaryCellCache.size >= AGE_STATE_CACHE_LIMIT) boundaryCellCache.delete(boundaryCellCache.keys().next().value!);
    boundaryCellCache.set(ageIndex, result);
    return result;
  };

  const ownershipAt = (ageIndex: number, rawDirection: UnitDirection): CaoTopologyOwnership => {
    const direction = normalize(rawDirection);
    const state = getAgeState(ageIndex);
    const [column, row] = gridCellNormalized(direction);
    const candidateSlot = getAgeGrid(ageIndex)[row * data.catalog.grid.width + column]!;
    const cellIndex = row * data.catalog.grid.width + column;
    const boundaryCells = getBoundaryCells(ageIndex);
    const maskOffset = cellIndex * boundaryCells.wordsPerCell;
    let boundaryCell = boundaryCells.fullScanCells[cellIndex] !== 0;
    for (let word = 0; word < boundaryCells.wordsPerCell; word += 1) {
      if (boundaryCells.masks[maskOffset + word] !== 0) {
        boundaryCell = true;
        break;
      }
    }
    if (!boundaryCell) {
      if (candidateSlot === 0) return { status: "unknown" };
      if (candidateSlot === 255) {
        // Ambiguity identity is not stored in the compact grid. This path is
        // normally unreachable because overlap boundaries mark a cell unsafe,
        // but retain exact rings if a broad nested overlap leaves a safe cell.
      } else {
        const topology = state[candidateSlot - 1];
        if (topology) return { status: "resolved", slotIndex: topology.slotIndex, topology };
      }
    }
    if (candidateSlot === 255 || boundaryCells.fullScanCells[cellIndex] !== 0) {
      return ownershipAtExact(ageIndex, direction, candidateSlot);
    }
    const candidateIndexes: number[] = [];
    for (let word = 0; word < boundaryCells.wordsPerCell; word += 1) {
      let bits = boundaryCells.masks[maskOffset + word]!;
      while (bits !== 0) {
        const lowestBit = bits & -bits;
        const bit = 31 - Math.clz32(lowestBit);
        candidateIndexes.push(word * 32 + bit);
        bits ^= lowestBit;
      }
    }
    if (candidateSlot > 0 && !candidateIndexes.includes(candidateSlot - 1)) {
      candidateIndexes.unshift(candidateSlot - 1);
    }
    return ownershipAmong(state, direction, candidateIndexes);
  };

  const ownershipAmong = (
    state: DecodedTopology[],
    direction: UnitDirection,
    candidateIndexes: readonly number[],
  ): CaoTopologyOwnership => {
    const matches: DecodedTopology[] = [];
    for (const index of candidateIndexes) {
      const topology = state[index];
      if (topology && contains(topology, direction)) matches.push(topology);
    }
    if (matches.length === 0) return { status: "unknown" };
    if (matches.length > 1) return { status: "ambiguous", topologyIds: matches.map(({ sourceFeatureId }) => sourceFeatureId) };
    const topology = matches[0]!;
    return { status: "resolved", slotIndex: topology.slotIndex, topology };
  };

  const ownershipAtExact = (
    ageIndex: number,
    direction: UnitDirection,
    candidateSlot = candidateSlotAt(ageIndex, direction),
  ): CaoTopologyOwnership => {
    const state = getAgeState(ageIndex);
    const candidateIndexes = state.map((_, index) => index);
    if (candidateSlot > 0 && candidateSlot < 255) {
      candidateIndexes.splice(candidateSlot - 1, 1);
      candidateIndexes.unshift(candidateSlot - 1);
    }
    return ownershipAmong(state, direction, candidateIndexes);
  };

  const getAgeGrid = (ageIndex: number): Uint8Array => {
    const cached = ageGridCache.get(ageIndex);
    if (cached) {
      ageGridCache.delete(ageIndex);
      ageGridCache.set(ageIndex, cached);
      return cached;
    }
    const grid = new Uint8Array(data.catalog.grid.width * data.catalog.grid.height);
    for (let rowWithinAge = 0; rowWithinAge < data.catalog.grid.height; rowWithinAge += 1) {
      const globalRow = ageIndex * data.catalog.grid.height + rowWithinAge;
      let runOffset = data.topologyRowOffsets[globalRow]!;
      const runEnd = data.topologyRowOffsets[globalRow + 1]!;
      let column = 0;
      while (runOffset < runEnd) {
        const value = data.topologyRuns[runOffset++]!;
        const length = data.topologyRuns[runOffset++]!;
        grid.fill(value, rowWithinAge * data.catalog.grid.width + column, rowWithinAge * data.catalog.grid.width + column + length);
        column += length;
      }
      if (column !== data.catalog.grid.width) throw new Error(`invalid Cao topology RLE row ${globalRow}`);
    }
    if (ageGridCache.size >= AGE_STATE_CACHE_LIMIT) ageGridCache.delete(ageGridCache.keys().next().value!);
    ageGridCache.set(ageIndex, grid);
    return grid;
  };

  const candidateSlotAt = (ageIndex: number, rawDirection: UnitDirection): number => {
    const [longitudeIndex, latitudeIndex] = gridCellNormalized(normalize(rawDirection));
    return getAgeGrid(ageIndex)[latitudeIndex * data.catalog.grid.width + longitudeIndex]!;
  };

  const isContinentalDirection = (ageIndex: number, direction: UnitDirection): boolean => {
    const [longitudeIndex, latitudeIndex] = gridCellNormalized(direction);
    const cellIndex = ageIndex * data.catalog.grid.width * data.catalog.grid.height + latitudeIndex * data.catalog.grid.width + longitudeIndex;
    return Boolean(data.continentMask[cellIndex >> 3]! & (1 << (cellIndex & 7)));
  };

  const isContinentalAt = (ageIndex: number, direction: UnitDirection): boolean =>
    isContinentalDirection(ageIndex, normalize(direction));

  const createIntervalResolver = (
    requestedAgeMa: number,
    youngerAgeMa: number,
    olderAgeMa: number,
  ): CaoOceanIntervalResolver => {
    if (![requestedAgeMa, youngerAgeMa, olderAgeMa].every(Number.isFinite) || requestedAgeMa < youngerAgeMa || requestedAgeMa > olderAgeMa) {
      throw new RangeError("invalid Cao ocean interval");
    }
    const youngerAgeIndex = data.catalog.ages.findIndex(({ ageMa }) => ageMa === youngerAgeMa);
    const olderAgeIndex = data.catalog.ages.findIndex(({ ageMa }) => ageMa === olderAgeMa);
    if (youngerAgeIndex < 0 || olderAgeIndex < 0) throw new RangeError("Cao interval endpoints must be native ages");
    const youngerState = getAgeState(youngerAgeIndex);
    const olderState = getAgeState(olderAgeIndex);
    const plateIds = [...new Set([...youngerState, ...olderState].map(({ plateId }) => plateId))].sort((left, right) => right - left);
    const youngerByPlate = new Map(plateIds.map((plateId) => [plateId, youngerState.filter((topology) => topology.plateId === plateId)]));
    const olderByPlate = new Map(plateIds.map((plateId) => [plateId, olderState.filter((topology) => topology.plateId === plateId)]));
    const candidates = plateIds.flatMap((plateId) => {
      const youngerTopologies = youngerByPlate.get(plateId)!;
      const olderTopologies = olderByPlate.get(plateId)!;
      const requestedRotation = evaluateRotation(plateId, requestedAgeMa);
      const youngerRotation = evaluateRotation(plateId, youngerAgeMa);
      const olderRotation = evaluateRotation(plateId, olderAgeMa);
      if (!requestedRotation || !youngerRotation || !olderRotation) return [];
      const requestedInverse = inverseQuaternion(requestedRotation);
      const requestedToYounger = composeQuaternion(youngerRotation, requestedInverse);
      const requestedToOlder = composeQuaternion(olderRotation, requestedInverse);
      const youngerToRequested = composeQuaternion(requestedRotation, inverseQuaternion(youngerRotation));
      const olderToRequested = composeQuaternion(requestedRotation, inverseQuaternion(olderRotation));
      const youngerCaps = youngerTopologies.map((topology) => ({
        centre: rotateUnitDirection(youngerToRequested, topology.boundingCap.centreXyz),
        cosine: topology.capCosine,
      }));
      const olderCaps = olderTopologies.map((topology) => ({
        centre: rotateUnitDirection(olderToRequested, topology.boundingCap.centreXyz),
        cosine: topology.capCosine,
      }));
      return youngerCaps.length > 0 && olderCaps.length > 0
        ? [{ plateId, requestedInverse, requestedToYounger, requestedToOlder, youngerCaps, olderCaps }]
        : [];
    });
    return {
      requestedAgeMa,
      youngerAgeMa,
      olderAgeMa,
      resolveAt(rawDirection): ResolvedCaoMaterial | null {
        const requestedDirection = normalize(rawDirection);
        const matches: ResolvedCaoMaterial[] = [];
        for (const candidate of candidates) {
          const { plateId, requestedInverse, requestedToYounger, requestedToOlder, youngerCaps, olderCaps } = candidate;
          if (
            !youngerCaps.some(({ centre, cosine }) => dot(centre, requestedDirection) + BOUNDARY_EPSILON >= cosine) ||
            !olderCaps.some(({ centre, cosine }) => dot(centre, requestedDirection) + BOUNDARY_EPSILON >= cosine)
          ) continue;
          const youngerDirection = requestedAgeMa === youngerAgeMa
            ? requestedDirection
            : rotateUnitDirection(requestedToYounger, requestedDirection);
          const olderDirection = requestedAgeMa === olderAgeMa
            ? requestedDirection
            : rotateUnitDirection(requestedToOlder, requestedDirection);
          // Perform exact/global endpoint ownership only after the requested-age
          // caps identify a surviving plate candidate. This preserves a source
          // overlap that exists at only one endpoint without repeating global
          // topology scans for every plate.
          const youngerOwnership = ownershipAt(youngerAgeIndex, youngerDirection);
          const olderOwnership = ownershipAt(olderAgeIndex, olderDirection);
          if (youngerOwnership.status !== "resolved" || olderOwnership.status !== "resolved") continue;
          if (youngerOwnership.topology.plateId !== plateId || olderOwnership.topology.plateId !== plateId) continue;
          const youngerContinental = isContinentalDirection(youngerAgeIndex, youngerDirection);
          const olderContinental = isContinentalDirection(olderAgeIndex, olderDirection);
          if (youngerContinental !== olderContinental) continue;
          const lifecycleId = `cao:${youngerAgeMa}-${olderAgeMa}:${plateId}:${youngerOwnership.topology.sourceFeatureId}:${olderOwnership.topology.sourceFeatureId}`;
          const seedDirection = rotateUnitDirection(requestedInverse, requestedDirection);
          matches.push({
            materialId: lifecycleId,
            lifecycleId,
            seedChart: { id: "cao-et-al-2024:plate-rotation-reference", direction: seedDirection },
            kind: youngerContinental ? "continental-crust" : "oceanic-crust",
            plateId,
            referenceAgeMa: youngerAgeMa,
            referenceDirection: youngerDirection,
            youngerDirection: requestedAgeMa === youngerAgeMa ? rawDirection : youngerDirection,
            olderDirection: requestedAgeMa === olderAgeMa ? rawDirection : olderDirection,
            youngerTopologyId: youngerOwnership.topology.sourceFeatureId,
            olderTopologyId: olderOwnership.topology.sourceFeatureId,
            youngerTopologySlotIndex: youngerOwnership.slotIndex,
            olderTopologySlotIndex: olderOwnership.slotIndex,
            topologyIntervalMa: [youngerAgeMa, olderAgeMa],
          });
          if (matches.length > 1) return null;
        }
        return matches[0] ?? null;
      },
    };
  };

  return {
    data,
    evaluateRotation,
    ownershipAt,
    ownershipAtExact(ageIndex: number, rawDirection: UnitDirection) {
      const direction = normalize(rawDirection);
      return ownershipAtExact(ageIndex, direction);
    },
    isOwnershipCellUnsafeAt(ageIndex: number, rawDirection: UnitDirection) {
      const [column, row] = gridCellNormalized(normalize(rawDirection));
      const cellIndex = row * data.catalog.grid.width + column;
      const { masks, wordsPerCell, fullScanCells } = getBoundaryCells(ageIndex);
      if (fullScanCells[cellIndex] !== 0) return true;
      for (let word = 0; word < wordsPerCell; word += 1) {
        if (masks[cellIndex * wordsPerCell + word] !== 0) return true;
      }
      return false;
    },
    candidateSlotAt,
    isContinentalAt,
    createIntervalResolver,
    get cachedAgeStateCount() { return ageStateCache.size; },
    get cachedAgeGridCount() { return ageGridCache.size; },
    get cachedBoundaryCellCount() { return boundaryCellCache.size; },
    ageStateCacheLimit: AGE_STATE_CACHE_LIMIT,
  };
}

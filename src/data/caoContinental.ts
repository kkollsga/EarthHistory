import {
  resolvePlateDirectionFromReference,
  resolvePlateReferenceDirection,
  type PaleomapPlateRotationEvaluator,
  type UnitDirection,
} from "./paleomapMotion";

export interface CaoContinentalFragment {
  fragmentId: string;
  sourceFeatureId: string;
  plateId: number;
  featureType: string;
  validTimeMa: { oldest: number | null; youngest: number | null };
  sourceOrder: number;
  areaSteradians: number;
  rings: Array<readonly [coordinateOffset: number, coordinateCount: number]>;
  boundingCap: { centreXyz: UnitDirection; radiusRadians: number };
}

export interface CaoContinentalCatalog {
  schemaVersion: 1;
  id: "cao-continental-motion-v1";
  model: {
    id: "cao-et-al-2024";
    version: "2.4";
    sourceRecord: string;
    sourceArchiveSha256: string;
    license: "CC-BY-4.0";
    referenceFrame: "palaeomagnetic";
    anchorPlateId: 0;
  };
  binary: { path: string; bytes: number; sha256: string };
  coordinateEncoding: {
    scaleDegrees: number;
    referenceAgeMa: 0;
    axisConvention: "GPlates unit sphere: x=lon 0, y=lon 90E, z=north";
  };
  fragments: CaoContinentalFragment[];
  skippedGeometrylessFeatureIds: string[];
}

export interface CaoContinentalData {
  catalog: CaoContinentalCatalog;
  coordinates: Int16Array;
}

export interface ResolvedCaoContinentalMaterial {
  fragmentId: string;
  sourceFeatureId: string;
  plateId: number;
  featureType: string;
  ageMa: number;
  directionAtAge: UnitDirection;
  referenceDirection: UnitDirection;
  validTimeMa: { oldest: number | null; youngest: number | null };
}

interface DecodedRing {
  points: UnitDirection[];
  edgeCrosses: UnitDirection[];
  edgeDots: number[];
}

interface DecodedFragment extends CaoContinentalFragment {
  decodedRings: DecodedRing[];
  capCosine: number;
  capRadiusRadians: number;
}

interface AgePose {
  candidates: Array<{ fragment: DecodedFragment; reconstructedCapCentre: UnitDirection }>;
  cellCandidates: Array<Uint16Array | false | undefined>;
  cellCandidateBytes: number;
}

export interface CaoContinentalMaterialModelOptions {
  /** Disable only for exact-oracle comparisons. Runtime ownership stays identical. */
  useSpatialIndex?: boolean;
  /** Numeric candidate storage per cached age pose; excess cells use the full exact list. */
  spatialIndexByteLimitPerAge?: number;
}

const HEADER_BYTES = 16;
const BOUNDARY_EPSILON = 1e-9;
// One fractional surface needs the requested age, both source endpoints, and
// the 0 Ma material-reference partition without rebuilding candidate caps.
const AGE_CACHE_LIMIT = 4;
const SPATIAL_CELL_DEGREES = 10;
const SPATIAL_COLUMNS = 360 / SPATIAL_CELL_DEGREES;
const SPATIAL_ROWS = 180 / SPATIAL_CELL_DEGREES;
const SPATIAL_CELL_COUNT = SPATIAL_COLUMNS * SPATIAL_ROWS;
const DEFAULT_SPATIAL_INDEX_BYTE_LIMIT_PER_AGE = 192 * 1024;

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

function directionAt(longitudeDegrees: number, latitudeDegrees: number): UnitDirection {
  const longitude = longitudeDegrees * Math.PI / 180;
  const latitude = latitudeDegrees * Math.PI / 180;
  const cosine = Math.cos(latitude);
  return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
}

interface SpatialCell {
  index: number;
  centre: UnitDirection;
  radiusRadians: number;
}

function createSpatialCell(index: number): SpatialCell {
  const row = Math.floor(index / SPATIAL_COLUMNS);
  const column = index % SPATIAL_COLUMNS;
  const west = -180 + column * SPATIAL_CELL_DEGREES;
  const south = -90 + row * SPATIAL_CELL_DEGREES;
  const centre = directionAt(west + SPATIAL_CELL_DEGREES / 2, south + SPATIAL_CELL_DEGREES / 2);
  const radiusRadians = Math.max(
    Math.acos(Math.max(-1, Math.min(1, dot(centre, directionAt(west, south))))),
    Math.acos(Math.max(-1, Math.min(1, dot(centre, directionAt(west + SPATIAL_CELL_DEGREES, south))))),
    Math.acos(Math.max(-1, Math.min(1, dot(centre, directionAt(west, south + SPATIAL_CELL_DEGREES))))),
    Math.acos(Math.max(-1, Math.min(1, dot(centre, directionAt(west + SPATIAL_CELL_DEGREES, south + SPATIAL_CELL_DEGREES))))),
  ) + BOUNDARY_EPSILON;
  return { index, centre, radiusRadians };
}

const SPATIAL_CELLS = Array.from({ length: SPATIAL_CELL_COUNT }, (_, index) => createSpatialCell(index));

function cellForDirection(direction: UnitDirection): SpatialCell {
  const longitude = Math.atan2(direction[1], direction[0]) * 180 / Math.PI;
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180 / Math.PI;
  const column = Math.max(0, Math.min(SPATIAL_COLUMNS - 1, Math.floor((longitude + 180) / SPATIAL_CELL_DEGREES)));
  const row = Math.max(0, Math.min(SPATIAL_ROWS - 1, Math.floor((latitude + 90) / SPATIAL_CELL_DEGREES)));
  return SPATIAL_CELLS[row * SPATIAL_COLUMNS + column]!;
}

function containsRing(ring: DecodedRing, direction: UnitDirection): boolean {
  let winding = 0;
  for (let index = 0; index < ring.points.length; index += 1) {
    const start = ring.points[index]!;
    const end = ring.points[(index + 1) % ring.points.length]!;
    const startDot = dot(start, direction);
    const endDot = dot(end, direction);
    if (1 - startDot * startDot < BOUNDARY_EPSILON || 1 - endDot * endDot < BOUNDARY_EPSILON) return true;
    winding += Math.atan2(
      dot(direction, ring.edgeCrosses[index]!),
      ring.edgeDots[index]! - startDot * endDot,
    );
  }
  return Math.abs(winding) > Math.PI;
}

function activeAt(fragment: CaoContinentalFragment, ageMa: number): boolean {
  const { oldest, youngest } = fragment.validTimeMa;
  return (oldest === null || ageMa <= oldest) && (youngest === null || ageMa >= youngest);
}

export function decodeCaoContinentalCatalog(value: unknown): CaoContinentalCatalog {
  const catalog = value as CaoContinentalCatalog;
  if (
    !catalog || catalog.schemaVersion !== 1 || catalog.id !== "cao-continental-motion-v1" ||
    !Array.isArray(catalog.fragments) || catalog.fragments.length !== 869 ||
    catalog.coordinateEncoding.referenceAgeMa !== 0 ||
    catalog.coordinateEncoding.axisConvention !== "GPlates unit sphere: x=lon 0, y=lon 90E, z=north"
  ) throw new Error("unsupported Cao continental catalog");
  return catalog;
}

export function decodeCaoContinentalBinary(catalog: CaoContinentalCatalog, buffer: ArrayBuffer): CaoContinentalData {
  if (buffer.byteLength !== catalog.binary.bytes || buffer.byteLength < HEADER_BYTES) {
    throw new Error("Cao continental binary byte length mismatch");
  }
  const view = new DataView(buffer);
  if (
    String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "EHCN" ||
    view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 0 || view.getUint32(12, true) !== 0 ||
    HEADER_BYTES + view.getUint32(8, true) * 4 !== buffer.byteLength
  ) throw new Error("unsupported Cao continental binary");
  return { catalog, coordinates: new Int16Array(buffer, HEADER_BYTES, view.getUint32(8, true) * 2) };
}

export async function loadCaoContinentalData(metadataUrl: string, signal?: AbortSignal): Promise<CaoContinentalData> {
  const response = await fetch(metadataUrl, { signal });
  if (!response.ok) throw new Error(`Cao continental metadata request failed: ${response.status}`);
  const catalog = decodeCaoContinentalCatalog(await response.json());
  const binaryResponse = await fetch(new URL(catalog.binary.path, metadataUrl), { signal });
  if (!binaryResponse.ok) throw new Error(`Cao continental binary request failed: ${binaryResponse.status}`);
  return decodeCaoContinentalBinary(catalog, await binaryResponse.arrayBuffer());
}

export function createCaoContinentalMaterialModel(
  data: CaoContinentalData,
  evaluateRotation: PaleomapPlateRotationEvaluator,
  options: CaoContinentalMaterialModelOptions = {},
) {
  const useSpatialIndex = options.useSpatialIndex ?? true;
  const requestedSpatialIndexByteLimit = options.spatialIndexByteLimitPerAge ??
    DEFAULT_SPATIAL_INDEX_BYTE_LIMIT_PER_AGE;
  const spatialIndexByteLimitPerAge = Number.isFinite(requestedSpatialIndexByteLimit)
    ? Math.max(0, Math.floor(requestedSpatialIndexByteLimit))
    : DEFAULT_SPATIAL_INDEX_BYTE_LIMIT_PER_AGE;
  const scale = data.catalog.coordinateEncoding.scaleDegrees * Math.PI / 180;
  const fragments: DecodedFragment[] = data.catalog.fragments.map((fragment) => {
    const decodedRings = fragment.rings.map(([offset, count]): DecodedRing => {
      const points = Array.from({ length: count }, (_, index): UnitDirection => {
        const pair = (offset + index) * 2;
        const longitude = data.coordinates[pair]! * scale;
        const latitude = data.coordinates[pair + 1]! * scale;
        const cosLatitude = Math.cos(latitude);
        return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)];
      });
      return {
        points,
        edgeCrosses: points.map((point, index) => cross(point, points[(index + 1) % points.length]!)),
        edgeDots: points.map((point, index) => dot(point, points[(index + 1) % points.length]!)),
      };
    });
    return {
      ...fragment,
      decodedRings,
      capRadiusRadians: Math.min(Math.PI, fragment.boundingCap.radiusRadians + 2 * scale),
      capCosine: Math.cos(Math.min(Math.PI, fragment.boundingCap.radiusRadians + 2 * scale)),
    };
  });
  const ageCache = new Map<number, AgePose>();
  const candidatesAt = (ageMa: number) => {
    const cached = ageCache.get(ageMa);
    if (cached) {
      ageCache.delete(ageMa);
      ageCache.set(ageMa, cached);
      return cached;
    }
    const candidates = fragments
      .filter((fragment) => activeAt(fragment, ageMa))
      .flatMap((fragment) => {
        const centre = resolvePlateDirectionFromReference(
          evaluateRotation, fragment.plateId, fragment.boundingCap.centreXyz, ageMa,
        );
        return centre ? [{ fragment, reconstructedCapCentre: centre }] : [];
      })
      .sort((left, right) =>
        right.fragment.areaSteradians - left.fragment.areaSteradians ||
        left.fragment.sourceOrder - right.fragment.sourceOrder);
    if (ageCache.size >= AGE_CACHE_LIMIT) ageCache.delete(ageCache.keys().next().value!);
    const pose: AgePose = {
      candidates,
      cellCandidates: Array.from({ length: SPATIAL_CELL_COUNT }),
      cellCandidateBytes: 0,
    };
    ageCache.set(ageMa, pose);
    return pose;
  };
  const candidateIndicesAt = (pose: AgePose, direction: UnitDirection): Uint16Array | null => {
    if (!useSpatialIndex) return null;
    const cell = cellForDirection(direction);
    const cached = pose.cellCandidates[cell.index];
    if (cached === false) return null;
    if (cached !== undefined) return cached;
    const indices: number[] = [];
    for (let index = 0; index < pose.candidates.length; index += 1) {
      const { fragment, reconstructedCapCentre } = pose.candidates[index]!;
      const supportRadius = Math.min(Math.PI, fragment.capRadiusRadians + cell.radiusRadians);
      if (
        supportRadius >= Math.PI ||
        dot(reconstructedCapCentre, cell.centre) + BOUNDARY_EPSILON >= Math.cos(supportRadius)
      ) indices.push(index);
    }
    const addedBytes = indices.length * Uint16Array.BYTES_PER_ELEMENT;
    if (pose.cellCandidateBytes + addedBytes > spatialIndexByteLimitPerAge) {
      pose.cellCandidates[cell.index] = false;
      return null;
    }
    const compact = Uint16Array.from(indices);
    pose.cellCandidates[cell.index] = compact;
    pose.cellCandidateBytes += compact.byteLength;
    return compact;
  };
  const resolveCandidate = (
    candidate: AgePose["candidates"][number],
    directionAtAge: UnitDirection,
    ageMa: number,
  ): ResolvedCaoContinentalMaterial | null => {
    const { fragment, reconstructedCapCentre } = candidate;
    if (dot(reconstructedCapCentre, directionAtAge) + BOUNDARY_EPSILON < fragment.capCosine) return null;
    const referenceDirection = resolvePlateReferenceDirection(
      evaluateRotation, fragment.plateId, directionAtAge, ageMa,
    );
    if (!referenceDirection || !containsRing(fragment.decodedRings[0]!, referenceDirection)) return null;
    if (fragment.decodedRings.slice(1).some((ring) => containsRing(ring, referenceDirection))) return null;
    return {
      fragmentId: fragment.fragmentId,
      sourceFeatureId: fragment.sourceFeatureId,
      plateId: fragment.plateId,
      featureType: fragment.featureType,
      ageMa,
      directionAtAge,
      referenceDirection,
      validTimeMa: fragment.validTimeMa,
    };
  };
  return {
    resolveAt(ageMa: number, rawDirection: UnitDirection): ResolvedCaoContinentalMaterial | null {
      if (!Number.isFinite(ageMa) || ageMa < 0 || ageMa > 540) return null;
      const directionAtAge = normalize(rawDirection);
      const pose = candidatesAt(ageMa);
      const indices = candidateIndicesAt(pose, directionAtAge);
      if (indices === null) {
        for (const candidate of pose.candidates) {
          const result = resolveCandidate(candidate, directionAtAge, ageMa);
          if (result !== null) return result;
        }
      } else {
        for (const index of indices) {
          const result = resolveCandidate(pose.candidates[index]!, directionAtAge, ageMa);
          if (result !== null) return result;
        }
      }
      return null;
    },
    get cachedAgeCount() { return ageCache.size; },
    get cachedSpatialIndexBytes() {
      return [...ageCache.values()].reduce((total, pose) => total + pose.cellCandidateBytes, 0);
    },
    get cachedSpatialIndexCellCount() {
      return [...ageCache.values()].reduce((total, pose) =>
        total + pose.cellCandidates.filter((value) => value instanceof Uint16Array).length, 0);
    },
    get cachedSpatialIndexFallbackCellCount() {
      return [...ageCache.values()].reduce((total, pose) =>
        total + pose.cellCandidates.filter((value) => value === false).length, 0);
    },
    ageCacheLimit: AGE_CACHE_LIMIT,
    spatialIndexByteLimitPerAge,
    spatialIndexCellDegrees: SPATIAL_CELL_DEGREES,
  };
}

/** GPlates unit vector: x=cos(lat)cos(lon), y=cos(lat)sin(lon), z=sin(lat). */
export type UnitDirection = readonly [number, number, number];
export type QuaternionWxyz = readonly [number, number, number, number];

export interface PaleomapMotionFragment {
  fragmentId: string;
  sourceFeatureId: string;
  sourceFeatureIndex: number;
  geometryIndex: number;
  plateId: number;
  validTimeMa: { oldest: number | null; youngest: number | null };
  coordinateOffset: number;
  coordinateCount: number;
  referenceBoundingCap: { centreXyz: UnitDirection; radiusRadians: number };
}

export interface PaleomapRotationSample {
  ageMa: number;
  quaternionWxyz: QuaternionWxyz;
}

export interface PaleomapRotationSequence {
  sequenceId: string;
  sourceOrder: number;
  movingPlateId: number;
  fixedPlateId: number;
  sampleRangeMa: { youngest: number; oldest: number };
  endpointInclusion: { youngest: boolean; oldest: boolean };
  samples: PaleomapRotationSample[];
}

export type PlateRotationSequence = Pick<
  PaleomapRotationSequence,
  "sourceOrder" | "movingPlateId" | "fixedPlateId" | "sampleRangeMa" | "endpointInclusion" | "samples"
>;

export interface PaleomapMotionCatalog {
  schemaVersion: 1;
  id: "paleomap-rigid-material-motion-v1";
  model: {
    id: string;
    underlyingModelVersion: string;
    sourceRecord: string;
    sourceArchiveUrl: string;
    sourceArchiveSha256: string;
    rotationMemberSha256: string;
    polygonMemberSha256: string;
    license: string;
    referenceFrame: string;
    anchorPlateId: number;
  };
  paleoDemCompatibility: {
    sourceRecord: string;
    sourceVersion: string;
    reportEvidence: string;
    rotationHeaderEvidence: string;
    supportedSourceAgesMa: number[];
  };
  coordinateEncoding: {
    type: "flat-int16-longitude-latitude";
    scaleDegrees: number;
    referenceAgeMa: number;
    polygonRingsAreImplicitlyClosed: boolean;
  };
  reconstruction: Record<string, string>;
  coverage: {
    classification: string;
    probe: string;
    samples: Array<{
      ageMa: number;
      assignedPoints: number;
      totalPoints: number;
      assignedFraction: number;
      representedFeatureCount: number;
      representedPlateCount: number;
    }>;
    limitations: string[];
  };
  fragments: PaleomapMotionFragment[];
  excludedGeometries: Array<{
    sourceFeatureId: string;
    geometryIndex: number;
    reason: string;
  }>;
  coordinates: number[];
  rotationSequences: PaleomapRotationSequence[];
  poiPlateIds: Record<string, number>;
  sourceCounts: Record<string, number>;
  evidence: string;
  epistemicStatus: string;
}

export interface ResolvedPaleomapMaterial {
  fragmentId: string;
  plateId: number;
  referenceDirection: UnitDirection;
  youngerDirection: UnitDirection;
  olderDirection: UnitDirection;
}

export interface PaleomapIntervalResolver {
  readonly requestedAgeMa: number;
  readonly youngerAgeMa: number;
  readonly olderAgeMa: number;
  readonly activeFragmentCount: number;
  resolveAt(directionAtRequested: UnitDirection): ResolvedPaleomapMaterial | null;
}

export interface PaleomapPlateRotationEvaluator {
  (plateId: number, ageMa: number): QuaternionWxyz | null;
  /** Diagnostic surface used to verify that fractional scrubbing cannot grow the cache without bound. */
  readonly cachedAgeCount: number;
  readonly cacheAgeLimit: number;
}
export type PaleomapDirectionFromAgeResolver = (
  plateId: number,
  directionAtSource: UnitDirection,
  sourceAgeMa: number,
  requestedAgeMa: number,
) => UnitDirection | null;

interface DecodedFragment extends PaleomapMotionFragment {
  referenceRing: UnitDirection[];
  referenceEdgeCrosses: UnitDirection[];
  referenceEdgeDots: number[];
  capCosine: number;
}

interface PlateInterval {
  plateId: number;
  requestedRotation: QuaternionWxyz;
  inverseRequestedRotation: QuaternionWxyz;
  youngerRotation: QuaternionWxyz;
  olderRotation: QuaternionWxyz;
  fragments: DecodedFragment[];
  requestedCapCentres: UnitDirection[];
}

const IDENTITY_QUATERNION: QuaternionWxyz = [1, 0, 0, 0];
const BOUNDARY_EPSILON = 1e-9;
const ROTATION_AGE_CACHE_LIMIT = 4;
const decodedFragmentsByCatalog = new WeakMap<PaleomapMotionCatalog, DecodedFragment[]>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function decodePaleomapMotionCatalog(value: unknown): PaleomapMotionCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.id !== "paleomap-rigid-material-motion-v1") {
    throw new Error("unsupported PALEOMAP motion catalog");
  }
  if (!Array.isArray(value.fragments) || !Array.isArray(value.rotationSequences)) {
    throw new Error("PALEOMAP motion catalog is missing fragments or rotations");
  }
  if (!Array.isArray(value.coordinates) || value.coordinates.length % 2 !== 0) {
    throw new Error("PALEOMAP motion coordinates must be longitude/latitude pairs");
  }
  const catalog = value as unknown as PaleomapMotionCatalog;
  const fragmentIds = new Set<string>();
  for (const fragment of catalog.fragments) {
    if (fragmentIds.has(fragment.fragmentId)) throw new Error(`duplicate fragment ${fragment.fragmentId}`);
    fragmentIds.add(fragment.fragmentId);
    const end = (fragment.coordinateOffset + fragment.coordinateCount) * 2;
    if (fragment.coordinateOffset < 0 || fragment.coordinateCount < 3 || end > catalog.coordinates.length) {
      throw new Error(`invalid coordinates for fragment ${fragment.fragmentId}`);
    }
  }
  for (const sequence of catalog.rotationSequences) {
    if (sequence.samples.length === 0) throw new Error(`empty rotation sequence ${sequence.sequenceId}`);
    for (let index = 1; index < sequence.samples.length; index += 1) {
      if (sequence.samples[index]!.ageMa <= sequence.samples[index - 1]!.ageMa) {
        throw new Error(`unordered rotation sequence ${sequence.sequenceId}`);
      }
    }
  }
  return catalog;
}

export async function loadPaleomapMotionCatalog(url: string, signal?: AbortSignal): Promise<PaleomapMotionCatalog> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`PALEOMAP motion request failed: ${response.status}`);
  return decodePaleomapMotionCatalog(await response.json());
}

export function isPaleomapFragmentActiveAtAge(fragment: PaleomapMotionFragment, ageMa: number): boolean {
  const { oldest, youngest } = fragment.validTimeMa;
  return (oldest === null || ageMa <= oldest) && (youngest === null || ageMa >= youngest);
}

function dot(a: UnitDirection, b: UnitDirection): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: UnitDirection, b: UnitDirection): UnitDirection {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(direction: UnitDirection): UnitDirection {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length < Number.EPSILON) throw new RangeError("direction must be finite and non-zero");
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function multiplyQuaternion(left: QuaternionWxyz, right: QuaternionWxyz): QuaternionWxyz {
  return normalizeQuaternion(multiplyQuaternionRaw(left, right));
}

function multiplyQuaternionRaw(left: QuaternionWxyz, right: QuaternionWxyz): QuaternionWxyz {
  const [lw, lx, ly, lz] = left;
  const [rw, rx, ry, rz] = right;
  return [
    lw * rw - lx * rx - ly * ry - lz * rz,
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
  ];
}

function normalizeQuaternion(quaternion: QuaternionWxyz): QuaternionWxyz {
  const length = Math.hypot(...quaternion);
  return quaternion.map((value) => value / length) as unknown as QuaternionWxyz;
}

function inverseQuaternion(quaternion: QuaternionWxyz): QuaternionWxyz {
  return [quaternion[0], -quaternion[1], -quaternion[2], -quaternion[3]];
}

function slerpQuaternion(left: QuaternionWxyz, right: QuaternionWxyz, fraction: number): QuaternionWxyz {
  let adjustedRight = right;
  let cosine = left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3];
  if (cosine < 0) {
    adjustedRight = right.map((value) => -value) as unknown as QuaternionWxyz;
    cosine = -cosine;
  }
  if (cosine > 0.9999995) {
    return normalizeQuaternion(left.map((value, index) => value + fraction * (adjustedRight[index]! - value)) as unknown as QuaternionWxyz);
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  const sine = Math.sin(angle);
  const leftScale = Math.sin((1 - fraction) * angle) / sine;
  const rightScale = Math.sin(fraction * angle) / sine;
  return normalizeQuaternion(
    left.map((value, index) => value * leftScale + adjustedRight[index]! * rightScale) as unknown as QuaternionWxyz,
  );
}

function rotateDirection(rotation: QuaternionWxyz, direction: UnitDirection): UnitDirection {
  const vector: QuaternionWxyz = [0, direction[0], direction[1], direction[2]];
  const rotated = multiplyQuaternionRaw(multiplyQuaternionRaw(rotation, vector), inverseQuaternion(rotation));
  return normalize([rotated[1], rotated[2], rotated[3]]);
}

function interpolateSequence(sequence: PaleomapRotationSequence, ageMa: number): QuaternionWxyz | null {
  const { samples } = sequence;
  if (ageMa < samples[0]!.ageMa || ageMa > samples.at(-1)!.ageMa) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const sample = samples[middle]!;
    if (sample.ageMa === ageMa) return sample.quaternionWxyz;
    if (sample.ageMa < ageMa) low = middle + 1;
    else high = middle - 1;
  }
  const younger = samples[high]!;
  const older = samples[low]!;
  const fraction = (ageMa - younger.ageMa) / (older.ageMa - younger.ageMa);
  return slerpQuaternion(younger.quaternionWxyz, older.quaternionWxyz, fraction);
}

export function createPaleomapPlateRotationEvaluator(
  catalog: PaleomapMotionCatalog,
): PaleomapPlateRotationEvaluator {
  return createPlateRotationEvaluator(catalog.rotationSequences, catalog.model.anchorPlateId);
}

export function createPlateRotationEvaluator(
  rotationSequences: readonly PlateRotationSequence[],
  anchorPlateId: number,
): PaleomapPlateRotationEvaluator {
  const sequencesByMovingPlate = new Map<number, PaleomapRotationSequence[]>();
  for (const sequence of rotationSequences) {
    const sequences = sequencesByMovingPlate.get(sequence.movingPlateId) ?? [];
    sequences.push(sequence as PaleomapRotationSequence);
    sequencesByMovingPlate.set(sequence.movingPlateId, sequences);
  }
  for (const sequences of sequencesByMovingPlate.values()) {
    sequences.sort((left, right) => left.sourceOrder - right.sourceOrder);
  }

  const cachesByAge = new Map<number, Map<number, QuaternionWxyz | null>>();
  const evaluate = (plateId: number, ageMa: number): QuaternionWxyz | null => {
    let cache = cachesByAge.get(ageMa);
    if (!cache) {
      if (cachesByAge.size >= ROTATION_AGE_CACHE_LIMIT) {
        cachesByAge.delete(cachesByAge.keys().next().value!);
      }
      cache = new Map<number, QuaternionWxyz | null>();
      cachesByAge.set(ageMa, cache);
    }
    const visiting = new Set<number>();
    const resolve = (movingPlateId: number): QuaternionWxyz | null => {
      if (movingPlateId === anchorPlateId) return IDENTITY_QUATERNION;
      if (cache.has(movingPlateId)) return cache.get(movingPlateId) ?? null;
      if (visiting.has(movingPlateId)) return null;
      visiting.add(movingPlateId);
      const sequence = sequencesByMovingPlate
        .get(movingPlateId)
        ?.find(({ sampleRangeMa, endpointInclusion }) => {
          if (ageMa < sampleRangeMa.youngest || ageMa > sampleRangeMa.oldest) return false;
          if (ageMa === sampleRangeMa.youngest && !endpointInclusion.youngest) return false;
          if (ageMa === sampleRangeMa.oldest && !endpointInclusion.oldest) return false;
          return true;
        });
      const relative = sequence ? interpolateSequence(sequence, ageMa) : null;
      const fixed = sequence ? resolve(sequence.fixedPlateId) : null;
      const equivalent = relative && fixed ? multiplyQuaternion(fixed, relative) : null;
      visiting.delete(movingPlateId);
      cache.set(movingPlateId, equivalent);
      return equivalent;
    };
    return resolve(plateId);
  };
  Object.defineProperties(evaluate, {
    cachedAgeCount: { get: () => cachesByAge.size },
    cacheAgeLimit: { value: ROTATION_AGE_CACHE_LIMIT },
  });
  return evaluate as PaleomapPlateRotationEvaluator;
}

export function createPaleomapDirectionFromAgeResolver(
  catalog: PaleomapMotionCatalog,
): PaleomapDirectionFromAgeResolver {
  const evaluateRotation = createPaleomapPlateRotationEvaluator(catalog);
  return (plateId, directionAtSource, sourceAgeMa, requestedAgeMa) =>
    resolvePlateDirectionBetweenAges(evaluateRotation, plateId, directionAtSource, sourceAgeMa, requestedAgeMa);
}

export function resolvePlateDirectionBetweenAges(
  evaluateRotation: PaleomapPlateRotationEvaluator,
  plateId: number,
  directionAtSource: UnitDirection,
  sourceAgeMa: number,
  requestedAgeMa: number,
): UnitDirection | null {
  const sourceDirection = normalize(directionAtSource);
  const sourceRotation = evaluateRotation(plateId, sourceAgeMa);
  if (!sourceRotation) return null;
  if (sourceAgeMa === requestedAgeMa) return sourceDirection;
  const requestedRotation = evaluateRotation(plateId, requestedAgeMa);
  if (!requestedRotation) return null;
  const referenceDirection = rotateDirection(inverseQuaternion(sourceRotation), sourceDirection);
  return rotateDirection(requestedRotation, referenceDirection);
}

/**
 * Express a reconstructed direction in the plate rotation's mathematical
 * reference chart. This does not assert that the material existed at age 0;
 * callers must retain an independent topology/lifecycle validity guard.
 */
export function resolvePlateReferenceDirection(
  evaluateRotation: PaleomapPlateRotationEvaluator,
  plateId: number,
  directionAtAge: UnitDirection,
  ageMa: number,
): UnitDirection | null {
  const rotation = evaluateRotation(plateId, ageMa);
  return rotation ? rotateDirection(inverseQuaternion(rotation), normalize(directionAtAge)) : null;
}

/** Rotate a mathematical plate-reference direction to a requested age. */
export function resolvePlateDirectionFromReference(
  evaluateRotation: PaleomapPlateRotationEvaluator,
  plateId: number,
  referenceDirection: UnitDirection,
  ageMa: number,
): UnitDirection | null {
  const rotation = evaluateRotation(plateId, ageMa);
  return rotation ? rotateDirection(rotation, normalize(referenceDirection)) : null;
}

function decodeRing(catalog: PaleomapMotionCatalog, fragment: PaleomapMotionFragment): UnitDirection[] {
  const scale = catalog.coordinateEncoding.scaleDegrees;
  return Array.from({ length: fragment.coordinateCount }, (_, index) => {
    const coordinateIndex = (fragment.coordinateOffset + index) * 2;
    const longitude = catalog.coordinates[coordinateIndex]! * scale * (Math.PI / 180);
    const latitude = catalog.coordinates[coordinateIndex + 1]! * scale * (Math.PI / 180);
    const cosLatitude = Math.cos(latitude);
    return [cosLatitude * Math.cos(longitude), cosLatitude * Math.sin(longitude), Math.sin(latitude)];
  });
}

function getDecodedFragments(catalog: PaleomapMotionCatalog): DecodedFragment[] {
  const cached = decodedFragmentsByCatalog.get(catalog);
  if (cached) return cached;
  const decoded = catalog.fragments.map((fragment): DecodedFragment => {
    const referenceRing = decodeRing(catalog, fragment);
    return {
      ...fragment,
      referenceRing,
      referenceEdgeCrosses: referenceRing.map((start, index) => cross(start, referenceRing[(index + 1) % referenceRing.length]!)),
      referenceEdgeDots: referenceRing.map((start, index) => dot(start, referenceRing[(index + 1) % referenceRing.length]!)),
      capCosine: Math.cos(
        fragment.referenceBoundingCap.radiusRadians +
          2 * catalog.coordinateEncoding.scaleDegrees * (Math.PI / 180),
      ),
    };
  });
  decodedFragmentsByCatalog.set(catalog, decoded);
  return decoded;
}

function containsDirection(fragment: DecodedFragment, direction: UnitDirection): boolean {
  if (dot(fragment.referenceBoundingCap.centreXyz, direction) + BOUNDARY_EPSILON < fragment.capCosine) return false;
  let winding = 0;
  const { referenceRing } = fragment;
  for (let index = 0; index < referenceRing.length; index += 1) {
    const start = referenceRing[index]!;
    const end = referenceRing[(index + 1) % referenceRing.length]!;
    const startDot = dot(start, direction);
    const endDot = dot(end, direction);
    if (1 - startDot * startDot < BOUNDARY_EPSILON || 1 - endDot * endDot < BOUNDARY_EPSILON) return true;
    const sine = dot(direction, fragment.referenceEdgeCrosses[index]!);
    const cosine = fragment.referenceEdgeDots[index]! - startDot * endDot;
    winding += Math.atan2(sine, cosine);
  }
  return Math.abs(winding) > Math.PI;
}

export function createPaleomapIntervalResolver(
  catalog: PaleomapMotionCatalog,
  requestedAgeMa: number,
  youngerAgeMa: number,
  olderAgeMa: number,
): PaleomapIntervalResolver {
  if (![requestedAgeMa, youngerAgeMa, olderAgeMa].every(Number.isFinite)) throw new RangeError("ages must be finite");
  if (requestedAgeMa < youngerAgeMa || requestedAgeMa > olderAgeMa) {
    throw new RangeError("requested age must be inside its source interval");
  }
  const evaluateRotation = createPaleomapPlateRotationEvaluator(catalog);
  const decodedFragments = getDecodedFragments(catalog)
    .filter(
      (fragment) =>
        isPaleomapFragmentActiveAtAge(fragment, requestedAgeMa) &&
        isPaleomapFragmentActiveAtAge(fragment, youngerAgeMa) &&
        isPaleomapFragmentActiveAtAge(fragment, olderAgeMa),
    );

  const fragmentsByPlate = new Map<number, DecodedFragment[]>();
  for (const fragment of decodedFragments) {
    const fragments = fragmentsByPlate.get(fragment.plateId) ?? [];
    fragments.push(fragment);
    fragmentsByPlate.set(fragment.plateId, fragments);
  }
  const plates: PlateInterval[] = [];
  for (const [plateId, fragments] of fragmentsByPlate) {
    const requestedRotation = evaluateRotation(plateId, requestedAgeMa);
    const youngerRotation = evaluateRotation(plateId, youngerAgeMa);
    const olderRotation = evaluateRotation(plateId, olderAgeMa);
    if (!requestedRotation || !youngerRotation || !olderRotation) continue;
    fragments.sort(
      (left, right) => left.sourceFeatureIndex - right.sourceFeatureIndex || left.geometryIndex - right.geometryIndex,
    );
    plates.push({
      plateId,
      requestedRotation,
      inverseRequestedRotation: inverseQuaternion(requestedRotation),
      youngerRotation,
      olderRotation,
      fragments,
      requestedCapCentres: fragments.map((fragment) =>
        rotateDirection(requestedRotation, fragment.referenceBoundingCap.centreXyz),
      ),
    });
  }
  plates.sort((left, right) => right.plateId - left.plateId);

  return {
    requestedAgeMa,
    youngerAgeMa,
    olderAgeMa,
    activeFragmentCount: plates.reduce((count, plate) => count + plate.fragments.length, 0),
    resolveAt(directionAtRequested): ResolvedPaleomapMaterial | null {
      const requestedDirection = normalize(directionAtRequested);
      for (const plate of plates) {
        let couldContain = false;
        for (let index = 0; index < plate.fragments.length; index += 1) {
          if (dot(plate.requestedCapCentres[index]!, requestedDirection) + BOUNDARY_EPSILON >= plate.fragments[index]!.capCosine) {
            couldContain = true;
            break;
          }
        }
        if (!couldContain) continue;
        const referenceDirection = rotateDirection(plate.inverseRequestedRotation, requestedDirection);
        const fragment = plate.fragments.find((candidate) => containsDirection(candidate, referenceDirection));
        if (!fragment) continue;
        return {
          fragmentId: fragment.fragmentId,
          plateId: plate.plateId,
          referenceDirection,
          youngerDirection:
            requestedAgeMa === youngerAgeMa
              ? requestedDirection
              : rotateDirection(plate.youngerRotation, referenceDirection),
          olderDirection:
            requestedAgeMa === olderAgeMa
              ? requestedDirection
              : rotateDirection(plate.olderRotation, referenceDirection),
        };
      }
      return null;
    },
  };
}

import type { UnitDirection } from "./paleomapMotion";

export interface CaoOceanLifecycleCatalog {
  schemaVersion: 1;
  id: "cao-ocean-lifecycle-v1";
  model: { id: "cao-et-al-2024"; version: "2.4"; referenceFrame: "palaeomagnetic"; anchorPlateId: 0 };
  binary: { path: string; bytes: number; sha256: string };
  grid: { width: 180; height: 91; longitudes: string; latitudes: string; maximumNearestCellRegistrationUncertaintyKm: 158 };
  time: { displayAgesMa: number[]; traceRangeMa: [0, 1000]; stepMa: 5; boundUncertaintyMa: 5 };
  topologySlotIdentitySha256ByAge: string[];
  method: Record<string, unknown>;
  coverage: Record<string, number>;
  epistemicStatus: string;
}

export interface CaoOceanLifecycleData {
  catalog: CaoOceanLifecycleCatalog;
  birthBounds: Uint8Array;
  lossBounds: Uint8Array;
  sourceTopologySlots: Uint8Array;
}

export type CaoLifecycleBound =
  | { status: "confirmed"; boundaryType: "MidOceanRidge" | "SubductionZone"; intervalMa: readonly [number, number] }
  | { status: "censored"; atModelLimitMa: 0 | 1000 }
  | { status: "unattributed" }
  | { status: "unavailable" };

export interface CaoOceanLifecycleSample {
  sourceAgeMa: number;
  spatialResolutionDegrees: 2;
  maximumRegistrationUncertaintyKm: number;
  birth: CaoLifecycleBound;
  loss: CaoLifecycleBound;
}

const HEADER_BYTES = 24;
const UNATTRIBUTED = 253;
const CENSORED = 254;
const UNAVAILABLE = 255;

export function decodeCaoOceanLifecycleCatalog(value: unknown): CaoOceanLifecycleCatalog {
  const catalog = value as Partial<CaoOceanLifecycleCatalog>;
  const expectedAges = Array.from({ length: 109 }, (_, index) => index * 5);
  if (
    !catalog || catalog.schemaVersion !== 1 || catalog.id !== "cao-ocean-lifecycle-v1" ||
    catalog.model?.id !== "cao-et-al-2024" || catalog.model.version !== "2.4" ||
    catalog.model.referenceFrame !== "palaeomagnetic" || catalog.model.anchorPlateId !== 0 ||
    catalog.grid?.width !== 180 || catalog.grid.height !== 91 ||
    !catalog.time || catalog.time.stepMa !== 5 || catalog.time.boundUncertaintyMa !== 5 ||
    catalog.time.traceRangeMa?.[0] !== 0 || catalog.time.traceRangeMa?.[1] !== 1000 ||
    !Array.isArray(catalog.time.displayAgesMa) || catalog.time.displayAgesMa.length !== 109 ||
    !Array.isArray(catalog.topologySlotIdentitySha256ByAge) || catalog.topologySlotIdentitySha256ByAge.length !== 109 ||
    !catalog.topologySlotIdentitySha256ByAge.every((digest) => /^[0-9a-f]{64}$/.test(digest)) ||
    !expectedAges.every((age, index) => catalog.time!.displayAgesMa[index] === age)
  ) throw new Error("unsupported Cao ocean lifecycle catalog");
  return catalog as CaoOceanLifecycleCatalog;
}

export function decodeCaoOceanLifecycleBinary(
  catalog: CaoOceanLifecycleCatalog,
  buffer: ArrayBuffer,
): CaoOceanLifecycleData {
  if (buffer.byteLength !== catalog.binary.bytes || buffer.byteLength < HEADER_BYTES) {
    throw new Error("Cao ocean lifecycle binary byte length mismatch");
  }
  const view = new DataView(buffer);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const ageCount = view.getUint16(10, true);
  const birthOffset = view.getUint32(12, true);
  const lossOffset = view.getUint32(16, true);
  const sourceTopologySlotOffset = view.getUint32(20, true);
  const cellCount = width * height * ageCount;
  if (
    String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "EHCL" || view.getUint16(4, true) !== 1 ||
    width !== catalog.grid.width || height !== catalog.grid.height || ageCount !== 109 ||
    birthOffset !== HEADER_BYTES || lossOffset !== birthOffset + cellCount ||
    sourceTopologySlotOffset !== lossOffset + cellCount || sourceTopologySlotOffset + cellCount !== buffer.byteLength
  ) throw new Error("invalid Cao ocean lifecycle binary layout");
  const birthBounds = new Uint8Array(buffer, birthOffset, cellCount);
  const lossBounds = new Uint8Array(buffer, lossOffset, cellCount);
  const sourceTopologySlots = new Uint8Array(buffer, sourceTopologySlotOffset, cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    const ageIndex = Math.floor(index / (catalog.grid.width * catalog.grid.height));
    const birth = birthBounds[index]!;
    const loss = lossBounds[index]!;
    const slot = sourceTopologySlots[index]!;
    const legalBirth = birth <= 199 && birth >= ageIndex || birth === UNATTRIBUTED || birth === CENSORED || birth === UNAVAILABLE;
    const legalLoss = loss >= 1 && loss <= ageIndex || loss === UNATTRIBUTED || loss === CENSORED || loss === UNAVAILABLE;
    if (!legalBirth || !legalLoss || (slot === UNAVAILABLE) !== (birth === UNAVAILABLE && loss === UNAVAILABLE)) {
      throw new Error(`invalid Cao ocean lifecycle value at cell ${index}`);
    }
  }
  return {
    catalog,
    birthBounds,
    lossBounds,
    sourceTopologySlots,
  };
}

export async function loadCaoOceanLifecycleData(metadataUrl: string, signal?: AbortSignal): Promise<CaoOceanLifecycleData> {
  const response = await fetch(metadataUrl, { signal });
  if (!response.ok) throw new Error(`Cao ocean lifecycle metadata request failed: ${response.status}`);
  const catalog = decodeCaoOceanLifecycleCatalog(await response.json());
  const binaryResponse = await fetch(new URL(catalog.binary.path, metadataUrl), { signal });
  if (!binaryResponse.ok) throw new Error(`Cao ocean lifecycle binary request failed: ${binaryResponse.status}`);
  return decodeCaoOceanLifecycleBinary(catalog, await binaryResponse.arrayBuffer());
}

function decodeBound(code: number, kind: "birth" | "loss"): CaoLifecycleBound {
  if (code === UNAVAILABLE) return { status: "unavailable" };
  if (code === UNATTRIBUTED) return { status: "unattributed" };
  if (code === CENSORED) return { status: "censored", atModelLimitMa: kind === "birth" ? 1000 : 0 };
  const lastActiveAgeMa = code * 5;
  return kind === "birth"
    ? { status: "confirmed", boundaryType: "MidOceanRidge", intervalMa: [lastActiveAgeMa, lastActiveAgeMa + 5] }
    : { status: "confirmed", boundaryType: "SubductionZone", intervalMa: [lastActiveAgeMa - 5, lastActiveAgeMa] };
}

export function sampleCaoOceanLifecycle(
  data: CaoOceanLifecycleData,
  sourceAgeMa: number,
  rawDirection: UnitDirection,
  exactTopologySlotIndex: number,
): CaoOceanLifecycleSample | null {
  const ageIndex = data.catalog.time.displayAgesMa.indexOf(sourceAgeMa);
  if (ageIndex < 0) return null;
  const length = Math.hypot(...rawDirection);
  if (!Number.isFinite(length) || length < Number.EPSILON) return null;
  const x = rawDirection[0] / length;
  const y = rawDirection[1] / length;
  const z = rawDirection[2] / length;
  const longitude = Math.atan2(y, x) * 180 / Math.PI;
  const latitude = Math.asin(z) * 180 / Math.PI;
  const longitudeIndex = Math.round((longitude + 180) / 2) % data.catalog.grid.width;
  const latitudeIndex = Math.max(0, Math.min(data.catalog.grid.height - 1, Math.round((90 - latitude) / 2)));
  const offset = ageIndex * data.catalog.grid.width * data.catalog.grid.height + latitudeIndex * data.catalog.grid.width + longitudeIndex;
  if (data.sourceTopologySlots[offset] !== exactTopologySlotIndex + 1) return null;
  const birth = decodeBound(data.birthBounds[offset]!, "birth");
  const loss = decodeBound(data.lossBounds[offset]!, "loss");
  if (birth.status === "unavailable" && loss.status === "unavailable") return null;
  return {
    sourceAgeMa,
    spatialResolutionDegrees: 2,
    maximumRegistrationUncertaintyKm: data.catalog.grid.maximumNearestCellRegistrationUncertaintyKm,
    birth,
    loss,
  };
}

export function createCaoOceanLifecycleSampler(
  data: CaoOceanLifecycleData,
  motionCatalog: {
    model: { id: string; version: string; referenceFrame: string; anchorPlateId: number };
    ages: Array<{ ageMa: number; topologySlotIdentitySha256: string }>;
  },
) {
  const compatible =
    motionCatalog.model.id === data.catalog.model.id &&
    motionCatalog.model.version === data.catalog.model.version &&
    motionCatalog.model.referenceFrame === data.catalog.model.referenceFrame &&
    motionCatalog.model.anchorPlateId === data.catalog.model.anchorPlateId &&
    motionCatalog.ages.length === data.catalog.time.displayAgesMa.length &&
    motionCatalog.ages.every((age, index) =>
      age.ageMa === data.catalog.time.displayAgesMa[index] &&
      age.topologySlotIdentitySha256 === data.catalog.topologySlotIdentitySha256ByAge[index]);
  if (!compatible) throw new Error("Cao lifecycle and motion topology slot identities do not match");
  return (sourceAgeMa: number, direction: UnitDirection, exactTopologySlotIndex: number) =>
    sampleCaoOceanLifecycle(data, sourceAgeMa, direction, exactTopologySlotIndex);
}

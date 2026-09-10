import type { LonLat } from "./data";
import type { AreaFocusDescriptor } from "./areaTracking";
import type { CaoMaterialFocusDescriptor } from "./data";

export function parseFocusCoordinates(value: string | null): LonLat | null {
  if (value === null) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  if (
    !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
    longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90
  ) return null;
  return [longitude, latitude];
}

export function serializeFocusCoordinates([longitude, latitude]: LonLat): string {
  return `${Number(longitude.toFixed(4))},${Number(latitude.toFixed(4))}`;
}

function finiteFraction(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function parseAreaFocusDescriptor(value: string | null): AreaFocusDescriptor | null {
  if (value === null) return null;
  const parts = value.split("~");
  if (parts.length !== 9 || parts[0] !== "1") return null;
  try {
    const partId = Number(parts[5]);
    const alongMeasure = Number(parts[6]);
    const alongOffset = Number(parts[7]);
    const acrossOffset = Number(parts[8]);
    const descriptor: AreaFocusDescriptor = {
      version: 1,
      catalogId: decodeURIComponent(parts[1]),
      plateModelId: decodeURIComponent(parts[2]),
      referenceFrameId: decodeURIComponent(parts[3]),
      featureId: decodeURIComponent(parts[4]),
      partId,
      alongMeasure,
      offsetRadians: [alongOffset, acrossOffset],
    };
    if (
      !descriptor.catalogId || !descriptor.plateModelId || !descriptor.referenceFrameId ||
      !descriptor.featureId || !Number.isInteger(partId) || partId < 0 ||
      !finiteFraction(alongMeasure, 0, 1) ||
      !finiteFraction(alongOffset, -Math.PI, Math.PI) || Math.abs(alongOffset) >= Math.PI ||
      !finiteFraction(acrossOffset, -Math.PI, Math.PI) || Math.abs(acrossOffset) >= Math.PI
    ) return null;
    return descriptor;
  } catch {
    return null;
  }
}

export function serializeAreaFocusDescriptor(descriptor: AreaFocusDescriptor): string {
  return [
    "1",
    encodeURIComponent(descriptor.catalogId),
    encodeURIComponent(descriptor.plateModelId),
    encodeURIComponent(descriptor.referenceFrameId),
    encodeURIComponent(descriptor.featureId),
    String(descriptor.partId),
    String(Number(descriptor.alongMeasure.toFixed(7))),
    String(Number(descriptor.offsetRadians[0].toFixed(7))),
    String(Number(descriptor.offsetRadians[1].toFixed(7))),
  ].join("~");
}

export function parseCaoMaterialFocusDescriptor(value: string | null): CaoMaterialFocusDescriptor | null {
  if (value === null) return null;
  const parts = value.split("~");
  if (parts.length !== 20 || parts[0] !== "1") return null;
  try {
    const descriptor: CaoMaterialFocusDescriptor = {
      version: 1,
      viewId: "cao-2024-v2.4",
      frame: {
        modelId: decodeURIComponent(parts[2]),
        modelVersion: decodeURIComponent(parts[3]),
        referenceFrameId: decodeURIComponent(parts[4]),
        anchorPlateId: Number(parts[5]),
        directionConvention: "gplates-xyz-x0e-y90e-znorth",
      },
      materialId: decodeURIComponent(parts[6]),
      materialKind: parts[7] === "oceanic-crust" ? "oceanic-crust" : "continental-crust",
      plateId: Number(parts[8]),
      referenceAgeMa: Number(parts[9]),
      directionAtReference: [Number(parts[10]), Number(parts[11]), Number(parts[12])],
      validTimeMa: {
        oldest: parts[13] === "" ? null : Number(parts[13]),
        youngest: parts[14] === "" ? null : Number(parts[14]),
      },
      sourceTopologyId: parts[15] === "" ? undefined : decodeURIComponent(parts[15]),
      olderTopologyId: parts[16] === "" ? undefined : decodeURIComponent(parts[16]),
      topologyIntervalMa: parts[17] === "" || parts[18] === ""
        ? undefined
        : [Number(parts[17]), Number(parts[18])],
    };
    const directionLength = Math.hypot(...descriptor.directionAtReference);
    if (
      parts[1] !== descriptor.viewId || parts[19] !== descriptor.frame.directionConvention ||
      !descriptor.frame.modelId || !descriptor.frame.modelVersion || !descriptor.frame.referenceFrameId ||
      (parts[7] !== "oceanic-crust" && parts[7] !== "continental-crust") ||
      !Number.isInteger(descriptor.frame.anchorPlateId) || !descriptor.materialId ||
      !Number.isInteger(descriptor.plateId) || !Number.isFinite(descriptor.referenceAgeMa) ||
      descriptor.referenceAgeMa < 0 || descriptor.referenceAgeMa > 540 || !Number.isFinite(directionLength) ||
      Math.abs(directionLength - 1) > 0.001 ||
      (descriptor.validTimeMa.oldest !== null && !Number.isFinite(descriptor.validTimeMa.oldest)) ||
      (descriptor.validTimeMa.youngest !== null && !Number.isFinite(descriptor.validTimeMa.youngest)) ||
      (descriptor.topologyIntervalMa !== undefined && (!descriptor.topologyIntervalMa.every(Number.isFinite) ||
        descriptor.topologyIntervalMa[0] > descriptor.topologyIntervalMa[1])) ||
      (descriptor.materialKind === "oceanic-crust" &&
        (descriptor.sourceTopologyId === undefined || descriptor.olderTopologyId === undefined ||
          descriptor.topologyIntervalMa === undefined))
    ) return null;
    return descriptor;
  } catch {
    return null;
  }
}

export function serializeCaoMaterialFocusDescriptor(descriptor: CaoMaterialFocusDescriptor): string {
  return [
    "1", descriptor.viewId, encodeURIComponent(descriptor.frame.modelId),
    encodeURIComponent(descriptor.frame.modelVersion), encodeURIComponent(descriptor.frame.referenceFrameId),
    String(descriptor.frame.anchorPlateId), encodeURIComponent(descriptor.materialId), descriptor.materialKind,
    String(descriptor.plateId), String(descriptor.referenceAgeMa),
    ...descriptor.directionAtReference.map((value) => String(Number(value.toFixed(9)))),
    descriptor.validTimeMa.oldest === null ? "" : String(descriptor.validTimeMa.oldest),
    descriptor.validTimeMa.youngest === null ? "" : String(descriptor.validTimeMa.youngest),
    descriptor.sourceTopologyId === undefined ? "" : encodeURIComponent(descriptor.sourceTopologyId),
    descriptor.olderTopologyId === undefined ? "" : encodeURIComponent(descriptor.olderTopologyId),
    descriptor.topologyIntervalMa === undefined ? "" : String(descriptor.topologyIntervalMa[0]),
    descriptor.topologyIntervalMa === undefined ? "" : String(descriptor.topologyIntervalMa[1]),
    descriptor.frame.directionConvention,
  ].join("~");
}

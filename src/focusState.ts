import type { LonLat } from "./data";
import type { AreaFocusDescriptor } from "./areaTracking";

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

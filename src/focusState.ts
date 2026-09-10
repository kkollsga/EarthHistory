import type { LonLat } from "./data";
import type { MaterialAddress } from "./reconstruction";

export function parseFocusCoordinates(value: string | null): LonLat | null {
  if (value === null) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
    ? [longitude, latitude] : null;
}

export function serializeFocusCoordinates([longitude, latitude]: LonLat): string {
  return `${Number(longitude.toFixed(4))},${Number(latitude.toFixed(4))}`;
}

export function parseMaterialAddress(value: string | null): MaterialAddress | null {
  if (!value?.startsWith("{")) return null;
  try {
    const address = JSON.parse(value) as MaterialAddress;
    const direction = address.localCoordinate?.kind === "chart-direction"
      ? address.localCoordinate.directionAtReference : null;
    if (!address.chartId || !address.chartRevision || !address.materialId || !address.fragmentOrCohortId
        || !Number.isSafeInteger(address.cellOrTriangleId) || address.cellOrTriangleId < 0 || !direction
        || !direction.every(Number.isFinite) || Math.abs(Math.hypot(...direction) - 1) > 2e-6) return null;
    return address;
  } catch {
    return null;
  }
}

export function serializeMaterialAddress(address: MaterialAddress): string {
  const value = JSON.stringify(address);
  if (parseMaterialAddress(value) === null) throw new Error("invalid material focus address");
  return value;
}

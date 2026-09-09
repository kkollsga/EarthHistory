import type { LonLat } from "./data";

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

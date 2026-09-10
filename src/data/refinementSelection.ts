import type {
  LonLat,
  SurfaceRefinementTileMetadata,
} from "./types";
import { surfaceRefinementAppliesToMode } from "./modern-relief";

export interface RefinementSelectionRequest {
  coordinates: LonLat;
  requestedAgeMa: number;
  surfaceMode: "surface" | "seafloor";
  referenceFrameId: string;
  previousTileId?: string;
  projectedErrorPixels?: ReadonlyMap<string, number>;
}

function contains(metadata: SurfaceRefinementTileMetadata, [longitude, latitude]: LonLat): boolean {
  const [west, south, east, north] = metadata.bounds;
  const longitudeInside = west <= east
    ? longitude >= west && longitude <= east
    : longitude >= west || longitude <= east;
  return longitudeInside && latitude >= south && latitude <= north;
}

/**
 * Choose one scientifically eligible leaf per refinement set. Sparse children
 * replace their parent only above the split threshold; the previous child is
 * retained down to the lower merge threshold to prevent camera-boundary churn.
 * Missing children naturally leave their parent as the complete fallback.
 */
export function selectSurfaceRefinementMetadata(
  metadata: readonly SurfaceRefinementTileMetadata[],
  request: RefinementSelectionRequest,
): SurfaceRefinementTileMetadata[] {
  const eligible = metadata.filter((tile) =>
    surfaceRefinementAppliesToMode(tile, request.surfaceMode) &&
    tile.referenceFrameId === request.referenceFrameId &&
    request.requestedAgeMa <= tile.validRequestedAgeMa[0] &&
    request.requestedAgeMa >= tile.validRequestedAgeMa[1] &&
    contains(tile, request.coordinates)
  );
  const bySet = new Map<string, SurfaceRefinementTileMetadata[]>();
  for (const tile of eligible) {
    const entries = bySet.get(tile.setId) ?? [];
    entries.push(tile);
    bySet.set(tile.setId, entries);
  }
  const selected: SurfaceRefinementTileMetadata[] = [];
  for (const entries of bySet.values()) {
    entries.sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));
    let choice = entries[0];
    for (const candidate of entries.slice(1)) {
      if (candidate.parentId !== choice.id) continue;
      const error = request.projectedErrorPixels?.get(candidate.id) ?? Number.POSITIVE_INFINITY;
      const threshold = request.previousTileId === candidate.id
        ? candidate.mergeErrorPixels
        : candidate.splitErrorPixels;
      if (error >= threshold) choice = candidate;
    }
    selected.push(choice);
  }
  return selected.sort((left, right) =>
    right.priority - left.priority || right.level - left.level ||
    left.longitudeStep - right.longitudeStep || left.id.localeCompare(right.id)
  );
}

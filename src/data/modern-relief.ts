import type {
  EvidenceStatus,
  GeographicBounds,
  SurfaceRefinementSetMetadata,
  SurfaceRefinementTile,
  SurfaceRefinementTileMetadata,
} from "./types";

interface SurfaceRefinementAsset {
  schemaVersion: 1;
  encoding: "int16-le-base64";
  scaleMetres: 1;
  id: string;
  validRequestedAgeMa: [number, number];
  bounds: GeographicBounds;
  cellCenterBounds: GeographicBounds;
  width: number;
  height: number;
  longitudeStep: number;
  latitudeStep: number;
  registration: "pixel-center";
  rowOrder: "north-to-south";
  units: "m";
  verticalDatum: string;
  surfaceMode: "surface" | "seafloor";
  sourceProduct: string;
  sourceIds: string[];
  elevation: string;
  landCoverage?: string;
}

interface TileDefinition {
  id: string;
  setId?: string;
  bounds: GeographicBounds;
  cellCenterBounds: GeographicBounds;
  longitudeStep: number;
  latitudeStep: number;
  surfaceMode: "surface" | "seafloor";
  domain: "land" | "bathymetry" | "topobathymetry";
  verticalDatum: string;
  sourceProduct: string;
  sourceVersion: string;
  sourceIds: string[];
  assetPath: string;
  priority?: number;
  level?: number;
  parentId?: string;
  childIds?: string[];
  nativeResolutionMetres?: number;
  maxErrorMetres?: number;
  evidence?: EvidenceStatus;
  composition?: SurfaceRefinementTileMetadata["composition"];
  width?: number;
  height?: number;
  edgeTransitionCells?: number;
}

function tile(definition: TileDefinition): SurfaceRefinementTileMetadata {
  return {
    id: definition.id,
    setId: definition.setId ?? `etopo-${definition.id}`,
    level: definition.level ?? 0,
    parentId: definition.parentId,
    childIds: definition.childIds ?? [],
    priority: definition.priority ?? 20,
    validRequestedAgeMa: [0, 0],
    bounds: definition.bounds,
    cellCenterBounds: definition.cellCenterBounds,
    width: definition.width ?? 256,
    height: definition.height ?? 256,
    longitudeStep: definition.longitudeStep,
    latitudeStep: definition.latitudeStep,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    horizontalCrs: "EPSG:4326",
    referenceFrameId: "present-day-geographic",
    verticalDatum: definition.verticalDatum,
    surfaceMode: definition.surfaceMode,
    domain: definition.domain,
    composition: definition.composition ?? "absolute-replace",
    evidence: definition.evidence ?? "model-output",
    nativeResolutionMetres: definition.nativeResolutionMetres ?? 1_850,
    maxErrorMetres: definition.maxErrorMetres ?? 500,
    splitErrorPixels: 1.5,
    mergeErrorPixels: 1,
    edgeTransitionCells: definition.edgeTransitionCells ?? 20,
    sourceProduct: definition.sourceProduct,
    sourceVersion: definition.sourceVersion,
    sourceIds: definition.sourceIds,
    assetPath: definition.assetPath,
  };
}

const ETOPO_PRODUCT = "ETOPO_2022_v1_60s_surface";
const ETOPO_VERSION = "v1";
const ETOPO_SOURCE = ["noaa-etopo-2022"];

export const surfaceRefinementTiles: SurfaceRefinementTileMetadata[] = [
  tile({ id: "mid-atlantic-ridge", bounds: [-60, 10, -30, 40], cellCenterBounds: [-59.94140625, 10.05859375, -30.05859375, 39.94140625], longitudeStep: 0.1171875, latitudeStep: 0.1171875, surfaceMode: "seafloor", domain: "bathymetry", verticalDatum: "EGM2008", sourceProduct: ETOPO_PRODUCT, sourceVersion: ETOPO_VERSION, sourceIds: ETOPO_SOURCE, assetPath: "data/etopo-mid-atlantic-ridge.json" }),
  tile({ id: "himalayas", bounds: [72, 22, 100, 38], cellCenterBounds: [72.0546875, 22.03125, 99.9453125, 37.96875], longitudeStep: 0.109375, latitudeStep: 0.0625, surfaceMode: "surface", domain: "land", verticalDatum: "EGM2008", sourceProduct: ETOPO_PRODUCT, sourceVersion: ETOPO_VERSION, sourceIds: ETOPO_SOURCE, assetPath: "data/etopo-himalayas.json" }),
  tile({ id: "andes", bounds: [-78, -32, -62, -15], cellCenterBounds: [-77.96875, -31.966796875, -62.03125, -15.033203125], longitudeStep: 0.0625, latitudeStep: 0.06640625, surfaceMode: "surface", domain: "topobathymetry", verticalDatum: "EGM2008", sourceProduct: ETOPO_PRODUCT, sourceVersion: ETOPO_VERSION, sourceIds: ETOPO_SOURCE, assetPath: "data/etopo-andes.json" }),
  tile({ id: "east-african-rift", bounds: [28, -15, 44, 14], cellCenterBounds: [28.03125, -14.943359375, 43.96875, 13.943359375], longitudeStep: 0.0625, latitudeStep: 0.11328125, surfaceMode: "surface", domain: "topobathymetry", verticalDatum: "EGM2008", sourceProduct: ETOPO_PRODUCT, sourceVersion: ETOPO_VERSION, sourceIds: ETOPO_SOURCE, assetPath: "data/etopo-east-african-rift.json" }),
  tile({ id: "greenland", bounds: [-60, 58, -20, 84], cellCenterBounds: [-59.921875, 58.05078125, -20.078125, 83.94921875], longitudeStep: 0.15625, latitudeStep: 0.1015625, surfaceMode: "surface", domain: "land", verticalDatum: "EGM2008", sourceProduct: ETOPO_PRODUCT, sourceVersion: ETOPO_VERSION, sourceIds: ETOPO_SOURCE, assetPath: "data/etopo-greenland.json" }),
  tile({ id: "north-sea-basin-coarse", setId: "emodnet-north-sea", level: 0, childIds: ["north-sea-basin"], priority: 100, width: 64, height: 64, edgeTransitionCells: 16, bounds: [1, 55, 4, 58], cellCenterBounds: [1.0234375, 55.0234375, 3.9765625, 57.9765625], longitudeStep: 0.046875, latitudeStep: 0.046875, surfaceMode: "seafloor", domain: "bathymetry", verticalDatum: "LAT", nativeResolutionMetres: 460, maxErrorMetres: 180, evidence: "synthesis", composition: "visual-feather", sourceProduct: "EMODnet_DTM_2024_mean", sourceVersion: "DTM 2024", sourceIds: ["emodnet-bathymetry-2024"], assetPath: "data/emodnet-north-sea-basin-coarse.json" }),
  tile({ id: "north-sea-basin", setId: "emodnet-north-sea", level: 1, parentId: "north-sea-basin-coarse", priority: 100, edgeTransitionCells: 64, bounds: [1, 55, 4, 58], cellCenterBounds: [1.005859375, 55.005859375, 3.994140625, 57.994140625], longitudeStep: 0.01171875, latitudeStep: 0.01171875, surfaceMode: "seafloor", domain: "bathymetry", verticalDatum: "LAT", nativeResolutionMetres: 115, maxErrorMetres: 45, evidence: "synthesis", composition: "visual-feather", sourceProduct: "EMODnet_DTM_2024_mean", sourceVersion: "DTM 2024", sourceIds: ["emodnet-bathymetry-2024"], assetPath: "data/emodnet-north-sea-basin.json" }),
];

export const surfaceRefinementSets: SurfaceRefinementSetMetadata[] = Array.from(
  new Map(surfaceRefinementTiles.map((metadata) => [metadata.setId, metadata])).values(),
  (metadata) => ({
    id: metadata.setId,
    label: metadata.setId === "emodnet-north-sea"
      ? "North Sea bathymetry"
      : metadata.id.replaceAll("-", " "),
    rootTileIds: surfaceRefinementTiles
      .filter((candidate) => candidate.setId === metadata.setId && candidate.parentId === undefined)
      .map((candidate) => candidate.id),
    priority: metadata.priority,
    cacheBudgetBytes: 4 * 1024 * 1024,
    sourceIds: metadata.sourceIds,
  }),
);

/** Compatibility export for the first generation of regional relief callers. */
export const modernReliefPatches = surfaceRefinementTiles;

const metadataById = new Map(surfaceRefinementTiles.map((metadata) => [metadata.id, metadata]));
const decodedTileCache = new Map<string, SurfaceRefinementTile>();
const inFlightTiles = new Map<string, Promise<SurfaceRefinementTile>>();
const TILE_CACHE_BUDGET_BYTES = 4 * 1024 * 1024;
let decodedCacheBytes = 0;

function assetUrl(path: string): string {
  return typeof document === "undefined" ? path : new URL(path, document.baseURI).toString();
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decode(metadata: SurfaceRefinementTileMetadata, asset: SurfaceRefinementAsset): SurfaceRefinementTile {
  if (
    asset.schemaVersion !== 1 || asset.encoding !== "int16-le-base64" || asset.scaleMetres !== 1 ||
    asset.id !== metadata.id || asset.width !== metadata.width || asset.height !== metadata.height ||
    !sameNumbers(asset.validRequestedAgeMa, metadata.validRequestedAgeMa) ||
    !sameNumbers(asset.bounds, metadata.bounds) ||
    !sameNumbers(asset.cellCenterBounds, metadata.cellCenterBounds) ||
    asset.longitudeStep !== metadata.longitudeStep || asset.latitudeStep !== metadata.latitudeStep ||
    asset.registration !== metadata.registration || asset.rowOrder !== metadata.rowOrder ||
    asset.units !== metadata.units || asset.verticalDatum !== metadata.verticalDatum ||
    asset.surfaceMode !== metadata.surfaceMode || asset.sourceProduct !== metadata.sourceProduct ||
    asset.sourceIds.length !== metadata.sourceIds.length ||
    asset.sourceIds.some((value, index) => value !== metadata.sourceIds[index])
  ) throw new Error(`Surface refinement metadata mismatch for ${metadata.id}`);

  const binary = atob(asset.elevation);
  if (binary.length !== metadata.width * metadata.height * 2) {
    throw new Error(`Surface refinement byte length mismatch for ${metadata.id}`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const elevation = new Float32Array(metadata.width * metadata.height);
  for (let index = 0; index < elevation.length; index += 1) {
    elevation[index] = view.getInt16(index * 2, true);
  }
  let landCoverage: Uint8Array | undefined;
  if (asset.landCoverage !== undefined) {
    const coverageBinary = atob(asset.landCoverage);
    if (coverageBinary.length !== metadata.width * metadata.height) {
      throw new Error(`Surface refinement land-mask byte length mismatch for ${metadata.id}`);
    }
    landCoverage = Uint8Array.from(coverageBinary, (character) => character.charCodeAt(0));
  }
  return {
    ...metadata,
    elevation,
    landCoverage,
    byteLength: elevation.byteLength + (landCoverage?.byteLength ?? 0),
  };
}

function retainWithinBudget(id: string, loaded: SurfaceRefinementTile): void {
  if (loaded.byteLength > TILE_CACHE_BUDGET_BYTES) return;
  while (
    decodedCacheBytes + loaded.byteLength > TILE_CACHE_BUDGET_BYTES &&
    decodedTileCache.size > 0
  ) {
    const oldestId = decodedTileCache.keys().next().value as string | undefined;
    if (oldestId === undefined) break;
    const oldest = decodedTileCache.get(oldestId);
    decodedTileCache.delete(oldestId);
    decodedCacheBytes = Math.max(0, decodedCacheBytes - (oldest?.byteLength ?? 0));
  }
  decodedTileCache.set(id, loaded);
  decodedCacheBytes += loaded.byteLength;
}

export function getSurfaceRefinementTile(id: string): Promise<SurfaceRefinementTile> {
  const metadata = metadataById.get(id);
  if (!metadata) return Promise.reject(new RangeError(`Unknown surface refinement tile: ${id}`));
  const decoded = decodedTileCache.get(id);
  if (decoded) {
    decodedTileCache.delete(id);
    decodedTileCache.set(id, decoded);
    return Promise.resolve(decoded);
  }
  const pendingTile = inFlightTiles.get(id);
  if (pendingTile) return pendingTile;
  const pending = fetch(assetUrl(metadata.assetPath))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${metadata.assetPath} (${response.status})`);
      const loaded = decode(metadata, (await response.json()) as SurfaceRefinementAsset);
      retainWithinBudget(id, loaded);
      inFlightTiles.delete(id);
      return loaded;
    })
    .catch((error: unknown) => {
      inFlightTiles.delete(id);
      throw error;
    });
  inFlightTiles.set(id, pending);
  return pending;
}

export const getModernReliefPatch = getSurfaceRefinementTile;

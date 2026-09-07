import type { ModernReliefPatch, ModernReliefPatchMetadata } from "./types";

interface ModernReliefAsset extends Omit<ModernReliefPatchMetadata, "assetPath"> {
  schemaVersion: 1;
  encoding: "int16-le-base64";
  scaleMetres: 1;
  elevation: string;
}

export const modernReliefPatches: ModernReliefPatchMetadata[] = [
  {
    id: "mid-atlantic-ridge",
    validRequestedAgeMa: [0, 0],
    bounds: [-60, 10, -30, 40],
    cellCenterBounds: [-59.94140625, 10.05859375, -30.05859375, 39.94140625],
    width: 256,
    height: 256,
    longitudeStep: 0.1171875,
    latitudeStep: 0.1171875,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    verticalDatum: "EGM2008",
    surfaceMode: "seafloor",
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceIds: ["noaa-etopo-2022"],
    assetPath: "data/etopo-mid-atlantic-ridge.json",
  },
  {
    id: "himalayas",
    validRequestedAgeMa: [0, 0],
    bounds: [72, 22, 100, 38],
    cellCenterBounds: [72.0546875, 22.03125, 99.9453125, 37.96875],
    width: 256,
    height: 256,
    longitudeStep: 0.109375,
    latitudeStep: 0.0625,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    verticalDatum: "EGM2008",
    surfaceMode: "surface",
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceIds: ["noaa-etopo-2022"],
    assetPath: "data/etopo-himalayas.json",
  },
  {
    id: "andes",
    validRequestedAgeMa: [0, 0],
    bounds: [-78, -32, -62, -15],
    cellCenterBounds: [-77.96875, -31.966796875, -62.03125, -15.033203125],
    width: 256,
    height: 256,
    longitudeStep: 0.0625,
    latitudeStep: 0.06640625,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    verticalDatum: "EGM2008",
    surfaceMode: "surface",
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceIds: ["noaa-etopo-2022"],
    assetPath: "data/etopo-andes.json",
  },
  {
    id: "east-african-rift",
    validRequestedAgeMa: [0, 0],
    bounds: [28, -15, 44, 14],
    cellCenterBounds: [28.03125, -14.943359375, 43.96875, 13.943359375],
    width: 256,
    height: 256,
    longitudeStep: 0.0625,
    latitudeStep: 0.11328125,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    verticalDatum: "EGM2008",
    surfaceMode: "surface",
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceIds: ["noaa-etopo-2022"],
    assetPath: "data/etopo-east-african-rift.json",
  },
  {
    id: "greenland",
    validRequestedAgeMa: [0, 0],
    bounds: [-60, 58, -20, 84],
    cellCenterBounds: [-59.921875, 58.05078125, -20.078125, 83.94921875],
    width: 256,
    height: 256,
    longitudeStep: 0.15625,
    latitudeStep: 0.1015625,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    verticalDatum: "EGM2008",
    surfaceMode: "surface",
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceIds: ["noaa-etopo-2022"],
    assetPath: "data/etopo-greenland.json",
  },
];

const metadataById = new Map(modernReliefPatches.map((metadata) => [metadata.id, metadata]));
const patchCache = new Map<string, Promise<ModernReliefPatch>>();

function assetUrl(path: string): string {
  return typeof document === "undefined" ? path : new URL(path, document.baseURI).toString();
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decode(metadata: ModernReliefPatchMetadata, asset: ModernReliefAsset): ModernReliefPatch {
  if (
    asset.schemaVersion !== 1 ||
    asset.encoding !== "int16-le-base64" ||
    asset.scaleMetres !== 1 ||
    asset.id !== metadata.id ||
    asset.width !== metadata.width ||
    asset.height !== metadata.height ||
    !sameNumbers(asset.validRequestedAgeMa, metadata.validRequestedAgeMa) ||
    !sameNumbers(asset.bounds, metadata.bounds) ||
    !sameNumbers(asset.cellCenterBounds, metadata.cellCenterBounds) ||
    asset.longitudeStep !== metadata.longitudeStep ||
    asset.latitudeStep !== metadata.latitudeStep ||
    asset.registration !== metadata.registration ||
    asset.rowOrder !== metadata.rowOrder ||
    asset.units !== metadata.units ||
    asset.verticalDatum !== metadata.verticalDatum ||
    asset.surfaceMode !== metadata.surfaceMode ||
    asset.sourceProduct !== metadata.sourceProduct ||
    asset.sourceIds.length !== metadata.sourceIds.length ||
    asset.sourceIds.some((value, index) => value !== metadata.sourceIds[index])
  ) {
    throw new Error(`Modern relief metadata mismatch for ${metadata.id}`);
  }
  const binary = atob(asset.elevation);
  if (binary.length !== metadata.width * metadata.height * 2) {
    throw new Error(`Modern relief byte length mismatch for ${metadata.id}`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const elevation = new Float32Array(metadata.width * metadata.height);
  for (let index = 0; index < elevation.length; index += 1) {
    elevation[index] = view.getInt16(index * 2, true);
  }
  return { ...metadata, elevation };
}

export function getModernReliefPatch(id: string): Promise<ModernReliefPatch> {
  const metadata = metadataById.get(id);
  if (!metadata) return Promise.reject(new RangeError(`Unknown modern relief patch: ${id}`));
  const cached = patchCache.get(id);
  if (cached) return cached;
  const pending = fetch(assetUrl(metadata.assetPath))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${metadata.assetPath} (${response.status})`);
      return decode(metadata, (await response.json()) as ModernReliefAsset);
    })
    .catch((error: unknown) => {
      patchCache.delete(id);
      throw error;
    });
  patchCache.set(id, pending);
  return pending;
}

export type LonLat = [longitude: number, latitude: number];

export type EvidenceStatus =
  | "observed"
  | "proxy-constrained"
  | "model-output"
  | "interpolation"
  | "synthesis"
  | "artistic-gap-fill"
  | "unknown";

export interface TimeSlice {
  id: string;
  label: string;
  ageMa: number;
  period: string;
  eon: string;
  description: string;
  evidence: EvidenceStatus;
  sourceIds: string[];
}

export interface Source {
  id: string;
  title: string;
  url: string;
  authors?: string;
  year?: number;
  version?: string;
  license: string;
  accessedAt: string;
  temporalRangeMa?: [oldest: number, youngest: number];
  geographicBasis?: string;
  referenceFrame?: string;
  notes?: string;
}

export type PointOfInterestCategory =
  | "formation"
  | "impact"
  | "life"
  | "climate"
  | "glaciation"
  | "tectonics"
  | "rift"
  | "mountain"
  | "volcanism"
  | "extinction"
  | "reference";

export interface PointOfInterest {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  ageStartMa: number;
  ageEndMa: number;
  coordinates?: LonLat;
  category: PointOfInterestCategory;
  sourceIds: string[];
  evidence: EvidenceStatus;
  locationNote?: string;
  coordinateUncertaintyKm?: number;
  confidence?: "A" | "B" | "C" | "D";
}

export interface LayerVisibility {
  clouds: boolean;
  borders: boolean;
  tectonics: boolean;
  rivers: boolean;
}

export interface GlobeStats {
  fps: number;
  backend: string;
  detail: string;
  triangles?: number;
  status?: string;
}

export interface ModernLandscapePreset {
  id: string;
  label: string;
  category: "landform" | "climate";
  coordinates: LonLat;
  distance: number;
  surfaceMode: "surface" | "seafloor";
  description: string;
  sourceIds: string[];
}

export type ModernClimateGroup =
  | "ocean"
  | "tropical-rainforest"
  | "tropical-seasonal"
  | "desert"
  | "steppe"
  | "temperate"
  | "cold-forest"
  | "tundra"
  | "frost";

export interface ModernClimateClass {
  value: number;
  code: string;
  description: string;
  group: ModernClimateGroup;
  rgb: [red: number, green: number, blue: number];
}

export interface ModernClimateControl {
  period: "1991–2020";
  width: number;
  height: number;
  cellSizeDegrees: number;
  longitudeOrigin: number;
  latitudeOrigin: number;
  noDataValue: number;
  classes: Uint8Array;
  legend: ModernClimateClass[];
  sourceIds: string[];
}

export type GeographicBounds = [west: number, south: number, east: number, north: number];

export interface ModernReliefPatchMetadata {
  id: string;
  validRequestedAgeMa: [oldest: 0, youngest: 0];
  bounds: GeographicBounds;
  cellCenterBounds: GeographicBounds;
  width: number;
  height: number;
  longitudeStep: number;
  latitudeStep: number;
  registration: "pixel-center";
  rowOrder: "north-to-south";
  units: "m";
  verticalDatum: "EGM2008";
  surfaceMode: "surface" | "seafloor";
  sourceProduct: "ETOPO_2022_v1_60s_surface";
  sourceIds: string[];
  assetPath: string;
}

export interface ModernReliefPatch extends ModernReliefPatchMetadata {
  elevation: Float32Array;
}

export interface LandPolygon {
  id: string;
  coordinates: LonLat[][];
}

export interface CountryOutline {
  id: string;
  name: string;
  lines: LonLat[][];
  sourceIds: string[];
  evidence: EvidenceStatus;
}

export type TectonicFeatureType =
  | "rift"
  | "mountain"
  | "subduction"
  | "volcano";

export interface TectonicFeature {
  id: string;
  name: string;
  type: TectonicFeatureType;
  coordinates: LonLat[];
  widthKm: number;
  heightKm: number;
  sourceIds: string[];
  ageStartMa?: number;
  ageEndMa?: number;
  evidence?: EvidenceStatus;
  caveat?: string;
  activity?: number;
  polarity?: number;
}

export interface ProceduralControls {
  width: number;
  height: number;
  elevation: Float32Array;
  potentialIce?: Uint8Array;
  vegetationPotential?: Uint8Array;
}

export type SurfaceStage =
  | "accretion"
  | "giant-impact"
  | "magma-ocean"
  | "cooling-crust"
  | "growing-oceans"
  | "microbial-world"
  | "barren-continents"
  | "early-land-plants"
  | "forest-world"
  | "flowering-plants"
  | "modern-biomes";

export interface WorldSnapshot extends TimeSlice {
  requestedAgeMa?: number;
  geographicSourceAgeMa?: number;
  land: LandPolygon[];
  countries: CountryOutline[];
  tectonics: TectonicFeature[];
  poiIds: string[];
  poiCoordinates?: Record<string, LonLat>;
  environment: {
    iceLatitude: number;
    vegetation: number;
    temperatureC?: number;
    stage?: SurfaceStage;
    oceanCoverage?: number;
    cloudCover?: number;
    atmosphereOpacity?: number;
    haze?: number;
    iceIntensity?: number;
    biomeStage?: number;
  };
  caveat: string;
  controls?: ProceduralControls;
  modernClimate?: ModernClimateControl;
}

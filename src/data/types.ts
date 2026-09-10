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
  guides: boolean;
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

export interface SurfaceRefinementTileMetadata {
  id: string;
  setId: string;
  level: number;
  parentId?: string;
  childIds: string[];
  priority: number;
  validRequestedAgeMa: [oldest: number, youngest: number];
  bounds: GeographicBounds;
  cellCenterBounds: GeographicBounds;
  width: number;
  height: number;
  longitudeStep: number;
  latitudeStep: number;
  registration: "pixel-center";
  rowOrder: "north-to-south";
  units: "m";
  horizontalCrs: string;
  referenceFrameId: string;
  verticalDatum: string;
  /** Display modes explicitly allowed to reuse this one decoded source tile. */
  applicableSurfaceModes?: readonly ("surface" | "seafloor")[];
  /** Primary representation recorded by the source asset. */
  surfaceMode: "surface" | "seafloor";
  domain: "land" | "bathymetry" | "topobathymetry";
  composition:
    | "absolute-replace"
    | "prepared-datum-transform"
    | "additive-residual"
    | "visual-feather";
  evidence: EvidenceStatus;
  nativeResolutionMetres: number;
  maxErrorMetres: number;
  splitErrorPixels: number;
  mergeErrorPixels: number;
  edgeTransitionCells: number;
  sourceProduct: string;
  sourceVersion: string;
  sourceIds: string[];
  assetPath: string;
}

export interface SurfaceRefinementTile extends SurfaceRefinementTileMetadata {
  elevation: Float32Array;
  landCoverage?: Uint8Array;
  byteLength: number;
}

export interface SurfaceRefinementSetMetadata {
  id: string;
  label: string;
  rootTileIds: string[];
  priority: number;
  cacheBudgetBytes: number;
  sourceIds: string[];
}

/** @deprecated Compatibility name while callers migrate to surface refinements. */
export type ModernReliefPatchMetadata = SurfaceRefinementTileMetadata;
/** @deprecated Compatibility name while callers migrate to surface refinements. */
export type ModernReliefPatch = SurfaceRefinementTile;

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

export interface AreaTrackingFeatureMetadata {
  id: string;
  countryId: string;
  name: string;
  plateId: number | null;
  validTimeMa: [oldest: number | null, youngest: number | null];
}

export interface AreaTrackingPartMetadata {
  id: number;
  feature: number;
  geometryIndex: number;
}

export interface AreaTrackingCatalog {
  schemaVersion: 1;
  id: string;
  plateModelId: string;
  referenceFrameId: string;
  coordinateEncoding: "int16-le-longitude-latitude";
  coordinateScaleDegrees: number;
  measure: "normalized-geodesic-arclength";
  sourceSimplificationToleranceDegrees: number;
  sourceIds: string[];
  features: AreaTrackingFeatureMetadata[];
  parts: AreaTrackingPartMetadata[];
}

export interface AreaTrackingLayer {
  ageMa: number;
  catalog: AreaTrackingCatalog;
  partIds: Uint16Array;
  pointOffsets: Uint32Array;
  coordinates: Int16Array;
  byteLength: number;
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

export interface TemporalSurfaceEndpoint {
  readonly ageMa: number;
  readonly controls: ProceduralControls;
}

export interface TemporalSurface {
  readonly intervalId: string;
  readonly seedId: string;
  readonly requestedAgeMa: number;
  readonly younger: TemporalSurfaceEndpoint;
  readonly older: TemporalSurfaceEndpoint;
  readonly fraction: number;
  readonly exactEndpoint: boolean;
  readonly evidence: "model-output" | "interpolation";
  readonly method: "material-registered-relative-elevation-with-discrete-fallback";
}

export interface TemporalReferenceEndpoint {
  readonly ageMa: number;
  readonly land: LandPolygon[];
  readonly countries: CountryOutline[];
  readonly poiCoordinates: Readonly<Record<string, LonLat>>;
  readonly areaTracking: AreaTrackingLayer;
}

export interface TemporalReferences {
  readonly younger: TemporalReferenceEndpoint;
  readonly older: TemporalReferenceEndpoint;
}

/** Serializable lifecycle descriptor; runtime resolver instances stay outside snapshots. */
export interface PeriodCoordinateViewDescriptor {
  readonly id: string;
  readonly frame: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly referenceFrameId: string;
    readonly anchorPlateId: number;
    readonly directionConvention: "gplates-xyz-x0e-y90e-znorth";
  };
  readonly motionUrl: string;
  readonly continentalUrl?: string;
  readonly lifecycleUrl?: string;
  readonly conversionEvidence: "same-model-motion" | "model-conversion-inference";
  readonly unsupportedPolicy: "nearest-native-discrete" | "masked-neutral";
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
  renderSeedId?: string;
  periodCoordinateView?: PeriodCoordinateViewDescriptor;
  requestedAgeMa?: number;
  geographicSourceAgeMa?: number;
  geographicSourceAgeBracketMa?: readonly [youngerAgeMa: number, olderAgeMa: number];
  temporalSurface?: TemporalSurface;
  temporalReferences?: TemporalReferences;
  land: LandPolygon[];
  countries: CountryOutline[];
  areaTracking?: AreaTrackingLayer;
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

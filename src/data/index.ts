export {
  PALEODEM_AGES,
  nearestPaleodemAge,
  resolvePaleodemAgeBracket,
  decodePaleodemElevation,
  fetchPaleodemElevation,
  type PaleodemAgeBracket,
  type PaleodemElevationAsset,
} from "./paleodem";

export { pointOfInterestIncludesAge, pointsOfInterest, sources, timeSlices } from "./catalog";
export { modernLandscapePresets } from "./landscape-presets";
export { environmentForAge } from "./environment";

export type {
  EvidenceStatus,
  GlobeStats,
  LayerVisibility,
  LonLat,
  ModernLandscapePreset,
  ModernClimateControl,
  ModernClimateGroup,
  ProceduralControls,
  CountryOutline,
  LandPolygon,
  AreaTrackingCatalog,
  AreaTrackingLayer,
  PointOfInterest,
  PointOfInterestCategory,
  Source,
  SurfaceStage,
  TimeSlice,
  WorldSnapshot,
} from "./types";

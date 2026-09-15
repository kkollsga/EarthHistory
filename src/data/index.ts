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
export {
  PALAEO_DETACHED_LIMITATIONS,
  PALAEO_MAP_INTERVAL_LIMITATIONS,
} from "./palaeoKeyText";
export { environmentForAge } from "./environment";

export type {
  EvidenceStatus,
  GlobeStats,
  LayerVisibility,
  LonLat,
  ModernLandscapePreset,
  ModernClimateControl,
  ModernClimateGroup,
  PalaeoCoastlineEvidence,
  PalaeoEvidenceReference,
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

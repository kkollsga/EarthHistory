export { pointOfInterestIncludesAge, pointsOfInterest, sources, timeSlices } from "./catalog";
export { modernLandscapePresets } from "./landscape-presets";
export {
  getModernReliefPatch,
  getSurfaceRefinementTile,
  modernReliefPatches,
  surfaceRefinementSets,
  surfaceRefinementTiles,
} from "./modern-relief";
export { getSnapshot } from "./snapshots";
export { selectSurfaceRefinementMetadata } from "./refinementSelection";

export type {
  AreaTrackingCatalog,
  AreaTrackingFeatureMetadata,
  AreaTrackingLayer,
  AreaTrackingPartMetadata,
  CountryOutline,
  EvidenceStatus,
  GlobeStats,
  GeographicBounds,
  LandPolygon,
  LayerVisibility,
  LonLat,
  ModernClimateClass,
  ModernClimateControl,
  ModernClimateGroup,
  ModernLandscapePreset,
  ModernReliefPatch,
  ModernReliefPatchMetadata,
  PointOfInterest,
  PointOfInterestCategory,
  ProceduralControls,
  Source,
  SurfaceRefinementSetMetadata,
  SurfaceRefinementTile,
  SurfaceRefinementTileMetadata,
  SurfaceStage,
  TectonicFeature,
  TectonicFeatureType,
  TimeSlice,
  WorldSnapshot,
} from "./types";

export { pointOfInterestIncludesAge, pointsOfInterest, sources, timeSlices } from "./catalog";
export { modernLandscapePresets } from "./landscape-presets";
export {
  getModernReliefPatch,
  surfaceRefinementAppliesToMode,
  getSurfaceRefinementTile,
  modernReliefPatches,
  surfaceRefinementSets,
  surfaceRefinementTiles,
} from "./modern-relief";
export { environmentForAge, getSnapshot, prefetchPaleodemAge, retimeSnapshot } from "./snapshots";
export { PALEODEM_AGES, resolvePaleodemAgeBracket } from "./paleodem";
export type { PaleodemAgeBracket } from "./paleodem";
export {
  createPeriodMaterialResolver,
  createPeriodCoordinateResolver,
  interpolatePeriodScalar,
  loadPeriodMotionCatalog,
  lonLatToPeriodDirection,
  periodDirectionToLonLat,
  paleomapCoordinateFrame,
  periodFramesMatch,
  resolvePeriodSourceAgeBracket,
  decodePeriodTopologyOwnership,
  periodMaterialIncludesAge,
  assertPeriodBoundaryReference,
  assertPeriodCoordinateView,
  periodPointMatchesView,
} from "./temporal";
export type {
  PaleomapIntervalResolver,
  PaleomapMotionCatalog,
  PeriodBoundaryReference,
  PeriodCoordinateFrame,
  PeriodCoordinateConversionResolver,
  PeriodCoordinateResult,
  PeriodCoordinateUnsupportedReason,
  PeriodCoordinateResolver,
  PeriodCoordinateView,
  PeriodMaterialCoordinate,
  PeriodMaterialKind,
  PeriodSourceAgeBracket,
  PeriodPointReference,
  PeriodTopologyOwnership,
  UnitDirection,
} from "./temporal";
export { createCaoTemporalCountryResolver, createTemporalCountryResolver } from "./temporalReferences";
export type {
  TemporalCountryPart,
  TemporalCountryReferences,
  TemporalCountryResolver,
} from "./temporalReferences";
export { caoCoordinateFrame, caoPeriodCoordinateViewDescriptor, createCaoPaleomapCrosswalk } from "./caoPaleomapCrosswalk";
export type {
  CaoPaleomapCrosswalk,
  CaoPaleomapCrosswalkResolved,
  CaoPaleomapCrosswalkResult,
  CaoPaleomapCrosswalkUnsupported,
  CaoPaleomapCrosswalkUnsupportedReason,
} from "./caoPaleomapCrosswalk";
export { loadCaoCoordinateViewBundle } from "./caoView";
export type { CaoCoordinateViewBundle } from "./caoView";
export { createCaoMaterialFocusResolver } from "./caoFocus";
export type { CaoMaterialFocusDescriptor } from "./caoFocus";
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
  PeriodCoordinateViewDescriptor,
  ProceduralControls,
  Source,
  SurfaceRefinementSetMetadata,
  SurfaceRefinementTile,
  SurfaceRefinementTileMetadata,
  SurfaceStage,
  TectonicFeature,
  TectonicFeatureType,
  TemporalSurface,
  TemporalSurfaceEndpoint,
  TemporalReferenceEndpoint,
  TemporalReferences,
  TimeSlice,
  WorldSnapshot,
} from "./types";

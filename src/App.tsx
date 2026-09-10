import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Aperture,
  BookOpen,
  Check,
  Cloud,
  Compass,
  Database,
  Gauge,
  Info,
  Layers3,
  Link,
  Map,
  Menu,
  Mountain,
  RotateCcw,
  Share2,
  Waves,
} from "lucide-react";
import { GlobeView, type PeriodCoordinateRenderState } from "./render";
import type { SurfaceMode } from "./render/surface";
import {
  getSnapshot,
  createCaoTemporalCountryResolver,
  createCaoMaterialFocusResolver,
  createTemporalCountryResolver,
  createPeriodCoordinateResolver,
  createPeriodMaterialResolver,
  environmentForAge,
  modernLandscapePresets,
  PALEODEM_AGES,
  pointOfInterestIncludesAge,
  pointsOfInterest,
  prefetchPaleodemAge,
  loadPeriodMotionCatalog,
  loadCaoCoordinateViewBundle,
  lonLatToPeriodDirection,
  paleomapCoordinateFrame,
  periodDirectionToLonLat,
  resolvePaleodemAgeBracket,
  retimeSnapshot,
  sources,
  timeSlices,
  type GlobeStats,
  type AreaTrackingLayer,
  type LayerVisibility,
  type LonLat,
  type PointOfInterest,
  type PaleomapMotionCatalog,
  type CaoCoordinateViewBundle,
  type CaoMaterialFocusDescriptor,
  type PeriodCoordinateResolver,
  type TemporalCountryReferences,
  type WorldSnapshot,
} from "./data";
import { EvidenceBadge } from "./components/EvidenceBadge";
import { Modal } from "./components/Modal";
import { formatAge, formatGeographicSourceAge, Timeline } from "./components/Timeline";
import {
  createAreaFocusDescriptor,
  resolveAreaFocusDescriptor,
  type AreaFocusDescriptor,
} from "./areaTracking";
import {
  parseAreaFocusDescriptor,
  parseCaoMaterialFocusDescriptor,
  parseFocusCoordinates,
  serializeAreaFocusDescriptor,
  serializeCaoMaterialFocusDescriptor,
  serializeFocusCoordinates,
} from "./focusState";

type Panel = "notes" | "sources" | "layers" | "about" | "quality" | null;
type Quality = "auto" | "high" | "low";
type CoordinateViewId = "paleomap" | "cao";
type SpatialFocus =
  | { kind: "poi"; poiId: string; coordinates: LonLat; nonce: number; distance?: number }
  | { kind: "place"; placeId: string; coordinates: LonLat; nonce: number; distance: number }
  | { kind: "area"; coordinates: LonLat; nonce: number; distance?: number };

const DEFAULT_LAYERS: LayerVisibility = {
  clouds: false,
  borders: true,
  guides: true,
  tectonics: false,
  rivers: false,
};

const LAYER_META: Array<{
  key: keyof LayerVisibility;
  label: string;
  detail: string;
  icon: typeof Cloud;
}> = [
  { key: "clouds", label: "Clouds", detail: "Atmospheric cloud cover", icon: Cloud },
  { key: "borders", label: "Modern-country reference", detail: "Present-day locator outlines; not historical borders", icon: Map },
  { key: "guides", label: "Reference guides", detail: "Schematic circulation and geographic guides, not period-specific evidence", icon: Compass },
  { key: "tectonics", label: "Tectonic references", detail: "Present-day schematic story corridors; historical boundaries require dated topology", icon: Mountain },
  { key: "rivers", label: "Inferred drainage", detail: "Modelled drainage tendency, not mapped ancient rivers", icon: Waves },
];

function parseInitialState() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const parsedAge = Number(params.get("age"));
  const layerParam = params.get("layers")?.split(",") ?? [];
  const reliefParam = params.get("relief");
  const parsedRelief = reliefParam === null ? Number.NaN : Number(reliefParam);
  const layers = layerParam.length
    ? (Object.fromEntries(
        Object.keys(DEFAULT_LAYERS).map((key) => [key, layerParam.includes(key)]),
      ) as unknown as LayerVisibility)
    : DEFAULT_LAYERS;
  return {
    age: Number.isFinite(parsedAge) ? Math.min(4567, Math.max(0, parsedAge)) : 0,
    layers,
    focus: params.get("focus"),
    place: params.get("place"),
    at: parseFocusCoordinates(params.get("at")),
    tracking: parseAreaFocusDescriptor(params.get("track")),
    materialFocus: parseCaoMaterialFocusDescriptor(params.get("material")),
    relief: Number.isFinite(parsedRelief) ? Math.min(30, Math.max(1, Math.round(parsedRelief))) : 8,
    surfaceMode: params.get("view") === "seafloor" ? "seafloor" as const : "surface" as const,
    coordinateView: params.get("coordinates") === "cao" ? "cao" as const : "paleomap" as const,
  };
}

function closestChapter(ageMa: number) {
  return timeSlices.reduce((closest, slice) =>
    Math.abs(slice.ageMa - ageMa) < Math.abs(closest.ageMa - ageMa) ? slice : closest,
  );
}

function serializeAge(ageMa: number) {
  const precision = ageMa < 1 ? 3 : ageMa < 100 ? 2 : 1;
  return String(Number(ageMa.toFixed(precision)));
}

function poiDisplayCoordinate(poi: PointOfInterest, snapshot: WorldSnapshot | null, ageMa: number) {
  if (!snapshot?.poiIds.includes(poi.id) || !pointOfInterestIncludesAge(poi, ageMa)) return undefined;
  return snapshot.poiCoordinates?.[poi.id];
}

function formatSnapshotSource(snapshot: WorldSnapshot | null, motionUnavailable: boolean): string {
  if (motionUnavailable && snapshot?.geographicSourceAgeMa !== undefined) {
    return `${formatGeographicSourceAge(snapshot.geographicSourceAgeMa)} · plate motion unavailable`;
  }
  if (snapshot?.temporalSurface === undefined) return "Illustrative field";
  const { younger, older, exactEndpoint } = snapshot.temporalSurface;
  if (exactEndpoint) return formatGeographicSourceAge(younger.ageMa);
  return `${formatAge(younger.ageMa)}–${formatAge(older.ageMa)} · interpolated`;
}

function snapshotLoadKey(ageMa: number): string {
  if (ageMa > 540) return `scenario-${closestChapter(ageMa).id}`;
  const bracket = resolvePaleodemAgeBracket(ageMa);
  return bracket.exact
    ? `paleodem-${bracket.youngerAgeMa}ma`
    : `paleodem-${bracket.youngerAgeMa}-${bracket.olderAgeMa}ma`;
}

function trackingMatchesMotion(
  tracking: AreaTrackingLayer,
  catalog: PaleomapMotionCatalog,
): boolean {
  const frame = paleomapCoordinateFrame(catalog);
  return tracking.catalog.plateModelId === frame.modelId &&
    tracking.catalog.referenceFrameId === frame.referenceFrameId;
}

export default function App() {
  const initial = useRef(parseInitialState()).current;
  const initialPoi = pointsOfInterest.find((poi) => poi.id === initial.focus);
  const initialLandscape = initialPoi === undefined && initial.age === 0
    ? modernLandscapePresets.find((preset) => preset.id === initial.place)
    : undefined;
  const initialArea = initialPoi === undefined && initialLandscape === undefined ? initial.at : null;
  const initialTracking = initialPoi === undefined && initialLandscape === undefined
    ? initial.coordinateView === "cao" && initial.materialFocus !== null ? null : initial.tracking
    : null;
  const initialMaterialFocus = initialPoi === undefined && initialLandscape === undefined &&
      initial.coordinateView === "cao" ? initial.materialFocus : null;
  const [ageMa, setAgeMa] = useState(initial.age);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>(initial.layers);
  const [panel, setPanel] = useState<Panel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuActiveIndex, setMenuActiveIndex] = useState(0);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(initialPoi?.id ?? null);
  const [areaFocusDescriptor, setAreaFocusDescriptor] = useState<AreaFocusDescriptor | null>(
    initialTracking,
  );
  const [caoFocusDescriptor, setCaoFocusDescriptor] = useState<CaoMaterialFocusDescriptor | null>(
    initialMaterialFocus,
  );
  const [areaFocusStatus, setAreaFocusStatus] = useState<
    "resolving" | "resolved" | "unresolved" | null
  >(initialTracking ? "resolving" : null);
  const [spatialFocus, setSpatialFocus] = useState<SpatialFocus | null>(
    initialLandscape
      ? {
          kind: "place",
          placeId: initialLandscape.id,
          coordinates: initialLandscape.coordinates,
          distance: initialLandscape.distance,
          nonce: 0,
        }
      : initialArea
        ? { kind: "area", coordinates: initialArea, nonce: 0, distance: 1.82 }
        : null,
  );
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(
    initialPoi === undefined && initialLandscape === undefined &&
      initialArea === null && initialTracking === null,
  );
  const [resetNonce, setResetNonce] = useState(0);
  const [quality, setQuality] = useState<Quality>("auto");
  const [verticalExaggeration, setVerticalExaggeration] = useState(initial.relief);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(
    initialLandscape?.surfaceMode ?? initial.surfaceMode,
  );
  const [selectedLandscapeId, setSelectedLandscapeId] = useState<string | null>(
    initialLandscape && initial.age === 0 ? initialLandscape.id : null,
  );
  const [stats, setStats] = useState<GlobeStats | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shareComplete, setShareComplete] = useState(false);
  const [motionCatalog, setMotionCatalog] = useState<PaleomapMotionCatalog | null>(null);
  const [periodCoordinateResolver, setPeriodCoordinateResolver] = useState<PeriodCoordinateResolver | null>(null);
  const [motionLoadError, setMotionLoadError] = useState<string | null>(null);
  const [coordinateView, setCoordinateView] = useState<CoordinateViewId>(initial.coordinateView);
  const [caoBundle, setCaoBundle] = useState<CaoCoordinateViewBundle | null>(null);
  const [caoPresentTracking, setCaoPresentTracking] = useState<AreaTrackingLayer | null>(null);
  const [caoLoadError, setCaoLoadError] = useState<string | null>(null);
  const [periodCoordinateState, setPeriodCoordinateState] = useState<PeriodCoordinateRenderState>({ status: null });
  const lastStatsUpdate = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelOpenedFromMenu = useRef(false);
  const focusNonce = useRef(0);
  const poiFocusHasResolved = useRef(false);
  const areaFocusHasResolved = useRef(initialArea !== null || initialMaterialFocus !== null);
  const requestedAgeRef = useRef(ageMa);
  requestedAgeRef.current = ageMa;
  const requestedSnapshotKeyRef = useRef(snapshotLoadKey(ageMa));
  requestedSnapshotKeyRef.current = snapshotLoadKey(ageMa);
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );
  const snapshotRequestController = useRef<AbortController | null>(null);
  const caoRequestController = useRef<AbortController | null>(null);
  const previousRequestedAge = useRef(ageMa);

  const selectedPoiRecord = useMemo(
    () => pointsOfInterest.find((poi) => poi.id === selectedPoiId) ?? null,
    [selectedPoiId],
  );
  const selectedPoi = selectedPoiRecord && pointOfInterestIncludesAge(selectedPoiRecord, ageMa)
    ? selectedPoiRecord
    : null;
  const selectedLandscape = useMemo(
    () => modernLandscapePresets.find((preset) => preset.id === selectedLandscapeId) ?? null,
    [selectedLandscapeId],
  );
  const orderedSlices = useMemo(() => [...timeSlices].sort((a, b) => a.ageMa - b.ageMa), []);
  const chapter = useMemo(() => closestChapter(ageMa), [ageMa]);
  const chapterReference = useMemo(
    () => chapter.sourceIds.map((sourceId) => sources.find((source) => source.id === sourceId)).find(Boolean),
    [chapter],
  );
  const chapterNumber = useMemo(
    () => [...orderedSlices].reverse().findIndex((slice) => slice.id === chapter.id) + 1,
    [chapter.id, orderedSlices],
  );
  const desiredSnapshotKey = snapshotLoadKey(ageMa);
  const retimedSnapshot = useMemo(
    () => snapshot === null ? null : retimeSnapshot(snapshot, ageMa),
    [ageMa, snapshot],
  );
  const paleomapCountryResolver = useMemo(() => {
    if (
      retimedSnapshot?.temporalReferences === undefined ||
      motionCatalog === null || periodCoordinateResolver === null
    ) return null;
    return createTemporalCountryResolver(
      retimedSnapshot.temporalReferences,
      motionCatalog,
      periodCoordinateResolver,
    );
  }, [motionCatalog, periodCoordinateResolver, retimedSnapshot?.temporalReferences]);
  const caoCountryResolver = useMemo(() => {
    if (caoBundle === null || caoPresentTracking === null || motionCatalog === null) return null;
    return createCaoTemporalCountryResolver(caoPresentTracking, motionCatalog, caoBundle.crosswalk);
  }, [caoBundle, caoPresentTracking, motionCatalog]);
  const caoFocusResolver = useMemo(
    () => caoBundle === null ? null : createCaoMaterialFocusResolver(caoBundle),
    [caoBundle],
  );
  const temporalCountryAge = retimedSnapshot?.requestedAgeMa ?? retimedSnapshot?.ageMa;
  const caoCoordinateAgeMa = coordinateView === "cao"
    ? periodCoordinateState.displayedAgeMa ?? ageMa
    : ageMa;
  const caoStagedCoordinateAgeMa = coordinateView === "cao"
    ? periodCoordinateState.stagedAgeMa ?? caoCoordinateAgeMa
    : ageMa;
  const countryCoordinateAgeMa = coordinateView === "cao" ? caoStagedCoordinateAgeMa : temporalCountryAge;
  const temporalCountries = useMemo<TemporalCountryReferences | undefined>(() =>
    countryCoordinateAgeMa === undefined
      ? undefined
      : coordinateView === "cao"
        ? caoCountryResolver?.resolve(countryCoordinateAgeMa)
        : paleomapCountryResolver?.resolve(countryCoordinateAgeMa),
  [caoCountryResolver, coordinateView, countryCoordinateAgeMa, paleomapCountryResolver]);
  const displayedSnapshot = useMemo<WorldSnapshot | null>(() => {
    if (
      motionLoadError !== null && retimedSnapshot?.temporalSurface !== undefined &&
      !retimedSnapshot.temporalSurface.exactEndpoint
    ) {
      return {
        ...retimedSnapshot,
        temporalSurface: undefined,
        temporalReferences: undefined,
        evidence: "model-output",
        caveat: `${retimedSnapshot.caveat} Plate motion is unavailable in this session, so the nearest native source frame is shown without temporal material interpolation.`,
      };
    }
    if (coordinateView === "cao") {
      if (retimedSnapshot === null || caoBundle === null || motionCatalog === null) return retimedSnapshot;
      const requestedAgeMa = retimedSnapshot.requestedAgeMa ?? retimedSnapshot.ageMa;
      const poiCoordinates = Object.fromEntries(retimedSnapshot.poiIds.flatMap((id) => {
        const poi = pointsOfInterest.find((candidate) => candidate.id === id);
        const plateId = motionCatalog.poiPlateIds[id];
        if (poi?.coordinates === undefined || plateId === undefined) return [];
        const resolved = caoBundle.crosswalk.resolveSourcePoint({
          frame: paleomapCoordinateFrame(motionCatalog),
          plateId,
          sourceAgeMa: 0,
          coordinates: poi.coordinates,
        }, caoCoordinateAgeMa);
        return resolved.status === "resolved" ? [[id, resolved.targetCoordinates]] : [];
      }));
      const temporalSurface = retimedSnapshot.temporalSurface === undefined
        ? undefined
        : {
            ...retimedSnapshot.temporalSurface,
            intervalId: `${caoBundle.descriptor.id}:${retimedSnapshot.temporalSurface.intervalId}`,
          };
      return {
        ...retimedSnapshot,
        id: `${retimedSnapshot.id}__${caoBundle.descriptor.id}`,
        periodCoordinateView: caoBundle.descriptor,
        temporalSurface,
        land: [],
        countries: temporalCountries === undefined ? [] : [...temporalCountries.countries],
        poiCoordinates,
        sourceIds: [...new Set([
          ...retimedSnapshot.sourceIds,
          "cao-plate-model-2024-v2-4",
          "stein-stein-gdh1-1992",
        ])],
        evidence: "synthesis",
        caveat: `${retimedSnapshot.caveat} Cao-frame continental heights use a documented model-conversion inference; unsupported material is masked with neutral low relief. Ocean motion and dated boundaries are target-native Cao geometry.`,
      };
    }
    if (
      retimedSnapshot?.temporalSurface === undefined ||
      retimedSnapshot.temporalReferences === undefined ||
      retimedSnapshot.temporalSurface.exactEndpoint ||
      periodCoordinateResolver === null || motionCatalog === null
    ) return retimedSnapshot === null || temporalCountries === undefined
      ? retimedSnapshot
      : { ...retimedSnapshot, countries: [...temporalCountries.countries] };
    const source = retimedSnapshot.temporalReferences.younger;
    const poiCoordinates = Object.fromEntries(retimedSnapshot.poiIds.flatMap((id) => {
      const coordinates = source.poiCoordinates[id];
      const plateId = motionCatalog.poiPlateIds[id];
      if (coordinates === undefined || plateId === undefined) return [];
      const resolved = periodCoordinateResolver(
        {
          frame: paleomapCoordinateFrame(motionCatalog),
          plateId,
          sourceAgeMa: source.ageMa,
          coordinates,
        },
        retimedSnapshot.requestedAgeMa ?? retimedSnapshot.ageMa,
      );
      return resolved === undefined ? [] : [[id, resolved]];
    }));
    return {
      ...retimedSnapshot,
      countries: temporalCountries === undefined
        ? retimedSnapshot.countries
        : [...temporalCountries.countries],
      poiCoordinates,
    };
  }, [caoBundle, caoCoordinateAgeMa, coordinateView, motionCatalog, motionLoadError, periodCoordinateResolver, retimedSnapshot, temporalCountries]);
  const temporalPoiCoordinates = useMemo<Readonly<Record<string, LonLat>> | undefined>(() => {
    if (coordinateView !== "cao") return displayedSnapshot?.poiCoordinates;
    if (retimedSnapshot === null || caoBundle === null || motionCatalog === null) return undefined;
    return Object.fromEntries(retimedSnapshot.poiIds.flatMap((id) => {
      const poi = pointsOfInterest.find((candidate) => candidate.id === id);
      const plateId = motionCatalog.poiPlateIds[id];
      if (poi?.coordinates === undefined || plateId === undefined) return [];
      const resolved = caoBundle.crosswalk.resolveSourcePoint({
        frame: paleomapCoordinateFrame(motionCatalog),
        plateId,
        sourceAgeMa: 0,
        coordinates: poi.coordinates,
      }, caoStagedCoordinateAgeMa);
      return resolved.status === "resolved" ? [[id, resolved.targetCoordinates]] : [];
    }));
  }, [caoBundle, caoStagedCoordinateAgeMa, coordinateView, displayedSnapshot?.poiCoordinates, motionCatalog, retimedSnapshot]);
  const expectedSnapshotKey = coordinateView === "cao" && caoBundle !== null
    ? `${caoBundle.descriptor.id}:${desiredSnapshotKey}`
    : desiredSnapshotKey;
  const contextSnapshot = ageMa <= 540
    ? motionLoadError !== null
      ? displayedSnapshot?.id.endsWith(`__${desiredSnapshotKey}`) ? displayedSnapshot : null
      : displayedSnapshot?.temporalSurface?.intervalId === expectedSnapshotKey ? displayedSnapshot : null
    : displayedSnapshot?.id === `${closestChapter(ageMa).id}__scenario` ? displayedSnapshot : null;
  const selectedPoiCoordinate = selectedPoi
    ? poiDisplayCoordinate(selectedPoi, contextSnapshot, ageMa)
    : undefined;
  const requestedEnvironment = useMemo(() => environmentForAge(ageMa), [ageMa]);
  const activeTemporalSurface = useMemo(() => {
    if (ageMa > 540 || displayedSnapshot?.temporalSurface === undefined) return displayedSnapshot?.temporalSurface;
    const bracket = resolvePaleodemAgeBracket(ageMa);
    const sourceIntervalId = bracket.exact
      ? `paleodem-${bracket.youngerAgeMa}ma`
      : `paleodem-${bracket.youngerAgeMa}-${bracket.olderAgeMa}ma`;
    const intervalId = coordinateView === "cao" && caoBundle !== null
      ? `${caoBundle.descriptor.id}:${sourceIntervalId}`
      : sourceIntervalId;
    return displayedSnapshot.temporalSurface.intervalId === intervalId
      ? { ...displayedSnapshot.temporalSurface, requestedAgeMa: ageMa, fraction: bracket.fraction }
      : displayedSnapshot.temporalSurface;
  }, [ageMa, caoBundle, coordinateView, displayedSnapshot]);
  const currentPois = useMemo(
    () => pointsOfInterest
      .filter((poi) => pointOfInterestIncludesAge(poi, ageMa))
      .sort((a, b) => b.ageStartMa - a.ageStartMa),
    [ageMa],
  );

  const loadSnapshot = useCallback(async (age: number) => {
    snapshotRequestController.current?.abort();
    const controller = new AbortController();
    snapshotRequestController.current = controller;
    const direction = Math.sign(age - previousRequestedAge.current);
    previousRequestedAge.current = age;
    const requestKey = snapshotLoadKey(age);
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getSnapshot(age, controller.signal);
      if (requestedSnapshotKeyRef.current === requestKey && !controller.signal.aborted) {
        setSnapshot(retimeSnapshot(next, requestedAgeRef.current));
        const temporal = next.temporalSurface;
        if (temporal !== undefined && direction !== 0) {
          const candidate = direction > 0
            ? temporal.older.ageMa + 5
            : temporal.younger.ageMa - 5;
          if (candidate >= 0 && candidate <= 540) void prefetchPaleodemAge(candidate).catch(() => {});
        }
      }
    } catch (error) {
      if (requestedSnapshotKeyRef.current === requestKey && !controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "This reconstruction could not be loaded.");
      }
    } finally {
      if (requestedSnapshotKeyRef.current === requestKey && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(ageMa);
  }, [desiredSnapshotKey, loadSnapshot]);

  useEffect(() => () => snapshotRequestController.current?.abort(), []);

  useEffect(() => {
    let active = true;
    void loadPeriodMotionCatalog().then((catalog) => {
      if (!active) return;
      setMotionCatalog(catalog);
      setPeriodCoordinateResolver(() => createPeriodCoordinateResolver(catalog));
      setMotionLoadError(null);
    }).catch((error: unknown) => {
      if (!active) return;
      setPeriodCoordinateResolver(null);
      setMotionLoadError(error instanceof Error ? error.message : "Plate motion could not be loaded");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (motionLoadError !== null && coordinateView === "cao") {
      setCaoLoadError("Cao coordinates require the PALEOMAP source-motion crosswalk");
      setCoordinateView("paleomap");
    }
  }, [coordinateView, motionLoadError]);

  useEffect(() => {
    if (coordinateView !== "cao" || motionCatalog === null) {
      caoRequestController.current?.abort();
      return;
    }
    if (caoBundle !== null) return;
    caoRequestController.current?.abort();
    const controller = new AbortController();
    caoRequestController.current = controller;
    setCaoLoadError(null);
    void Promise.all([
      loadCaoCoordinateViewBundle(motionCatalog),
      getSnapshot(0, controller.signal),
    ]).then(([bundle, present]) => {
      if (controller.signal.aborted) return;
      setCaoBundle(bundle);
      setCaoPresentTracking(present.areaTracking ?? null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setCaoLoadError(error instanceof Error ? error.message : "Cao coordinate view could not be loaded");
      setCoordinateView("paleomap");
    });
    return () => controller.abort();
  }, [caoBundle, coordinateView, motionCatalog]);

  useEffect(() => () => caoRequestController.current?.abort(), []);

  const handleStats = useCallback((next: GlobeStats) => {
    const now = performance.now();
    if (now - lastStatsUpdate.current < 900) return;
    lastStatsUpdate.current = now;
    setStats(next);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("age", serializeAge(ageMa));
    const visibleLayers = Object.entries(layers)
      .filter(([, visible]) => visible)
      .map(([key]) => key);
    params.set("layers", visibleLayers.join(","));
    params.set("relief", String(verticalExaggeration));
    if (surfaceMode === "seafloor") params.set("view", "seafloor");
    if (coordinateView === "cao") params.set("coordinates", "cao");
    if (selectedPoiId) params.set("focus", selectedPoiId);
    else if (spatialFocus?.kind === "place") params.set("place", spatialFocus.placeId);
    else if (caoFocusDescriptor !== null && coordinateView === "cao") {
      params.set("material", serializeCaoMaterialFocusDescriptor(caoFocusDescriptor));
      if (spatialFocus?.kind === "area" && areaFocusStatus === "resolved") {
        params.set("at", serializeFocusCoordinates(spatialFocus.coordinates));
      }
    } else if (areaFocusDescriptor !== null) {
      params.set("track", serializeAreaFocusDescriptor(areaFocusDescriptor));
      if (spatialFocus?.kind === "area" && areaFocusStatus === "resolved") {
        params.set("at", serializeFocusCoordinates(spatialFocus.coordinates));
      }
    } else if (spatialFocus?.kind === "area") {
      params.set("at", serializeFocusCoordinates(spatialFocus.coordinates));
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${params}`);
  }, [ageMa, areaFocusDescriptor, areaFocusStatus, caoFocusDescriptor, coordinateView, layers, selectedPoiId, spatialFocus, surfaceMode, verticalExaggeration]);

  useEffect(() => {
    if (!playing || orderedSlices.length === 0) return;
    if (ageMa <= 540) {
      let previous = performance.now();
      let frame = 0;
      const advance = (now: number) => {
        const elapsed = Math.min(100, now - previous);
        previous = now;
        setAgeMa((current) => {
          const next = Math.max(0, current - elapsed * (5 / 1800));
          if (next === 0) setPlaying(false);
          return next;
        });
        frame = requestAnimationFrame(advance);
      };
      frame = requestAnimationFrame(advance);
      return () => cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => {
      setAgeMa((current) => {
        const newer = [...orderedSlices].reverse().find((slice) => slice.ageMa < current - 0.01);
        if (!newer) {
          setPlaying(false);
          return 0;
        }
        return newer.ageMa;
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [ageMa > 540, playing, orderedSlices]);

  useEffect(() => {
    if (selectedPoiId === null || selectedPoiRecord === null || selectedPoi !== null) return;
    poiFocusHasResolved.current = false;
    setSelectedPoiId(null);
    setSpatialFocus((current) =>
      current?.kind === "poi" && current.poiId === selectedPoiId ? null : current
    );
    setAutoRotateEnabled(true);
  }, [selectedPoi, selectedPoiId, selectedPoiRecord]);

  useEffect(() => {
    if (!selectedPoi) return;
    if (contextSnapshot === null) return;
    if (!selectedPoiCoordinate) {
      setSpatialFocus((current) =>
        current?.kind === "poi" && current.poiId === selectedPoi.id ? null : current
      );
      setAutoRotateEnabled(true);
      return;
    }
    setAutoRotateEnabled(false);
    const preserveDistance = poiFocusHasResolved.current;
    poiFocusHasResolved.current = true;
    setSpatialFocus((current) => {
      if (
        current?.kind === "poi" && current.poiId === selectedPoi.id &&
        current.coordinates[0] === selectedPoiCoordinate[0] &&
        current.coordinates[1] === selectedPoiCoordinate[1]
      ) return current;
      return {
        kind: "poi",
        poiId: selectedPoi.id,
        coordinates: selectedPoiCoordinate,
        nonce: ++focusNonce.current,
        distance: current?.kind === "poi" || preserveDistance ? undefined : 1.82,
      };
    });
  }, [selectedPoi, selectedPoiCoordinate]);

  useEffect(() => {
    if (caoFocusDescriptor === null) return;
    if (coordinateView !== "cao") {
      setAreaFocusStatus(null);
      setSpatialFocus((current) => current?.kind === "area" ? null : current);
      return;
    }
    if (caoFocusResolver === null) {
      setAreaFocusStatus("resolving");
      return;
    }
    const coordinates = caoFocusResolver.resolve(caoFocusDescriptor, caoCoordinateAgeMa);
    if (coordinates === undefined) {
      setAreaFocusStatus("unresolved");
      setSpatialFocus((current) => current?.kind === "area" ? null : current);
      return;
    }
    setAreaFocusStatus("resolved");
    setAutoRotateEnabled(false);
    const preserveDistance = areaFocusHasResolved.current;
    areaFocusHasResolved.current = true;
    setSpatialFocus((current) => {
      if (current?.kind === "area" && Math.abs(current.coordinates[0] - coordinates[0]) < 0.0001 &&
          Math.abs(current.coordinates[1] - coordinates[1]) < 0.0001) return current;
      return { kind: "area", coordinates, nonce: ++focusNonce.current,
        distance: current?.kind === "area" || preserveDistance ? undefined : 1.82 };
    });
  }, [caoCoordinateAgeMa, caoFocusDescriptor, caoFocusResolver, coordinateView]);

  useEffect(() => {
    if (caoFocusDescriptor !== null) return;
    if (areaFocusDescriptor === null) return;
    if (contextSnapshot === null) {
      setAreaFocusStatus("resolving");
      return;
    }
    if (contextSnapshot.areaTracking === undefined) {
      setAreaFocusStatus("unresolved");
      setSpatialFocus((current) => current?.kind === "area" ? null : current);
      return;
    }
    const referenceCandidates = contextSnapshot.temporalReferences === undefined
      ? [contextSnapshot.areaTracking]
      : [
          contextSnapshot.temporalReferences.younger.areaTracking,
          contextSnapshot.temporalReferences.older.areaTracking,
        ];
    const candidate = referenceCandidates
      .map((tracking) => ({
        tracking,
        resolution: resolveAreaFocusDescriptor(tracking, areaFocusDescriptor),
      }))
      .find(({ tracking, resolution }) => {
        if (resolution.status !== "resolved") return false;
        const part = tracking.catalog.parts[areaFocusDescriptor.partId];
        const feature = part === undefined ? undefined : tracking.catalog.features[part.feature];
        if (feature === undefined) return false;
        const [oldest, youngest] = feature.validTimeMa;
        return (oldest === null || ageMa <= oldest) && (youngest === null || ageMa >= youngest);
      });
    if (candidate === undefined) {
      setAreaFocusStatus("unresolved");
      setSpatialFocus((current) => current?.kind === "area" ? null : current);
      return;
    }
    const { tracking, resolution } = candidate;
    if (resolution.status !== "resolved") return;
    const part = tracking.catalog.parts[areaFocusDescriptor.partId];
    const feature = part === undefined ? undefined : tracking.catalog.features[part.feature];
    const displayCoordinates: LonLat | undefined = feature?.plateId == null || motionCatalog === null ||
        !trackingMatchesMotion(tracking, motionCatalog)
      ? undefined
      : coordinateView === "cao"
        ? (() => {
            const result = caoBundle?.crosswalk.resolveSourcePoint({
            frame: paleomapCoordinateFrame(motionCatalog),
            plateId: feature.plateId,
            sourceAgeMa: tracking.ageMa,
            coordinates: resolution.coordinates,
            }, caoCoordinateAgeMa);
            return result?.status === "resolved" ? result.targetCoordinates : undefined;
          })()
        : Math.abs(tracking.ageMa - ageMa) < 1e-9
          ? resolution.coordinates
          : periodCoordinateResolver?.({
              frame: paleomapCoordinateFrame(motionCatalog),
              plateId: feature.plateId,
              sourceAgeMa: tracking.ageMa,
              coordinates: resolution.coordinates,
            }, ageMa);
    if (displayCoordinates === undefined) {
      setAreaFocusStatus(coordinateView === "cao" && caoBundle === null || periodCoordinateResolver === null ? "resolving" : "unresolved");
      setSpatialFocus((current) => current?.kind === "area" ? null : current);
      return;
    }
    setAreaFocusStatus("resolved");
    setAutoRotateEnabled(false);
    const preserveDistance = areaFocusHasResolved.current;
    areaFocusHasResolved.current = true;
    setSpatialFocus((current) => {
      if (
        current?.kind === "area" &&
        Math.abs(current.coordinates[0] - displayCoordinates[0]) < 0.0001 &&
        Math.abs(current.coordinates[1] - displayCoordinates[1]) < 0.0001
      ) return current;
      return {
        kind: "area",
        coordinates: displayCoordinates,
        nonce: ++focusNonce.current,
        distance: current?.kind === "area" || preserveDistance
          ? undefined
          : 1.82,
      };
    });
  }, [ageMa, areaFocusDescriptor, caoBundle, caoCoordinateAgeMa, caoFocusDescriptor, contextSnapshot, coordinateView, motionCatalog, periodCoordinateResolver]);

  useEffect(() => {
    if (ageMa <= 0.0001) return;
    setSelectedLandscapeId(null);
    setSpatialFocus((current) => current?.kind === "place" ? null : current);
  }, [ageMa]);

  useEffect(() => {
    if (ageMa > 540 && coordinateView === "cao") setCoordinateView("paleomap");
  }, [ageMa, coordinateView]);

  useEffect(() => {
    if (coordinateView === "paleomap") setPeriodCoordinateState({ status: null });
  }, [coordinateView]);

  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const onPointerDown = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node) && !menuButtonRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    requestAnimationFrame(() => items()[0]?.focus());
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      const focusable = [...document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextTarget = focusable[currentIndex + (event.shiftKey ? -1 : 1)];
      event.preventDefault();
      setMenuOpen(false);
      requestAnimationFrame(() => nextTarget?.focus());
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const menuItems = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (!menuItems.length) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? menuItems.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + menuItems.length) % menuItems.length
          : (currentIndex - 1 + menuItems.length) % menuItems.length;
    setMenuActiveIndex(nextIndex);
    menuItems[nextIndex]?.focus();
  };

  const changeAge = useCallback((age: number) => {
    setPlaying(false);
    const nextAge = Math.min(4567.3, Math.max(0, age));
    if (nextAge > 0.0001) setSelectedLandscapeId(null);
    setAgeMa(nextAge);
  }, []);

  const handlePlayingChange = (next: boolean) => {
    if (next && ageMa <= 0.01 && orderedSlices.length) setAgeMa(orderedSlices[orderedSlices.length - 1].ageMa);
    setPlaying(next);
  };

  const stepChapter = (direction: -1 | 1) => {
    if (!orderedSlices.length) return;
    const currentIndex = orderedSlices.reduce((best, slice, index) =>
      Math.abs(slice.ageMa - ageMa) < Math.abs(orderedSlices[best].ageMa - ageMa) ? index : best,
    0);
    changeAge(orderedSlices[Math.min(orderedSlices.length - 1, Math.max(0, currentIndex + direction))].ageMa);
  };

  const openPoi = (id: string, openNotes = true) => {
    const poi = pointsOfInterest.find((item) => item.id === id);
    if (!poi || !pointOfInterestIncludesAge(poi, ageMa)) return;
    setSelectedPoiId(id);
    setSelectedLandscapeId(null);
    setAreaFocusDescriptor(null);
    setCaoFocusDescriptor(null);
    setAreaFocusStatus(null);
    areaFocusHasResolved.current = false;
    if (openNotes) setPanel("notes");
    const coordinates = poiDisplayCoordinate(poi, contextSnapshot, ageMa);
    if (coordinates) {
      setAutoRotateEnabled(false);
      setSpatialFocus({
        kind: "poi",
        poiId: poi.id,
        coordinates,
        nonce: ++focusNonce.current,
        distance: 1.82,
      });
      poiFocusHasResolved.current = true;
    } else {
      poiFocusHasResolved.current = false;
      setSpatialFocus(null);
      setAutoRotateEnabled(true);
    }
  };

  const selectSurface = (coordinates: LonLat) => {
    setAutoRotateEnabled(false);
    if (
      spatialFocus !== null || selectedPoiId !== null ||
      selectedLandscapeId !== null || areaFocusDescriptor !== null || caoFocusDescriptor !== null
    ) {
      setSelectedPoiId(null);
      setSelectedLandscapeId(null);
      setAreaFocusDescriptor(null);
      setCaoFocusDescriptor(null);
      setAreaFocusStatus(null);
      areaFocusHasResolved.current = false;
      poiFocusHasResolved.current = false;
      setSpatialFocus(null);
      return;
    }
    setSelectedPoiId(null);
    poiFocusHasResolved.current = false;
    setSelectedLandscapeId(null);
    if (coordinateView === "cao") {
      const descriptor = caoFocusResolver?.create(coordinates, caoCoordinateAgeMa) ?? null;
      setAreaFocusDescriptor(null);
      setCaoFocusDescriptor(descriptor);
      setAreaFocusStatus(descriptor === null ? "unresolved" : "resolved");
      areaFocusHasResolved.current = descriptor !== null;
      setSpatialFocus({ kind: "area", coordinates, nonce: ++focusNonce.current, distance: 1.82 });
      return;
    }
    setCaoFocusDescriptor(null);
    const temporalReferences = contextSnapshot?.temporalReferences;
    const tracking = temporalReferences?.younger.areaTracking ?? contextSnapshot?.areaTracking;
    let trackingCoordinates: LonLat | undefined = coordinates;
    if (
      tracking !== undefined && contextSnapshot?.temporalSurface !== undefined &&
      !contextSnapshot.temporalSurface.exactEndpoint
    ) {
      const material = motionCatalog === null || !trackingMatchesMotion(tracking, motionCatalog)
        ? null
        : createPeriodMaterialResolver(motionCatalog, ageMa)
          .resolveAt(lonLatToPeriodDirection(coordinates));
      trackingCoordinates = material === null
        ? undefined
        : periodDirectionToLonLat(material.youngerDirection);
    }
    let descriptor = tracking === undefined || trackingCoordinates === undefined
      ? null
      : createAreaFocusDescriptor(tracking, trackingCoordinates, 25 * Math.PI / 180);
    if (descriptor === null && temporalReferences !== undefined &&
      temporalReferences.older.areaTracking !== tracking && motionCatalog !== null &&
      trackingMatchesMotion(temporalReferences.older.areaTracking, motionCatalog)
    ) {
      const material = createPeriodMaterialResolver(motionCatalog, ageMa)
        .resolveAt(lonLatToPeriodDirection(coordinates));
      if (material !== null) {
        descriptor = createAreaFocusDescriptor(
          temporalReferences.older.areaTracking,
          periodDirectionToLonLat(material.olderDirection),
          25 * Math.PI / 180,
        );
      }
    }
    setAreaFocusDescriptor(descriptor);
    setAreaFocusStatus(descriptor === null ? null : "resolved");
    areaFocusHasResolved.current = descriptor !== null;
    setSpatialFocus({
      kind: "area",
      coordinates,
      nonce: ++focusNonce.current,
      distance: 1.82,
    });
  };

  const clearSelectedPoi = () => {
    poiFocusHasResolved.current = false;
    setSelectedPoiId(null);
    if (spatialFocus?.kind === "poi") {
      setSpatialFocus(null);
      setAutoRotateEnabled(false);
    }
  };

  const resetCamera = () => {
    setSelectedLandscapeId(null);
    setSelectedPoiId(null);
    poiFocusHasResolved.current = false;
    setAreaFocusDescriptor(null);
    setCaoFocusDescriptor(null);
    setAreaFocusStatus(null);
    areaFocusHasResolved.current = false;
    setSpatialFocus(null);
    setAutoRotateEnabled(true);
    setResetNonce((value) => value + 1);
  };

  const openMenuPanel = (nextPanel: Exclude<Panel, "notes" | null>) => {
    panelOpenedFromMenu.current = true;
    setMenuOpen(false);
    setPanel(nextPanel);
  };

  const closePanel = () => {
    setPanel(null);
    if (panelOpenedFromMenu.current) {
      panelOpenedFromMenu.current = false;
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  };

  const handleMenuReset = () => {
    resetCamera();
    setMenuOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const selectLandscape = (id: string) => {
    const preset = modernLandscapePresets.find((item) => item.id === id);
    setSelectedLandscapeId(preset?.id ?? null);
    setSelectedPoiId(null);
    poiFocusHasResolved.current = false;
    setAreaFocusDescriptor(null);
    setCaoFocusDescriptor(null);
    setAreaFocusStatus(null);
    areaFocusHasResolved.current = false;
    setLayers((current) => ({ ...current, clouds: false }));
    if (preset) setSurfaceMode(preset.surfaceMode);
    if (!preset) {
      setSpatialFocus(null);
      setAutoRotateEnabled(true);
      setResetNonce((value) => value + 1);
      return;
    }
    setAgeMa(0);
    setAutoRotateEnabled(false);
    setSpatialFocus({
      kind: "place",
      placeId: preset.id,
      coordinates: preset.coordinates,
      distance: preset.distance,
      nonce: ++focusNonce.current,
    });
  };

  const shareView = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareComplete(true);
      window.setTimeout(() => setShareComplete(false), 1800);
    } catch {
      window.prompt("Copy this view", window.location.href);
    }
  };

  const activeSourceIds = new Set([
    ...(contextSnapshot?.sourceIds ?? []),
    ...(selectedLandscape?.sourceIds ?? []),
  ]);
  const snapshotSources = sources.filter((source) => activeSourceIds.has(source.id));
  const poiSources = sources.filter((source) => selectedPoi?.sourceIds.includes(source.id));
  const scenarioLike = chapter.ageMa > 540;

  return (
    <main className="atlas-shell">
      <header className="site-header">
        <button className="brand" type="button" onClick={() => changeAge(0)} aria-label="Earth History, return to today">
          <span className="brand-orbit" aria-hidden="true"><span /></span>
          <span><b>EARTH</b><i>HISTORY</i></span>
        </button>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button type="button" className="is-active" onClick={() => setPanel(null)}>Explore</button>
          <button type="button" onClick={() => {
            panelOpenedFromMenu.current = false;
            setPanel("notes");
          }}>Field notes</button>
        </nav>
        <div className="site-menu">
          <button
            ref={menuButtonRef}
            type="button"
            className="menu-button"
            aria-label="Open menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="site-menu-items"
            onClick={() => {
              if (!menuOpen) setMenuActiveIndex(0);
              setMenuOpen((current) => !current);
            }}
          >
            <Menu size={19} aria-hidden="true" />
            <span>Menu</span>
          </button>
          {menuOpen && (
            <div ref={menuRef} id="site-menu-items" className="menu-popover" role="menu" aria-label="Explore tools" onKeyDown={handleMenuKeyDown}>
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 0 ? 0 : -1} onFocus={() => setMenuActiveIndex(0)} onClick={() => openMenuPanel("layers")}>
                <Layers3 size={17} aria-hidden="true" /><span>Layers &amp; relief</span>
                <small>{Object.values(layers).filter(Boolean).length} visible</small>
              </button>
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 1 ? 0 : -1} onFocus={() => setMenuActiveIndex(1)} onClick={handleMenuReset}>
                <Compass size={17} aria-hidden="true" /><span>Reset camera</span>
              </button>
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 2 ? 0 : -1} onFocus={() => setMenuActiveIndex(2)} onClick={() => openMenuPanel("quality")}>
                <Gauge size={17} aria-hidden="true" /><span>Rendering quality</span><small>{quality}</small>
              </button>
              <span className="menu-rule" aria-hidden="true" />
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 3 ? 0 : -1} onFocus={() => setMenuActiveIndex(3)} onClick={() => openMenuPanel("sources")}>
                <Database size={17} aria-hidden="true" /><span>Sources</span>
              </button>
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 4 ? 0 : -1} onFocus={() => setMenuActiveIndex(4)} onClick={() => openMenuPanel("about")}>
                <Info size={17} aria-hidden="true" /><span>About</span>
              </button>
              <button type="button" role="menuitem" tabIndex={menuActiveIndex === 5 ? 0 : -1} onFocus={() => setMenuActiveIndex(5)} onClick={shareView}>
                {shareComplete ? <Check size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}
                <span>{shareComplete ? "Link copied" : "Share view"}</span>
              </button>
            </div>
          )}
        </div>
        <span className="share-status" aria-live="polite">{shareComplete ? "View link copied" : ""}</span>
      </header>

      <section className="globe-stage" aria-label="Interactive Earth reconstruction">
        <GlobeView
          snapshot={displayedSnapshot}
          temporalSurface={activeTemporalSurface}
          temporalCountries={temporalCountries}
          temporalPoiCoordinates={temporalPoiCoordinates}
          temporalPoiAgeMa={coordinateView === "cao" ? caoStagedCoordinateAgeMa : displayedSnapshot?.requestedAgeMa ?? displayedSnapshot?.ageMa}
          temporalEnvironment={requestedEnvironment}
          layers={layers}
          selectedPoiId={selectedPoiId}
          onSelectPoi={(id: string) => openPoi(id)}
          onSelectSurface={selectSurface}
          onStats={handleStats}
          onPeriodCoordinateState={setPeriodCoordinateState}
          focusTarget={spatialFocus}
          resetNonce={resetNonce}
          autoRotate={!reducedMotion && autoRotateEnabled}
          quality={quality}
          verticalExaggeration={verticalExaggeration}
          surfaceMode={surfaceMode}
        />
        <div className="stage-vignette" aria-hidden="true" />
        {loading && <div className="loading-state"><span /> Resolving {formatAge(ageMa)}</div>}
        {loadError && (
          <div className="error-state" role="alert">
            <p>Reconstruction unavailable</p>
            <span>{loadError}</span>
            <button type="button" onClick={() => loadSnapshot(ageMa)}>Try again</button>
          </div>
        )}
        <div className="surface-legend" aria-label={`${surfaceMode === "seafloor" ? "Exposed seafloor view, " : "Surface-water view, "}${layers.guides ? "schematic climatological reference guides, " : ""}visual terrain relief ${verticalExaggeration} times`}>
          <span>{surfaceMode === "seafloor" ? "Exposed seafloor" : "Surface water"}</span>
          {layers.guides && <span>Schematic climate guides</span>}
          {contextSnapshot?.temporalSurface !== undefined && !contextSnapshot.temporalSurface.exactEndpoint && (
            <span>{formatAge(contextSnapshot.temporalSurface.younger.ageMa)}–{formatAge(contextSnapshot.temporalSurface.older.ageMa)} · partial motion coverage</span>
          )}
          {motionLoadError !== null && ageMa <= 540 && (
            <span role="status">Plate motion unavailable · nearest native source frame</span>
          )}
          {coordinateView === "cao" && caoBundle === null && (
            <span role="status">Preparing Cao coordinate view…</span>
          )}
          {coordinateView === "cao" && caoBundle !== null && (
            <span role="status">Cao coordinates · {periodCoordinateState.status === "ready"
              ? "partial converted relief"
              : periodCoordinateState.status === "error" ? "render unavailable"
                : periodCoordinateState.status === "unsupported" ? "boundary interval unsupported"
                  : "updating"}</span>
          )}
          {caoLoadError !== null && (
            <span role="status">Cao coordinates unavailable · PALEOMAP retained</span>
          )}
          {areaFocusStatus === "unresolved" && <span role="status">Tracked {coordinateView === "cao" ? "material" : "land"} unavailable at this age · tag retained</span>}
          Visual relief <strong>{verticalExaggeration}×</strong>
        </div>
      </section>

      <aside className="context-panel" aria-label="Current chapter" data-expanded={contextExpanded}>
        <button
          type="button"
          className="context-toggle"
          aria-expanded={contextExpanded}
          aria-controls="chapter-context-details"
          onClick={() => setContextExpanded((current) => !current)}
        >
          <span><small>Current period</small><strong>{chapter.period}</strong></span>
          <i aria-hidden="true">{contextExpanded ? "−" : "+"}</i>
        </button>
        <div className="context-heading">
          <div className="context-topline">
            <span className="index-label">Chapter {String(chapterNumber).padStart(2, "0")}</span>
            <span className="view-evidence"><i>Rendered view</i><EvidenceBadge status={contextSnapshot?.evidence ?? chapter.evidence} /></span>
          </div>
          <p className="era-line">{chapter.eon} <span>·</span> {chapter.period}</p>
          <h1>{chapter.label}</h1>
          <p className="age-display">{formatAge(ageMa)}</p>
        </div>
        <div id="chapter-context-details" className="context-details">
          <p className="geography-age">
            Geography source <strong>{loading ? "Resolving…" : formatSnapshotSource(contextSnapshot, motionLoadError !== null)}</strong>
          </p>
          {coordinateView === "cao" && (
            <p className="geography-age">Coordinate model <strong>Cao et al. 2024 v2.4 · partial coverage</strong></p>
          )}
          <p className="chapter-copy">{chapter.description}</p>
          {scenarioLike && <span className="scenario-label"><Aperture size={13} /> Illustrative scene · geography unresolved</span>}

          {chapterReference && (
            <div className="chapter-reference">
              <span>Period reference</span>
              <a href={chapterReference.url} target="_blank" rel="noreferrer">
                <strong>{chapterReference.title}</strong>
                <small>{[chapterReference.authors, chapterReference.year].filter(Boolean).join(" · ")}</small>
                <Link size={14} aria-hidden="true" />
              </a>
            </div>
          )}

          {selectedPoi && (
            <button type="button" className="selected-note" onClick={() => setPanel("notes")}>
              <span className="index-label">Selected field note</span>
              <strong>{selectedPoi.title}</strong>
              <small>{selectedPoi.locationNote ?? selectedPoi.subtitle}</small>
            </button>
          )}

          <div className="jump-row">
            <label htmlFor="chapter-jump">Jump to chapter</label>
            <select id="chapter-jump" value={chapter.id} onChange={(event) => {
              const slice = timeSlices.find((item) => item.id === event.target.value);
              if (slice) changeAge(slice.ageMa);
            }}>
              {orderedSlices.slice().reverse().map((slice) => (
                <option key={slice.id} value={slice.id}>{slice.label} · {formatAge(slice.ageMa)}</option>
              ))}
            </select>
          </div>
          {ageMa <= 540 && (
            <div className="jump-row source-age-jump">
              <label htmlFor="source-age-jump">Jump to reconstruction</label>
              <select
                id="source-age-jump"
                value={contextSnapshot?.temporalSurface !== undefined && !contextSnapshot.temporalSurface.exactEndpoint
                  ? "interpolated"
                  : String(contextSnapshot?.geographicSourceAgeMa ?? "")}
                onChange={(event) => changeAge(Number(event.target.value))}
              >
                {contextSnapshot === null && <option value="">Resolving source age…</option>}
                {contextSnapshot?.temporalSurface !== undefined && !contextSnapshot.temporalSurface.exactEndpoint && (
                  <option value="interpolated" disabled>
                    {formatAge(ageMa)} · interpolated
                  </option>
                )}
                {PALEODEM_AGES.map((sourceAge) => (
                  <option key={sourceAge} value={sourceAge}>
                    {sourceAge === 0 ? "0 Ma · present-day grid" : `${sourceAge} Ma · PALEOMAP`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {chapter.id === "present" && (
            <div className="landscape-picker">
              <label htmlFor="landscape-jump">Explore a landscape</label>
              <select
                id="landscape-jump"
                value={selectedLandscapeId ?? ""}
                onChange={(event) => selectLandscape(event.target.value)}
              >
                <option value="">Orbital overview</option>
                <optgroup label="Landforms">
                  {modernLandscapePresets.filter((preset) => preset.category === "landform").map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Climate regions">
                  {modernLandscapePresets.filter((preset) => preset.category === "climate").map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </optgroup>
              </select>
              {selectedLandscape && (
                <div className={`landscape-summary ${selectedLandscape.surfaceMode === "seafloor" ? "is-seafloor" : ""}`}>
                  <strong>{selectedLandscape.label}</strong>
                  <p>{selectedLandscape.description}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <Timeline
        ageMa={ageMa}
        geographicSourceAgeMa={contextSnapshot?.geographicSourceAgeMa}
        geographicSourceAgeBracketMa={motionLoadError === null
          ? contextSnapshot?.geographicSourceAgeBracketMa
          : contextSnapshot?.geographicSourceAgeMa === undefined
            ? undefined
            : [contextSnapshot.geographicSourceAgeMa, contextSnapshot.geographicSourceAgeMa]}
        slices={timeSlices}
        playing={playing}
        onPlayingChange={handlePlayingChange}
        onAgeChange={changeAge}
        onPrevious={() => stepChapter(-1)}
        onNext={() => stepChapter(1)}
      />

      <Modal open={panel === "layers"} title="Visible layers" eyebrow="Map controls" onClose={closePanel}>
        <div className="layer-list">
          {LAYER_META.map(({ key, label, detail, icon: LayerIcon }) => (
            <button type="button" key={key} aria-pressed={layers[key]} onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}>
              <span className="layer-icon"><LayerIcon size={18} /></span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              <span className={`switch ${layers[key] ? "is-on" : ""}`} aria-label={`${label} ${layers[key] ? "on" : "off"}`}><i /></span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={surfaceMode === "seafloor"}
            onClick={() => setSurfaceMode((current) => current === "surface" ? "seafloor" : "surface")}
          >
            <span className="layer-icon"><Waves size={18} /></span>
            <span>
              <strong>Expose seafloor</strong>
              <small>Reveal ocean-floor terrain beneath the water.</small>
            </span>
            <span className={`switch ${surfaceMode === "seafloor" ? "is-on" : ""}`} aria-label={`Exposed seafloor ${surfaceMode === "seafloor" ? "on" : "off"}`}><i /></span>
          </button>
          <button
            type="button"
            disabled={ageMa > 540}
            aria-pressed={coordinateView === "cao"}
            onClick={() => {
              setCaoLoadError(null);
              setCoordinateView((current) => current === "cao" ? "paleomap" : "cao");
            }}
          >
            <span className="layer-icon"><Map size={18} /></span>
            <span>
              <strong>Cao plate coordinates</strong>
              <small>Partial target-frame view; unsupported converted relief is neutral-masked.</small>
            </span>
            <span className={`switch ${coordinateView === "cao" ? "is-on" : ""}`} aria-label={`Cao plate coordinates ${coordinateView === "cao" ? "on" : "off"}`}><i /></span>
          </button>
          <div className="relief-control">
            <label htmlFor="relief-scale"><strong>Terrain relief</strong><small>Visual vertical exaggeration; source elevations are unchanged.</small></label>
            <output htmlFor="relief-scale">{verticalExaggeration}×</output>
            <input
              id="relief-scale"
              type="range"
              min="1"
              max="30"
              step="1"
              value={verticalExaggeration}
              onChange={(event) => setVerticalExaggeration(Number(event.target.value))}
              aria-label={`Terrain relief, ${verticalExaggeration} times`}
            />
            <span className="relief-range"><i>1× physical</i><i>30×</i></span>
          </div>
        </div>
      </Modal>

      <Modal open={panel === "quality"} title="Rendering quality" eyebrow="Globe controls" onClose={closePanel}>
        <div className="quality-options">
          {(["auto", "high", "low"] as Quality[]).map((option) => (
            <button type="button" key={option} aria-pressed={quality === option} className={quality === option ? "is-selected" : ""} onClick={() => setQuality(option)}>
              <span><strong>{option === "auto" ? "Adaptive" : option === "high" ? "High detail" : "Reduced detail"}</strong>
              <small>{option === "auto" ? "Balances visual detail with frame rate" : option === "high" ? "Sharper atmosphere, surface and clouds" : "Lighter clouds and surface detail"}</small></span>
              {quality === option && <Check size={17} />}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={panel === "notes"} title={selectedPoi?.title ?? "Field notes"} eyebrow={selectedPoi ? `${selectedPoi.category} · ${formatAge(selectedPoi.ageStartMa)}` : `${currentPois.length} notes at ${formatAge(ageMa)}`} onClose={closePanel}>
        {selectedPoi ? (
          <article className="poi-detail">
            {selectedPoi.subtitle && <p className="poi-subtitle">{selectedPoi.subtitle}</p>}
            <EvidenceBadge status={selectedPoi.evidence} />
            <p>{selectedPoi.description}</p>
            {selectedPoi.locationNote && <p className="location-note"><Compass size={15} /> {selectedPoi.locationNote}</p>}
            {selectedPoiCoordinate && (
              <button type="button" className="text-action" onClick={() => openPoi(selectedPoi.id, false)}>
                <RotateCcw size={15} /> Locate on globe
              </button>
            )}
            {!selectedPoiCoordinate && contextSnapshot?.poiIds.includes(selectedPoi.id) && (
              <p className="location-note"><Info size={15} /> This note has no defensible map position in this chapter.</p>
            )}
            <div className="detail-sources">
              <h3>Sources</h3>
              {poiSources.map((source) => <SourceLink key={source.id} source={source} />)}
            </div>
            <button type="button" className="back-action" onClick={clearSelectedPoi}>← All notes</button>
          </article>
        ) : currentPois.length ? (
          <div className="notes-list">
            {currentPois.map((poi, index) => (
              <button type="button" key={poi.id} onClick={() => openPoi(poi.id, false)}>
                <span className="note-index">{String(index + 1).padStart(2, "0")}</span>
                <span><small>{poi.category} · {formatAge(poi.ageStartMa)}{contextSnapshot?.poiCoordinates?.[poi.id] ? " · Located now" : contextSnapshot?.poiIds.includes(poi.id) ? " · This chapter" : ""}</small><strong>{poi.title}</strong><i>{poi.subtitle ?? poi.locationNote}</i></span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel"><BookOpen size={24} /><p>No field notes have a supported time interval at this age. Use the period navigation to explore another time.</p></div>
        )}
      </Modal>

      <Modal open={panel === "sources"} title="Sources & provenance" eyebrow={contextSnapshot ? `${contextSnapshot.label} reconstruction` : "Scientific record"} onClose={closePanel}>
        <p className="modal-intro">Each reconstruction distinguishes source evidence from interpolation and visual synthesis. These references support the current chapter.</p>
        <div className="source-list">
          {(snapshotSources.length ? snapshotSources : sources).map((source) => <SourceLink key={source.id} source={source} />)}
        </div>
      </Modal>

      <Modal open={panel === "about"} title="Reading this globe" eyebrow="Scientific context" onClose={closePanel}>
        <div className="about-copy">
          <p>The geological record becomes sparser and less certain deeper in time. Coastlines, climates and events are shown at the resolution their evidence supports; fine visual detail may be synthesized for legibility.</p>
          {ageMa > 4000 && <p>Early-Earth impact and cooling sequences are illustrative scenarios constrained by available models. Their motion is not a measured replay of a single event.</p>}
          <p>Modern reference borders appear only where the selected plate reconstruction supports a defensible position. They do not suggest that modern countries existed in deep time.</p>
          {contextSnapshot?.caveat && (
            <div className="method-note">
              <h3>Current view method</h3>
              <p>{contextSnapshot.caveat}</p>
            </div>
          )}
          <dl>
            <div><dt>Scene</dt><dd>{stats?.status ?? (loading ? "Loading controls" : "Ready")}</dd></div>
            <div><dt>Detail</dt><dd>{stats?.detail ?? quality}</dd></div>
            <div><dt>Renderer</dt><dd>{stats?.backend ?? "Initialising"}</dd></div>
            {stats?.fps != null && <div><dt>Frame rate</dt><dd>{Math.round(stats.fps)} fps</dd></div>}
          </dl>
        </div>
      </Modal>
    </main>
  );
}

function SourceLink({ source }: { source: (typeof sources)[number] }) {
  return (
    <a className="source-entry" href={source.url} target="_blank" rel="noreferrer">
      <span><strong>{source.title}</strong><small>{[source.authors, source.year].filter(Boolean).join(" · ")}</small></span>
      <Link size={15} aria-hidden="true" />
      <i>{source.license}</i>
    </a>
  );
}

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
import {
  environmentForAge,
  modernLandscapePresets,
  pointOfInterestIncludesAge,
  pointsOfInterest,
  sources,
  timeSlices,
  type GlobeStats,
  type LayerVisibility,
  type LonLat,
  type PalaeoCoastlineEvidence,
  type PointOfInterest,
  type WorldSnapshot,
} from "./data";
import { EvidenceBadge } from "./components/EvidenceBadge";
import { Modal } from "./components/Modal";
import { formatAge, PHANEROZOIC_MAX_MA, Timeline } from "./components/Timeline";
import {
  parseMaterialAddress,
  parseFocusCoordinates,
  serializeMaterialAddress,
  serializeFocusCoordinates,
} from "./focusState";
import {
  buildExplorerHash,
  createThrottledHistoryWriter,
  parseLayerVisibility,
  serializeAge,
} from "./explorerHash";
import {
  CAO_2017_MAP_INTERVALS,
  CAO_2017_MAP_INTERVAL_MARKS_MA,
  CaoReconstructionRuntime,
  contentAddressedAssetCacheMode,
  palaeoIntervalEvidenceStatus,
  palaeoIntervalLabel,
  selectPalaeoInterval,
  type CaoMotionFrame, type CaoTimelineLoadingState, type PreparedCaoRevision,
  type MaterialAddress, type ReconstructionPackageManifestV2, type StaticAssetFetcher } from "./reconstruction";

type Panel = "notes" | "sources" | "layers" | "about" | "quality" | null;
type Quality = "auto" | "high" | "low";
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
  palaeoCoastlines: false,
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
  { key: "tectonics", label: "Tectonic references", detail: "Native Cao boundaries at exact checkpoints; unavailable between unlinked source ages", icon: Mountain },
  { key: "rivers", label: "Drainage unavailable", detail: "The Cao foundation contains no reconstructed river or drainage field", icon: Waves },
  { key: "palaeoCoastlines", label: "Palaeo-coastlines (Cao 2017)", detail: "Cao et al. 2017 landmass and shallow-sea polygons, 402\u20132 Ma; steps between 24 published map intervals; country outlines become position markers only", icon: Waves },
];

/**
 * Nothing is drawn from the Cao 2017 maps yet, so the layer starts with an
 * empty summary and the assets are reported unavailable. Phase 3 of the
 * palaeo-coastlines program replaces this with the interval store's own
 * summary; every reader below is written to be null-safe against it.
 */
const EMPTY_PALAEO_EVIDENCE: PalaeoCoastlineEvidence = Object.freeze({
  intervalId: null,
  sourceIds: [],
  references: [],
  editedChartIds: [],
  unavailableReason: "Cao 2017 map charts are not in this build",
  loading: false,
});

function parseInitialState() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const parsedAge = Number(params.get("age"));
  const reliefParam = params.get("relief");
  const parsedRelief = reliefParam === null ? Number.NaN : Number(reliefParam);
  const layers = parseLayerVisibility(params.get("layers"), DEFAULT_LAYERS);
  return {
    age: Number.isFinite(parsedAge) ? Math.min(4567, Math.max(0, parsedAge)) : 0,
    layers,
    focus: params.get("focus"),
    place: params.get("place"),
    at: parseFocusCoordinates(params.get("at")),
    nativeMaterialFocus: parseMaterialAddress(params.get("material")),
    relief: Number.isFinite(parsedRelief) ? Math.min(30, Math.max(1, Math.round(parsedRelief))) : 8,
  };
}

function closestChapter(ageMa: number) {
  return timeSlices.reduce((closest, slice) =>
    Math.abs(slice.ageMa - ageMa) < Math.abs(closest.ageMa - ageMa) ? slice : closest,
  );
}

function gplatesDirectionToLonLat(direction: readonly [number, number, number]): LonLat {
  return [Math.atan2(direction[1], direction[0]) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180 / Math.PI];
}

function editorialSnapshotForAge(ageMa: number): WorldSnapshot {
  const chapter = closestChapter(ageMa);
  const visiblePois = pointsOfInterest.filter((poi) => pointOfInterestIncludesAge(poi, ageMa));
  return {
    ...chapter,
    id: `${chapter.id}__editorial`,
    requestedAgeMa: ageMa,
    land: [],
    countries: [],
    tectonics: [],
    poiIds: visiblePois.map((poi) => poi.id),
    // Source records may retain a locality for citation, but only the native
    // Cao anchor catalog can authorize a globe position at a requested age.
    poiCoordinates: {},
    environment: environmentForAge(ageMa),
    caveat: "Editorial context only; native Cao geometry and material motion own the rendered surface.",
  };
}

/** Checkpoint warming waits for the scrub to rest this long. */
const SCRUB_SETTLE_MS = 300;
/** A pending foreground age changes the presented map-key status only after this long. */
const PENDING_STATUS_DELAY_MS = 180;

export default function App() {
  const initial = useRef(parseInitialState()).current;
  const initialPoi = pointsOfInterest.find((poi) => poi.id === initial.focus);
  const initialLandscape = initialPoi === undefined && initial.age === 0
    ? modernLandscapePresets.find((preset) => preset.id === initial.place)
    : undefined;
  const initialArea = initialPoi === undefined && initialLandscape === undefined ? initial.at : null;
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
  const [areaFocusStatus, setAreaFocusStatus] = useState<
    "resolving" | "resolved" | "unresolved" | null
  >(initial.nativeMaterialFocus ? "resolving" : null);
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
      initialArea === null && initial.nativeMaterialFocus === null,
  );
  const [resetNonce, setResetNonce] = useState(0);
  const [quality, setQuality] = useState<Quality>("auto");
  const [verticalExaggeration, setVerticalExaggeration] = useState(initial.relief);
  const [selectedLandscapeId, setSelectedLandscapeId] = useState<string | null>(
    initialLandscape && initial.age === 0 ? initialLandscape.id : null,
  );
  const [stats, setStats] = useState<GlobeStats | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shareComplete, setShareComplete] = useState(false);
  const [caoLoadError, setCaoLoadError] = useState<string | null>(null);
  const [caoLastPrepareFailure, setCaoLastPrepareFailure] = useState<{
    failedAgeMa: number;
    observedAgeMa: number;
  } | null>(null);
  const [periodCoordinateState, setPeriodCoordinateState] = useState<PeriodCoordinateRenderState>({ status: null });
  const [caoRevision, setCaoRevision] = useState<PreparedCaoRevision | null>(null);
  const caoRevisionRef = useRef<PreparedCaoRevision | null>(null);
  const [caoMotionFrame, setCaoMotionFrame] = useState<CaoMotionFrame | null>(null);
  const caoMotionFrameRef = useRef<CaoMotionFrame | null>(null);
  const caoScrubPumpRef = useRef<{ disposed: boolean; inFlight: boolean; serial: number; pump: () => void } | null>(null);
  const [materialFocusAddress, setMaterialFocusAddress] = useState<MaterialAddress | null>(initial.nativeMaterialFocus);
  const materialFocusAddressRef = useRef<MaterialAddress | null>(null);
  materialFocusAddressRef.current = materialFocusAddress;
  const [caoAnchorCoordinates, setCaoAnchorCoordinates] = useState<Readonly<Record<string, LonLat>>>({});
  const [caoRuntimeReady, setCaoRuntimeReady] = useState(0);
  const [caoTimelineLoading, setCaoTimelineLoading] = useState<CaoTimelineLoadingState>({
    status: "idle", foregroundStatus: "idle", requestedAgeMa: null,
    motionTier: "requested-age", error: null,
  });
  const [caoSourceAges, setCaoSourceAges] = useState<readonly number[]>([]);
  const [caoAgeDomainMa, setCaoAgeDomainMa] = useState<readonly [number, number] | null>(null);
  const caoRuntimeRef = useRef<CaoReconstructionRuntime | null>(null);
  const lastStatsUpdate = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelOpenedFromMenu = useRef(false);
  const focusNonce = useRef(0);
  const poiFocusHasResolved = useRef(false);
  const requestedAgeRef = useRef(ageMa);
  requestedAgeRef.current = ageMa;
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );
  const caoPumpRef = useRef<{
    disposed: boolean;
    inFlight: boolean;
    serial: number;
    pump: () => void;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribeTimeline: (() => void) | null = null;
    const controller = new AbortController();
    const manifestUrl = new URL("data/reconstruction/cao-v2.4/manifest.json", document.baseURI).toString();
    void fetch(manifestUrl, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load Cao reconstruction manifest (${response.status})`);
      const manifest = await response.json() as ReconstructionPackageManifestV2;
      const fetcher: StaticAssetFetcher = async (path, signal, options) => {
        // The manifest stays no-store. Hash-qualified payload URLs are immutable,
        // so refreshes may reuse them without mixing bytes across promotions.
        // Background timeline work passes a low priority hint so foreground
        // tiles win the connection where the browser honours it.
        const assetResponse = await fetch(new URL(path, manifestUrl), {
          signal,
          cache: contentAddressedAssetCacheMode(path),
          ...(options?.priority ? { priority: options.priority } as RequestInit : {}),
        });
        if (!assetResponse.ok) throw new Error(`Could not load Cao reconstruction asset (${assetResponse.status})`);
        if (!options?.yieldToForeground || !assetResponse.body) return assetResponse.arrayBuffer();
        // Read background bodies chunk by chunk and hold reads while the
        // runtime has a foreground tile in flight, so the foreground fetch is
        // not sharing the link with a multi-megabyte download.
        const reader = assetResponse.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          await options.yieldToForeground();
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
        }
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return joined.buffer;
      };
      if (!active) return;
      const runtime = new CaoReconstructionRuntime(manifest, fetcher);
      caoRuntimeRef.current = runtime;
      unsubscribeTimeline = runtime.subscribeTimelineLoading(setCaoTimelineLoading);
      setCaoSourceAges(Object.freeze(manifest.checkpoints.map((checkpoint) => checkpoint.ageMa)));
      setCaoAgeDomainMa(Object.freeze([manifest.ageDomainMa.youngest, manifest.ageDomainMa.oldest]));
      setCaoRuntimeReady((value) => value + 1);
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) {
        setCaoLoadError(error instanceof Error ? error.message : "Cao reconstruction foundation could not be loaded");
      }
    });
    return () => {
      active = false;
      unsubscribeTimeline?.();
      controller.abort();
      caoRuntimeRef.current?.dispose();
      caoRuntimeRef.current = null;
      setCaoSourceAges([]);
      setCaoAgeDomainMa(null);
    };
  }, []);

  const applyMotionFrame = (frame: CaoMotionFrame) => {
    setCaoAnchorCoordinates(Object.fromEntries(frame.anchorIds.flatMap((id) => {
      const resolved = frame.resolveAnchor(id);
      return resolved?.pose.direction ? [[id, gplatesDirectionToLonLat(resolved.pose.direction)]] : [];
    })));
    const focusAddress = materialFocusAddressRef.current;
    if (focusAddress) {
      const pose = frame.resolveAddress(focusAddress);
      if (pose.direction) {
        const coordinates = gplatesDirectionToLonLat(pose.direction);
        setAreaFocusStatus("resolved");
        setAutoRotateEnabled(false);
        // Keep nonce stable while scrubbing so follow retargets aim without
        // treating each age sample as a brand-new camera focus request.
        setSpatialFocus((current) => {
          if (current?.kind === "area"
              && current.coordinates[0] === coordinates[0]
              && current.coordinates[1] === coordinates[1]) {
            return current;
          }
          return {
            kind: "area",
            coordinates,
            nonce: current?.kind === "area" ? current.nonce : ++focusNonce.current,
            distance: undefined,
          };
        });
      } else {
        setAreaFocusStatus("unresolved");
        setSpatialFocus((current) => current?.kind === "area" ? null : current);
      }
    }
    const runtime = caoRuntimeRef.current;
    const exactCheckpoint = runtime?.manifest.checkpoints.some(
      (checkpoint) => checkpoint.ageMa === frame.requestedAgeMa,
    ) ?? false;
    // A motion frame cannot certify the exact-checkpoint overlays. Preserve a
    // prepare failure until that checkpoint itself publishes successfully.
    if (!exactCheckpoint || caoRevisionRef.current?.requestedAgeMa === frame.requestedAgeMa) {
      setCaoLoadError(null);
    }
    caoMotionFrameRef.current = frame;
    setCaoMotionFrame(frame);
  };

  // Continuous scrub: evaluate resident motion at the live ageMa and retarget the
  // published foundation in place (interpolation). Coalesce rapid play ticks.
  useEffect(() => {
    if (!caoRuntimeReady) return;
    const runtime = caoRuntimeRef.current;
    if (!runtime) return;

    const scrub = {
      disposed: false,
      inFlight: false,
      serial: 0,
      pump: () => {},
      prefetchTimer: 0 as ReturnType<typeof setTimeout> | 0,
    };

    const pump = () => {
      if (scrub.disposed || scrub.inFlight) return;
      const targetAge = requestedAgeRef.current;
      const domain = runtime.manifest.ageDomainMa;
      if (targetAge < domain.youngest || targetAge > domain.oldest) return;
      if (caoMotionFrameRef.current?.requestedAgeMa === targetAge) return;
      const serial = ++scrub.serial;
      scrub.inFlight = true;
      void runtime.evaluateMotion(targetAge).then((frame) => {
        if (serial !== scrub.serial || scrub.disposed) return;
        const latest = requestedAgeRef.current;
        if (latest < domain.youngest || latest > domain.oldest) {
          scrub.inFlight = false;
          return;
        }
        if (latest !== targetAge) {
          scrub.inFlight = false;
          pump();
          return;
        }
        applyMotionFrame(frame);
        scrub.inFlight = false;
        if (requestedAgeRef.current !== targetAge) pump();
        // Warm the bracketing display knots only once the scrub settles. Doing
        // it per sample streamed checkpoint fetches that competed with the
        // motion tiles the gesture actually needed.
        if (scrub.prefetchTimer) clearTimeout(scrub.prefetchTimer);
        scrub.prefetchTimer = setTimeout(() => {
          scrub.prefetchTimer = 0;
          if (scrub.disposed || requestedAgeRef.current !== targetAge) return;
          const ages = runtime.manifest.checkpoints.map((checkpoint) => checkpoint.ageMa);
          const upper = ages.findIndex((age) => age >= targetAge);
          const lookahead = [ages[Math.max(0, upper - 1)], ages[upper], ages[Math.min(ages.length - 1, upper + 1)]]
            .filter((age): age is number => age !== undefined);
          void runtime.prefetchCheckpoints(lookahead);
        }, SCRUB_SETTLE_MS);
      }).catch((error: unknown) => {
        if (serial !== scrub.serial || scrub.disposed) return;
        scrub.inFlight = false;
        if (error instanceof DOMException && error.name === "AbortError") {
          if (requestedAgeRef.current !== targetAge) pump();
          return;
        }
        setCaoLoadError(error instanceof Error ? error.message : "Cao motion could not be evaluated");
      });
    };

    scrub.pump = pump;
    caoScrubPumpRef.current = scrub;
    pump();
    return () => {
      scrub.disposed = true;
      if (scrub.prefetchTimer) clearTimeout(scrub.prefetchTimer);
      if (caoScrubPumpRef.current === scrub) caoScrubPumpRef.current = null;
    };
  }, [caoRuntimeReady]);

  // Discrete prepare establishes static geometry / exact-knot overlays once the
  // foundation is empty, or when landing on a new exact checkpoint for native
  // boundary layers. Continuous ages never tear down the visible foundation.
  useEffect(() => {
    if (!caoRuntimeReady) return;
    const runtime = caoRuntimeRef.current;
    if (!runtime) return;

    const pumpState = {
      disposed: false,
      inFlight: false,
      serial: 0,
      pump: () => {},
    };

    const applyPrepared = (prepared: PreparedCaoRevision) => {
      setCaoLoadError(null);
      const previous = caoRevisionRef.current;
      // Drop the prior lease only once the next revision is ready to publish.
      if (previous !== null && previous !== prepared) previous.release();
      caoRevisionRef.current = prepared;
      setCaoRevision(prepared);
      // Continuous motion/anchors come from evaluateMotion, not the released lease.
      caoScrubPumpRef.current?.pump();
    };

    const pump = () => {
      if (pumpState.disposed || pumpState.inFlight) return;
      const targetAge = requestedAgeRef.current;
      const domain = runtime.manifest.ageDomainMa;
      if (targetAge < domain.youngest || targetAge > domain.oldest) return;
      const exact = runtime.manifest.checkpoints.some((checkpoint) => checkpoint.ageMa === targetAge);
      // After the first publish, only re-prepare at exact display knots so native
      // overlays can refresh; fractional ages rely on continuous motion scrub.
      if (caoRevisionRef.current !== null && !exact) return;
      if (caoRevisionRef.current?.requestedAgeMa === targetAge) return;

      const serial = ++pumpState.serial;
      pumpState.inFlight = true;
      // Do not release the last revision before the next prepare lands — the
      // runtime allows one in-flight lease alongside the visible one (< 2).
      // Releasing early made age→0 republish races blank the globe.

      let request: ReturnType<CaoReconstructionRuntime["request"]>;
      try {
        request = runtime.request(targetAge);
      } catch (error) {
        if (serial === pumpState.serial) pumpState.inFlight = false;
        setCaoLastPrepareFailure({ failedAgeMa: targetAge, observedAgeMa: requestedAgeRef.current });
        // Retain the resident allocation; the error state withholds its presentation.
        setCaoLoadError(error instanceof Error ? error.message : "Cao reconstruction request could not start");
        return;
      }

      void request.prepared.then((prepared) => {
        if (serial !== pumpState.serial || pumpState.disposed) {
          prepared.release();
          return;
        }
        const latest = requestedAgeRef.current;
        if (latest < domain.youngest || latest > domain.oldest) {
          prepared.release();
          pumpState.inFlight = false;
          return;
        }
        if (latest !== targetAge) {
          prepared.release();
          pumpState.inFlight = false;
          pump();
          return;
        }
        applyPrepared(prepared);
        pumpState.inFlight = false;
        if (requestedAgeRef.current !== targetAge) pump();
      }).catch((error: unknown) => {
        if (serial !== pumpState.serial || pumpState.disposed) return;
        pumpState.inFlight = false;
        if (error instanceof DOMException && error.name === "AbortError") {
          if (requestedAgeRef.current !== targetAge) pump();
          return;
        }
        setCaoLastPrepareFailure({ failedAgeMa: targetAge, observedAgeMa: requestedAgeRef.current });
        if (requestedAgeRef.current !== targetAge) {
          pump();
          return;
        }
        // Retain the last publication for bounded recovery while withholding it
        // so a failed exact checkpoint cannot present stale native overlays.
        setCaoLoadError(error instanceof Error ? error.message : "Cao reconstruction could not be prepared");
      });
    };

    pumpState.pump = pump;
    caoPumpRef.current = pumpState;
    pump();

    return () => {
      pumpState.disposed = true;
      if (caoPumpRef.current === pumpState) caoPumpRef.current = null;
      runtime.cancelActive();
      caoRevisionRef.current?.release();
      caoRevisionRef.current = null;
      setCaoRevision(null);
      setCaoMotionFrame(null);
      caoMotionFrameRef.current = null;
    };
  }, [caoRuntimeReady]);

  useEffect(() => {
    const runtime = caoRuntimeRef.current;
    if (!runtime || !caoRuntimeReady) return;
    runtime.prioritizeRequestedAge(ageMa);
    const domain = runtime.manifest.ageDomainMa;
    if (ageMa < domain.youngest || ageMa > domain.oldest) {
      // Outside the live Cao package domain: keep the resident foundation for
      // bounded reuse, but clear its live frame and material legend state.
      if (caoScrubPumpRef.current) {
        caoScrubPumpRef.current.serial += 1;
        caoScrubPumpRef.current.inFlight = false;
      }
      // Material lock stays tagged for reacquisition; follow pose is unavailable.
      // Drop the cached motion frame so re-entering the domain re-applies follow.
      caoMotionFrameRef.current = null;
      setCaoMotionFrame(null);
      if (materialFocusAddressRef.current !== null) {
        setAreaFocusStatus("unresolved");
        setSpatialFocus((current) => current?.kind === "area" ? null : current);
      }
      return;
    }
    caoScrubPumpRef.current?.pump();
    caoPumpRef.current?.pump();
  }, [ageMa, caoRuntimeReady]);

  useEffect(() => {
    const runtime = caoRuntimeRef.current;
    if (!runtime || periodCoordinateState.status !== "ready"
        || periodCoordinateState.displayedAgeMa !== ageMa) return;
    runtime.markRendered(ageMa);
  }, [ageMa, periodCoordinateState.displayedAgeMa, periodCoordinateState.status]);

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
  const inCaoDomain = caoAgeDomainMa !== null
    && ageMa >= caoAgeDomainMa[0] && ageMa <= caoAgeDomainMa[1];
  const retimedSnapshot = snapshot;
  const displayedSurfaceAgeMa = periodCoordinateState.displayedAgeMa;
  const displayedSnapshot = useMemo(() =>
    inCaoDomain && displayedSurfaceAgeMa !== undefined && displayedSurfaceAgeMa !== ageMa
      ? editorialSnapshotForAge(displayedSurfaceAgeMa)
      : retimedSnapshot,
  [ageMa, displayedSurfaceAgeMa, inCaoDomain, retimedSnapshot]);
  const temporalPoiCoordinates = useMemo<Readonly<Record<string, LonLat>> | undefined>(() => {
    if (caoAgeDomainMa && (ageMa < caoAgeDomainMa[0] || ageMa > caoAgeDomainMa[1])) {
      // Keep last Cao anchors while showing editorial deep-time chapters.
      return caoRevision === null ? undefined : caoAnchorCoordinates;
    }
    return caoRevision === null ? undefined : caoAnchorCoordinates;
  }, [ageMa, caoAgeDomainMa, caoAnchorCoordinates, caoRevision]);
  const contextSnapshot = displayedSnapshot;
  const currentCaoMotionFrame = caoMotionFrame?.requestedAgeMa === ageMa ? caoMotionFrame : null;
  const effectiveDisplayedCaoAgeMa = displayedSurfaceAgeMa ?? ageMa;
  const displayedCao = !inCaoDomain ? null
    : caoMotionFrame?.requestedAgeMa === effectiveDisplayedCaoAgeMa ? caoMotionFrame
      : caoRevision?.requestedAgeMa === effectiveDisplayedCaoAgeMa ? caoRevision : null;
  const exactCaoCheckpoint = caoSourceAges.includes(ageMa);
  const requestedMotionAvailable = exactCaoCheckpoint
    ? caoRevision?.requestedAgeMa === ageMa
    : caoMotionFrame?.requestedAgeMa === ageMa || caoRevision?.requestedAgeMa === ageMa;
  const foregroundMotionPending = inCaoDomain && caoRevision !== null
    && (caoTimelineLoading.foregroundStatus === "loading" || !requestedMotionAvailable);
  const foundationPendingNow = caoRevision !== null && (foregroundMotionPending
    || (caoMotionFrame?.requestedAgeMa ?? caoRevision.requestedAgeMa) !== ageMa
    || periodCoordinateState.status === "updating");
  // Each scrub sample is pending for a frame or two even with resident motion.
  // Only a sustained wait changes the presented status, so the map key does
  // not flicker on every sample while the globe keeps showing the last frame.
  const [foundationPendingShown, setFoundationPendingShown] = useState(false);
  useEffect(() => {
    if (!foundationPendingNow) {
      setFoundationPendingShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setFoundationPendingShown(true), PENDING_STATUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [foundationPendingNow]);
  const foundationStatus = caoAgeDomainMa && ageMa > caoAgeDomainMa[1] ? "outside compiled domain"
    : periodCoordinateState.status === "error" ? "render unavailable"
      : caoRevision === null ? "preparing"
        : foundationPendingNow
          ? (foundationPendingShown || periodCoordinateState.displayedAgeMa === undefined ? "updating" : "rendered")
          : periodCoordinateState.status === "ready" ? "rendered" : "updating";
  const surfaceInfoState = caoLoadError !== null || periodCoordinateState.status === "error" ? "error"
    : foundationStatus === "rendered" ? "ready" : foundationStatus === "outside compiled domain" ? "editorial" : "loading";
  const surfaceInfoSummary = surfaceInfoState === "error" ? "Surface withheld"
    : surfaceInfoState === "ready" && caoTimelineLoading.status === "loading"
      ? `${formatAge(ageMa)} ready · Loading timeline…`
      : surfaceInfoState === "ready" && caoTimelineLoading.status === "paused"
        ? `${formatAge(ageMa)} ready · Timeline loading paused`
        : surfaceInfoState === "ready" ? "Cao surface"
          : surfaceInfoState === "editorial" ? "Editorial surface"
            : displayedSurfaceAgeMa !== undefined && displayedSurfaceAgeMa !== ageMa
              ? `Loading ${formatAge(ageMa)} · Showing ${formatAge(displayedSurfaceAgeMa)}`
              : `Loading ${formatAge(ageMa)}…`;
  const observedMaterialVisible = (displayedCao?.materialCorrections.observedActiveCharts ?? 0) > 0;
  const classifiedShallowMarineVisible =
    (displayedCao?.materialCorrections.classifiedShallowMarineActiveCharts ?? 0) > 0;
  const qualifiedMaterialVisible = ((displayedCao?.materialCorrections.qualifiedActiveCharts ?? 0)
    - (displayedCao?.materialCorrections.modelInferredPoseActiveCharts ?? 0)) > 0;
  const uncertainMaterialVisible = (displayedCao?.materialCorrections.modelInferredPoseActiveCharts ?? 0) > 0
    || (displayedCao?.materialCorrections.uncertainActiveCharts ?? 0) > 0
    || (displayedCao?.materialCorrections.formationUncertainActiveCharts ?? 0) > 0;
  // Phase 3 of the palaeo-coastlines program replaces this constant with the
  // interval store's live summary; everything below reads it null-safely.
  const palaeoEvidence: PalaeoCoastlineEvidence = EMPTY_PALAEO_EVIDENCE;
  const palaeoIntervalIndex = selectPalaeoInterval(CAO_2017_MAP_INTERVALS, ageMa);
  const palaeoInterval = palaeoIntervalIndex < 0 ? null : CAO_2017_MAP_INTERVALS[palaeoIntervalIndex]!;
  const palaeoKeyVisible = layers.palaeoCoastlines;
  // The layer can be switched on while the age has no published map; it can
  // only be switched on at all while the charts exist to draw.
  const palaeoModeActive = layers.palaeoCoastlines && palaeoEvidence.unavailableReason === null;
  const palaeoFallback = layers.palaeoCoastlines
    && (palaeoInterval === null || palaeoEvidence.unavailableReason !== null);
  const palaeoEdited = palaeoEvidence.editedChartIds.length > 0;
  const palaeoIntervalName = palaeoInterval === null ? null : palaeoIntervalLabel(palaeoInterval);
  // The mapped polygons are the dominant claim once the mode is on, so the
  // rendered-view badge follows the map interval rather than the Cao 2024 pose.
  const renderedEvidence = palaeoModeActive && !palaeoFallback
    ? palaeoIntervalEvidenceStatus(palaeoInterval, ageMa, palaeoEdited)
    : displayedCao === null ? "unknown" as const
      : displayedCao.display.fraction === 0 || displayedCao.display.fraction === 1 ? "model-output" as const
        : "interpolation" as const;
  const selectedPoiCoordinate = selectedPoi
    ? temporalPoiCoordinates?.[selectedPoi.id]
    : undefined;
  const currentPois = useMemo(
    () => pointsOfInterest
      .filter((poi) => pointOfInterestIncludesAge(poi, ageMa))
      .sort((a, b) => b.ageStartMa - a.ageStartMa),
    [ageMa],
  );

  useEffect(() => {
    setSnapshot(editorialSnapshotForAge(ageMa));
    setLoading(false);
    setLoadError(null);
  }, [ageMa]);

  const handleStats = useCallback((next: GlobeStats) => {
    const now = performance.now();
    if (now - lastStatsUpdate.current < 900) return;
    lastStatsUpdate.current = now;
    setStats(next);
  }, []);

  const handlePeriodCoordinateState = useCallback((next: PeriodCoordinateRenderState) => {
    // Updating/loading callbacks describe the pending target and may omit the
    // last rendered age. Retain that age until a new frame explicitly replaces it.
    setPeriodCoordinateState((current) => next.displayedAgeMa === undefined
        && current.displayedAgeMa !== undefined
      ? { ...next, displayedAgeMa: current.displayedAgeMa }
      : next);
  }, []);

  // Continuous scrub/play updates ageMa every animation frame. Writing
  // history.replaceState on each tick floods Chromium navigation IPC and can
  // hang the tab (crbug.com/1038223). Keep React/globe state live; coalesce hash sync.
  const hashWriterRef = useRef(createThrottledHistoryWriter());
  useEffect(() => {
    const writer = hashWriterRef.current;
    return () => writer.dispose();
  }, []);
  // Do not depend on spatialFocus coordinates: locked follow updates them every
  // scrub sample. Material/place/POI identities already capture shareable focus.
  const focusPlaceId = spatialFocus?.kind === "place" ? spatialFocus.placeId : null;
  const focusAt = materialFocusAddress === null && spatialFocus?.kind === "area"
    ? serializeFocusCoordinates(spatialFocus.coordinates) : null;
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("age", serializeAge(ageMa));
    const visibleLayers = Object.entries(layers)
      .filter(([, visible]) => visible)
      .map(([key]) => key);
    params.set("layers", visibleLayers.join(","));
    params.set("relief", String(verticalExaggeration));
    params.set("coordinates", "cao");
    if (selectedPoiId) params.set("focus", selectedPoiId);
    else if (focusPlaceId) params.set("place", focusPlaceId);
    else if (materialFocusAddress !== null) {
      params.set("material", serializeMaterialAddress(materialFocusAddress));
    } else if (focusAt !== null) {
      params.set("at", focusAt);
    }
    const url = `${window.location.pathname}${window.location.search}${buildExplorerHash(params)}`;
    hashWriterRef.current.schedule(url);
  }, [ageMa, focusAt, focusPlaceId, layers, materialFocusAddress, selectedPoiId, verticalExaggeration]);

  useEffect(() => {
    if (!playing || orderedSlices.length === 0) return;
    // Continuous play within the Cao package domain; chapter stepping beyond it.
    const caoOldest = caoAgeDomainMa?.[1] ?? 540;
    if (ageMa <= caoOldest) {
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
  }, [ageMa <= (caoAgeDomainMa?.[1] ?? 540), playing, orderedSlices, caoAgeDomainMa]);

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
    if (ageMa <= 0.0001) return;
    setSelectedLandscapeId(null);
    setSpatialFocus((current) => current?.kind === "place" ? null : current);
  }, [ageMa]);

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
    setMaterialFocusAddress(null);
    setAreaFocusStatus(null);
    if (openNotes) setPanel("notes");
    const coordinates = temporalPoiCoordinates?.[poi.id];
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

  const selectSurface = (coordinates: LonLat, address?: MaterialAddress) => {
    setAutoRotateEnabled(false);
    if (
      spatialFocus !== null || selectedPoiId !== null ||
      selectedLandscapeId !== null || materialFocusAddress !== null
    ) {
      setSelectedPoiId(null);
      setSelectedLandscapeId(null);
      setMaterialFocusAddress(null);
      setAreaFocusStatus(null);
      poiFocusHasResolved.current = false;
      setSpatialFocus(null);
      return;
    }
    setSelectedPoiId(null);
    poiFocusHasResolved.current = false;
    setSelectedLandscapeId(null);
    setMaterialFocusAddress(address ?? null);
    setAreaFocusStatus(address === undefined ? "unresolved" : "resolved");
    setSpatialFocus({
      kind: "area",
      coordinates,
      nonce: ++focusNonce.current,
      distance: undefined,
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

  const clearLocationLock = () => {
    setMaterialFocusAddress(null);
    setAreaFocusStatus(null);
    poiFocusHasResolved.current = false;
    if (spatialFocus?.kind === "area") setSpatialFocus(null);
    setAutoRotateEnabled(false);
  };

  const resetCamera = () => {
    setSelectedLandscapeId(null);
    setSelectedPoiId(null);
    poiFocusHasResolved.current = false;
    setMaterialFocusAddress(null);
    setAreaFocusStatus(null);
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
    setMaterialFocusAddress(null);
    setAreaFocusStatus(null);
    setLayers((current) => ({ ...current, clouds: false }));
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

  const activeSourceIds = new Set(caoAgeDomainMa && ageMa <= caoAgeDomainMa[1]
    ? ["cao-plate-model-2024-v2-4", ...(displayedCao?.materialCorrections.activeSourceIds ?? [])]
    : contextSnapshot?.sourceIds ?? []);
  const snapshotSources = sources.filter((source) => activeSourceIds.has(source.id));
  const poiSources = sources.filter((source) => selectedPoi?.sourceIds.includes(source.id));
  const scenarioLike = caoAgeDomainMa ? chapter.ageMa > caoAgeDomainMa[1] : chapter.ageMa > PHANEROZOIC_MAX_MA;

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

      <section
        className="globe-stage"
        aria-label="Interactive Earth reconstruction"
        data-cao-last-prepare-failed-age-ma={caoLastPrepareFailure?.failedAgeMa}
        data-cao-last-prepare-failure-observed-age-ma={caoLastPrepareFailure?.observedAgeMa}
        data-cao-motion-tier={caoTimelineLoading.motionTier}
        data-cao-motion-foreground-status={caoTimelineLoading.foregroundStatus}
        data-cao-timeline-loading-status={caoTimelineLoading.status}
        data-cao-requested-age-ma={ageMa}
        data-cao-displayed-age-ma={periodCoordinateState.displayedAgeMa}
      >
        <GlobeView
          caoRevision={caoRevision}
          caoMotionFrame={currentCaoMotionFrame}
          caoWithheld={caoLoadError !== null}
          snapshot={displayedSnapshot}
          layers={layers}
          selectedPoiId={selectedPoiId}
          onSelectPoi={(id: string) => openPoi(id)}
          onSelectSurface={selectSurface}
          onStats={handleStats}
          onPeriodCoordinateState={handlePeriodCoordinateState}
          focusTarget={spatialFocus}
          resetNonce={resetNonce}
          autoRotate={!reducedMotion && autoRotateEnabled}
          quality={quality}
          verticalExaggeration={verticalExaggeration}
        />
        <div className="stage-vignette" aria-hidden="true" />
        {loading && <div className="loading-state"><span /> Resolving {formatAge(ageMa)}</div>}
        {loadError && (
          <div className="error-state" role="alert">
            <p>Reconstruction unavailable</p>
            <span>{loadError}</span>
            <button type="button" onClick={() => setSnapshot(editorialSnapshotForAge(ageMa))}>Try again</button>
          </div>
        )}
        <details className="surface-info" data-status={surfaceInfoState}>
          <summary aria-label={`Open map key. ${surfaceInfoSummary}. Cao reconstruction ${foundationStatus}.`}>
            <Info size={14} aria-hidden="true" />
            <span className="surface-status-dot" aria-hidden="true" />
            <span className="surface-info-label">Map key</span>
            <strong role="status">{surfaceInfoSummary}</strong>
            <i aria-hidden="true" />
          </summary>
          <div className="surface-info-panel" aria-label="Surface map key">
            <div className="surface-info-heading">
              <span>Map key</span>
              <strong>{surfaceInfoSummary}</strong>
            </div>
            <p className="surface-info-note">Land uses one display color. Evidence categories are listed separately.</p>
            <ul className="surface-color-key">
              <li><i className="surface-swatch surface-swatch-land" aria-hidden="true" /><span><strong>Land</strong>Reconstructed land and material overlays share this color</span></li>
              {palaeoKeyVisible && (
                <li><i className="surface-swatch surface-swatch-palaeo-land" aria-hidden="true" /><span><strong>Palaeo land</strong>Cao et al. 2017 landmass polygons for the active map interval</span></li>
              )}
              {palaeoKeyVisible && (
                <li><i className="surface-swatch surface-swatch-palaeo-shallow" aria-hidden="true" /><span><strong>Palaeo shallow sea</strong>Cao et al. 2017 shallow-marine polygons; an environment class, not a water depth</span></li>
              )}
              {palaeoKeyVisible && (
                <li><i className="surface-swatch surface-swatch-palaeo-mountain" aria-hidden="true" /><span><strong>Palaeo mountain</strong>Cao et al. 2017 mountain polygons, drawn over palaeo land</span></li>
              )}
              <li><i className="surface-swatch surface-swatch-shelf" aria-hidden="true" /><span><strong>Blue shelf</strong>{palaeoKeyVisible
                ? "Cao 2024 continental crust, depth unmapped"
                : "Continental shelf context; ancient water depth unknown"}</span></li>
            </ul>
            {palaeoKeyVisible && (
              <div className="surface-palaeo-key" data-testid="palaeo-map-key" data-fallback={String(palaeoFallback)}>
                <strong>Palaeo-coastlines (Cao 2017)</strong>
                {palaeoIntervalName !== null && (
                  <p className="surface-info-note">Coastline map interval: {palaeoIntervalName} (Cao et al. 2017)</p>
                )}
                {palaeoIntervalName !== null && (
                  <p className="surface-info-note">Land and shallow sea are the Cao et al. (2017) map
                    polygons for the {palaeoIntervalName} interval: the minimum land / maximum flooding
                    recorded anywhere in that bin, not a shoreline at one moment.</p>
                )}
                {palaeoFallback && (
                  <p className="surface-info-note" role="status" data-testid="palaeo-fallback-notice">
                    No palaeogeography evidence at this age; showing the Cao 2024 coast proxy
                  </p>
                )}
                <ul className="outline-marker-key">
                  <li><i className="outline-marker outline-marker-dark" aria-hidden="true" /><span>Dark outline · over reconstructed land</span></li>
                  <li><i className="outline-marker outline-marker-light" aria-hidden="true" /><span>Light grey outline · over shallow or deep sea</span></li>
                </ul>
                <small>Outline tone is a legibility device, not evidence. Modern-country outlines are
                  position markers at this age, never historical borders or coastlines.</small>
              </div>
            )}
            <div className="surface-evidence-key">
              <strong>Evidence in this view</strong>
              {palaeoKeyVisible && palaeoEvidence.references.map((reference) => (
                <span key={reference.sourceId}>{reference.citation} · {reference.constrains}
                  {reference.editorial ? " · EarthHistory modification after this reference" : ""}
                  {reference.claim === "earthhistory-infers" ? " · EarthHistory inference" : ""}</span>
              ))}
              {palaeoKeyVisible && palaeoEvidence.references.length === 0
                && palaeoEvidence.sourceIds.map((sourceId) => <span key={sourceId}>{sourceId}</span>)}
              {palaeoKeyVisible && palaeoEvidence.references.length === 0
                && palaeoEvidence.sourceIds.length === 0
                && <span>No palaeo-coastline charts on screen{palaeoEvidence.unavailableReason === null
                  ? "" : ` · ${palaeoEvidence.unavailableReason}`}</span>}
              {observedMaterialVisible && <span>Observed modern land · Natural Earth at 0 Ma</span>}
              {classifiedShallowMarineVisible && <span>Modern Iceland shelf · generalized 0–200 m class</span>}
              {qualifiedMaterialVisible && <span>Source-qualified material · cited reconstruction pose; exposure unknown</span>}
              {uncertainMaterialVisible && <span>Model-inferred or uncertain material · pose, continuation, or formation extent; exposure unknown</span>}
              {!observedMaterialVisible && !classifiedShallowMarineVisible
                && !qualifiedMaterialVisible && !uncertainMaterialVisible
                && <span>No regional material correction evidence active</span>}
            </div>
            <div className="surface-info-status">
              <span>Surface water</span>
              {layers.guides && <span>Schematic climate guides</span>}
              <span role="status">Cao reconstruction · {foundationStatus}</span>
              {caoLoadError !== null && (
                <span role="status">Cao reconstruction unavailable · surface withheld</span>
              )}
              {caoTimelineLoading.status === "loading" && (
                <span role="status">Current age ready · loading timeline data</span>
              )}
              {caoTimelineLoading.status === "paused" && (
                <span role="status">
                  Current age ready · timeline loading paused
                  <button type="button" onClick={() => caoRuntimeRef.current?.retryTimelineLoading()}>Retry</button>
                </span>
              )}
              {areaFocusStatus === "unresolved" && <span role="status">Tracked material unavailable at this age · tag retained</span>}
              <span>Elevation not represented</span>
            </div>
          </div>
        </details>
        {materialFocusAddress !== null && (
          <div className="location-lock" data-testid="location-lock" data-status={areaFocusStatus ?? "resolving"}>
            <span role="status">
              {areaFocusStatus === "unresolved"
                ? "Location locked · unavailable at this age"
                : "Location locked · following through time"}
            </span>
            <button type="button" onClick={clearLocationLock}>Unlock</button>
          </div>
        )}
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
            <span className="view-evidence"><i>Rendered view</i><EvidenceBadge status={renderedEvidence} /></span>
          </div>
          <p className="era-line">{chapter.eon} <span>·</span> {chapter.period}</p>
          <h1>{chapter.label}</h1>
          <p className="age-display">{formatAge(ageMa)}</p>
        </div>
        <div id="chapter-context-details" className="context-details">
          <p className="geography-age">
            Geography source <strong>{caoAgeDomainMa && ageMa > caoAgeDomainMa[1] ? "Outside compiled domain · editorial scene" :
              displayedCao === null ? "Awaiting native Cao package" :
              displayedCao.display.youngerAgeMa === displayedCao.display.olderAgeMa
                ? `${displayedCao.display.youngerAgeMa} Ma native Cao checkpoint${
                  displayedCao.materialCorrections.qualifiedActiveCharts > 0 ? " + qualified material masks" : ""}${
                  displayedCao.materialCorrections.modelInferredPoseActiveCharts > 0 ? " + uncertain partition poses" : ""}${
                  displayedCao.materialCorrections.uncertainActiveCharts > 0 ? " + uncertain continuations" : ""}${
                  displayedCao.materialCorrections.formationUncertainActiveCharts > 0 ? " + formation-range scenarios" : ""}`
                : `${displayedCao.display.youngerAgeMa}–${displayedCao.display.olderAgeMa} Ma native Cao controls${
                  displayedCao.materialCorrections.qualifiedActiveCharts > 0 ? " + qualified material masks" : ""}${
                  displayedCao.materialCorrections.modelInferredPoseActiveCharts > 0 ? " + uncertain partition poses" : ""}${
                  displayedCao.materialCorrections.uncertainActiveCharts > 0 ? " + uncertain continuations" : ""}${
                  displayedCao.materialCorrections.formationUncertainActiveCharts > 0 ? " + formation-range scenarios" : ""}`}</strong>
          </p>
          <p className="geography-age">Coordinate model <strong>Cao et al. 2024 v2.4 · {ageMa <= 540
            ? "source-qualified material corrections" : "native full-domain reconstruction"}</strong></p>
          {ageMa <= 540 && <p className="geography-age">Coverage meaning <strong>Unmapped material is unavailable evidence, not confirmed ocean; corrected masks do not claim exposure or coastline</strong></p>}
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
          {caoAgeDomainMa && ageMa >= caoAgeDomainMa[0] && ageMa <= caoAgeDomainMa[1] && (
            <div className="jump-row source-age-jump">
              <label htmlFor="source-age-jump">Jump to reconstruction</label>
              <select
                id="source-age-jump"
                value={displayedCao === null ? ""
                  : displayedCao.display.youngerAgeMa === displayedCao.display.olderAgeMa
                    ? String(displayedCao.display.youngerAgeMa)
                    : "interpolated"}
                onChange={(event) => changeAge(Number(event.target.value))}
              >
                {caoRevision === null && <option value="">Resolving source age…</option>}
                {displayedCao !== null && displayedCao.display.youngerAgeMa !== displayedCao.display.olderAgeMa && (
                  <option value="interpolated" disabled>
                    {formatAge(ageMa)} · interpolated
                  </option>
                )}
                {caoSourceAges.map((sourceAge) => (
                  <option key={sourceAge} value={sourceAge}>
                    {sourceAge} Ma · native Cao
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
        caoAgeDomainMa={caoAgeDomainMa ?? undefined}
        geographicSourceAgeMa={displayedCao !== null
          && displayedCao.display.youngerAgeMa === displayedCao.display.olderAgeMa
          ? displayedCao.display.youngerAgeMa : undefined}
        geographicSourceAgeBracketMa={displayedCao === null ? undefined
          : [displayedCao.display.youngerAgeMa, displayedCao.display.olderAgeMa]}
        intervalMarksMa={layers.palaeoCoastlines ? CAO_2017_MAP_INTERVAL_MARKS_MA : undefined}
        slices={timeSlices}
        playing={playing}
        onPlayingChange={handlePlayingChange}
        onAgeChange={changeAge}
        onPrevious={() => stepChapter(-1)}
        onNext={() => stepChapter(1)}
      />

      <Modal open={panel === "layers"} title="Visible layers" eyebrow="Map controls" onClose={closePanel}>
        <div className="layer-list">
          {LAYER_META.map(({ key, label, detail, icon: LayerIcon }) => {
            // Only the palaeo-coastline layer can be unavailable, and only
            // because its charts are missing from the build. An age with no
            // published map is a fallback, not a reason to disable the control.
            const unavailableReason = key === "palaeoCoastlines"
              ? palaeoEvidence.unavailableReason : null;
            const busy = key === "palaeoCoastlines" && palaeoEvidence.loading;
            return (
              <button
                type="button"
                key={key}
                aria-pressed={layers[key]}
                aria-busy={busy || undefined}
                disabled={unavailableReason !== null}
                onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
              >
                <span className="layer-icon"><LayerIcon size={18} /></span>
                <span><strong>{label}</strong><small>{detail}</small>
                  {unavailableReason !== null && <small className="layer-unavailable">Unavailable · {unavailableReason}</small>}
                  {key === "palaeoCoastlines" && unavailableReason === null && layers[key] && palaeoFallback
                    && <small className="layer-unavailable">No Cao 2017 map at this age · showing the Cao 2024 coast proxy</small>}
                </span>
                <span className={`switch ${layers[key] ? "is-on" : ""}`} aria-label={`${label} ${layers[key] ? "on" : "off"}`}><i /></span>
              </button>
            );
          })}
          <button type="button" aria-disabled="true" disabled>
            <span className="layer-icon"><Waves size={18} /></span>
            <span>
              <strong>Seafloor unavailable</strong>
              <small>The Cao foundation has no qualified ocean-floor age or depth field.</small>
            </span>
            <span className="switch" aria-label="Exposed seafloor unavailable"><i /></span>
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
                <span><small>{poi.category} · {formatAge(poi.ageStartMa)}{temporalPoiCoordinates?.[poi.id] ? " · Native anchor" : contextSnapshot?.poiIds.includes(poi.id) ? " · This chapter" : ""}</small><strong>{poi.title}</strong><i>{poi.subtitle ?? poi.locationNote}</i></span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel"><BookOpen size={24} /><p>No field notes have a supported time interval at this age. Use the period navigation to explore another time.</p></div>
        )}
      </Modal>

      <Modal open={panel === "sources"} title="Sources & provenance" eyebrow={contextSnapshot ? `${contextSnapshot.label} reconstruction` : "Scientific record"} onClose={closePanel}>
        <p className="modal-intro">Each reconstruction distinguishes source evidence from interpolation and visual synthesis. These references support the current rendered view.</p>
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

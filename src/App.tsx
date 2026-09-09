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
import { GlobeView } from "./render";
import {
  getSnapshot,
  modernLandscapePresets,
  pointsOfInterest,
  sources,
  timeSlices,
  type GlobeStats,
  type LayerVisibility,
  type LonLat,
  type PointOfInterest,
  type WorldSnapshot,
} from "./data";
import { EvidenceBadge } from "./components/EvidenceBadge";
import { Modal } from "./components/Modal";
import { formatAge, formatGeographicSourceAge, Timeline } from "./components/Timeline";
import { parseFocusCoordinates, serializeFocusCoordinates } from "./focusState";

type Panel = "notes" | "sources" | "layers" | "about" | "quality" | null;
type Quality = "auto" | "high" | "low";
type SpatialFocus =
  | { kind: "poi"; poiId: string; coordinates: LonLat; nonce: number }
  | { kind: "place"; placeId: string; coordinates: LonLat; nonce: number; distance: number }
  | { kind: "area"; coordinates: LonLat; nonce: number };

const DEFAULT_LAYERS: LayerVisibility = {
  clouds: false,
  borders: true,
  tectonics: true,
  rivers: false,
};

const LAYER_META: Array<{
  key: keyof LayerVisibility;
  label: string;
  detail: string;
  icon: typeof Cloud;
}> = [
  { key: "clouds", label: "Clouds", detail: "Atmospheric cloud cover", icon: Cloud },
  { key: "borders", label: "Modern reference", detail: "Present-day outlines where reconstruction supports them", icon: Map },
  { key: "tectonics", label: "Tectonics & rifts", detail: "Dated margins, belts and rift structures", icon: Mountain },
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
    relief: Number.isFinite(parsedRelief) ? Math.min(30, Math.max(1, Math.round(parsedRelief))) : 8,
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
  const oldest = Math.max(poi.ageStartMa, poi.ageEndMa);
  const youngest = Math.min(poi.ageStartMa, poi.ageEndMa);
  if (!snapshot?.poiIds.includes(poi.id) || ageMa < youngest || ageMa > oldest) return undefined;
  return snapshot.poiCoordinates?.[poi.id];
}

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
        ? { kind: "area", coordinates: initialArea, nonce: 0 }
        : null,
  );
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(
    initialPoi === undefined && initialLandscape === undefined && initialArea === null,
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
  const lastStatsUpdate = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelOpenedFromMenu = useRef(false);
  const focusNonce = useRef(0);
  const requestedAgeRef = useRef(ageMa);
  requestedAgeRef.current = ageMa;
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );

  const selectedPoi = useMemo(
    () => pointsOfInterest.find((poi) => poi.id === selectedPoiId) ?? null,
    [selectedPoiId],
  );
  const selectedPoiCoordinate = selectedPoi
    ? poiDisplayCoordinate(selectedPoi, snapshot, ageMa)
    : undefined;
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
  const contextSnapshot = snapshot?.requestedAgeMa === ageMa ? snapshot : null;
  const chronologicalPois = useMemo(
    () => [...pointsOfInterest].sort((a, b) => b.ageStartMa - a.ageStartMa),
    [],
  );

  const loadSnapshot = useCallback(async (age: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getSnapshot(age);
      if (requestedAgeRef.current === age) setSnapshot(next);
    } catch (error) {
      if (requestedAgeRef.current === age) {
        setLoadError(error instanceof Error ? error.message : "This reconstruction could not be loaded.");
      }
    } finally {
      if (requestedAgeRef.current === age) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError(null);
      getSnapshot(ageMa)
        .then((next) => {
          if (active) setSnapshot(next);
        })
        .catch((error: unknown) => {
          if (active) setLoadError(error instanceof Error ? error.message : "This reconstruction could not be loaded.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [ageMa]);

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
    if (selectedPoiId) params.set("focus", selectedPoiId);
    else if (spatialFocus?.kind === "place") params.set("place", spatialFocus.placeId);
    else if (spatialFocus?.kind === "area") {
      params.set("at", serializeFocusCoordinates(spatialFocus.coordinates));
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${params}`);
  }, [ageMa, layers, selectedPoiId, spatialFocus, verticalExaggeration]);

  useEffect(() => {
    if (!playing || orderedSlices.length === 0) return;
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
  }, [playing, orderedSlices]);

  useEffect(() => {
    if (!selectedPoi) return;
    if (!selectedPoiCoordinate) {
      setSpatialFocus((current) =>
        current?.kind === "poi" && current.poiId === selectedPoi.id ? null : current
      );
      setAutoRotateEnabled(true);
      return;
    }
    setAutoRotateEnabled(false);
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
      };
    });
  }, [ageMa, snapshot?.id, selectedPoi?.id]);

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
    if (!poi) return;
    setSelectedPoiId(id);
    setSelectedLandscapeId(null);
    if (openNotes) setPanel("notes");
    const coordinates = poiDisplayCoordinate(poi, snapshot, ageMa);
    if (coordinates) {
      setAutoRotateEnabled(false);
      setSpatialFocus({
        kind: "poi",
        poiId: poi.id,
        coordinates,
        nonce: ++focusNonce.current,
      });
    } else {
      setSpatialFocus(null);
      setAutoRotateEnabled(true);
    }
  };

  const selectSurface = (coordinates: LonLat) => {
    setAutoRotateEnabled(false);
    if (spatialFocus !== null) {
      if (spatialFocus.kind === "poi") setSelectedPoiId(null);
      if (spatialFocus.kind === "place") setSelectedLandscapeId(null);
      setSpatialFocus(null);
      return;
    }
    setSelectedPoiId(null);
    setSelectedLandscapeId(null);
    setSpatialFocus({ kind: "area", coordinates, nonce: ++focusNonce.current });
  };

  const clearSelectedPoi = () => {
    setSelectedPoiId(null);
    if (spatialFocus?.kind === "poi") {
      setSpatialFocus(null);
      setAutoRotateEnabled(false);
    }
  };

  const resetCamera = () => {
    setSelectedLandscapeId(null);
    setSelectedPoiId(null);
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

  const activeSourceIds = new Set([
    ...(snapshot?.sourceIds ?? []),
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
          snapshot={snapshot}
          layers={layers}
          selectedPoiId={selectedPoiId}
          onSelectPoi={(id: string) => openPoi(id)}
          onSelectSurface={selectSurface}
          onStats={handleStats}
          focusTarget={spatialFocus}
          resetNonce={resetNonce}
          autoRotate={!reducedMotion && autoRotateEnabled}
          quality={quality}
          verticalExaggeration={verticalExaggeration}
          surfaceMode={selectedLandscape?.surfaceMode ?? "surface"}
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
        <div className="surface-legend" aria-label={`${selectedLandscape?.surfaceMode === "seafloor" ? "Seafloor view, " : ""}visual terrain relief ${verticalExaggeration} times`}>
          {selectedLandscape?.surfaceMode === "seafloor" && <span>Seafloor view</span>}
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
            Geography source <strong>{loading ? "Resolving…" : contextSnapshot?.geographicSourceAgeMa == null ? "Illustrative field" : formatGeographicSourceAge(contextSnapshot.geographicSourceAgeMa)}</strong>
          </p>
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

      <Modal open={panel === "notes"} title={selectedPoi?.title ?? "Field notes"} eyebrow={selectedPoi ? `${selectedPoi.category} · ${formatAge(selectedPoi.ageStartMa)}` : `${chronologicalPois.length} notes across deep time`} onClose={closePanel}>
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
            {!selectedPoiCoordinate && snapshot?.poiIds.includes(selectedPoi.id) && (
              <p className="location-note"><Info size={15} /> This note has no defensible map position in this chapter.</p>
            )}
            {!selectedPoiCoordinate && !snapshot?.poiIds.includes(selectedPoi.id) && (
              <button type="button" className="text-action" onClick={() => changeAge(selectedPoi.ageStartMa)}>
                <Aperture size={15} /> View this chapter
              </button>
            )}
            <div className="detail-sources">
              <h3>Sources</h3>
              {poiSources.map((source) => <SourceLink key={source.id} source={source} />)}
            </div>
            <button type="button" className="back-action" onClick={clearSelectedPoi}>← All notes</button>
          </article>
        ) : chronologicalPois.length ? (
          <div className="notes-list">
            {chronologicalPois.map((poi, index) => (
              <button type="button" key={poi.id} onClick={() => openPoi(poi.id, false)}>
                <span className="note-index">{String(index + 1).padStart(2, "0")}</span>
                <span><small>{poi.category} · {formatAge(poi.ageStartMa)}{snapshot?.poiCoordinates?.[poi.id] ? " · Located now" : snapshot?.poiIds.includes(poi.id) ? " · This chapter" : ""}</small><strong>{poi.title}</strong><i>{poi.subtitle ?? poi.locationNote}</i></span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel"><BookOpen size={24} /><p>No positioned field notes are supported for this reconstruction. The geological context remains available through its sources.</p></div>
        )}
      </Modal>

      <Modal open={panel === "sources"} title="Sources & provenance" eyebrow={snapshot ? `${snapshot.label} reconstruction` : "Scientific record"} onClose={closePanel}>
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type PointOfInterest,
  type WorldSnapshot,
} from "./data";
import { EvidenceBadge } from "./components/EvidenceBadge";
import { IconButton } from "./components/IconButton";
import { Modal } from "./components/Modal";
import { formatAge, formatGeographicSourceAge, Timeline } from "./components/Timeline";

type Panel = "notes" | "sources" | "layers" | "about" | "quality" | null;
type Quality = "auto" | "high" | "low";

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

function getJourneySlices() {
  if (!timeSlices.length) return [];
  const sorted = [...timeSlices].sort((a, b) => b.ageMa - a.ageMa);
  const find = (pattern: RegExp) =>
    sorted.find((slice) => pattern.test(`${slice.id} ${slice.label} ${slice.period} ${slice.description}`));
  const candidates = [
    sorted[0],
    find(/moon|impact/i),
    find(/ocean|sea|cool/i),
    find(/oxygen|biome|life/i),
    find(/ice|glaci/i),
    sorted[sorted.length - 1],
  ].filter((slice): slice is (typeof timeSlices)[number] => Boolean(slice));
  return candidates.filter((slice, index) => candidates.findIndex((item) => item.id === slice.id) === index);
}

function poiDisplayCoordinate(poi: PointOfInterest, snapshot: WorldSnapshot | null, ageMa: number) {
  const oldest = Math.max(poi.ageStartMa, poi.ageEndMa);
  const youngest = Math.min(poi.ageStartMa, poi.ageEndMa);
  if (!snapshot?.poiIds.includes(poi.id) || ageMa < youngest || ageMa > oldest) return undefined;
  return snapshot.poiCoordinates?.[poi.id];
}

export default function App() {
  const initial = useRef(parseInitialState()).current;
  const initialLandscape = modernLandscapePresets.find((preset) => preset.id === initial.place);
  const [ageMa, setAgeMa] = useState(initial.age);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>(initial.layers);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(initial.focus);
  const [focusTarget, setFocusTarget] = useState<{ coordinates: [number, number]; nonce: number; distance?: number } | undefined>(
    initialLandscape
      ? { coordinates: initialLandscape.coordinates, distance: initialLandscape.distance, nonce: Date.now() }
      : undefined,
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
  const journeySlices = useMemo(() => getJourneySlices(), []);
  const orderedSlices = useMemo(() => [...timeSlices].sort((a, b) => a.ageMa - b.ageMa), []);
  const chapter = useMemo(() => closestChapter(ageMa), [ageMa]);
  const chapterNumber = useMemo(
    () => [...orderedSlices].reverse().findIndex((slice) => slice.id === chapter.id) + 1,
    [chapter.id, orderedSlices],
  );
  const contextSnapshot = snapshot?.requestedAgeMa === ageMa ? snapshot : null;
  const availablePois = useMemo(
    () =>
      pointsOfInterest
        .filter((poi) => snapshot?.poiIds.includes(poi.id))
        .sort((a, b) => b.ageStartMa - a.ageStartMa),
    [snapshot],
  );
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
    if (selectedLandscapeId) params.set("place", selectedLandscapeId);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${params}`);
  }, [ageMa, layers, selectedLandscapeId, selectedPoiId, verticalExaggeration]);

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
    if (!selectedPoiCoordinate) return;
    setFocusTarget({ coordinates: selectedPoiCoordinate, nonce: Date.now() });
  }, [snapshot?.id, selectedPoi?.id]);

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
    setSelectedPoiId(id);
    if (openNotes) setPanel("notes");
    const coordinates = poi ? poiDisplayCoordinate(poi, snapshot, ageMa) : undefined;
    if (coordinates) {
      setFocusTarget({ coordinates, nonce: Date.now() });
    }
  };

  const resetCamera = () => {
    setSelectedLandscapeId(null);
    setResetNonce((value) => value + 1);
  };

  const selectLandscape = (id: string) => {
    const preset = modernLandscapePresets.find((item) => item.id === id);
    setSelectedLandscapeId(preset?.id ?? null);
    setSelectedPoiId(null);
    setLayers((current) => ({ ...current, clouds: false }));
    if (!preset) {
      setResetNonce((value) => value + 1);
      return;
    }
    setAgeMa(0);
    setFocusTarget({
      coordinates: preset.coordinates,
      distance: preset.distance,
      nonce: Date.now(),
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
          <button type="button" onClick={() => setPanel("notes")}>Field notes</button>
          <button type="button" onClick={() => setPanel("sources")}>Sources</button>
        </nav>
        <button type="button" className="share-button" onClick={shareView}>
          {shareComplete ? <Check size={15} /> : <Share2 size={15} />}
          <span>{shareComplete ? "Copied" : "Share view"}</span>
        </button>
      </header>

      <section className="globe-stage" aria-label="Interactive Earth reconstruction">
        <GlobeView
          snapshot={snapshot}
          layers={layers}
          selectedPoiId={selectedPoiId}
          onSelectPoi={(id: string) => openPoi(id)}
          onStats={handleStats}
          focusTarget={focusTarget}
          resetNonce={resetNonce}
          autoRotate={!reducedMotion && !selectedPoiId}
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

      <aside className="context-panel" aria-label="Current chapter">
        <div className="context-topline">
          <span className="index-label">Chapter {String(chapterNumber).padStart(2, "0")}</span>
          <span className="view-evidence"><i>Rendered view</i><EvidenceBadge status={contextSnapshot?.evidence ?? chapter.evidence} /></span>
        </div>
        <p className="era-line">{chapter.eon} <span>·</span> {chapter.period}</p>
        <h1>{chapter.label}</h1>
        <p className="age-display">{formatAge(ageMa)}</p>
        <p className="geography-age">
          Geography source <strong>{loading ? "Resolving…" : contextSnapshot?.geographicSourceAgeMa == null ? "Illustrative field" : formatGeographicSourceAge(contextSnapshot.geographicSourceAgeMa)}</strong>
        </p>
        <p className="chapter-copy">{chapter.description}</p>
        {scenarioLike && <span className="scenario-label"><Aperture size={13} /> Illustrative scene · geography unresolved</span>}

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
      </aside>

      <aside className="journey-rail" aria-label="Curated journey">
        <span className="vertical-label">Travel through time</span>
        <div className="journey-stops">
          {journeySlices.map((slice) => (
            <button
              type="button"
              key={slice.id}
              className={snapshot?.id === slice.id ? "is-active" : ""}
              onClick={() => changeAge(slice.ageMa)}
              title={`${slice.label}, ${formatAge(slice.ageMa)}`}
            >
              <span />
              <b>{formatAge(slice.ageMa)}</b>
              <small>{slice.label}</small>
            </button>
          ))}
        </div>
      </aside>

      <aside className="tool-rail" aria-label="Globe tools">
        <IconButton label="Choose visible layers" onClick={() => setPanel("layers")} active={panel === "layers"}>
          <Layers3 size={19} />
          <span className="tool-count">{Object.values(layers).filter(Boolean).length}</span>
        </IconButton>
        <IconButton label="Reset camera" onClick={resetCamera}><Compass size={19} /></IconButton>
        <IconButton label={`Rendering quality: ${quality}`} onClick={() => setPanel("quality")} active={panel === "quality"}>
          <Gauge size={19} />
        </IconButton>
        <span className="tool-rule" />
        <IconButton label="Open field notes" onClick={() => setPanel("notes")} active={panel === "notes"}>
          <BookOpen size={18} />
          {availablePois.length > 0 && <span className="tool-count">{availablePois.length}</span>}
        </IconButton>
        <IconButton label="Open sources" onClick={() => setPanel("sources")} active={panel === "sources"}>
          <Database size={18} />
        </IconButton>
        <IconButton label="About this reconstruction" onClick={() => setPanel("about")} active={panel === "about"}>
          <Info size={18} />
        </IconButton>
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

      <Modal open={panel === "layers"} title="Visible layers" eyebrow="Map controls" onClose={() => setPanel(null)}>
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

      <Modal open={panel === "quality"} title="Rendering quality" eyebrow="Globe controls" onClose={() => setPanel(null)}>
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

      <Modal open={panel === "notes"} title={selectedPoi?.title ?? "Field notes"} eyebrow={selectedPoi ? `${selectedPoi.category} · ${formatAge(selectedPoi.ageStartMa)}` : `${chronologicalPois.length} notes across deep time`} onClose={() => setPanel(null)}>
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
            <button type="button" className="back-action" onClick={() => setSelectedPoiId(null)}>← All notes</button>
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

      <Modal open={panel === "sources"} title="Sources & provenance" eyebrow={snapshot ? `${snapshot.label} reconstruction` : "Scientific record"} onClose={() => setPanel(null)}>
        <p className="modal-intro">Each reconstruction distinguishes source evidence from interpolation and visual synthesis. These references support the current chapter.</p>
        <div className="source-list">
          {(snapshotSources.length ? snapshotSources : sources).map((source) => <SourceLink key={source.id} source={source} />)}
        </div>
      </Modal>

      <Modal open={panel === "about"} title="Reading this globe" eyebrow="Scientific context" onClose={() => setPanel(null)}>
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

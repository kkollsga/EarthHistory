import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { TimeSlice } from "../data";

const CURVE = 5;

export const sliderToAge = (value: number, maxAge: number) =>
  maxAge * ((Math.exp((value / 1000) * CURVE) - 1) / (Math.exp(CURVE) - 1));

export const ageToSlider = (age: number, maxAge: number) => {
  if (!maxAge) return 0;
  return (Math.log(1 + (Math.max(0, age) / maxAge) * (Math.exp(CURVE) - 1)) / CURVE) * 1000;
};

export function formatAge(ageMa: number) {
  if (ageMa === 0) return "Today";
  if (ageMa >= 1000) {
    const ga = ageMa / 1000;
    return `${ga >= 4 ? ga.toFixed(3) : ga.toFixed(2)} Ga`;
  }
  if (ageMa < 1) return `${Math.round(ageMa * 1000)} ka`;
  const precision = ageMa < 100 ? 2 : 1;
  return `${Number(ageMa.toFixed(precision))} Ma`;
}

export const formatGeographicSourceAge = (ageMa: number) =>
  ageMa === 0 ? "0 Ma (present-day grid)" : formatAge(ageMa);

interface TimelineProps {
  ageMa: number;
  geographicSourceAgeMa?: number;
  slices: TimeSlice[];
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onAgeChange: (ageMa: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}

const EON_BOUNDARIES = [
  { name: "Phanerozoic", youngest: 0, oldest: 538.8 },
  { name: "Proterozoic", youngest: 538.8, oldest: 2500 },
  { name: "Archean", youngest: 2500, oldest: 4031 },
  { name: "Hadean", youngest: 4031, oldest: 4567 },
];

const PHANEROZOIC_MAX = 538.8;
const RECENT_MAX = 2.58;
const ERA_BOUNDARIES = [
  { name: "Cenozoic", youngest: 0, oldest: 66 },
  { name: "Mesozoic", youngest: 66, oldest: 251.902 },
  { name: "Paleozoic", youngest: 251.902, oldest: PHANEROZOIC_MAX },
];
const PERIOD_BOUNDARIES = [
  { name: "Quaternary", youngest: 0, oldest: 2.58 },
  { name: "Neogene", youngest: 2.58, oldest: 23.04 },
  { name: "Paleogene", youngest: 23.04, oldest: 66 },
  { name: "Cretaceous", youngest: 66, oldest: 143.1 },
  { name: "Jurassic", youngest: 143.1, oldest: 201.4 },
  { name: "Triassic", youngest: 201.4, oldest: 251.902 },
  { name: "Permian", youngest: 251.902, oldest: 298.9 },
  { name: "Carboniferous", youngest: 298.9, oldest: 358.86 },
  { name: "Devonian", youngest: 358.86, oldest: 419.62 },
  { name: "Silurian", youngest: 419.62, oldest: 443.1 },
  { name: "Ordovician", youngest: 443.1, oldest: 486.85 },
  { name: "Cambrian", youngest: 486.85, oldest: PHANEROZOIC_MAX },
];
const RECENT_BOUNDARIES = [
  { name: "Holocene", youngest: 0, oldest: 0.0117 },
  { name: "Pleistocene", youngest: 0.0117, oldest: RECENT_MAX },
];

type ScaleMode = "deep" | "phanerozoic" | "recent";

export function selectVisibleChapters(
  slices: TimeSlice[],
  maxAge: number,
  width: number,
  currentAge: number,
  linear = false,
) {
  const sorted = [...slices].sort((left, right) => left.ageMa - right.ageMa);
  if (sorted.length <= 1) return sorted;
  const position = (slice: TimeSlice) =>
    ((linear ? slice.ageMa / maxAge : ageToSlider(slice.ageMa, maxAge) / 1000) * width);
  const current = sorted.reduce((closest, slice) =>
    Math.abs(slice.ageMa - currentAge) < Math.abs(closest.ageMa - currentAge) ? slice : closest,
  );
  const minimumSpacing = width < 700 ? 132 : width < 1100 ? 124 : 116;
  const capacity = Math.max(3, Math.floor(width / minimumSpacing));
  const selected = new Map([[current.id, current]]);
  for (const endpoint of [sorted[0], sorted.at(-1)!]) {
    if (
      endpoint.id === current.id ||
      Math.abs(position(endpoint) - position(current)) >= minimumSpacing
    ) {
      selected.set(endpoint.id, endpoint);
    }
  }

  while (selected.size < capacity) {
    let best: TimeSlice | undefined;
    let bestDistance = -1;
    for (const candidate of sorted) {
      if (selected.has(candidate.id)) continue;
      const distance = Math.min(
        ...[...selected.values()].map((existing) => Math.abs(position(candidate) - position(existing))),
      );
      if (distance > bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best === undefined || bestDistance < minimumSpacing) break;
    selected.set(best.id, best);
  }
  return [...selected.values()].sort((left, right) => left.ageMa - right.ageMa);
}

export function Timeline({
  ageMa,
  geographicSourceAgeMa,
  slices,
  playing,
  onPlayingChange,
  onAgeChange,
  onPrevious,
  onNext,
}: TimelineProps) {
  const chaptersRef = useRef<HTMLDivElement>(null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(() =>
    ageMa <= RECENT_MAX ? "recent" : ageMa <= PHANEROZOIC_MAX ? "phanerozoic" : "deep",
  );
  const [chaptersWidth, setChaptersWidth] = useState(() => window.innerWidth - 92);
  const deepMaxAge = Math.max(4567.3, ...slices.map((slice) => slice.ageMa));
  const maxAge = scaleMode === "deep" ? deepMaxAge : scaleMode === "phanerozoic" ? PHANEROZOIC_MAX : RECENT_MAX;
  const sliderPosition = (age: number) => scaleMode === "deep"
    ? ageToSlider(age, deepMaxAge)
    : (Math.min(maxAge, Math.max(0, age)) / maxAge) * 1000;
  const sliderAge = (value: number) => scaleMode === "deep"
    ? sliderToAge(value, deepMaxAge)
    : (value / 1000) * maxAge;
  const chapterMarks = useMemo(() => [...slices].sort((a, b) => a.ageMa - b.ageMa), [slices]);
  const visibleScaleChapters = useMemo(
    () => scaleMode === "deep" ? chapterMarks : chapterMarks.filter((slice) => slice.ageMa <= maxAge),
    [chapterMarks, maxAge, scaleMode],
  );
  const visibleChapters = useMemo(
    () => selectVisibleChapters(visibleScaleChapters, maxAge, chaptersWidth, ageMa, scaleMode !== "deep"),
    [ageMa, chaptersWidth, maxAge, visibleScaleChapters],
  );
  const ageDifference = geographicSourceAgeMa == null ? 0 : Math.abs(ageMa - geographicSourceAgeMa);

  useEffect(() => {
    const target = chaptersRef.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => setChaptersWidth(entry.contentRect.width));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ageMa > PHANEROZOIC_MAX && scaleMode !== "deep") setScaleMode("deep");
    else if (ageMa > RECENT_MAX && scaleMode === "recent") setScaleMode("phanerozoic");
  }, [ageMa, scaleMode]);

  const chooseScale = (next: ScaleMode) => {
    setScaleMode(next);
    if (next === "recent" && ageMa > RECENT_MAX) onAgeChange(RECENT_MAX);
    else if (next === "phanerozoic" && ageMa > PHANEROZOIC_MAX) onAgeChange(PHANEROZOIC_MAX);
  };

  const handlePercent = sliderPosition(ageMa) / 10;

  return (
    <section className="timeline" aria-label="Geological timeline">
      <div className="timeline-heading">
        <div className="playback-controls">
          <button
            type="button"
            className="timeline-button"
            onClick={() => onPlayingChange(!playing)}
            aria-label={playing ? "Pause time travel" : "Travel through time"}
          >
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button type="button" className="timeline-step" onClick={onPrevious} aria-label="Go to newer chapter">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="timeline-step" onClick={onNext} aria-label="Go to older chapter">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="timeline-readout" aria-live="polite">
          <strong>{formatAge(ageMa)}</strong>
          {ageDifference > 0.001 && geographicSourceAgeMa != null && (
            <span>Geography source: {formatGeographicSourceAge(geographicSourceAgeMa)}</span>
          )}
        </div>
        <div className="timeline-scale-control">
          <label htmlFor="timeline-scale">Timeline range</label>
          <select
            id="timeline-scale"
            value={scaleMode}
            onChange={(event) => chooseScale(event.target.value as ScaleMode)}
          >
            <option value="recent">Recent Earth</option>
            <option value="phanerozoic">Phanerozoic</option>
            <option value="deep">Deep time</option>
          </select>
        </div>
        <span className="timeline-direction">{scaleMode === "deep" ? "Nonlinear full history" : scaleMode === "phanerozoic" ? "Linear last 538.8 Ma" : "Linear last 2.58 Ma"}</span>
      </div>

      <div className="timeline-track-wrap">
        <output
          className={`timeline-handle-label ${handlePercent < 6 ? "is-start" : handlePercent > 94 ? "is-end" : ""}`}
          style={{ left: `${handlePercent}%` }}
          htmlFor="geological-age"
        >
          {formatAge(ageMa)}
        </output>
        <input
          id="geological-age"
          className="timeline-range"
          type="range"
          min="0"
          max="1000"
          step="1"
          value={sliderPosition(ageMa)}
          onChange={(event) => onAgeChange(sliderAge(Number(event.target.value)))}
          aria-label={`Geological age, ${formatAge(ageMa)}`}
          aria-valuetext={formatAge(ageMa)}
        />
        <div className="chapter-marks" aria-hidden="true">
          {visibleScaleChapters.map((slice) => (
            <span
              key={slice.id}
              className={`chapter-mark ${Math.abs(ageMa - slice.ageMa) < 0.0001 ? "is-current" : ""}`}
              style={{ left: `${sliderPosition(slice.ageMa) / 10}%` }}
            />
          ))}
        </div>
      </div>

      <div className="timeline-chapters" aria-hidden="true" ref={chaptersRef}>
        {visibleChapters.map((slice, index) => (
          <span
            key={slice.id}
            className={`${Math.abs(ageMa - slice.ageMa) < 0.04 ? "is-current " : ""}${index === 0 ? "is-first" : index === visibleChapters.length - 1 ? "is-last" : ""}`}
            style={{ left: `${sliderPosition(slice.ageMa) / 10}%` }}
            title={`${slice.period} · ${formatAge(slice.ageMa)}`}
          >
            {slice.label}
          </span>
        ))}
      </div>
      <div className={`geological-bands ${scaleMode}`} aria-label={scaleMode === "deep" ? "Geological eons" : scaleMode === "phanerozoic" ? "Geological eras and periods" : "Recent geological periods and epochs"}>
        <div className="geological-band major-band">
        {(scaleMode === "deep" ? EON_BOUNDARIES : scaleMode === "phanerozoic" ? ERA_BOUNDARIES : [{ name: "Quaternary", youngest: 0, oldest: RECENT_MAX }]).map((unit) => {
          const start = sliderPosition(unit.youngest) / 10;
          const end = sliderPosition(unit.oldest) / 10;
          return (
            <span
              key={`${unit.name}-${unit.youngest}`}
              style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
              title={`${unit.name}, ${formatAge(unit.oldest)} to ${formatAge(unit.youngest)}`}
            >
              {unit.name}
            </span>
          );
        })}
        </div>
        {scaleMode !== "deep" && (
          <div className="geological-band period-band">
            {(scaleMode === "phanerozoic" ? PERIOD_BOUNDARIES : RECENT_BOUNDARIES).map((unit) => {
              const start = sliderPosition(unit.youngest) / 10;
              const end = sliderPosition(unit.oldest) / 10;
              return (
                <span
                  key={unit.name}
                  style={{ left: `${start}%`, width: `${Math.max(0, end - start)}%` }}
                  title={`${unit.name}, ${formatAge(unit.oldest)} to ${formatAge(unit.youngest)}`}
                >
                  {unit.name}
                </span>
              );
            })}
          </div>
        )}
        <small className="scale-source">ICS 2026/06 · authored chapters</small>
      </div>
    </section>
  );
}

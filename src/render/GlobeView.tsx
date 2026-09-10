import { useEffect, useRef, useState } from "react";
import type {
  GlobeStats,
  LayerVisibility,
  LonLat,
  TemporalCountryReferences,
  TemporalSurface,
  WorldSnapshot,
} from "../data";
import { GlobeScene, type SpatialFocusKind } from "./GlobeScene";

export interface FocusTarget {
  kind: SpatialFocusKind;
  coordinates: LonLat;
  nonce: number;
  distance?: number;
}

export interface PeriodCoordinateRenderState {
  status: "loading" | "updating" | "ready" | "unsupported" | "error" | null;
  requestedAgeMa?: number;
  stagedAgeMa?: number;
  displayedAgeMa?: number;
  resolvedVertices?: number;
  unsupportedVertices?: number;
}

export interface GlobeViewProps {
  snapshot: WorldSnapshot | null;
  temporalSurface?: TemporalSurface;
  temporalCountries?: TemporalCountryReferences;
  temporalPoiCoordinates?: Readonly<Record<string, LonLat>>;
  temporalPoiAgeMa?: number;
  temporalEnvironment?: WorldSnapshot["environment"];
  layers: LayerVisibility;
  selectedPoiId: string | null;
  onSelectPoi: (id: string) => void;
  onSelectSurface: (coordinates: LonLat) => void;
  onStats?: (stats: GlobeStats) => void;
  onPeriodCoordinateState?: (state: PeriodCoordinateRenderState) => void;
  focusTarget: FocusTarget | null;
  resetNonce?: number;
  autoRotate?: boolean;
  quality?: "auto" | "high" | "low";
  verticalExaggeration?: number;
  surfaceMode?: "surface" | "seafloor";
}

function temporalApplicationKey(
  surface: TemporalSurface | undefined,
  snapshot: WorldSnapshot | null,
  environment: WorldSnapshot["environment"] | undefined,
): string {
  const resolvedEnvironment = environment ?? snapshot?.environment;
  return [
    surface?.intervalId ?? snapshot?.id ?? "none",
    surface?.fraction ?? 0,
    surface?.requestedAgeMa ?? snapshot?.requestedAgeMa ?? snapshot?.ageMa ?? 0,
    resolvedEnvironment?.iceLatitude ?? 90,
    resolvedEnvironment?.vegetation ?? 0,
    resolvedEnvironment?.temperatureC ?? "",
    resolvedEnvironment?.stage ?? "",
    resolvedEnvironment?.oceanCoverage ?? "",
    resolvedEnvironment?.cloudCover ?? "",
    resolvedEnvironment?.atmosphereOpacity ?? "",
    resolvedEnvironment?.haze ?? "",
    resolvedEnvironment?.iceIntensity ?? "",
    resolvedEnvironment?.biomeStage ?? "",
  ].join("|");
}

export function GlobeView({
  snapshot,
  temporalSurface,
  temporalCountries,
  temporalPoiCoordinates,
  temporalPoiAgeMa,
  temporalEnvironment,
  layers,
  selectedPoiId,
  onSelectPoi,
  onSelectSurface,
  onStats,
  onPeriodCoordinateState,
  focusTarget,
  resetNonce,
  autoRotate = true,
  quality = "auto",
  verticalExaggeration = 8,
  surfaceMode = "surface",
}: GlobeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const installedSnapshotKey = useRef<string | null>(null);
  const appliedTemporalKey = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const latestProps = useRef({
    snapshot,
    temporalSurface,
    temporalCountries,
    temporalPoiCoordinates,
    temporalPoiAgeMa,
    temporalEnvironment,
    layers,
    selectedPoiId,
    onSelectPoi,
    onSelectSurface,
    onStats,
    onPeriodCoordinateState,
    focusTarget,
    resetNonce,
    autoRotate,
    quality,
    verticalExaggeration,
    surfaceMode,
  });
  latestProps.current = {
    snapshot,
    temporalSurface,
    temporalCountries,
    temporalPoiCoordinates,
    temporalPoiAgeMa,
    temporalEnvironment,
    layers,
    selectedPoiId,
    onSelectPoi,
    onSelectSurface,
    onStats,
    onPeriodCoordinateState,
    focusTarget,
    resetNonce,
    autoRotate,
    quality,
    verticalExaggeration,
    surfaceMode,
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;
    let active = true;
    let created: GlobeScene | null = null;
    let coordinateObserver: MutationObserver | null = null;
    void GlobeScene.create(mount, onSelectPoi, onSelectSurface, onStats, quality)
      .then((scene) => {
        if (!active) {
          scene.dispose();
          return;
        }
        created = scene;
        sceneRef.current = scene;
        const canvas = mount.querySelector("canvas");
        if (canvas !== null) {
          const publishCoordinateState = () => {
            const numeric = (name: string) => {
              const raw = canvas.getAttribute(name);
              if (raw === null) return undefined;
              const value = Number(raw);
              return Number.isFinite(value) ? value : undefined;
            };
            const rawStatus = canvas.getAttribute("data-period-coordinate-status");
            latestProps.current.onPeriodCoordinateState?.({
              status: rawStatus === "loading" || rawStatus === "updating" || rawStatus === "ready" ||
                  rawStatus === "unsupported" || rawStatus === "error" ? rawStatus : null,
              requestedAgeMa: numeric("data-period-coordinate-requested-age-ma"),
              stagedAgeMa: numeric("data-period-coordinate-staged-age-ma"),
              displayedAgeMa: numeric("data-period-coordinate-displayed-age-ma"),
              resolvedVertices: numeric("data-period-coordinate-resolved-vertices"),
              unsupportedVertices: numeric("data-period-coordinate-unsupported-vertices"),
            });
          };
          coordinateObserver = new MutationObserver(publishCoordinateState);
          coordinateObserver.observe(canvas, { attributes: true, attributeFilter: [
            "data-period-coordinate-status", "data-period-coordinate-requested-age-ma",
            "data-period-coordinate-staged-age-ma",
            "data-period-coordinate-displayed-age-ma", "data-period-coordinate-resolved-vertices",
            "data-period-coordinate-unsupported-vertices",
          ] });
          publishCoordinateState();
        }
        const current = latestProps.current;
        scene.setCallbacks(current.onSelectPoi, current.onSelectSurface, current.onStats);
        scene.setSurfaceMode(current.surfaceMode);
        scene.setVerticalExaggeration(current.verticalExaggeration);
        scene.setSnapshot(current.snapshot);
        installedSnapshotKey.current = current.temporalSurface?.intervalId ?? current.snapshot?.id ?? null;
        scene.setTemporalFraction(
          current.temporalSurface?.fraction ?? 0,
          current.temporalSurface?.requestedAgeMa ?? current.snapshot?.requestedAgeMa ?? current.snapshot?.ageMa ?? 0,
          current.temporalEnvironment ?? current.snapshot?.environment ?? {
            iceLatitude: 90,
            vegetation: 0,
          },
        );
        appliedTemporalKey.current = temporalApplicationKey(
          current.temporalSurface,
          current.snapshot,
          current.temporalEnvironment,
        );
        scene.setTemporalCountries(current.temporalCountries);
        scene.setTemporalPois(
          current.temporalPoiCoordinates,
          current.temporalPoiAgeMa ?? current.snapshot?.requestedAgeMa ?? current.snapshot?.ageMa ?? 0,
        );
        scene.setLayers(current.layers);
        scene.setSelectedPoi(current.selectedPoiId);
        scene.setAutoRotate(current.autoRotate);
        scene.setQuality(current.quality);
        if (current.focusTarget !== null) {
          scene.focus(
            current.focusTarget.coordinates,
            current.focusTarget.distance,
            current.focusTarget.kind,
          );
        } else if (current.resetNonce !== undefined) scene.resetCamera();
      })
      .catch((error: unknown) => {
        if (active) {
          mount.dataset.rendererError =
            error instanceof Error ? error.message : "Unable to initialize the globe";
          setRenderError(mount.dataset.rendererError);
          latestProps.current.onStats?.({
            fps: 0,
            backend: "Unavailable",
            detail: "none",
            status: mount.dataset.rendererError,
          });
          console.error(error);
        }
      });
    return () => {
      active = false;
      coordinateObserver?.disconnect();
      created?.dispose();
      if (sceneRef.current === created) sceneRef.current = null;
    };
    // Renderer lifetime follows the mount; later props are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setCallbacks(onSelectPoi, onSelectSurface, onStats);
  }, [onSelectPoi, onSelectSurface, onStats]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    const nextKey = temporalSurface?.intervalId ?? snapshot?.id ?? null;
    if (installedSnapshotKey.current !== nextKey) {
      scene.setSnapshot(snapshot);
      installedSnapshotKey.current = nextKey;
    }
    const nextTemporalKey = temporalApplicationKey(temporalSurface, snapshot, temporalEnvironment);
    if (appliedTemporalKey.current === nextTemporalKey) return;
    scene.setTemporalFraction(
      temporalSurface?.fraction ?? 0,
      temporalSurface?.requestedAgeMa ?? snapshot?.requestedAgeMa ?? snapshot?.ageMa ?? 0,
      temporalEnvironment ?? snapshot?.environment ?? { iceLatitude: 90, vegetation: 0 },
    );
    appliedTemporalKey.current = nextTemporalKey;
  }, [snapshot, temporalEnvironment, temporalSurface]);

  useEffect(() => {
    sceneRef.current?.setTemporalCountries(temporalCountries);
  }, [temporalCountries]);

  useEffect(() => {
    sceneRef.current?.setTemporalPois(
      temporalPoiCoordinates,
      temporalPoiAgeMa ?? snapshot?.requestedAgeMa ?? snapshot?.ageMa ?? 0,
    );
  }, [snapshot?.ageMa, snapshot?.requestedAgeMa, temporalPoiAgeMa, temporalPoiCoordinates]);

  useEffect(() => {
    sceneRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    sceneRef.current?.setSelectedPoi(selectedPoiId);
  }, [selectedPoiId]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    sceneRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    sceneRef.current?.setVerticalExaggeration(verticalExaggeration);
  }, [verticalExaggeration]);

  useEffect(() => {
    if (focusTarget === null) sceneRef.current?.clearFocus();
    else sceneRef.current?.focus(focusTarget.coordinates, focusTarget.distance, focusTarget.kind);
  }, [focusTarget]);

  useEffect(() => {
    sceneRef.current?.setSurfaceMode(surfaceMode);
  }, [surfaceMode]);

  useEffect(() => {
    if (resetNonce !== undefined) sceneRef.current?.resetCamera();
  }, [resetNonce]);

  return (
    <div
      ref={mountRef}
      data-testid="globe-view"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {renderError !== null ? (
        <p
          role="alert"
          style={{
            position: "absolute",
            inset: "50% auto auto 50%",
            margin: 0,
            maxWidth: "28rem",
            transform: "translate(-50%, -50%)",
            color: "#dbe8e7",
            textAlign: "center",
          }}
        >
          {renderError}
        </p>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { GlobeStats, LayerVisibility, LonLat, WorldSnapshot } from "../data";
import { GlobeScene, type SpatialFocusKind } from "./GlobeScene";

export interface FocusTarget {
  kind: SpatialFocusKind;
  coordinates: LonLat;
  nonce: number;
  distance?: number;
}

export interface GlobeViewProps {
  snapshot: WorldSnapshot | null;
  layers: LayerVisibility;
  selectedPoiId: string | null;
  onSelectPoi: (id: string) => void;
  onSelectSurface: (coordinates: LonLat) => void;
  onStats?: (stats: GlobeStats) => void;
  focusTarget: FocusTarget | null;
  resetNonce?: number;
  autoRotate?: boolean;
  quality?: "auto" | "high" | "low";
  verticalExaggeration?: number;
  surfaceMode?: "surface" | "seafloor";
}

export function GlobeView({
  snapshot,
  layers,
  selectedPoiId,
  onSelectPoi,
  onSelectSurface,
  onStats,
  focusTarget,
  resetNonce,
  autoRotate = true,
  quality = "auto",
  verticalExaggeration = 8,
  surfaceMode = "surface",
}: GlobeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const latestProps = useRef({
    snapshot,
    layers,
    selectedPoiId,
    onSelectPoi,
    onSelectSurface,
    onStats,
    focusTarget,
    resetNonce,
    autoRotate,
    quality,
    verticalExaggeration,
    surfaceMode,
  });
  latestProps.current = {
    snapshot,
    layers,
    selectedPoiId,
    onSelectPoi,
    onSelectSurface,
    onStats,
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
    void GlobeScene.create(mount, onSelectPoi, onSelectSurface, onStats, quality)
      .then((scene) => {
        if (!active) {
          scene.dispose();
          return;
        }
        created = scene;
        sceneRef.current = scene;
        const current = latestProps.current;
        scene.setCallbacks(current.onSelectPoi, current.onSelectSurface, current.onStats);
        scene.setSurfaceMode(current.surfaceMode);
        scene.setVerticalExaggeration(current.verticalExaggeration);
        scene.setSnapshot(current.snapshot);
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
    sceneRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

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

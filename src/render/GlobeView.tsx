import { useEffect, useRef, useState } from "react";
import type {
  GlobeStats,
  LayerVisibility,
  LonLat,
  WorldSnapshot,
} from "../data";
import { GlobeScene, type SpatialFocusKind } from "./GlobeScene";
import type { MaterialAddress, PreparedCaoRevision } from "../reconstruction";

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
  caoRevision?: PreparedCaoRevision | null;
  snapshot: WorldSnapshot | null;
  layers: LayerVisibility;
  selectedPoiId: string | null;
  onSelectPoi: (id: string) => void;
  onSelectSurface: (coordinates: LonLat, address?: MaterialAddress) => void;
  onStats?: (stats: GlobeStats) => void;
  onPeriodCoordinateState?: (state: PeriodCoordinateRenderState) => void;
  focusTarget: FocusTarget | null;
  resetNonce?: number;
  autoRotate?: boolean;
  quality?: "auto" | "high" | "low";
  verticalExaggeration?: number;
}

export function GlobeView({
  caoRevision = null,
  snapshot,
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
}: GlobeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const latestProps = useRef({
    caoRevision,
    snapshot,
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
  });
  latestProps.current = {
    caoRevision,
    snapshot,
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
        scene.setCaoFoundationStateCallback((state) => latestProps.current.onPeriodCoordinateState?.({
          status: state.status,
          requestedAgeMa: state.requestedAgeMa ?? undefined,
          displayedAgeMa: state.displayedAgeMa ?? undefined,
          resolvedVertices: state.resolvedVertices,
        }));
        const current = latestProps.current;
        scene.setCallbacks(current.onSelectPoi, current.onSelectSurface, current.onStats);
        scene.setVerticalExaggeration(current.verticalExaggeration);
        scene.setPreparedCaoRevision(current.caoRevision);
        scene.setEditorialSnapshot(current.snapshot);
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
          latestProps.current.caoRevision?.release();
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
      created?.setCaoFoundationStateCallback(undefined);
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
    if (scene === null) {
      return () => {
        // A superseded revision that never reached a scene still owns a
        // runtime lease. release() is idempotent for the renderer handoff.
        if (sceneRef.current === null) caoRevision?.release();
      };
    }
    scene.setPreparedCaoRevision(caoRevision);
    return undefined;
  }, [caoRevision]);

  useEffect(() => {
    sceneRef.current?.setEditorialSnapshot(snapshot);
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

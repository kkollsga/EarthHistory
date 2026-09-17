import { useEffect, useRef, useState } from "react";
import type {
  GlobeStats,
  LayerVisibility,
  LonLat,
  WorldSnapshot,
} from "../data";
import { GlobeScene, type PalaeoIntervalPreloadSource, type SpatialFocusKind } from "./GlobeScene";
import type { CaoMotionFrame, CaoPalaeoIntervalFrame, MaterialAddress, PreparedCaoPalaeoInterval,
  PreparedCaoRevision } from "../reconstruction";
import { chartPickStateFromMotionFrame } from "../reconstruction";

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
  caoMotionFrame?: CaoMotionFrame | null;
  caoWithheld?: boolean;
  /** One prepared Cao 2017 map interval, or null while the mode is off or falling back. */
  palaeoInterval?: PreparedCaoPalaeoInterval | null;
  /**
   * Called with the scene's own reason when a prepared interval is handed over
   * and the scene refuses to publish it. Without it the owner of the interval
   * keeps believing the map is on screen when nothing is.
   */
  onPalaeoPublicationFailed?: (reason: string) => void;
  /** Re-pose of the published interval at a new age inside the same map. */
  palaeoFrame?: CaoPalaeoIntervalFrame | null;
  /**
   * Synchronous re-pose of the published interval from resident data, or null
   * where the age needs a fetch. Called inside the native retarget below so the
   * charts and the country outlines are posed on the same frame; the async
   * `palaeoFrame` above still carries every age this cannot answer.
   */
  evaluatePalaeoMotionNow?: (
    requestedAgeMa: number,
    publishedIntervalId: string | null,
  ) => CaoPalaeoIntervalFrame | null;
  /**
   * The engine's background interval walk, for the scene's idle pre-upload. A
   * scene given one uploads each prepared interval as a hidden GPU member while
   * the main thread is idle, so a first visit costs what a return visit costs.
   */
  palaeoPreloadSource?: PalaeoIntervalPreloadSource | null;
  /** Verified EHPT bytes; the scene decodes them against its own segment count. */
  palaeoToneBytes?: Uint8Array | null;
  palaeoToneTableIndex?: number;
  palaeoToneIntervalId?: string | null;
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
  caoMotionFrame = null,
  caoWithheld = false,
  palaeoInterval = null,
  onPalaeoPublicationFailed,
  palaeoFrame = null,
  evaluatePalaeoMotionNow,
  palaeoPreloadSource = null,
  palaeoToneBytes = null,
  palaeoToneTableIndex = -1,
  palaeoToneIntervalId = null,
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
    caoMotionFrame,
    caoWithheld,
    palaeoInterval,
    palaeoPreloadSource,
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
    caoMotionFrame,
    caoWithheld,
    palaeoInterval,
    palaeoPreloadSource,
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
        scene.setPreparedPalaeoInterval(current.palaeoInterval);
        scene.setPalaeoIntervalPreloadSource(current.palaeoPreloadSource);
        scene.setCaoFoundationWithheld(current.caoWithheld);
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
          latestProps.current.palaeoInterval?.release();
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

  // Clear a prior withheld flag before a recovered revision/frame publishes.
  useEffect(() => {
    sceneRef.current?.setCaoFoundationWithheld(caoWithheld);
  }, [caoWithheld]);

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
    const scene = sceneRef.current;
    if (scene === null || caoMotionFrame === null || caoRevision === null) return;
    const pick = chartPickStateFromMotionFrame(caoMotionFrame);
    const anchors = caoMotionFrame.anchorIds.flatMap((id) => {
      const resolved = caoMotionFrame.resolveAnchor(id);
      return resolved?.pose.support.kind === "supported" && resolved.pose.direction !== null
        ? [{ id, direction: resolved.pose.direction, address: resolved.pose.address }]
        : [];
    });
    scene.retargetCaoMotion(
      caoMotionFrame.paletteValues,
      caoMotionFrame.entryCount,
      caoMotionFrame.display.fraction,
      pick.chartPoses,
      pick.chartActive,
      caoMotionFrame.requestedAgeMa,
      caoMotionFrame.materialCorrections,
      anchors,
    );
    // Same age, same call stack, same rendered frame: the palaeo charts move
    // with the outlines instead of a commit behind them. A null answer is an
    // age whose interval or palette is still loading, which the interval pump
    // owns; it must never hold up the native retarget above.
    // The pose is an optional layer inside the native retarget's effect. It
    // must not be able to end the effect: a throw here escapes into React and
    // unmounts the scene, which takes the globe with it. It is caught, named in
    // the dataset, and the previous pose stands.
    try {
      const palaeoNow = evaluatePalaeoMotionNow?.(
        caoMotionFrame.requestedAgeMa, scene.publishedPalaeoInterval()) ?? null;
      if (palaeoNow !== null) scene.retargetPalaeoMotion(palaeoNow);
    } catch (error) {
      scene.notePalaeoMotionFallback(error instanceof Error ? error.message
        : "palaeo-coastline pose failed");
    }
  }, [caoMotionFrame, caoRevision, evaluatePalaeoMotionNow]);

  // The palaeo publication follows the same handoff rule as the native one: a
  // prepared interval that never reaches a scene still owns a runtime lease and
  // must release it, and `publish` releases the one that does.
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) {
      return () => {
        if (sceneRef.current === null) palaeoInterval?.release();
      };
    }
    // The publish itself runs at the top of the next frame, so the answer
    // arrives there too: this effect runs inside the age-change dispatch, and
    // the ~26 ms of publish work is exactly what must not run there.
    scene.setPreparedPalaeoInterval(palaeoInterval, (published) => {
      if (palaeoInterval !== null && published === null) {
        onPalaeoPublicationFailed?.(scene.palaeoFallbackReason()
          || "palaeo-coastline publication failed");
      }
    });
    return undefined;
    // `onPalaeoPublicationFailed` is a stable ref callback; re-running this
    // effect on its identity would re-publish the same interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palaeoInterval]);

  useEffect(() => {
    if (palaeoFrame === null) return;
    const scene = sceneRef.current;
    if (scene === null) return;
    // Same rule as the synchronous pose above: the asynchronous retarget is one
    // frame of an optional layer and never a reason to unmount the scene.
    try {
      scene.retargetPalaeoMotion(palaeoFrame);
    } catch (error) {
      scene.notePalaeoMotionFallback(error instanceof Error ? error.message
        : "palaeo-coastline pose failed");
    }
  }, [palaeoFrame]);

  // The scene keeps the subscription for as long as it is given one; the
  // unsubscribe is the scene's own, taken again on every source change.
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return undefined;
    scene.setPalaeoIntervalPreloadSource(palaeoPreloadSource);
    return () => { sceneRef.current?.setPalaeoIntervalPreloadSource(null); };
  }, [palaeoPreloadSource]);

  useEffect(() => {
    sceneRef.current?.setPalaeoOutlineTones(
      palaeoToneBytes, palaeoToneTableIndex, palaeoToneIntervalId);
  }, [palaeoToneBytes, palaeoToneTableIndex, palaeoToneIntervalId]);

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

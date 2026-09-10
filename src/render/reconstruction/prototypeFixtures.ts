import type { QuaternionWxyz, UnitDirection } from "../../reconstruction/arithmetic";
import type { ForwardPatchControls, ForwardPatchData } from "./patchGeometry";
import { evaluateForwardPatchVertexAt } from "./picking";

export const IDENTITY_QUATERNION: QuaternionWxyz = [1, 0, 0, 0];

function direction(longitudeRadians: number, latitudeRadians: number): UnitDirection {
  const cosLatitude = Math.cos(latitudeRadians);
  return [
    cosLatitude * Math.cos(longitudeRadians),
    cosLatitude * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians),
  ];
}

interface Strip {
  startWest: number;
  startEast: number;
  endWest: number;
  endEast: number;
  materialId: number;
  color: readonly [number, number, number];
  activationStart: number;
  activationEnd: number;
  westSeamIds: readonly [number, number];
  eastSeamIds: readonly [number, number];
}

export function createSyntheticEventFrontPatch(
  event: "ridge-birth" | "subduction-consumption",
  centerLongitudeRadians = 0,
): ForwardPatchData {
  const open = event === "ridge-birth" ? 1 : 0;
  const startGap = open ? 0 : 0.08;
  const endGap = open ? 0.08 : 0;
  const startActivation = open ? 0 : 1;
  const endActivation = open ? 1 : 0;
  const strips: Strip[] = [
    {
      startWest: -0.18, startEast: -startGap, endWest: -0.18, endEast: -endGap,
      materialId: 1, color: [0.46, 0.32, 0.16], activationStart: 1, activationEnd: 1,
      westSeamIds: [0, 0], eastSeamIds: [101, 102],
    },
    {
      startWest: -startGap, startEast: startGap, endWest: -endGap, endEast: endGap,
      materialId: 2, color: [0.05, 0.28, 0.55],
      activationStart: startActivation, activationEnd: endActivation,
      westSeamIds: [101, 102], eastSeamIds: [103, 104],
    },
    {
      startWest: startGap, startEast: 0.18, endWest: endGap, endEast: 0.18,
      materialId: 3, color: [0.37, 0.43, 0.18], activationStart: 1, activationEnd: 1,
      westSeamIds: [103, 104], eastSeamIds: [0, 0],
    },
  ];
  const starts: number[] = [];
  const ends: number[] = [];
  const colors: number[] = [];
  const poseModes: number[] = [];
  const activationStart: number[] = [];
  const activationEnd: number[] = [];
  const seamIds: number[] = [];
  const materialIds: number[] = [];
  const indices: number[] = [];
  const latitudes = [-0.10, 0.10] as const;
  for (const strip of strips) {
    const base = poseModes.length;
    const startLongitudes = [strip.startWest, strip.startEast] as const;
    const endLongitudes = [strip.endWest, strip.endEast] as const;
    for (let latitudeIndex = 0; latitudeIndex < 2; latitudeIndex += 1) {
      for (let longitudeIndex = 0; longitudeIndex < 2; longitudeIndex += 1) {
        starts.push(...direction(centerLongitudeRadians + startLongitudes[longitudeIndex], latitudes[latitudeIndex]));
        ends.push(...direction(centerLongitudeRadians + endLongitudes[longitudeIndex], latitudes[latitudeIndex]));
        colors.push(...strip.color);
        poseModes.push(1);
        activationStart.push(strip.activationStart);
        activationEnd.push(strip.activationEnd);
        seamIds.push(longitudeIndex === 0
          ? strip.westSeamIds[latitudeIndex]
          : strip.eastSeamIds[latitudeIndex]);
        materialIds.push(strip.materialId);
      }
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const vertexCount = poseModes.length;
  return {
    id: `synthetic-${event}`,
    referenceDirections: new Float32Array(starts),
    deformingDirectionsStart: new Float32Array(starts),
    deformingDirectionsEnd: new Float32Array(ends),
    poseModes: new Float32Array(poseModes),
    displayHeightsStartMetres: new Float32Array(vertexCount),
    displayHeightsEndMetres: new Float32Array(vertexCount),
    activationStart: new Float32Array(activationStart),
    activationEnd: new Float32Array(activationEnd),
    baseColors: new Float32Array(colors),
    seamIds: new Uint32Array(seamIds),
    materialIds: new Uint32Array(materialIds),
    indices: new Uint32Array(indices),
    evidence: "synthetic-topology",
  };
}

export function assertCoincidentSeams(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
  tolerance = 1e-6,
): void {
  const positions = new Map<number, UnitDirection>();
  for (let index = 0; index < patch.seamIds.length; index += 1) {
    const seamId = patch.seamIds[index]!;
    if (seamId === 0) continue;
    const position = evaluateForwardPatchVertexAt(patch, controls, index);
    const first = positions.get(seamId);
    if (!first) {
      positions.set(seamId, position);
      continue;
    }
    if (Math.hypot(
      position[0] - first[0],
      position[1] - first[1],
      position[2] - first[2],
    ) > tolerance) {
      throw new Error(`non-coincident event seam ${seamId}`);
    }
  }
}

export function eventStripWidth(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
): number {
  const west = evaluateForwardPatchVertexAt(patch, controls, 4);
  const east = evaluateForwardPatchVertexAt(patch, controls, 5);
  return Math.hypot(west[0] - east[0], west[1] - east[1], west[2] - east[2]);
}

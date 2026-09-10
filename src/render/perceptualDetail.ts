import { createNoise3D } from "simplex-noise";
import type { ModernClimateGroup, SurfaceStage } from "../data";

// This sampler adds synthetic material-scale variation only. Geographic data
// controls the broad surface; these values never establish a real landform.

export interface PerceptualDetailInput {
  longitude: number;
  latitude: number;
  elevationMetres: number;
  /** Optional broad source elevation for albedo style when a local relief patch is feathered. */
  materialElevationMetres?: number;
  slope: number;
  land: boolean;
  ice: number;
  climateGroup?: ModernClimateGroup;
  stage: SurfaceStage;
  tectonicInfluence: number;
  detail: "coarse" | "regional";
}

export interface PerceptualDetailSample {
  heightDeltaMetres: number;
  albedoMultiplier: [red: number, green: number, blue: number];
  mountainRockMix: number;
  mountainRockColor: [red: number, green: number, blue: number];
  roughnessDelta: number;
}

export interface PerceptualDetailSampler {
  /** Consume each result before the next call; the allocation-free sample view is reused. */
  sample(input: PerceptualDetailInput): PerceptualDetailSample;
  retainedTableBytes: number;
}

export const PERCEPTUAL_DETAIL_TABLE_BYTE_LIMIT = 16 * 1024;

// simplex-noise 4.0.3 retains one 512-byte permutation and three 512-entry
// Float64 gradient tables for a 3D sampler. One sampler is shared by all terms.
const RETAINED_TABLE_BYTES = 512 + 3 * 512 * Float64Array.BYTES_PER_ELEMENT;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Highest spatial frequency that still places roughly two texels across one
 * noise feature. This is a synthesis filter, not a statement about source
 * resolution.
 */
export function perceptualDetailFrequencyLimit(detail: "coarse" | "regional"): number {
  // One profile is shared by every tile in a detail mode, so a direction on a
  // mixed-LOD edge receives identical material values from both neighbours.
  return detail === "regional" ? 144 : 18.5;
}

/** Row zero is north because DataTexture.flipY maps UV v=1 to that row. */
export function satelliteMaterialLatitudeRadians(row: number, height: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(height) || height < 2 || row < 0 || row >= height) {
    throw new RangeError("Satellite material texture row is outside its grid");
  }
  return Math.PI / 2 - Math.PI * row / (height - 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

/** Apply the shared mountain-only tone without allocating a color per vertex. */
export function perceptualMaterialChannel(
  base: number,
  sample: PerceptualDetailSample,
  channel: 0 | 1 | 2,
  detailGain = 1,
): number {
  const detailed = base * (1 + (sample.albedoMultiplier[channel] - 1) * detailGain);
  return detailed * (1 - sample.mountainRockMix) +
    sample.mountainRockColor[channel] * sample.mountainRockMix;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stageTextureFactor(stage: SurfaceStage): number {
  switch (stage) {
    case "accretion": return 0.32;
    case "giant-impact": return 0.45;
    case "magma-ocean": return 0.28;
    case "cooling-crust": return 0.82;
    case "growing-oceans": return 0.66;
    case "microbial-world": return 0.72;
    default: return 1;
  }
}

function climateTextureFactor(group: ModernClimateGroup | undefined): number {
  switch (group) {
    case "desert": return 0.62;
    case "steppe": return 0.78;
    case "frost": return 0.26;
    case "tundra": return 0.48;
    case "ocean": return 0.25;
    default: return 1;
  }
}

export function createPerceptualDetailSampler(seed: string): PerceptualDetailSampler {
  const noise = createNoise3D(seededRandom(hashString(seed)));
  const result: PerceptualDetailSample = {
    heightDeltaMetres: 0,
    albedoMultiplier: [1, 1, 1],
    mountainRockMix: 0,
    mountainRockColor: [0.26, 0.24, 0.22],
    roughnessDelta: 0,
  };

  return {
    retainedTableBytes: RETAINED_TABLE_BYTES,
    sample(input) {
      const longitude = Number.isFinite(input.longitude) ? input.longitude : 0;
      const latitude = clamp(Number.isFinite(input.latitude) ? input.latitude : 0, -90, 90);
      const lon = longitude * DEG_TO_RAD;
      const lat = latitude * DEG_TO_RAD;
      const cosLat = Math.cos(lat);
      const x = cosLat * Math.cos(lon);
      const y = Math.sin(lat);
      const z = cosLat * Math.sin(lon);

      // Warp in Cartesian sphere space so both sides of the antimeridian share
      // identical inputs. Offset samples provide independent directions without
      // allocating secondary noise samplers or per-sample vectors.
      const warpA = noise(x * 2.7 + 17.3, y * 2.7 - 9.7, z * 2.7 + 4.1);
      const warpB = noise(x * 2.7 - 23.9, y * 2.7 + 12.7, z * 2.7 - 18.1);
      const warp = 0.018;
      const warpedX = x + warpA * warp;
      const warpedY = y + warpB * warp;
      const warpedZ = z + (warpA - warpB) * warp * 0.7;

      // Use named, separated scales instead of an open-ended octave stack.
      // The broad bands vary regional material tone. Ridge and grain bands
      // appear only when both the destination texture and sourced ruggedness
      // can support them.
      const frequencyLimit = perceptualDetailFrequencyLimit(input.detail);
      const macro = noise(warpedX * 4.2, warpedY * 4.2, warpedZ * 4.2);
      const regional = frequencyLimit >= 9.1
        ? noise(warpedX * 9.1, warpedY * 9.1, warpedZ * 9.1)
        : macro;
      const terrain = frequencyLimit >= 18.5
        ? noise(warpedX * 18.5, warpedY * 18.5, warpedZ * 18.5)
        : regional;
      const slope = clamp(Number.isFinite(input.slope) ? input.slope : 0, 0, 1);
      const tectonic = clamp(
        Number.isFinite(input.tectonicInfluence) ? input.tectonicInfluence : 0,
        0,
        1,
      );
      const ice = clamp(Number.isFinite(input.ice) ? input.ice : 0, 0, 1);
      const ruggedness = clamp(slope * 0.68 + tectonic * 0.48, 0, 1);
      const ridgeNoise = frequencyLimit >= 36.5
        ? noise(warpedX * 36.5, warpedY * 36.5, warpedZ * 36.5)
        : terrain;
      const grain = input.detail === "regional" && frequencyLimit >= 144
        ? noise(warpedX * 144, warpedY * 144, warpedZ * 144)
        : ridgeNoise;
      const broadRidge = (1 - Math.abs(terrain)) * 2 - 1;
      const fineRidge = (1 - Math.abs(ridgeNoise)) * 2 - 1;
      const grainRidge = (1 - Math.abs(grain)) * 2 - 1;
      // Height identifies broad mountain-chain interiors even where the 1°
      // source DEM has a locally smooth plateau. Local source relief still
      // activates lower ranges. Both terms are continuous, use physical source
      // metres before visual exaggeration, and are zero over water.
      const styleElevation = input.materialElevationMetres ?? input.elevationMetres;
      const positiveElevation = input.land ? Math.max(0, styleElevation) : 0;
      const heightSupportedMountain = smoothstep(550, 3_200, positiveElevation);
      const locallyRuggedMountain = smoothstep(
        input.detail === "regional" ? 0.035 : 0.12,
        input.detail === "regional" ? 0.4 : 0.55,
        ruggedness,
      );
      const mountainStructure = input.land
        ? 1 - (1 - locallyRuggedMountain) * (1 - heightSupportedMountain * 0.94)
        : 0;
      // Higher chains shift smoothly from rounded broad folds toward a denser
      // nested ridge/valley signal. The finest term remains within the shared
      // regional frequency cap, so mixed LOD neighbours sample the same field.
      const peakHierarchy = smoothstep(900, 4_200, positiveElevation);
      const ridge = input.detail === "regional"
        ? broadRidge * (0.62 - peakHierarchy * 0.3) + fineRidge * 0.28 +
          grainRidge * (0.1 + peakHierarchy * 0.3)
        : broadRidge;
      const coherent = macro * 0.54 + regional * 0.3 + terrain * 0.16;
      const terrainSignal = clamp(
        regional * (0.7 - mountainStructure * 0.18) +
          ridge * mountainStructure * (input.detail === "regional" ? 0.58 : 0.08),
        -1,
        1,
      );

      const heightLimit = input.detail === "regional" ? 480 : 75;
      const landFactor = input.land
        ? input.detail === "regional"
          ? 0.012 + slope * 0.2 + tectonic * 0.14 +
            mountainStructure * (0.78 + peakHierarchy * 0.72)
          : 0.018 + slope * 0.28 + tectonic * 0.18 +
            mountainStructure * (0.36 + peakHierarchy * 0.38)
        : 0.025;
      const elevationFactor = input.land
        ? 1 + clamp(Math.max(0, input.elevationMetres) / 7000, 0, 1) * 0.08
        : 1;
      const materialFactor = climateTextureFactor(input.climateGroup);
      const frozenFactor = 1 - ice * 0.84;
      const stageFactor = stageTextureFactor(input.stage);
      const height = terrainSignal * heightLimit * landFactor * elevationFactor * materialFactor * frozenFactor * stageFactor;
      result.heightDeltaMetres = clamp(height, -heightLimit, heightLimit);

      const albedoLimit = input.detail === "regional" ? 0.14 : 0.11;
      const surfaceFactor = (input.land ? 1 : 0.28) * materialFactor * (1 - ice * 0.76) * stageFactor;
      const mountainExposure = mountainStructure * (0.58 + peakHierarchy * 0.42) *
        (1 - ice * 0.9) * materialFactor * stageFactor;
      const ridgeColor = ridge * mountainExposure * (input.detail === "regional" ? 0.72 : 0.22);
      const colorSignal = (coherent + ridgeColor) * albedoLimit * surfaceFactor;
      const chroma = (warpA - warpB) * albedoLimit * surfaceFactor * 0.22;
      // Mountain rock is darker than vegetated lowland, while the ridge signal
      // leaves multiple coherent peaks and valleys legible in orbital light.
      // The slight channel separation reduces the old uniform olive cast.
      const rockDarkening = mountainExposure * (0.09 + peakHierarchy * 0.075);
      result.albedoMultiplier[0] = clamp(
        1 + colorSignal + chroma - rockDarkening * 0.88,
        0.72,
        1.18,
      );
      result.albedoMultiplier[1] = clamp(
        1 + colorSignal * 0.82 - chroma * 0.22 - rockDarkening,
        0.72,
        1.18,
      );
      result.albedoMultiplier[2] = clamp(
        1 + colorSignal * 0.63 - chroma * 0.55 - rockDarkening * 0.8,
        0.72,
        1.18,
      );
      result.mountainRockMix = clamp(
        mountainExposure * (0.46 + peakHierarchy * 0.36),
        0,
        0.76,
      );
      const rockTone = 0.78 + ridge * 0.32;
      result.mountainRockColor[0] = clamp(0.29 * rockTone, 0.11, 0.32);
      result.mountainRockColor[1] = clamp(0.255 * rockTone, 0.1, 0.29);
      result.mountainRockColor[2] = clamp(0.225 * rockTone, 0.09, 0.26);

      const roughnessLimit = input.detail === "regional" ? 0.12 : 0.07;
      const roughnessFactor = (input.land ? 0.35 + ruggedness * 0.65 : 0.22) * materialFactor;
      result.roughnessDelta = clamp(
        (terrain * (0.68 - mountainStructure * 0.22) +
          ridge * mountainStructure * 0.38 + grain * mountainStructure * 0.16) *
          roughnessLimit * roughnessFactor - ice * 0.012,
        -0.12,
        0.12,
      );
      return result;
    },
  };
}

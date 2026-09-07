import { createNoise3D } from "simplex-noise";
import type { ModernClimateGroup, SurfaceStage } from "../data";

// This sampler adds synthetic material-scale variation only. Geographic data
// controls the broad surface; these values never establish a real landform.

export interface PerceptualDetailInput {
  longitude: number;
  latitude: number;
  elevationMetres: number;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
      const warpA = noise(x * 3.1 + 17.3, y * 3.1 - 9.7, z * 3.1 + 4.1);
      const warpB = noise(x * 3.1 - 23.9, y * 3.1 + 12.7, z * 3.1 - 18.1);
      const warp = 0.085;
      const warpedX = x + warpA * warp;
      const warpedY = y + warpB * warp;
      const warpedZ = z + (warpA - warpB) * warp * 0.7;

      const octaves = input.detail === "regional" ? 5 : 3;
      let frequency = 17;
      let amplitude = 1;
      let weight = 0;
      let sum = 0;
      let fine = 0;
      for (let octave = 0; octave < octaves; octave += 1) {
        fine = noise(warpedX * frequency, warpedY * frequency, warpedZ * frequency);
        sum += fine * amplitude;
        weight += amplitude;
        frequency *= 2.07;
        amplitude *= 0.48;
      }
      const coherent = sum / weight;
      const slope = clamp(Number.isFinite(input.slope) ? input.slope : 0, 0, 1);
      const tectonic = clamp(
        Number.isFinite(input.tectonicInfluence) ? input.tectonicInfluence : 0,
        0,
        1,
      );
      const ice = clamp(Number.isFinite(input.ice) ? input.ice : 0, 0, 1);
      const ruggedness = clamp(slope * 0.68 + tectonic * 0.48, 0, 1);
      const ridge = (1 - Math.abs(fine)) * 2 - 1;
      const terrainSignal = clamp(coherent * (0.78 - ruggedness * 0.2) + ridge * ruggedness * 0.42, -1, 1);

      const heightLimit = input.detail === "regional" ? 250 : 100;
      const landFactor = input.land ? 0.12 + slope * 0.48 + tectonic * 0.32 : 0.04;
      const elevationFactor = input.land
        ? 1 + clamp(Math.max(0, input.elevationMetres) / 7000, 0, 1) * 0.08
        : 1;
      const materialFactor = climateTextureFactor(input.climateGroup);
      const frozenFactor = 1 - ice * 0.84;
      const stageFactor = stageTextureFactor(input.stage);
      const height = terrainSignal * heightLimit * landFactor * elevationFactor * materialFactor * frozenFactor * stageFactor;
      result.heightDeltaMetres = clamp(height, -heightLimit, heightLimit);

      const albedoLimit = input.detail === "regional" ? 0.105 : 0.058;
      const surfaceFactor = (input.land ? 1 : 0.28) * materialFactor * (1 - ice * 0.76) * stageFactor;
      const colorSignal = coherent * albedoLimit * surfaceFactor;
      const chroma = (warpA - warpB) * albedoLimit * surfaceFactor * 0.22;
      result.albedoMultiplier[0] = clamp(1 + colorSignal + chroma, 0.78, 1.18);
      result.albedoMultiplier[1] = clamp(1 + colorSignal * 0.82 - chroma * 0.22, 0.78, 1.18);
      result.albedoMultiplier[2] = clamp(1 + colorSignal * 0.63 - chroma * 0.55, 0.78, 1.18);

      const roughnessLimit = input.detail === "regional" ? 0.12 : 0.07;
      const roughnessFactor = (input.land ? 0.35 + ruggedness * 0.65 : 0.22) * materialFactor;
      result.roughnessDelta = clamp(
        (fine * 0.72 + coherent * 0.28) * roughnessLimit * roughnessFactor - ice * 0.012,
        -0.12,
        0.12,
      );
      return result;
    },
  };
}

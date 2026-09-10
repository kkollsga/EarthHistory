import {
  BufferAttribute,
  BufferGeometry,
} from "three";
import type { QuaternionWxyz } from "../../reconstruction/arithmetic";
import { assertQualifiedDeformingControls } from "./patchData";

export interface ForwardPatchData {
  readonly id: string;
  readonly referenceDirections: Float32Array;
  readonly deformingDirectionsStart: Float32Array;
  readonly deformingDirectionsEnd: Float32Array;
  readonly poseModes: Float32Array;
  readonly displayHeightsStartMetres: Float32Array;
  readonly displayHeightsEndMetres: Float32Array;
  readonly activationStart: Float32Array;
  readonly activationEnd: Float32Array;
  readonly baseColors: Float32Array;
  readonly seamIds: Uint32Array;
  readonly materialIds: Uint32Array;
  readonly indices: Uint32Array;
  readonly evidence: "actual-rigid-oracle" | "synthetic-topology";
}

export interface ForwardPatchControls {
  readonly motionStart: QuaternionWxyz;
  readonly motionEnd: QuaternionWxyz;
  readonly motionFraction: number;
  readonly displayFraction: number;
  readonly verticalExaggeration: number;
}

export function assertForwardPatchControls(controls: ForwardPatchControls): void {
  const quaternionLength = (quaternion: QuaternionWxyz): number => Math.hypot(...quaternion);
  const motionStartLength = quaternionLength(controls.motionStart);
  const motionEndLength = quaternionLength(controls.motionEnd);
  if (!Number.isFinite(motionStartLength) || !Number.isFinite(motionEndLength)
      || Math.abs(motionStartLength - 1) > 2e-6 || Math.abs(motionEndLength - 1) > 2e-6) {
    throw new Error("forward patch motion quaternions must be finite and unit length");
  }
  if (!Number.isFinite(controls.motionFraction) || controls.motionFraction < 0
      || controls.motionFraction > 1 || !Number.isFinite(controls.displayFraction)
      || controls.displayFraction < 0 || controls.displayFraction > 1) {
    throw new Error("forward patch fractions must be finite and in [0, 1]");
  }
  if (!Number.isFinite(controls.verticalExaggeration)
      || controls.verticalExaggeration < 1 || controls.verticalExaggeration > 30) {
    throw new Error("forward patch vertical exaggeration must be finite and in [1, 30]");
  }
}

export function forwardPatchByteLength(patch: ForwardPatchData): number {
  return patch.referenceDirections.byteLength
    + patch.deformingDirectionsStart.byteLength
    + patch.deformingDirectionsEnd.byteLength
    + patch.poseModes.byteLength
    + patch.displayHeightsStartMetres.byteLength
    + patch.displayHeightsEndMetres.byteLength
    + patch.activationStart.byteLength
    + patch.activationEnd.byteLength
    + patch.baseColors.byteLength
    + patch.seamIds.byteLength
    + patch.materialIds.byteLength
    + patch.indices.byteLength;
}

export function assertForwardPatchData(patch: ForwardPatchData): void {
  const vertexCount = patch.poseModes.length;
  if (!patch.id || vertexCount < 3 || patch.indices.length < 3 || patch.indices.length % 3 !== 0) {
    throw new Error("forward patch requires an id and indexed triangles");
  }
  const scalarArrays = [
    patch.displayHeightsStartMetres,
    patch.displayHeightsEndMetres,
    patch.activationStart,
    patch.activationEnd,
    patch.seamIds,
    patch.materialIds,
  ];
  if (scalarArrays.some((array) => array.length !== vertexCount)
      || patch.referenceDirections.length !== vertexCount * 3
      || patch.deformingDirectionsStart.length !== vertexCount * 3
      || patch.deformingDirectionsEnd.length !== vertexCount * 3
      || patch.baseColors.length !== vertexCount * 3
      || [...patch.indices].some((index) => index >= vertexCount)) {
    throw new Error("forward patch attribute length or index mismatch");
  }
  const finiteArrays = [
    patch.referenceDirections,
    patch.deformingDirectionsStart,
    patch.deformingDirectionsEnd,
    patch.poseModes,
    patch.displayHeightsStartMetres,
    patch.displayHeightsEndMetres,
    patch.activationStart,
    patch.activationEnd,
    patch.baseColors,
  ];
  if (finiteArrays.some((array) => [...array].some((value) => !Number.isFinite(value)))) {
    throw new Error("forward patch attributes must be finite");
  }
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3;
    const referenceLength = Math.hypot(
      patch.referenceDirections[offset]!,
      patch.referenceDirections[offset + 1]!,
      patch.referenceDirections[offset + 2]!,
    );
    if (Math.abs(referenceLength - 1) > 2e-6) {
      throw new Error("forward patch reference directions must be unit length");
    }
    if (patch.poseModes[index] !== 0 && patch.poseModes[index] !== 1) {
      throw new Error("forward patch pose mode must be 0 or 1");
    }
    if (patch.activationStart[index]! < 0 || patch.activationStart[index]! > 1
        || patch.activationEnd[index]! < 0 || patch.activationEnd[index]! > 1) {
      throw new Error("forward patch activation must be in [0, 1]");
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const color = patch.baseColors[offset + channel]!;
      if (color < 0 || color > 1) throw new Error("forward patch color must be in [0, 1]");
    }
  }
  for (let triangle = 0; triangle < patch.indices.length; triangle += 3) {
    const vertices = [patch.indices[triangle]!, patch.indices[triangle + 1]!, patch.indices[triangle + 2]!];
    for (const activation of [patch.activationStart, patch.activationEnd]) {
      const values = vertices.map((index) => activation[index]!);
      if (Math.max(...values) - Math.min(...values) > 1e-6) {
        throw new Error("forward patch lifecycle activation must be triangle-coherent");
      }
    }
  }
  assertQualifiedDeformingControls(
    patch.poseModes,
    patch.deformingDirectionsStart,
    patch.deformingDirectionsEnd,
  );
}

export function createForwardPatchGeometry(patch: ForwardPatchData): BufferGeometry {
  assertForwardPatchData(patch);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(patch.referenceDirections, 3));
  geometry.setAttribute("referenceDirection", new BufferAttribute(patch.referenceDirections, 3));
  geometry.setAttribute("deformingDirectionStart", new BufferAttribute(patch.deformingDirectionsStart, 3));
  geometry.setAttribute("deformingDirectionEnd", new BufferAttribute(patch.deformingDirectionsEnd, 3));
  geometry.setAttribute("poseMode", new BufferAttribute(patch.poseModes, 1));
  geometry.setAttribute("displayHeightStartMetres", new BufferAttribute(patch.displayHeightsStartMetres, 1));
  geometry.setAttribute("displayHeightEndMetres", new BufferAttribute(patch.displayHeightsEndMetres, 1));
  geometry.setAttribute("activationStart", new BufferAttribute(patch.activationStart, 1));
  geometry.setAttribute("activationEnd", new BufferAttribute(patch.activationEnd, 1));
  geometry.setAttribute("color", new BufferAttribute(patch.baseColors, 3));
  const index = patch.poseModes.length <= 65_535
    ? new Uint16Array(patch.indices)
    : patch.indices;
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

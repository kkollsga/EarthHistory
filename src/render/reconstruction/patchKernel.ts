import {
  gplatesToRendererDirection,
  radialHeightScale,
  rotateDirection,
  slerpQuaternion,
  type QuaternionWxyz,
  type ScalarOps,
  type UnitDirection,
} from "../../reconstruction/arithmetic";

export interface ForwardPatchVertexInput<T> {
  /** 0 selects rigid material; 1 selects compiler-qualified deformation endpoints. */
  readonly poseMode: T;
  readonly referenceDirection: UnitDirection<T>;
  readonly deformingDirectionStart: UnitDirection<T>;
  readonly deformingDirectionEnd: UnitDirection<T>;
  readonly motionStart: QuaternionWxyz<T>;
  readonly motionEnd: QuaternionWxyz<T>;
  readonly motionFraction: T;
  readonly displayHeightStartMetres: T;
  readonly displayHeightEndMetres: T;
  readonly displayFraction: T;
  readonly verticalExaggeration: T;
  readonly activationStart: T;
  readonly activationEnd: T;
}

export interface ForwardPatchVertexResult<T> {
  readonly gplatesDirection: UnitDirection<T>;
  readonly rendererDirection: UnitDirection<T>;
  readonly rendererPosition: UnitDirection<T>;
  readonly activation: T;
}

function mix<T, C>(ops: ScalarOps<T, C>, start: T, end: T, fraction: T): T {
  return ops.add(start, ops.mul(fraction, ops.sub(end, start)));
}

function normalizeDirection<T, C>(
  ops: ScalarOps<T, C>,
  value: UnitDirection<T>,
  fallback: UnitDirection<T>,
): UnitDirection<T> {
  const lengthSquared = ops.add(
    ops.add(ops.mul(value[0], value[0]), ops.mul(value[1], value[1])),
    ops.mul(value[2], value[2]),
  );
  const valid = ops.lessThan(ops.constant(1e-20), lengthSquared);
  const length = ops.sqrt(ops.select(valid, lengthSquared, ops.constant(1)));
  return value.map((component, index) => ops.select(
    valid,
    ops.div(component, length),
    fallback[index]!,
  )) as unknown as UnitDirection<T>;
}

/** One scientific pose/height formula consumed by the TSL and sparse CPU adapters. */
export function evaluateForwardPatchVertex<T, C>(
  ops: ScalarOps<T, C>,
  input: ForwardPatchVertexInput<T>,
): ForwardPatchVertexResult<T> {
  const rigidPose = slerpQuaternion(
    ops,
    input.motionStart,
    input.motionEnd,
    input.motionFraction,
  );
  const rigidDirection = rotateDirection(ops, rigidPose, input.referenceDirection);
  const deformingDirection = normalizeDirection(ops, [
    mix(ops, input.deformingDirectionStart[0], input.deformingDirectionEnd[0], input.motionFraction),
    mix(ops, input.deformingDirectionStart[1], input.deformingDirectionEnd[1], input.motionFraction),
    mix(ops, input.deformingDirectionStart[2], input.deformingDirectionEnd[2], input.motionFraction),
  ], input.referenceDirection);
  const deforming = ops.lessThan(ops.constant(0.5), input.poseMode);
  const gplatesDirection = rigidDirection.map((component, index) => (
    ops.select(deforming, deformingDirection[index]!, component)
  )) as unknown as UnitDirection<T>;
  const rendererDirection = gplatesToRendererDirection(ops, gplatesDirection);
  const heightMetres = mix(
    ops,
    input.displayHeightStartMetres,
    input.displayHeightEndMetres,
    input.displayFraction,
  );
  const scale = radialHeightScale(ops, heightMetres, input.verticalExaggeration);
  return {
    gplatesDirection,
    rendererDirection,
    rendererPosition: rendererDirection.map((component) => (
      ops.mul(component, scale)
    )) as unknown as UnitDirection<T>,
    activation: mix(ops, input.activationStart, input.activationEnd, input.displayFraction),
  };
}

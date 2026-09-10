export const EARTH_RADIUS_METRES = 6_371_000;
export const SLERP_NEAR_PARALLEL_COSINE = 0.999_999_5;

export type QuaternionWxyz<T = number> = readonly [w: T, x: T, y: T, z: T];
export type UnitDirection<T = number> = readonly [x: T, y: T, z: T];

/** Scalar operations shared by the number evaluator and renderer-node adapter. */
export interface ScalarOps<T, Condition = T> {
  constant(value: number): T;
  add(left: T, right: T): T;
  sub(left: T, right: T): T;
  mul(left: T, right: T): T;
  div(left: T, right: T): T;
  neg(value: T): T;
  sqrt(value: T): T;
  sin(value: T): T;
  acos(value: T): T;
  clamp(value: T, minimum: number, maximum: number): T;
  lessThan(left: T, right: T): Condition;
  select(condition: Condition, whenTrue: T, whenFalse: T): T;
}

export const numberScalarOps: ScalarOps<number> = {
  constant: (value) => value,
  add: (left, right) => left + right,
  sub: (left, right) => left - right,
  mul: (left, right) => left * right,
  div: (left, right) => left / right,
  neg: (value) => -value,
  sqrt: Math.sqrt,
  sin: Math.sin,
  acos: Math.acos,
  clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
  lessThan: (left, right) => left < right ? 1 : 0,
  select: (condition, whenTrue, whenFalse) => condition !== 0 ? whenTrue : whenFalse,
};

function dot4<T, C>(ops: ScalarOps<T, C>, left: QuaternionWxyz<T>, right: QuaternionWxyz<T>): T {
  return ops.add(ops.add(ops.mul(left[0], right[0]), ops.mul(left[1], right[1])),
    ops.add(ops.mul(left[2], right[2]), ops.mul(left[3], right[3])));
}

function normalize4<T, C>(ops: ScalarOps<T, C>, value: QuaternionWxyz<T>): QuaternionWxyz<T> {
  const length = ops.sqrt(dot4(ops, value, value));
  return value.map((component) => ops.div(component, length)) as unknown as QuaternionWxyz<T>;
}

export function inverseQuaternion<T, C>(ops: ScalarOps<T, C>, value: QuaternionWxyz<T>): QuaternionWxyz<T> {
  return [value[0], ops.neg(value[1]), ops.neg(value[2]), ops.neg(value[3])];
}

export function composeQuaternion<T, C>(
  ops: ScalarOps<T, C>, left: QuaternionWxyz<T>, right: QuaternionWxyz<T>,
): QuaternionWxyz<T> {
  const [aw, ax, ay, az] = left;
  const [bw, bx, by, bz] = right;
  return normalize4(ops, [
    ops.sub(ops.sub(ops.sub(ops.mul(aw, bw), ops.mul(ax, bx)), ops.mul(ay, by)), ops.mul(az, bz)),
    ops.add(ops.add(ops.mul(aw, bx), ops.mul(ax, bw)), ops.sub(ops.mul(ay, bz), ops.mul(az, by))),
    ops.add(ops.add(ops.mul(aw, by), ops.mul(ay, bw)), ops.sub(ops.mul(az, bx), ops.mul(ax, bz))),
    ops.add(ops.add(ops.mul(aw, bz), ops.mul(az, bw)), ops.sub(ops.mul(ax, by), ops.mul(ay, bx))),
  ]);
}

/** Pose at requested age relative to a nonzero authored/chart reference age. */
export function relativePoseQuaternion<T, C>(
  ops: ScalarOps<T, C>, totalAtRequested: QuaternionWxyz<T>, totalAtReference: QuaternionWxyz<T>,
): QuaternionWxyz<T> {
  return composeQuaternion(ops, totalAtRequested, inverseQuaternion(ops, totalAtReference));
}

export function slerpQuaternion<T, C>(
  ops: ScalarOps<T, C>, start: QuaternionWxyz<T>, rawEnd: QuaternionWxyz<T>, fraction: T,
): QuaternionWxyz<T> {
  const zero = ops.constant(0);
  const one = ops.constant(1);
  const signedDot = dot4(ops, start, rawEnd);
  const negative = ops.lessThan(signedDot, zero);
  const end = rawEnd.map((component) => ops.select(negative, ops.neg(component), component)) as unknown as QuaternionWxyz<T>;
  const cosine = ops.clamp(dot4(ops, start, end), -1, 1);
  const near = ops.lessThan(ops.constant(SLERP_NEAR_PARALLEL_COSINE), cosine);
  const linear = normalize4(ops, start.map((component, index) =>
    ops.add(component, ops.mul(fraction, ops.sub(end[index]!, component)))) as unknown as QuaternionWxyz<T>);
  const angle = ops.acos(cosine);
  // Every spherical operand uses a safe nonzero angle because shader/node
  // branches can be evaluated eagerly even when select returns the linear arm.
  const sphericalAngle = ops.select(near, one, angle);
  const denominator = ops.sin(sphericalAngle);
  const startScale = ops.div(ops.sin(ops.mul(ops.sub(one, fraction), sphericalAngle)), denominator);
  const endScale = ops.div(ops.sin(ops.mul(fraction, sphericalAngle)), denominator);
  const spherical = normalize4(ops, start.map((component, index) =>
    ops.add(ops.mul(startScale, component), ops.mul(endScale, end[index]!))) as unknown as QuaternionWxyz<T>);
  return spherical.map((component, index) => ops.select(near, linear[index]!, component)) as unknown as QuaternionWxyz<T>;
}

export function rotateDirection<T, C>(
  ops: ScalarOps<T, C>, quaternion: QuaternionWxyz<T>, direction: UnitDirection<T>,
): UnitDirection<T> {
  const [w, x, y, z] = quaternion;
  const [dx, dy, dz] = direction;
  const tx = ops.mul(ops.constant(2), ops.sub(ops.mul(y, dz), ops.mul(z, dy)));
  const ty = ops.mul(ops.constant(2), ops.sub(ops.mul(z, dx), ops.mul(x, dz)));
  const tz = ops.mul(ops.constant(2), ops.sub(ops.mul(x, dy), ops.mul(y, dx)));
  return [
    ops.add(dx, ops.add(ops.mul(w, tx), ops.sub(ops.mul(y, tz), ops.mul(z, ty)))),
    ops.add(dy, ops.add(ops.mul(w, ty), ops.sub(ops.mul(z, tx), ops.mul(x, tz)))),
    ops.add(dz, ops.add(ops.mul(w, tz), ops.sub(ops.mul(x, ty), ops.mul(y, tx)))),
  ];
}

export function radialHeightScale<T, C>(
  ops: ScalarOps<T, C>, heightMetres: T, exaggeration: T,
): T {
  return ops.add(ops.constant(1), ops.div(ops.mul(heightMetres, exaggeration), ops.constant(EARTH_RADIUS_METRES)));
}

/** The sole GPlates-to-Three axis convention: (x,y,z) -> (x,z,-y). */
export function gplatesToRendererDirection<T, C>(ops: ScalarOps<T, C>, direction: UnitDirection<T>): UnitDirection<T> {
  return [direction[0], direction[2], ops.neg(direction[1])];
}

/** Inverse of the sole axis convention: Three (x,y,z) -> GPlates (x,-z,y). */
export function rendererToGplatesDirection<T, C>(ops: ScalarOps<T, C>, direction: UnitDirection<T>): UnitDirection<T> {
  return [direction[0], ops.neg(direction[2]), direction[1]];
}

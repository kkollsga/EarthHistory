export type Vec3Tuple = readonly [number, number, number];

export interface SweptPositionSample {
  readonly direction: Vec3Tuple;
  readonly heightMetres: number;
}

export interface SweptBoundsConstraints {
  /** Maximum angular departure from the qualified samples. */
  readonly angularEnvelopeRadians: number;
  readonly minimumHeightMetres: number;
  readonly maximumHeightMetres: number;
  readonly maximumVerticalExaggeration: number;
  readonly maximumProceduralDisplacementMetres: number;
  readonly planetRadiusMetres: number;
}

export interface AxisAlignedBounds {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}

function normalized(direction: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new Error("swept-bound direction must be finite and non-zero");
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

/**
 * Bounds a compiler-qualified trajectory without reimplementing its pose model.
 * Callers provide endpoint and adaptive interior samples from the shared kernel,
 * plus the oracle-qualified angular remainder between those samples.
 */
export function computeSweptBounds(
  samples: readonly SweptPositionSample[],
  constraints: SweptBoundsConstraints,
): AxisAlignedBounds {
  if (samples.length < 2) {
    throw new Error("swept bounds require endpoints and any qualified interior samples");
  }
  const radius = finite(constraints.planetRadiusMetres, "planetRadiusMetres");
  const exaggeration = finite(
    constraints.maximumVerticalExaggeration,
    "maximumVerticalExaggeration",
  );
  const detail = Math.abs(finite(
    constraints.maximumProceduralDisplacementMetres,
    "maximumProceduralDisplacementMetres",
  ));
  const angularEnvelope = finite(
    constraints.angularEnvelopeRadians,
    "angularEnvelopeRadians",
  );
  if (!(radius > 0) || exaggeration < 1 || exaggeration > 30) {
    throw new Error("swept bounds require a positive radius and exaggeration in [1, 30]");
  }
  if (angularEnvelope < 0 || angularEnvelope > Math.PI) {
    throw new Error("angularEnvelopeRadians must be in [0, pi]");
  }

  const minHeight = Math.min(
    finite(constraints.minimumHeightMetres, "minimumHeightMetres"),
    ...samples.map((sample) => finite(sample.heightMetres, "sample.heightMetres")),
  );
  const maxHeight = Math.max(
    finite(constraints.maximumHeightMetres, "maximumHeightMetres"),
    ...samples.map((sample) => finite(sample.heightMetres, "sample.heightMetres")),
  );
  const radialOffsets = [
    minHeight,
    maxHeight,
    minHeight * exaggeration,
    maxHeight * exaggeration,
  ];
  const minRadius = Math.max(0, radius + Math.min(...radialOffsets) - detail);
  const maxRadius = radius + Math.max(...radialOffsets) + detail;
  if (!(maxRadius >= minRadius)) {
    throw new Error("swept radial envelope is invalid");
  }

  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const angularPadding = 2 * maxRadius * Math.sin(angularEnvelope / 2);

  for (const sample of samples) {
    const direction = normalized(sample.direction);
    for (let axis = 0; axis < 3; axis += 1) {
      const component = direction[axis];
      const low = component < 0 ? component * maxRadius : component * minRadius;
      const high = component < 0 ? component * minRadius : component * maxRadius;
      min[axis] = Math.min(min[axis], low - angularPadding);
      max[axis] = Math.max(max[axis], high + angularPadding);
    }
  }

  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
  };
}

export function boundsContainPoint(bounds: AxisAlignedBounds, point: Vec3Tuple): boolean {
  return point.every((value, axis) => (
    value >= bounds.min[axis] && value <= bounds.max[axis]
  ));
}

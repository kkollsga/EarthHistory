import type { UnitDirection } from "../../reconstruction/arithmetic";

function normalized(direction: UnitDirection): { direction: UnitDirection; length: number } | null {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length < 1e-10) return null;
  return { direction: [direction[0] / length, direction[1] / length, direction[2] / length], length };
}

/**
 * Validates only active deforming vertices. Rigid vertices may retain zeroed
 * deformation attributes because shader branches can evaluate eagerly.
 */
export function assertQualifiedDeformingControls(
  poseModes: ArrayLike<number>,
  starts: ArrayLike<number>,
  ends: ArrayLike<number>,
): void {
  if (starts.length !== poseModes.length * 3 || ends.length !== starts.length) {
    throw new Error("deforming controls length mismatch");
  }
  for (let index = 0; index < poseModes.length; index += 1) {
    if (poseModes[index]! < 0.5) continue;
    const offset = index * 3;
    const start = normalized([starts[offset]!, starts[offset + 1]!, starts[offset + 2]!]);
    const end = normalized([ends[offset]!, ends[offset + 1]!, ends[offset + 2]!]);
    if (!start || !end) throw new Error("active deforming direction must be finite and non-zero");
    if (Math.abs(start.length - 1) > 2e-6 || Math.abs(end.length - 1) > 2e-6) {
      throw new Error("active deforming directions must be unit length");
    }
    const dot = start.direction[0] * end.direction[0]
      + start.direction[1] * end.direction[1]
      + start.direction[2] * end.direction[2];
    if (dot < -0.999_999) {
      throw new Error("active deforming endpoints require a qualified non-antipodal path");
    }
  }
}

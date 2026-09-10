import type { QuaternionWxyz, UnitDirection } from "./arithmetic";

export interface FrameKey {
  modelId: string;
  modelVersion: string;
  absoluteFrameId: string;
  anchorPlateId: number;
  axisConvention: "gplates-x0e-y90e-znorth";
  rotationSha256: string;
  topologySha256: string;
}

export type SupportState =
  | { kind: "supported"; method: "compiled-rigid" | "compiled-deforming" }
  | { kind: "inactive"; reason: "unborn" | "consumed" | "not-yet-valid" | "expired" }
  | { kind: "conditional"; reason: "birth-bound" | "loss-bound"; intervalMa: readonly [number, number] }
  | { kind: "ambiguous"; candidateIds: readonly string[] }
  | { kind: "unsupported"; reason: "outside-domain" | "frame-mismatch" | "chart-mismatch" |
      "missing-motion" | "source-seam" | "invalid-address" };

export interface MaterialAddress {
  chartRevision: string;
  chartId: string;
  materialId: string;
  fragmentOrCohortId: string;
  cellOrTriangleId: number;
  localCoordinate:
    | { kind: "chart-direction"; directionAtReference: UnitDirection }
    | { kind: "barycentric"; weights: readonly [number, number, number] };
}

export interface MaterialLifecycle {
  validTimeMa: { oldest: number; youngest: number };
  birth?: { status: "confirmed" | "bounded"; intervalMa: readonly [number, number] };
  loss?: { status: "confirmed" | "bounded"; intervalMa: readonly [number, number] };
}

/** Geographic/surface evidence is independent of whether material can move. */
export type SurfaceEvidenceState =
  | { kind: "classified"; surfaceClass: "land" | "shallow-marine" | "deep-marine"; sourceIds: readonly string[] }
  | { kind: "unknown"; reason: string };

export interface MotionSample { ageMicroMa: number; quaternion: QuaternionWxyz }
export interface MotionInterval {
  catalogId: string;
  payloadSha256: string;
  chartRevision: string;
  frameIdentity: string;
  plateId: number;
  referenceAgeMa: number;
  youngestAgeMa: number;
  oldestAgeMa: number;
  samples: readonly MotionSample[];
}

export interface MaterialPose {
  address: MaterialAddress;
  requestedAgeMa: number;
  direction: UnitDirection | null;
  support: SupportState;
}

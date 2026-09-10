import { Vector4 } from "three";
import { DoubleSide, MeshBasicNodeMaterial } from "three/webgpu";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import {
  acos,
  add,
  attribute,
  clamp,
  div,
  float,
  lessThan,
  mul,
  negate,
  select,
  sin,
  sqrt,
  step,
  sub,
  uniform,
  vec3,
} from "three/tsl";
import type { QuaternionWxyz, ScalarOps, UnitDirection } from "../../reconstruction/arithmetic";
import { evaluateForwardPatchVertex } from "./patchKernel";
import { assertForwardPatchControls, assertForwardPatchData,
  type ForwardPatchData } from "./patchGeometry";

type TslScalar = Node<"float">;
type TslCondition = Node<"bool">;

export const tslScalarOps: ScalarOps<TslScalar, TslCondition> = {
  constant: (value) => float(value),
  add: (left, right) => add(left, right),
  sub: (left, right) => sub(left, right),
  mul: (left, right) => mul(left, right),
  div: (left, right) => div(left, right),
  neg: (value) => negate(value),
  sqrt: (value) => sqrt(value),
  sin: (value) => sin(value),
  acos: (value) => acos(value),
  clamp: (value, minimum, maximum) => clamp(value, minimum, maximum),
  lessThan: (left, right) => lessThan(left, right),
  select: (condition, whenTrue, whenFalse) => select(condition, whenTrue, whenFalse),
};

export interface ForwardPatchUniforms {
  readonly motionStart: UniformNode<"vec4", Vector4>;
  readonly motionEnd: UniformNode<"vec4", Vector4>;
  readonly motionFraction: UniformNode<"float", number>;
  readonly displayFraction: UniformNode<"float", number>;
  readonly verticalExaggeration: UniformNode<"float", number>;
  readonly activationStart: UniformNode<"float", number>;
  readonly activationEnd: UniformNode<"float", number>;
}

export interface ForwardPatchNodeGraph {
  readonly positionNode: Node<"vec3">;
  readonly activationNode: Node<"float">;
  readonly uniforms: ForwardPatchUniforms;
}

function quaternionTuple(node: Node<"vec4">): QuaternionWxyz<TslScalar> {
  return [node.x, node.y, node.z, node.w];
}

function directionTuple(node: Node<"vec3">): UnitDirection<TslScalar> {
  return [node.x, node.y, node.z];
}

export function createForwardPatchNodeGraph(): ForwardPatchNodeGraph {
  const motionStart = uniform(new Vector4(1, 0, 0, 0), "vec4");
  const motionEnd = uniform(new Vector4(1, 0, 0, 0), "vec4");
  const motionFraction = uniform(0, "float");
  const displayFraction = uniform(0, "float");
  const verticalExaggeration = uniform(1, "float");
  const activationStart = uniform(1, "float");
  const activationEnd = uniform(1, "float");
  const result = evaluateForwardPatchVertex(tslScalarOps, {
    poseMode: attribute("poseMode", "float"),
    referenceDirection: directionTuple(attribute("referenceDirection", "vec3")),
    deformingDirectionStart: directionTuple(attribute("deformingDirectionStart", "vec3")),
    deformingDirectionEnd: directionTuple(attribute("deformingDirectionEnd", "vec3")),
    motionStart: quaternionTuple(motionStart),
    motionEnd: quaternionTuple(motionEnd),
    motionFraction,
    displayHeightStartMetres: attribute("displayHeightStartMetres", "float"),
    displayHeightEndMetres: attribute("displayHeightEndMetres", "float"),
    displayFraction,
    verticalExaggeration,
    activationStart,
    activationEnd,
  });
  return {
    positionNode: vec3(...result.rendererPosition),
    activationNode: result.activation,
    uniforms: { motionStart, motionEnd, motionFraction, displayFraction, verticalExaggeration,
      activationStart, activationEnd },
  };
}

export function createForwardPatchNodeMaterial(patch: ForwardPatchData): {
  readonly material: MeshBasicNodeMaterial;
  readonly graph: ForwardPatchNodeGraph;
} {
  assertForwardPatchData(patch);
  const activationStart = patch.activationStart[0]!;
  const activationEnd = patch.activationEnd[0]!;
  if ([...patch.activationStart].some((value) => Math.abs(value - activationStart) > 1e-6)
      || [...patch.activationEnd].some((value) => Math.abs(value - activationEnd) > 1e-6)) {
    throw new Error("GPU material patch must contain one lifecycle cohort");
  }
  const graph = createForwardPatchNodeGraph();
  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
  });
  // Compiler-qualified lifecycle is triangle-coherent. Collapse inactive
  // triangles before projection so neither backend writes color or depth.
  material.positionNode = graph.positionNode.mul(step(float(1.00001e-4), graph.activationNode));
  material.colorNode = attribute("color", "vec3");
  graph.uniforms.activationStart.value = activationStart;
  graph.uniforms.activationEnd.value = activationEnd;
  return { material, graph };
}

export function updateForwardPatchUniforms(
  uniforms: ForwardPatchUniforms,
  controls: {
    readonly motionStart: QuaternionWxyz<number>;
    readonly motionEnd: QuaternionWxyz<number>;
    readonly motionFraction: number;
    readonly displayFraction: number;
    readonly verticalExaggeration: number;
    readonly activationStart?: number;
    readonly activationEnd?: number;
  },
): void {
  assertForwardPatchControls(controls);
  uniforms.motionStart.value.set(...controls.motionStart);
  uniforms.motionEnd.value.set(...controls.motionEnd);
  uniforms.motionFraction.value = controls.motionFraction;
  uniforms.displayFraction.value = controls.displayFraction;
  uniforms.verticalExaggeration.value = controls.verticalExaggeration;
  const activationStart = controls.activationStart ?? 1;
  const activationEnd = controls.activationEnd ?? 1;
  if (!Number.isFinite(activationStart) || activationStart < 0 || activationStart > 1
      || !Number.isFinite(activationEnd) || activationEnd < 0 || activationEnd > 1) {
    throw new Error("forward patch material activation must be in [0, 1]");
  }
  uniforms.activationStart.value = activationStart;
  uniforms.activationEnd.value = activationEnd;
}

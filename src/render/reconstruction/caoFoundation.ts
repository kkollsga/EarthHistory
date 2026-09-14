import * as THREE from "three";
import { DoubleSide, FrontSide, LineBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  float,
  int,
  ivec2,
  materialOpacity,
  modelViewMatrix,
  modelWorldMatrix,
  screenSize,
  step,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import {
  EARTH_RADIUS_METRES,
  PREPARED_MOTION_PALETTE_STRIDE,
  type MaterialAddress,
  type InstantaneousOwnershipResult,
  type NativeBoundaryKind,
  type TopologyOwnershipRingV2,
  type PreparedCaoDisplayControlsCopy,
  type PreparedCaoRevision,
  type PreparedCaoStaticGeometryCopy,
} from "../../reconstruction";
import {
  gplatesToRendererDirection,
  numberScalarOps,
  rendererToGplatesDirection,
  rotateDirection,
  type QuaternionWxyz,
  type ScalarOps,
  type UnitDirection,
} from "../../reconstruction/arithmetic";
import { evaluateForwardPatchVertex } from "./patchKernel";
import type { GpuRetirementOwner } from "./gpuRetirement";
import { AtomicPrototypePublisher, type OwnedPrototypeResources } from "./publication";
import { tslScalarOps } from "./terrainNodes";
import { intersectRayTriangle } from "./picking";
import type { Vec3Tuple } from "./bounds";

/** Display separation only; source physical height remains zero/unknown. */
export const CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES = 400;
export const CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES = 800;
export const CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES = 1_800;
/** Underlay halo shell; the lower of the two country-line shells. */
export const CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES =
  CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES - 120;
export const CAO_FOUNDATION_BOUNDARY_LINE_OFFSET_METRES = 2_200;

/**
 * Widest chord in the shipped country-line geometry, measured over all 12 045
 * segments of `cao-v2.4/country-reference.ehgl`: 111.178 km, 1.00 degrees.
 * Chart poses are rigid rotations, so this is age-invariant.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES = 1;

/**
 * How far past the horizon a country-line vertex must be before the vertex
 * stage collapses it. It must exceed the widest chord so that a segment with
 * one visible endpoint is never collapsed at its other end.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES = 2;

/**
 * The relief control's ceiling (`App.tsx` clamps to 30, `patchGeometry`
 * rejects above it). The publication guard must assume the slider's maximum,
 * because it can move after a publication without republishing.
 */
export const CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION = 30;

/**
 * Tallest shell radius, in metres above the reference sphere, that a batch's
 * display controls can reach at the relief ceiling.
 */
export function caoFoundationMaxDisplayedShellMetres(
  displayHeightStartMetres: number,
  displayHeightEndMetres: number,
  shellOffsetMetres: number,
): number {
  return shellOffsetMetres + Math.max(0, displayHeightStartMetres, displayHeightEndMetres)
    * CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION;
}

/**
 * How a batch is drawn, and therefore what a viewer reads it as. Shelf batches
 * get the shallow-water appearance; native land and every material-correction
 * batch get the land appearance. Callers that need "is this land" must use this
 * rather than re-testing the batch id, so the two never drift apart.
 */
export type CaoFoundationBatchAppearance = "land" | "shelf";

export function caoFoundationBatchAppearance(batchId: string): CaoFoundationBatchAppearance {
  return batchId === "batch-shelf" ? "shelf" : "land";
}

export function caoFoundationShellOffsetMetres(batchId: string): number {
  if (batchId === "batch-shelf") return CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES;
  if (batchId === "batch-land" || batchId === "batch-0") return CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES;
  return CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES;
}
export const CAO_FOUNDATION_PALETTE_TEXEL_WIDTH = 256;

type PreparedCaoLineGeometryCopy = ReturnType<
  PreparedCaoRevision["lineBatches"][number]["createStaticGeometryCopy"]
>;

export interface CaoFoundationLimits {
  readonly maxBatches: number;
  readonly maxVertices: number;
  readonly maxTriangles: number;
  readonly maxRetainedSourceBytes: number;
  readonly maxTextureSize: number;
  readonly maxPublicationBytes: number;
  readonly maxSpatialIndexBytes: number;
}

export interface PackedCaoPalette {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly entryCount: number;
}

export interface CaoFoundationBatchResource {
  readonly batchId: string;
  readonly geometry: THREE.BufferGeometry;
  readonly source: PreparedCaoStaticGeometryCopy;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly nativePrecedence: boolean;
  /** chartIndex, firstTriangle, triangleCount, preparedEntryIndex. */
  readonly chartRanges: Uint32Array;
  /** Reference-space shell AABB, six floats per chart range. */
  readonly chartBounds: Float32Array;
}

export interface CaoFoundationLineBatchResource {
  readonly batchId: string;
  readonly geometry: THREE.BufferGeometry;
  readonly source: PreparedCaoLineGeometryCopy;
  readonly vertexCount: number;
  readonly segmentCount: number;
}

export interface CaoFoundationGeometryResource {
  readonly key: string;
  readonly batches: readonly CaoFoundationBatchResource[];
  readonly lineBatches: readonly CaoFoundationLineBatchResource[];
  readonly chartIdentities: readonly Readonly<{
    chartId: string;
    chartRevision: string;
    materialId: string;
    fragmentOrCohortId: string;
  }>[];
  /** Retained JS arrays plus tracked vertex/index GPU buffers; backend-private bytes are excluded. */
  readonly byteLength: number;
  readonly retainedCpuBytes: number;
  readonly trackedGpuBufferBytes: number;
  dispose(): void;
}

export interface CaoFoundationMaterialGraph {
  readonly material: MeshStandardNodeMaterial;
  readonly displayFraction: UniformNode<"float", number>;
  readonly verticalExaggeration: UniformNode<"float", number>;
}

export interface CaoFoundationLineMaterialGraph {
  readonly material: LineBasicNodeMaterial;
  readonly displayFraction: UniformNode<"float", number>;
  /** Device-pixel screen shift this copy is drawn at; one uniform per copy. */
  readonly screenOffsetPixels: UniformNode<"vec2", THREE.Vector2>;
  /** Clip-space delta the vertex node must add; exposed so tests pin the wiring. */
  readonly clipOffset: readonly [Node<"float">, Node<"float">];
  /** Vertex-stage far-side collapse factor; exposed so tests pin the wiring. */
  readonly vertexVisible: Node<"float">;
  /** Fragment-stage horizon term; the only thing hiding the far hemisphere. */
  readonly horizonVisibility: Node<"float">;
  /**
   * The varying the fragment horizon term reads the world direction through.
   * Exposed so a test can pin that it is a varying: reading the pose direction
   * directly in the fragment stage re-emits the whole prepared pose graph —
   * three palette texture loads plus a quaternion slerp and rotate — into the
   * fragment shader, because three caches node results per shader stage.
   */
  readonly fragmentDirection: Node<"vec3">;
  /**
   * The cosine/sine margin constants each horizon term was built with, exposed
   * so a test can pin which stage carries the cull margin. The vertex stage must
   * carry it and the fragment stage must not: a vertex stage without the margin
   * collapses one end of a segment that straddles the terminator and draws a
   * spoke from the globe centre, and a fragment stage with it pushes the
   * terminator a whole margin past the true horizon.
   */
  readonly horizonMargins: Readonly<{
    vertexCullCos: Node<"float">; vertexCullSin: Node<"float">;
    fragmentCos: Node<"float">; fragmentSin: Node<"float">;
  }>;
}

export interface CaoFoundationDiagnostics {
  readonly identity: string | null;
  readonly staticGeometryIdentity: string | null;
  readonly materialCorrectionIdentity: string | null;
  readonly materialCorrections: Readonly<{
    observedActiveCharts: number;
    classifiedShallowMarineActiveCharts: number;
    qualifiedActiveCharts: number;
    uncertainActiveCharts: number;
    formationUncertainActiveCharts: number;
    modelInferredPoseActiveCharts: number;
    overriddenNativeCharts: number;
    activeSourceIds: readonly string[];
    correctionIds: readonly string[];
  }>;
  readonly requestedAgeMa: number | null;
  readonly batches: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly drawCount: number;
  readonly countryLineBatches: number;
  readonly countryLineVertices: number;
  readonly countryLineSegments: number;
  readonly nativeBoundarySegments: number;
  readonly nativeBoundarySourceAgeMa: number | null;
  readonly topologyOwnershipRings: number;
  readonly topologyOwnershipSourceAgeMa: number | null;
  readonly retainedStaticBytes: number;
  readonly activeSourceBytes: number;
  readonly retainedPublicationBytes: number;
  readonly pendingRetirementBytes: number;
  readonly paletteEntries: number;
  readonly shellOffsetMetres: number;
}

export interface CaoFoundationSurfaceHit {
  readonly batchId: string;
  readonly chartIndex: number;
  readonly triangleIndex: number;
  readonly distance: number;
  readonly position: Vec3Tuple;
  readonly materialAddress: MaterialAddress;
}

function safeAdd(total: number, next: number, label: string): number {
  if (!Number.isSafeInteger(next) || next < 0 || total > Number.MAX_SAFE_INTEGER - next) {
    throw new Error(`${label} byte/count total is invalid`);
  }
  return total + next;
}

function allFinite(values: ArrayLike<number>): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function staticGeometryByteLength(batch: PreparedCaoStaticGeometryCopy): number {
  return [batch.referenceDirections, batch.indices, batch.seamIds,
    batch.preparedEntryIndices, batch.materialChartIndices]
    .reduce((sum, value) => safeAdd(sum, value.byteLength, "Cao batch"), 0);
}

function staticLineGeometryByteLength(batch: PreparedCaoLineGeometryCopy): number {
  return [batch.referenceDirections, batch.lineIndices,
    batch.preparedEntryIndices, batch.materialChartIndices]
    .reduce((sum, value) => safeAdd(sum, value.byteLength, "Cao line batch"), 0);
}

function validateStaticLineGeometryCopy(
  batch: PreparedCaoLineGeometryCopy,
  vertexCount: number,
  segmentCount: number,
  paletteEntries: number,
  chartCount: number,
): void {
  if (batch.referenceDirections.length !== vertexCount * 3
      || batch.lineIndices.length !== segmentCount * 2
      || batch.preparedEntryIndices.length !== vertexCount
      || batch.materialChartIndices.length !== vertexCount
      || !allFinite(batch.referenceDirections)) {
    throw new Error("Cao country line batch attribute length mismatch");
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    if (Math.abs(Math.hypot(batch.referenceDirections[offset]!, batch.referenceDirections[offset + 1]!,
      batch.referenceDirections[offset + 2]!) - 1) > 2e-6
        || batch.preparedEntryIndices[vertex]! >= paletteEntries
        || batch.materialChartIndices[vertex]! >= chartCount) {
      throw new Error("Cao country line vertex is invalid");
    }
  }
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const left = batch.lineIndices[segment * 2]!;
    const right = batch.lineIndices[segment * 2 + 1]!;
    if (left >= vertexCount || right >= vertexCount
        || batch.materialChartIndices[left] !== batch.materialChartIndices[right]
        || batch.preparedEntryIndices[left] !== batch.preparedEntryIndices[right]) {
      throw new Error("Cao country segment crosses material-chart ownership");
    }
  }
}

function validateStaticGeometryCopy(
  batch: PreparedCaoStaticGeometryCopy,
  vertexCount: number,
  triangleCount: number,
  paletteEntries: number,
  chartCount: number,
): void {
  if (batch.referenceDirections.length !== vertexCount * 3
      || batch.indices.length !== triangleCount * 3
      || batch.seamIds.length !== vertexCount
      || batch.preparedEntryIndices.length !== vertexCount
      || batch.materialChartIndices.length !== vertexCount) {
    throw new Error("Cao foundation batch attribute length mismatch");
  }
  if (!allFinite(batch.referenceDirections)) {
    throw new Error("Cao foundation batch contains a non-finite value");
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    if (Math.abs(Math.hypot(batch.referenceDirections[offset]!, batch.referenceDirections[offset + 1]!,
      batch.referenceDirections[offset + 2]!) - 1) > 2e-6) {
      throw new Error("Cao foundation reference direction must be unit length");
    }
    if (batch.preparedEntryIndices[vertex]! >= paletteEntries
        || batch.materialChartIndices[vertex]! >= chartCount) {
      throw new Error("Cao foundation vertex palette or chart index is invalid");
    }
  }
  for (let index = 0; index < batch.indices.length; index += 1) {
    if (batch.indices[index]! >= vertexCount) throw new Error("Cao foundation triangle index is invalid");
  }
  for (let triangle = 0; triangle < batch.indices.length; triangle += 3) {
    const a = batch.indices[triangle]!;
    const chart = batch.materialChartIndices[a]!;
    if (batch.materialChartIndices[batch.indices[triangle + 1]!] !== chart
        || batch.materialChartIndices[batch.indices[triangle + 2]!] !== chart) {
      throw new Error("Cao foundation triangle crosses material-chart ownership");
    }
  }
}

function createChartSpatialIndex(
  source: PreparedCaoStaticGeometryCopy,
  ranges: PreparedCaoRevision["batches"][number]["chartTriangleRanges"],
  triangleCount: number,
  chartCount: number,
  shellOffsetMetres: number,
): { chartRanges: Uint32Array; chartBounds: Float32Array } {
  const chartRanges = new Uint32Array(ranges.length * 4);
  const chartBounds = new Float32Array(ranges.length * 6);
  const shellRadius = 1 + shellOffsetMetres / EARTH_RADIUS_METRES;
  let coveredTriangles = 0;
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex]!;
    if (!Number.isSafeInteger(range.chartIndex) || range.chartIndex < 0 || range.chartIndex >= chartCount
        || !Number.isSafeInteger(range.firstTriangle) || range.firstTriangle !== coveredTriangles
        || !Number.isSafeInteger(range.triangleCount) || range.triangleCount < 1
        || range.firstTriangle + range.triangleCount > triangleCount) {
      throw new Error("Cao chart triangle ranges are invalid or non-contiguous");
    }
    const rangeOffset = rangeIndex * 4;
    const boundsOffset = rangeIndex * 6;
    chartRanges[rangeOffset] = range.chartIndex;
    chartRanges[rangeOffset + 1] = range.firstTriangle;
    chartRanges[rangeOffset + 2] = range.triangleCount;
    let preparedEntryIndex = Number.NaN;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let triangle = range.firstTriangle;
      triangle < range.firstTriangle + range.triangleCount; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = source.indices[triangle * 3 + corner]!;
        if (source.materialChartIndices[vertex] !== range.chartIndex) {
          throw new Error("Cao chart triangle range ownership mismatch");
        }
        const entry = source.preparedEntryIndices[vertex]!;
        if (Number.isNaN(preparedEntryIndex)) preparedEntryIndex = entry;
        else if (entry !== preparedEntryIndex) {
          throw new Error("Cao chart triangle range uses multiple prepared palette entries");
        }
        for (let axis = 0; axis < 3; axis += 1) {
          const value = source.referenceDirections[vertex * 3 + axis]! * shellRadius;
          minimum[axis] = Math.min(minimum[axis]!, value);
          maximum[axis] = Math.max(maximum[axis]!, value);
        }
      }
    }
    chartRanges[rangeOffset + 3] = preparedEntryIndex;
    chartBounds.set([...minimum, ...maximum], boundsOffset);
    coveredTriangles += range.triangleCount;
  }
  if (coveredTriangles !== triangleCount) {
    throw new Error("Cao chart triangle ranges do not cover the complete batch");
  }
  return { chartRanges, chartBounds };
}

export function packCaoPaletteValues(
  values: Float32Array,
  entryCount: number,
  maxTextureSize: number,
): PackedCaoPalette {
  if (!Number.isSafeInteger(entryCount) || entryCount < 1
      || !Number.isSafeInteger(maxTextureSize) || maxTextureSize < 3) {
    throw new Error("invalid prepared Cao palette shape");
  }
  const expectedValues = entryCount * PREPARED_MOTION_PALETTE_STRIDE;
  if (!Number.isSafeInteger(expectedValues) || values.length !== expectedValues || !allFinite(values)) {
    throw new Error("invalid prepared Cao palette values");
  }
  for (let entry = 0; entry < entryCount; entry += 1) {
    const offset = entry * PREPARED_MOTION_PALETTE_STRIDE;
    const youngerNorm = Math.hypot(values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!);
    const olderNorm = Math.hypot(values[offset + 4]!, values[offset + 5]!, values[offset + 6]!, values[offset + 7]!);
    if (Math.abs(youngerNorm - 1) > 2e-6 || Math.abs(olderNorm - 1) > 2e-6
        || values[offset + 8]! < 0 || values[offset + 8]! > 1
        || values[offset + 9]! < 0 || values[offset + 9]! > 1
        || values[offset + 10]! < 0 || values[offset + 10]! > 1) {
      throw new Error("invalid prepared Cao palette entry");
    }
  }
  const texelCount = entryCount * 3;
  const width = Math.min(CAO_FOUNDATION_PALETTE_TEXEL_WIDTH, maxTextureSize);
  const height = Math.ceil(texelCount / width);
  if (height > maxTextureSize) throw new Error("prepared Cao palette exceeds backend texture bound");
  const data = new Float32Array(width * height * 4);
  for (let entry = 0; entry < entryCount; entry += 1) {
    const source = entry * PREPARED_MOTION_PALETTE_STRIDE;
    const target = entry * 12;
    data.set(values.subarray(source, source + PREPARED_MOTION_PALETTE_STRIDE), target);
  }
  return Object.freeze({ data, width, height, entryCount });
}

export function packPreparedCaoPalette(
  revision: PreparedCaoRevision,
  maxTextureSize: number,
): PackedCaoPalette {
  const palette = revision.motionPalette;
  if (palette.stride !== PREPARED_MOTION_PALETTE_STRIDE) {
    throw new Error("invalid prepared Cao palette shape");
  }
  return packCaoPaletteValues(palette.createValuesCopy(), palette.entryCount, maxTextureSize);
}

function tuple4(node: Node<"vec4">): QuaternionWxyz<Node<"float">> {
  return [node.x, node.y, node.z, node.w];
}

function tuple3(node: Node<"vec3">): UnitDirection<Node<"float">> {
  return [node.x, node.y, node.z];
}

function createPreparedCaoPoseNodes(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
  verticalExaggerationValue: number,
  displayHeightStart: Node<"float">,
  displayHeightEnd: Node<"float">,
  shellOffsetMetres: number,
): Readonly<{
  position: Node<"vec3">;
  direction: Node<"vec3">;
  activation: Node<"float">;
  displayFraction: UniformNode<"float", number>;
  verticalExaggeration: UniformNode<"float", number>;
}> {
  if (!Number.isSafeInteger(paletteWidth) || paletteWidth < 1
      || !Number.isFinite(shellOffsetMetres) || shellOffsetMetres < 0) {
    throw new Error("invalid Cao palette or shell offset");
  }
  const displayFraction = uniform(displayFractionValue, "float");
  const verticalExaggeration = uniform(verticalExaggerationValue, "float");
  const entry = int(attribute<"uint">("preparedEntryIndex", "uint"));
  const baseTexel = entry.mul(3).toInt();
  const texel = (offset: number) => {
    const linear = baseTexel.add(offset).toInt();
    return textureLoad(paletteTexture, ivec2(linear.mod(paletteWidth), linear.div(paletteWidth)));
  };
  const younger = texel(0);
  const older = texel(1);
  const state = texel(2);
  const reference = attribute<"vec3">("position", "vec3");
  const result = evaluateForwardPatchVertex(tslScalarOps, {
    poseMode: float(0),
    referenceDirection: tuple3(reference),
    deformingDirectionStart: tuple3(reference),
    deformingDirectionEnd: tuple3(reference),
    motionStart: tuple4(younger),
    motionEnd: tuple4(older),
    motionFraction: state.x,
    displayHeightStartMetres: displayHeightStart,
    displayHeightEndMetres: displayHeightEnd,
    displayFraction,
    verticalExaggeration,
    activationStart: state.y,
    activationEnd: state.z,
  });
  const direction = vec3(...result.rendererDirection);
  const position = vec3(...result.rendererPosition).add(
    direction.mul(float(shellOffsetMetres / EARTH_RADIUS_METRES)),
  ).mul(step(float(1.00001e-4), result.activation));
  return Object.freeze({ position, direction, activation: result.activation,
    displayFraction, verticalExaggeration });
}

export function createCaoFoundationMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  display: PreparedCaoDisplayControlsCopy,
  displayFractionValue: number,
  verticalExaggerationValue: number,
  shellOffsetMetres: number = CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  appearance: "land" | "shelf" = "land",
): CaoFoundationMaterialGraph {
  const displayHeightStart = display.displayHeightStart.kind === "uniform"
    ? float(display.displayHeightStart.value) : attribute<"float">("displayHeightStartMetres", "float");
  const displayHeightEnd = display.displayHeightEnd.kind === "uniform"
    ? float(display.displayHeightEnd.value) : attribute<"float">("displayHeightEndMetres", "float");
  const pose = createPreparedCaoPoseNodes(paletteTexture, paletteWidth,
    displayFractionValue, verticalExaggerationValue, displayHeightStart,
    displayHeightEnd, shellOffsetMetres);
  // Shelf plates light up brighter than the MeshPhysical globe ocean; keep them
  // front-faced, rougher, and slightly dimmed so they sit near deep-sea tone.
  const material = new MeshStandardNodeMaterial({
    side: appearance === "shelf" ? FrontSide : DoubleSide,
    roughness: appearance === "shelf" ? 0.94 : 0.82,
    metalness: 0,
  });
  material.positionNode = pose.position;
  // NodeMaterial consumes a custom normalNode in view space. The reconstructed
  // radial direction is mesh-local, so transform it exactly once before lighting.
  material.normalNode = transformNormalToView(pose.direction);
  if (display.baseColor.kind === "uniform") {
    const [r, g, b] = display.baseColor.value;
    const dim = appearance === "shelf" ? 0.58 : 1;
    material.colorNode = vec3(r * dim, g * dim, b * dim);
  } else {
    material.colorNode = attribute<"vec3">("color", "vec3");
  }
  return Object.freeze({ material, displayFraction: pose.displayFraction,
    verticalExaggeration: pose.verticalExaggeration });
}

export type CaoFoundationCountryLineStyle = "stroke" | "underlay";

/**
 * Device-pixel screen offsets each country-line style is drawn at.
 *
 * Both backends rasterize a GPU line primitive exactly one device pixel wide:
 * `linewidth` is ignored by WebGL2 core profiles and WebGPU has no line width
 * at all. A lone hairline therefore hands most of its multisample coverage to
 * one of two neighbouring pixel rows on any diagonal, so its apparent darkness
 * swings between a fully covered pixel and a barely visible one along a single
 * segment and the outline reads as beaded rather than solid — worse at device
 * pixel ratios above one, where that hairline is under half a CSS pixel.
 *
 * Drawing the same segments once per offset unions the copies into a stroke
 * whose core is covered from every direction. The offsets are diagonal so no
 * line bearing is left unwidened, and the underlay ring sits outside the stroke
 * core as the contrast halo. A shifted copy is rasterized at a pixel its own
 * depth was not computed for, which is why these materials do not depth test at
 * all — see `evaluateCountryLineHorizonVisibility`.
 */
const CAO_FOUNDATION_COUNTRY_LINE_OFFSETS_PX: Readonly<Record<
  CaoFoundationCountryLineStyle, readonly (readonly [number, number])[]>> = Object.freeze({
    stroke: Object.freeze(([[0, 0], [0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]] as
      [number, number][]).map((offset) => Object.freeze(offset))),
    underlay: Object.freeze(([[0.95, 0.95], [-0.95, 0.95], [0.95, -0.95], [-0.95, -0.95]] as
      [number, number][]).map((offset) => Object.freeze(offset))),
  });

/** Total country-line draws per frame this renderer is allowed to publish. */
export const CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET = 9;

/** Renderer-unit radius of the opaque globe shell (`GlobeScene` globe mesh). */
export const CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS = 1;

export function caoFoundationCountryLineOffsetsPx(
  style: CaoFoundationCountryLineStyle,
): readonly (readonly [number, number])[] {
  return CAO_FOUNDATION_COUNTRY_LINE_OFFSETS_PX[style];
}

/**
 * One screen-offset formula consumed by the TSL material and its unit test.
 *
 * `screenWidthPx`/`screenHeightPx` are the drawing buffer in device pixels, so
 * the result is a true device-pixel shift at any pixel ratio. Scaling by the
 * clip w undoes the perspective divide, which keeps the shift constant in
 * pixels at any depth and interpolates correctly across a near-plane clip.
 */
export function evaluateCountryLineClipOffset<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ offsetPixelX: T; offsetPixelY: T; screenWidthPx: T; screenHeightPx: T; clipW: T }>,
): readonly [T, T] {
  const two = ops.constant(2);
  return [
    ops.mul(ops.div(ops.mul(input.offsetPixelX, two), input.screenWidthPx), input.clipW),
    ops.mul(ops.div(ops.mul(input.offsetPixelY, two), input.screenHeightPx), input.clipW),
  ];
}

/**
 * Cosine of the angular separation at which the opaque globe starts hiding an
 * outline shell point, widened by a margin whose cosine and sine are supplied.
 *
 * A point at `pointRadius` is visible from `cameraRadius` exactly while their
 * angular separation stays within `acos(occluder/cameraRadius) +
 * acos(occluder/pointRadius)`; this returns the cosine of that sum plus the
 * margin, so no inverse trigonometry runs per vertex or per fragment. Both
 * half-angles are at most 90 degrees and the margins used here are single
 * degrees, so the sum stays inside the monotone range of acos and the cosine
 * comparison never wraps.
 */
export function evaluateCountryLineHorizonLimitCos<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ pointRadius: T; cameraRadius: T; occluderRadius: T; marginCos: T; marginSin: T }>,
): T {
  const cosCamera = ops.clamp(ops.div(input.occluderRadius, input.cameraRadius), 0, 1);
  const cosPoint = ops.clamp(ops.div(input.occluderRadius, input.pointRadius), 0, 1);
  const sine = (cosine: T) => ops.sqrt(
    ops.clamp(ops.sub(ops.constant(1), ops.mul(cosine, cosine)), 0, 1));
  const sinCamera = sine(cosCamera);
  const sinPoint = sine(cosPoint);
  const cosSum = ops.sub(ops.mul(cosCamera, cosPoint), ops.mul(sinCamera, sinPoint));
  const sinSum = ops.add(ops.mul(sinCamera, cosPoint), ops.mul(cosCamera, sinPoint));
  return ops.sub(ops.mul(cosSum, input.marginCos), ops.mul(sinSum, input.marginSin));
}

/**
 * One horizon-occlusion formula consumed by the TSL material and its unit test.
 * Returns 1 where the outline shell point is visible past the opaque globe and
 * 0 where the globe hides it.
 *
 * The offset copies cannot use the depth buffer: a copy carries the depth of
 * the vertex it was shifted from but is rasterized at a neighbouring pixel, and
 * at grazing incidence the land shell's depth changes far faster per pixel than
 * the 1 000 m gap between the line and land shells, so every inward-shifted
 * copy loses the depth test over almost the whole globe view while every
 * outward-shifted one wins it past the silhouette and draws over the sky.
 * Nothing in the scene legitimately occludes these lines except the globe body:
 * land and shelf sit below the line shell — an invariant the publication guard
 * enforces, because the display controls could otherwise lift them — and the
 * cloud shell never writes depth. Occlusion is therefore computed analytically
 * here instead.
 *
 * The fragment stage evaluates this with a zero margin, so the terminator stays
 * a sharp per-pixel cut. The vertex stage evaluates it again with a margin
 * wider than the widest segment chord, which collapses far-side vertices so
 * they rasterize nothing at all instead of being shaded and then zeroed.
 */
export function evaluateCountryLineHorizonVisibility<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ cosSeparation: T; pointRadius: T; cameraRadius: T;
    occluderRadius: T; marginCos: T; marginSin: T }>,
): T {
  const limit = evaluateCountryLineHorizonLimitCos(ops, input);
  return ops.select(ops.lessThan(limit, input.cosSeparation), ops.constant(1), ops.constant(0));
}

export function createCaoFoundationCountryLineMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
  style: CaoFoundationCountryLineStyle = "stroke",
  offsetPixels: readonly [number, number] = [0, 0],
): CaoFoundationLineMaterialGraph {
  if (!Number.isFinite(offsetPixels[0]) || !Number.isFinite(offsetPixels[1])) {
    throw new Error("invalid Cao country line screen offset");
  }
  // Underlay sits slightly lower; main stroke above. The stroke is a dark
  // slate: the earlier mid-tone slate read as nearly invisible on phones and
  // pale land. Width comes from the screen offsets, not from the shell gap.
  const shellOffset = style === "underlay"
    ? CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES
    : CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES;
  const pose = createPreparedCaoPoseNodes(paletteTexture, paletteWidth,
    displayFractionValue, 1, float(0), float(0), shellOffset);
  const material = new LineBasicNodeMaterial({
    transparent: true,
    opacity: style === "underlay" ? 0.5 : 0.92,
    // Occlusion comes from the horizon term below, not from the depth buffer.
    depthTest: false,
    depthWrite: false,
  });
  // Dark slate stays visible across pale land and dark shelf water alike.
  material.colorNode = style === "underlay"
    ? vec3(0.04, 0.05, 0.07)
    : vec3(0.12, 0.15, 0.18);
  // The offset is a per-copy uniform rather than a baked literal so the test can
  // read back what each copy was built with. It does not make the copies share a
  // program: each call rebuilds the pose graph, and three keys pipeline reuse on
  // node ids, so a publication compiles one program per copy. The 411 Ma
  // cold-ready median did not regress against the single-hairline control
  // (817 ms against 826 ms), so those compilations are affordable.
  const screenOffsetPixels = uniform(new THREE.Vector2(offsetPixels[0], offsetPixels[1]), "vec2");
  const pointRadius = float(1 + shellOffset / EARTH_RADIUS_METRES);
  const cameraDirection = cameraPosition.normalize();
  const cameraRadius = cameraPosition.length();
  const occluderRadius = float(CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS);
  // The reconstructed radial direction stays unit length even where activation
  // collapses the position to the origin, so the horizon term is well defined
  // for every vertex. The globe centre is the world origin.
  const worldDirection = modelWorldMatrix.mul(vec4(pose.direction, 0)).xyz.normalize();
  // Vertex stage: collapse a vertex that is past the terminator by more than the
  // widest chord in the package. A segment therefore only collapses when both
  // its endpoints are beyond the terminator, and a half-collapsed segment is
  // still invisible — every direction interpolated along it stays past the
  // terminator, so the fragment term zeroes all of it. Far-side segments now
  // rasterize nothing instead of being shaded and blended away, which the depth
  // test used to do with early-Z.
  const margin = CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES * Math.PI / 180;
  const vertexCullCos = float(Math.cos(margin));
  const vertexCullSin = float(Math.sin(margin));
  const vertexVisible = evaluateCountryLineHorizonVisibility(tslScalarOps, {
    cosSeparation: worldDirection.dot(cameraDirection),
    pointRadius, cameraRadius, occluderRadius,
    marginCos: vertexCullCos, marginSin: vertexCullSin,
  });
  const culledPosition = pose.position.mul(vertexVisible);
  material.positionNode = culledPosition;
  const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(culledPosition, 1)));
  const [offsetX, offsetY] = evaluateCountryLineClipOffset(tslScalarOps, {
    offsetPixelX: screenOffsetPixels.x, offsetPixelY: screenOffsetPixels.y,
    screenWidthPx: screenSize.x, screenHeightPx: screenSize.y, clipW: clip.w,
  });
  material.vertexNode = vec4(clip.x.add(offsetX), clip.y.add(offsetY), clip.z, clip.w);
  // Fragment stage: the interpolated world direction, renormalised. Passing the
  // direction through a varying is what keeps the prepared pose graph — three
  // palette texture loads plus a quaternion slerp and rotate — in the vertex
  // stage; three caches node results per shader stage and only attributes insert
  // a varying on their own, so reading `worldDirection` directly here would emit
  // and run that whole graph again for every outline fragment. Varying the 0/1
  // visibility instead would interpolate it and blur the terminator.
  const fragmentCos = float(1);
  const fragmentSin = float(0);
  const fragmentDirection = varying(worldDirection);
  const horizonVisibility = evaluateCountryLineHorizonVisibility(tslScalarOps, {
    cosSeparation: fragmentDirection.normalize().dot(cameraDirection),
    pointRadius, cameraRadius, occluderRadius,
    marginCos: fragmentCos, marginSin: fragmentSin,
  });
  material.opacityNode = materialOpacity.mul(horizonVisibility);
  return Object.freeze({ material, displayFraction: pose.displayFraction, screenOffsetPixels,
    clipOffset: Object.freeze([offsetX, offsetY] as const), vertexVisible, horizonVisibility,
    fragmentDirection,
    horizonMargins: Object.freeze({ vertexCullCos, vertexCullSin, fragmentCos, fragmentSin }) });
}

export function estimateCaoFoundationGeometryReservation(
  revision: PreparedCaoRevision,
  limits: CaoFoundationLimits,
): number {
  if (!Number.isSafeInteger(limits.maxBatches) || limits.maxBatches < 1
      || !Number.isSafeInteger(limits.maxVertices) || limits.maxVertices < 3
      || !Number.isSafeInteger(limits.maxTriangles) || limits.maxTriangles < 1
      || !Number.isSafeInteger(limits.maxRetainedSourceBytes) || limits.maxRetainedSourceBytes < 1
      || !Number.isSafeInteger(limits.maxSpatialIndexBytes) || limits.maxSpatialIndexBytes < 1) {
    throw new Error("invalid Cao foundation renderer limits");
  }
  if (revision.batches.length < 1
      || revision.batches.length + revision.lineBatches.length > limits.maxBatches) {
    throw new Error("Cao foundation batch count exceeds limit");
  }
  let sourceBytes = 0;
  let vertices = 0;
  let triangles = 0;
  let spatialIndexBytes = 0;
  for (const batch of revision.batches) {
    sourceBytes = safeAdd(sourceBytes, batch.staticGeometryBytes, "Cao source");
    vertices = safeAdd(vertices, batch.vertexCount, "Cao vertex");
    triangles = safeAdd(triangles, batch.triangleCount, "Cao triangle");
    spatialIndexBytes = safeAdd(spatialIndexBytes,
      batch.chartTriangleRanges.length * (4 * Uint32Array.BYTES_PER_ELEMENT
        + 6 * Float32Array.BYTES_PER_ELEMENT), "Cao spatial index");
  }
  for (const batch of revision.lineBatches) {
    sourceBytes = safeAdd(sourceBytes, batch.staticGeometryBytes, "Cao line source");
    vertices = safeAdd(vertices, batch.vertexCount, "Cao line vertex");
    triangles = safeAdd(triangles, batch.segmentCount, "Cao line primitive");
  }
  if (sourceBytes > limits.maxRetainedSourceBytes || vertices > limits.maxVertices
      || triangles > limits.maxTriangles || spatialIndexBytes > limits.maxSpatialIndexBytes) {
    throw new Error("Cao foundation geometry exceeds renderer limit");
  }
  // Source copies remain retained for sparse picking; GPU vertex/index buffers
  // are bounded above by the complete source-copy byte count.
  return safeAdd(safeAdd(sourceBytes, sourceBytes, "Cao geometry reservation"),
    spatialIndexBytes, "Cao geometry reservation");
}

export function createCaoFoundationGeometryResource(
  revision: PreparedCaoRevision,
  limits: CaoFoundationLimits,
): CaoFoundationGeometryResource {
  const reservation = estimateCaoFoundationGeometryReservation(revision, limits);
  const resources: CaoFoundationBatchResource[] = [];
  const lineResources: CaoFoundationLineBatchResource[] = [];
  let retainedCpuBytes = 0;
  let trackedGpuBufferBytes = 0;
  try {
    for (const prepared of revision.batches) {
      const source = prepared.createStaticGeometryCopy();
      validateStaticGeometryCopy(source, prepared.vertexCount, prepared.triangleCount,
        revision.motionPalette.entryCount, revision.charts.length);
      const cpuBytes = staticGeometryByteLength(source);
      if (cpuBytes !== prepared.staticGeometryBytes) throw new Error("Cao prepared batch byte ledger mismatch");
      retainedCpuBytes = safeAdd(retainedCpuBytes, cpuBytes, "Cao retained CPU");
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(source.referenceDirections, 3));
      const preparedEntryIndex = new THREE.BufferAttribute(source.preparedEntryIndices, 1);
      // The TSL graph declares a uint attribute. WebGL2 must therefore bind
      // this buffer through vertexAttribIPointer rather than float conversion.
      preparedEntryIndex.gpuType = THREE.IntType;
      geometry.setAttribute("preparedEntryIndex", preparedEntryIndex);
      geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
      const gpuBytes = source.referenceDirections.byteLength + source.preparedEntryIndices.byteLength
        + source.indices.byteLength;
      trackedGpuBufferBytes = safeAdd(trackedGpuBufferBytes, gpuBytes, "Cao tracked GPU");
      const spatial = createChartSpatialIndex(source, prepared.chartTriangleRanges,
        prepared.triangleCount, revision.charts.length,
        caoFoundationShellOffsetMetres(prepared.batchId));
      retainedCpuBytes = safeAdd(retainedCpuBytes,
        spatial.chartRanges.byteLength + spatial.chartBounds.byteLength, "Cao retained spatial index");
      resources.push(Object.freeze({ batchId: prepared.batchId, geometry, source,
        vertexCount: prepared.vertexCount, triangleCount: prepared.triangleCount,
        nativePrecedence: prepared.nativePrecedence,
        chartRanges: spatial.chartRanges, chartBounds: spatial.chartBounds }));
    }
    for (const prepared of revision.lineBatches) {
      const source = prepared.createStaticGeometryCopy();
      validateStaticLineGeometryCopy(source, prepared.vertexCount, prepared.segmentCount,
        revision.motionPalette.entryCount, revision.charts.length);
      const cpuBytes = staticLineGeometryByteLength(source);
      if (cpuBytes !== prepared.staticGeometryBytes) {
        throw new Error("Cao prepared country line byte ledger mismatch");
      }
      retainedCpuBytes = safeAdd(retainedCpuBytes, cpuBytes, "Cao retained line CPU");
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(source.referenceDirections, 3));
      const preparedEntryIndex = new THREE.BufferAttribute(source.preparedEntryIndices, 1);
      preparedEntryIndex.gpuType = THREE.IntType;
      geometry.setAttribute("preparedEntryIndex", preparedEntryIndex);
      geometry.setIndex(new THREE.BufferAttribute(source.lineIndices, 1));
      const gpuBytes = source.referenceDirections.byteLength + source.preparedEntryIndices.byteLength
        + source.lineIndices.byteLength;
      trackedGpuBufferBytes = safeAdd(trackedGpuBufferBytes, gpuBytes, "Cao tracked line GPU");
      lineResources.push(Object.freeze({ batchId: prepared.batchId, geometry, source,
        vertexCount: prepared.vertexCount, segmentCount: prepared.segmentCount }));
    }
    const byteLength = safeAdd(retainedCpuBytes, trackedGpuBufferBytes, "Cao geometry");
    if (byteLength > reservation) throw new Error("Cao geometry exceeded its preflight reservation");
    return {
      key: `${revision.packageId}@${revision.packageRevision}:${[
        ...revision.batches.map((batch) => batch.staticGeometryIdentity),
        ...revision.lineBatches.map((batch) => batch.staticGeometryIdentity),
      ].join("|")}`,
      batches: Object.freeze(resources),
      lineBatches: Object.freeze(lineResources),
      chartIdentities: Object.freeze(revision.charts.map((chart) => Object.freeze({
        chartId: chart.chartId,
        chartRevision: chart.chartRevision,
        materialId: chart.materialId,
        fragmentOrCohortId: chart.fragmentOrCohortId,
      }))),
      byteLength,
      retainedCpuBytes,
      trackedGpuBufferBytes,
      dispose: () => [...resources, ...lineResources].forEach((resource) => resource.geometry.dispose()),
    };
  } catch (error) {
    resources.forEach((resource) => resource.geometry.dispose());
    lineResources.forEach((resource) => resource.geometry.dispose());
    throw error;
  }
}

export function createCaoFoundationPaletteTexture(packed: PackedCaoPalette): THREE.DataTexture {
  const texture = new THREE.DataTexture(packed.data, packed.width, packed.height,
    THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface CaoTopologyOwnershipState {
  readonly sourceAgeMa: number;
  readonly directions: Float32Array;
  readonly rings: readonly CaoTopologyOwnershipRing[];
  readonly byteLength: number;
}

interface CaoTopologyOwnershipRing extends TopologyOwnershipRingV2 {
  /** Winding sign for the minor spherical region containing the vertex mean. */
  readonly interiorWindingSign: -1 | 1;
}

class CaoFoundationPublicationResource implements OwnedPrototypeResources {
  private disposed = false;
  private scrubAgeMa: number;

  constructor(
    readonly group: THREE.Group,
    readonly byteLength: number,
    readonly paletteEntries: number,
    readonly activeSourceBytes: number,
    readonly materialCorrectionIdentity: string | null,
    public materialCorrections: PreparedCaoRevision["materialCorrections"],
    readonly chartPoses: Float32Array,
    readonly chartActive: Uint8Array,
    private readonly publishedNativeBoundarySegments: number,
    private readonly publishedNativeBoundarySourceAgeMa: number | null,
    private readonly nativeBoundaryObject: THREE.Object3D | null,
    private readonly publishedTopologyOwnership: CaoTopologyOwnershipState | null,
    private readonly palette: THREE.DataTexture,
    private readonly materials: readonly THREE.Material[],
    private readonly displayFractions: readonly UniformNode<"float", number>[],
    private readonly verticalExaggerations: readonly UniformNode<"float", number>[],
    private readonly publicationGeometries: readonly THREE.BufferGeometry[],
    private readonly retirement: GpuRetirementOwner,
    initialAgeMa: number,
  ) {
    this.scrubAgeMa = initialAgeMa;
  }

  get requestedAgeMa(): number {
    return this.scrubAgeMa;
  }

  get nativeBoundarySegments(): number {
    return this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa
      ? this.publishedNativeBoundarySegments : 0;
  }

  get nativeBoundarySourceAgeMa(): number | null {
    return this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa
      ? this.publishedNativeBoundarySourceAgeMa : null;
  }

  get topologyOwnership(): CaoTopologyOwnershipState | null {
    return this.publishedTopologyOwnership?.sourceAgeMa === this.scrubAgeMa
      ? this.publishedTopologyOwnership : null;
  }

  disposeUnsubmitted(): void {
    this.dispose();
  }

  setVerticalExaggeration(value: number): void {
    for (const exaggeration of this.verticalExaggerations) exaggeration.value = value;
  }

  setNativeBoundaryLayerVisibility(visible: boolean): void {
    if (this.nativeBoundaryObject) {
      this.nativeBoundaryObject.visible = visible
        && this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa;
    }
  }

  retargetMotion(
    packed: PackedCaoPalette,
    displayFraction: number,
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    requestedAgeMa: number,
    materialCorrections: PreparedCaoRevision["materialCorrections"],
  ): void {
    if (this.disposed) throw new Error("Cao foundation publication is disposed");
    if (packed.entryCount !== this.paletteEntries || packed.width !== this.palette.image.width
        || packed.height !== this.palette.image.height
        || chartPoses.length !== this.chartPoses.length || chartActive.length !== this.chartActive.length
        || !Number.isFinite(displayFraction) || displayFraction < 0 || displayFraction > 1
        || !Number.isFinite(requestedAgeMa) || requestedAgeMa < 0) {
      throw new Error("Cao motion retarget shape mismatch");
    }
    const image = this.palette.image as { data: Float32Array; width: number; height: number };
    if (!(image.data instanceof Float32Array) || image.data.length !== packed.data.length) {
      throw new Error("Cao palette texture storage mismatch");
    }
    image.data.set(packed.data);
    this.palette.needsUpdate = true;
    this.chartPoses.set(chartPoses);
    this.chartActive.set(chartActive);
    this.materialCorrections = materialCorrections;
    for (const fraction of this.displayFractions) fraction.value = displayFraction;
    this.scrubAgeMa = requestedAgeMa;
    if (this.nativeBoundaryObject) {
      this.nativeBoundaryObject.visible = this.publishedNativeBoundarySourceAgeMa === requestedAgeMa;
    }
  }

  identifyTopology(direction: UnitDirection): InstantaneousOwnershipResult | null {
    return identifyCaoTopologyOwnership(this.topologyOwnership, direction);
  }

  retireAfterGpuWork(): Promise<void> {
    return this.retirement.retire(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.materials.forEach((material) => material.dispose());
    this.publicationGeometries.forEach((geometry) => geometry.dispose());
    this.palette.dispose();
    this.group.clear();
  }
}

const NATIVE_BOUNDARY_COLORS: Readonly<Record<NativeBoundaryKind, number>> = Object.freeze({
  ridge: 0xffb05c, subduction: 0xff7662, transform: 0x6ccbd0, other: 0xb8b2a5,
});

function estimateNativeBoundaryBufferBytes(revision: PreparedCaoRevision): number {
  if (revision.nativeBoundary.kind !== "exact-source") return 0;
  const value = revision.nativeBoundary.value;
  let segmentPairs = 0;
  for (const segment of value.segments) {
    if (!Number.isSafeInteger(segment.pointCount) || segment.pointCount < 2) {
      throw new Error("Cao native boundary segment is invalid");
    }
    segmentPairs = safeAdd(segmentPairs, segment.pointCount - 1, "Cao native boundary segment");
  }
  // Account the lease copy concurrently with the renderer position/color
  // arrays so publication cannot exceed its bound during conversion.
  return safeAdd(value.pointCount * 9 * Float32Array.BYTES_PER_ELEMENT,
    segmentPairs * 2 * Uint32Array.BYTES_PER_ELEMENT, "Cao native boundary buffer");
}

function estimateTopologyOwnershipBytes(revision: PreparedCaoRevision): number {
  if (revision.topologyOwnership.kind !== "exact-source") return 0;
  const value = revision.topologyOwnership.value;
  const metadataBytes = new TextEncoder().encode(JSON.stringify(value.rings)).byteLength;
  return safeAdd(safeAdd(value.pointCount * 3 * Float32Array.BYTES_PER_ELEMENT,
    metadataBytes, "Cao topology ownership"), value.rings.length * Float64Array.BYTES_PER_ELEMENT,
  "Cao topology ownership");
}

function createNativeBoundaryObject(revision: PreparedCaoRevision): Readonly<{
  object: THREE.LineSegments | null;
  geometry: THREE.BufferGeometry | null;
  material: LineBasicNodeMaterial | null;
  trackedBytes: number;
  segmentCount: number;
  sourceAgeMa: number | null;
}> {
  if (revision.nativeBoundary.kind !== "exact-source") {
    return Object.freeze({ object: null, geometry: null, material: null,
      trackedBytes: 0, segmentCount: 0, sourceAgeMa: null });
  }
  const layer = revision.nativeBoundary;
  const value = layer.value;
  const source = value.createDirectionsCopy();
  if (source.length !== value.pointCount * 3 || !allFinite(source)) {
    throw new Error("Cao native boundary point copy is invalid");
  }
  const positions = new Float32Array(source.length);
  const colors = new Float32Array(source.length);
  let segmentPairs = 0;
  for (const segment of value.segments) segmentPairs += segment.pointCount - 1;
  const indices = new Uint32Array(segmentPairs * 2);
  const radius = 1 + CAO_FOUNDATION_BOUNDARY_LINE_OFFSET_METRES / EARTH_RADIUS_METRES;
  let indexCursor = 0;
  let expectedPointOffset = 0;
  for (const segment of value.segments) {
    if (segment.pointOffset !== expectedPointOffset || segment.pointCount < 2
        || segment.pointOffset + segment.pointCount > value.pointCount) {
      throw new Error("Cao native boundary ranges are invalid");
    }
    const color = new THREE.Color(NATIVE_BOUNDARY_COLORS[segment.kind]);
    for (let local = 0; local < segment.pointCount; local += 1) {
      const point = segment.pointOffset + local;
      const offset = point * 3;
      const direction: UnitDirection = [source[offset]!, source[offset + 1]!, source[offset + 2]!];
      if (Math.abs(Math.hypot(...direction) - 1) > 2e-6) {
        throw new Error("Cao native boundary direction must be unit length");
      }
      const renderer = gplatesToRendererDirection(numberScalarOps, direction);
      positions.set(renderer.map((value_) => value_ * radius), offset);
      colors.set([color.r, color.g, color.b], offset);
      if (local + 1 < segment.pointCount) {
        indices[indexCursor++] = point;
        indices[indexCursor++] = point + 1;
      }
    }
    expectedPointOffset += segment.pointCount;
  }
  if (expectedPointOffset !== value.pointCount || indexCursor !== indices.length) {
    throw new Error("Cao native boundary coverage is incomplete");
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const material = new LineBasicNodeMaterial({ vertexColors: true, transparent: true,
    opacity: 0.86, depthTest: true, depthWrite: false });
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 4;
  object.userData.overlayLayer = "tectonics";
  object.userData.evidence = "cao-native-exact-source";
  const trackedBytes = safeAdd(positions.byteLength + colors.byteLength,
    indices.byteLength, "Cao native boundary buffer");
  return Object.freeze({ object, geometry, material, trackedBytes,
    segmentCount: value.segments.length, sourceAgeMa: layer.sourceAgeMa });
}

function createTopologyOwnershipState(revision: PreparedCaoRevision): CaoTopologyOwnershipState | null {
  if (revision.topologyOwnership.kind !== "exact-source") return null;
  const layer = revision.topologyOwnership;
  const source = layer.value.createDirectionsCopy();
  if (source.length !== layer.value.pointCount * 3 || !allFinite(source)) {
    throw new Error("Cao topology ownership point copy is invalid");
  }
  let expectedOffset = 0;
  const rings = layer.value.rings.map((ring): CaoTopologyOwnershipRing => {
    if (ring.pointOffset !== expectedOffset || !Number.isSafeInteger(ring.pointCount)
        || ring.pointCount < 3 || ring.pointOffset + ring.pointCount > layer.value.pointCount) {
      throw new Error("Cao topology ownership ranges are invalid");
    }
    expectedOffset += ring.pointCount;
    return Object.freeze({ ...ring, candidatePlateIds: Object.freeze([...ring.candidatePlateIds]),
      interiorWindingSign: sphericalRingMinorRegionSign(source, ring.pointOffset, ring.pointCount) });
  });
  if (expectedOffset !== layer.value.pointCount) {
    throw new Error("Cao topology ownership coverage is incomplete");
  }
  for (let point = 0; point < layer.value.pointCount; point += 1) {
    const offset = point * 3;
    if (Math.abs(Math.hypot(source[offset]!, source[offset + 1]!, source[offset + 2]!) - 1) > 2e-6) {
      throw new Error("Cao topology ownership direction must be unit length");
    }
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify(layer.value.rings)).byteLength;
  return Object.freeze({ sourceAgeMa: layer.sourceAgeMa, directions: source,
    rings: Object.freeze(rings), byteLength: safeAdd(safeAdd(source.byteLength, metadataBytes,
      "Cao topology ownership"), rings.length * Float64Array.BYTES_PER_ELEMENT,
    "Cao topology ownership") });
}

function sphericalRingMinorRegionSign(
  directions: Float32Array,
  offset: number,
  count: number,
): -1 | 1 {
  const references: readonly UnitDirection[] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let reference = references[0]!;
  let bestAntipodalMargin = -Infinity;
  for (const candidate of references) {
    let margin = Infinity;
    for (let local = 0; local < count; local += 1) {
      const pointOffset = (offset + local) * 3;
      margin = Math.min(margin, 1 + candidate[0] * directions[pointOffset]!
        + candidate[1] * directions[pointOffset + 1]!
        + candidate[2] * directions[pointOffset + 2]!);
    }
    if (margin > bestAntipodalMargin) {
      reference = candidate;
      bestAntipodalMargin = margin;
    }
  }
  let signedArea = 0;
  for (let local = 0; local < count; local += 1) {
    const aOffset = (offset + local) * 3;
    const bOffset = (offset + (local + 1) % count) * 3;
    const ax = directions[aOffset]!;
    const ay = directions[aOffset + 1]!;
    const az = directions[aOffset + 2]!;
    const bx = directions[bOffset]!;
    const by = directions[bOffset + 1]!;
    const bz = directions[bOffset + 2]!;
    const determinant = reference[0] * (ay * bz - az * by)
      + reference[1] * (az * bx - ax * bz)
      + reference[2] * (ax * by - ay * bx);
    const denominator = 1 + reference[0] * ax + reference[1] * ay + reference[2] * az
      + ax * bx + ay * by + az * bz
      + bx * reference[0] + by * reference[1] + bz * reference[2];
    signedArea += 2 * Math.atan2(determinant, denominator);
  }
  while (signedArea > 2 * Math.PI) signedArea -= 4 * Math.PI;
  while (signedArea <= -2 * Math.PI) signedArea += 4 * Math.PI;
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-10) {
    throw new Error("Cao topology ownership ring has indeterminate spherical area");
  }
  return signedArea < 0 ? -1 : 1;
}

function sphericalRingWinding(
  point: UnitDirection,
  directions: Float32Array,
  offset: number,
  count: number,
): number | null {
  let winding = 0;
  for (let local = 0; local < count; local += 1) {
    const aOffset = (offset + local) * 3;
    const bOffset = (offset + (local + 1) % count) * 3;
    const a: UnitDirection = [directions[aOffset]!, directions[aOffset + 1]!, directions[aOffset + 2]!];
    const b: UnitDirection = [directions[bOffset]!, directions[bOffset + 1]!, directions[bOffset + 2]!];
    const aDot = a[0] * point[0] + a[1] * point[1] + a[2] * point[2];
    const bDot = b[0] * point[0] + b[1] * point[1] + b[2] * point[2];
    const ax = a[0] - point[0] * aDot;
    const ay = a[1] - point[1] * aDot;
    const az = a[2] - point[2] * aDot;
    const bx = b[0] - point[0] * bDot;
    const by = b[1] - point[1] * bDot;
    const bz = b[2] - point[2] * bDot;
    const aLength = Math.hypot(ax, ay, az);
    const bLength = Math.hypot(bx, by, bz);
    if (aLength < 1e-10 || bLength < 1e-10) return null;
    const anx = ax / aLength;
    const any = ay / aLength;
    const anz = az / aLength;
    const bnx = bx / bLength;
    const bny = by / bLength;
    const bnz = bz / bLength;
    const crossDot = point[0] * (any * bnz - anz * bny)
      + point[1] * (anz * bnx - anx * bnz)
      + point[2] * (anx * bny - any * bnx);
    winding += Math.atan2(crossDot, anx * bnx + any * bny + anz * bnz);
  }
  return winding;
}

function sphericalRingContains(
  point: UnitDirection,
  directions: Float32Array,
  ring: CaoTopologyOwnershipRing,
): boolean {
  const winding = sphericalRingWinding(point, directions, ring.pointOffset, ring.pointCount);
  return winding === null || (Math.abs(winding) > Math.PI
    && Math.sign(winding) === ring.interiorWindingSign);
}

function identifyCaoTopologyOwnership(
  state: CaoTopologyOwnershipState | null,
  rendererDirection: UnitDirection,
): InstantaneousOwnershipResult | null {
  if (state === null) return null;
  const length = Math.hypot(...rendererDirection);
  if (!allFinite(rendererDirection) || Math.abs(length - 1) > 2e-6) {
    throw new Error("Cao topology query direction must be unit length");
  }
  const point = rendererToGplatesDirection(numberScalarOps, rendererDirection);
  const byPolygon = new Map<string, CaoTopologyOwnershipRing[]>();
  for (const ring of state.rings) {
    const values = byPolygon.get(ring.polygonId) ?? [];
    values.push(ring);
    byPolygon.set(ring.polygonId, values);
  }
  const matches: CaoTopologyOwnershipRing[] = [];
  for (const rings of byPolygon.values()) {
    const exterior = rings.find((ring) => ring.ringRole === "exterior");
    if (!exterior || !sphericalRingContains(point, state.directions, exterior)) continue;
    if (rings.some((ring) => ring.ringRole === "hole"
      && sphericalRingContains(point, state.directions, ring))) continue;
    matches.push(exterior);
  }
  if (matches.length === 0) return null;
  const candidates = [...new Set(matches.flatMap((ring) => ring.plateId === null
    ? [...ring.candidatePlateIds] : [ring.plateId]))];
  const resolved = matches.find((ring) => ring.status === "instantaneous-owner" && ring.plateId !== null);
  if (matches.length === 1 && resolved?.plateId !== null && resolved !== undefined) {
    return Object.freeze({ kind: "instantaneous-owner", plateId: resolved.plateId,
      topologyId: resolved.topologyId, sourceAgeMa: state.sourceAgeMa });
  }
  if (candidates.length > 0) {
    return Object.freeze({ kind: "ambiguous", candidatePlateIds: Object.freeze(candidates),
      sourceAgeMa: state.sourceAgeMa });
  }
  return Object.freeze({ kind: "unknown", sourceAgeMa: state.sourceAgeMa });
}

function createChartPickState(revision: PreparedCaoRevision): {
  chartPoses: Float32Array;
  chartActive: Uint8Array;
} {
  const chartPoses = new Float32Array(revision.charts.length * 8);
  const chartActive = new Uint8Array(revision.charts.length);
  for (let chartIndex = 0; chartIndex < revision.charts.length; chartIndex += 1) {
    const chart = revision.charts[chartIndex]!;
    if (!allFinite(chart.poseQuaternion) || !allFinite(chart.inversePoseQuaternion)
        || Math.abs(Math.hypot(...chart.poseQuaternion) - 1) > 2e-6
        || Math.abs(Math.hypot(...chart.inversePoseQuaternion) - 1) > 2e-6) {
      throw new Error("Cao prepared chart pose is invalid");
    }
    chartPoses.set(chart.poseQuaternion, chartIndex * 8);
    chartPoses.set(chart.inversePoseQuaternion, chartIndex * 8 + 4);
    chartActive[chartIndex] = chart.support.kind === "supported" ? 1 : 0;
  }
  return { chartPoses, chartActive };
}

function createPublicationResource(
  revision: PreparedCaoRevision,
  geometry: CaoFoundationGeometryResource,
  packed: PackedCaoPalette,
  verticalExaggeration: number,
  retirement: GpuRetirementOwner,
): CaoFoundationPublicationResource {
  const paletteTexture = createCaoFoundationPaletteTexture(packed);
  const materials: THREE.Material[] = [];
  const displayFractions: UniformNode<"float", number>[] = [];
  const verticalExaggerations: UniformNode<"float", number>[] = [];
  const publicationGeometries: THREE.BufferGeometry[] = [];
  const group = new THREE.Group();
  group.name = `cao-foundation:${revision.identity}`;
  try {
    for (let index = 0; index < geometry.batches.length; index += 1) {
      const batch = geometry.batches[index]!;
      const prepared = revision.batches[index];
      if (!prepared || prepared.batchId !== batch.batchId) throw new Error("Cao batch order/identity changed");
      const display = prepared.createDisplayControlsCopy();
      if (display.displayHeightStart.kind !== "uniform" || display.displayHeightEnd.kind !== "uniform"
          || display.baseColor.kind !== "uniform") {
        throw new Error("Cao foundation v1 requires uniform placeholder height/color controls");
      }
      const shellOffset = caoFoundationShellOffsetMetres(batch.batchId);
      // The country outlines no longer depth test, so nothing stops a lifted
      // surface shell from drawing over them. This guard is what replaces the
      // depth buffer: the tallest shell the display controls can reach at the
      // relief ceiling must stay below the lower of the two outline shells.
      // The package format admits a nonzero display height, so a package that
      // starts using one must fail here rather than silently bury the outlines.
      if (caoFoundationMaxDisplayedShellMetres(display.displayHeightStart.value,
        display.displayHeightEnd.value, shellOffset)
          >= CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES) {
        throw new Error("Cao display height would lift the surface through the country-line shell");
      }
      const appearance = caoFoundationBatchAppearance(batch.batchId);
      const graph = createCaoFoundationMaterial(paletteTexture, packed.width, display,
        revision.display.fraction, verticalExaggeration, shellOffset, appearance);
      materials.push(graph.material);
      displayFractions.push(graph.displayFraction);
      verticalExaggerations.push(graph.verticalExaggeration);
      const mesh = new THREE.Mesh(batch.geometry, graph.material);
      // Source batches do not yet carry qualified moving interval bounds.
      // Drawing all foundation batches preserves coverage until those arrive.
      mesh.frustumCulled = false;
      if (batch.nativePrecedence) {
        graph.material.depthTest = true;
        graph.material.depthWrite = false;
      }
      // Shelf under corrections, with source land last so native land keeps
      // visual precedence where it overlaps a corrected material footprint.
      mesh.renderOrder = batch.nativePrecedence ? 1.5 : batch.batchId === "batch-shelf" ? 1 : 2;
      group.add(mesh);
    }
    for (let index = 0; index < geometry.lineBatches.length; index += 1) {
      const batch = geometry.lineBatches[index]!;
      const prepared = revision.lineBatches[index];
      if (!prepared || prepared.batchId !== batch.batchId) {
        throw new Error("Cao country line batch order/identity changed");
      }
      for (const style of ["underlay", "stroke"] as const) {
        // One draw per screen offset; the union is the widened stroke.
        for (const offsetPixels of caoFoundationCountryLineOffsetsPx(style)) {
          const graph = createCaoFoundationCountryLineMaterial(paletteTexture, packed.width,
            revision.display.fraction, style, offsetPixels);
          materials.push(graph.material);
          displayFractions.push(graph.displayFraction);
          const lines = new THREE.LineSegments(batch.geometry, graph.material);
          lines.frustumCulled = false;
          lines.renderOrder = style === "underlay" ? 3 : 4;
          lines.userData.overlayLayer = "borders";
          lines.userData.evidence = "modern-country-reference-reconstructed-with-cao";
          lines.userData.countryLineStyle = style;
          group.add(lines);
        }
      }
    }
    const nativeBoundary = createNativeBoundaryObject(revision);
    if (nativeBoundary.object !== null && nativeBoundary.geometry !== null
        && nativeBoundary.material !== null) {
      group.add(nativeBoundary.object);
      publicationGeometries.push(nativeBoundary.geometry);
      materials.push(nativeBoundary.material);
    }
    const topologyOwnership = createTopologyOwnershipState(revision);
    const pickState = createChartPickState(revision);
    const byteLength = safeAdd(safeAdd(safeAdd(packed.data.byteLength,
      pickState.chartPoses.byteLength + pickState.chartActive.byteLength, "Cao publication"),
    nativeBoundary.trackedBytes, "Cao publication"), topologyOwnership?.byteLength ?? 0,
    "Cao publication");
    return new CaoFoundationPublicationResource(group, byteLength,
      packed.entryCount, revision.activeSourceBytes,
      revision.materialCorrectionIdentity, revision.materialCorrections,
      pickState.chartPoses, pickState.chartActive,
      nativeBoundary.segmentCount, nativeBoundary.sourceAgeMa,
      nativeBoundary.object, topologyOwnership,
      paletteTexture, Object.freeze(materials), Object.freeze(displayFractions),
      Object.freeze(verticalExaggerations),
      Object.freeze(publicationGeometries), retirement, revision.requestedAgeMa);
  } catch (error) {
    materials.forEach((material) => material.dispose());
    publicationGeometries.forEach((geometry_) => geometry_.dispose());
    paletteTexture.dispose();
    group.clear();
    throw error;
  }
}

function rayIntersectsBounds(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  bounds: Float32Array,
  offset: number,
): boolean {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = bounds[offset + axis]!;
    const maximum = bounds[offset + 3 + axis]!;
    if (Math.abs(direction[axis]) < 1e-15) {
      if (origin[axis] < minimum || origin[axis] > maximum) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (minimum - origin[axis]) * inverse;
    let second = (maximum - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return false;
  }
  return far >= 0;
}

function tupleAt(values: Float32Array, offset: number): Vec3Tuple {
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function firstOpaqueGlobeIntersectionDistance(origin: Vec3Tuple, direction: Vec3Tuple): number | null {
  const projection = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
  const offset = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - 1;
  const discriminant = projection * projection - offset;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = -projection - root;
  if (first >= 0) return first;
  const second = -projection + root;
  return second >= 0 ? second : null;
}

/**
 * Slack added to a chart's vertex bounding box before the exact test. The box
 * bounds triangle vertices, but a point on the sphere at shell radius bulges
 * outside the chord they span, so a surface point just inside a chart can fall
 * marginally outside its box. 1e-4 of an Earth radius is about 640 m, far below
 * a chart and safely above that bulge; it only ever adds a triangle test.
 */
const CAO_FOUNDATION_COVERAGE_BOUNDS_EPSILON = 1e-4;

export interface CaoFoundationCoverageOptions {
  /** Count batch-shelf charts as coverage. Default true, matching picking. */
  readonly includeShelf?: boolean;
}
/** Radial start height and accepted hit range for the exact coverage test. */
const CAO_FOUNDATION_COVERAGE_RAY_MARGIN = 0.05;

function pointInsideBounds(
  x: number,
  y: number,
  z: number,
  bounds: Float32Array,
  offset: number,
  epsilon: number,
): boolean {
  return x >= bounds[offset]! - epsilon && x <= bounds[offset + 3]! + epsilon
    && y >= bounds[offset + 1]! - epsilon && y <= bounds[offset + 4]! + epsilon
    && z >= bounds[offset + 2]! - epsilon && z <= bounds[offset + 5]! + epsilon;
}

/**
 * Whether any active chart covers a direction — the cheap coverage question,
 * without the nearest-hit bookkeeping a pick needs.
 *
 * A pick ray crosses the whole globe, so it must triangle-test every chart
 * whose box it clips, including the far side. A direction is a point, so the
 * box test here prunes to the handful of charts that actually contain it and
 * the exact triangle pass runs only for those: the cost is O(active charts)
 * plus a few triangle tests. Batch precedence does not apply — any covering
 * chart answers true — and an inactive chart (a plate not yet born at the
 * requested age) is skipped exactly as the pick path skips it.
 *
 * `includeShelf: false` narrows the question to charts drawn with the land
 * appearance, which is what a caller keying off "is this land, or water of any
 * depth" needs. It does not change picking.
 */
export function caoFoundationSurfaceCoversDirection(
  geometry: CaoFoundationGeometryResource,
  publication: Pick<CaoFoundationPublicationResource, "chartPoses" | "chartActive">,
  rendererDirection: Vec3Tuple,
  options: CaoFoundationCoverageOptions = {},
): boolean {
  const includeShelf = options.includeShelf ?? true;
  const length = Math.hypot(...rendererDirection);
  if (!rendererDirection.every(Number.isFinite) || !(length > 1e-12)) {
    throw new Error("Cao coverage direction must be finite and non-zero");
  }
  const unit = rendererDirection.map((value) => value / length) as unknown as Vec3Tuple;
  const gplatesDirection = rendererToGplatesDirection(numberScalarOps, unit);
  const [gx, gy, gz] = gplatesDirection;
  const poses = publication.chartPoses;
  for (const batch of geometry.batches) {
    if (!includeShelf && caoFoundationBatchAppearance(batch.batchId) === "shelf") continue;
    const shellRadius = 1 + caoFoundationShellOffsetMetres(batch.batchId) / EARTH_RADIUS_METRES;
    for (let rangeOffset = 0, boundsOffset = 0;
      rangeOffset < batch.chartRanges.length; rangeOffset += 4, boundsOffset += 6) {
      const chartIndex = batch.chartRanges[rangeOffset]!;
      if (publication.chartActive[chartIndex] !== 1) continue;
      const poseOffset = chartIndex * 8;
      // rotateDirection inlined on scalars: this runs once per active chart per
      // probe, where the generic ops indirection and its array allocation
      // dominated the whole classification round.
      const w = poses[poseOffset + 4]!;
      const qx = poses[poseOffset + 5]!;
      const qy = poses[poseOffset + 6]!;
      const qz = poses[poseOffset + 7]!;
      const tx = 2 * (qy * gz - qz * gy);
      const ty = 2 * (qz * gx - qx * gz);
      const tz = 2 * (qx * gy - qy * gx);
      const sx = gx + w * tx + (qy * tz - qz * ty);
      const sy = gy + w * ty + (qz * tx - qx * tz);
      const sz = gz + w * tz + (qx * ty - qy * tx);
      if (!pointInsideBounds(sx * shellRadius, sy * shellRadius, sz * shellRadius,
        batch.chartBounds, boundsOffset, CAO_FOUNDATION_COVERAGE_BOUNDS_EPSILON)) continue;
      // Boxes overlap between neighbouring charts, so confirm against the
      // triangles with a radial ray from just above this batch's shell.
      const margin = CAO_FOUNDATION_COVERAGE_RAY_MARGIN;
      const start = shellRadius + margin;
      const origin = [sx * start, sy * start, sz * start] as unknown as Vec3Tuple;
      const inward = [-sx, -sy, -sz] as unknown as Vec3Tuple;
      const firstTriangle = batch.chartRanges[rangeOffset + 1]!;
      const triangleCount = batch.chartRanges[rangeOffset + 2]!;
      for (let triangle = firstTriangle; triangle < firstTriangle + triangleCount; triangle += 1) {
        const vertices = [0, 1, 2].map((corner) => {
          const vertex = batch.source.indices[triangle * 3 + corner]!;
          const direction = tupleAt(batch.source.referenceDirections, vertex * 3);
          return direction.map((value) => value * shellRadius) as unknown as Vec3Tuple;
        }) as unknown as readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple];
        const hit = intersectRayTriangle(origin, inward, vertices[0], vertices[1], vertices[2]);
        // Only the near crossing counts; the far side of the shell is 2 R away.
        if (hit !== null && hit.distance <= margin * 2) return true;
      }
    }
  }
  return false;
}

export function intersectCaoFoundationSurface(
  geometry: CaoFoundationGeometryResource,
  publication: Pick<CaoFoundationPublicationResource, "chartPoses" | "chartActive">,
  rayOrigin: Vec3Tuple,
  rawRayDirection: Vec3Tuple,
  maximumTestedTriangles = 65_536,
): CaoFoundationSurfaceHit | null {
  if (![...rayOrigin, ...rawRayDirection].every(Number.isFinite)) {
    throw new Error("Cao sparse picking ray must be finite");
  }
  const rayLength = Math.hypot(...rawRayDirection);
  if (!(rayLength > 1e-12) || !Number.isSafeInteger(maximumTestedTriangles)
      || maximumTestedTriangles < 1) {
    throw new Error("Cao sparse picking ray or triangle bound is invalid");
  }
  const rayDirection = rawRayDirection.map((value) => value / rayLength) as unknown as Vec3Tuple;
  const gplatesOrigin = rendererToGplatesDirection(numberScalarOps, rayOrigin);
  const gplatesDirection = rendererToGplatesDirection(numberScalarOps, rayDirection);
  let testedTriangles = 0;
  let nearestNativeLand: CaoFoundationSurfaceHit | null = null;
  let nearestShelf: CaoFoundationSurfaceHit | null = null;
  let nearestCorrection: CaoFoundationSurfaceHit | null = null;
  for (const batch of geometry.batches) {
    const shellRadius = 1 + caoFoundationShellOffsetMetres(batch.batchId) / EARTH_RADIUS_METRES;
    for (let rangeOffset = 0, boundsOffset = 0;
      rangeOffset < batch.chartRanges.length; rangeOffset += 4, boundsOffset += 6) {
      const chartIndex = batch.chartRanges[rangeOffset]!;
      if (publication.chartActive[chartIndex] !== 1) continue;
      const poseOffset = chartIndex * 8;
      const pose = publication.chartPoses.subarray(poseOffset, poseOffset + 4) as unknown as QuaternionWxyz;
      const inversePose = publication.chartPoses.subarray(poseOffset + 4, poseOffset + 8) as unknown as QuaternionWxyz;
      const sourceOrigin = rotateDirection(numberScalarOps, inversePose, gplatesOrigin);
      const sourceDirection = rotateDirection(numberScalarOps, inversePose, gplatesDirection);
      const opaqueGlobeDistance = firstOpaqueGlobeIntersectionDistance(sourceOrigin, sourceDirection);
      if (!rayIntersectsBounds(sourceOrigin, sourceDirection, batch.chartBounds, boundsOffset)) continue;
      const firstTriangle = batch.chartRanges[rangeOffset + 1]!;
      const triangleCount = batch.chartRanges[rangeOffset + 2]!;
      testedTriangles += triangleCount;
      if (testedTriangles > maximumTestedTriangles) return null;
      for (let triangle = firstTriangle; triangle < firstTriangle + triangleCount; triangle += 1) {
        const vertices = [0, 1, 2].map((corner) => {
          const vertex = batch.source.indices[triangle * 3 + corner]!;
          const direction = tupleAt(batch.source.referenceDirections, vertex * 3);
          return direction.map((value) => value * shellRadius) as unknown as Vec3Tuple;
        }) as unknown as readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple];
        const hit = intersectRayTriangle(sourceOrigin, sourceDirection,
          vertices[0], vertices[1], vertices[2]);
        const visibleBeforeOpaqueGlobe = hit && (opaqueGlobeDistance === null
          || hit.distance <= opaqueGlobeDistance + 1e-7);
        const nearest = batch.nativePrecedence ? nearestCorrection
          : batch.batchId === "batch-shelf" ? nearestShelf : nearestNativeLand;
        if (!hit || !visibleBeforeOpaqueGlobe || (nearest !== null && hit.distance >= nearest.distance)) continue;
        const posed = rotateDirection(numberScalarOps, pose, hit.position);
        const rendererPosition = gplatesToRendererDirection(numberScalarOps, posed);
        const chart = geometry.chartIdentities[chartIndex]!;
        const length = Math.hypot(...hit.position);
        const referenceDirection: UnitDirection = [
          hit.position[0] / length,
          hit.position[1] / length,
          hit.position[2] / length,
        ];
        const candidate = { batchId: batch.batchId, chartIndex, triangleIndex: triangle,
          distance: hit.distance, position: rendererPosition,
          materialAddress: Object.freeze({ ...chart, cellOrTriangleId: 0,
            localCoordinate: Object.freeze({ kind: "chart-direction" as const,
              directionAtReference: Object.freeze([...referenceDirection]) as UnitDirection }) }) };
        if (batch.nativePrecedence) nearestCorrection = candidate;
        else if (batch.batchId === "batch-shelf") nearestShelf = candidate;
        else nearestNativeLand = candidate;
      }
    }
  }
  return nearestNativeLand ?? nearestCorrection ?? nearestShelf;
}

/**
 * Owns the single Cao land surface. Static source geometry is copied once;
 * requested ages replace only a bounded palette/material publication.
 */
export class CaoFoundationSurfaceRenderer {
  private readonly publisher = new AtomicPrototypePublisher<CaoFoundationPublicationResource>();
  private staticGeometry: CaoFoundationGeometryResource | null = null;
  private disposed = false;
  private domainVisible = true;

  constructor(
    private readonly parent: THREE.Group,
    private readonly retirement: GpuRetirementOwner,
    private readonly limits: CaoFoundationLimits,
  ) {}

  publish(revision: PreparedCaoRevision, verticalExaggeration: number): CaoFoundationDiagnostics {
    if (this.disposed) throw new Error("Cao foundation renderer is disposed");
    if (!Number.isFinite(revision.requestedAgeMa) || revision.requestedAgeMa < 0) {
      revision.release();
      throw new Error("Cao foundation requested age is invalid");
    }
    const token = this.publisher.begin(revision.identity);
    let resource: CaoFoundationPublicationResource | null = null;
    try {
      const reservation = estimateCaoFoundationGeometryReservation(revision, this.limits);
      const expectedStaticKey = `${revision.packageId}@${revision.packageRevision}:${[
        ...revision.batches.map((batch) => batch.staticGeometryIdentity),
        ...revision.lineBatches.map((batch) => batch.staticGeometryIdentity),
      ].join("|")}`;
      if (!this.staticGeometry || this.staticGeometry.key !== expectedStaticKey) {
        if (this.staticGeometry) throw new Error("Cao foundation static geometry changed within renderer lifetime");
        this.staticGeometry = createCaoFoundationGeometryResource(revision, this.limits);
        if (this.staticGeometry.byteLength > reservation) throw new Error("Cao static geometry reservation mismatch");
      }
      const packed = packPreparedCaoPalette(revision, this.limits.maxTextureSize);
      const publicationBytes = safeAdd(safeAdd(safeAdd(packed.data.byteLength,
        revision.charts.length * (8 * Float32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT),
        "Cao publication"), estimateNativeBoundaryBufferBytes(revision), "Cao publication"),
      estimateTopologyOwnershipBytes(revision), "Cao publication");
      if (!Number.isSafeInteger(this.limits.maxPublicationBytes) || this.limits.maxPublicationBytes < 1
          || publicationBytes > this.limits.maxPublicationBytes - this.publisher.retainedBytes()) {
        throw new Error("Cao foundation palette publication exceeds limit");
      }
      const previous = this.publisher.current();
      if (previous && (this.retirement.pendingCount() + 1 > this.retirement.maxPendingResources
          || this.retirement.pendingBytes() + previous.resources.byteLength > this.retirement.maxPendingBytes)) {
        throw new Error("Cao foundation GPU retirement backpressure bound exceeded");
      }
      resource = createPublicationResource(revision, this.staticGeometry, packed,
        verticalExaggeration, this.retirement);
      if (!this.publisher.stage(token, revision.requestedAgeMa, "settled", resource)) {
        throw new Error("Cao foundation publication became stale");
      }
      this.parent.add(resource.group);
      const publication = this.publisher.commit(token);
      if (!publication) {
        this.parent.remove(resource.group);
        throw new Error("Cao foundation publication commit failed");
      }
      if (previous) this.parent.remove(previous.resources.group);
      this.domainVisible = true;
      resource = null;
      revision.release();
      return this.diagnostics();
    } catch (error) {
      resource?.disposeUnsubmitted();
      revision.release();
      throw error;
    }
  }

  diagnostics(): CaoFoundationDiagnostics {
    const current = this.publisher.current();
    const batches = this.staticGeometry?.batches ?? [];
    return Object.freeze({
      identity: current?.requestId ?? null,
      staticGeometryIdentity: this.staticGeometry?.key ?? null,
      materialCorrectionIdentity: current?.resources.materialCorrectionIdentity ?? null,
      materialCorrections: current?.resources.materialCorrections ?? Object.freeze({
        observedActiveCharts: 0,
        classifiedShallowMarineActiveCharts: 0,
        qualifiedActiveCharts: 0,
        uncertainActiveCharts: 0,
        formationUncertainActiveCharts: 0,
        modelInferredPoseActiveCharts: 0,
        overriddenNativeCharts: 0,
        activeSourceIds: Object.freeze([]),
        correctionIds: Object.freeze([]),
      }),
      requestedAgeMa: current?.resources.requestedAgeMa ?? current?.ageMa ?? null,
      batches: batches.length,
      vertices: batches.reduce((sum, batch) => sum + batch.vertexCount, 0),
      triangles: batches.reduce((sum, batch) => sum + batch.triangleCount, 0),
      drawCount: this.domainVisible
        ? current?.resources.group.children.filter((child) => child.visible).length ?? 0 : 0,
      countryLineBatches: this.staticGeometry?.lineBatches.length ?? 0,
      countryLineVertices: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.vertexCount, 0) ?? 0,
      countryLineSegments: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.segmentCount, 0) ?? 0,
      nativeBoundarySegments: this.domainVisible ? current?.resources.nativeBoundarySegments ?? 0 : 0,
      nativeBoundarySourceAgeMa: this.domainVisible ? current?.resources.nativeBoundarySourceAgeMa ?? null : null,
      topologyOwnershipRings: this.domainVisible ? current?.resources.topologyOwnership?.rings.length ?? 0 : 0,
      topologyOwnershipSourceAgeMa: this.domainVisible
        ? current?.resources.topologyOwnership?.sourceAgeMa ?? null : null,
      retainedStaticBytes: this.staticGeometry?.byteLength ?? 0,
      activeSourceBytes: current?.resources.activeSourceBytes ?? 0,
      retainedPublicationBytes: this.publisher.retainedBytes(),
      pendingRetirementBytes: this.retirement.pendingBytes(),
      paletteEntries: current?.resources.paletteEntries ?? 0,
      shellOffsetMetres: CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
    });
  }

  intersectRay(
    rayOrigin: Vec3Tuple,
    rayDirection: Vec3Tuple,
    maximumTestedTriangles = 65_536,
  ): CaoFoundationSurfaceHit | null {
    const current = this.publisher.current();
    if (!this.domainVisible || !this.staticGeometry || !current) return null;
    return intersectCaoFoundationSurface(this.staticGeometry, current.resources,
      rayOrigin, rayDirection, maximumTestedTriangles);
  }

  /**
   * Whether the surface currently on screen covers this direction with land,
   * shelf or correction material. Read-only and allocation-light; returns false
   * whenever the domain is hidden or nothing is published, matching intersectRay.
   */
  coversDirection(
    rendererDirection: UnitDirection,
    options: CaoFoundationCoverageOptions = {},
  ): boolean {
    const current = this.publisher.current();
    if (!this.domainVisible || !this.staticGeometry || !current) return false;
    return caoFoundationSurfaceCoversDirection(this.staticGeometry, current.resources,
      [...rendererDirection] as unknown as Vec3Tuple, options);
  }

  identifyTopology(rendererDirection: UnitDirection): InstantaneousOwnershipResult | null {
    const current = this.publisher.current();
    return this.domainVisible ? current?.resources.identifyTopology(rendererDirection) ?? null : null;
  }

  setDomainVisibility(visible: boolean): CaoFoundationDiagnostics {
    this.domainVisible = visible;
    const current = this.publisher.current();
    if (current) current.resources.group.visible = visible;
    return this.diagnostics();
  }

  setLayerVisibility(borders: boolean, tectonics: boolean): void {
    const current = this.publisher.current();
    if (!current) return;
    for (const child of current.resources.group.children) {
      if (child.userData.overlayLayer === "borders") child.visible = borders;
      if (child.userData.overlayLayer === "tectonics") child.visible = tectonics;
    }
    current.resources.setNativeBoundaryLayerVisibility(tectonics);
  }

  /**
   * Continuous scrub path: update the resident palette/poses/display fraction
   * without tearing down static geometry or blanking the globe.
   */
  retargetMotion(
    paletteValues: Float32Array,
    entryCount: number,
    displayFraction: number,
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    requestedAgeMa: number,
    materialCorrections: PreparedCaoRevision["materialCorrections"],
  ): CaoFoundationDiagnostics {
    if (this.disposed) throw new Error("Cao foundation renderer is disposed");
    const current = this.publisher.current();
    if (!current) throw new Error("Cao foundation has no published surface to retarget");
    const packed = packCaoPaletteValues(paletteValues, entryCount, this.limits.maxTextureSize);
    current.resources.retargetMotion(
      packed, displayFraction, chartPoses, chartActive, requestedAgeMa, materialCorrections,
    );
    this.domainVisible = true;
    current.resources.group.visible = true;
    return this.diagnostics();
  }

  setVerticalExaggeration(value: number): void {
    if (!Number.isFinite(value) || value < 1 || value > 30) {
      throw new Error("Cao vertical exaggeration is outside the supported range");
    }
    this.publisher.current()?.resources.setVerticalExaggeration(value);
  }

  clear(): void {
    if (this.disposed) return;
    const current = this.publisher.current();
    if (current) this.parent.remove(current.resources.group);
    this.publisher.dispose();
  }

  /** Renderer loop must be stopped; backend teardown follows immediately. */
  disposeForRendererTeardown(): void {
    if (this.disposed) return;
    this.disposed = true;
    const current = this.publisher.current();
    if (current) this.parent.remove(current.resources.group);
    this.publisher.dispose();
    // The backend teardown immediately following this call owns the final GPU
    // release. Dispatching BufferGeometry.dispose() before that teardown can
    // destroy a buffer still referenced by the renderer's last submission.
    this.staticGeometry = null;
  }
}

import * as THREE from "three";
import { DoubleSide, LineBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { attribute, float, int, ivec2, step, textureLoad, uniform, vec3 } from "three/tsl";
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
  type UnitDirection,
} from "../../reconstruction/arithmetic";
import { evaluateForwardPatchVertex } from "./patchKernel";
import type { GpuRetirementOwner } from "./gpuRetirement";
import { AtomicPrototypePublisher, type OwnedPrototypeResources } from "./publication";
import { tslScalarOps } from "./terrainNodes";
import { intersectRayTriangle } from "./picking";
import type { Vec3Tuple } from "./bounds";

/** Display separation only; source physical height remains zero/unknown. */
export const CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES = 400;
export const CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES = 1_800;
export const CAO_FOUNDATION_BOUNDARY_LINE_OFFSET_METRES = 2_200;
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
}

export interface CaoFoundationDiagnostics {
  readonly identity: string | null;
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
): { chartRanges: Uint32Array; chartBounds: Float32Array } {
  const chartRanges = new Uint32Array(ranges.length * 4);
  const chartBounds = new Float32Array(ranges.length * 6);
  const shellRadius = 1 + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES;
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

export function packPreparedCaoPalette(
  revision: PreparedCaoRevision,
  maxTextureSize: number,
): PackedCaoPalette {
  const palette = revision.motionPalette;
  if (palette.stride !== PREPARED_MOTION_PALETTE_STRIDE || !Number.isSafeInteger(palette.entryCount)
      || palette.entryCount < 1 || !Number.isSafeInteger(maxTextureSize) || maxTextureSize < 3) {
    throw new Error("invalid prepared Cao palette shape");
  }
  const values = palette.createValuesCopy();
  const expectedValues = palette.entryCount * PREPARED_MOTION_PALETTE_STRIDE;
  if (!Number.isSafeInteger(expectedValues) || values.length !== expectedValues || !allFinite(values)) {
    throw new Error("invalid prepared Cao palette values");
  }
  for (let entry = 0; entry < palette.entryCount; entry += 1) {
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
  const texelCount = palette.entryCount * 3;
  const width = Math.min(CAO_FOUNDATION_PALETTE_TEXEL_WIDTH, maxTextureSize);
  const height = Math.ceil(texelCount / width);
  if (height > maxTextureSize) throw new Error("prepared Cao palette exceeds backend texture bound");
  const data = new Float32Array(width * height * 4);
  for (let entry = 0; entry < palette.entryCount; entry += 1) {
    const source = entry * PREPARED_MOTION_PALETTE_STRIDE;
    const target = entry * 12;
    data.set(values.subarray(source, source + PREPARED_MOTION_PALETTE_STRIDE), target);
  }
  return Object.freeze({ data, width, height, entryCount: palette.entryCount });
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
): CaoFoundationMaterialGraph {
  const displayHeightStart = display.displayHeightStart.kind === "uniform"
    ? float(display.displayHeightStart.value) : attribute<"float">("displayHeightStartMetres", "float");
  const displayHeightEnd = display.displayHeightEnd.kind === "uniform"
    ? float(display.displayHeightEnd.value) : attribute<"float">("displayHeightEndMetres", "float");
  const pose = createPreparedCaoPoseNodes(paletteTexture, paletteWidth,
    displayFractionValue, verticalExaggerationValue, displayHeightStart,
    displayHeightEnd, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES);
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.82, metalness: 0 });
  material.positionNode = pose.position;
  material.normalNode = pose.direction;
  material.colorNode = display.baseColor.kind === "uniform"
    ? vec3(...display.baseColor.value) : attribute<"vec3">("color", "vec3");
  return Object.freeze({ material, displayFraction: pose.displayFraction,
    verticalExaggeration: pose.verticalExaggeration });
}

export function createCaoFoundationCountryLineMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
): CaoFoundationLineMaterialGraph {
  const pose = createPreparedCaoPoseNodes(paletteTexture, paletteWidth,
    displayFractionValue, 1, float(0), float(0), CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES);
  const material = new LineBasicNodeMaterial({ color: 0x739a91, transparent: true,
    opacity: 0.78, depthTest: true, depthWrite: false });
  material.positionNode = pose.position;
  return Object.freeze({ material, displayFraction: pose.displayFraction });
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
        prepared.triangleCount, revision.charts.length);
      retainedCpuBytes = safeAdd(retainedCpuBytes,
        spatial.chartRanges.byteLength + spatial.chartBounds.byteLength, "Cao retained spatial index");
      resources.push(Object.freeze({ batchId: prepared.batchId, geometry, source,
        vertexCount: prepared.vertexCount, triangleCount: prepared.triangleCount,
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

  constructor(
    readonly group: THREE.Group,
    readonly byteLength: number,
    readonly paletteEntries: number,
    readonly activeSourceBytes: number,
    readonly chartPoses: Float32Array,
    readonly chartActive: Uint8Array,
    readonly nativeBoundarySegments: number,
    readonly nativeBoundarySourceAgeMa: number | null,
    readonly topologyOwnership: CaoTopologyOwnershipState | null,
    private readonly palette: THREE.DataTexture,
    private readonly materials: readonly THREE.Material[],
    private readonly verticalExaggerations: readonly UniformNode<"float", number>[],
    private readonly publicationGeometries: readonly THREE.BufferGeometry[],
    private readonly retirement: GpuRetirementOwner,
  ) {}

  disposeUnsubmitted(): void {
    this.dispose();
  }

  setVerticalExaggeration(value: number): void {
    for (const exaggeration of this.verticalExaggerations) exaggeration.value = value;
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
      const graph = createCaoFoundationMaterial(paletteTexture, packed.width, display,
        revision.display.fraction, verticalExaggeration);
      materials.push(graph.material);
      verticalExaggerations.push(graph.verticalExaggeration);
      const mesh = new THREE.Mesh(batch.geometry, graph.material);
      // Source batches do not yet carry qualified moving interval bounds.
      // Drawing all foundation batches preserves coverage until those arrive.
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      group.add(mesh);
    }
    for (let index = 0; index < geometry.lineBatches.length; index += 1) {
      const batch = geometry.lineBatches[index]!;
      const prepared = revision.lineBatches[index];
      if (!prepared || prepared.batchId !== batch.batchId) {
        throw new Error("Cao country line batch order/identity changed");
      }
      const graph = createCaoFoundationCountryLineMaterial(paletteTexture, packed.width,
        revision.display.fraction);
      materials.push(graph.material);
      const lines = new THREE.LineSegments(batch.geometry, graph.material);
      lines.frustumCulled = false;
      lines.renderOrder = 3;
      lines.userData.overlayLayer = "borders";
      lines.userData.evidence = "modern-country-reference-reconstructed-with-cao";
      group.add(lines);
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
      pickState.chartPoses, pickState.chartActive,
      nativeBoundary.segmentCount, nativeBoundary.sourceAgeMa,
      topologyOwnership,
      paletteTexture, Object.freeze(materials), Object.freeze(verticalExaggerations),
      Object.freeze(publicationGeometries), retirement);
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
  const shellRadius = 1 + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES;
  let testedTriangles = 0;
  let nearest: CaoFoundationSurfaceHit | null = null;
  for (const batch of geometry.batches) {
    for (let rangeOffset = 0, boundsOffset = 0;
      rangeOffset < batch.chartRanges.length; rangeOffset += 4, boundsOffset += 6) {
      const chartIndex = batch.chartRanges[rangeOffset]!;
      if (publication.chartActive[chartIndex] !== 1) continue;
      const poseOffset = chartIndex * 8;
      const pose = publication.chartPoses.subarray(poseOffset, poseOffset + 4) as unknown as QuaternionWxyz;
      const inversePose = publication.chartPoses.subarray(poseOffset + 4, poseOffset + 8) as unknown as QuaternionWxyz;
      const sourceOrigin = rotateDirection(numberScalarOps, inversePose, gplatesOrigin);
      const sourceDirection = rotateDirection(numberScalarOps, inversePose, gplatesDirection);
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
        if (!hit || (nearest !== null && hit.distance >= nearest.distance)) continue;
        const posed = rotateDirection(numberScalarOps, pose, hit.position);
        const rendererPosition = gplatesToRendererDirection(numberScalarOps, posed);
        const chart = geometry.chartIdentities[chartIndex]!;
        const length = Math.hypot(...hit.position);
        const referenceDirection: UnitDirection = [
          hit.position[0] / length,
          hit.position[1] / length,
          hit.position[2] / length,
        ];
        nearest = { batchId: batch.batchId, chartIndex, triangleIndex: triangle,
          distance: hit.distance, position: rendererPosition,
          materialAddress: Object.freeze({ ...chart, cellOrTriangleId: 0,
            localCoordinate: Object.freeze({ kind: "chart-direction" as const,
              directionAtReference: Object.freeze([...referenceDirection]) as UnitDirection }) }) };
      }
    }
  }
  return nearest;
}

/**
 * Owns the single Cao land surface. Static source geometry is copied once;
 * requested ages replace only a bounded palette/material publication.
 */
export class CaoFoundationSurfaceRenderer {
  private readonly publisher = new AtomicPrototypePublisher<CaoFoundationPublicationResource>();
  private staticGeometry: CaoFoundationGeometryResource | null = null;
  private disposed = false;

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
      requestedAgeMa: current?.ageMa ?? null,
      batches: batches.length,
      vertices: batches.reduce((sum, batch) => sum + batch.vertexCount, 0),
      triangles: batches.reduce((sum, batch) => sum + batch.triangleCount, 0),
      drawCount: current?.resources.group.children.length ?? 0,
      countryLineBatches: this.staticGeometry?.lineBatches.length ?? 0,
      countryLineVertices: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.vertexCount, 0) ?? 0,
      countryLineSegments: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.segmentCount, 0) ?? 0,
      nativeBoundarySegments: current?.resources.nativeBoundarySegments ?? 0,
      nativeBoundarySourceAgeMa: current?.resources.nativeBoundarySourceAgeMa ?? null,
      topologyOwnershipRings: current?.resources.topologyOwnership?.rings.length ?? 0,
      topologyOwnershipSourceAgeMa: current?.resources.topologyOwnership?.sourceAgeMa ?? null,
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
    if (!this.staticGeometry || !current) return null;
    return intersectCaoFoundationSurface(this.staticGeometry, current.resources,
      rayOrigin, rayDirection, maximumTestedTriangles);
  }

  identifyTopology(rendererDirection: UnitDirection): InstantaneousOwnershipResult | null {
    const current = this.publisher.current();
    return current?.resources.identifyTopology(rendererDirection) ?? null;
  }

  setLayerVisibility(borders: boolean, tectonics: boolean): void {
    const current = this.publisher.current();
    if (!current) return;
    for (const child of current.resources.group.children) {
      if (child.userData.overlayLayer === "borders") child.visible = borders;
      if (child.userData.overlayLayer === "tectonics") child.visible = tectonics;
    }
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

import { BufferAttribute, BufferGeometry, FloatType, Mesh, OrthographicCamera, PerspectiveCamera, Points,
  RGBAFormat, RenderTarget, Scene, Vector3 } from "three";
import { NoToneMapping, PointsNodeMaterial, WebGPURenderer } from "three/webgpu";
import { Fn, vec3, vec4, varyingProperty } from "three/tsl";
import catalogJson from "../../src/reconstruction/fixtures/cao-motion-0-5-v1.json";
import oracleJson from "../../src/reconstruction/fixtures/cao-motion-0-5-v1.oracle.json";
import binaryUrl from "../../src/reconstruction/fixtures/cao-motion-0-5-v1.bin?url";
import { decodeVerifiedMotionTable, selectMotionSubsegment, type MotionCatalog } from "../../src/reconstruction";
import { computeSweptBounds } from "../../src/render/reconstruction/bounds";
import { GpuRetirementOwner, WebGl2SubmissionFence,
  WebGpuSubmissionFence } from "../../src/render/reconstruction/gpuRetirement";
import { createForwardPatchGeometry, forwardPatchByteLength,
  type ForwardPatchControls, type ForwardPatchData } from "../../src/render/reconstruction/patchGeometry";
import { buildPatchStitchFanIndices, selectPatchLod, type PatchLodNode } from "../../src/render/reconstruction/patchLod";
import { evaluateForwardPatchVertexAt, intersectForwardPatchBvh } from "../../src/render/reconstruction/picking";
import { BoundedGpuResourcePool } from "../../src/render/reconstruction/resourcePool";
import { applyPatchBvhGeometryBounds, buildPatchBvh,
  triangleBoundsFromPhysicalVertexBounds } from "../../src/render/reconstruction/spatialIndex";
import { createForwardPatchNodeGraph, createForwardPatchNodeMaterial,
  updateForwardPatchUniforms } from "../../src/render/reconstruction/terrainNodes";

declare global { interface Window { runReconstructionGpuProof(): Promise<unknown> } }

const catalog = catalogJson as MotionCatalog;
const oracle = oracleJson as { referenceDirection: [number, number, number]; angularToleranceRad: number;
  expected: Array<{ ageMa: number; direction: [number, number, number] }> };

const representativeGridSize = 33;
const representativeTriangleCount = 1_552;
const benchmarkPolicy = Object.freeze({
  workload: `${representativeGridSize}x${representativeGridSize} rigid material patch (${representativeTriangleCount} triangles)`,
  warmupIterations: 10,
  cpuRepetitions: 100,
  gpuRepetitions: 60,
  stops: Object.freeze({ bvhBuildMedianMs: 100, lodSelectionMedianMs: 16,
    sparsePickMedianMs: 16, renderSubmissionCallP95Ms: 20 }),
});

function normalize(values: readonly number[]): [number, number, number] {
  const length = Math.hypot(...values);
  return [values[0]! / length, values[1]! / length, values[2]! / length];
}

function cross(left: readonly number[], right: readonly number[]): [number, number, number] {
  return [left[1]! * right[2]! - left[2]! * right[1]!,
    left[2]! * right[0]! - left[0]! * right[2]!,
    left[0]! * right[1]! - left[1]! * right[0]!];
}

function createRepresentativePatch(): ForwardPatchData {
  const center = normalize(oracle.referenceDirection);
  const east = normalize(cross([0, 0, 1], center));
  const north = normalize(cross(center, east));
  const directions: number[] = [];
  const heights: number[] = [];
  const colors: number[] = [];
  const seams: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row < representativeGridSize; row += 1) {
    const v = row / (representativeGridSize - 1);
    for (let column = 0; column < representativeGridSize; column += 1) {
      const u = column / (representativeGridSize - 1);
      const offsetX = (u - 0.5) * 0.24;
      const offsetY = (v - 0.5) * 0.24;
      directions.push(...normalize(center.map((value, axis) => value + east[axis]! * offsetX + north[axis]! * offsetY)));
      heights.push(700 + 2_300 * Math.sin(Math.PI * u) ** 2 * Math.sin(Math.PI * v) ** 2);
      colors.push(0.24 + 0.24 * v, 0.34 + 0.25 * u, 0.16);
      seams.push(column === 16 ? 10_000 + row : 0);
    }
  }
  // West is one row coarser than east. The boundary strip is triangulated
  // against every fine seam vertex, so the actual GPU mesh applies the stitch.
  for (let row = 0; row < representativeGridSize - 1; row += 2) {
    for (let column = 0; column < 15; column += 1) {
      const a = row * representativeGridSize + column;
      const b = a + 1;
      const c = a + representativeGridSize * 2;
      const d = c + 1;
      indices.push(a, b, c, c, b, d);
    }
    const interiorLow = row * representativeGridSize + 15;
    const interiorHigh = (row + 2) * representativeGridSize + 15;
    const seamLow = row * representativeGridSize + 16;
    const seamMiddle = (row + 1) * representativeGridSize + 16;
    const seamHigh = (row + 2) * representativeGridSize + 16;
    indices.push(...buildPatchStitchFanIndices([
      { stitch: { seamId: "center", coarseKey: "west", fineKey: "east", start: row / 32, end: (row + 2) / 32 },
        coarseInteriorVertex: interiorLow, fineBoundaryVertices: [seamLow, seamMiddle] },
      { stitch: { seamId: "center", coarseKey: "west", fineKey: "east", start: row / 32, end: (row + 2) / 32 },
        coarseInteriorVertex: interiorHigh, fineBoundaryVertices: [seamMiddle, seamHigh] },
    ]));
    indices.push(interiorLow, seamMiddle, interiorHigh);
  }
  for (let row = 0; row < representativeGridSize - 1; row += 1) {
    for (let column = 16; column < representativeGridSize - 1; column += 1) {
      const a = row * representativeGridSize + column;
      const b = a + 1;
      const c = a + representativeGridSize;
      const d = c + 1;
      indices.push(a, b, c, c, b, d);
    }
  }
  const vertexCount = representativeGridSize ** 2;
  return {
    id: "representative-cao-rigid-grid",
    referenceDirections: new Float32Array(directions),
    deformingDirectionsStart: new Float32Array(vertexCount * 3),
    deformingDirectionsEnd: new Float32Array(vertexCount * 3),
    poseModes: new Float32Array(vertexCount),
    displayHeightsStartMetres: new Float32Array(heights),
    displayHeightsEndMetres: new Float32Array(heights.map((height) => height + 500)),
    activationStart: new Float32Array(vertexCount).fill(1),
    activationEnd: new Float32Array(vertexCount).fill(1),
    baseColors: new Float32Array(colors),
    seamIds: new Uint32Array(seams),
    materialIds: new Uint32Array(vertexCount).fill(301),
    indices: new Uint32Array(indices),
    evidence: "actual-rigid-oracle",
  };
}

function representativeLodNodes(): PatchLodNode[] {
  const edge = (side: "a" | "b", start: number, end: number) => [{ seamId: "center", side, start, end }] as const;
  return [
    { key: "west-0", level: 0, triangleCount: 528, projectedErrorPixels: 100, edges: edge("a", 0, 1), children: ["west-1a", "west-1b"] },
    { key: "west-1a", level: 1, triangleCount: 264, projectedErrorPixels: 80, edges: edge("a", 0, 0.5), children: ["west-2a", "west-2b"] },
    { key: "west-1b", level: 1, triangleCount: 264, projectedErrorPixels: 5, edges: edge("a", 0.5, 1) },
    { key: "west-2a", level: 2, triangleCount: 132, projectedErrorPixels: 2, edges: edge("a", 0, 0.25) },
    { key: "west-2b", level: 2, triangleCount: 132, projectedErrorPixels: 2, edges: edge("a", 0.25, 0.5) },
    { key: "east-0", level: 0, triangleCount: 1024, projectedErrorPixels: 5, edges: edge("b", 0, 1), children: ["east-1a", "east-1b"] },
    { key: "east-1a", level: 1, triangleCount: 512, projectedErrorPixels: 2, edges: edge("b", 0, 0.5) },
    { key: "east-1b", level: 1, triangleCount: 512, projectedErrorPixels: 2, edges: edge("b", 0.5, 1) },
  ];
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!;
}

window.runReconstructionGpuProof = async () => {
  const forceWebGL = new URLSearchParams(location.search).get("backend") === "webgl2";
  const mutation = new URLSearchParams(location.search).get("mutate") ?? "";
  const renderer = new WebGPURenderer({ forceWebGL, antialias: false });
  renderer.setSize(1, 1, false); renderer.toneMapping = NoToneMapping; renderer.outputColorSpace = "";
  await renderer.init();
  const bytes = await (await fetch(binaryUrl)).arrayBuffer();
  const corrupt = bytes.slice(0); new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 1;
  let digestMutationRejected = false;
  try { await decodeVerifiedMotionTable(catalog, corrupt); } catch { digestMutationRejected = true; }
  const interval = await decodeVerifiedMotionTable(catalog, bytes);
  const backend = renderer.backend as unknown as { device?: GPUDevice; gl?: WebGL2RenderingContext };
  backend.device?.pushErrorScope("validation");
  const geometry = new BufferGeometry();
  const direction = new Float32Array(oracle.referenceDirection);
  geometry.setAttribute("position", new BufferAttribute(direction, 3));
  geometry.setAttribute("referenceDirection", new BufferAttribute(direction, 3));
  geometry.setAttribute("deformingDirectionStart", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geometry.setAttribute("deformingDirectionEnd", new BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geometry.setAttribute("poseMode", new BufferAttribute(new Float32Array([0]), 1));
  geometry.setAttribute("displayHeightStartMetres", new BufferAttribute(new Float32Array([1_000]), 1));
  geometry.setAttribute("displayHeightEndMetres", new BufferAttribute(new Float32Array([5_000]), 1));
  geometry.setAttribute("activationStart", new BufferAttribute(new Float32Array([1]), 1));
  geometry.setAttribute("activationEnd", new BufferAttribute(new Float32Array([1]), 1));
  const graph = createForwardPatchNodeGraph();
  const witness = varyingProperty("vec3", "vReconstructionPosedWitness");
  const mutate = mutation === "axis";
  const posed = mutate ? vec3(graph.positionNode.x.negate(), graph.positionNode.y, graph.positionNode.z) : graph.positionNode;
  const material = new PointsNodeMaterial({ size: 8, sizeAttenuation: false });
  material.positionNode = Fn(() => { witness.assign(posed); return posed; })();
  material.colorNode = vec4(witness.mul(0.5).add(0.5), 1);
  const scene = new Scene(); const points = new Points(geometry, material); scene.add(points);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const target = new RenderTarget(1, 1, { type: FloatType, format: RGBAFormat });
  const results = [];
  const heightStart = 1_000, heightEnd = 5_000, displayFraction = 0.25, exaggeration = 2;
  const expectedScale = 1 + ((heightStart + (heightEnd - heightStart) * displayFraction) * exaggeration) / 6_371_000;
  for (const expected of oracle.expected) {
    const segment = selectMotionSubsegment(interval, expected.ageMa)!;
    updateForwardPatchUniforms(graph.uniforms, { motionStart: segment.younger.quaternion,
      motionEnd: segment.older.quaternion, motionFraction: segment.fraction, displayFraction,
      verticalExaggeration: exaggeration });
    const rendererExpected = [expected.direction[0] * expectedScale, expected.direction[2] * expectedScale,
      -expected.direction[1] * expectedScale] as const;
    camera.position.copy(new Vector3(...rendererExpected).multiplyScalar(3)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    renderer.setRenderTarget(target); await renderer.renderAsync(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1) as Float32Array;
    results.push({ ageMa: expected.ageMa, expected: rendererExpected, alpha: pixels[3], readCount: pixels.length,
      witness: [...pixels.slice(0, 3)].map((value) => value * 2 - 1) });
  }
  const programsBefore = renderer.info.memory.programs;
  for (const ageMa of [0.37, 2.73, 4.81]) {
    const segment = selectMotionSubsegment(interval, ageMa)!;
    updateForwardPatchUniforms(graph.uniforms, { motionStart: segment.younger.quaternion,
      motionEnd: segment.older.quaternion, motionFraction: segment.fraction, displayFraction: 0,
      verticalExaggeration: 1 });
    await renderer.renderAsync(scene, camera);
  }
  const programsAfter = renderer.info.memory.programs;
  const fencePixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1) as Float32Array;
  const shaders = await renderer.debug.getShaderAsync(scene, camera, points);
  const representativePatch = createRepresentativePatch();
  const representativeSegment = selectMotionSubsegment(interval, 2.5)!;
  const representativeControls: ForwardPatchControls = {
    motionStart: representativeSegment.younger.quaternion,
    motionEnd: representativeSegment.older.quaternion,
    motionFraction: representativeSegment.fraction,
    displayFraction: 0.5,
    verticalExaggeration: 8,
  };
  const vertexBounds = Array.from({ length: representativePatch.poseModes.length }, (_, vertexIndex) => {
    const samples = [0, 0.5, 1].map((motionFraction) => {
      const position = evaluateForwardPatchVertexAt(representativePatch,
        { ...representativeControls, motionFraction }, vertexIndex);
      return { direction: normalize(position), heightMetres:
        representativePatch.displayHeightsStartMetres[vertexIndex]! * (1 - representativeControls.displayFraction)
          + representativePatch.displayHeightsEndMetres[vertexIndex]! * representativeControls.displayFraction };
    });
    return computeSweptBounds(samples, { angularEnvelopeRadians: 0.002,
      minimumHeightMetres: representativePatch.displayHeightsStartMetres[vertexIndex]!,
      maximumHeightMetres: representativePatch.displayHeightsEndMetres[vertexIndex]!,
      maximumVerticalExaggeration: 30, maximumProceduralDisplacementMetres: 500,
      planetRadiusMetres: 6_371_000 });
  });
  const triangleBounds = triangleBoundsFromPhysicalVertexBounds(representativePatch, vertexBounds);
  const measure = <T>(warmup: number, repetitions: number, operation: () => T): { result: T; samplesMs: number[] } => {
    for (let index = 0; index < warmup; index += 1) operation();
    const samplesMs: number[] = [];
    let result!: T;
    for (let index = 0; index < repetitions; index += 1) {
      const start = performance.now(); result = operation(); samplesMs.push(performance.now() - start);
    }
    return { result, samplesMs };
  };
  const bvhMeasured = measure(benchmarkPolicy.warmupIterations, benchmarkPolicy.cpuRepetitions,
    () => buildPatchBvh(triangleBounds, 8));
  const lodMeasured = measure(benchmarkPolicy.warmupIterations, benchmarkPolicy.cpuRepetitions,
    () => selectPatchLod(representativeLodNodes(), ["west-0", "east-0"],
      { maxLevel: 2, maxLeaves: 5, maxTriangles: representativeTriangleCount,
        splitPixels: 20, mergePixels: 10 }));
  const centerVertex = Math.floor(representativePatch.poseModes.length / 2);
  const centerPosition = evaluateForwardPatchVertexAt(representativePatch, representativeControls, centerVertex);
  const rayOrigin = centerPosition.map((value) => value * 3) as [number, number, number];
  const rayDirection = centerPosition.map((value) => -value) as [number, number, number];
  const pickMeasured = measure(benchmarkPolicy.warmupIterations, benchmarkPolicy.cpuRepetitions,
    () => intersectForwardPatchBvh(representativePatch, representativeControls, bvhMeasured.result,
      rayOrigin, rayDirection));
  const fence = backend.device
    ? new WebGpuSubmissionFence(backend.device.queue)
    : new WebGl2SubmissionFence(backend.gl!);
  const retirement = new GpuRetirementOwner(fence, 2, 2 * 1024 * 1024);
  let disposed = false;
  const pool = new BoundedGpuResourcePool<{
    readonly byteLength: number;
    readonly geometry: BufferGeometry;
    readonly nodes: ReturnType<typeof createForwardPatchNodeMaterial>;
    dispose(): void;
  }>(2, 2 * 1024 * 1024, retirement);
  const representativeResourceBytes = forwardPatchByteLength(representativePatch);
  const lease = pool.acquire("representative-cao-rigid-grid", representativeResourceBytes, () => {
    const geometry = createForwardPatchGeometry(representativePatch);
    applyPatchBvhGeometryBounds(geometry, bvhMeasured.result);
    const nodes = createForwardPatchNodeMaterial(representativePatch);
    updateForwardPatchUniforms(nodes.graph.uniforms, representativeControls);
    return { byteLength: representativeResourceBytes, geometry, nodes,
      dispose: () => { geometry.dispose(); nodes.material.dispose(); disposed = true; } };
  });
  const reusedLease = pool.acquire("representative-cao-rigid-grid", representativeResourceBytes,
    () => { throw new Error("representative GPU resource was not reused"); });
  const reuseSameResource = reusedLease.resource === lease.resource;
  const representativeMesh = new Mesh(lease.resource.geometry, lease.resource.nodes.material);
  const representativeScene = new Scene(); representativeScene.add(representativeMesh);
  const representativeTarget = new RenderTarget(64, 64, { format: RGBAFormat });
  const representativeCamera = new PerspectiveCamera(36, 1, 0.1, 10);
  representativeCamera.position.copy(new Vector3(...centerPosition).multiplyScalar(3));
  representativeCamera.lookAt(0, 0, 0); representativeCamera.updateMatrixWorld();
  renderer.setSize(64, 64, false);
  renderer.setRenderTarget(representativeTarget);
  renderer.info.reset();
  for (let index = 0; index < benchmarkPolicy.warmupIterations; index += 1) {
    await renderer.renderAsync(representativeScene, representativeCamera);
  }
  const renderSubmissionCallMs: number[] = [];
  for (let index = 0; index < benchmarkPolicy.gpuRepetitions; index += 1) {
    const start = performance.now(); await renderer.renderAsync(representativeScene, representativeCamera);
    renderSubmissionCallMs.push(performance.now() - start);
  }
  const representativePixels = await renderer.readRenderTargetPixelsAsync(
    representativeTarget, 0, 0, 64, 64,
  ) as Uint8Array;
  const projectedCenter = new Vector3(...centerPosition).project(representativeCamera).toArray();
  const visiblePixelCount = Array.from({ length: representativePixels.length / 4 }, (_, index) => (
    representativePixels[index * 4 + 3]! > 1e-4 ? 1 : 0
  )).reduce((sum, value) => sum + value, 0);
  const coloredPixelCount = Array.from({ length: representativePixels.length / 4 }, (_, index) => (
    Math.max(representativePixels[index * 4]!, representativePixels[index * 4 + 1]!,
      representativePixels[index * 4 + 2]!) > 1e-4 ? 1 : 0
  )).reduce((sum, value) => sum + value, 0);
  const channelMaxima = [0, 1, 2, 3].map((channel) => Math.max(...Array.from(
    { length: representativePixels.length / 4 }, (_, index) => representativePixels[index * 4 + channel]!,
  )));
  updateForwardPatchUniforms(lease.resource.nodes.graph.uniforms,
    { ...representativeControls, activationStart: mutation === "lifecycle" ? 1 : 0, activationEnd: 0 });
  await renderer.renderAsync(representativeScene, representativeCamera);
  const inactivePixels = await renderer.readRenderTargetPixelsAsync(
    representativeTarget, 0, 0, 64, 64,
  ) as Uint8Array;
  const inactiveColoredPixelCount = Array.from({ length: inactivePixels.length / 4 }, (_, index) => (
    Math.max(inactivePixels[index * 4]!, inactivePixels[index * 4 + 1]!, inactivePixels[index * 4 + 2]!) > 0 ? 1 : 0
  )).reduce((sum, value) => sum + value, 0);
  representativeScene.remove(representativeMesh);
  reusedLease.release();
  lease.release();
  const retainedBeforeRetirement = pool.retainedBytes();
  await Promise.all(pool.retireIdle());
  const representative = {
    policy: benchmarkPolicy,
    patchId: representativePatch.id,
    vertexCount: representativePatch.poseModes.length,
    triangleCount: representativePatch.indices.length / 3,
    trackedPatchBufferBytes: forwardPatchByteLength(representativePatch),
    bvhBytes: bvhMeasured.result.byteLength,
    bvhMedianMs: percentile(bvhMeasured.samplesMs, 0.5),
    lodMedianMs: percentile(lodMeasured.samplesMs, 0.5),
    sparsePickMedianMs: percentile(pickMeasured.samplesMs, 0.5),
    renderSubmissionCallP95Ms: percentile(renderSubmissionCallMs, 0.95),
    candidateHit: pickMeasured.result?.triangleIndex ?? null,
    lodSelectionDiagnosticLeaves: lodMeasured.result.leaves.map((leaf) => leaf.key),
    lodSelectionDiagnosticTriangles: lodMeasured.result.totalTriangles,
    fixedMeshStitchFanCount: 2,
    visiblePixelCount,
    coloredPixelCount,
    channelMaxima,
    inactiveColoredPixelCount,
    projectedCenter,
    retainedBeforeRetirement,
    retainedAfterRetirement: pool.retainedBytes(),
    pendingAfterRetirement: retirement.pendingBytes(),
    disposed,
    reuseSameResource,
  };
  const representativePass = representative.candidateHit !== null
    && representative.coloredPixelCount > 0
    && representative.inactiveColoredPixelCount === 0
    && representative.retainedBeforeRetirement > 0 && representative.retainedAfterRetirement === 0
    && representative.pendingAfterRetirement === 0 && representative.disposed
    && representative.bvhMedianMs <= benchmarkPolicy.stops.bvhBuildMedianMs
    && representative.lodMedianMs <= benchmarkPolicy.stops.lodSelectionMedianMs
    && representative.sparsePickMedianMs <= benchmarkPolicy.stops.sparsePickMedianMs
    && representative.reuseSameResource
    && representative.renderSubmissionCallP95Ms <= benchmarkPolicy.stops.renderSubmissionCallP95Ms;
  const deviceValidationError = backend.device ? await backend.device.popErrorScope() : null;
  const webglError = backend.gl?.getError() ?? 0;
  const shaderWitness = { vertexHasWitness: shaders.vertexShader.includes("vReconstructionPosedWitness"),
    fragmentHasWitness: shaders.fragmentShader.includes("vReconstructionPosedWitness"),
    vertexHasSphericalOps: /\bacos\s*\(/.test(shaders.vertexShader) && /\bsin\s*\(/.test(shaders.vertexShader),
    fragmentHasSphericalOps: /\b(?:acos|sin)\s*\(/.test(shaders.fragmentShader),
    vertexChars: shaders.vertexShader.length, fragmentChars: shaders.fragmentShader.length };
  renderer.setRenderTarget(null); representativeTarget.dispose(); target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose();
  return { backend: forceWebGL ? "webgl2" : "webgpu", actualBackend: renderer.backend.constructor.name,
    isWebGPUBackend: renderer.backend.isWebGPUBackend === true, mutate, mutation, programsBefore, programsAfter, shaderWitness,
    digestMutationRejected, deviceValidationError: deviceValidationError?.message ?? null, webglError,
    fenceReadCount: fencePixels.length, expectedScale, toleranceRad: oracle.angularToleranceRad,
    representative, representativePass, results, shaders };
};

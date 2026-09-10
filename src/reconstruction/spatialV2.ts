const HEADER_BYTES = 32;

export interface DecodedCaoSpatialBatch {
  readonly backingBuffer: ArrayBuffer;
  readonly referenceDirections: Float32Array;
  readonly seamIds: Uint32Array;
  readonly vertexChartIndices: Uint32Array;
  readonly indices: Uint32Array;
  readonly chartTriangleRanges: readonly Readonly<{ chartIndex: number; firstTriangle: number; triangleCount: number }>[];
  readonly byteLength: number;
}

export interface DecodedCaoBatchState {
  readonly backingBuffer: ArrayBuffer;
  readonly displayHeightMetres: Float32Array;
  readonly baseColorRgb: Uint8Array;
  readonly byteLength: number;
}

export interface DecodedCaoLineBatch {
  readonly backingBuffer: ArrayBuffer;
  readonly referenceDirections: Float32Array;
  readonly vertexChartIndices: Uint32Array;
  readonly lineIndices: Uint32Array;
  readonly byteLength: number;
}

function header(view: DataView, magic: string, vertexCount: number): void {
  if (String.fromCharCode(...new Uint8Array(view.buffer, 0, 4)) !== magic
      || view.getUint16(4, true) !== 2 || view.getUint16(6, true) !== HEADER_BYTES
      || view.getUint32(8, true) !== vertexCount
      || view.getUint32(16, true) !== 0 || view.getUint32(20, true) !== 0
      || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
    throw new Error(`invalid ${magic} spatial asset header`);
  }
}

export function decodeCaoSpatialBatch(
  buffer: ArrayBuffer,
  vertexCount: number,
  triangleCount: number,
  chartCount: number,
): DecodedCaoSpatialBatch {
  if (buffer.byteLength !== HEADER_BYTES + vertexCount * 20 + triangleCount * 12) {
    throw new Error("Cao spatial batch length mismatch");
  }
  const view = new DataView(buffer);
  header(view, "EHGB", vertexCount);
  if (view.getUint32(12, true) !== triangleCount) throw new Error("Cao spatial triangle count mismatch");
  let offset = HEADER_BYTES;
  const referenceDirections = new Float32Array(buffer, offset, vertexCount * 3); offset += vertexCount * 12;
  const seamIds = new Uint32Array(buffer, offset, vertexCount); offset += vertexCount * 4;
  const vertexChartIndices = new Uint32Array(buffer, offset, vertexCount); offset += vertexCount * 4;
  const indices = new Uint32Array(buffer, offset, triangleCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const directionOffset = vertex * 3;
    const length = Math.hypot(referenceDirections[directionOffset]!, referenceDirections[directionOffset + 1]!,
      referenceDirections[directionOffset + 2]!);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 2e-6
        || vertexChartIndices[vertex]! >= chartCount) {
      throw new Error("invalid Cao spatial vertex");
    }
  }
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle]!;
    const b = indices[triangle + 1]!;
    const c = indices[triangle + 2]!;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount
        || vertexChartIndices[a] !== vertexChartIndices[b]
        || vertexChartIndices[a] !== vertexChartIndices[c]) {
      throw new Error("Cao spatial triangle crosses material chart ownership");
    }
  }
  const chartTriangleRanges: { chartIndex: number; firstTriangle: number; triangleCount: number }[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const chartIndex = vertexChartIndices[indices[triangle * 3]!]!;
    const last = chartTriangleRanges.at(-1);
    if (last?.chartIndex === chartIndex) last.triangleCount += 1;
    else chartTriangleRanges.push({ chartIndex, firstTriangle: triangle, triangleCount: 1 });
  }
  return Object.freeze({ backingBuffer: buffer, referenceDirections, seamIds, vertexChartIndices, indices,
    chartTriangleRanges: Object.freeze(chartTriangleRanges.map((range) => Object.freeze(range))),
    byteLength: buffer.byteLength });
}

export function decodeCaoBatchState(buffer: ArrayBuffer, vertexCount: number): DecodedCaoBatchState {
  if (buffer.byteLength !== HEADER_BYTES + vertexCount * 7) throw new Error("Cao batch-state length mismatch");
  const view = new DataView(buffer);
  header(view, "EHGC", vertexCount);
  if (view.getUint32(12, true) !== 0) throw new Error("invalid EHGC reserved field");
  const heightEnd = HEADER_BYTES + vertexCount * 4;
  const displayHeightMetres = new Float32Array(buffer, HEADER_BYTES, vertexCount);
  const baseColorRgb = new Uint8Array(buffer, heightEnd, vertexCount * 3);
  if ([...displayHeightMetres].some((height) => !Number.isFinite(height))) {
    throw new Error("Cao batch state contains invalid height");
  }
  return Object.freeze({ backingBuffer: buffer, displayHeightMetres, baseColorRgb, byteLength: buffer.byteLength });
}

export function decodeCaoLineBatch(
  buffer: ArrayBuffer,
  vertexCount: number,
  segmentCount: number,
  chartCount: number,
): DecodedCaoLineBatch {
  if (buffer.byteLength !== HEADER_BYTES + vertexCount * 16 + segmentCount * 8) {
    throw new Error("Cao line batch length mismatch");
  }
  const view = new DataView(buffer);
  header(view, "EHGL", vertexCount);
  if (view.getUint32(12, true) !== segmentCount) throw new Error("Cao line segment count mismatch");
  let offset = HEADER_BYTES;
  const referenceDirections = new Float32Array(buffer, offset, vertexCount * 3); offset += vertexCount * 12;
  const vertexChartIndices = new Uint32Array(buffer, offset, vertexCount); offset += vertexCount * 4;
  const lineIndices = new Uint32Array(buffer, offset, segmentCount * 2);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const directionOffset = vertex * 3;
    const length = Math.hypot(referenceDirections[directionOffset]!, referenceDirections[directionOffset + 1]!,
      referenceDirections[directionOffset + 2]!);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 2e-6 || vertexChartIndices[vertex]! >= chartCount) {
      throw new Error("invalid Cao line vertex");
    }
  }
  for (let segment = 0; segment < lineIndices.length; segment += 2) {
    const a = lineIndices[segment]!;
    const b = lineIndices[segment + 1]!;
    if (a >= vertexCount || b >= vertexCount || a === b || vertexChartIndices[a] !== vertexChartIndices[b]) {
      throw new Error("Cao line segment crosses material chart ownership");
    }
  }
  return Object.freeze({ backingBuffer: buffer, referenceDirections, vertexChartIndices, lineIndices,
    byteLength: buffer.byteLength });
}

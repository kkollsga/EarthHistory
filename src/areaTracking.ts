import type { AreaTrackingLayer, LonLat } from "./data";

type Vector3 = [x: number, y: number, z: number];

export interface AreaFocusDescriptor {
  version: 1;
  catalogId: string;
  plateModelId: string;
  referenceFrameId: string;
  featureId: string;
  partId: number;
  alongMeasure: number;
  offsetRadians: [along: number, across: number];
}

export type AreaFocusResolution =
  | { status: "resolved"; coordinates: LonLat }
  | {
      status: "unresolved";
      reason: "feature-unavailable" | "incompatible-source" | "invalid-descriptor";
    };

const EPSILON = 1e-12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(vector: Vector3): Vector3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > EPSILON
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : null;
}

function angle(left: Vector3, right: Vector3): number {
  return Math.acos(clamp(dot(left, right), -1, 1));
}

function lonLatDirection([longitude, latitude]: LonLat): Vector3 {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function directionLonLat(direction: Vector3): LonLat {
  const unit = normalized(direction) ?? [1, 0, 0];
  return [
    Math.atan2(unit[1], unit[0]) * 180 / Math.PI,
    Math.asin(clamp(unit[2], -1, 1)) * 180 / Math.PI,
  ];
}

function slerp(start: Vector3, end: Vector3, fraction: number): Vector3 {
  const distance = angle(start, end);
  if (distance < EPSILON) return start;
  const denominator = Math.sin(distance);
  const startWeight = Math.sin((1 - fraction) * distance) / denominator;
  const endWeight = Math.sin(fraction * distance) / denominator;
  return normalized([
    start[0] * startWeight + end[0] * endWeight,
    start[1] * startWeight + end[1] * endWeight,
    start[2] * startWeight + end[2] * endWeight,
  ]) ?? start;
}

function decodedPoint(layer: AreaTrackingLayer, pointIndex: number): Vector3 {
  const scale = layer.catalog.coordinateScaleDegrees;
  return lonLatDirection([
    layer.coordinates[pointIndex * 2] * scale,
    layer.coordinates[pointIndex * 2 + 1] * scale,
  ]);
}

function layerPartIndex(layer: AreaTrackingLayer, partId: number): number {
  let low = 0;
  let high = layer.partIds.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = layer.partIds[middle];
    if (candidate === partId) return middle;
    if (candidate < partId) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

interface PartPosition {
  anchor: Vector3;
  tangent: Vector3;
}

function partPosition(
  layer: AreaTrackingLayer,
  partIndex: number,
  measure: number,
): PartPosition | null {
  const start = layer.pointOffsets[partIndex];
  const end = layer.pointOffsets[partIndex + 1];
  const segments: Array<{ start: Vector3; end: Vector3; length: number }> = [];
  let total = 0;
  for (let pointIndex = start; pointIndex + 1 < end; pointIndex += 1) {
    const segmentStart = decodedPoint(layer, pointIndex);
    const segmentEnd = decodedPoint(layer, pointIndex + 1);
    const length = angle(segmentStart, segmentEnd);
    if (length <= EPSILON) continue;
    segments.push({ start: segmentStart, end: segmentEnd, length });
    total += length;
  }
  if (segments.length === 0 || !(total > EPSILON)) return null;
  const target = clamp(measure, 0, 1) * total;
  let travelled = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (target <= travelled + segment.length || index === segments.length - 1) {
      const fraction = clamp((target - travelled) / segment.length, 0, 1);
      const anchor = slerp(segment.start, segment.end, fraction);
      const normal = normalized(cross(segment.start, segment.end));
      const tangent = normal === null ? null : normalized(cross(normal, anchor));
      return tangent === null ? null : { anchor, tangent };
    }
    travelled += segment.length;
  }
  return null;
}

interface NearestPosition extends PartPosition {
  distance: number;
  measure: number;
}

function nearestOnPart(
  layer: AreaTrackingLayer,
  partIndex: number,
  point: Vector3,
): NearestPosition | null {
  const start = layer.pointOffsets[partIndex];
  const end = layer.pointOffsets[partIndex + 1];
  const segments: Array<{ start: Vector3; end: Vector3; length: number }> = [];
  let total = 0;
  for (let pointIndex = start; pointIndex + 1 < end; pointIndex += 1) {
    const segmentStart = decodedPoint(layer, pointIndex);
    const segmentEnd = decodedPoint(layer, pointIndex + 1);
    const length = angle(segmentStart, segmentEnd);
    if (length <= EPSILON) continue;
    segments.push({ start: segmentStart, end: segmentEnd, length });
    total += length;
  }
  if (!(total > EPSILON)) return null;

  let best: NearestPosition | null = null;
  let travelled = 0;
  for (const segment of segments) {
    const normal = normalized(cross(segment.start, segment.end));
    if (normal === null) continue;
    const tangentAtStart = normalized(cross(normal, segment.start));
    if (tangentAtStart === null) continue;
    const projected = normalized([
      point[0] - normal[0] * dot(point, normal),
      point[1] - normal[1] * dot(point, normal),
      point[2] - normal[2] * dot(point, normal),
    ]);
    let fraction = 0;
    if (projected !== null) {
      const directedDistance = Math.atan2(dot(projected, tangentAtStart), dot(projected, segment.start));
      fraction = clamp(directedDistance / segment.length, 0, 1);
    } else {
      fraction = angle(point, segment.end) < angle(point, segment.start) ? 1 : 0;
    }
    const anchor = slerp(segment.start, segment.end, fraction);
    const tangent = normalized(cross(normal, anchor));
    if (tangent === null) continue;
    const distance = angle(point, anchor);
    if (best === null || distance < best.distance - EPSILON) {
      best = {
        anchor,
        tangent,
        distance,
        measure: (travelled + fraction * segment.length) / total,
      };
    }
    travelled += segment.length;
  }
  return best;
}

function tangentOffset(anchor: Vector3, tangent: Vector3, point: Vector3): [number, number] {
  const distance = angle(anchor, point);
  if (distance < EPSILON) return [0, 0];
  const direction = normalized([
    point[0] - anchor[0] * dot(anchor, point),
    point[1] - anchor[1] * dot(anchor, point),
    point[2] - anchor[2] * dot(anchor, point),
  ]);
  if (direction === null) return [0, 0];
  const across = normalized(cross(anchor, tangent));
  return across === null
    ? [distance * dot(direction, tangent), 0]
    : [distance * dot(direction, tangent), distance * dot(direction, across)];
}

export function createAreaFocusDescriptor(
  layer: AreaTrackingLayer,
  coordinates: LonLat,
  maxDistanceRadians: number,
): AreaFocusDescriptor | null {
  if (
    !(maxDistanceRadians >= 0) || maxDistanceRadians >= Math.PI ||
    !Number.isFinite(maxDistanceRadians) ||
    !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) ||
    coordinates[0] < -180 || coordinates[0] > 180 ||
    coordinates[1] < -90 || coordinates[1] > 90
  ) return null;
  const point = lonLatDirection(coordinates);
  let best: { partIndex: number; position: NearestPosition } | null = null;
  for (let partIndex = 0; partIndex < layer.partIds.length; partIndex += 1) {
    const position = nearestOnPart(layer, partIndex, point);
    if (
      position !== null && position.distance <= maxDistanceRadians &&
      (best === null || position.distance < best.position.distance - EPSILON ||
        (Math.abs(position.distance - best.position.distance) <= EPSILON &&
          layer.partIds[partIndex] < layer.partIds[best.partIndex]))
    ) best = { partIndex, position };
  }
  if (best === null) return null;
  const partId = layer.partIds[best.partIndex];
  const part = layer.catalog.parts[partId];
  const feature = part === undefined ? undefined : layer.catalog.features[part.feature];
  if (part === undefined || feature === undefined || feature.plateId === null) return null;
  return {
    version: 1,
    catalogId: layer.catalog.id,
    plateModelId: layer.catalog.plateModelId,
    referenceFrameId: layer.catalog.referenceFrameId,
    featureId: feature.id,
    partId,
    alongMeasure: best.position.measure,
    offsetRadians: tangentOffset(best.position.anchor, best.position.tangent, point),
  };
}

export function resolveAreaFocusDescriptor(
  layer: AreaTrackingLayer,
  descriptor: AreaFocusDescriptor,
): AreaFocusResolution {
  if (
    descriptor.version !== 1 || descriptor.catalogId !== layer.catalog.id ||
    descriptor.plateModelId !== layer.catalog.plateModelId ||
    descriptor.referenceFrameId !== layer.catalog.referenceFrameId
  ) return { status: "unresolved", reason: "incompatible-source" };
  if (
    !Number.isInteger(descriptor.partId) || descriptor.partId < 0 ||
    !Number.isFinite(descriptor.alongMeasure) || descriptor.alongMeasure < 0 ||
    descriptor.alongMeasure > 1 || !Array.isArray(descriptor.offsetRadians) ||
    descriptor.offsetRadians.length !== 2 ||
    descriptor.offsetRadians.some((value) => !Number.isFinite(value)) ||
    Math.hypot(...descriptor.offsetRadians) >= Math.PI
  ) return { status: "unresolved", reason: "invalid-descriptor" };
  const part = layer.catalog.parts[descriptor.partId];
  const feature = part === undefined ? undefined : layer.catalog.features[part.feature];
  if (part === undefined || feature === undefined || feature.id !== descriptor.featureId) {
    return { status: "unresolved", reason: "invalid-descriptor" };
  }
  const partIndex = layerPartIndex(layer, descriptor.partId);
  if (partIndex < 0) return { status: "unresolved", reason: "feature-unavailable" };
  const position = partPosition(layer, partIndex, descriptor.alongMeasure);
  if (position === null) return { status: "unresolved", reason: "feature-unavailable" };
  const across = normalized(cross(position.anchor, position.tangent));
  if (across === null) return { status: "unresolved", reason: "feature-unavailable" };
  const tangentVector: Vector3 = [
    position.tangent[0] * descriptor.offsetRadians[0] + across[0] * descriptor.offsetRadians[1],
    position.tangent[1] * descriptor.offsetRadians[0] + across[1] * descriptor.offsetRadians[1],
    position.tangent[2] * descriptor.offsetRadians[0] + across[2] * descriptor.offsetRadians[1],
  ];
  const offsetDistance = Math.hypot(...tangentVector);
  const offsetDirection = normalized(tangentVector);
  const direction = offsetDirection === null
    ? position.anchor
    : normalized([
        position.anchor[0] * Math.cos(offsetDistance) + offsetDirection[0] * Math.sin(offsetDistance),
        position.anchor[1] * Math.cos(offsetDistance) + offsetDirection[1] * Math.sin(offsetDistance),
        position.anchor[2] * Math.cos(offsetDistance) + offsetDirection[2] * Math.sin(offsetDistance),
      ]) ?? position.anchor;
  return { status: "resolved", coordinates: directionLonLat(direction) };
}

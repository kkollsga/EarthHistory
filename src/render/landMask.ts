import type { LandPolygon, LonLat } from "../data";

interface PreparedRing {
  points: LonLat[];
  minimumLongitude: number;
  maximumLongitude: number;
  minimumLatitude: number;
  maximumLatitude: number;
  longitudeCenter: number;
}

interface PreparedPolygon {
  rings: PreparedRing[];
  minimumLatitude: number;
  maximumLatitude: number;
}

function preparePolygons(polygons: LandPolygon[]): PreparedPolygon[] {
  return polygons.flatMap((polygon) => {
    const rings = polygon.coordinates.flatMap((ring) => {
      const preparedRing = unwrapRing(ring);
      return preparedRing === undefined ? [] : [preparedRing];
    });
    if (rings.length === 0) return [];
    return [{
      rings,
      minimumLatitude: Math.min(...rings.map((ring) => ring.minimumLatitude)),
      maximumLatitude: Math.max(...rings.map((ring) => ring.maximumLatitude)),
    }];
  });
}

function unwrapRing(ring: LonLat[]): PreparedRing | undefined {
  if (ring.length < 3) return undefined;
  const points: LonLat[] = [];
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;
  for (const [sourceLongitude, latitude] of ring) {
    let longitude = sourceLongitude;
    const previous = points.at(-1)?.[0];
    if (previous !== undefined) {
      while (longitude - previous > 180) longitude -= 360;
      while (longitude - previous < -180) longitude += 360;
    }
    points.push([longitude, latitude]);
    minimumLongitude = Math.min(minimumLongitude, longitude);
    maximumLongitude = Math.max(maximumLongitude, longitude);
    minimumLatitude = Math.min(minimumLatitude, latitude);
    maximumLatitude = Math.max(maximumLatitude, latitude);
  }
  return {
    points,
    minimumLongitude,
    maximumLongitude,
    minimumLatitude,
    maximumLatitude,
    longitudeCenter: (minimumLongitude + maximumLongitude) / 2,
  };
}

function ringContains(ring: PreparedRing, longitude: number, latitude: number): boolean {
  if (latitude < ring.minimumLatitude || latitude > ring.maximumLatitude) return false;
  const shiftedLongitude = longitude + Math.round((ring.longitudeCenter - longitude) / 360) * 360;
  if (shiftedLongitude < ring.minimumLongitude || shiftedLongitude > ring.maximumLongitude) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = ring.points.length - 1; index < ring.points.length; previous = index++) {
    const [x, y] = ring.points[index];
    const [previousX, previousY] = ring.points[previous];
    if (
      y > latitude !== previousY > latitude &&
      shiftedLongitude <
        ((previousX - x) * (latitude - y)) / (previousY - y || Number.EPSILON) + x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Prepare static linework once, then restrict point-in-polygon work to the
 * latitude band being rendered. Interior rings remain holes through even/odd
 * filling and sequential longitude unwrapping makes the sampler seam-safe.
 */
export function createLandMaskSampler(polygons: LandPolygon[]): (point: LonLat) => boolean {
  const prepared = preparePolygons(polygons);
  const latitudeBands = Array.from({ length: 180 }, () => [] as PreparedPolygon[]);
  for (const polygon of prepared) {
    const firstBand = Math.max(0, Math.min(179, Math.floor(polygon.minimumLatitude + 90)));
    const lastBand = Math.max(0, Math.min(179, Math.floor(polygon.maximumLatitude + 90)));
    for (let band = firstBand; band <= lastBand; band += 1) latitudeBands[band].push(polygon);
  }
  return ([longitude, latitude]: LonLat) => {
    const band = Math.max(0, Math.min(179, Math.floor(latitude + 90)));
    for (const polygon of latitudeBands[band]) {
      if (latitude < polygon.minimumLatitude || latitude > polygon.maximumLatitude) continue;
      let inside = false;
      for (const ring of polygon.rings) {
        if (ringContains(ring, longitude, latitude)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
}

/** Rasterize polygon coverage by scanline, including wrapped intervals. */
export function rasterizeLandMask(
  polygons: LandPolygon[],
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (width < 1 || height < 1 || polygons.length === 0) return mask;
  const prepared = preparePolygons(polygons);
  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - ((y + 0.5) / height) * 180;
    for (const polygon of prepared) {
      if (latitude < polygon.minimumLatitude || latitude > polygon.maximumLatitude) continue;
      const intersections: number[] = [];
      for (const ring of polygon.rings) {
        if (latitude < ring.minimumLatitude || latitude > ring.maximumLatitude) continue;
        for (let index = 0, previous = ring.points.length - 1; index < ring.points.length; previous = index++) {
          const [x, rowLatitude] = ring.points[index];
          const [previousX, previousLatitude] = ring.points[previous];
          if (rowLatitude > latitude === previousLatitude > latitude) continue;
          intersections.push(
            x + ((previousX - x) * (latitude - rowLatitude)) /
              (previousLatitude - rowLatitude || Number.EPSILON),
          );
        }
      }
      intersections.sort((left, right) => left - right);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const start = Math.ceil(((intersections[index] + 180) / 360) * width - 0.5);
        const end = Math.floor(((intersections[index + 1] + 180) / 360) * width - 0.5);
        for (let unwrappedX = start; unwrappedX <= end; unwrappedX += 1) {
          const x = ((unwrappedX % width) + width) % width;
          mask[y * width + x] = 255;
        }
      }
    }
  }
  return mask;
}

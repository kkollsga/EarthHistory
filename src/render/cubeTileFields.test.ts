import { describe, expect, it } from "vitest";
import type { ModernReliefPatch, WorldSnapshot } from "../data";
import { CUBE_FACES, cubeFaceDirection, type CubeFace } from "./cubeSphere";
import {
  createCubeTileFieldGenerator,
  decodeDetailHeight,
  DETAIL_HEIGHT_RANGE_METRES,
  type CubeTileFields,
} from "./cubeTileFields";
import type { SurfaceFields } from "./surface";

function snapshot(): WorldSnapshot {
  return {
    id: "cube-field-test",
    label: "Cube field test",
    ageMa: 0,
    requestedAgeMa: 0,
    geographicSourceAgeMa: 0,
    period: "Quaternary",
    eon: "Phanerozoic",
    description: "Fixture",
    evidence: "synthesis",
    sourceIds: [],
    land: [],
    countries: [],
    tectonics: [
      {
        id: "ridge",
        name: "Fixture ridge",
        type: "mountain",
        coordinates: [[-20, -10], [20, 10]],
        widthKm: 180,
        heightKm: 2,
        sourceIds: [],
        activity: 0.8,
      },
    ],
    poiIds: [],
    environment: {
      iceLatitude: 80,
      vegetation: 0.7,
      stage: "modern-biomes",
    },
    caveat: "Fixture",
  };
}

function surface(width = 64, height = 32): SurfaceFields {
  const length = width * height * 4;
  const albedo = new Uint8Array(length);
  const relief = new Uint8Array(length);
  const reliefMetres = new Float32Array(width * height);
  const roughness = new Uint8Array(length);
  const landMask = new Uint8Array(width * height).fill(255);
  const clouds = new Uint8Array(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      albedo[offset] = 70 + (x % 90);
      albedo[offset + 1] = 80 + (y % 90);
      albedo[offset + 2] = 95 + ((x + y) % 90);
      albedo[offset + 3] = 255;
      relief.fill(70 + (x % 30), offset, offset + 3);
      relief[offset + 3] = 255;
      reliefMetres[y * width + x] = relief[offset] / 255 * 9_000;
      roughness.fill(135, offset, offset + 3);
      roughness[offset + 3] = 255;
      clouds[offset + 3] = 255;
    }
  }
  return {
    width,
    height,
    albedo,
    relief,
    reliefMetres,
    roughness,
    landMask,
    clouds,
    cloudWidth: width,
    cloudHeight: height,
    reliefRangeMetres: 9_000,
    reliefBiasMetres: 0,
    rivers: [],
    generationMs: 0,
    byteLength:
      albedo.byteLength + relief.byteLength + reliefMetres.byteLength +
      roughness.byteLength + landMask.byteLength + clouds.byteLength,
  };
}

function patch(): ModernReliefPatch {
  return {
    id: "fixture-relief",
    setId: "fixture",
    level: 0,
    childIds: [],
    priority: 10,
    validRequestedAgeMa: [0, 0],
    bounds: [-45, -45, 45, 45],
    cellCenterBounds: [-30, -30, 30, 30],
    width: 3,
    height: 3,
    longitudeStep: 30,
    latitudeStep: 30,
    registration: "pixel-center",
    rowOrder: "north-to-south",
    units: "m",
    horizontalCrs: "EPSG:4326",
    referenceFrameId: "present-day-geographic",
    verticalDatum: "EGM2008",
    surfaceMode: "surface",
    domain: "topobathymetry",
    composition: "absolute-replace",
    evidence: "model-output",
    nativeResolutionMetres: 1_000,
    maxErrorMetres: 100,
    splitErrorPixels: 1.5,
    mergeErrorPixels: 1,
    edgeTransitionCells: 1,
    sourceProduct: "ETOPO_2022_v1_60s_surface",
    sourceVersion: "test",
    sourceIds: ["fixture"],
    assetPath: "fixture.json",
    elevation: new Float32Array(9).fill(5_000),
    byteLength: 9 * Float32Array.BYTES_PER_ELEMENT,
  };
}

function generateFaces(meshSegments: 32 | 64 = 32, textureSize: 64 | 128 | 256 = 128) {
  const generator = createCubeTileFieldGenerator({
    snapshot: snapshot(),
    surface: surface(),
    mode: "surface",
    detail: "coarse",
  });
  return CUBE_FACES.map((face) => generator.generate({
    key: { face, level: 0, x: 0, y: 0 },
    meshSegments,
    textureSize,
  }));
}

function directionKey(array: Float32Array, offset: number): string {
  return `${array[offset].toFixed(6)},${array[offset + 1].toFixed(6)},${array[offset + 2].toFixed(6)}`;
}

function edgeVertexIndices(segments: number): number[] {
  const row = segments + 1;
  const indices: number[] = [];
  for (let value = 0; value <= segments; value += 1) {
    indices.push(value, segments * row + value, value * row, value * row + segments);
  }
  return [...new Set(indices)];
}

function textureEdgeSamples(tile: CubeTileFields): Array<{ key: string; rgba: number[] }> {
  const result = new Map<string, number[]>();
  const stride = tile.textureStride;
  const size = stride - 2;
  const face = tile.key.face;
  for (let value = 0; value < size; value += 1) {
    const t = value / (size - 1);
    const samples = [
      { row: 1, column: value + 1, u: -1 + 2 * t, v: 1 },
      { row: size, column: value + 1, u: -1 + 2 * t, v: -1 },
      { row: value + 1, column: 1, u: -1, v: 1 - 2 * t },
      { row: value + 1, column: size, u: 1, v: 1 - 2 * t },
    ];
    for (const sample of samples) {
      const direction = new Float32Array(cubeFaceDirection(face, sample.u, sample.v));
      const offset = (sample.row * stride + sample.column) * 4;
      result.set(
        directionKey(direction, 0),
        Array.from(tile.albedo.subarray(offset, offset + 4)),
      );
    }
  }
  return [...result].map(([key, rgba]) => ({ key, rgba }));
}

describe("cube tile fields", () => {
  it("is deterministic, bounded, byte-accounted, and maps UVs inside the gutter", () => {
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "regional",
    });
    const request = {
      key: { face: "px" as const, level: 0, x: 0, y: 0 },
      meshSegments: 64 as const,
      textureSize: 256 as const,
    };
    const first = generator.generate(request);
    const second = generator.generate(request);
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(Array.from(first.normals)).toEqual(Array.from(second.normals));
    expect(Array.from(first.albedo)).toEqual(Array.from(second.albedo));
    expect(Array.from(first.detailHeight)).toEqual(Array.from(second.detailHeight));
    expect(first.byteLength).toBe(
      first.directions.byteLength + first.positions.byteLength + first.normals.byteLength +
      first.heightsMetres.byteLength + first.localUvs.byteLength + first.indices.byteLength +
      first.albedo.byteLength + first.roughness.byteLength + first.detailHeight.byteLength,
    );
    expect(first.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(generator.retainedBytes).toBeGreaterThan(0);
    expect(first.generationMs).toBeGreaterThan(0);
    expect(first.minHeightMetres).toBeLessThanOrEqual(first.maxHeightMetres);
    expect(Math.min(...first.localUvs)).toBeGreaterThan(0);
    expect(Math.max(...first.localUvs)).toBeLessThan(1);
    for (let index = 0; index < first.detailHeight.length; index += 4) {
      const decoded = decodeDetailHeight(first.detailHeight[index], "regional");
      expect(Math.abs(decoded)).toBeLessThanOrEqual(DETAIL_HEIGHT_RANGE_METRES.regional + 1e-6);
      expect(first.albedo[index + 3]).toBe(255);
      expect(first.roughness[index + 3]).toBe(255);
      expect(first.detailHeight[index + 3]).toBe(255);
    }
  });

  it("keeps dual-mode ETOPO depth below surface water while using it for material color and normals", () => {
    const bathymetry: ModernReliefPatch = {
      ...patch(),
      surfaceMode: "seafloor",
      applicableSurfaceModes: ["surface", "seafloor"],
      elevation: new Float32Array([
        -1_000, -2_000, -3_000,
        -3_000, -4_000, -5_000,
        -5_000, -6_000, -7_000,
      ]),
    };
    const request = {
      key: { face: "px" as const, level: 0, x: 0, y: 0 },
      meshSegments: 32 as const,
      textureSize: 64 as const,
    };
    const surfaceGenerator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "coarse",
      modernRelief: [bathymetry],
    });
    const unrefined = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "coarse",
    }).generate(request);
    const water = surfaceGenerator.generate(request);
    const floor = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "seafloor", detail: "coarse",
      modernRelief: [bathymetry],
    }).generate(request);
    const center = 16 * 33 + 16;
    const centerOffset = center * 3;
    expect(water.sourcePatchIds).toEqual(["fixture-relief"]);
    expect(water.heightsMetres[center]).toBe(0);
    expect(water.minHeightMetres).toBe(0);
    expect(water.minSourceMaterialHeightMetres).toBeLessThan(-4_000);
    expect(Math.hypot(...water.positions.subarray(centerOffset, centerOffset + 3))).toBeCloseTo(1, 6);
    expect(floor.heightsMetres[center]).toBeCloseTo(-4_000, 3);
    expect(Math.hypot(...floor.positions.subarray(centerOffset, centerOffset + 3))).toBeLessThan(1);
    expect(Array.from(water.normals.subarray(centerOffset, centerOffset + 3))).not.toEqual(
      Array.from(unrefined.normals.subarray(centerOffset, centerOffset + 3)),
    );
    const texel = ((water.textureStride >> 1) * water.textureStride +
      (water.textureStride >> 1)) * 4;
    expect(Array.from(water.albedo.subarray(texel, texel + 3))).not.toEqual(
      Array.from(unrefined.albedo.subarray(texel, texel + 3)),
    );
    expect(surfaceGenerator.sampleHeightMetres([1, 0, 0])).toBe(0);
  });

  it("does not turn a flat bathymetry source window into a wall on the water shell", () => {
    const flatSurface = surface();
    flatSurface.relief.fill(0);
    flatSurface.reliefMetres.fill(0);
    flatSurface.landMask.fill(0);
    const flatBathymetry: ModernReliefPatch = {
      ...patch(),
      surfaceMode: "seafloor",
      applicableSurfaceModes: ["surface", "seafloor"],
      elevation: new Float32Array(9).fill(-4_000),
    };
    const sourceSnapshot = {
      ...snapshot(),
      controls: { width: 1, height: 1, elevation: new Float32Array([0]) },
    };
    const request = {
      key: { face: "px" as const, level: 0, x: 0, y: 0 },
      meshSegments: 32 as const,
      textureSize: 64 as const,
    };
    const baseline = createCubeTileFieldGenerator({
      snapshot: sourceSnapshot, surface: flatSurface, mode: "surface", detail: "coarse",
    }).generate(request);
    const refined = createCubeTileFieldGenerator({
      snapshot: sourceSnapshot, surface: flatSurface, mode: "surface", detail: "coarse",
      modernRelief: [flatBathymetry],
    }).generate(request);
    let maximumNormalDelta = 0;
    for (let index = 0; index < refined.normals.length; index += 1) {
      maximumNormalDelta = Math.max(
        maximumNormalDelta,
        Math.abs(refined.normals[index] - baseline.normals[index]),
      );
    }
    expect(Math.min(...refined.heightsMetres)).toBe(0);
    expect(refined.minSourceMaterialHeightMetres).toBeLessThan(-3_900);
    expect(maximumNormalDelta).toBeLessThan(2e-4);
  });

  it("covers all six face centers with outward unit directions and normals", () => {
    const tiles = generateFaces();
    for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex += 1) {
      const tile = tiles[faceIndex];
      const center = 16 * 33 + 16;
      const offset = center * 3;
      const expected = cubeFaceDirection(CUBE_FACES[faceIndex], 0, 0);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(tile.directions[offset + axis]).toBe(
          expected[axis] === 0 ? 0 : Math.fround(expected[axis]),
        );
      }
      const directionLength = Math.hypot(...tile.directions.subarray(offset, offset + 3));
      const normalLength = Math.hypot(...tile.normals.subarray(offset, offset + 3));
      const outward =
        tile.directions[offset] * tile.normals[offset] +
        tile.directions[offset + 1] * tile.normals[offset + 1] +
        tile.directions[offset + 2] * tile.normals[offset + 2];
      expect(directionLength).toBeCloseTo(1, 6);
      expect(normalLength).toBeCloseTo(1, 5);
      expect(outward).toBeGreaterThan(0.99);
    }
  });

  it("makes all 12 face edges and eight corners share geometry, heights, normals, and edge material", () => {
    const tiles = generateFaces();
    const shared = new Map<string, Array<{ tile: CubeTileFields; vertex: number }>>();
    for (const tile of tiles) {
      for (const vertex of edgeVertexIndices(tile.meshSegments)) {
        const key = directionKey(tile.directions, vertex * 3);
        const entries = shared.get(key) ?? [];
        entries.push({ tile, vertex });
        shared.set(key, entries);
      }
    }
    const duplicateGroups = [...shared.values()].filter((entries) => entries.length > 1);
    expect(duplicateGroups).toHaveLength(12 * 31 + 8);
    expect(duplicateGroups.filter((entries) => entries.length === 3)).toHaveLength(8);
    for (const entries of duplicateGroups) {
      const reference = entries[0];
      const referenceOffset = reference.vertex * 3;
      for (const entry of entries.slice(1)) {
        const offset = entry.vertex * 3;
        expect(entry.tile.heightsMetres[entry.vertex]).toBe(reference.tile.heightsMetres[reference.vertex]);
        expect(Array.from(entry.tile.positions.subarray(offset, offset + 3))).toEqual(
          Array.from(reference.tile.positions.subarray(referenceOffset, referenceOffset + 3)),
        );
        for (let axis = 0; axis < 3; axis += 1) {
          expect(entry.tile.normals[offset + axis]).toBeCloseTo(
            reference.tile.normals[referenceOffset + axis],
            5,
          );
        }
      }
    }

    const textureSamples = tiles.flatMap(textureEdgeSamples);
    const materials = new Map<string, number[]>();
    let matched = 0;
    for (const sample of textureSamples) {
      const previous = materials.get(sample.key);
      if (previous === undefined) materials.set(sample.key, sample.rgba);
      else {
        expect(sample.rgba).toEqual(previous);
        matched += 1;
      }
    }
    expect(matched).toBe(12 * 127 + 16);

    // The gutter samples are populated on all four sides and remain opaque.
    for (const tile of tiles) {
      const stride = tile.textureStride;
      for (let index = 0; index < stride; index += 1) {
        for (const offset of [index * 4, ((stride - 1) * stride + index) * 4]) {
          expect(tile.albedo[offset + 3]).toBe(255);
        }
      }
    }
  });

  it("matches parent vertices and heights at every other child sample", () => {
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "coarse",
    });
    const parent = generator.generate({
      key: { face: "pz", level: 1, x: 0, y: 0 }, meshSegments: 32, textureSize: 128,
    });
    const child = generator.generate({
      key: { face: "pz", level: 2, x: 0, y: 0 }, meshSegments: 32, textureSize: 128,
    });
    for (let childY = 0; childY <= 32; childY += 2) {
      for (let childX = 0; childX <= 32; childX += 2) {
        const parentVertex = (childY / 2) * 33 + childX / 2;
        const childVertex = childY * 33 + childX;
        expect(child.heightsMetres[childVertex]).toBe(parent.heightsMetres[parentVertex]);
        expect(Array.from(child.positions.subarray(childVertex * 3, childVertex * 3 + 3))).toEqual(
          Array.from(parent.positions.subarray(parentVertex * 3, parentVertex * 3 + 3)),
        );
      }
    }
    // The child covers the parent's northwest quadrant. Because every detail
    // mode uses one globally coherent spectrum, coincident material texels
    // remain byte-identical across this mixed-LOD boundary.
    for (let childRow = 1; childRow <= 129; childRow += 2) {
      for (let childColumn = 1; childColumn <= 129; childColumn += 2) {
        const parentRow = 1 + (childRow - 1) / 2;
        const parentColumn = 1 + (childColumn - 1) / 2;
        const childOffset = (childRow * child.textureStride + childColumn) * 4;
        const parentOffset = (parentRow * parent.textureStride + parentColumn) * 4;
        expect(Array.from(child.albedo.subarray(childOffset, childOffset + 4))).toEqual(
          Array.from(parent.albedo.subarray(parentOffset, parentOffset + 4)),
        );
        expect(Array.from(child.roughness.subarray(childOffset, childOffset + 4))).toEqual(
          Array.from(parent.roughness.subarray(parentOffset, parentOffset + 4)),
        );
        expect(Array.from(child.detailHeight.subarray(childOffset, childOffset + 4))).toEqual(
          Array.from(parent.detailHeight.subarray(parentOffset, parentOffset + 4)),
        );
      }
    }
  });

  it("is continuous at the antimeridian and stable at both poles", () => {
    const tiles = generateFaces();
    const north = tiles.filter((tile) => tile.key.face === "py")[0];
    const south = tiles.filter((tile) => tile.key.face === "ny")[0];
    for (const tile of [north, south]) {
      const center = 16 * 33 + 16;
      expect(Number.isFinite(tile.heightsMetres[center])).toBe(true);
      expect(Math.hypot(...tile.normals.subarray(center * 3, center * 3 + 3))).toBeCloseTo(1, 5);
    }
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "coarse",
    });
    const tileAt = (face: CubeFace, x: number, y: number) => generator.generate({
      key: { face, level: 8, x, y }, meshSegments: 32, textureSize: 128,
    });
    const channelAt = (tile: CubeTileFields, row: number, column: number) =>
      tile.albedo[(row * tile.textureStride + column) * 4];

    // Two texel centers immediately to either side of longitude ±180 converge
    // through the wrapped global sampler rather than exposing its first/last row.
    const antimeridianWest = tileAt("nx", 127, 127);
    const antimeridianEast = tileAt("nx", 128, 127);
    expect(Math.abs(
      channelAt(antimeridianWest, 128, 127) -
      channelAt(antimeridianEast, 128, 2),
    )).toBeLessThanOrEqual(1);

    // Equirectangular rows collapse to one value at the pole. Four equally
    // close directions must converge even when the fixture row varies by lon.
    const poleTiles = [
      tileAt("py", 127, 127),
      tileAt("py", 128, 127),
      tileAt("py", 127, 128),
      tileAt("py", 128, 128),
    ];
    const nearPole = [
      channelAt(poleTiles[0], 128, 127),
      channelAt(poleTiles[1], 128, 2),
      channelAt(poleTiles[2], 2, 127),
      channelAt(poleTiles[3], 2, 2),
    ];
    expect(Math.max(...nearPole) - Math.min(...nearPole)).toBeLessThanOrEqual(2);
    const nearPoleHeight = [
      poleTiles[0].heightsMetres[32 * 33 + 31],
      poleTiles[1].heightsMetres[32 * 33 + 1],
      poleTiles[2].heightsMetres[33 + 32],
      poleTiles[3].heightsMetres[33],
    ];
    expect(Math.max(...nearPoleHeight) - Math.min(...nearPoleHeight)).toBeLessThanOrEqual(2);
  });

  it("gives each level-zero polar material grid one canonical pole texel", () => {
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "regional",
    });
    for (const face of ["py", "ny"] as const) {
      const tile = generator.generate({
        key: { face, level: 0, x: 0, y: 0 }, meshSegments: 32, textureSize: 128,
      });
      const interiorSize = tile.textureStride - 2;
      expect(interiorSize).toBe(129);
      expect(interiorSize % 2).toBe(1);
      const center = 1 + Math.floor(interiorSize / 2);
      const centerOffset = (center * tile.textureStride + center) * 4;
      expect(tile.albedo[centerOffset + 3]).toBe(255);
      expect(tile.roughness[centerOffset + 3]).toBe(255);
      expect(tile.detailHeight[centerOffset + 3]).toBe(255);
    }
  });

  it("keeps polar bathymetry below the physical surface-water shell", () => {
    const fixtureSurface = surface();
    fixtureSurface.relief.fill(0);
    fixtureSurface.reliefMetres.fill(-5_000);
    fixtureSurface.reliefBiasMetres = -5_000;
    const sourceSnapshot = {
      ...snapshot(),
      controls: {
        width: 1,
        height: 1,
        elevation: new Float32Array([-4_000]),
      },
    };
    const generator = createCubeTileFieldGenerator({
      snapshot: sourceSnapshot,
      surface: fixtureSurface,
      mode: "surface",
      detail: "coarse",
    });
    for (const face of ["py", "ny"] as const) {
      const tile = generator.generate({
        key: { face, level: 0, x: 0, y: 0 }, meshSegments: 32, textureSize: 64,
      });
      expect(Math.min(...tile.heightsMetres)).toBe(0);
    }
  });

  it("feathers refinement height and its height-conditioned material at the source edge", () => {
    const fixtureSurface = surface();
    const baseGenerator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: fixtureSurface, mode: "surface", detail: "coarse",
    });
    const patchGenerator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: fixtureSurface, mode: "surface", detail: "coarse",
      modernRelief: [patch()],
    });
    const request = {
      key: { face: "px" as const, level: 0, x: 0, y: 0 },
      meshSegments: 32 as const,
      textureSize: 128 as const,
    };
    const base = baseGenerator.generate(request);
    const enhanced = patchGenerator.generate(request);
    const center = 16 * 33 + 16;
    expect(enhanced.sourcePatchIds).toEqual(["fixture-relief"]);
    expect(enhanced.heightsMetres[center]).toBeGreaterThan(4_750);
    expect(enhanced.heightsMetres[center]).toBeLessThan(5_250);
    expect(base.heightsMetres[center]).toBeLessThan(4_000);
    const westEdgeCenter = 16 * 33;
    expect(enhanced.heightsMetres[westEdgeCenter]).toBe(base.heightsMetres[westEdgeCenter]);
    expect(enhanced.albedo).not.toEqual(base.albedo);
    for (let row = 0; row < enhanced.textureStride; row += 1) {
      const westGutter = (row * enhanced.textureStride) * 4;
      expect(enhanced.detailHeight[westGutter]).toBe(128);
    }
  });

  it("uses source-local gradients and denser material only on regional patch tiles", () => {
    const fixtureSurface = surface();
    const flatPatch: ModernReliefPatch = {
      ...patch(),
      bounds: [-1, -1, 1, 1],
      cellCenterBounds: [-0.5, -0.5, 0.5, 0.5],
      longitudeStep: 0.5,
      latitudeStep: 0.5,
      edgeTransitionCells: 0.25,
      elevation: new Float32Array(9).fill(500),
    };
    const ridgePatch: ModernReliefPatch = {
      ...flatPatch,
      elevation: new Float32Array([
        500, 500, 500,
        -8_000, 500, 9_000,
        -3_000, -3_000, -3_000,
      ]),
    };
    const request = {
      key: { face: "px" as const, level: 0, x: 0, y: 0 },
      meshSegments: 32 as const,
      textureSize: 64 as const,
    };
    const generate = (modernRelief?: ModernReliefPatch[]) => createCubeTileFieldGenerator({
      snapshot: snapshot(),
      surface: fixtureSurface,
      mode: "surface",
      detail: "regional",
      modernRelief,
    }).generate(request);
    const unrefined = generate();
    const flat = generate([flatPatch]);
    const ridge = generate([ridgePatch]);
    expect(unrefined.textureSize).toBe(64);
    expect(flat.textureSize).toBe(128);
    expect(ridge.textureSize).toBe(128);
    expect(flat.byteLength).toBeGreaterThan(unrefined.byteLength);
    const center = Math.floor(ridge.textureStride / 2);
    const centerOffset = (center * ridge.textureStride + center) * 4;
    expect(Array.from(ridge.albedo.subarray(centerOffset, centerOffset + 3))).not.toEqual(
      Array.from(flat.albedo.subarray(centerOffset, centerOffset + 3)),
    );
    expect(ridge.detailHeight[centerOffset]).not.toBe(flat.detailHeight[centerOffset]);
    const vertexCenter = 16 * 33 + 16;
    expect(ridge.heightsMetres[vertexCenter]).toBe(flat.heightsMetres[vertexCenter]);
  });

  it("bakes physical mountain height into native albedo without changing sourced height", () => {
    const generateAtHeight = (heightMetres: number) => {
      const sourceSnapshot = {
        ...snapshot(),
        renderSeedId: "height-conditioned-native-material",
        controls: {
          width: 1,
          height: 1,
          elevation: new Float32Array([heightMetres]),
        },
      };
      return createCubeTileFieldGenerator({
        snapshot: sourceSnapshot,
        surface: surface(),
        mode: "surface",
        detail: "regional",
      }).generate({
        key: { face: "px", level: 0, x: 0, y: 0 },
        meshSegments: 32,
        textureSize: 64,
      });
    };
    const low = generateAtHeight(350);
    const high = generateAtHeight(4_200);
    const meanLuminance = (albedo: Uint8Array) => {
      let total = 0;
      for (let offset = 0; offset < albedo.length; offset += 4) {
        total += albedo[offset] * 0.2126 + albedo[offset + 1] * 0.7152 +
          albedo[offset + 2] * 0.0722;
      }
      return total / (albedo.length / 4);
    };
    expect(meanLuminance(high.albedo)).toBeLessThan(meanLuminance(low.albedo));
    expect([...low.heightsMetres].every((value) => Math.abs(value - 350) < 1e-5)).toBe(true);
    expect([...high.heightsMetres].every((value) => Math.abs(value - 4_200) < 1e-5)).toBe(true);
  });

  it("keeps the requested level-zero 64/256 output under the memory target", () => {
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "coarse",
    });
    const tile = generator.generate({
      key: { face: "px", level: 0, x: 0, y: 0 }, meshSegments: 64, textureSize: 256,
    });
    expect(tile.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("generates bounded 64px child material fields with populated gutters", () => {
    const generator = createCubeTileFieldGenerator({
      snapshot: snapshot(), surface: surface(), mode: "surface", detail: "regional",
    });
    const tile = generator.generate({
      key: { face: "pz", level: 4, x: 7, y: 8 }, meshSegments: 32, textureSize: 64,
    });
    expect(tile.textureStride).toBe(67);
    expect(tile.byteLength).toBeLessThan(140 * 1024);
    for (let index = 0; index < tile.textureStride; index += 1) {
      const north = index * 4;
      const south = ((tile.textureStride - 1) * tile.textureStride + index) * 4;
      expect(tile.albedo[north + 3]).toBe(255);
      expect(tile.albedo[south + 3]).toBe(255);
    }
  });
});

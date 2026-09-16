import { describe, expect, it } from "vitest";
import { BufferAttribute } from "three";
import { float } from "three/tsl";
import { EARTH_RADIUS_METRES } from "../../reconstruction";
import {
  POLYLINE_COUNTRY_SHELL_METRES,
  POLYLINE_DARK_INK,
  POLYLINE_LIGHT_INK,
  POLYLINE_QUAD_CORNERS,
  POLYLINE_QUAD_INDICES,
  POLYLINE_QUAD_INDICES_PER_SEGMENT,
  POLYLINE_QUAD_SEGMENT_BYTES,
  POLYLINE_QUAD_VERTICES_PER_SEGMENT,
  POLYLINE_WIDTH_CSS_PX,
  createPolylineBatch,
  createPolylineQuadGeometry,
  polylineQuadBytes,
  type PolylinePoseFactory,
  type PolylineSegmentSource,
} from "./polyline";

/**
 * Two segments over four unshared endpoints, in the shape the EHGL decoder
 * hands the renderer: one vertex pair and one index pair per segment, with both
 * endpoints of a segment on the same motion-palette entry.
 */
function twoSegments(): PolylineSegmentSource {
  return Object.freeze({
    referenceDirections: new Float32Array([
      1, 0, 0, 0, 1, 0,
      0, 1, 0, 0, 0, 1,
    ]),
    lineIndices: new Uint32Array([0, 1, 2, 3]),
    preparedEntryIndices: new Uint32Array([4, 4, 7, 7]),
  });
}

/**
 * A pose that does nothing but hand the reference direction back. The real
 * caller poses through the Cao motion palette; the helper only needs a position,
 * a direction and an activation, and injecting a trivial one keeps this test on
 * the polyline path rather than on the reconstruction it is drawn from.
 */
const identityPose: PolylinePoseFactory = ({ reference }) => Object.freeze({
  position: reference, direction: reference, activeMask: float(1),
});

describe("polyline helper", () => {
  it("expands a decoded line batch into one quad per segment", () => {
    const source = twoSegments();
    const segmentCount = 2;
    const shellMetres = 900;
    const expanded = createPolylineQuadGeometry(source, segmentCount, shellMetres);
    const geometry = expanded.geometry;

    expect(geometry.getAttribute("position").count)
      .toBe(segmentCount * POLYLINE_QUAD_VERTICES_PER_SEGMENT);
    expect(geometry.index?.count).toBe(segmentCount * POLYLINE_QUAD_INDICES_PER_SEGMENT);
    // Every segment carries the same quad-local corner template, and its two
    // triangles are that template's indices offset by the segment's first corner.
    expect([...(geometry.getAttribute("position").array as Float32Array)])
      .toEqual([...POLYLINE_QUAD_CORNERS, ...POLYLINE_QUAD_CORNERS]);
    expect([...(geometry.index!.array as Uint32Array)]).toEqual([
      ...POLYLINE_QUAD_INDICES,
      ...POLYLINE_QUAD_INDICES.map((index) => index + POLYLINE_QUAD_VERTICES_PER_SEGMENT),
    ]);

    // The round trip: each corner carries *both* endpoints of its own segment,
    // which is the only way a corner can be placed from a screen-space
    // direction, plus the shared palette entry and its own segment index.
    const repeated = (values: readonly number[]) =>
      Array.from({ length: POLYLINE_QUAD_VERTICES_PER_SEGMENT }, () => values).flat();
    expect([...(geometry.getAttribute("countryLineStart").array as Float32Array)])
      .toEqual([...repeated([1, 0, 0]), ...repeated([0, 1, 0])]);
    expect([...(geometry.getAttribute("countryLineEnd").array as Float32Array)])
      .toEqual([...repeated([0, 1, 0]), ...repeated([0, 0, 1])]);
    expect([...(geometry.getAttribute("countryLineEntryIndex").array as Uint32Array)])
      .toEqual([4, 4, 4, 4, 7, 7, 7, 7]);
    expect([...(geometry.getAttribute("countryLineSegmentIndex").array as Uint32Array)])
      .toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    // WebGL2 must bind the uint attributes through vertexAttribIPointer.
    expect((geometry.getAttribute("countryLineEntryIndex") as BufferAttribute).gpuType)
      .toBe((geometry.getAttribute("countryLineSegmentIndex") as BufferAttribute).gpuType);

    // `position` is quad-local, so the bounding sphere has to be stated: it is
    // the shell the segments actually live on, which is what transparent
    // sorting reads.
    expect(geometry.boundingSphere?.radius).toBeCloseTo(1 + shellMetres / EARTH_RADIUS_METRES, 12);
    geometry.dispose();
  });

  it("charges 200 bytes per segment and says so in its ledger", () => {
    // Four corners each carrying the quad-local corner, both endpoint
    // directions, the palette entry and the segment index, plus six indices.
    expect(POLYLINE_QUAD_SEGMENT_BYTES).toBe(200);
    expect(polylineQuadBytes(0)).toBe(0);
    expect(polylineQuadBytes(51_048)).toBe(51_048 * 200);
    expect(() => polylineQuadBytes(-1)).toThrow(/invalid polyline segment count/);

    const batch = createPolylineBatch({
      segments: twoSegments(), segmentCount: 2, pose: identityPose, tones: null,
      ink: { dark: POLYLINE_DARK_INK, light: POLYLINE_LIGHT_INK },
      shellMetres: POLYLINE_COUNTRY_SHELL_METRES, widthPx: POLYLINE_WIDTH_CSS_PX,
      displayFractionValue: 0,
    });
    expect(batch.segmentCount).toBe(2);
    expect(batch.ledgerBytes).toBe(2 * POLYLINE_QUAD_SEGMENT_BYTES);
    expect(batch.ledgerBytes).toBe(polylineQuadBytes(2));
    batch.graph.toneTexture.dispose();
    batch.material.dispose();
    batch.geometry.dispose();
  });

  it("draws in the dark ink alone when no tone table is loaded", () => {
    const batch = createPolylineBatch({
      segments: twoSegments(), segmentCount: 2, pose: identityPose, tones: null,
      ink: { dark: POLYLINE_DARK_INK, light: POLYLINE_LIGHT_INK },
      shellMetres: POLYLINE_COUNTRY_SHELL_METRES, widthPx: POLYLINE_WIDTH_CSS_PX,
      displayFractionValue: 0,
    });
    // Zero-filled is not an approximation of the single-ink outline: the colour
    // is `mix(dark, light, 0)`, which is `dark` exactly.
    const data = batch.graph.toneTexture.image.data as Uint8Array;
    expect([...data].every((value) => value === 0)).toBe(true);
    expect(batch.graph.toneCounts()).toEqual({ darkSegments: 2, lightSegments: 0 });
    // The two inks are distinct nodes and both reach the colour node, so the
    // mix a tone table drives is the caller's pair. Which of them `mix` takes
    // first is pinned by the country-outline node-identity test in
    // `caoFoundation.test.ts`, which walks the published material's colour node.
    expect(batch.graph.darkInk).not.toBe(batch.graph.lightInk);
    expect(batch.material.colorNode).not.toBeNull();

    // One light segment tones only that segment, and null puts the whole batch
    // back to the dark ink.
    const texels = new Uint8Array(data.length);
    texels[1] = 255;
    expect(batch.setToneTable(texels)).toEqual({ darkSegments: 1, lightSegments: 1 });
    expect(batch.setToneTable(null)).toEqual({ darkSegments: 2, lightSegments: 0 });
    expect([...data].every((value) => value === 0)).toBe(true);
    // A table sized for another package is rejected rather than partly applied.
    expect(() => batch.setToneTable(new Uint8Array(data.length + 1)))
      .toThrow(/tone table shape mismatch/);

    batch.graph.toneTexture.dispose();
    batch.material.dispose();
    batch.geometry.dispose();
  });

  it("refuses a shell or width it cannot draw", () => {
    const build = (shellMetres: number, widthPx: number) => () => createPolylineBatch({
      segments: twoSegments(), segmentCount: 2, pose: identityPose, tones: null,
      ink: { dark: POLYLINE_DARK_INK, light: POLYLINE_LIGHT_INK },
      shellMetres, widthPx, displayFractionValue: 0,
    });
    expect(build(-1, 1)).toThrow(/invalid polyline shell or width/);
    expect(build(POLYLINE_COUNTRY_SHELL_METRES, 0)).toThrow(/invalid polyline shell or width/);
  });
});

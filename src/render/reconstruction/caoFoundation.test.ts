import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BufferAttribute, Group, IntType, LineSegments, Mesh } from "three";
import {
  CaoReconstructionRuntime,
  chartPickStateFromMotionFrame,
  EARTH_RADIUS_METRES,
  type PreparedCaoRevision,
  type ReconstructionPackageManifestV2,
  packageAssetPath,
  type StaticAssetFetcher,
} from "../../reconstruction";
import { numberScalarOps } from "../../reconstruction/arithmetic";
import {
  CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES,
  CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET,
  CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES,
  CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES,
  CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES,
  CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION,
  CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS,
  CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES,
  CaoFoundationSurfaceRenderer,
  caoFoundationCountryLineOffsetsPx,
  createCaoFoundationCountryLineMaterial,
  createCaoFoundationGeometryResource,
  caoFoundationMaxDisplayedShellMetres,
  createCaoFoundationPaletteTexture,
  estimateCaoFoundationGeometryReservation,
  evaluateCountryLineClipOffset,
  evaluateCountryLineHorizonVisibility,
  caoFoundationBatchAppearance,
  caoFoundationSurfaceCoversDirection,
  intersectCaoFoundationSurface,
  packPreparedCaoPalette,
} from "./caoFoundation";
import { GpuRetirementOwner } from "./gpuRetirement";

function fixture(entryCount = 2): PreparedCaoRevision {
  const values = new Float32Array(entryCount * 11);
  for (let entry = 0; entry < entryCount; entry += 1) {
    values.set([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 1], entry * 11);
  }
  const referenceDirections = new Float32Array([
    ...gplatesLonLat(-0.5, -0.5), ...gplatesLonLat(0.5, -0.5), ...gplatesLonLat(0, 0.5),
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  const seamIds = new Uint32Array(3);
  const preparedEntryIndices = new Uint16Array([0, 0, 0]);
  const materialChartIndices = new Uint16Array([0, 0, 0]);
  const byteLength = [referenceDirections, indices, seamIds, preparedEntryIndices,
    materialChartIndices]
    .reduce((sum, array) => sum + array.byteLength, 0);
  return {
    identity: "cao@r1:0", requestId: 1, packageId: "cao", packageRevision: "r1",
    materialCorrectionIdentity: null,
    materialCorrections: { observedActiveCharts: 0, classifiedShallowMarineActiveCharts: 0,
      qualifiedActiveCharts: 0, uncertainActiveCharts: 0,
      formationUncertainActiveCharts: 0, modelInferredPoseActiveCharts: 0,
      overriddenNativeCharts: 0, activeSourceIds: [], correctionIds: [] },
    requestedAgeMa: 0, frameIdentity: "cao-frame",
    display: { youngerAgeMa: 0, olderAgeMa: 5, fraction: 0 },
    motionPalette: { stride: 11, entryCount, createValuesCopy: () => new Float32Array(values) },
    batches: [{ batchId: "global", staticGeometryIdentity: "global@1", vertexCount: 3,
      triangleCount: 1, staticGeometryBytes: byteLength, nativePrecedence: false,
      chartTriangleRanges: [{ chartIndex: 0, firstTriangle: 0, triangleCount: 1 }],
      createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(referenceDirections),
        indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
        preparedEntryIndices: new Uint16Array(preparedEntryIndices),
        materialChartIndices: new Uint16Array(materialChartIndices) }),
      createDisplayControlsCopy: () => ({
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: [0.37, 0.48, 0.24] } }) }],
    lineBatches: [],
    nativeBoundary: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    topologyOwnership: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    charts: [{ chartId: "chart", chartRevision: "1", materialId: "land",
      fragmentOrCohortId: "part", role: "model-geography",
      support: { kind: "supported", method: "compiled-rigid" },
      poseQuaternion: [1, 0, 0, 0], inversePoseQuaternion: [1, 0, 0, 0],
      evidence: { status: "unknown", sourceIds: ["cao"], limitations: ["neutral height"] },
      surfaceEvidence: { kind: "unknown", reason: "fixture surface is unspecified" } }],
    activeSourceBytes: byteLength,
    anchorIds: [],
    resolveAnchor: () => null,
    addressForChartDirection: () => { throw new Error("unused fixture address"); },
    resolveAddress: () => { throw new Error("unused fixture resolve"); },
    release: vi.fn(),
  };
}

const limits = { maxBatches: 8, maxVertices: 1_000, maxTriangles: 1_000,
  maxRetainedSourceBytes: 1_000_000, maxTextureSize: 2_048, maxPublicationBytes: 1_000_000,
  maxSpatialIndexBytes: 1_000_000 };

function gplatesLonLat(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

/** Every node reachable from `root`, so a test can pin that a graph uses one. */
function nodeDescendants(root: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const children = (node as { getChildren?: () => Iterable<unknown> }).getChildren;
    if (typeof children === "function") for (const child of children.call(node)) visit(child);
  };
  visit(root);
  return seen;
}

function rendererDirection(longitude: number, latitude: number): [number, number, number] {
  const [x, y, z] = gplatesLonLat(longitude, latitude);
  return [x, z, -y];
}

describe("Cao foundation renderer boundary", () => {
  it("creates the renderer geometry from the verified public package ledger", async () => {
    const packageRoot = resolve("public/data/reconstruction/cao-v2.4");
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const fetcher: StaticAssetFetcher = async (path) => {
      const bytes = await readFile(resolve(packageRoot, packageAssetPath(path)));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const revision = await runtime.request(0).prepared;
    const packageLimits = {
      ...limits,
      maxVertices: 450_000,
      maxTriangles: 600_000,
      maxRetainedSourceBytes: 48 * 1024 * 1024,
      maxPublicationBytes: 2 * 1024 * 1024,
    };
    const resource = createCaoFoundationGeometryResource(revision, packageLimits);
    expect(resource.batches).toHaveLength(5);
    expect(resource.lineBatches).toHaveLength(1);
    expect(resource.batches.reduce((sum, batch) => sum + batch.vertexCount, 0)).toBeGreaterThan(0);
    expect(resource.batches.reduce((sum, batch) => sum + batch.triangleCount, 0)).toBeGreaterThan(0);
    const staticKey = resource.key;
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 2_000_000);
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, packageLimits);
    const presentDiagnostics = surface.publish(revision, 8);
    expect(presentDiagnostics.countryLineSegments).toBeGreaterThan(0);
    expect(presentDiagnostics.nativeBoundarySegments).toBeGreaterThan(0);
    expect(presentDiagnostics.nativeBoundarySourceAgeMa).toBe(0);
    const publishedGroup = group.children[0];
    const geometryChildren = () => group.children[0]?.children
      .filter((child): child is Mesh | LineSegments => child instanceof Mesh || child instanceof LineSegments) ?? [];
    const publishedGeometries = geometryChildren().map((child) => child.geometry);
    const publishedIndexBuffers = publishedGeometries.map((geometry) => geometry.index?.array ?? null);
    for (const ageMa of [410, 410.001, 430.001, 0]) {
      const frame = await runtime.evaluateMotion(ageMa);
      const pick = chartPickStateFromMotionFrame(frame);
      const retargeted = surface.retargetMotion(frame.paletteValues, frame.entryCount,
        frame.display.fraction, pick.chartPoses, pick.chartActive, frame.requestedAgeMa,
        frame.materialCorrections);
      expect(retargeted.identity).toBe(presentDiagnostics.identity);
      expect(retargeted.staticGeometryIdentity).toBe(staticKey);
      expect(retargeted.requestedAgeMa).toBe(ageMa);
      expect(group.children[0]).toBe(publishedGroup);
      const retargetedGeometries = geometryChildren().map((child) => child.geometry);
      expect(retargetedGeometries).toHaveLength(publishedGeometries.length);
      retargetedGeometries.forEach((geometry, index) => {
        expect(geometry).toBe(publishedGeometries[index]);
        expect(geometry.index?.array ?? null).toBe(publishedIndexBuffers[index]);
      });
      expect(retargeted.nativeBoundarySourceAgeMa).toBe(ageMa === 0 ? 0 : null);
      expect(retargeted.topologyOwnershipSourceAgeMa).toBe(ageMa === 0 ? 0 : null);
      expect(retargeted.drawCount).toBe(ageMa === 0
        ? presentDiagnostics.drawCount : presentDiagnostics.drawCount - 1);
    }
    expect(surface.diagnostics().materialCorrections).toEqual(revision.materialCorrections);
    resource.dispose();
    const olderRevision = await runtime.request(450).prepared;
    const olderResource = createCaoFoundationGeometryResource(olderRevision, packageLimits);
    expect(olderResource.key).toBe(staticKey);
    expect(olderResource.batches.map((batch) => [batch.vertexCount, batch.triangleCount]))
      .toEqual(resource.batches.map((batch) => [batch.vertexCount, batch.triangleCount]));
    expect(olderResource.lineBatches.map((batch) => [batch.vertexCount, batch.segmentCount]))
      .toEqual(resource.lineBatches.map((batch) => [batch.vertexCount, batch.segmentCount]));
    olderResource.dispose();
    const olderDiagnostics = surface.publish(olderRevision, 8);
    expect(olderDiagnostics.nativeBoundarySourceAgeMa).toBe(450);
    surface.disposeForRendererTeardown();
    runtime.dispose();
  });

  it("packs 2D palette texels without relying on one row per chart", () => {
    const revision = fixture(2_921);
    const packed = packPreparedCaoPalette(revision, 2_048);
    expect(packed.width).toBe(256);
    expect(packed.height).toBe(35);
    expect(packed.data.slice(0, 12)).toEqual(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 1, 0]));
  });

  it("widens the country outline in screen space instead of drawing a lone hairline", () => {
    // A GPU line primitive is one device pixel wide on both backends, so a
    // single hairline loses coverage to multisampling and reads as beaded.
    // Each style is drawn once per offset; the union is the solid stroke.
    const stroke = caoFoundationCountryLineOffsetsPx("stroke");
    const underlay = caoFoundationCountryLineOffsetsPx("underlay");
    expect(stroke.filter(([x, y]) => x === 0 && y === 0)).toHaveLength(1);
    expect(underlay.every(([x, y]) => x !== 0 || y !== 0)).toBe(true);
    for (const offsets of [stroke, underlay]) {
      // No screen bearing may be left unwidened: every quadrant is covered.
      for (const [signX, signY] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        expect(offsets.some(([x, y]) => Math.sign(x) === signX && Math.sign(y) === signY)).toBe(true);
      }
      // A stroke, not a band: the widest offset stays inside a few pixels.
      expect(Math.max(...offsets.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]))).toBeLessThanOrEqual(2);
    }
    // The underlay halo stays outside the stroke core it contrasts against.
    expect(Math.min(...underlay.map(([x, y]) => Math.hypot(x, y))))
      .toBeGreaterThan(Math.max(...stroke.map(([x, y]) => Math.hypot(x, y))));
    // Every copy costs a draw and a full line vertex pass, so the table is
    // budgeted here rather than left to grow with the style list.
    expect(CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET).toBe(9);
    expect(stroke.length + underlay.length).toBeLessThanOrEqual(CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET);

    const packed = packPreparedCaoPalette(fixture(), 2_048);
    const texture = createCaoFoundationPaletteTexture(packed);
    const centred = createCaoFoundationCountryLineMaterial(texture, packed.width, 0, "stroke", [0, 0]);
    const shifted = createCaoFoundationCountryLineMaterial(texture, packed.width, 0, "stroke", stroke[1]!);
    // Every copy takes the same clip-offset path with the shift in a per-copy
    // uniform. That is a readback handle, not program sharing: each copy
    // rebuilds the pose graph and three keys pipelines on node ids, so a
    // publication compiles one program per copy, nine in all. The 411 Ma
    // cold-ready median did not regress against the hairline control
    // (817 ms against 826 ms), which is what makes that affordable.
    for (const graph of [centred, shifted]) {
      // A shifted copy is rasterized at a pixel its depth was not computed for,
      // so occlusion is the analytic horizon term, never the depth buffer.
      expect(graph.material.depthTest).toBe(false);
      expect(graph.material.depthWrite).toBe(false);
      expect(graph.material.transparent).toBe(true);
      expect(graph.material.opacity).toBe(0.92);
      // The far hemisphere is hidden by nothing but this term, so pin that the
      // material's opacity is actually built from it: losing the multiply would
      // render all 12 045 segments through the planet with the suite green.
      expect(graph.material.opacityNode).not.toBeNull();
      expect(nodeDescendants(graph.material.opacityNode)).toContain(graph.horizonVisibility);
      // Likewise the join between the offset formula and the clip position: if
      // vertexNode dropped the offset, all nine copies would draw in one place
      // and the outline would silently revert to the beaded hairline.
      expect(graph.material.vertexNode).not.toBeNull();
      const vertexNodes = nodeDescendants(graph.material.vertexNode);
      expect(vertexNodes).toContain(graph.clipOffset[0]);
      expect(vertexNodes).toContain(graph.clipOffset[1]);
      // And the vertex-stage far-side collapse, which is what keeps back-side
      // segments from rasterizing now that early-Z is gone.
      expect(graph.material.positionNode).not.toBeNull();
      expect(nodeDescendants(graph.material.positionNode)).toContain(graph.vertexVisible);
      expect(vertexNodes).toContain(graph.vertexVisible);
      // The cull margin belongs to the vertex stage only. Without it there, a
      // segment straddling the terminator loses one end and draws a spoke out
      // of the globe centre; with it in the fragment stage, outlines survive a
      // whole margin past the true horizon.
      const { vertexCullCos, vertexCullSin, fragmentCos, fragmentSin } = graph.horizonMargins;
      // float() wraps its constant, so read the constant out of the subtree.
      const constantValue = (node: unknown) => {
        for (const candidate of nodeDescendants(node)) {
          const value = (candidate as { value?: unknown }).value;
          if (typeof value === "number") return value;
        }
        throw new Error("node carries no numeric constant");
      };
      const cullRadians = CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES * Math.PI / 180;
      expect(constantValue(vertexCullCos)).toBeCloseTo(Math.cos(cullRadians), 12);
      expect(constantValue(vertexCullSin)).toBeCloseTo(Math.sin(cullRadians), 12);
      expect([constantValue(fragmentCos), constantValue(fragmentSin)]).toEqual([1, 0]);
      // The fragment term must reach the direction through a varying. Reading
      // the pose direction directly there re-emits the whole prepared pose
      // graph into the fragment shader and runs it per outline fragment.
      const fragmentGraph = nodeDescendants(graph.horizonVisibility);
      expect(fragmentGraph).toContain(graph.fragmentDirection);
      expect([...nodeDescendants(graph.fragmentDirection)]
        .filter((node) => (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(1);
      const vertexTerm = nodeDescendants(graph.vertexVisible);
      const fragmentTerm = nodeDescendants(graph.horizonVisibility);
      expect(vertexTerm).toContain(vertexCullCos);
      expect(vertexTerm).toContain(vertexCullSin);
      expect(vertexTerm).not.toContain(fragmentCos);
      // The vertex stage must NOT go through the varying: it needs the value
      // before interpolation, and a varying there would be a stage error.
      expect([...vertexTerm].filter((node) =>
        (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(0);
      expect(fragmentTerm).toContain(fragmentCos);
      expect(fragmentTerm).toContain(fragmentSin);
      expect(fragmentTerm).not.toContain(vertexCullCos);
      expect(fragmentTerm).not.toContain(vertexCullSin);
    }
    expect([centred.screenOffsetPixels.value.x, centred.screenOffsetPixels.value.y]).toEqual([0, 0]);
    expect([shifted.screenOffsetPixels.value.x, shifted.screenOffsetPixels.value.y])
      .toEqual([stroke[1]![0], stroke[1]![1]]);
    for (const graph of [centred, shifted]) graph.material.dispose();
    expect(() => createCaoFoundationCountryLineMaterial(texture, packed.width, 0, "stroke",
      [Number.NaN, 0])).toThrow(/screen offset/);
    texture.dispose();
  });

  it("converts a device-pixel outline offset into a clip-space shift", () => {
    // Same formula the material's vertexNode consumes, driven with numbers.
    const shift = (offset: readonly [number, number], clipW: number) =>
      evaluateCountryLineClipOffset(numberScalarOps, {
        offsetPixelX: offset[0], offsetPixelY: offset[1],
        screenWidthPx: 2_132, screenHeightPx: 1_304, clipW,
      });
    // A clip shift of 2w/screen is exactly one device pixel after the divide.
    const [dx, dy] = shift([1, 1], 3.5);
    expect(dx / 3.5 / 2 * 2_132).toBeCloseTo(1, 12);
    expect(dy / 3.5 / 2 * 2_132).toBeCloseTo(2_132 / 1_304, 12);
    // Each axis uses its own extent, so a non-square buffer is not anisotropic.
    expect(dx / dy).toBeCloseTo(1_304 / 2_132, 12);
    // Sign is carried through, not folded or flipped, on both axes.
    expect(shift([-1, -1], 3.5)).toEqual([-dx, -dy]);
    expect(shift([1, -1], 3.5)).toEqual([dx, -dy]);
    // Scaling by clip w keeps the post-divide shift constant with depth, so it
    // must be proportional to w, including at w near zero and behind the eye.
    expect(shift([0.55, 0.55], 7)[0]).toBeCloseTo(shift([0.55, 0.55], 3.5)[0] * 2, 12);
    expect(shift([0.55, 0.55], 1e-7)[0]).toBeCloseTo(shift([0.55, 0.55], 1)[0] * 1e-7, 18);
    expect(shift([0.55, 0.55], 0)).toEqual([0, 0]);
    expect(shift([0.55, 0.55], -2)[0]).toBeCloseTo(-shift([0.55, 0.55], 2)[0], 12);
    expect(shift([0, 0], 3.5)).toEqual([0, 0]);
  });

  it("occludes outlines at the analytic globe horizon rather than by depth", () => {
    // Same formula the material's opacityNode consumes, driven with numbers.
    const shell = 1 + CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES / EARTH_RADIUS_METRES;
    const visible = (separationDegrees: number, cameraRadius = 3.6808, marginDegrees = 0) =>
      evaluateCountryLineHorizonVisibility(numberScalarOps, {
        cosSeparation: Math.cos(separationDegrees * Math.PI / 180),
        pointRadius: shell, cameraRadius,
        occluderRadius: CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS,
        marginCos: Math.cos(marginDegrees * Math.PI / 180),
        marginSin: Math.sin(marginDegrees * Math.PI / 180),
      });
    // The exact limit is acos(R/cameraRadius) + acos(R/shell).
    const limitDegrees = (Math.acos(1 / 3.6808) + Math.acos(1 / shell)) * 180 / Math.PI;
    expect(limitDegrees).toBeGreaterThan(75);
    expect(limitDegrees).toBeLessThan(76);
    expect(visible(0)).toBe(1);
    expect(visible(limitDegrees - 0.01)).toBe(1);
    expect(visible(limitDegrees + 0.01)).toBe(0);
    expect(visible(180)).toBe(0);
    // The shell sits above the occluder, so the outline stays visible past the
    // occluder's own horizon — the band the tangent-plane test would cull.
    expect(visible(Math.acos(1 / 3.6808) * 180 / Math.PI + 0.5)).toBe(1);
    // A closer camera sees less of the globe, and the limit follows it down:
    // at the controls' minimum distance the limit is near 31 degrees.
    const closeLimitDegrees = (Math.acos(1 / 1.15) + Math.acos(1 / shell)) * 180 / Math.PI;
    expect(closeLimitDegrees).toBeGreaterThan(30);
    expect(closeLimitDegrees).toBeLessThan(32);
    expect(visible(closeLimitDegrees - 0.01, 1.15)).toBe(1);
    expect(visible(closeLimitDegrees + 0.01, 1.15)).toBe(0);
    expect(visible(limitDegrees - 0.01, 1.15)).toBe(0);
  });

  it("collapses a far-side outline vertex only past a margin wider than a chord", () => {
    // The vertex stage runs the same formula with a margin. The margin has to
    // exceed the widest chord, or a segment with one visible endpoint could be
    // collapsed at the other end and drawn from the globe centre.
    expect(CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES)
      .toBeGreaterThan(CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES);
    const shell = 1 + CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES / EARTH_RADIUS_METRES;
    const margin = CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES;
    const kept = (separationDegrees: number) =>
      evaluateCountryLineHorizonVisibility(numberScalarOps, {
        cosSeparation: Math.cos(separationDegrees * Math.PI / 180),
        pointRadius: shell, cameraRadius: 3.6808,
        occluderRadius: CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS,
        marginCos: Math.cos(margin * Math.PI / 180),
        marginSin: Math.sin(margin * Math.PI / 180),
      });
    const limitDegrees = (Math.acos(1 / 3.6808) + Math.acos(1 / shell)) * 180 / Math.PI;
    // Kept right through the terminator and a full chord past it, so a segment
    // straddling the terminator keeps both of its endpoints.
    expect(kept(limitDegrees - 0.01)).toBe(1);
    expect(kept(limitDegrees + CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES)).toBe(1);
    // Collapsed once it is past the margin — the far hemisphere.
    expect(kept(limitDegrees + margin + 0.01)).toBe(0);
    expect(kept(180)).toBe(0);
    // The margin widens the kept band by exactly itself, not by some other
    // amount: the boundary moves from the terminator to terminator + margin.
    expect(kept(limitDegrees + margin - 0.01)).toBe(1);
  });

  it("refuses a display height that would lift the surface through the outline shell", () => {
    // The outlines no longer depth test, so this guard replaces the depth
    // buffer: the tallest shell the controls can reach at the relief ceiling
    // must stay below the lower outline shell.
    expect(CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION).toBe(30);
    expect(caoFoundationMaxDisplayedShellMetres(0, 0, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBe(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES);
    expect(caoFoundationMaxDisplayedShellMetres(10, 4, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBe(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES + 300);
    // The shipped package is flat, so it publishes.
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    expect(() => surface.publish(fixture(), 8)).not.toThrow();
    const lifted = (heightMetres: number) => {
      const base = fixture();
      return { ...base, identity: `cao@r1:${heightMetres}`, requestId: heightMetres + 2,
        batches: [{ ...base.batches[0]!, createDisplayControlsCopy: () => ({
          displayHeightStart: { kind: "uniform" as const, value: heightMetres },
          displayHeightEnd: { kind: "uniform" as const, value: 0 },
          baseColor: { kind: "uniform" as const, value: [0.37, 0.48, 0.24] as const } }) }],
      } as PreparedCaoRevision;
    };
    // 800 m shell + 29 m x 30 stays under the 1 680 m underlay shell; 30 m does not.
    expect(caoFoundationMaxDisplayedShellMetres(29, 0, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBeLessThan(CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES);
    expect(caoFoundationMaxDisplayedShellMetres(30, 0, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBeGreaterThanOrEqual(CAO_FOUNDATION_COUNTRY_LINE_UNDERLAY_OFFSET_METRES);
    expect(() => surface.publish(lifted(29), 8)).not.toThrow();
    expect(() => surface.publish(lifted(30), 8)).toThrow(/lift the surface through the country-line shell/);
    surface.disposeForRendererTeardown();
  });

  it("preflights source bytes and creates one tracked geometry copy", () => {
    const revision = fixture();
    const reservation = estimateCaoFoundationGeometryReservation(revision, limits);
    const resource = createCaoFoundationGeometryResource(revision, limits);
    expect(resource.byteLength).toBeLessThanOrEqual(reservation);
    expect(resource.batches).toHaveLength(1);
    expect(resource.trackedGpuBufferBytes).toBeGreaterThan(0);
    expect((resource.batches[0]!.geometry.getAttribute("preparedEntryIndex") as BufferAttribute).gpuType)
      .toBe(IntType);
    resource.dispose();
  });

  it("answers chart coverage for a direction without a nearest-hit walk", () => {
    const base = fixture(3);
    const makeBatch = (batchId: string, points: readonly (readonly [number, number])[],
      chartIndex: number, nativePrecedence: boolean) => {
      const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
      const indices = new Uint32Array([0, 1, 2]);
      const seamIds = new Uint32Array(3);
      const entries = new Uint16Array([chartIndex, chartIndex, chartIndex]);
      const bytes = directions.byteLength + indices.byteLength + seamIds.byteLength
        + 2 * entries.byteLength;
      return { batchId, staticGeometryIdentity: `${batchId}@1`, vertexCount: 3,
        triangleCount: 1, staticGeometryBytes: bytes, nativePrecedence,
        chartTriangleRanges: [{ chartIndex, firstTriangle: 0, triangleCount: 1 }],
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(directions),
          indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
          preparedEntryIndices: new Uint16Array(entries),
          materialChartIndices: new Uint16Array(entries) }),
        createDisplayControlsCopy: () => ({
          displayHeightStart: { kind: "uniform" as const, value: 0 },
          displayHeightEnd: { kind: "uniform" as const, value: 0 },
          baseColor: { kind: "uniform" as const, value: [0.4, 0.4, 0.3] as const } }) };
    };
    const chart = (chartId: string) => ({ ...base.charts[0]!, chartId, chartRevision: "1",
      materialId: chartId, fragmentOrCohortId: chartId });
    const revision = { ...base,
      batches: [
        makeBatch("batch-shelf", [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]], 0, false),
        makeBatch("batch-land", [[-0.25, -0.25], [0.25, -0.25], [0, 0.25]], 1, false),
        makeBatch("correction-fine", [[-0.05, -0.05], [0.05, -0.05], [0, 0.05]], 2, true),
      ], charts: [chart("native-shelf"), chart("native-land"), chart("correction")],
    } satisfies PreparedCaoRevision;
    const resource = createCaoFoundationGeometryResource(revision, limits);
    const poses = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0,
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const covers = (active: readonly number[], longitude: number, latitude: number) =>
      caoFoundationSurfaceCoversDirection(resource,
        { chartPoses: poses, chartActive: new Uint8Array(active) },
        rendererDirection(longitude, latitude));

    const landOnly = (active: readonly number[], longitude: number, latitude: number) =>
      caoFoundationSurfaceCoversDirection(resource,
        { chartPoses: poses, chartActive: new Uint8Array(active) },
        rendererDirection(longitude, latitude), { includeShelf: false });

    // Native land, shelf-only, and a correction chart each count as covered.
    expect(covers([1, 1, 1], 0, 0)).toBe(true);
    expect(covers([1, 0, 0], 0, 0.4)).toBe(true);
    expect(covers([0, 0, 1], 0, 0.02)).toBe(true);
    // includeShelf:false narrows to charts drawn with the land appearance:
    // native land and material corrections stay, batch-shelf drops out.
    expect(landOnly([1, 1, 1], 0, 0)).toBe(true);
    expect(landOnly([1, 0, 0], 0, 0.4)).toBe(false);
    expect(landOnly([1, 1, 1], 0, 0.4)).toBe(false);
    expect(landOnly([0, 0, 1], 0, 0.02)).toBe(true);
    expect(landOnly([1, 1, 1], 90, 0)).toBe(false);
    expect(caoFoundationBatchAppearance("batch-shelf")).toBe("shelf");
    expect(caoFoundationBatchAppearance("batch-land")).toBe("land");
    expect(caoFoundationBatchAppearance("correction-fine")).toBe("land");
    // Open ocean: no chart anywhere near the direction.
    expect(covers([1, 1, 1], 90, 0)).toBe(false);
    // A plate not yet born at the requested age is inactive and cannot cover.
    expect(covers([0, 0, 0], 0, 0)).toBe(false);
    // Inside the shelf chart's bounding box but outside its triangle: bounds
    // only prune, the triangle pass decides, so this must not read as covered.
    const bounds = resource.batches[0]!.chartBounds;
    const shelfShell = 1 + CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES;
    // Poses are identity, so the source point is the GPlates direction on the shell.
    const corner = gplatesLonLat(0.45, 0.45).map((value) => value * shelfShell);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(corner[axis]!).toBeGreaterThanOrEqual(bounds[axis]!);
      expect(corner[axis]!).toBeLessThanOrEqual(bounds[axis + 3]!);
    }
    expect(covers([1, 1, 1], 0.45, 0.45)).toBe(false);
    // Coverage follows the chart pose, which is what makes a label's ink follow
    // plate motion: a quarter turn about the GPlates polar axis carries the
    // charts from longitude 0 to longitude 90 and the answers move with them.
    const halfSqrt = Math.SQRT1_2;
    const quarterTurn = new Float32Array(24);
    for (let chartIndex = 0; chartIndex < 3; chartIndex += 1) {
      quarterTurn.set([halfSqrt, 0, 0, halfSqrt, halfSqrt, 0, 0, -halfSqrt], chartIndex * 8);
    }
    const posed = (longitude: number, latitude: number) =>
      caoFoundationSurfaceCoversDirection(resource,
        { chartPoses: quarterTurn, chartActive: new Uint8Array([1, 1, 1]) },
        rendererDirection(longitude, latitude));
    expect(posed(90, 0)).toBe(true);
    expect(posed(0, 0)).toBe(false);
    expect(() => caoFoundationSurfaceCoversDirection(resource,
      { chartPoses: poses, chartActive: new Uint8Array([1, 1, 1]) }, [0, 0, 0]))
      .toThrow("Cao coverage direction must be finite and non-zero");
    resource.dispose();
  });

  it("orders shelf, corrections, and native land consistently for drawing and picking", () => {
    const base = fixture(3);
    const makeBatch = (batchId: string, points: readonly (readonly [number, number])[],
      chartIndex: number, nativePrecedence: boolean) => {
      const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
      const indices = new Uint32Array([0, 1, 2]);
      const seamIds = new Uint32Array(3);
      const entries = new Uint16Array([chartIndex, chartIndex, chartIndex]);
      const bytes = directions.byteLength + indices.byteLength + seamIds.byteLength + 2 * entries.byteLength;
      return { batchId, staticGeometryIdentity: `${batchId}@1`, vertexCount: 3,
        triangleCount: 1, staticGeometryBytes: bytes, nativePrecedence,
        chartTriangleRanges: [{ chartIndex, firstTriangle: 0, triangleCount: 1 }],
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(directions),
          indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
          preparedEntryIndices: new Uint16Array(entries), materialChartIndices: new Uint16Array(entries) }),
        createDisplayControlsCopy: () => ({ displayHeightStart: { kind: "uniform" as const, value: 0 },
          displayHeightEnd: { kind: "uniform" as const, value: 0 },
          baseColor: { kind: "uniform" as const, value: [0.4, 0.4, 0.3] as const } }) };
    };
    const chart = (chartId: string) => ({ ...base.charts[0]!, chartId, chartRevision: "1",
      materialId: chartId, fragmentOrCohortId: chartId });
    const revision = { ...base,
      batches: [
        makeBatch("batch-shelf", [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]], 0, false),
        makeBatch("batch-land", [[-0.25, -0.25], [0.25, -0.25], [0, 0.25]], 1, false),
        makeBatch("correction-fine", [[-0.05, -0.05], [0.05, -0.05], [0, 0.05]], 2, true),
      ], charts: [chart("native-shelf"), chart("native-land"), chart("correction")],
    } satisfies PreparedCaoRevision;
    const resource = createCaoFoundationGeometryResource(revision, limits);
    const identityPoses = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0,
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const overlap = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([1, 1, 1]) },
      [3, 0, 0], [-1, 0, 0]);
    expect(overlap?.batchId).toBe("batch-land");
    const grazing = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([1, 1, 1]) },
      [3, 0, -0.002], [-1, 0, 0]);
    expect(grazing?.batchId).toBe("batch-land");
    const correctionOverShelf = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([1, 0, 1]) },
      [3, 0, 0], [-1, 0, 0]);
    expect(correctionOverShelf?.batchId).toBe("correction-fine");

    const shellEdgePoints = [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]] as const;
    const shelfEdgeRevision = { ...base,
      batches: [makeBatch("batch-shelf", shellEdgePoints, 0, false)],
      charts: [chart("native-shelf")],
    } satisfies PreparedCaoRevision;
    const landEdgeRevision = { ...shelfEdgeRevision,
      batches: [makeBatch("batch-land", shellEdgePoints, 0, false)],
      charts: [chart("native-land")],
    } satisfies PreparedCaoRevision;
    const shelfEdgeResource = createCaoFoundationGeometryResource(shelfEdgeRevision, limits);
    const landEdgeResource = createCaoFoundationGeometryResource(landEdgeRevision, limits);
    const apex = Math.sin(0.5 * Math.PI / 180);
    expect(shelfEdgeResource.batches[0]!.chartBounds[5]).toBeCloseTo(
      apex * (1 + CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES), 8);
    expect(landEdgeResource.batches[0]!.chartBounds[5]).toBeCloseTo(
      apex * (1 + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES), 8);
    const onePose = { chartPoses: identityPoses.subarray(0, 8), chartActive: new Uint8Array([1]) };
    expect(intersectCaoFoundationSurface(
      shelfEdgeResource, onePose, [3, 0, 0], [-1, 0, 0])?.batchId).toBe("batch-shelf");
    expect(intersectCaoFoundationSurface(
      landEdgeResource, onePose, [3, 0, 0], [-1, 0, 0])?.batchId).toBe("batch-land");
    // Probe between the shelf and land apex radii so intersection uses the
    // same per-batch shell contract as the spatial index.
    const betweenShells = apex * (1
      + (CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES)
        / 2 / EARTH_RADIUS_METRES);
    const edgeRay = [[3, betweenShells, 0], [-1, 0, 0]] as const;
    expect(intersectCaoFoundationSurface(shelfEdgeResource, onePose, ...edgeRay)).toBeNull();
    expect(intersectCaoFoundationSurface(landEdgeResource, onePose, ...edgeRay)?.batchId).toBe("batch-land");

    // A grazing ray can hit both the front and occluded side of the globe while
    // both hit positions still have a positive dot product with the camera.
    const nearLimbRevision = { ...base,
      batches: [
        makeBatch("native-occluded-positive-dot", [[86.78, -1], [88.78, -1], [87.78, 1]], 0, false),
        makeBatch("correction-front-limb", [[54.44, -0.5], [55.44, -0.5], [54.94, 0.5]], 1, true),
      ], charts: [chart("native-occluded-positive-dot"), chart("correction-front-limb")],
    } satisfies PreparedCaoRevision;
    const nearLimbResource = createCaoFoundationGeometryResource(nearLimbRevision, limits);
    const nearLimbHit = intersectCaoFoundationSurface(nearLimbResource,
      { chartPoses: identityPoses.subarray(0, 16), chartActive: new Uint8Array([1, 1]) },
      [3, 0, 0], [-Math.sqrt(1 - 0.32 ** 2), 0, -0.32]);
    expect(nearLimbHit?.batchId).toBe("correction-front-limb");

    const group = new Group();
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, limits);
    surface.publish(revision, 8);
    expect(surface.diagnostics().shellOffsetMetres).toBe(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES);
    const meshes = group.children[0]!.children.filter((child): child is Mesh => child instanceof Mesh);
    expect(meshes.map((mesh) => {
      if (Array.isArray(mesh.material)) throw new Error("Cao surface mesh unexpectedly has multiple materials");
      return [mesh.renderOrder, mesh.material.depthWrite, mesh.material.depthTest];
    }))
      .toEqual([[1, true, true], [2, true, true], [1.5, false, true]]);
    surface.disposeForRendererTeardown();
    shelfEdgeResource.dispose();
    landEdgeResource.dispose();
    nearLimbResource.dispose();
    resource.dispose();
  });

  it("binds reconstructed country references and exact native boundaries to the same publication", () => {
    const base = fixture();
    const referenceDirections = new Float32Array([1, 0, 0, 0, 1, 0]);
    const lineIndices = new Uint32Array([0, 1]);
    const preparedEntryIndices = new Uint16Array([0, 0]);
    const materialChartIndices = new Uint16Array([0, 0]);
    const corner = 1 / Math.sqrt(1.02);
    const topologyDirections = new Float32Array([
      corner, -0.1 * corner, -0.1 * corner,
      corner, 0.1 * corner, -0.1 * corner,
      corner, 0.1 * corner, 0.1 * corner,
      corner, -0.1 * corner, 0.1 * corner,
    ]);
    const lineBytes = referenceDirections.byteLength + lineIndices.byteLength
      + preparedEntryIndices.byteLength + materialChartIndices.byteLength;
    const revision = {
      ...base,
      lineBatches: [{ batchId: "countries", staticGeometryIdentity: "countries@1",
        vertexCount: 2, segmentCount: 1, staticGeometryBytes: lineBytes,
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(referenceDirections),
          lineIndices: new Uint32Array(lineIndices),
          preparedEntryIndices: new Uint16Array(preparedEntryIndices),
          materialChartIndices: new Uint16Array(materialChartIndices) }) }],
      nativeBoundary: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { segments: [{ segmentId: "ridge", sourceFeatureId: "ridge", sourcePart: 0,
          sourceFeatureType: "MidOceanRidge", validTimeMa: { youngest: 0, oldest: 540 },
          kind: "ridge" as const, polarity: "unknown" as const, rightTopologyId: null,
          leftTopologyId: null, rightPlateId: null, leftPlateId: null,
          ownershipStatus: "unknown" as const, pointOffset: 0, pointCount: 2 }],
        pointCount: 2, sourceBytes: 56,
        createDirectionsCopy: () => new Float32Array(referenceDirections) } },
      topologyOwnership: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { rings: [{ ringId: "owner", polygonId: "polygon", ringRole: "exterior" as const,
          topologyId: "topology", plateId: 101, status: "instantaneous-owner" as const,
          candidatePlateIds: [101], pointOffset: 0, pointCount: 4 }],
        pointCount: 4, sourceBytes: topologyDirections.byteLength,
        createDirectionsCopy: () => new Float32Array(topologyDirections) } },
    } satisfies PreparedCaoRevision;
    const resource = createCaoFoundationGeometryResource(revision, limits);
    expect(resource.lineBatches).toHaveLength(1);
    expect((resource.lineBatches[0]!.geometry.getAttribute("preparedEntryIndex") as BufferAttribute).gpuType)
      .toBe(IntType);
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, limits);
    const diagnostics = surface.publish(revision, 8);
    // One spatial batch, one native boundary, and one draw per country-line
    // screen offset: the widened stroke is drawn as offset copies of the batch.
    const lineDraws = CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET;
    expect(caoFoundationCountryLineOffsetsPx("underlay").length
      + caoFoundationCountryLineOffsetsPx("stroke").length).toBe(lineDraws);
    expect(diagnostics).toMatchObject({ drawCount: 11, countryLineBatches: 1,
      countryLineSegments: 1, nativeBoundarySegments: 1, nativeBoundarySourceAgeMa: 0,
      topologyOwnershipRings: 1, topologyOwnershipSourceAgeMa: 0 });
    expect(group.children[0]!.children.filter(
      (child) => child.userData.overlayLayer === "borders")).toHaveLength(lineDraws);
    expect(surface.identifyTopology([1, 0, 0])).toEqual({ kind: "instantaneous-owner",
      plateId: 101, topologyId: "topology", sourceAgeMa: 0 });
    expect(surface.identifyTopology([-1, 0, 0])).toBeNull();
    expect(surface.coversDirection([1, 0, 0])).toBe(true);
    expect(surface.coversDirection([-1, 0, 0])).toBe(false);
    expect(surface.setDomainVisibility(false)).toMatchObject({ drawCount: 0,
      nativeBoundarySegments: 0, nativeBoundarySourceAgeMa: null,
      topologyOwnershipRings: 0, topologyOwnershipSourceAgeMa: null });
    expect(surface.identifyTopology([1, 0, 0])).toBeNull();
    // Withheld or hidden domain: no surface is on screen, so nothing is covered.
    expect(surface.coversDirection([1, 0, 0])).toBe(false);
    expect(group.children[0]!.visible).toBe(false);
    surface.setLayerVisibility(false, false);
    expect(group.children[0]!.children.filter((child) => child.userData.overlayLayer).every(
      (child) => !child.visible,
    )).toBe(true);
    surface.disposeForRendererTeardown();
    resource.dispose();
  });

  it("uses the intended spherical side across the dateline, poles, and holes", () => {
    const base = fixture();
    const rings = [
      { ringId: "dateline", polygonId: "dateline", ringRole: "exterior" as const,
        topologyId: "dateline-topology", plateId: 1, status: "instantaneous-owner" as const,
        candidatePlateIds: [1], pointOffset: 0, pointCount: 4 },
      { ringId: "pole", polygonId: "pole", ringRole: "exterior" as const,
        topologyId: "pole-topology", plateId: 2, status: "instantaneous-owner" as const,
        candidatePlateIds: [2], pointOffset: 4, pointCount: 4 },
      { ringId: "outer", polygonId: "with-hole", ringRole: "exterior" as const,
        topologyId: "hole-topology", plateId: 3, status: "instantaneous-owner" as const,
        candidatePlateIds: [3], pointOffset: 8, pointCount: 4 },
      { ringId: "hole", polygonId: "with-hole", ringRole: "hole" as const,
        topologyId: "hole-topology", plateId: 3, status: "instantaneous-owner" as const,
        candidatePlateIds: [3], pointOffset: 12, pointCount: 4 },
    ];
    const points = [
      [-170, -10], [170, -10], [170, 10], [-170, 10],
      [0, 80], [90, 80], [180, 80], [-90, 80],
      [-10, -10], [10, -10], [10, 10], [-10, 10],
      [-2, -2], [2, -2], [2, 2], [-2, 2],
    ] as const;
    const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
    const revision = { ...base,
      topologyOwnership: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { rings, pointCount: points.length, sourceBytes: directions.byteLength,
          createDirectionsCopy: () => new Float32Array(directions) } },
    } satisfies PreparedCaoRevision;
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    surface.publish(revision, 8);
    expect(surface.identifyTopology(rendererDirection(180, 0))).toMatchObject({ plateId: 1 });
    expect(surface.identifyTopology(rendererDirection(0, 0))).toBeNull();
    expect(surface.identifyTopology(rendererDirection(0, 90))).toMatchObject({ plateId: 2 });
    expect(surface.identifyTopology(rendererDirection(5, 0))).toMatchObject({ plateId: 3 });
    expect(surface.identifyTopology(rendererDirection(0, 0))).toBeNull();
    surface.disposeForRendererTeardown();
  });

  it("rejects limits and inconsistent prepared indices before publication", () => {
    const revision = fixture();
    expect(() => estimateCaoFoundationGeometryReservation(revision,
      { ...limits, maxRetainedSourceBytes: 1 })).toThrow(/exceeds renderer limit/);
    const invalid = fixture();
    const original = invalid.batches[0]!.createStaticGeometryCopy;
    const broken = { ...invalid, batches: [{ ...invalid.batches[0]!, createStaticGeometryCopy: () => {
      const copy = original(); copy.preparedEntryIndices[0] = 99; return copy;
    } }] } satisfies PreparedCaoRevision;
    expect(() => createCaoFoundationGeometryResource(broken, limits)).toThrow(/palette or chart index/);
  });

  it("keeps the measured display shells clear and ordered above unknown physical height", () => {
    expect(CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES).toBe(400);
    expect(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES).toBe(800);
    expect(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES)
      .toBeGreaterThan(CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES);
  });

  it("inverse-picks the same rigid 800 m land shell triangles and skips inactive charts", () => {
    const resource = createCaoFoundationGeometryResource(fixture(), limits);
    const rayOrigin = [3, 0, 0] as const;
    const rayDirection = [-1, 0, 0] as const;
    const poses = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]);
    const hit = intersectCaoFoundationSurface(resource,
      { chartPoses: poses, chartActive: new Uint8Array([1]) }, rayOrigin, rayDirection);
    expect(hit).toMatchObject({ batchId: "global", chartIndex: 0, triangleIndex: 0 });
    expect(hit?.position.every(Number.isFinite)).toBe(true);
    const halfSqrt = Math.SQRT1_2;
    const rotated = intersectCaoFoundationSurface(resource,
      { chartPoses: new Float32Array([halfSqrt, 0, 0, halfSqrt, halfSqrt, 0, 0, -halfSqrt]),
        chartActive: new Uint8Array([1]) },
      [0, 0, -3], [0, 0, 1]);
    expect(rotated).toMatchObject({ chartIndex: 0, triangleIndex: 0 });
    expect(intersectCaoFoundationSurface(resource,
      { chartPoses: poses, chartActive: new Uint8Array([0]) }, rayOrigin, rayDirection)).toBeNull();
    resource.dispose();
  });

  it("retargets motion to 0 Ma without clearing the published foundation", () => {
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => undefined }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    const first = fixture();
    surface.publish(first, 1);
    const before = surface.diagnostics();
    expect(before.drawCount).toBeGreaterThan(0);
    expect(before.requestedAgeMa).toBe(0);

    const entryCount = first.motionPalette.entryCount;
    const chartCount = first.charts.length;
    const paletteValues = new Float32Array(entryCount * 11);
    for (let entry = 0; entry < entryCount; entry += 1) {
      paletteValues.set([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1], entry * 11);
    }
    const chartPoses = new Float32Array(chartCount * 8);
    const chartActive = new Uint8Array(chartCount).fill(1);
    for (let chart = 0; chart < chartCount; chart += 1) {
      chartPoses.set([1, 0, 0, 0, 1, 0, 0, 0], chart * 8);
    }
    const after = surface.retargetMotion(
      paletteValues, entryCount, 0, chartPoses, chartActive, 0, first.materialCorrections,
    );
    expect(after.drawCount).toBe(before.drawCount);
    expect(after.vertices).toBe(before.vertices);
    expect(after.requestedAgeMa).toBe(0);
    expect(surface.diagnostics().drawCount).toBeGreaterThan(0);
    surface.disposeForRendererTeardown();
  });

  it("swaps a 0 Ma publication over a prior age without an empty clear gap", () => {
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => undefined }, 4, 4_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    const older = { ...fixture(), identity: "cao@r1:100", requestId: 100, requestedAgeMa: 100,
      display: { youngerAgeMa: 100, olderAgeMa: 100, fraction: 0 } };
    surface.publish(older, 1);
    expect(surface.diagnostics().requestedAgeMa).toBe(100);
    expect(surface.diagnostics().drawCount).toBeGreaterThan(0);

    const today = { ...fixture(), identity: "cao@r1:0", requestId: 0, requestedAgeMa: 0,
      display: { youngerAgeMa: 0, olderAgeMa: 0, fraction: 0 } };
    // Publish replaces in place — clear() must not be required for age→0.
    surface.publish(today, 1);
    const diagnostics = surface.diagnostics();
    expect(diagnostics.requestedAgeMa).toBe(0);
    expect(diagnostics.drawCount).toBeGreaterThan(0);
    expect(diagnostics.vertices).toBeGreaterThan(0);
    surface.disposeForRendererTeardown();
  });

    it("blocks another publication while the bounded retirement fence is stalled", async () => {
    const completions: Array<() => void> = [];
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: () => (
      new Promise<void>((resolve) => completions.push(resolve))
    ) }, 1, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    surface.publish(fixture(), 1);
    surface.publish({ ...fixture(), identity: "cao@r1:1", requestId: 2, requestedAgeMa: 1 }, 1);
    expect(retirement.pendingCount()).toBe(1);
    expect(() => surface.publish({ ...fixture(), identity: "cao@r1:2", requestId: 3, requestedAgeMa: 2 }, 1))
      .toThrow(/retirement backpressure/);
    completions.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(retirement.pendingCount()).toBe(0);
    surface.disposeForRendererTeardown();
    completions.shift()?.();
  });
});

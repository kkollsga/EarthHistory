import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BufferAttribute, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, IntType, LineSegments, Mesh, SRGBColorSpace } from "three";
import {
  CaoReconstructionRuntime,
  chartPickStateFromMotionFrame,
  EARTH_RADIUS_METRES,
  type PreparedCaoPalaeoInterval,
  type PreparedCaoRevision,
  type ReconstructionPackageManifestV2,
  packageAssetPath,
  validateSpatialBatchSurfaceAppearanceV2,
  type StaticAssetFetcher,
} from "../../reconstruction";
import type { CaoPalaeoDomainBand } from "./surfaceVisibility";
import { numberScalarOps } from "../../reconstruction/arithmetic";
import {
  CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES,
  CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET,
  CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX,
  CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES,
  CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES,
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS,
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES,
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT,
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES,
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT,
  CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX,
  CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION,
  CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS,
  CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_PALAEO_LAND_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES,
  CAO_FOUNDATION_DEFAULT_BASE_COLORS,
  CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES,
  caoFoundationSurfaceClassAppearance,
  CAO_FOUNDATION_MAX_SURFACE_EDGE_DEGREES,
  CAO_FOUNDATION_SURFACE_PRECEDENCE,
  CAO_FOUNDATION_GLOBE_SPHERE_RENDER_ORDER,
  CAO_FOUNDATION_SURFACE_SHELLS,
  caoFoundationSurfaceClassVisible,
  CaoFoundationSurfaceRenderer,
  caoFoundationChordSagMetres,
  caoFoundationSurfaceClass,
  caoFoundationShellOffsetMetres,
  type CaoFoundationSurfaceClass,
  caoFoundationCountryLineHalfWidthPx,
  caoFoundationCountryLinePadPx,
  caoFoundationCountryLineQuadBytes,
  CAO_FOUNDATION_COUNTRY_LINE_DARK_INK,
  CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK,
  CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK_STYLE,
  createCaoFoundationCountryLineMaterial,
  createCaoFoundationCountryLineToneTexture,
  createCaoFoundationGeometryResource,
  caoFoundationMaxDisplayedShellMetres,
  createCaoFoundationPaletteTexture,
  estimateCaoFoundationGeometryReservation,
  evaluateCountryLineCoverage,
  evaluateCountryLineHorizonVisibility,
  evaluateCountryLineQuadOffsetPx,
  evaluateCountryLineSegmentVisibility,
  caoFoundationAppearanceDim,
  caoFoundationAppearanceFrontSideOnly,
  caoFoundationAppearanceRoughness,
  caoFoundationBatchAppearance,
  caoFoundationSurfaceCoversDirection,
  intersectCaoFoundationSurface,
  packPreparedCaoPalette,
} from "./caoFoundation";
import { GpuRetirementOwner } from "./gpuRetirement";
import { resolveReleasableNativeSurfaceClasses, resolveSurfaceVisibility } from "./surfaceVisibility";
import { GUIDE_LABEL_LIGHT_INK_STYLE } from "../globeGuides";
import {
  PALAEO_OUTLINE_TONE_LAND,
  PALAEO_OUTLINE_TONE_SHALLOW,
  PALAEO_OUTLINE_TONE_TEXTURE_WIDTH,
  buildPalaeoOutlineToneTexels,
  decodePalaeoOutlineToneTables,
  encodePalaeoOutlineToneTables,
  palaeoOutlineToneTextureRows,
  type PalaeoOutlineToneClass,
} from "../../reconstruction/outlineTones";

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
      formationUncertainActiveCharts: 0, restoredCollisionMarginActiveCharts: 0,
      modelInferredPoseActiveCharts: 0,
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

/**
 * The direct operands of a node, so a test can pin a term rather than mere
 * reachability. TSL wraps an expression in a single-child VarNode, so the walk
 * descends through single-child wrappers before returning the operand set.
 */
function nodeOperands(root: unknown): Set<unknown> {
  const childrenOf = (node: unknown) => {
    const getChildren = (node as { getChildren?: () => Iterable<unknown> })?.getChildren;
    return typeof getChildren === "function" ? [...getChildren.call(node)] : [];
  };
  let node = root;
  for (let depth = 0; depth < 4; depth += 1) {
    const children = childrenOf(node);
    if (children.length !== 1) return new Set(children);
    node = children[0];
  }
  return new Set();
}

/**
 * Descendants of `root` reachable without passing through `blocked`. A varying
 * is the stage boundary, so "what does the fragment stage evaluate itself" is
 * exactly this walk with the varying blocked.
 */
function nodeDescendantsExcept(root: unknown, blocked: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (node === null || typeof node !== "object" || seen.has(node) || node === blocked) return;
    seen.add(node);
    const children = (node as { getChildren?: () => Iterable<unknown> }).getChildren;
    if (typeof children === "function") for (const child of children.call(node)) visit(child);
  };
  visit(root);
  return seen;
}

const textureNodesIn = (nodes: Iterable<unknown>) =>
  [...nodes].filter((node) => (node as { isTextureNode?: boolean }).isTextureNode === true);

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
      // The production reservation in GlobeScene: 680,000 vertices and 740,000
      // triangles. The composed public package holds 404,888 vertices and
      // 574,075 triangles before country-line quads, and its 51,048 country
      // segments add 204,192 quad vertices and 102,096 quad triangles.
      maxVertices: 680_000,
      maxTriangles: 740_000,
      maxRetainedSourceBytes: 48 * 1024 * 1024,
      maxPublicationBytes: 2 * 1024 * 1024,
    };
    const resource = createCaoFoundationGeometryResource(revision, packageLimits);
    expect(resource.batches).toHaveLength(6);
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

  it("draws each country outline segment as one thin analytically shaded quad", () => {
    // A GPU line primitive is one device pixel wide on both backends, so a
    // single hairline loses coverage to multisampling and reads as beaded. The
    // remedy is a screen-space quad shaded from its own coverage, not extra
    // copies: the visual core stays one CSS pixel and only the ramp sits
    // outside it. Pin the width so a later "make it visible" nudge cannot
    // quietly reintroduce the thickening the user rejected.
    expect(CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX).toBe(1);
    expect(CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX).toBe(1);
    // Device pixels come from the renderer's pixel ratio: one CSS pixel is two
    // device pixels at ratio 2 and one at ratio 1, so the stroke keeps the same
    // apparent width on every display instead of halving on a retina panel.
    expect(caoFoundationCountryLineHalfWidthPx(1)).toBe(0.5);
    expect(caoFoundationCountryLineHalfWidthPx(2)).toBe(1);
    expect(caoFoundationCountryLineHalfWidthPx(1.25)).toBe(0.625);
    // The quad must reach half a ramp beyond the core or the ramp is clipped.
    expect(caoFoundationCountryLinePadPx(2)).toBe(1.5);
    expect(caoFoundationCountryLinePadPx(1)).toBe(1);
    // Four corners, two triangles, one quad per segment.
    expect(CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS).toHaveLength(12);
    expect(CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES).toHaveLength(6);
    const corners = [0, 1, 2, 3].map((index) =>
      CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS.slice(index * 3, index * 3 + 3));
    // Every (endpoint, side) combination appears exactly once, and the quad is
    // flat in its own space: the third component carries nothing.
    expect(corners.map(([along, side]) => `${along},${side}`).sort())
      .toEqual(["-1,-1", "-1,1", "1,-1", "1,1"]);
    expect(corners.every(([, , depth]) => depth === 0)).toBe(true);
    // Both triangles are drawn from those four corners and cover the quad once.
    expect([...CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES].every((index) => index >= 0 && index < 4))
      .toBe(true);
    expect(new Set(CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES).size).toBe(4);
    // One draw now, not nine: the whole overlay is a single pass over the
    // expanded geometry, with no second contrast pass to compose with.
    expect(CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET).toBe(1);

    const packed = packPreparedCaoPalette(fixture(), 2_048);
    const texture = createCaoFoundationPaletteTexture(packed);
    const strokeSegments = 9;
    const stroke = createCaoFoundationCountryLineMaterial(texture, packed.width, 0,
      strokeSegments);
    expect(stroke.material.opacity).toBe(0.92);
    for (const graph of [stroke]) {
      // A quad corner is rasterized up to a pixel and a half from the pixel its
      // depth was computed for, so occlusion is the analytic horizon term,
      // never the depth buffer.
      expect(graph.material.depthTest).toBe(false);
      expect(graph.material.depthWrite).toBe(false);
      expect(graph.material.transparent).toBe(true);
      // The far hemisphere is hidden by nothing but the horizon term, and the
      // stroke's edge by nothing but the coverage term. Pin that the material's
      // opacity is actually built from both: losing the horizon multiply would
      // render all 12 045 segments through the planet, and losing the coverage
      // multiply would hand back a hard-edged pad-wide band with the suite
      // green either way.
      expect(graph.material.opacityNode).not.toBeNull();
      const opacityNodes = nodeDescendants(graph.material.opacityNode);
      expect(opacityNodes).toContain(graph.horizonVisibility);
      expect(opacityNodes).toContain(graph.coverage);
      // The coverage term must read the interpolated perpendicular distance and
      // the device half width; a coverage built from either alone would be
      // either width-independent or constant across the stroke.
      // Identity of each term, not reachability: the varying is scaled by a pad
      // built from the same half width, so every term is reachable from every
      // other and a graph walk cannot tell a swapped argument from the real one.
      expect(graph.coverageInputs.distancePixels).toBe(graph.perpendicularPixels);
      expect(graph.coverageInputs.halfWidthPixels).toBe(graph.halfWidthPixels);
      expect(nodeDescendants(graph.coverage)).toContain(graph.coverageInputs.distancePixels);
      expect(nodeDescendants(graph.coverage)).toContain(graph.coverageInputs.halfWidthPixels);
      expect(nodeDescendants(graph.coverage)).toContain(graph.coverageInputs.featherPixels);
      // The distance must arrive through a varying. Anything else is a constant
      // across the quad and the stroke loses its cross-section entirely.
      expect([...nodeDescendants(graph.perpendicularPixels)]
        .filter((node) => (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(1);
      // And the join between the quad expansion and the clip position: if
      // vertexNode dropped the offset, all four corners would land on the
      // centre line and the outline would rasterize nothing at all.
      expect(graph.material.vertexNode).not.toBeNull();
      const vertexNodes = nodeDescendants(graph.material.vertexNode);
      expect(vertexNodes).toContain(graph.quadOffsetPixels[0]);
      expect(vertexNodes).toContain(graph.quadOffsetPixels[1]);
      // The half width has to reach the geometry too, or the quad would carry a
      // ramp it never leaves room for.
      expect(vertexNodes).toContain(graph.halfWidthPixels);
      // And the vertex-stage far-side collapse, which is what keeps back-side
      // segments from rasterizing now that early-Z is gone. It must reach both
      // the corner position and the screen offset: collapsing only the position
      // would leave a fixed-size square at the globe centre.
      expect(graph.material.positionNode).not.toBeNull();
      expect(nodeDescendants(graph.material.positionNode)).toContain(graph.vertexVisible);
      expect(vertexNodes).toContain(graph.vertexVisible);
      // Direct operands, not reachability: the collapse factor is reachable from
      // the offset anyway, because the offset is derived from the collapsed
      // endpoint positions. Only the immediate children say it was applied.
      const offsetOperands = nodeOperands(graph.collapsedOffsetPixels);
      expect(offsetOperands).toContain(graph.vertexVisible);
      expect(offsetOperands).toContain(graph.quadOffsetVector);
      expect(nodeDescendants(graph.quadOffsetVector)).toContain(graph.quadOffsetPixels[0]);
      expect(nodeDescendants(graph.quadOffsetVector)).toContain(graph.quadOffsetPixels[1]);
      expect(vertexNodes).toContain(graph.collapsedOffsetPixels);
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
      // graph — now twice over, once per endpoint — into the fragment shader
      // and runs it per outline fragment.
      const fragmentGraph = nodeDescendants(graph.horizonVisibility);
      expect(fragmentGraph).toContain(graph.fragmentDirection);
      expect([...nodeDescendants(graph.fragmentDirection)]
        .filter((node) => (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(1);
      const vertexTerm = nodeDescendants(graph.vertexVisible);
      expect(vertexTerm).toContain(vertexCullCos);
      expect(vertexTerm).toContain(vertexCullSin);
      expect(vertexTerm).not.toContain(fragmentCos);
      // The vertex stage must NOT go through the varying: it needs the value
      // before interpolation, and a varying there would be a stage error.
      expect([...vertexTerm].filter((node) =>
        (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(0);
      expect(fragmentGraph).toContain(fragmentCos);
      expect(fragmentGraph).toContain(fragmentSin);
      expect(fragmentGraph).not.toContain(vertexCullCos);
      expect(fragmentGraph).not.toContain(vertexCullSin);

      // Two-tone ink. The colour must be a real mix of the two inks, not the
      // dark constant it used to be: a colorNode left at `darkInk` would keep
      // every outline legible over land and invisible over a palaeo sea, with
      // the whole tone pipeline uploading tables nothing reads.
      expect(graph.material.colorNode).not.toBeNull();
      expect(graph.material.colorNode).not.toBe(graph.darkInk);
      expect(graph.material.colorNode).not.toBe(graph.lightInk);
      const colorNodes = nodeDescendants(graph.material.colorNode);
      expect(colorNodes).toContain(graph.darkInk);
      expect(colorNodes).toContain(graph.lightInk);
      expect(colorNodes).toContain(graph.toneMix);
      const colorOperands = nodeOperands(graph.material.colorNode);
      expect(colorOperands).toContain(graph.darkInk);
      expect(colorOperands).toContain(graph.lightInk);
      expect(colorOperands).toContain(graph.toneMix);
      // The tone arrives through exactly one varying, and that varying is flat:
      // all four corners of a quad carry the same segment index, so there is no
      // gradient to interpolate and a smooth varying would only invite one.
      expect((graph.toneMix as { isVaryingNode?: boolean }).isVaryingNode).toBe(true);
      expect((graph.toneMix as { interpolationType?: string }).interpolationType).toBe("flat");
      expect([...colorNodes]
        .filter((node) => (node as { isVaryingNode?: boolean }).isVaryingNode)).toHaveLength(1);
      expect(nodeDescendants(graph.toneMix)).toContain(graph.segmentToneSample);
      // And the texture load stays behind that varying. Reading the tone table
      // in the fragment stage would run a texture load per outline fragment for
      // a value that is constant across the whole quad.
      const toneTextureNodes = textureNodesIn(colorNodes);
      expect(toneTextureNodes).toHaveLength(1);
      expect((toneTextureNodes[0] as { value?: unknown }).value).toBe(graph.toneTexture);
      expect(textureNodesIn(nodeDescendantsExcept(graph.material.colorNode, graph.toneMix)))
        .toHaveLength(0);
    }
    // The inks themselves. The dark slate is unchanged, and the light grey is
    // the guide labels' own water ink so an outline over a palaeo sea reads
    // like a label over the same water.
    expect([...CAO_FOUNDATION_COUNTRY_LINE_DARK_INK]).toEqual([0.12, 0.15, 0.18]);
    expect(CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK_STYLE).toBe(GUIDE_LABEL_LIGHT_INK_STYLE);
    expect([...CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK]).toEqual(
      [...new Color().setStyle(GUIDE_LABEL_LIGHT_INK_STYLE, SRGBColorSpace).toArray()]);
    // Decoded out of sRGB, so the outline matches the guide-label texture on
    // screen rather than rendering a visibly brighter grey.
    expect(CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK[0]).toBeLessThan(0xd0 / 255);
    expect(CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK[0]).toBeGreaterThan(0.5);
    stroke.toneTexture.dispose();
    stroke.material.dispose();
    texture.dispose();
  });

  it("carries one tone per outline segment and stays dark without a table", () => {
    const segmentCount = 300;
    const toneTexture = createCaoFoundationCountryLineToneTexture(segmentCount);
    const rows = palaeoOutlineToneTextureRows(segmentCount);
    expect(rows).toBe(3);
    expect(toneTexture.image.width).toBe(PALAEO_OUTLINE_TONE_TEXTURE_WIDTH);
    expect(toneTexture.image.height).toBe(rows);
    // Zero-filled: `mix(dark, light, 0)` is `dark` exactly, so an outline with
    // no table loaded is the single-ink outline this change started from.
    expect([...(toneTexture.image.data as Uint8Array)].every((value) => value === 0)).toBe(true);
    toneTexture.dispose();

    const packed = packPreparedCaoPalette(fixture(), 2_048);
    const palette = createCaoFoundationPaletteTexture(packed);
    const graph = createCaoFoundationCountryLineMaterial(palette, packed.width, 0, segmentCount);
    const data = graph.toneTexture.image.data as Uint8Array;
    expect(graph.toneCounts()).toEqual({ darkSegments: segmentCount, lightSegments: 0 });

    const classes = Array.from({ length: segmentCount }, (_, index) =>
      (index < 120 ? PALAEO_OUTLINE_TONE_SHALLOW
        : PALAEO_OUTLINE_TONE_LAND) as PalaeoOutlineToneClass);
    const tables = decodePalaeoOutlineToneTables(
      encodePalaeoOutlineToneTables([classes], segmentCount), segmentCount);
    const texels = buildPalaeoOutlineToneTexels(tables, 0);

    // `needsUpdate` is write-only on a three texture; `version` is what the
    // backend actually re-uploads on, so that is what an upload is counted by.
    const uploads = () => graph.toneTexture.version;
    const beforeFirst = uploads();
    expect(graph.setToneTable(texels))
      .toEqual({ darkSegments: 180, lightSegments: 120 });
    expect(uploads()).toBe(beforeFirst + 1);
    expect(data[0]).toBe(255);
    expect(data[119]).toBe(255);
    expect(data[120]).toBe(0);

    // Reapplying the resident table must not re-upload it: the renderer
    // reapplies on every publication, which is every scrub sample.
    const beforeRepeat = uploads();
    expect(graph.setToneTable(texels.slice()))
      .toEqual({ darkSegments: 180, lightSegments: 120 });
    expect(uploads()).toBe(beforeRepeat);

    // Null restores the all-dark table, and that *is* a change.
    expect(graph.setToneTable(null))
      .toEqual({ darkSegments: segmentCount, lightSegments: 0 });
    expect(uploads()).toBe(beforeRepeat + 1);
    expect([...data].every((value) => value === 0)).toBe(true);

    // A table sized for another outline package is rejected rather than
    // partially applied.
    expect(() => graph.setToneTable(new Uint8Array(texels.length + 1)))
      .toThrow(/tone table shape mismatch/);

    graph.toneTexture.dispose();
    graph.material.dispose();
    palette.dispose();
  });

  it("expands a segment into a quad of the stroke's own width", () => {
    // Same formula the material's vertexNode consumes, driven with numbers.
    const offset = (start: readonly [number, number], end: readonly [number, number],
      along: number, side: number, pad = 1.5) =>
      evaluateCountryLineQuadOffsetPx(numberScalarOps, {
        startPixelX: start[0], startPixelY: start[1], endPixelX: end[0], endPixelY: end[1],
        along, side, padPixels: pad,
      });
    // A horizontal segment is widened vertically by exactly the pad, and never
    // by more: the perpendicular offset magnitude is the half extent itself.
    expect(offset([0, 0], [10, 0], -1, 1)).toEqual([-1.5, 1.5]);
    expect(offset([0, 0], [10, 0], 1, 1)).toEqual([1.5, 1.5]);
    expect(offset([0, 0], [10, 0], 1, -1)).toEqual([1.5, -1.5]);
    // The end extension is along the segment, so the corner at the start end
    // overhangs backwards and the one at the end end overhangs forwards. That
    // overlap is what fills the notch a bare butt join would leave.
    expect(offset([0, 0], [10, 0], -1, 1)[0]).toBeLessThan(0);
    expect(offset([0, 0], [10, 0], 1, 1)[0]).toBeGreaterThan(0);
    // A diagonal is widened perpendicular to itself, not along an axis: the
    // offset magnitude stays the pad diagonal regardless of bearing.
    for (const bearing of [0, 17, 45, 90, 143, 270]) {
      const radians = bearing * Math.PI / 180;
      const end: readonly [number, number] = [Math.cos(radians) * 7, Math.sin(radians) * 7];
      const [x, y] = offset([0, 0], end, 1, 1);
      expect(Math.hypot(x, y)).toBeCloseTo(Math.hypot(1.5, 1.5), 12);
      // The perpendicular component is exactly the pad, measured against the
      // segment's own unit direction.
      const [ux, uy] = [Math.cos(radians), Math.sin(radians)];
      expect(x * -uy + y * ux).toBeCloseTo(1.5, 12);
      expect(x * ux + y * uy).toBeCloseTo(1.5, 12);
    }
    // Pad scales the whole quad linearly, so the width constant is the only
    // thing that sets the stroke's size.
    expect(offset([0, 0], [10, 0], 1, 1, 3)).toEqual([3, 3]);
    // A segment whose endpoints land on one pixel has no direction. It must
    // produce a finite square, never a NaN from a zero-length normalise.
    const degenerate = offset([4, 4], [4, 4], 1, 1);
    expect(degenerate.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...degenerate)).toBeCloseTo(Math.hypot(1.5, 1.5), 12);
    const subPixel = offset([4, 4], [4 + 1e-9, 4], 1, 1);
    expect(subPixel.every(Number.isFinite)).toBe(true);
    // The guard only catches genuinely degenerate segments: a segment a pixel
    // long still takes its own direction.
    expect(offset([0, 0], [0, 1], 1, 1)).toEqual([-1.5, 1.5]);
  });

  it("shades the stroke from analytic coverage across one device pixel", () => {
    // Same formula the material's opacityNode consumes, driven with numbers.
    const coverage = (distancePixels: number, halfWidthPixels = 1, featherPixels = 1) =>
      evaluateCountryLineCoverage(numberScalarOps, { distancePixels, halfWidthPixels, featherPixels });
    // Fully covered on the centre line, and the ramp is centred on the core
    // edge, so the half width is exactly the half-coverage contour a reader
    // perceives as the stroke's boundary.
    expect(coverage(0)).toBe(1);
    expect(coverage(1)).toBeCloseTo(0.5, 12);
    expect(coverage(-1)).toBeCloseTo(0.5, 12);
    // Nothing outside the ramp; the quad's pad is exactly that far out.
    expect(coverage(1.5)).toBe(0);
    expect(coverage(-1.5)).toBe(0);
    expect(coverage(4)).toBe(0);
    // And the core itself is opaque, not a peak: a stroke wider than the ramp
    // has a flat top rather than a spike.
    expect(coverage(0.5)).toBe(1);
    expect(coverage(-0.5)).toBe(1);
    // The ramp is the cubic smoothstep, not a linear fade: pin a point where
    // the two differ, or the coverage could silently become a straight edge.
    expect(coverage(1.25)).toBeCloseTo(0.15625, 12);
    expect(coverage(0.75)).toBeCloseTo(0.84375, 12);
    // Monotone across the ramp, so no banding.
    const ramp = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4].map((d) => coverage(d));
    expect(ramp.every((value, index) => index === 0 || value <= ramp[index - 1]!)).toBe(true);
    // Symmetric about the centre line: the stroke does not lean to one side.
    for (const distance of [0.25, 0.75, 1.1, 1.49]) {
      expect(coverage(distance)).toBeCloseTo(coverage(-distance), 12);
    }
    // At device pixel ratio 1 the core is half a pixel and the ramp reaches the
    // full pixel; the centre is still opaque.
    const thin = caoFoundationCountryLineHalfWidthPx(1);
    expect(coverage(0, thin)).toBe(1);
    expect(coverage(thin, thin)).toBeCloseTo(0.5, 12);
    expect(coverage(thin + CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX / 2, thin)).toBe(0);
  });

  it("keeps a segment that straddles the terminator and drops one whose chart is gone", () => {
    // Same formula the material's vertex stage consumes, driven with numbers.
    const visible = (startVisible: number, endVisible: number,
      startActive = 1, endActive = 1) =>
      evaluateCountryLineSegmentVisibility(numberScalarOps,
        { startVisible, endVisible, startActive, endActive });
    // Either end inside the widened terminator keeps the whole quad. Requiring
    // both would erase the outline a full cull margin inside the limb, which is
    // exactly the band the fragment term is there to cut precisely.
    expect(visible(1, 1)).toBe(1);
    expect(visible(1, 0)).toBe(1);
    expect(visible(0, 1)).toBe(1);
    expect(visible(0, 0)).toBe(0);
    // A segment whose chart does not exist at this age has both endpoints at
    // the globe centre. It must be discarded whole — including its screen
    // expansion — however visible that centre point happens to be.
    expect(visible(1, 1, 0, 1)).toBe(0);
    expect(visible(1, 1, 1, 0)).toBe(0);
    expect(visible(1, 1, 0, 0)).toBe(0);
    expect(visible(1, 0, 0, 1)).toBe(0);
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
    // must stay below the outline shell.
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
    // 800 m shell + 33 m x 30 stays under the 1 800 m outline shell; 34 m does not.
    expect(caoFoundationMaxDisplayedShellMetres(33, 0, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBeLessThan(CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES);
    expect(caoFoundationMaxDisplayedShellMetres(34, 0, CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES))
      .toBeGreaterThanOrEqual(CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES);
    expect(() => surface.publish(lifted(33), 8)).not.toThrow();
    expect(() => surface.publish(lifted(34), 8)).toThrow(/lift the surface through the country-line shell/);
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

    // A line batch's GPU cost is the quad expansion, not the source line form,
    // so the reservation has to carry it explicitly. A package that shared line
    // vertices between segments would make "bounded by the source bytes" false,
    // which is why the ledger is a counted term rather than an assumption.
    expect(caoFoundationCountryLineQuadBytes(0)).toBe(0);
    // Four corners of (quad-local corner, start, end, entry) at 40 bytes each,
    // plus six 32-bit indices.
    expect(CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES).toBe(200);
    expect(caoFoundationCountryLineQuadBytes(1_000))
      .toBe(1_000 * CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES);
    // The shipped country batch, counted once so a per-corner attribute cannot
    // be added without the ledger moving with it.
    expect(caoFoundationCountryLineQuadBytes(12_045)).toBe(2_409_000);
    const shared = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const strip = { ...fixture(), lineBatches: [{ batchId: "countries",
      staticGeometryIdentity: "countries@1", vertexCount: 3, segmentCount: 2,
      // A shared-vertex polyline: two segments over three vertices, the shape
      // whose source bytes would *not* bound the quad expansion.
      staticGeometryBytes: shared.byteLength + 4 * 4 + 3 * 2 + 3 * 2,
      createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(shared),
        lineIndices: new Uint32Array([0, 1, 1, 2]),
        preparedEntryIndices: new Uint16Array([0, 0, 0]),
        materialChartIndices: new Uint16Array([0, 0, 0]) }) }] } as PreparedCaoRevision;
    // A segment is four expanded corners and two triangles now, not two package
    // vertices and one line primitive, and the preflight has to say so: the
    // surface batch contributes three vertices and one triangle, so a ceiling
    // that admits the two quads exactly is the smallest that passes.
    expect(() => estimateCaoFoundationGeometryReservation(strip,
      { ...limits, maxTriangles: 1 + 2 * 2 })).not.toThrow();
    expect(() => estimateCaoFoundationGeometryReservation(strip,
      { ...limits, maxTriangles: 2 * 2 })).toThrow(/exceeds renderer limit/);
    expect(() => estimateCaoFoundationGeometryReservation(strip,
      { ...limits, maxVertices: 3 + 2 * CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT }))
      .not.toThrow();
    expect(() => estimateCaoFoundationGeometryReservation(strip,
      { ...limits, maxVertices: 2 + 2 * CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT }))
      .toThrow(/exceeds renderer limit/);
    const stripReservation = estimateCaoFoundationGeometryReservation(strip, limits);
    const stripResource = createCaoFoundationGeometryResource(strip, limits);
    expect(stripResource.byteLength).toBeLessThanOrEqual(stripReservation);
    // The middle vertex is genuinely reused by both quads, each carrying its own
    // copy of both endpoints.
    const stripGeometry = stripResource.lineBatches[0]!.geometry;
    expect(stripGeometry.getAttribute("position").count).toBe(8);
    expect(stripGeometry.index?.count).toBe(12);
    // The second quad's indices address its own corners, not the first quad's.
    expect([...(stripGeometry.index!.array as Uint32Array)].slice(6))
      .toEqual([...CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES].map((index) => index + 4));
    const quadEndpoints = (name: string, quad: number) =>
      [...(stripGeometry.getAttribute(name).array as Float32Array)].slice(quad * 12, quad * 12 + 3);
    expect(quadEndpoints("countryLineStart", 0)).toEqual([1, 0, 0]);
    expect(quadEndpoints("countryLineEnd", 0)).toEqual([0, 1, 0]);
    expect(quadEndpoints("countryLineStart", 1)).toEqual([0, 1, 0]);
    expect(quadEndpoints("countryLineEnd", 1)).toEqual([0, 0, 1]);
    // Every corner carries its own segment index: the tone table is addressed
    // by it, so a corner holding the wrong segment would paint one outline
    // segment in another segment's ink.
    const segmentAttribute = stripGeometry.getAttribute("countryLineSegmentIndex") as BufferAttribute;
    expect(segmentAttribute.gpuType).toBe(IntType);
    expect([...(segmentAttribute.array as Uint32Array)]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    stripResource.dispose();
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
    // A non-zero palette entry, so an expansion that only reached the first
    // corner of a quad could not pass by writing the default zero everywhere.
    const preparedEntryIndices = new Uint16Array([1, 1]);
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
    // The package's two-vertex line form is expanded once, at publication, into
    // one four-corner quad per segment. The corners are materialised rather
    // than instanced: a software rasterizer charges per-instance setup in full,
    // and 12 045 four-vertex instances made the overlay three times more
    // expensive there than the hairline it replaced.
    const lineGeometry = resource.lineBatches[0]!.geometry;
    expect(lineGeometry).not.toBeInstanceOf(InstancedBufferGeometry);
    expect(lineGeometry.getAttribute("position").count)
      .toBe(CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT);
    expect(lineGeometry.index?.count).toBe(CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT);
    const entryAttribute = lineGeometry.getAttribute("countryLineEntryIndex") as BufferAttribute;
    expect(entryAttribute).not.toBeInstanceOf(InstancedBufferAttribute);
    expect(entryAttribute.gpuType).toBe(IntType);
    expect(entryAttribute.count).toBe(4);
    // The chart binding reaches every corner, so the motion palette still
    // drives the whole quad.
    expect([...(entryAttribute.array as Uint32Array)]).toEqual([1, 1, 1, 1]);
    // Both endpoints reach every corner, which is the whole reason for the
    // expansion: a corner cannot be placed without the segment direction.
    const repeated = (values: Float32Array) => [0, 1, 2, 3].flatMap(() => [...values]);
    expect([...(lineGeometry.getAttribute("countryLineStart").array as Float32Array)])
      .toEqual(repeated(referenceDirections.subarray(0, 3)));
    expect([...(lineGeometry.getAttribute("countryLineEnd").array as Float32Array)])
      .toEqual(repeated(referenceDirections.subarray(3, 6)));
    // Each corner keeps its own quad-local coordinate, and the indices address
    // this segment's own four corners.
    expect([...(lineGeometry.getAttribute("position").array as Float32Array)])
      .toEqual([...CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS]);
    expect([...(lineGeometry.index!.array as Uint32Array)])
      .toEqual([...CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES]);
    expect(resource.lineBatches[0]!.segmentCount).toBe(1);
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, limits);
    const diagnostics = surface.publish(revision, 8);
    // One spatial batch, one native boundary, and one country-line draw: the
    // whole overlay is a single pass over the expanded quads.
    const lineDraws = CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET;
    expect(lineDraws).toBe(1);
    expect(diagnostics).toMatchObject({ drawCount: 3, countryLineBatches: 1,
      countryLineSegments: 1, nativeBoundarySegments: 1, nativeBoundarySourceAgeMa: 0,
      topologyOwnershipRings: 1, topologyOwnershipSourceAgeMa: 0,
      // No tone table loaded: every segment is dark, which is the outline the
      // globe drew before the palaeo mode existed.
      countryLineToneDarkSegments: 1, countryLineToneLightSegments: 0 });
    const oneLight = buildPalaeoOutlineToneTexels(decodePalaeoOutlineToneTables(
      encodePalaeoOutlineToneTables([[PALAEO_OUTLINE_TONE_SHALLOW]], 1), 1), 0);
    expect(surface.setCountryLineToneTable(oneLight))
      .toEqual({ darkSegments: 0, lightSegments: 1 });
    expect(surface.diagnostics()).toMatchObject({ countryLineToneLightSegments: 1 });
    // A republication — every scrub sample is one — must keep the loaded tones
    // rather than flashing the outline back to a single ink for a frame.
    surface.publish({ ...revision }, 8);
    expect(surface.countryLineToneCounts()).toEqual({ darkSegments: 0, lightSegments: 1 });
    expect(surface.setCountryLineToneTable(null))
      .toEqual({ darkSegments: 1, lightSegments: 0 });
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
    surface.setLayerVisibility({ borders: false, tectonics: false, palaeoCoastlines: false });
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

  it("resolves every drawing class through one decision point", () => {
    // Undeclared batches keep the batch-id default the shipped package relies on.
    expect(caoFoundationBatchAppearance("batch-shelf")).toBe("shelf");
    expect(caoFoundationBatchAppearance("batch-land")).toBe("land");
    expect(caoFoundationBatchAppearance("correction-fine")).toBe("land");
    // A declared class wins over any name the renderer might otherwise parse.
    expect(caoFoundationBatchAppearance("palaeo-0", "palaeo-land")).toBe("palaeo-land");
    expect(caoFoundationBatchAppearance("palaeo-1", "palaeo-shallow-marine"))
      .toBe("palaeo-shallow-marine");
    expect(caoFoundationBatchAppearance("palaeo-2", "palaeo-mountain")).toBe("palaeo-mountain");
    expect(caoFoundationBatchAppearance("anything", "shelf")).toBe("shelf");
    // An unknown class must never default to land: a shallow sea drawn as a
    // continent is exactly the misreading the class exists to prevent.
    expect(() => caoFoundationBatchAppearance("palaeo-3", "palaeo-lagoon"))
      .toThrow(/unknown Cao foundation batch surface appearance/);
    expect(() => validateSpatialBatchSurfaceAppearanceV2(
      { surfaceAppearance: "palaeo-lagoon" as never }))
      .toThrow(/unknown Cao spatial batch surface appearance/);
    expect(() => validateSpatialBatchSurfaceAppearanceV2({ surfaceAppearance: undefined }))
      .not.toThrow();
    // Corrections are drawn with the land appearance but are their own class.
    expect(caoFoundationSurfaceClass("land", true)).toBe("corrections");
    expect(caoFoundationSurfaceClass("land", false)).toBe("land");
    expect(caoFoundationSurfaceClass("palaeo-land", false)).toBe("palaeo-land");
    // Shells follow the resolved appearance, not the batch id.
    expect(caoFoundationShellOffsetMetres("batch-shelf")).toBe(CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES);
    expect(caoFoundationShellOffsetMetres("palaeo-0", "palaeo-mountain"))
      .toBe(CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES);

    // Default colours are package data; these are the values the compiler emits.
    expect(CAO_FOUNDATION_DEFAULT_BASE_COLORS["palaeo-land"].map((value) =>
      Math.round(value * 255))).toEqual([0x9a, 0xa8, 0x6b]);
    expect(CAO_FOUNDATION_DEFAULT_BASE_COLORS["palaeo-mountain"].map((value) =>
      Math.round(value * 255))).toEqual([0x71, 0x22, 0x0e]);
    // A linear albedo, not a swatch: the lighting and the ACES curve carry it to
    // a dark reddish brown on screen, so it is deeper and more saturated here
    // than the tone it draws. The rendered contract lives in the browser tone
    // census, which is the only place it can be measured; what this file pins is
    // that the class is a brown at all - red ahead of green ahead of blue.
    const mountain = CAO_FOUNDATION_DEFAULT_BASE_COLORS["palaeo-mountain"];
    expect(mountain[0]).toBeGreaterThan(mountain[1]);
    expect(mountain[1]).toBeGreaterThan(mountain[2]);
    // The mountain class is inked dark by the outline tone table, like land, so
    // the dark ink is what has to stay legible over it. That contrast is a
    // property of the *rendered* tone, not of the albedo: a pre-compensated
    // albedo is darker than the tone it produces, and asserting the ratio on the
    // albedo would read 1.41:1 for ground that renders at 4.79:1. The measured
    // full-light tone is pinned here; the browser tone census measures it.
    expect(contrastRatio(CAO_FOUNDATION_PALAEO_MOUNTAIN_FULL_LIGHT_TONE,
      CAO_FOUNDATION_COUNTRY_LINE_DARK_INK)).toBeGreaterThan(3);
    const shallow = CAO_FOUNDATION_DEFAULT_BASE_COLORS["palaeo-shallow-marine"];
    // Saturated teal: green and blue well above red, and blue at least as strong
    // as green, so it does not read as the olive of a landmass.
    expect(shallow[1]).toBeGreaterThan(shallow[0] * 3);
    expect(shallow[2]).toBeGreaterThan(shallow[1]);
    // The light outline/label ink has to stay legible over it. Country outlines
    // turn light grey over water when the mode is on, so a shallow sea that is
    // too bright erases them.
    expect(contrastRatio(shallow, [0xd0 / 255, 0xd4 / 255, 0xd5 / 255])).toBeGreaterThan(4.5);
    // And it must read as a different, brighter water than the 0.58-dimmed
    // shelf blue it sits on, or the mapped sea is invisible.
    const dimmedShelf = CAO_FOUNDATION_DEFAULT_BASE_COLORS.shelf
      .map((value) => value * caoFoundationAppearanceDim("shelf")) as [number, number, number];
    expect(relativeLuminance(shallow)).toBeGreaterThan(relativeLuminance(dimmedShelf));
    expect(caoFoundationAppearanceDim("palaeo-shallow-marine")).toBe(1);
    expect(caoFoundationAppearanceDim("shelf")).toBe(0.58);
    // Water classes are front-faced; land-like classes keep both faces.
    expect(caoFoundationAppearanceFrontSideOnly("palaeo-shallow-marine")).toBe(true);
    expect(caoFoundationAppearanceFrontSideOnly("palaeo-land")).toBe(false);
    expect(caoFoundationAppearanceFrontSideOnly("palaeo-mountain")).toBe(false);
    expect(caoFoundationAppearanceRoughness("palaeo-mountain"))
      .toBe(caoFoundationAppearanceRoughness("land"));
  });

  it("clears every shell the chord sag could push a triangle through", () => {
    // R(1 - cos(edge/2)): a flat chord sits this far inside the sphere at its
    // midpoint, so a shell at h actually occupies [h - sag, h].
    expect(CAO_FOUNDATION_MAX_SURFACE_EDGE_DEGREES).toBe(1);
    const sag = caoFoundationChordSagMetres(CAO_FOUNDATION_MAX_SURFACE_EDGE_DEGREES);
    expect(sag).toBeCloseTo(242.59, 2);
    expect(caoFoundationChordSagMetres(0)).toBe(0);
    // The 400 m native gap is one sag clearance wide and no more: an edge past
    // about 1.284 degrees already pushes a shelf triangle through the land shell.
    expect(caoFoundationChordSagMetres(1.29)).toBeGreaterThan(
      CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES - CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES);
    expect(() => caoFoundationChordSagMetres(Number.NaN)).toThrow(/chord sag edge/);
    expect(() => caoFoundationChordSagMetres(-1)).toThrow(/chord sag edge/);

    expect(CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES).toBe(400);
    expect(CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES).toBe(700);
    expect(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES).toBe(800);
    expect(CAO_FOUNDATION_PALAEO_LAND_SHELL_OFFSET_METRES).toBe(1_300);
    expect(CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES).toBe(1_600);
    expect(CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES).toBe(1_800);

    // Precedence, draw order and (for the separated classes) shell height are
    // one order, so a class cannot outrank another in the pick and lose in the
    // draw.
    expect(CAO_FOUNDATION_SURFACE_PRECEDENCE).toEqual(["shelf", "correction-shelf",
      "palaeo-shallow-marine", "corrections", "palaeo-land", "palaeo-mountain", "land"]);
    const renderOrders = CAO_FOUNDATION_SURFACE_SHELLS.map((shell) => shell.renderOrder);
    expect(renderOrders).toEqual([...renderOrders].sort((left, right) => left - right));
    expect(new Set(renderOrders).size).toBe(renderOrders.length);

    for (const shell of CAO_FOUNDATION_SURFACE_SHELLS) {
      // Nothing may reach the country-line shell; the publication guard enforces
      // the same bound against the display-height ceiling.
      expect(shell.shellOffsetMetres).toBeLessThan(CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES);
    }

    // The stacking contract binds the classes that actually draw in a band. A
    // class hidden there is exempt: `shelf` is not drawn in the Cao 2017 band at
    // all, so no pair involving it constrains that band's shells.
    const drawnStack = (mode: "native" | "palaeo") => CAO_FOUNDATION_SURFACE_SHELLS
      .filter((shell) => mode === "palaeo" ? shell.visibleInPalaeoMode : shell.visibleInNativeMode)
      .map((shell) => shell.surfaceClass);
    expect(drawnStack("native")).toEqual(["shelf", "correction-shelf", "corrections", "land"]);
    expect(drawnStack("palaeo")).toEqual(["correction-shelf", "palaeo-shallow-marine",
      "palaeo-land", "palaeo-mountain"]);

    const exempt: string[] = [];
    for (const mode of ["native", "palaeo"] as const) {
      const stack = CAO_FOUNDATION_SURFACE_SHELLS.filter((shell) =>
        mode === "palaeo" ? shell.visibleInPalaeoMode : shell.visibleInNativeMode);
      for (let index = 1; index < stack.length; index += 1) {
        const lower = stack[index - 1]!;
        const upper = stack[index]!;
        expect(upper.shellOffsetMetres).toBeGreaterThanOrEqual(lower.shellOffsetMetres);
        if (upper.shellOffsetMetres - sag > lower.shellOffsetMetres) continue;
        // A pair the geometry cannot separate must be separated by policy: a
        // lower class that writes no depth is simply painted over in draw
        // order, and no depth test can interleave the two.
        expect(lower.writesDepth, `${lower.surfaceClass} under ${upper.surfaceClass}`).toBe(false);
        exempt.push(`${lower.surfaceClass}>${upper.surfaceClass}`);
      }
    }
    // Exactly three pairs are exempt, and all three are exempt for the same
    // reason: the lower class of the pair writes no depth, so the class above it
    // simply paints over it in draw order. Two of them are the restored
    // pre-collision margin class, which shares the 700 m shell with
    // palaeo-shallow-marine in the palaeo mode and sits under the 800 m
    // correction shell in the native one. `palaeo-shallow-marine>corrections`
    // is gone from this list because the two are never drawn together: every
    // land-appearance correction is hidden with native land in the palaeo mode.
    expect([...new Set(exempt)].sort()).toEqual([
      "correction-shelf>corrections", "correction-shelf>palaeo-shallow-marine",
      "corrections>land"]);
    // Every depth-writing class is cleared by whatever is drawn above it.
    for (const upper of CAO_FOUNDATION_SURFACE_SHELLS) {
      for (const lower of CAO_FOUNDATION_SURFACE_SHELLS) {
        if (!lower.writesDepth || lower.renderOrder >= upper.renderOrder) continue;
        if (!(lower.visibleInPalaeoMode && upper.visibleInPalaeoMode)
            && !(lower.visibleInNativeMode && upper.visibleInNativeMode)) continue;
        expect(upper.shellOffsetMetres - sag,
          `${upper.surfaceClass} over ${lower.surfaceClass}`)
          .toBeGreaterThan(lower.shellOffsetMetres);
      }
    }
  });

  it("orders the LGM composition so nothing lower overdraws something higher", () => {
    // The `lgm` band is the one composition that draws the native stack and the
    // palaeo stack at the same time: `resolveSurfaceVisibility` keeps
    // `nativeSurfaceMode` at "native" there, because hiding today's land to show
    // three footprints of exposed shelf would blank every coastline on Earth.
    //
    // That is also the one composition where a *lower* class draws *later*:
    // native land is renderOrder 2 at the 800 m shell, and the palaeo classes it
    // must not paint over are renderOrder 1.7 and 1.8 at 1,300 and 1,600 m. Draw
    // order cannot protect them, so depth must: the higher class has to write
    // depth and clear the lower one by more than the 1 degree chord sag.
    const sag = 6_371_000 * (1 - Math.cos((0.5 * Math.PI) / 180));
    const lgmComposition = CAO_FOUNDATION_SURFACE_SHELLS.filter((shell) =>
      shell.visibleInNativeMode || shell.visibleInPalaeoMode);
    expect(lgmComposition.map((shell) => shell.surfaceClass)).toEqual([
      "shelf", "correction-shelf", "palaeo-shallow-marine", "corrections",
      "palaeo-land", "palaeo-mountain", "land"]);

    const lateAndLower: string[] = [];
    for (const upper of lgmComposition) {
      for (const lower of lgmComposition) {
        // `lower` sits on a lower shell than `upper` but is drawn afterwards,
        // so draw order alone would let it paint over the class in front of it.
        if (lower.renderOrder <= upper.renderOrder
            || lower.shellOffsetMetres >= upper.shellOffsetMetres) continue;
        lateAndLower.push(`${lower.surfaceClass}>${upper.surfaceClass}`);
        expect(upper.writesDepth,
          `${lower.surfaceClass} draws after ${upper.surfaceClass} and only depth can stop it`)
          .toBe(true);
        expect(upper.shellOffsetMetres - sag,
          `${upper.surfaceClass} must clear ${lower.surfaceClass} by more than the chord sag`)
          .toBeGreaterThan(lower.shellOffsetMetres);
      }
    }
    // Exactly the two palaeo classes native land is drawn after and under.
    expect(lateAndLower.sort()).toEqual(["land>palaeo-land", "land>palaeo-mountain"]);

    // Nothing that does not write depth may be the only thing standing between a
    // higher class and a later-drawn lower one, and the opaque sphere the whole
    // stack sits on is below every shell and drawn first.
    expect(CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES).toBeGreaterThan(0);
    for (const shell of lgmComposition) {
      expect(shell.renderOrder).toBeGreaterThan(CAO_FOUNDATION_GLOBE_SPHERE_RENDER_ORDER);
    }
  });

  it("hides every native land fill in the effective palaeo mode", () => {
    // The visibility set per {layer flag, effective mode}. `fallback` is the one
    // the first defect got wrong: the layer is on, the palaeo instance draws
    // nothing, and native land must stay exactly where the layer-off
    // composition has it.
    const visibleClasses = (mode: "native" | "palaeo") =>
      CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
        caoFoundationSurfaceClassVisible(surfaceClass, mode));
    // The restored pre-collision margin class is visible in both modes: it
    // carries the shelf's colour and crust's rank, so it never reads as a
    // second land tone, and hiding it in the native mode would make the globe
    // disagree with itself at the same age with the layer off.
    const todaysComposition = ["shelf", "correction-shelf", "corrections", "land"];
    expect(visibleClasses("native")).toEqual(todaysComposition);
    // The Cao 2017 band draws exactly five levels: the deep-sea sphere, mapped
    // shallow sea, mapped land, mapped mountain and the country outlines. The
    // Cao 2024 crust shelf is not one of them — unmapped ground reads as deep
    // sea — and re-enabling it here is the mutation this assertion catches.
    expect(caoFoundationSurfaceClassVisible("shelf", "palaeo")).toBe(false);
    expect(caoFoundationSurfaceClassVisible("shelf", "native")).toBe(true);
    // The restored pre-collision margins still draw in the band — they are the
    // only thing closing a seam the Cao 2017 charts leave open — but with the
    // palaeo shallow-marine appearance, so they are not a second crust level.
    expect(caoFoundationSurfaceClassAppearance("correction-shelf", "shelf", "native"))
      .toBe("shelf");
    expect(caoFoundationSurfaceClassAppearance("correction-shelf", "shelf", "palaeo"))
      .toBe("palaeo-shallow-marine");
    for (const surfaceClass of ["shelf", "palaeo-shallow-marine", "corrections", "land",
      "palaeo-land", "palaeo-mountain"] as const) {
      for (const mode of ["native", "palaeo"] as const) {
        expect(caoFoundationSurfaceClassAppearance(surfaceClass,
          surfaceClass === "corrections" ? "land" : surfaceClass, mode))
          .toBe(surfaceClass === "corrections" ? "land" : surfaceClass);
      }
    }
    // A restored margin is never land-like, in either appearance.
    expect(CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES).not.toContain("correction-shelf");
    // The second defect: `corrections` is drawn in native land's own colour, so
    // leaving it visible here put a second land tone over the Cao 2017 shallow
    // seas — the doubled polygons the user reported. No class drawn in the land
    // colour survives into the palaeo mode.
    expect(visibleClasses("palaeo")).toEqual(
      ["correction-shelf", "palaeo-shallow-marine", "palaeo-land", "palaeo-mountain"]);
    for (const landColoured of ["land", "corrections"] as const) {
      expect(caoFoundationSurfaceClassVisible(landColoured, "palaeo"),
        `${landColoured} must not draw while the Cao 2017 map replaces native land`).toBe(false);
      expect(caoFoundationSurfaceClassVisible(landColoured, "native")).toBe(true);
    }

    const cases = [
      { layerOn: false, insideDomain: false, domainVisible: false, published: false, mode: "off" },
      { layerOn: false, insideDomain: true, domainVisible: true, published: true, mode: "off" },
      { layerOn: true, insideDomain: false, domainVisible: false, published: false, mode: "fallback" },
      { layerOn: true, insideDomain: true, domainVisible: false, published: true, mode: "loading" },
      { layerOn: true, insideDomain: true, domainVisible: true, published: false, mode: "loading" },
      { layerOn: true, insideDomain: true, domainVisible: true, published: true, mode: "on" },
    ] as const;
    for (const probe of cases) {
      const state = resolveSurfaceVisibility({ layerEnabled: probe.layerOn,
        band: probe.insideDomain ? "cao-2017" : "none",
        published: probe.published,
        hysteresis: { visible: probe.domainVisible,
          band: probe.domainVisible ? "cao-2017" : "none", pendingFrames: 0 } });
      expect(state.mode, JSON.stringify(probe)).toBe(probe.mode);
      const classes = visibleClasses(state.nativeSurfaceMode);
      expect(classes.includes("land"), `native land in mode ${state.mode}`)
        .toBe(probe.mode !== "on");
      expect(classes.includes("corrections"), `land corrections in mode ${state.mode}`)
        .toBe(probe.mode !== "on");
      if (probe.mode !== "on") expect(classes).toEqual(todaysComposition);
    }

    // The `lgm` band runs the native mode, so the land-appearance corrections
    // stay drawn there: at 21 ka they are today's observed land and lake infill
    // beside the exposed shelf, not a claim the Cao 2017 map is replacing.
    const lgm = resolveSurfaceVisibility({ layerEnabled: true, band: "lgm", published: true,
      hysteresis: { visible: true, band: "lgm", pendingFrames: 0 } });
    expect(lgm.nativeSurfaceMode).toBe("native");
    expect(visibleClasses(lgm.nativeSurfaceMode)).toEqual(todaysComposition);
  });

  it("draws and picks the palaeo stack in precedence order with native land hidden", () => {
    const revision = palaeoRevision();
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000);
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, palaeoLimits);
    const nativeDiagnostics = surface.publish(revision, 8);
    expect(nativeDiagnostics.palaeoCoastlineMode).toBe(false);
    expect(nativeDiagnostics.chartRanges).toBe(6);
    const meshes = () => group.children[0]!.children.filter((child): child is Mesh =>
      child instanceof Mesh);
    // The mountain's land underlay is a `palaeo-land` mesh like any other, so
    // it is named by the batch it stands under rather than by its class.
    const label = (mesh: Mesh) => (mesh.userData.palaeoLandUnderlayOf === undefined
      ? mesh.userData.surfaceClass as string
      : `underlay-of:${mesh.userData.palaeoLandUnderlayOf as string}`);
    const visibleClasses = () => meshes().filter((mesh) => mesh.visible).map(label);
    expect(meshes().map((mesh) => [label(mesh), mesh.renderOrder])).toEqual([
      ["shelf", 1], ["palaeo-shallow-marine", 1.2], ["corrections", 1.5],
      ["palaeo-land", 1.7], ["underlay-of:palaeo-mountain", 1.7],
      ["palaeo-mountain", 1.8], ["land", 2],
    ]);
    // Depth writing is what forces shell separation; the two classes 100 m apart
    // must not write it. The mountain's land underlay is the third mesh that
    // does not, and the only one whose reason is not a shell: it is the
    // mountain's own geometry 300 m below itself, radially, and near the limb
    // that separation collapses along the view ray, so a depth-writing underlay
    // takes pixels from the mountain standing on it.
    expect(meshes().map((mesh) => (mesh.material as { depthWrite: boolean }).depthWrite))
      .toEqual([true, false, false, true, false, true, true]);
    // The underlay is the mountain's own geometry drawn a second time: one
    // buffer, one extra draw, no extra bytes, and its own land material.
    const mountain = meshes().find((mesh) => mesh.userData.surfaceClass === "palaeo-mountain")!;
    const underlay = meshes().find((mesh) => mesh.userData.palaeoLandUnderlayOf !== undefined)!;
    expect(underlay.geometry).toBe(mountain.geometry);
    expect(underlay.material).not.toBe(mountain.material);
    expect(underlay.userData.surfaceClass).toBe("palaeo-land");
    const land = meshes().find((mesh) => mesh.userData.surfaceClass === "palaeo-land"
      && mesh.userData.palaeoLandUnderlayOf === undefined)!;
    expect(underlay.renderOrder).toBe(land.renderOrder);
    // It takes the land shell and the land draw order, but never the land depth
    // write, and it still depth-tests so the far side of the globe hides it.
    expect((land.material as { depthWrite: boolean }).depthWrite).toBe(true);
    expect((underlay.material as { depthWrite: boolean }).depthWrite).toBe(false);
    expect((underlay.material as { depthTest: boolean }).depthTest).toBe(true);
    // It draws before the mountain it stands under, which is what leaves the
    // mountain's own colour on every pixel the mountain covers.
    expect(underlay.renderOrder).toBeLessThan(mountain.renderOrder);
    expect(visibleClasses()).toEqual(["shelf", "corrections", "land"]);
    expect(nativeDiagnostics.drawCount).toBe(3);

    const palaeoDiagnostics = surface.setPalaeoCoastlineMode(true);
    expect(palaeoDiagnostics.palaeoCoastlineMode).toBe(true);
    // Neither `land` nor `corrections` draws: both carry native land's fill
    // colour, and a second land tone over a Cao 2017 shallow sea is the
    // doubled polygon the mode exists to remove. The underlay draws with the
    // mountain, never without it, and repaints to the land colour with the mode.
    expect(visibleClasses()).toEqual(["palaeo-shallow-marine",
      "palaeo-land", "underlay-of:palaeo-mountain", "palaeo-mountain"]);
    expect((underlay.userData.palaeoAppearanceMix as { value: number }).value).toBe(1);
    expect(palaeoDiagnostics.drawCount).toBe(4);
    surface.setPalaeoCoastlineMode(false);
    expect(visibleClasses()).toEqual(["shelf", "corrections", "land"]);
    expect((underlay.userData.palaeoAppearanceMix as { value: number }).value).toBe(0);
    surface.setLayerVisibility({ borders: true, tectonics: true, palaeoCoastlines: true });
    expect(visibleClasses()).toEqual(["palaeo-shallow-marine",
      "palaeo-land", "underlay-of:palaeo-mountain", "palaeo-mountain"]);

    const resource = createCaoFoundationGeometryResource(revision, palaeoLimits);
    const poses = new Float32Array(6 * 8);
    for (let chart = 0; chart < 6; chart += 1) poses.set([1, 0, 0, 0, 1, 0, 0, 0], chart * 8);
    const pick = (active: readonly number[], mode: "native" | "palaeo") =>
      intersectCaoFoundationSurface(resource, { chartPoses: poses, chartActive: new Uint8Array(active) },
        [3, 0, 0], [-1, 0, 0], 65_536, mode)?.surfaceClass ?? null;
    // Native mode: the palaeo charts are not drawn, so they cannot be picked.
    expect(pick([1, 1, 1, 1, 1, 1], "native")).toBe("land");
    expect(pick([1, 1, 1, 1, 1, 0], "native")).toBe("corrections");
    expect(pick([1, 1, 0, 1, 1, 0], "native")).toBe("shelf");
    // Palaeo mode: every land-coloured native class is hidden, so a correction
    // can no longer be picked over a mapped shallow sea and the pick agrees
    // with the pixels.
    expect(pick([1, 1, 1, 1, 1, 1], "palaeo")).toBe("palaeo-mountain");
    expect(pick([1, 1, 1, 1, 0, 1], "palaeo")).toBe("palaeo-land");
    expect(pick([1, 1, 1, 0, 0, 1], "palaeo")).toBe("palaeo-shallow-marine");
    expect(pick([1, 1, 0, 0, 0, 1], "palaeo")).toBe("palaeo-shallow-marine");
    // The crust shelf is not drawn in the band, so it cannot be picked either:
    // unmapped ground is deep sea and answers nothing.
    expect(pick([1, 0, 0, 0, 0, 1], "palaeo")).toBeNull();
    expect(pick([0, 0, 0, 0, 0, 1], "palaeo")).toBeNull();

    // Coverage by class, and the includeShelf alias unchanged for the callers
    // that only ask "is this land, rather than water of any depth".
    const covers = (active: readonly number[], options: Parameters<
      typeof caoFoundationSurfaceCoversDirection>[3]) =>
      caoFoundationSurfaceCoversDirection(resource,
        { chartPoses: poses, chartActive: new Uint8Array(active) },
        rendererDirection(0, 0), options);
    expect(covers([1, 0, 0, 0, 0, 0], {})).toBe(true);
    expect(covers([1, 0, 0, 0, 0, 0], { includeShelf: false })).toBe(false);
    expect(covers([0, 1, 0, 0, 0, 0], { includeShelf: false })).toBe(false);
    expect(covers([0, 0, 0, 1, 0, 0], { includeShelf: false })).toBe(true);
    expect(covers([0, 0, 0, 0, 1, 0], { includeShelf: false })).toBe(true);
    expect(covers([0, 0, 1, 0, 0, 0], { includeShelf: false })).toBe(true);
    expect(covers([0, 0, 0, 0, 0, 1], { includeShelf: false })).toBe(true);
    expect(covers([0, 1, 0, 0, 0, 0], { surfaceClasses: ["palaeo-shallow-marine"] })).toBe(true);
    expect(covers([0, 0, 0, 1, 0, 0], { surfaceClasses: ["palaeo-shallow-marine"] })).toBe(false);
    expect(covers([1, 1, 1, 1, 1, 1], { surfaceClasses: [] })).toBe(false);
    // surfaceClasses wins over the alias, and an unknown class is rejected.
    expect(covers([1, 0, 0, 0, 0, 0],
      { includeShelf: false, surfaceClasses: ["shelf"] })).toBe(true);
    expect(() => covers([1, 1, 1, 1, 1, 1],
      { surfaceClasses: ["palaeo-lagoon" as CaoFoundationSurfaceClass] }))
      .toThrow(/unknown Cao foundation surface class/);
    expect(CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES).toEqual(
      ["land", "corrections", "palaeo-land", "palaeo-mountain"]);

    resource.dispose();
    surface.disposeForRendererTeardown();
  });

  it("replaces static geometry only when the change was armed, retiring the old copy once", () => {
    const first = palaeoRevision();
    const second = { ...palaeoRevision("@2"), identity: "cao@r1:1", requestId: 2, requestedAgeMa: 1 };
    const third = { ...palaeoRevision("@3"), identity: "cao@r1:2", requestId: 3, requestedAgeMa: 2 };

    // The mixed set is the invariant: one publication carries `batch-land`,
    // which ships once per session, beside `palaeo-land`, which is streamed one
    // interval at a time. A native change is refused even when armed; a Cao 2017
    // change in the same set succeeds.
    const mixedSurface = new CaoFoundationSurfaceRenderer(new Group(),
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits,
      { staticGeometryRetirement: new GpuRetirementOwner(
        { waitForSubmittedWork: async () => {} }, 4, 8 * 1024 * 1024) });
    mixedSurface.publish(palaeoRevision(), 8);
    const nativeChange = (requestId: number) => ({ ...palaeoRevision("@1", "@2"),
      identity: `cao@r1:native${requestId}`, requestId, requestedAgeMa: 1 });
    expect(() => mixedSurface.publish(nativeChange(2), 8))
      .toThrow(/static geometry changed within renderer lifetime/);
    mixedSurface.armStaticGeometryChange("cao 2017 map interval change");
    expect(() => mixedSurface.publish(nativeChange(3), 8))
      .toThrow(/does not allow static geometry replacement: batch-shelf/);
    // The refusal spent nothing: the same arming still carries the Cao 2017 half.
    const mixed = mixedSurface.publish({ ...palaeoRevision("@2"), identity: "cao@r1:mixed",
      requestId: 4, requestedAgeMa: 1 }, 8);
    expect(mixed.staticGeometryIdentity).toContain("palaeo-land@2");
    expect(mixed.staticGeometryIdentity).toContain("batch-land@1");
    mixedSurface.disposeForRendererTeardown();

    // Replacement without a retirement owner would dispose buffers the last
    // submission may still reference.
    const ownerless = new CaoFoundationSurfaceRenderer(new Group(),
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits);
    ownerless.publish(palaeoRevision(), 8);
    ownerless.armStaticGeometryChange("cao 2017 map interval change");
    expect(() => ownerless.publish({ ...palaeoRevision("@2"), identity: "cao@r1:ownerless",
      requestId: 2, requestedAgeMa: 1 }, 8))
      .toThrow(/replacement requires a retirement owner/);
    ownerless.disposeForRendererTeardown();

    const staticCompletions: Array<() => void> = [];
    const staticRetirement = new GpuRetirementOwner({
      waitForSubmittedWork: () => new Promise<void>((resolve) => staticCompletions.push(resolve)),
    }, 4, 8 * 1024 * 1024);
    const surface = new CaoFoundationSurfaceRenderer(new Group(),
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits,
      { staticGeometryRetirement: staticRetirement });
    const firstDiagnostics = surface.publish(first, 8);
    expect(staticRetirement.pendingCount()).toBe(0);
    // Armed replacement is the palaeo instance's normal path; an unarmed one is
    // still a compile or loader defect and must fail loudly.
    expect(() => surface.publish(second, 8))
      .toThrow(/static geometry changed within renderer lifetime/);
    expect(staticRetirement.pendingCount()).toBe(0);
    expect(surface.diagnostics().staticGeometryIdentity)
      .toBe(firstDiagnostics.staticGeometryIdentity);

    surface.armStaticGeometryChange("cao 2017 map interval change");
    const replaced = surface.publish(second, 8);
    expect(replaced.staticGeometryIdentity).not.toBe(firstDiagnostics.staticGeometryIdentity);
    expect(staticRetirement.pendingCount()).toBe(1);
    expect(staticRetirement.pendingBytes()).toBe(firstDiagnostics.retainedStaticBytes);
    // The arming is consumed by exactly one replacement.
    expect(() => surface.publish(third, 8))
      .toThrow(/static geometry changed within renderer lifetime/);
    expect(staticRetirement.pendingCount()).toBe(1);
    // Republishing the same geometry retires nothing further.
    surface.publish({ ...second, identity: "cao@r1:1b", requestId: 4 }, 8);
    expect(staticRetirement.pendingCount()).toBe(1);
    staticCompletions.shift()?.();
    surface.disposeForRendererTeardown();
  });

  it("draws exactly the classes a composition's slots assign", () => {
    const parent = new Group();
    const surface = new CaoFoundationSurfaceRenderer(parent,
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits);
    surface.publish(palaeoRevision(), 8);
    const drawn = () => new Set(parent.children.flatMap((member) => member.children)
      .filter((child) => child.visible && child.userData.surfaceClass !== undefined)
      .map((child) => child.userData.surfaceClass as CaoFoundationSurfaceClass));
    const resolved = (band: CaoPalaeoDomainBand) => resolveSurfaceVisibility({
      layerEnabled: band !== "none", band, published: band !== "none",
      hysteresis: { visible: band !== "none", band, pendingFrames: 0 },
    });

    // Today's composition: the Cao 2024 fills and their land-appearance
    // corrections, and nothing the Cao 2017 map would draw.
    const native = resolved("none");
    expect(native.composition).toBe("native");
    surface.applySurfaceComposition(native.visibleClasses, native.nativeSurfaceMode);
    expect(drawn()).toEqual(new Set(["shelf", "corrections", "land"]));

    // The band: `lm` and `sm` replace today's land and crust shelf in their
    // slots, the mountain slot is filled, and the corrections are hidden with
    // the land they repaint. A restored margin, which this fixture has none of,
    // stays and is repainted as shallow sea.
    const realistic = resolved("cao-2017");
    expect(realistic.composition).toBe("realistic");
    expect(realistic.slots.land).toBe("palaeo-land");
    expect(realistic.slots.continents).toBe("palaeo-shallow-marine");
    expect(realistic.slots.mountain).toBe("palaeo-mountain");
    surface.applySurfaceComposition(realistic.visibleClasses, realistic.nativeSurfaceMode);
    expect(drawn()).toEqual(new Set(["palaeo-shallow-marine", "palaeo-land", "palaeo-mountain"]));

    // The lowstand draws over today's composition rather than instead of it.
    const lgm = resolved("lgm");
    expect(lgm.composition).toBe("lgm");
    surface.applySurfaceComposition(lgm.visibleClasses, lgm.nativeSurfaceMode);
    expect(drawn()).toEqual(new Set(["shelf", "corrections", "land",
      "palaeo-shallow-marine", "palaeo-land", "palaeo-mountain"]));
    surface.disposeForRendererTeardown();
  });

  it("releases and re-uploads the GPU buffers of the classes a composition replaces", () => {
    const surface = new CaoFoundationSurfaceRenderer(new Group(),
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits);
    surface.publish(palaeoRevision(), 8);
    const batches = surface.surfaceView()!.geometry.batches;
    const disposed: string[] = [];
    for (const batch of batches) {
      batch.geometry.addEventListener("dispose", () => disposed.push(batch.batchId));
    }
    const native = batches.filter((batch) => batch.surfaceClass === "land"
      || batch.surfaceClass === "shelf");
    const nativeGpuBytes = native.reduce((sum, batch) => sum + batch.trackedGpuBytes, 0);
    expect(nativeGpuBytes).toBeGreaterThan(0);

    surface.setReleasableSurfaceClasses(["land", "shelf"]);
    expect([...disposed].sort()).toEqual(["batch-land", "batch-shelf"]);
    expect(surface.releasedStaticGpuBytes()).toBe(nativeGpuBytes);
    // Only the GPU side goes: picking, coverage and the guide-label ink read the
    // CPU source, and it is still there.
    const land = batches.find((batch) => batch.batchId === "batch-land")!;
    expect(land.source.referenceDirections).toHaveLength(9);
    expect(land.geometry.getAttribute("position")).toBeTruthy();
    const position = () => land.geometry.getAttribute("position") as BufferAttribute;
    const uploadedVersion = position().version;

    // Idempotent while the composition lasts: no second dispose, no double count.
    surface.setReleasableSurfaceClasses(["land", "shelf"]);
    expect(disposed).toHaveLength(2);
    expect(surface.releasedStaticGpuBytes()).toBe(nativeGpuBytes);

    // Leaving the composition marks every attribute for upload again.
    surface.setReleasableSurfaceClasses([]);
    expect(position().version).toBe(uploadedVersion + 1);
    expect(land.geometry.index!.version).toBeGreaterThan(0);
    expect(surface.releasedStaticGpuBytes()).toBe(0);
    surface.disposeForRendererTeardown();
  });

  it("reports GPU residency dropping by the native buffers the realistic composition releases", () => {
    const parent = new Group();
    const surface = new CaoFoundationSurfaceRenderer(parent,
      new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 4_000_000), palaeoLimits);
    surface.publish(palaeoRevision(), 8);
    const batches = surface.surfaceView()!.geometry.batches;
    const disposed: string[] = [];
    for (const batch of batches) {
      batch.geometry.addEventListener("dispose", () => disposed.push(batch.batchId));
    }
    const native = batches.filter((batch) => batch.surfaceClass === "land"
      || batch.surfaceClass === "shelf");
    const nativeGpuBytes = native.reduce((sum, batch) => sum + batch.trackedGpuBytes, 0);
    expect(nativeGpuBytes).toBeGreaterThan(0);

    // The budget key is the whole resource and cannot answer residency; the new
    // key is the sum over the buffers that are actually uploaded.
    const resident = () => surface.diagnostics().gpuResidentBytes;
    const budget = surface.diagnostics().retainedStaticBytes;
    expect(budget).toBe(surface.diagnostics().retainedStaticSourceBytes
      + surface.diagnostics().retainedStaticGpuBytes);
    expect(resident()).toBe(surface.diagnostics().retainedStaticGpuBytes);
    const uploaded = resident();

    const realistic = resolveSurfaceVisibility({ layerEnabled: true, band: "cao-2017",
      published: true, hysteresis: { visible: true, band: "cao-2017", pendingFrames: 0 } });
    expect(realistic.composition).toBe("realistic");
    surface.applySurfaceComposition(realistic.visibleClasses, realistic.nativeSurfaceMode);
    surface.setReleasableSurfaceClasses(
      resolveReleasableNativeSurfaceClasses(realistic.composition));

    // The GPU buffers of today's land and shelf are gone: disposed, off the
    // residency ledger, and named as released.
    expect([...disposed].sort()).toEqual(["batch-land", "batch-shelf"]);
    expect(resident()).toBe(uploaded - nativeGpuBytes);
    expect(surface.diagnostics().releasedSurfaceClasses).toEqual(["land", "shelf"]);
    // The budget is unmoved, which is exactly why it could not show D1.
    expect(surface.diagnostics().retainedStaticBytes).toBe(budget);
    // The CPU side is untouched, so the re-upload is a buffer upload and not a
    // rebuild: picking, coverage and the guide-label ink keep reading it.
    for (const batch of native) {
      expect(batch.source.referenceDirections).toHaveLength(9);
      expect(batch.geometry.getAttribute("position")).toBeTruthy();
      expect(batch.geometry.index).toBeTruthy();
    }

    // Leaving the composition puts every released byte back.
    surface.setReleasableSurfaceClasses(resolveReleasableNativeSurfaceClasses("native"));
    expect(resident()).toBe(uploaded);
    expect(surface.diagnostics().releasedSurfaceClasses).toEqual([]);
    surface.disposeForRendererTeardown();
  });
});

/** WCAG relative luminance, so a colour choice can be gated rather than argued. */
function relativeLuminance(color: readonly [number, number, number] | readonly number[]): number {
  const [r, g, b] = color.map((channel) => channel <= 0.04045
    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The tone `palaeo-mountain`'s albedo renders at in full light - 201,126,79 -
 * as measured by the browser tone census, which owns that contract and is the
 * only place it can be measured.
 */
const CAO_FOUNDATION_PALAEO_MOUNTAIN_FULL_LIGHT_TONE =
  [201 / 255, 126 / 255, 79 / 255] as const;

function contrastRatio(
  left: readonly number[],
  right: readonly number[],
): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const palaeoLimits = { ...limits, maxBatches: 16, maxVertices: 5_000, maxTriangles: 5_000 };

/**
 * One batch per drawing class, all overlapping at longitude 0 / latitude 0 and
 * nested so a radial ray crosses every one of them.
 */
function palaeoRevision(geometrySuffix = "@1", nativeSuffix = "@1"): PreparedCaoRevision {
  const base = fixture(6);
  const makeBatch = (
    batchId: string,
    halfDegrees: number,
    chartIndex: number,
    nativePrecedence: boolean,
    surfaceAppearance?: "land" | "shelf" | "palaeo-land" | "palaeo-shallow-marine" | "palaeo-mountain",
  ) => {
    const points = [[-halfDegrees, -halfDegrees], [halfDegrees, -halfDegrees],
      [0, halfDegrees]] as const;
    const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
    const indices = new Uint32Array([0, 1, 2]);
    const seamIds = new Uint32Array(3);
    const entries = new Uint16Array([chartIndex, chartIndex, chartIndex]);
    const bytes = directions.byteLength + indices.byteLength + seamIds.byteLength
      + 2 * entries.byteLength;
    // Native batches follow `nativeSuffix` and refuse replacement; the Cao 2017
    // classes follow `geometrySuffix` and allow it, so one revision can change
    // one half of the set without the other.
    const palaeo = batchId.startsWith("palaeo-");
    return { batchId, staticGeometryIdentity: `${batchId}${palaeo ? geometrySuffix : nativeSuffix}`,
      staticGeometryReplaceable: palaeo, vertexCount: 3,
      triangleCount: 1, staticGeometryBytes: bytes, nativePrecedence, surfaceAppearance,
      chartTriangleRanges: [{ chartIndex, firstTriangle: 0, triangleCount: 1 }],
      createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(directions),
        indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
        preparedEntryIndices: new Uint16Array(entries),
        materialChartIndices: new Uint16Array(entries) }),
      createDisplayControlsCopy: () => ({
        displayHeightStart: { kind: "uniform" as const, value: 0 },
        displayHeightEnd: { kind: "uniform" as const, value: 0 },
        baseColor: { kind: "uniform" as const,
          value: CAO_FOUNDATION_DEFAULT_BASE_COLORS[surfaceAppearance
            ?? (batchId === "batch-shelf" ? "shelf" : "land")] } }) };
  };
  const chart = (chartId: string) => ({ ...base.charts[0]!, chartId, chartRevision: "1",
    materialId: chartId, fragmentOrCohortId: chartId });
  return { ...base,
    batches: [
      makeBatch("batch-shelf", 0.5, 0, false),
      makeBatch("palaeo-shallow", 0.4, 1, false, "palaeo-shallow-marine"),
      makeBatch("correction-fine", 0.3, 2, true),
      makeBatch("palaeo-land", 0.2, 3, false, "palaeo-land"),
      makeBatch("palaeo-mountain", 0.15, 4, false, "palaeo-mountain"),
      makeBatch("batch-land", 0.25, 5, false),
    ],
    charts: [chart("native-shelf"), chart("palaeo-shallow"), chart("correction"),
      chart("palaeo-land"), chart("palaeo-mountain"), chart("native-land")],
  } satisfies PreparedCaoRevision;
}

/**
 * One triangle of one palaeo class, in the shape the interval store prepares.
 *
 * `onStaticCopy` fires once per geometry upload — the renderer copies the
 * prepared source exactly when it creates a geometry resource — so a test can
 * assert that a crossing back into a resident interval uploads nothing.
 */
function palaeoInterval(
  intervalId: string,
  intervalIndex: number,
  digest: string,
  onRelease: () => void = () => {},
  options: { requestedAgeMa?: number; onStaticCopy?: () => void } = {},
): PreparedCaoPalaeoInterval {
  const requestedAgeMa = options.requestedAgeMa ?? 390;
  const values = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
  const referenceDirections = new Float32Array([
    ...gplatesLonLat(-0.5, -0.5), ...gplatesLonLat(0.5, -0.5), ...gplatesLonLat(0, 0.5),
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  const seamIds = new Uint32Array([2_000_000_000, 2_000_000_001, 2_000_000_002]);
  const entries = new Uint16Array([0, 0, 0]);
  const staticGeometryBytes = referenceDirections.byteLength + indices.byteLength
    + seamIds.byteLength + 2 * entries.byteLength;
  let released = 0;
  return {
    identity: `cao@r1:palaeo:${intervalId}:1`,
    requestId: 1,
    packageId: "cao",
    packageRevision: "r1",
    frameIdentity: "cao-frame",
    requestedAgeMa,
    intervalId,
    intervalIndex,
    fromAgeMa: 402,
    toAgeMa: 380.01,
    maximumEdgeDegrees: 1,
    materialCorrectionIdentity: null,
    materialCorrections: { observedActiveCharts: 0, classifiedShallowMarineActiveCharts: 0,
      qualifiedActiveCharts: 0, uncertainActiveCharts: 0,
      formationUncertainActiveCharts: 0, restoredCollisionMarginActiveCharts: 0,
      modelInferredPoseActiveCharts: 0,
      overriddenNativeCharts: 0, activeSourceIds: [], correctionIds: [] },
    display: { youngerAgeMa: requestedAgeMa, olderAgeMa: requestedAgeMa, fraction: 0 },
    lineBatches: [],
    nativeBoundary: { kind: "unavailable", requestedAgeMa, reason: "source-absent" },
    topologyOwnership: { kind: "unavailable", requestedAgeMa, reason: "source-absent" },
    anchorIds: [],
    addressForChartDirection: () => {
      throw new Error("palaeo-coastline charts carry no material addresses");
    },
    resolveAddress: () => {
      throw new Error("palaeo-coastline charts carry no material addresses");
    },
    resolveAnchor: () => null,
    motionPalette: { stride: 11, entryCount: 1,
      createValuesCopy: () => new Float32Array(values) },
    batches: [{
      batchId: "palaeo-lm",
      staticGeometryIdentity: `cao@r1:palaeo-lm:${digest}`,
      staticGeometryReplaceable: true,
      vertexCount: 3,
      triangleCount: 1,
      staticGeometryBytes,
      nativePrecedence: false,
      surfaceAppearance: "palaeo-land",
      chartTriangleRanges: [{ chartIndex: 0, firstTriangle: 0, triangleCount: 1 }],
      createStaticGeometryCopy: () => ({
        ...((): Record<string, never> => { options.onStaticCopy?.(); return {}; })(),
        referenceDirections: new Float32Array(referenceDirections),
        indices: new Uint32Array(indices),
        seamIds: new Uint32Array(seamIds),
        preparedEntryIndices: new Uint16Array(entries),
        materialChartIndices: new Uint16Array(entries),
      }),
      createDisplayControlsCopy: () => ({
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: [0.42, 0.37, 0.3] },
      }),
    }],
    charts: [{
      chartId: `palaeo:lm:${intervalId}:0`,
      chartRevision: `palaeo-coastlines-lm-v1@${digest}`,
      materialId: "palaeo:lm:0",
      fragmentOrCohortId: "palaeo:lm:0:101",
      role: "model-geography",
      support: { kind: "supported", method: "compiled-rigid" },
      evidence: { status: "model-output", sourceIds: ["cao-2017-paleogeography"],
        limitations: ["maximum flooding over the map interval"] },
      surfaceEvidence: { kind: "classified", surfaceClass: "land",
        sourceIds: ["cao-2017-paleogeography"] },
      poseQuaternion: [1, 0, 0, 0],
      inversePoseQuaternion: [1, 0, 0, 0],
      surfaceClass: "lm",
      appearance: "palaeo-land",
      sourceStatus: "classified-map-polygon",
      flags: 0,
      editorial: null,
    }],
    activeChartCount: 1,
    activeSourceIds: ["cao-2017-paleogeography"],
    activeLimitations: ["maximum flooding over the map interval"],
    activeSourceBytes: 4_096,
    release: () => { released += 1; if (released === 1) onRelease(); },
  } as unknown as PreparedCaoPalaeoInterval;
}

function palaeoRetirementOwner(maxResources = 1): GpuRetirementOwner {
  return new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, maxResources, 8_000_000);
}

// Folded in from the deleted `palaeoPublication.test.ts`: a prepared map
// interval is a prepared revision now, so the renderer's own tests own what the
// renderer does with one.
describe("palaeo interval publication", () => {
  it("publishes an interval, forwards its lease and swaps geometry only when armed", () => {
    const releases: string[] = [];
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(), limits,
      { staticGeometryRetirement: palaeoRetirementOwner() });
    const first = palaeoInterval("402-380", 0, "a", () => releases.push("402-380"));
    const diagnostics = surface.publish(first, 8);
    // `publish` takes the lease over, exactly as it does for a native revision,
    // so the interval store is free to evict the decoded payload.
    expect(releases).toEqual(["402-380"]);
    expect(diagnostics.identity).toBe(first.identity);
    expect(diagnostics.triangles).toBe(1);
    expect(diagnostics.chartRanges).toBe(1);
    expect(diagnostics.activeSourceBytes).toBe(4_096);

    // A new map interval is a new static geometry. Unarmed it must fail loudly,
    // and the failing publication still releases the lease it was handed.
    const unarmed = palaeoInterval("380-359", 1, "b", () => releases.push("380-359-unarmed"));
    expect(() => surface.publish(unarmed, 8)).toThrow(/static geometry changed/);
    expect(releases).toContain("380-359-unarmed");
    expect(surface.diagnostics().identity).toBe(first.identity);

    surface.armStaticGeometryChange("palaeo-coastline map interval 402-380 to 380-359");
    const second = palaeoInterval("380-359", 1, "b", () => releases.push("380-359"));
    const swapped = surface.publish(second, 8);
    expect(swapped.identity).toBe(second.identity);
    expect(swapped.staticGeometryIdentity).toContain("palaeo-lm:b");
    expect(releases).toContain("380-359");

    // The arm is spent by that one replacement: the next one must arm again.
    const third = palaeoInterval("359-338", 2, "c");
    expect(() => surface.publish(third, 8)).toThrow(/static geometry changed/);
    surface.disposeForRendererTeardown();
  });

  it("re-poses a published interval and clears it without touching its geometry key", () => {
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(), limits,
      { staticGeometryRetirement: palaeoRetirementOwner() });
    const interval = palaeoInterval("402-380", 0, "a");
    surface.publish(interval, 8);
    const pick = chartPickStateFromMotionFrame(interval);
    expect(pick.chartPoses).toHaveLength(8);
    expect([...pick.chartActive]).toEqual([1]);
    const retargeted = surface.retargetMotion(interval.motionPalette.createValuesCopy(), 1, 0,
      pick.chartPoses, pick.chartActive, 385, interval.materialCorrections);
    expect(retargeted.requestedAgeMa).toBe(385);
    expect(retargeted.staticGeometryIdentity).toContain("palaeo-lm:a");

    // Clearing is what the mode's own toggle does: the publication goes, and a
    // republication of the same interval needs no arm because the key is the same.
    surface.clear();
    expect(surface.diagnostics().identity).toBeNull();
    const again = palaeoInterval("402-380", 0, "a");
    expect(surface.publish(again, 8).identity).toBe(again.identity);
    surface.disposeForRendererTeardown();
  });

  /**
   * The residency contract: a crossing into an interval the set has already
   * uploaded draws it again without touching the GPU buffers. The upload
   * counter is the assertion — force a re-upload and this test is the one that
   * fails, because nothing else about the drawn interval changes.
   */
  it("keeps every prepared interval resident and crosses back without uploading", () => {
    const group = new Group();
    const uploads = new Map<string, number>();
    const upload = (id: string) => () => uploads.set(id, (uploads.get(id) ?? 0) + 1);
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(8),
      { ...limits, maxResidentIntervals: 25 },
      { staticGeometryRetirement: palaeoRetirementOwner(8) });
    const first = surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 390, onStaticCopy: upload("a") }), 8, "interval");
    const second = surface.publish(palaeoInterval("380-359", 1, "b", undefined,
      { requestedAgeMa: 370, onStaticCopy: upload("b") }), 8, "interval");
    expect(surface.residentIntervalCount()).toBe(2);
    expect(uploads.get("a")).toBe(1);
    expect(uploads.get("b")).toBe(1);
    // Both members are parented; only the current one is drawn.
    expect(group.children).toHaveLength(2);
    expect(group.children.filter((child) => child.visible).map((child) => child.name))
      .toEqual([`cao-foundation:${second.identity}`]);
    // The ledger is the set's, not the drawn member's: a warm interval behind
    // the current one still holds its buffers.
    const oneInterval = surface.diagnostics("interval").gpuResidentBytes;
    expect(oneInterval).toBeGreaterThan(0);
    expect(surface.residentGpuBytes()).toBe(2 * oneInterval);

    const back = surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 385, onStaticCopy: upload("a") }), 8, "interval");
    expect(uploads.get("a")).toBe(1);
    expect(uploads.get("b")).toBe(1);
    expect(surface.residentIntervalCount()).toBe(2);
    expect(group.children).toHaveLength(2);
    // Every answer the drawn interval publishes is the one a fresh publication
    // gave, at the crossing's own age.
    expect(back.identity).toBe(first.identity);
    expect(back.staticGeometryIdentity).toBe(first.staticGeometryIdentity);
    expect(back.triangles).toBe(first.triangles);
    expect(back.chartRanges).toBe(first.chartRanges);
    expect(back.batches).toBe(first.batches);
    expect(back.activeSourceBytes).toBe(first.activeSourceBytes);
    expect(back.requestedAgeMa).toBe(385);
    expect(back.drawCount).toBe(first.drawCount);
    expect(surface.publishedIdentity("interval")).toBe(first.identity);
    // Only the drawn interval answers picks and coverage; a resident member
    // behind it is not in the set on screen.
    expect(surface.surfaceSetView()).toHaveLength(1);
    expect(group.children.filter((child) => child.visible).map((child) => child.name))
      .toEqual([`cao-foundation:${first.identity}`]);
    surface.disposeForRendererTeardown();
  });

  it("evicts the interval farthest by age when the residency ceiling is met", () => {
    const group = new Group();
    const uploads = new Map<string, number>();
    const upload = (id: string) => () => uploads.set(id, (uploads.get(id) ?? 0) + 1);
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(8),
      { ...limits, maxResidentIntervals: 2 },
      { staticGeometryRetirement: palaeoRetirementOwner(8) });
    surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 390, onStaticCopy: upload("a") }), 8, "interval");
    surface.publish(palaeoInterval("300-280", 1, "b", undefined,
      { requestedAgeMa: 300, onStaticCopy: upload("b") }), 8, "interval");
    // 385 Ma is 5 Ma from the first interval's anchor and 85 from the second's,
    // so the second is the one that goes.
    surface.publish(palaeoInterval("390-385", 2, "c", undefined,
      { requestedAgeMa: 385, onStaticCopy: upload("c") }), 8, "interval");
    expect(surface.residentIntervalCount()).toBe(2);
    expect(group.children).toHaveLength(2);

    surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 388, onStaticCopy: upload("a") }), 8, "interval");
    expect(uploads.get("a")).toBe(1);
    surface.publish(palaeoInterval("300-280", 1, "b", undefined,
      { requestedAgeMa: 300, onStaticCopy: upload("b") }), 8, "interval");
    expect(uploads.get("b")).toBe(2);
    expect(surface.residentIntervalCount()).toBe(2);
    surface.disposeForRendererTeardown();
  });

  it("keeps one interval at the low profile, uploading on every swap", () => {
    const group = new Group();
    const uploads = new Map<string, number>();
    const upload = (id: string) => () => uploads.set(id, (uploads.get(id) ?? 0) + 1);
    // No ceiling in the limits is the low profile's one interval: the streaming
    // behaviour the renderer has always had.
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(8), limits,
      { staticGeometryRetirement: palaeoRetirementOwner(8) });
    surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 390, onStaticCopy: upload("a") }), 8, "interval");
    const swapped = surface.publish(palaeoInterval("380-359", 1, "b", undefined,
      { requestedAgeMa: 370, onStaticCopy: upload("b") }), 8, "interval");
    expect(surface.residentIntervalCount()).toBe(1);
    expect(group.children.map((child) => child.name))
      .toEqual([`cao-foundation:${swapped.identity}`]);
    expect(surface.residentGpuBytes()).toBe(surface.diagnostics("interval").gpuResidentBytes);
    surface.publish(palaeoInterval("402-380", 0, "a", undefined,
      { requestedAgeMa: 390, onStaticCopy: upload("a") }), 8, "interval");
    expect(uploads.get("a")).toBe(2);
    expect(surface.residentIntervalCount()).toBe(1);
    surface.disposeForRendererTeardown();
  });

  it("lowers residency to a new ceiling on the next crossing", () => {
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, palaeoRetirementOwner(8),
      { ...limits, maxResidentIntervals: 25 },
      { staticGeometryRetirement: palaeoRetirementOwner(8) });
    surface.publish(palaeoInterval("402-380", 0, "a", undefined, { requestedAgeMa: 390 }),
      8, "interval");
    surface.publish(palaeoInterval("380-359", 1, "b", undefined, { requestedAgeMa: 370 }),
      8, "interval");
    expect(surface.residentIntervalCount()).toBe(2);
    surface.setResidentIntervalCeiling(1);
    expect(surface.residentIntervalCount()).toBe(2);
    const current = surface.publish(
      palaeoInterval("359-338", 2, "c", undefined, { requestedAgeMa: 350 }), 8, "interval");
    expect(surface.residentIntervalCount()).toBe(1);
    expect(group.children.map((child) => child.name))
      .toEqual([`cao-foundation:${current.identity}`]);
    expect(() => surface.setResidentIntervalCeiling(0)).toThrow(/at least one/);
    surface.disposeForRendererTeardown();
  });
});

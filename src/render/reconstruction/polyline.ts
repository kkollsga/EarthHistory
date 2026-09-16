import * as THREE from "three";
import { DoubleSide, MeshBasicNodeMaterial } from "three/webgpu";
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
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  screenDPR,
  screenSize,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { EARTH_RADIUS_METRES } from "../../reconstruction";
import type { ScalarOps } from "../../reconstruction/arithmetic";
import {
  PALAEO_OUTLINE_TONE_TEXTURE_WIDTH,
  palaeoOutlineToneTextureRows,
} from "../../reconstruction/outlineTones";
import { tslScalarOps } from "./terrainNodes";

/**
 * One owner for every polyline the globe draws over its surfaces.
 *
 * A polyline batch is a list of great-circle segments between reconstructed
 * unit directions, drawn as one screen-space quad per segment on a shell above
 * the surface stack, shaded from its own analytic coverage rather than from a
 * GPU line primitive (neither backend can widen one). This module owns that
 * whole path: the quad expansion and its byte ledger, the two-tone ink and the
 * tone-table upload, the horizon terms, and the material graph the renderer
 * publishes.
 *
 * Today its one caller is the modern-country reference overlay
 * (`country-reference.ehgl`, shell 1 800 m, two-tone). The plate-boundary lines
 * (`boundary-*.ehnb`, shell 2 200 m, single ink, rebuilt per age) are NOT
 * migrated yet and still build their own geometry and material in
 * `caoFoundation.ts`; this helper is meant to take them next, which is why the
 * shell, ink and width are parameters rather than the country constants.
 *
 * The overlay is a legibility device for a reference layer, never evidence of a
 * mapped boundary: see the map key's outline-marker legend.
 */

/** Shell the modern-country reference overlay is drawn on, in metres. */
export const POLYLINE_COUNTRY_SHELL_METRES = 1_800;

/**
 * Widest chord in the shipped country-line geometry, measured over all 12 045
 * segments of `cao-v2.4/country-reference.ehgl`: 111.178 km, 1.00 degrees.
 * Chart poses are rigid rotations, so this is age-invariant.
 */
export const POLYLINE_MAX_CHORD_DEGREES = 1;

/**
 * How far past the horizon a country-line vertex must be before the vertex
 * stage collapses it. It must exceed the widest chord so that a segment with
 * one visible endpoint is never collapsed at its other end.
 */
export const POLYLINE_CULL_MARGIN_DEGREES = 2;

export interface PolylineMaterialGraph {
  readonly material: MeshBasicNodeMaterial;
  readonly displayFraction: UniformNode<"float", number>;
  /** Device-pixel corner offset the vertex node must add; exposed so tests pin the wiring. */
  readonly quadOffsetPixels: readonly [Node<"float">, Node<"float">];
  /** The two offset components as one vector, before the collapse factor. */
  readonly quadOffsetVector: Node<"vec2">;
  /** That offset after the collapse factor, which is what the vertex node adds. */
  readonly collapsedOffsetPixels: Node<"vec2">;
  /** Exactly the terms handed to the coverage formula, so a test can pin each one. */
  readonly coverageInputs: Readonly<{
    distancePixels: Node<"float">; halfWidthPixels: Node<"float">; featherPixels: Node<"float">;
  }>;
  /** Half the visual core width in device pixels, from the renderer's pixel ratio. */
  readonly halfWidthPixels: Node<"float">;
  /** The varying carrying the signed perpendicular distance from the centre line. */
  readonly perpendicularPixels: Node<"float">;
  /** Fragment-stage analytic coverage; the reason the stroke needs no extra copies. */
  readonly coverage: Node<"float">;
  /** Vertex-stage far-side and inactive-chart collapse factor; exposed so tests pin the wiring. */
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
  /** The R8 tone table this material samples; zero-filled means every segment dark. */
  readonly toneTexture: THREE.DataTexture;
  /**
   * The vertex-stage tone lookup, by segment index. It must stay in the vertex
   * stage: a texture load in the fragment stage would run once per outline
   * fragment for a value that is constant across the whole quad.
   */
  readonly segmentToneSample: Node<"float">;
  /** The flat varying that carries the sample to the fragment stage. */
  readonly toneMix: Node<"float">;
  readonly darkInk: Node<"vec3">;
  readonly lightInk: Node<"vec3">;
  /**
   * Replaces the tone table, uploading only when the bytes actually change.
   * `null` restores the all-dark table, which is bit-identical to the outline
   * before the palaeo mode existed: `mix(dark, light, 0)` is `dark` exactly.
   */
  setToneTable(texels: Uint8Array | null): PolylineToneCounts;
  /** Tones the currently loaded table resolves to. */
  readonly toneCounts: () => PolylineToneCounts;
}

/**
 * Default visual core width of a polyline, in CSS pixels. `createPolylineMaterial`
 * takes the width as an input; this is the country overlay's value.
 *
 * Neither backend can widen a GPU line primitive: `linewidth` is ignored by
 * WebGL2 core profiles and WebGPU has no line width at all, so a line is
 * exactly one device pixel. On a diagonal that hairline hands most of its
 * multisample coverage to one of two neighbouring pixel rows, its darkness
 * swings between a fully covered pixel and a barely visible one along a single
 * segment, and the outline reads as beaded. Each segment is therefore expanded
 * into a screen-space quad and shaded from its own analytic coverage, which
 * fixes the continuity without making the stroke thicker: the core stays one
 * CSS pixel — two device pixels at ratio 2, one at ratio 1 — and the
 * antialiasing ramp lives outside it.
 *
 * There is no second contrast shell. The overlay used to draw a darker,
 * slightly wider underlay because neither pass could ever be solid, so the two
 * together only deepened the hairline union. A quad shaded from its own
 * coverage reaches full opacity at its core, and a wider darker pass under it
 * then shows its own margins as two rails around a lighter centre — measured at
 * 2.0 CSS px against 1.0 for the stroke alone, which is the thickening this
 * change exists to remove.
 */
export const POLYLINE_WIDTH_CSS_PX = 1;

/**
 * Width of the analytic coverage ramp, in device pixels, centred on the core
 * edge. One device pixel is the narrowest ramp that still resolves a diagonal
 * edge; a wider one would blur the stroke, a narrower one would alias it.
 */
export const POLYLINE_FEATHER_DEVICE_PX = 1;

/** Total country-line draws per frame this renderer is allowed to publish. */
export const POLYLINE_DRAW_BUDGET = 1;

/**
 * The two inks a country outline is drawn in.
 *
 * The dark slate is the only ink the overlay has ever used and stays the whole
 * outline whenever no tone table is loaded. The light grey is the guide labels'
 * own water ink (`GUIDE_LABEL_LIGHT_INK_STYLE`, pinned equal by the unit test),
 * so an outline crossing a palaeo sea reads like a label over the same water.
 *
 * The hex is an sRGB style; it is decoded into the renderer's working colour
 * space here because that is what the guide-label texture upload does to the
 * same value, and a raw component triple would render a visibly brighter grey.
 * Two tones are a legibility device for a reference overlay, never evidence of
 * a coastline: see the map key's outline-marker legend.
 */
export const POLYLINE_DARK_INK: readonly [number, number, number] =
  Object.freeze([0.12, 0.15, 0.18]);
export const POLYLINE_LIGHT_INK_STYLE = "#d0d4d5";
export const POLYLINE_LIGHT_INK: readonly [number, number, number] =
  Object.freeze((() => {
    const color = new THREE.Color().setStyle(
      POLYLINE_LIGHT_INK_STYLE, THREE.SRGBColorSpace);
    return [color.r, color.g, color.b] as [number, number, number];
  })());

/** Per-segment tone counts a loaded outline tone table resolves to. */
export interface PolylineToneCounts {
  readonly darkSegments: number;
  readonly lightSegments: number;
}

/**
 * The R8 texture one outline tone table is sampled through, zero-filled: every
 * segment dark, which is exactly today's single-ink outline.
 */
export function createPolylineToneTexture(
  segmentCount: number,
): THREE.DataTexture {
  const rows = palaeoOutlineToneTextureRows(segmentCount);
  const texture = new THREE.DataTexture(
    new Uint8Array(rows * PALAEO_OUTLINE_TONE_TEXTURE_WIDTH),
    PALAEO_OUTLINE_TONE_TEXTURE_WIDTH, rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Quad template shared by every country-line segment: four corners in
 * quad-local coordinates (`along`, `side`, 0) and the two triangles over them.
 * `along` selects which endpoint of the segment the corner sits at, `side`
 * which edge of the stroke.
 */
export const POLYLINE_QUAD_CORNERS: readonly number[] = Object.freeze([
  -1, -1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0,
]);
export const POLYLINE_QUAD_INDICES: readonly number[] =
  Object.freeze([0, 1, 2, 2, 1, 3]);
/** Corners a segment's quad is drawn from, and indices over them. */
export const POLYLINE_QUAD_VERTICES_PER_SEGMENT = 4;
export const POLYLINE_QUAD_INDICES_PER_SEGMENT = 6;

/**
 * Vertex- and index-buffer bytes each segment costs in the expanded form: four
 * corners carrying the quad-local corner, both endpoint directions, the shared
 * palette entry and the segment's own index, plus six indices.
 */
export const POLYLINE_QUAD_SEGMENT_BYTES =
  POLYLINE_QUAD_VERTICES_PER_SEGMENT * (3 * 4 + 3 * 4 + 3 * 4 + 4 + 4)
  + POLYLINE_QUAD_INDICES_PER_SEGMENT * 4;

/**
 * GPU bytes the expanded quad form of a line batch occupies.
 *
 * The package stores two unshared vertices and an index pair per segment — 40
 * bytes for the shipped package. The quad form materialises four corners, each
 * carrying its quad-local coordinate, both endpoint directions and the segment
 * index its outline tone is looked up by, so it costs 200 bytes per segment
 * instead.
 * Those extra bytes buy a plain indexed draw: the instanced form is four bytes
 * *cheaper* per corner but pays a per-instance cost that a software rasterizer
 * charges in full, which made the overlay three times more expensive there than
 * the hairline it replaced. The cost is counted explicitly here rather than
 * assumed to fit under the source-copy bytes, which it no longer does.
 */
export function polylineQuadBytes(segmentCount: number): number {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid polyline segment count");
  }
  return segmentCount * POLYLINE_QUAD_SEGMENT_BYTES;
}

/** Renderer-unit radius of the opaque globe shell (`GlobeScene` globe mesh). */
export const POLYLINE_GLOBE_OCCLUDER_RADIUS = 1;

/**
 * Below this squared screen length a segment has no usable direction, so the
 * quad falls back to an axis-aligned square of its own width rather than
 * dividing by zero. Squared device pixels.
 */
const POLYLINE_DEGENERATE_PIXELS_SQ = 1e-12;

/**
 * Half the visual core width in device pixels, and the geometric half-extent
 * the quad must actually reach to carry the coverage ramp.
 *
 * `pixelRatio` is the renderer's own pixel ratio (`screenDPR` in the material),
 * which is what turns a CSS-pixel width into device pixels; the drawing-buffer
 * size converts those device pixels back into clip space.
 */
export function polylineHalfWidthPx(pixelRatio: number): number {
  return POLYLINE_WIDTH_CSS_PX * pixelRatio / 2;
}

export function polylinePadPx(pixelRatio: number): number {
  return polylineHalfWidthPx(pixelRatio)
    + POLYLINE_FEATHER_DEVICE_PX / 2;
}

/**
 * One quad-expansion formula consumed by the TSL material and its unit test.
 *
 * `along` is -1 at the segment's start corner and +1 at its end corner, `side`
 * is -1/+1 across it. The corner is pushed `padPixels` perpendicular to the
 * screen-space segment direction, and a further `padPixels` *along* that
 * direction past the endpoint. That end extension is what keeps a join between
 * two segments from leaving a notch: each quad overruns its endpoint by its own
 * half-extent, so consecutive quads overlap across the corner instead of
 * meeting at a point.
 *
 * Endpoints that project to the same pixel — a segment shorter than a pixel, or
 * a segment whose chart is inactive so both ends collapsed to the globe centre
 * — have no direction at all. The guard substitutes the +x axis so the result
 * is a finite square rather than a NaN; the caller zeroes the whole offset for
 * the collapsed case, which turns that square back into a point.
 */
export function evaluatePolylineQuadOffsetPx<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ startPixelX: T; startPixelY: T; endPixelX: T; endPixelY: T;
    along: T; side: T; padPixels: T }>,
): readonly [T, T] {
  const deltaX = ops.sub(input.endPixelX, input.startPixelX);
  const deltaY = ops.sub(input.endPixelY, input.startPixelY);
  const lengthSq = ops.add(ops.mul(deltaX, deltaX), ops.mul(deltaY, deltaY));
  const degenerate = ops.lessThan(lengthSq, ops.constant(POLYLINE_DEGENERATE_PIXELS_SQ));
  const safeX = ops.select(degenerate, ops.constant(1), deltaX);
  const safeY = ops.select(degenerate, ops.constant(0), deltaY);
  const safeLengthSq = ops.select(degenerate, ops.constant(1), lengthSq);
  const inverseLength = ops.div(ops.constant(1), ops.sqrt(safeLengthSq));
  const unitX = ops.mul(safeX, inverseLength);
  const unitY = ops.mul(safeY, inverseLength);
  return [
    ops.mul(ops.sub(ops.mul(unitX, input.along), ops.mul(unitY, input.side)), input.padPixels),
    ops.mul(ops.add(ops.mul(unitY, input.along), ops.mul(unitX, input.side)), input.padPixels),
  ];
}

/**
 * One coverage formula consumed by the TSL material and its unit test.
 *
 * `distancePixels` is the signed perpendicular distance from the segment's
 * centre line in device pixels. Coverage is a smoothstep across a ramp of
 * `featherPixels` centred on the core edge, so it is 1 on the centre line,
 * exactly 0.5 at the half width — the edge the reader perceives as the stroke's
 * boundary — and 0 half a ramp beyond it. That is the analytic replacement for
 * multisample coverage, which a one-pixel primitive could not supply evenly.
 */
export function evaluatePolylineCoverage<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ distancePixels: T; halfWidthPixels: T; featherPixels: T }>,
): T {
  const distance = ops.sqrt(ops.mul(input.distancePixels, input.distancePixels));
  const outer = ops.add(input.halfWidthPixels, ops.div(input.featherPixels, ops.constant(2)));
  const ramp = ops.clamp(ops.div(ops.sub(outer, distance), input.featherPixels), 0, 1);
  return ops.mul(ops.mul(ramp, ramp), ops.sub(ops.constant(3), ops.mul(ops.constant(2), ramp)));
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
export function evaluatePolylineHorizonLimitCos<T, C>(
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
 * The screen-space quad cannot use the depth buffer: its corners carry the
 * depth of the endpoint they were expanded from but are rasterized up to a
 * pixel and a half away, and at grazing incidence the land shell's depth
 * changes far faster per pixel than the 1 000 m gap between the line and land
 * shells, so a corner pushed inward loses the depth test over almost the whole
 * globe view while one pushed outward wins it past the silhouette and draws
 * over the sky. (Measured on the earlier multi-copy build at a deliberate 8 px
 * shift: 18 883 line pixels survived on the outward side against 856 inward.)
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
export function evaluatePolylineHorizonVisibility<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ cosSeparation: T; pointRadius: T; cameraRadius: T;
    occluderRadius: T; marginCos: T; marginSin: T }>,
): T {
  const limit = evaluatePolylineHorizonLimitCos(ops, input);
  return ops.select(ops.lessThan(limit, input.cosSeparation), ops.constant(1), ops.constant(0));
}

/**
 * Whether a segment's quad is drawn at all, from its two endpoints' horizon
 * visibility and their activation masks.
 *
 * *Either* endpoint being within the widened terminator keeps the quad, so a
 * segment straddling the terminator survives whole and the fragment term cuts
 * it at the true horizon; requiring both would erase the outline a full cull
 * margin inside the limb. Both endpoints must be active, because a segment with
 * one end collapsed to the globe centre is not a line on the surface at all.
 */
export function evaluatePolylineSegmentVisibility<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ startVisible: T; endVisible: T; startActive: T; endActive: T }>,
): T {
  const eitherVisible = ops.select(ops.lessThan(input.startVisible, input.endVisible),
    input.endVisible, input.startVisible);
  return ops.mul(ops.mul(eitherVisible, input.startActive), input.endActive);
}

export interface PolylineMaterialOptions {
  /**
   * Segments in the *source* batch, which is what the outline tone table is
   * published and indexed over. The drawn quads can be fewer — shared borders
   * are deduped at load — and each one carries its source segment's index, so
   * the table keeps its shipped shape and the lookup stays a direct texel read.
   */
  readonly segmentCount: number;
  readonly pose: PolylinePoseFactory;
  readonly ink: PolylineInk;
  /** Shell the polyline is drawn on, above every surface class it crosses. */
  readonly shellMetres: number;
  /** Visual core width in CSS pixels; the coverage ramp lives outside it. */
  readonly widthPx: number;
  readonly displayFractionValue: number;
}

/**
 * The material graph for one polyline batch: the quad expansion, the two-tone
 * ink and its tone table, and the horizon terms.
 */
export function createPolylineMaterial(
  options: PolylineMaterialOptions,
): PolylineMaterialGraph {
  const { segmentCount, ink, widthPx } = options;
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid polyline segment count");
  }
  if (!Number.isFinite(options.shellMetres) || options.shellMetres < 0
      || !Number.isFinite(widthPx) || widthPx <= 0) {
    throw new Error("invalid polyline shell or width");
  }
  // A dark slate: the earlier mid-tone slate read as nearly invisible on phones
  // and pale land. Width comes from the screen-space quad, not from any shell
  // gap, and the single shell is the only thing the display-height guard has to
  // keep the surface below.
  const shellOffset = options.shellMetres;
  const displayFraction = uniform(options.displayFractionValue, "float");
  const verticalExaggeration = uniform(1, "float");
  // `position` is the corner in quad-local coordinates: x = -1 at the segment's
  // start, +1 at its end; y = -1/+1 across the stroke. Every corner carries both
  // reconstructed endpoints, because it cannot be placed without knowing both.
  const corner = attribute<"vec3">("position", "vec3");
  const along = corner.x;
  const side = corner.y;
  const entry = int(attribute<"uint">("countryLineEntryIndex", "uint"));
  const pose = (reference: Node<"vec3">) => options.pose({
    reference, entry, displayFraction, verticalExaggeration, shellOffsetMetres: shellOffset });
  // Both endpoints of a segment are validated to share one palette entry, so
  // one instanced entry index drives both poses and both share one activation.
  const startPose = pose(attribute<"vec3">("countryLineStart", "vec3"));
  const endPose = pose(attribute<"vec3">("countryLineEnd", "vec3"));
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    opacity: 0.92,
    // Occlusion comes from the horizon term below, not from the depth buffer.
    depthTest: false,
    depthWrite: false,
    // A screen-space quad's winding flips with the segment's screen bearing.
    side: DoubleSide,
  });
  // Two-tone ink. The segment's own index reads one texel of the resident tone
  // table in the *vertex* stage and passes it through a flat varying: the four
  // corners of a quad carry the same segment index, so the tone is constant
  // across the quad and interpolating it would only blur a value that has no
  // gradient. Sampling in the fragment stage instead would run a texture load
  // per outline fragment for that same constant.
  const segmentIndex = int(attribute<"uint">("countryLineSegmentIndex", "uint"));
  const toneTexture = createPolylineToneTexture(segmentCount);
  const toneWidth = PALAEO_OUTLINE_TONE_TEXTURE_WIDTH;
  const segmentToneSample = textureLoad(toneTexture,
    ivec2(segmentIndex.mod(toneWidth), segmentIndex.div(toneWidth))).x;
  const toneMix = varying(segmentToneSample).setInterpolation("flat");
  const darkInk = vec3(...ink.dark);
  const lightInk = vec3(...ink.light);
  // Dark slate stays visible across pale land and dark shelf water alike; the
  // light grey is what keeps an outline legible over a mapped palaeo sea.
  material.colorNode = mix(darkInk, lightInk, toneMix);
  const pointRadius = float(1 + shellOffset / EARTH_RADIUS_METRES);
  const cameraDirection = cameraPosition.normalize();
  const cameraRadius = cameraPosition.length();
  const occluderRadius = float(POLYLINE_GLOBE_OCCLUDER_RADIUS);
  // The reconstructed radial direction stays unit length even where activation
  // collapses the position to the origin, so the horizon term is well defined
  // for every endpoint. The globe centre is the world origin.
  const worldDirection = (direction: Node<"vec3">) =>
    modelWorldMatrix.mul(vec4(direction, 0)).xyz.normalize();
  const worldStart = worldDirection(startPose.direction);
  const worldEnd = worldDirection(endPose.direction);
  // Vertex stage: collapse the whole quad once *both* endpoints are past the
  // terminator by more than the widest chord in the package. A segment with one
  // visible end therefore survives intact, and a segment kept with both ends
  // just past the terminator is still invisible — every direction interpolated
  // along it stays past the terminator, so the fragment term zeroes all of it.
  // Far-side segments rasterize nothing instead of being shaded and blended
  // away, which the depth test used to do with early-Z.
  const margin = POLYLINE_CULL_MARGIN_DEGREES * Math.PI / 180;
  const vertexCullCos = float(Math.cos(margin));
  const vertexCullSin = float(Math.sin(margin));
  const endpointVisible = (direction: Node<"vec3">) =>
    evaluatePolylineHorizonVisibility(tslScalarOps, {
      cosSeparation: direction.dot(cameraDirection),
      pointRadius, cameraRadius, occluderRadius,
      marginCos: vertexCullCos, marginSin: vertexCullSin,
    });
  // Either endpoint being active keeps the quad; a segment whose chart does not
  // exist at this age has already collapsed both endpoints to the globe centre,
  // and this zeroes its screen expansion too so it stays a zero-area point
  // instead of a fixed-size square there.
  const vertexVisible = evaluatePolylineSegmentVisibility(tslScalarOps, {
    startVisible: endpointVisible(worldStart), endVisible: endpointVisible(worldEnd),
    startActive: startPose.activeMask, endActive: endPose.activeMask,
  });
  const startPosition = startPose.position.mul(vertexVisible);
  const endPosition = endPose.position.mul(vertexVisible);
  const alongFraction = along.mul(0.5).add(0.5);
  const basePosition = startPosition.add(endPosition.sub(startPosition).mul(alongFraction));
  material.positionNode = basePosition;
  const clipOf = (position: Node<"vec3">) =>
    cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1)));
  const startClip = clipOf(startPosition);
  const endClip = clipOf(endPosition);
  // The camera orbits outside the occluder sphere at a radius of at least 1.15,
  // so every point on either outline shell is in front of the eye and the clip
  // w is strictly positive; the floor only keeps the divide finite.
  const halfBuffer = screenSize.mul(0.5);
  const toPixels = (clip: Node<"vec4">) => clip.xy.div(clip.w.max(float(1e-6))).mul(halfBuffer);
  const startPixels = toPixels(startClip);
  const endPixels = toPixels(endClip);
  const halfWidthPixels = screenDPR.mul(widthPx / 2);
  const featherPixels = float(POLYLINE_FEATHER_DEVICE_PX);
  const padPixels = halfWidthPixels.add(featherPixels.mul(0.5));
  const quadOffsetPixels = evaluatePolylineQuadOffsetPx(tslScalarOps, {
    startPixelX: startPixels.x, startPixelY: startPixels.y,
    endPixelX: endPixels.x, endPixelY: endPixels.y,
    along, side, padPixels,
  });
  const basePixels = startPixels.add(endPixels.sub(startPixels).mul(alongFraction));
  // The collapse has to reach the screen expansion as well as the positions:
  // with only the positions zeroed, a collapsed segment would still be pushed
  // out into a pad-sized square at the globe centre and rasterize there.
  const quadOffsetVector = vec2(quadOffsetPixels[0], quadOffsetPixels[1]);
  const collapsedOffsetPixels = quadOffsetVector.mul(vertexVisible);
  const cornerPixels = basePixels.add(collapsedOffsetPixels);
  const baseClip = startClip.add(endClip.sub(startClip).mul(alongFraction));
  material.vertexNode = vec4(cornerPixels.div(halfBuffer).mul(baseClip.w), baseClip.z, baseClip.w);
  // Fragment stage: the interpolated world direction, renormalised. Passing the
  // direction through a varying is what keeps the prepared pose graph — three
  // palette texture loads plus a quaternion slerp and rotate, twice over for the
  // two endpoints — in the vertex stage; three caches node results per shader
  // stage and only attributes insert a varying on their own, so reading
  // `worldStart` directly here would emit and run that whole graph again for
  // every outline fragment. Varying the 0/1 visibility instead would interpolate
  // it and blur the terminator.
  const fragmentCos = float(1);
  const fragmentSin = float(0);
  const fragmentDirection = varying(worldStart.add(worldEnd.sub(worldStart).mul(alongFraction)));
  const horizonVisibility = evaluatePolylineHorizonVisibility(tslScalarOps, {
    cosSeparation: fragmentDirection.normalize().dot(cameraDirection),
    pointRadius, cameraRadius, occluderRadius,
    marginCos: fragmentCos, marginSin: fragmentSin,
  });
  // The corner's own perpendicular offset, interpolated, *is* the fragment's
  // signed distance from the centre line: the four corners form a rectangle in
  // screen space, so the linear term across it is exact up to the perspective
  // correction, which a segment's endpoint depth spread bounds well below the
  // ramp (about 0.007 device px at globe zoom, 0.17 px at the closest camera).
  const perpendicularPixels = varying(side.mul(padPixels));
  // Held as a record so a test can pin the identity of each term. Every one of
  // them is also transitively reachable from the others — the varying is scaled
  // by a pad built from the same half width — so a graph walk alone cannot tell
  // a swapped argument from the real one.
  const coverageInputs = Object.freeze({
    distancePixels: perpendicularPixels, halfWidthPixels, featherPixels,
  });
  const coverage = evaluatePolylineCoverage(tslScalarOps, coverageInputs);
  material.opacityNode = materialOpacity.mul(coverage).mul(horizonVisibility);
  const toneData = (toneTexture.image as { data: Uint8Array }).data;
  let toneCounts: PolylineToneCounts =
    Object.freeze({ darkSegments: segmentCount, lightSegments: 0 });
  const setToneTable = (
    texels: Uint8Array | null,
  ): PolylineToneCounts => {
    if (texels !== null && texels.length !== toneData.length) {
      throw new Error("polyline tone table shape mismatch");
    }
    // The upload is the expensive half, so compare first: an interval change
    // that leaves a table identical, and every repeated apply of the resident
    // one, must not re-upload the texture.
    let changed = false;
    for (let index = 0; index < toneData.length; index += 1) {
      const next = texels === null ? 0 : texels[index]!;
      if (toneData[index] !== next) {
        toneData[index] = next;
        changed = true;
      }
    }
    if (changed) toneTexture.needsUpdate = true;
    let lightSegments = 0;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      if (toneData[segment] !== 0) lightSegments += 1;
    }
    toneCounts = Object.freeze({ darkSegments: segmentCount - lightSegments, lightSegments });
    return toneCounts;
  };
  return Object.freeze({ material, displayFraction, vertexVisible, horizonVisibility,
    fragmentDirection, coverage, coverageInputs, halfWidthPixels, perpendicularPixels,
    quadOffsetVector, collapsedOffsetPixels,
    toneTexture, segmentToneSample, toneMix, darkInk, lightInk,
    setToneTable, toneCounts: () => toneCounts,
    quadOffsetPixels: Object.freeze([quadOffsetPixels[0], quadOffsetPixels[1]] as const),
    horizonMargins: Object.freeze({ vertexCullCos, vertexCullSin, fragmentCos, fragmentSin }) });
}

/** The expanded quad form of one line batch, and what it dropped to get there. */
export interface PolylineQuadGeometry {
  readonly geometry: THREE.BufferGeometry;
  /** GPU bytes the drawn quads occupy: 200 per drawn segment. */
  readonly gpuBytes: number;
  /** Quads drawn: source segments less the shared-border duplicates. */
  readonly segmentCount: number;
  /** Source segments dropped because an identical one is already drawn. */
  readonly duplicateCount: number;
  /**
   * Drawn quad to the source segment it was kept for — the row its outline tone
   * is published at. Length is `segmentCount`, and the values strictly increase,
   * because the first copy of each shared border is the one kept.
   */
  readonly sourceSegmentIndices: Uint32Array;
}

/**
 * Source segments that are not a repeat of an earlier one: the load-time
 * shared-border dedupe.
 *
 * Two segments are the same drawn line when they span the same two decoded
 * endpoint directions — in either order, since the two countries sharing a
 * border walk it in opposite senses — *and* carry the same motion-palette
 * entry, which is what makes them pose identically at every age. Endpoints are
 * compared on their float32 bit patterns rather than within a tolerance: the
 * package quantizes directions to int16 before the decoder widens them, so two
 * copies of one border decode to identical floats, and anything that does not
 * is a different segment rather than a rounding difference. The palette entry
 * is in the key so that coincident geometry on two plates, which the
 * reconstruction moves apart, keeps both lines.
 */
function uniquePolylineSegments(
  source: PolylineSegmentSource,
  segmentCount: number,
): Uint32Array {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid polyline segment count");
  }
  const directions = source.referenceDirections;
  // A uint32 view over the same bytes: the exact decoded value, with no number
  // formatting per coordinate. Float32Array is 4-byte aligned by construction.
  const bits = new Uint32Array(directions.buffer, directions.byteOffset, directions.length);
  const endpointKey = (vertex: number) =>
    `${bits[vertex * 3]},${bits[vertex * 3 + 1]},${bits[vertex * 3 + 2]}`;
  const seen = new Set<string>();
  const kept: number[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const left = source.lineIndices[segment * 2]!;
    const right = source.lineIndices[segment * 2 + 1]!;
    const leftKey = endpointKey(left);
    const rightKey = endpointKey(right);
    const span = leftKey <= rightKey ? `${leftKey}:${rightKey}` : `${rightKey}:${leftKey}`;
    const key = `${span}@${source.preparedEntryIndices[left]!}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(segment);
  }
  return Uint32Array.from(kept);
}

/**
 * Expand a decoded line batch into one screen-space quad per segment.
 *
 * A quad corner cannot be placed without both endpoints of its segment — the
 * stroke direction is the screen-space direction between them — and the package
 * offers only two unshared vertices and an index pair per segment. Every corner
 * therefore carries both endpoint directions.
 * `validateStaticLineGeometryCopy` has already rejected any segment whose
 * endpoints disagree on the palette entry, so one entry index drives both poses.
 *
 * A land border between two countries is emitted once in each country's own
 * outline, so the package hands this helper the same segment twice. Both copies
 * decode to the same pair of endpoint directions and the same motion-palette
 * entry, so they pose identically and the second only pays for the first's
 * pixels a second time — at a blend the reader cannot see through, since the
 * material is transparent. Duplicates are therefore dropped here, at load, and
 * only the first copy of each shared border is expanded into a quad.
 * The match is bit-exact on the decoded endpoints: two segments merge only when
 * their endpoints are the same two quantized directions in either order *and*
 * they are bound to the same palette entry. The palette entry is part of the
 * key because two plates can carry coincident reference geometry while moving
 * apart — merging those would draw one border where the reconstruction has two.
 * The outline tone table stays indexed by the *source* segment, which is the
 * row the shipped table publishes, so each drawn quad carries the index of the
 * source segment it was kept for rather than its own draw order. That mapping
 * is also returned, so a caller can report the drawn and duplicate counts.
 *
 * The corners are materialised rather than instanced over a shared template.
 * Instancing stores this four times more compactly, and is slightly faster on a
 * hardware rasterizer, but 12 045 four-vertex instances cost a software
 * rasterizer a per-instance setup it cannot amortise: measured under
 * SwiftShader, the instanced form made an orbit frame 1030 ms against 600 ms
 * with the overlay hidden, while this form measured 595 ms. The browser suite
 * runs headless on SwiftShader, so that difference is the difference between a
 * passing and a timing-out orbit test.
 */
export function createPolylineQuadGeometry(
  source: PolylineSegmentSource,
  segmentCount: number,
  shellMetres: number,
): PolylineQuadGeometry {
  const sourceSegmentIndices = uniquePolylineSegments(source, segmentCount);
  const drawnCount = sourceSegmentIndices.length;
  const perSegment = POLYLINE_QUAD_VERTICES_PER_SEGMENT;
  const corners = new Float32Array(drawnCount * perSegment * 3);
  const starts = new Float32Array(drawnCount * perSegment * 3);
  const ends = new Float32Array(drawnCount * perSegment * 3);
  const entries = new Uint32Array(drawnCount * perSegment);
  // Every corner also carries the *source* segment it belongs to, which is the
  // row the outline tone table is sampled by. Four corners of one quad carry the
  // same index, so the tone is constant across the quad, and a quad kept for a
  // shared border still reads the tone published for the segment it came from.
  const segmentIndices = new Uint32Array(drawnCount * perSegment);
  const indices = new Uint32Array(drawnCount * POLYLINE_QUAD_INDICES_PER_SEGMENT);
  for (let drawn = 0; drawn < drawnCount; drawn += 1) {
    const segment = sourceSegmentIndices[drawn]!;
    const left = source.lineIndices[segment * 2]!;
    const right = source.lineIndices[segment * 2 + 1]!;
    const start = source.referenceDirections.subarray(left * 3, left * 3 + 3);
    const end = source.referenceDirections.subarray(right * 3, right * 3 + 3);
    const entry = source.preparedEntryIndices[left]!;
    for (let corner = 0; corner < perSegment; corner += 1) {
      const vertex = drawn * perSegment + corner;
      for (let axis = 0; axis < 3; axis += 1) {
        corners[vertex * 3 + axis] = POLYLINE_QUAD_CORNERS[corner * 3 + axis]!;
      }
      starts.set(start, vertex * 3);
      ends.set(end, vertex * 3);
      entries[vertex] = entry;
      segmentIndices[vertex] = segment;
    }
    for (let slot = 0; slot < POLYLINE_QUAD_INDICES_PER_SEGMENT; slot += 1) {
      indices[drawn * POLYLINE_QUAD_INDICES_PER_SEGMENT + slot] =
        drawn * perSegment + POLYLINE_QUAD_INDICES[slot]!;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(corners, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("countryLineStart", new THREE.BufferAttribute(starts, 3));
  geometry.setAttribute("countryLineEnd", new THREE.BufferAttribute(ends, 3));
  const entryAttribute = new THREE.BufferAttribute(entries, 1);
  // The TSL graph declares a uint attribute. WebGL2 must therefore bind this
  // buffer through vertexAttribIPointer rather than float conversion.
  entryAttribute.gpuType = THREE.IntType;
  geometry.setAttribute("countryLineEntryIndex", entryAttribute);
  const segmentAttribute = new THREE.BufferAttribute(segmentIndices, 1);
  segmentAttribute.gpuType = THREE.IntType;
  geometry.setAttribute("countryLineSegmentIndex", segmentAttribute);
  // `position` holds the quad-local corner, so a computed bounding sphere would
  // describe quad-local space. Transparent sorting wants the shell the segments
  // actually live on.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(),
    1 + shellMetres / EARTH_RADIUS_METRES);
  const gpuBytes = corners.byteLength + indices.byteLength
    + starts.byteLength + ends.byteLength + entries.byteLength + segmentIndices.byteLength;
  // The ledger is charged on the quads actually built, not on the source
  // segments: a dropped duplicate costs nothing on the GPU.
  if (gpuBytes !== polylineQuadBytes(drawnCount)) {
    throw new Error("polyline quad byte ledger mismatch");
  }
  return Object.freeze({ geometry, gpuBytes, segmentCount: drawnCount,
    duplicateCount: segmentCount - drawnCount, sourceSegmentIndices });
}

/**
 * The reconstructed pose of one polyline endpoint, as the material needs it.
 * The direction stays unit length even where activation collapses the position
 * to the globe centre, so the horizon term is defined for every endpoint.
 */
export interface PolylinePoseNodes {
  readonly position: Node<"vec3">;
  readonly direction: Node<"vec3">;
  readonly activeMask: Node<"float">;
}

/**
 * How a caller turns a reference direction and its motion-palette entry into a
 * pose on the shell. Injected rather than imported so this module owns no
 * reconstruction state and no import cycle exists with the renderer that owns
 * the palette texture.
 */
export type PolylinePoseFactory = (input: Readonly<{
  reference: Node<"vec3">;
  entry: Node<"int">;
  displayFraction: UniformNode<"float", number>;
  verticalExaggeration: UniformNode<"float", number>;
  shellOffsetMetres: number;
}>) => PolylinePoseNodes;

/** The two inks a two-tone polyline is drawn in; `light` may equal `dark`. */
export interface PolylineInk {
  readonly dark: readonly [number, number, number];
  readonly light: readonly [number, number, number];
}

/**
 * The segment list a batch is built from: the decoded EHGL line geometry, as
 * two unshared vertices and an index pair per segment. Structural, so the
 * decoder stays in `src/reconstruction` and this module never imports it.
 */
export interface PolylineSegmentSource {
  readonly referenceDirections: Float32Array;
  readonly lineIndices: Uint16Array | Uint32Array;
  /** Narrowed to 16 bits by the decoder when the palette is small enough. */
  readonly preparedEntryIndices: Uint16Array | Uint32Array;
}

export interface PolylineBatch {
  readonly geometry: THREE.BufferGeometry;
  readonly material: MeshBasicNodeMaterial;
  /** Node identities of the material graph, so a test can pin the wiring. */
  readonly graph: PolylineMaterialGraph;
  /** Replaces the tone table; `null` is the all-dark table. */
  readonly setToneTable: (texels: Uint8Array | null) => PolylineToneCounts;
  /** GPU bytes the expanded quad form occupies: 200 per drawn segment. */
  readonly ledgerBytes: number;
  /** Quads drawn, after the shared-border dedupe. */
  readonly segmentCount: number;
  /** Source segments the dedupe dropped; tones still resolve by source index. */
  readonly duplicateCount: number;
}

export interface PolylineBatchOptions {
  readonly segments: PolylineSegmentSource;
  readonly segmentCount: number;
  readonly pose: PolylinePoseFactory;
  readonly tones: Uint8Array | null;
  readonly ink: PolylineInk;
  readonly shellMetres: number;
  readonly widthPx: number;
  readonly displayFractionValue: number;
}

/**
 * One polyline batch: the expanded quad geometry, its material, and the tone
 * table applied once at build time.
 *
 * The renderer does not call this composed form for the country overlay,
 * because it builds the geometry when a package's static geometry arrives and
 * the material only when a pose palette is published — two different
 * lifetimes, one geometry outliving many materials. It calls the two halves,
 * `createPolylineQuadGeometry` and `createPolylineMaterial`, at those points.
 * This entry point is the whole-batch API for a caller whose geometry and
 * material share one lifetime, and it is what pins the two halves together in
 * the unit test.
 */
export function createPolylineBatch(options: PolylineBatchOptions): PolylineBatch {
  const expanded = createPolylineQuadGeometry(options.segments, options.segmentCount,
    options.shellMetres);
  const graph = createPolylineMaterial({
    // The source count, not the drawn one: the tone table is indexed by source
    // segment, and a deduped batch still reads rows past its own quad count.
    segmentCount: options.segmentCount, pose: options.pose, ink: options.ink,
    shellMetres: options.shellMetres, widthPx: options.widthPx,
    displayFractionValue: options.displayFractionValue,
  });
  graph.setToneTable(options.tones);
  return Object.freeze({
    geometry: expanded.geometry, material: graph.material, graph,
    setToneTable: graph.setToneTable, ledgerBytes: expanded.gpuBytes,
    segmentCount: expanded.segmentCount, duplicateCount: expanded.duplicateCount,
  });
}

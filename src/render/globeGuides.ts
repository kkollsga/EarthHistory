import * as THREE from "three";
import type { LonLat } from "../data";
import { lonLatToVector3 } from "./math";

export type GuideLabelPath = "parallel" | "meridian";

export interface GuideLabelSpec {
  readonly text: string;
  readonly coordinates: LonLat;
  readonly path: GuideLabelPath;
}

export const REFERENCE_GUIDE_LATITUDES = Object.freeze([
  0, 30, -30, 60, -60, 87.5, -87.5,
] as const);

export const REFERENCE_GUIDE_MAIN_LONGITUDES = Object.freeze([
  0, 90, 180, 270,
] as const);

export const REFERENCE_GUIDE_MINOR_LONGITUDES = Object.freeze([
  30, 60, 120, 150, 210, 240, 300, 330,
] as const);

/**
 * Schematic climate / graticule labels fixed in geographic space. Every anchor
 * lies exactly on the guide line it names; the ribbon geometry lifts the glyphs
 * off that line (see GUIDE_LABEL_LINE_GAP_RAD) so the line never crosses them.
 * The two pole labels ride a main meridian rather than the 87.5° parallel:
 * meridian convergence squeezes a near-polar parallel ribbon below legibility.
 */
export const REFERENCE_GUIDE_LABELS: readonly GuideLabelSpec[] = Object.freeze([
  { text: "North pole", coordinates: [0, 80], path: "meridian" },
  { text: "South pole", coordinates: [0, -80], path: "meridian" },
  { text: "Equator", coordinates: [-15, 0], path: "parallel" },
  { text: "Hadley edge · 30° N", coordinates: [-40, 30], path: "parallel" },
  { text: "Hadley edge · 30° S", coordinates: [-40, -30], path: "parallel" },
  { text: "Polar cell edge · 60° N", coordinates: [-70, 60], path: "parallel" },
  { text: "Polar cell edge · 60° S", coordinates: [-70, -60], path: "parallel" },
  { text: "Prime meridian", coordinates: [0, 50], path: "meridian" },
  { text: "Antimeridian", coordinates: [180, 50], path: "meridian" },
]);

export function createReferenceGuideLines(): readonly LonLat[][] {
  const latitude = (value: number): LonLat[] => Array.from({ length: 181 }, (_, index) =>
    [-180 + index * 2, value] as LonLat);
  const meridian = (value: number): LonLat[] => Array.from({ length: 45 }, (_, index) =>
    [value, -88 + index * 4] as LonLat);
  return [
    ...REFERENCE_GUIDE_LATITUDES.map(latitude),
    ...REFERENCE_GUIDE_MAIN_LONGITUDES.map(meridian),
  ];
}

/** Short meridian marks centered on every minor-longitude / latitude-guide crossing. */
export function createLongitudeCrossingTickGeometry(
  radius = 1.0014,
  halfLatitudeSpanDegrees = 0.5,
): THREE.BufferGeometry {
  if (!(radius > 0) || !(halfLatitudeSpanDegrees > 0)
      || halfLatitudeSpanDegrees > 0.5) {
    throw new Error("invalid longitude crossing tick shape");
  }
  const tickCount = REFERENCE_GUIDE_MINOR_LONGITUDES.length
    * REFERENCE_GUIDE_LATITUDES.length;
  const positions = new Float32Array(tickCount * 2 * 3);
  let positionOffset = 0;
  for (const latitude of REFERENCE_GUIDE_LATITUDES) {
    for (const longitude of REFERENCE_GUIDE_MINOR_LONGITUDES) {
      const start = lonLatToVector3(
        [longitude, latitude - halfLatitudeSpanDegrees], radius);
      const end = lonLatToVector3(
        [longitude, latitude + halfLatitudeSpanDegrees], radius);
      positions[positionOffset] = start.x;
      positions[positionOffset + 1] = start.y;
      positions[positionOffset + 2] = start.z;
      positions[positionOffset + 3] = end.x;
      positions[positionOffset + 4] = end.y;
      positions[positionOffset + 5] = end.z;
      positionOffset += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createLongitudeCrossingTickLines(): THREE.LineSegments {
  const geometry = createLongitudeCrossingTickGeometry();
  const material = new THREE.LineBasicMaterial({
    color: 0xc5ddd6,
    transparent: true,
    opacity: 0.7,
    depthTest: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  lines.userData.overlayLayer = "guides";
  lines.userData.evidence = "schematic-geographic-reference";
  lines.userData.guideLongitudeCrossingTicks = true;
  return lines;
}

/**
 * Guide-label ink: one flat neutral dark grey, no outline and no shadow, so the
 * labels stay quiet against the surface. Measured against the 0 Ma Cao palette
 * at material opacity 0.85 this reads about 2.9:1 on pale land and 1.8:1 on
 * shelf water, but only about 1.05:1 on deep ocean, where a dark grey sits at
 * the background luminance. A flat dark tone cannot serve both backgrounds.
 */
export const GUIDE_LABEL_DARK_INK_STYLE = "#4a4f54";
/**
 * Light ink for water. The dark tone sits at the water luminance and disappears
 * there, so a label segment over shelf or open ocean is painted with this
 * instead. Measured against the rendered tones it clears 3:1 on both.
 */
export const GUIDE_LABEL_LIGHT_INK_STYLE = "#d0d4d5";

/** Which ink a label segment carries, chosen from the surface beneath it. */
export type GuideLabelTone = "dark" | "light";

export function guideLabelInkStyle(tone: GuideLabelTone): string {
  return tone === "dark" ? GUIDE_LABEL_DARK_INK_STYLE : GUIDE_LABEL_LIGHT_INK_STYLE;
}

/**
 * Land is the pale background, so a sample covered by a land chart takes the
 * dark ink. Anything else — shelf water or open ocean — is dark under the label
 * and takes the light ink. `covered` must therefore be answered with land-only
 * coverage, not the shelf-inclusive coverage picking uses.
 */
export function guideLabelToneForCoverage(covered: boolean): GuideLabelTone {
  return covered ? "dark" : "light";
}

/**
 * Tone used while no native Cao publication is mounted (the editorial
 * out-of-domain surface). Every editorial base colour except the ice-dominant
 * and magma ones is a dark ocean blue, so the light ink is the safer fixed
 * fallback there.
 */
export const GUIDE_LABEL_EDITORIAL_TONE: GuideLabelTone = "light";

/** Along-track pieces a label is split into, each classified separately. */
export const GUIDE_LABEL_TONE_SEGMENTS = 4;
/** Land-coverage probes per segment; any hit makes the segment covered. */
export const GUIDE_LABEL_TONE_SAMPLES_PER_SEGMENT = 2;
/**
 * Consecutive opposite classifications required before a segment flips tone.
 * Without it a segment straddling a coastline alternates on every age sample.
 */
export const GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES = 2;
/**
 * Quiet time after the last publication or retarget before a classification
 * round starts. Continuous scrubbing republishes far faster than a colour
 * choice needs to follow, so rounds wait for the scrub to rest.
 */
export const GUIDE_LABEL_TONE_SETTLE_MS = 250;
/**
 * Coverage probes evaluated per frame. A probe is a chart-coverage test against
 * the live Cao surface, measured at about 0.15 ms on the reference machine, so
 * a round is still spread over frames rather than blocking one: this budget
 * costs about 1.2 ms per frame and settles a whole round inside ten frames.
 */
export const GUIDE_LABEL_TONE_PROBE_BUDGET_PER_FRAME = 8;

export interface GuideLabelToneState {
  readonly tone: GuideLabelTone;
  /** Consecutive samples that disagreed with the held tone. */
  readonly pending: number;
}

/**
 * Advances one segment's tone under hysteresis: the held tone only yields after
 * the opposite classification repeats GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES times.
 */
export function nextGuideLabelToneState(
  state: GuideLabelToneState,
  covered: boolean,
  hysteresis = GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES,
): GuideLabelToneState {
  if (!Number.isSafeInteger(hysteresis) || hysteresis < 1) {
    throw new Error("invalid guide-label tone hysteresis");
  }
  const desired = guideLabelToneForCoverage(covered);
  if (desired === state.tone) return state.pending === 0 ? state : { tone: state.tone, pending: 0 };
  const pending = state.pending + 1;
  return pending >= hysteresis ? { tone: desired, pending: 0 } : { tone: state.tone, pending };
}
export const GUIDE_LABEL_TEXTURE_HEIGHT_PX = 128;
export const GUIDE_LABEL_FONT_PX = 68;
/**
 * The sheet is sized to the string it carries instead of condensing long text
 * into a fixed width. Glyph arc height comes from the sheet height alone, so a
 * wider sheet leaves every label at the same glyph scale - it only widens the
 * ribbon. Without this, "Polar cell edge - 60 N" rendered horizontally
 * squeezed while short labels did not.
 */
export const GUIDE_LABEL_SHEET_MIN_WIDTH_PX = 256;
export const GUIDE_LABEL_SHEET_MAX_WIDTH_PX = 2048;
/** Clear side margin at each end of the sheet, as a fraction of its width. */
export const GUIDE_LABEL_SHEET_SIDE_MARGIN = 0.03;
/**
 * Ink-free fraction of the sheet below the glyph baseline. Together with
 * GUIDE_LABEL_LINE_GAP_RAD this is the whole clear margin between a guide line
 * and the glyph feet; see GUIDE_LABEL_INK_CLEARANCE_RAD.
 */
export const GUIDE_LABEL_BASELINE_PAD_FRACTION = 0.046;

/** The 2D-context surface paintGuideLabel needs; a test can record against it. */
export type GuideLabelPaintContext = Pick<CanvasRenderingContext2D,
  "font" | "letterSpacing" | "textAlign" | "textBaseline" | "fillStyle"
  | "clearRect" | "fillText" | "strokeText">;

function guideLabelFont(): string {
  return `600 ${GUIDE_LABEL_FONT_PX}px system-ui, sans-serif`;
}

/** Sheet width that holds textWidthPx of glyphs plus a margin at each end. */
export function guideLabelSheetWidth(textWidthPx: number): number {
  if (!(textWidthPx > 0)) throw new Error("invalid guide-label text width");
  const needed = textWidthPx / (1 - 2 * GUIDE_LABEL_SHEET_SIDE_MARGIN);
  return Math.min(GUIDE_LABEL_SHEET_MAX_WIDTH_PX,
    Math.max(GUIDE_LABEL_SHEET_MIN_WIDTH_PX, Math.ceil(needed / 16) * 16));
}

/**
 * Paints one guide label. Single flat fill: no strokeText and no shadow, so the
 * sheet carries exactly one tone, and no maxWidth, so the string is never
 * condensed. The glyphs are uppercase and therefore have no descender, which is
 * what lets the alphabetic baseline double as the lowest ink row.
 */
export function paintGuideLabel(
  context: GuideLabelPaintContext,
  text: string,
  sheetWidth: number,
  tone: GuideLabelTone = "dark",
): void {
  const height = GUIDE_LABEL_TEXTURE_HEIGHT_PX;
  context.clearRect(0, 0, sheetWidth, height);
  context.font = guideLabelFont();
  context.letterSpacing = "1px";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = guideLabelInkStyle(tone);
  context.fillText(text.toUpperCase(), sheetWidth / 2,
    height * (1 - GUIDE_LABEL_BASELINE_PAD_FRACTION));
}

export function createGuideLabelTexture(
  text: string,
  tone: GuideLabelTone = "dark",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.height = GUIDE_LABEL_TEXTURE_HEIGHT_PX;
  canvas.width = GUIDE_LABEL_SHEET_MIN_WIDTH_PX;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create guide-label texture");
  context.font = guideLabelFont();
  context.letterSpacing = "1px";
  // Resizing the canvas resets the 2D state, so measure first and paint after.
  canvas.width = guideLabelSheetWidth(
    Math.max(1, context.measureText(text.toUpperCase()).width));
  paintGuideLabel(context, text, canvas.width, tone);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = true;
  return texture;
}

/**
 * Tangent-plane gap between a guide line and the bottom edge of its label
 * ribbon, in radians of arc. Non-zero is the contract: the label rides just
 * above its line instead of being bisected by it.
 */
export const GUIDE_LABEL_LINE_GAP_RAD = 0.0009;

/**
 * Smallest cos(latitude) used to convert a parallel label's along-track arc
 * into degrees of longitude. Without the conversion a 60° label renders at
 * half its intended width and a near-polar one is an illegible smear.
 */
export const GUIDE_LABEL_MIN_COS_LATITUDE = 0.25;

export interface GuideLabelBasis {
  /** Texture +u: the reading direction of the glyphs. */
  readonly forward: THREE.Vector3;
  /** Texture +v: glyph up, and the side the label is offset toward. */
  readonly up: THREE.Vector3;
  /** Surface normal, pointing at a viewer outside the globe. */
  readonly outward: THREE.Vector3;
}

/**
 * Right-handed label basis: forward x up === outward. A viewer outside the
 * globe therefore always reads the glyphs left-to-right, on either hemisphere
 * and either side of a meridian. Meridian labels take up = west precisely
 * because up = east would make the basis left-handed and mirror the text.
 */
export function createGuideLabelBasis(
  path: GuideLabelPath,
  coordinates: LonLat,
): GuideLabelBasis {
  const [longitude, latitude] = coordinates;
  const clampedLat = Math.max(-89.9, Math.min(89.9, latitude));
  const lonRad = longitude * Math.PI / 180;
  const outward = lonLatToVector3([longitude, clampedLat]).normalize();
  // Renderer frame: +Y north, lon from +X toward -Z. East is d(position)/d(lon).
  const east = new THREE.Vector3(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
  const north = new THREE.Vector3().crossVectors(outward, east).normalize();
  return path === "parallel"
    ? { forward: east, up: north, outward }
    : { forward: north, up: east.clone().negate(), outward };
}

/** Fraction of a label's along-track arc a piece of geometry covers. */
export interface GuideLabelArcRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Along-track position on a label's baseline, t running 0..1 west-to-east on a
 * parallel and south-to-north on a meridian. A parallel advances in degrees of
 * longitude, which shrink with cos(lat), so the step is scaled to keep the
 * drawn glyph arc equal to angularWidthRad at any latitude.
 */
export function guideLabelPathCoordinate(
  path: GuideLabelPath,
  center: LonLat,
  angularWidthRad: number,
  t: number,
): LonLat {
  const [lon0, lat0] = center;
  const offset = (t - 0.5) * angularWidthRad;
  const alongTrackScale = path === "parallel"
    ? 1 / Math.max(GUIDE_LABEL_MIN_COS_LATITUDE,
      Math.cos(Math.max(-89.9, Math.min(89.9, lat0)) * Math.PI / 180))
    : 1;
  const lon = path === "parallel"
    ? lon0 + offset * (180 / Math.PI) * alongTrackScale : lon0;
  const lat = path === "meridian" ? lat0 + offset * (180 / Math.PI) : lat0;
  return [lon, Math.max(-89.9, Math.min(89.9, lat))];
}

/** Evenly spaced probe directions inside one segment's share of the arc. */
export function guideLabelSegmentProbes(
  path: GuideLabelPath,
  center: LonLat,
  angularWidthRad: number,
  range: GuideLabelArcRange,
  samples = GUIDE_LABEL_TONE_SAMPLES_PER_SEGMENT,
): readonly THREE.Vector3[] {
  if (!Number.isSafeInteger(samples) || samples < 1) {
    throw new Error("invalid guide-label probe count");
  }
  return Array.from({ length: samples }, (_, index) => {
    const t = range.from + ((index + 0.5) / samples) * (range.to - range.from);
    return lonLatToVector3(
      guideLabelPathCoordinate(path, center, angularWidthRad, t)).normalize();
  });
}

/**
 * Builds a thin ribbon mesh that follows a parallel or meridian so the label
 * sits curved on the globe and rotates with geographic space (not billboarded).
 * The ribbon is lifted entirely onto the +up side of its line: its lower edge
 * starts GUIDE_LABEL_LINE_GAP_RAD above the line, so the line clears the glyphs.
 */
export function createCurvedGuideLabelGeometry(
  path: GuideLabelPath,
  center: LonLat,
  angularWidthRad: number,
  angularHeightRad: number,
  radius: number,
  samples = 28,
  range: GuideLabelArcRange = { from: 0, to: 1 },
): { geometry: THREE.BufferGeometry; centerDirection: THREE.Vector3 } {
  if (!(angularWidthRad > 0) || !(angularHeightRad > 0) || !(radius > 0)
      || !Number.isSafeInteger(samples) || samples < 2) {
    throw new Error("invalid curved guide-label shape");
  }
  if (!(range.to > range.from) || range.from < 0 || range.to > 1) {
    throw new Error("invalid curved guide-label arc range");
  }
  const positions = new Float32Array((samples + 1) * 2 * 3);
  const uvs = new Float32Array((samples + 1) * 2 * 2);
  const indices = new Uint16Array(samples * 6);
  const top = new THREE.Vector3();
  const bottom = new THREE.Vector3();
  const bottomOffset = GUIDE_LABEL_LINE_GAP_RAD * radius;
  const topOffset = (GUIDE_LABEL_LINE_GAP_RAD + angularHeightRad) * radius;

  for (let index = 0; index <= samples; index += 1) {
    const t = range.from + (index / samples) * (range.to - range.from);
    const [lon, clampedLat] = guideLabelPathCoordinate(path, center, angularWidthRad, t);
    const point = lonLatToVector3([lon, clampedLat], radius);
    const { up } = createGuideLabelBasis(path, [lon, clampedLat]);
    top.copy(point).addScaledVector(up, topOffset);
    bottom.copy(point).addScaledVector(up, bottomOffset);
    // Re-project onto the shell so the ribbon stays globe-fixed and curved.
    top.copy(top.normalize().multiplyScalar(radius));
    bottom.copy(bottom.normalize().multiplyScalar(radius));
    const base = index * 6;
    positions[base] = top.x; positions[base + 1] = top.y; positions[base + 2] = top.z;
    positions[base + 3] = bottom.x; positions[base + 4] = bottom.y; positions[base + 5] = bottom.z;
    const uv = index * 4;
    uvs[uv] = t; uvs[uv + 1] = 1;
    uvs[uv + 2] = t; uvs[uv + 3] = 0;
    if (index < samples) {
      const v = index * 2;
      const i = index * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v + 1; indices[i + 4] = v + 3; indices[i + 5] = v + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return {
    geometry,
    centerDirection: lonLatToVector3(center).normalize(),
  };
}

/**
 * Height of the whole sheet as an arc angle, glyphs plus the padded band. The
 * ink itself is roughly a third of it, which lands near 11 CSS pixels on a
 * 390 px phone at the default globe distance -- readable without dominating.
 */
export const GUIDE_LABEL_ANGULAR_HEIGHT_RAD = 0.026;
/**
 * Total clear arc between a guide line and the lowest glyph ink: the ribbon
 * offset plus the sheet's ink-free bottom band. Sized for a 1-2 CSS pixel
 * margin at the default global camera; the whole point is a hairline margin,
 * not a detached label, so this stays small but strictly positive.
 */
export const GUIDE_LABEL_INK_CLEARANCE_RAD = GUIDE_LABEL_LINE_GAP_RAD
  + GUIDE_LABEL_BASELINE_PAD_FRACTION * GUIDE_LABEL_ANGULAR_HEIGHT_RAD;
/** Held back from opaque so the labels sit behind the surface, not on it. */
export const GUIDE_LABEL_OPACITY = 0.85;

/** One classified piece of a label: its meshes, probes and held tone. */
export interface GuideLabelSegment {
  readonly mesh: THREE.Mesh;
  readonly probes: readonly THREE.Vector3[];
  state: GuideLabelToneState;
}

export interface GuideLabelGroup extends THREE.Group {
  userData: THREE.Group["userData"] & {
    guideLabelDirection: THREE.Vector3;
    guideLabelSegments: readonly GuideLabelSegment[];
    ownedTextures: readonly THREE.Texture[];
    guideLabelMaterials: Record<GuideLabelTone, THREE.MeshBasicMaterial>;
  };
}

function createGuideLabelMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: GUIDE_LABEL_OPACITY,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    alphaTest: 0.04,
  });
}

/**
 * Builds one label as a group of along-track segments sharing two prebuilt
 * sheets, one inked dark and one light. Choosing a tone is a material swap per
 * segment, so an age sample never repaints a canvas or rebuilds geometry.
 */
export function createGuideLabelGroup(
  spec: GuideLabelSpec,
  radius = 1.0022,
  segments = GUIDE_LABEL_TONE_SEGMENTS,
): GuideLabelGroup {
  if (!Number.isSafeInteger(segments) || segments < 1 || segments > 16) {
    throw new Error("invalid guide-label segment count");
  }
  const textures: Record<GuideLabelTone, THREE.CanvasTexture> = {
    dark: createGuideLabelTexture(spec.text, "dark"),
    light: createGuideLabelTexture(spec.text, "light"),
  };
  const materials: Record<GuideLabelTone, THREE.MeshBasicMaterial> = {
    dark: createGuideLabelMaterial(textures.dark),
    light: createGuideLabelMaterial(textures.light),
  };
  const angularHeight = GUIDE_LABEL_ANGULAR_HEIGHT_RAD;
  const sheet = textures.dark.image as HTMLCanvasElement;
  const aspect = Math.max(1, sheet.width / Math.max(1, sheet.height));
  const angularWidth = Math.min(1.15, angularHeight * aspect * 0.92);
  const group = new THREE.Group() as GuideLabelGroup;
  const built: GuideLabelSegment[] = [];
  for (let index = 0; index < segments; index += 1) {
    const range: GuideLabelArcRange = { from: index / segments, to: (index + 1) / segments };
    const { geometry } = createCurvedGuideLabelGeometry(
      spec.path, spec.coordinates, angularWidth, angularHeight, radius,
      Math.max(2, Math.ceil(28 / segments)), range);
    // Dark is the opening tone: a first classification arrives before the first
    // frame that can show a label, and dark suits the land the anchors sit on.
    const mesh = new THREE.Mesh(geometry, materials.dark);
    mesh.renderOrder = 2.9;
    mesh.frustumCulled = false;
    mesh.userData.overlayLayer = "guides";
    mesh.userData.evidence = "schematic-climatological-reference";
    mesh.userData.guideSurfaceLabel = true;
    group.add(mesh);
    built.push({ mesh, state: { tone: "dark", pending: 0 },
      probes: guideLabelSegmentProbes(spec.path, spec.coordinates, angularWidth, range) });
  }
  group.userData.overlayLayer = "guides";
  group.userData.evidence = "schematic-climatological-reference";
  group.userData.guideSurfaceLabel = true;
  group.userData.guideLabelDirection = lonLatToVector3(spec.coordinates).normalize();
  group.userData.guideLabelSegments = built;
  group.userData.ownedTextures = [textures.dark, textures.light];
  group.userData.guideLabelMaterials = materials;
  return group;
}

/** One classification round in progress, advanced a few probes per frame. */
export interface GuideLabelToneScan {
  readonly entries: readonly { readonly group: GuideLabelGroup;
    readonly segment: GuideLabelSegment }[];
  /** Index of the segment being probed. */
  cursor: number;
  /** Next probe to evaluate inside that segment. */
  probe: number;
  /** Whether any probe of the current segment has hit a chart yet. */
  covered: boolean;
}

export function createGuideLabelToneScan(
  groups: readonly GuideLabelGroup[],
): GuideLabelToneScan {
  const entries = groups.flatMap((group) =>
    group.userData.guideLabelSegments.map((segment) => ({ group, segment })));
  return { entries, cursor: 0, probe: 0, covered: false };
}

export interface GuideLabelToneScanStep {
  readonly probes: number;
  readonly changes: number;
  readonly done: boolean;
}

/**
 * Advances a round by at most `budget` probes. `isCovered` answers "does a land
 * chart cover this direction in the surface currently on screen"; a segment is
 * covered as soon as one of its probes hits, so the remaining probes of that
 * segment are skipped. Committing a segment applies the tone hysteresis and
 * swaps its prebuilt material, never repainting a canvas.
 */
export function advanceGuideLabelToneScan(
  scan: GuideLabelToneScan,
  budget: number,
  isCovered: (direction: THREE.Vector3) => boolean,
): GuideLabelToneScanStep {
  if (!Number.isSafeInteger(budget) || budget < 1) {
    throw new Error("invalid guide-label tone probe budget");
  }
  let probes = 0;
  let changes = 0;
  while (probes < budget && scan.cursor < scan.entries.length) {
    const { group, segment } = scan.entries[scan.cursor]!;
    if (!scan.covered && scan.probe < segment.probes.length) {
      scan.covered = isCovered(segment.probes[scan.probe]!);
      scan.probe += 1;
      probes += 1;
      continue;
    }
    const next = nextGuideLabelToneState(segment.state, scan.covered);
    if (next.tone !== segment.state.tone) {
      segment.mesh.material = group.userData.guideLabelMaterials[next.tone];
      changes += 1;
    }
    segment.state = next;
    scan.cursor += 1;
    scan.probe = 0;
    scan.covered = false;
  }
  return { probes, changes, done: scan.cursor >= scan.entries.length };
}
/** Flat polar sector ticks drawn on the sphere (short meridian marks). */
export function createPolarSectorTickGeometry(
  latitudeSign: 1 | -1,
  radius = 1.0014,
  sectors = 12,
  outerLat = 88.05,
  innerLat = 89.55,
): THREE.BufferGeometry {
  if (!Number.isSafeInteger(sectors) || sectors < 4 || sectors > 36) {
    throw new Error("invalid polar sector count");
  }
  const positions = new Float32Array(sectors * 2 * 3);
  for (let index = 0; index < sectors; index += 1) {
    const lon = -180 + (index / sectors) * 360;
    const outer = lonLatToVector3([lon, latitudeSign * outerLat], radius);
    const inner = lonLatToVector3([lon, latitudeSign * innerLat], radius);
    const offset = index * 6;
    positions[offset] = outer.x; positions[offset + 1] = outer.y; positions[offset + 2] = outer.z;
    positions[offset + 3] = inner.x; positions[offset + 4] = inner.y; positions[offset + 5] = inner.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPolarSectorTickLines(latitudeSign: 1 | -1): THREE.LineSegments {
  const geometry = createPolarSectorTickGeometry(latitudeSign);
  const material = new THREE.LineBasicMaterial({
    color: 0xc5ddd6,
    transparent: true,
    opacity: 0.7,
    depthTest: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  lines.userData.overlayLayer = "guides";
  lines.userData.guidePoleMarker = true;
  lines.userData.guideLabelDirection = new THREE.Vector3(0, latitudeSign, 0);
  return lines;
}


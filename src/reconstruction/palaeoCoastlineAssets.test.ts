import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime, chartPickStateFromMotionFrame, packageAssetPath,
  type PreparedCaoPalaeoInterval, type ReconstructionPackageManifestV2,
  type StaticAssetFetcher } from "./index";
import { numberScalarOps, rotateDirection } from "./arithmetic";
import { decodePalaeoCoastlineClassCatalog, decodePalaeoRingPayload,
  selectPalaeoCatalogInterval, validatePalaeoRingPayloadAgainstCatalog } from "./palaeoRings";
import { preparePalaeoRingPayload } from "./palaeoTriangulate";
import { createCaoFoundationGeometryResource, intersectCaoFoundationSurface }
  from "../render/reconstruction/caoFoundation";

/**
 * Probes over the promoted Cao 2017 assets themselves, not over a fixture.
 *
 * The compiler, the validator and the decoder each have their own tests; what
 * is unproven until the real bytes are read is whether the two halves agree —
 * whether the reservation the manifest declares actually covers what this
 * runtime's refinement produces, whether the tracked `PLATEID1` overrides and
 * the North Sea restoration binding survive `palaeo-binding-entry-v1`, and
 * whether a triangulated piece really covers the ground its rings enclose.
 */

const root = resolve("public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

async function packageManifest(): Promise<ReconstructionPackageManifestV2> {
  return JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
}

type PalaeoClass = "lm" | "sm" | "m";

async function classCatalog(surfaceClass: PalaeoClass) {
  const url = `palaeo-coastlines/${surfaceClass}/palaeo-${surfaceClass}-catalog.json`;
  return decodePalaeoCoastlineClassCatalog(
    JSON.parse(await readFile(resolve(root, url), "utf8")), surfaceClass);
}

async function payloadBuffer(surfaceClass: PalaeoClass, url: string): Promise<ArrayBuffer> {
  const bytes = await readFile(resolve(root, `palaeo-coastlines/${surfaceClass}/${url}`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const EARTH_RADIUS_KM = 6_371.0088;
const lonLat = (lon: number, lat: number): [number, number, number] => {
  const a = lon * Math.PI / 180;
  const b = lat * Math.PI / 180;
  return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
};
const toRenderer = (d: readonly [number, number, number]): [number, number, number] =>
  [d[0]!, d[2]!, -d[1]!];
const separationKm = (a: readonly number[], b: readonly number[]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))) * EARTH_RADIUS_KM;

/** The native instance's own bounds; these probes pick against the full Cao surface. */
const PICK_LIMITS = { maxBatches: 512, maxVertices: 520_000, maxTriangles: 660_000,
  maxRetainedSourceBytes: 48 * 1024 * 1024, maxTextureSize: 2_048,
  maxPublicationBytes: 2 * 1024 * 1024, maxSpatialIndexBytes: 1024 * 1024 };

/** Posed reference directions of one palaeo batch, with the chart that posed each. */
function posedVertices(prepared: PreparedCaoPalaeoInterval, batchIndex: number) {
  const batch = prepared.batches[batchIndex]!;
  const copy = batch.createStaticGeometryCopy();
  return { copy, batch,
    vertex(index: number) {
      const reference = [copy.referenceDirections[index * 3]!, copy.referenceDirections[index * 3 + 1]!,
        copy.referenceDirections[index * 3 + 2]!] as const;
      const chart = prepared.charts[copy.preparedEntryIndices[index]!]!;
      return { reference, chart,
        posed: rotateDirection(numberScalarOps, chart.poseQuaternion, reference) };
    } };
}

/**
 * Whether a unit direction lies inside a spherical triangle of the prepared
 * mesh. The hemisphere test is not decoration: the three edge signs alone are
 * also satisfied by the triangle's antipode, which would report the open South
 * Pacific as covered by land on the other side of the globe.
 */
function insideSphericalTriangle(
  direction: readonly [number, number, number],
  a: readonly number[], b: readonly number[], c: readonly number[],
): boolean {
  if (direction[0] * (a[0]! + b[0]! + c[0]!) + direction[1] * (a[1]! + b[1]! + c[1]!)
      + direction[2] * (a[2]! + b[2]! + c[2]!) <= 0) return false;
  const side = (p: readonly number[], q: readonly number[]) => {
    const cross = [p[1]! * q[2]! - p[2]! * q[1]!, p[2]! * q[0]! - p[0]! * q[2]!,
      p[0]! * q[1]! - p[1]! * q[0]!];
    return cross[0]! * direction[0] + cross[1]! * direction[1] + cross[2]! * direction[2];
  };
  const first = side(a, b);
  const second = side(b, c);
  const third = side(c, a);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}

describe("promoted Cao 2017 palaeo-coastline assets", () => {
  it("decodes one real payload against its real catalog", async () => {
    const catalog = await classCatalog("lm");
    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.encoding).toBe("palaeo-class-catalog-columnar-v1");
    // 24 Cao 2017 map intervals plus the detached LGM lowstand state.
    expect(catalog.intervals).toHaveLength(25);
    expect(catalog.detachedIntervalIds).toEqual(["lgm"]);
    expect(catalog.entrySelection.rule).toBe("palaeo-binding-entry-v1");
    // The published catalog carries no chart table: `chartCount` alone bounds a
    // piece's source-record ordinal.
    expect((catalog as unknown as { charts?: unknown }).charts).toBeUndefined();
    expect(catalog.chartCount).toBeGreaterThan(7_000);
    const record = catalog.intervals.find((interval) => interval.intervalId === "94-81")!;
    expect(record.payload.url).toBe("palaeo-lm-94-81.ehpr");
    const buffer = await payloadBuffer("lm", record.payload.url);
    expect(buffer.byteLength).toBe(record.payload.bytes);
    const payload = decodePalaeoRingPayload(buffer);
    expect(payload.surfaceClass).toBe("lm");
    expect(payload.pieces.length).toBe(record.payload.pieces);
    expect(payload.ringCount).toBe(record.payload.rings);
    expect(payload.vertexCount).toBe(record.payload.vertices);
    // The 2-byte ring record: the widest real ring is far below the 32,767 cap
    // and at least one piece carries an interior ring.
    const rings = payload.pieces.flatMap((piece) => piece.rings);
    expect(Math.max(...rings.map((ring) => ring.vertexCount))).toBeLessThan(32_768);
    expect(rings.some((ring) => ring.hole)).toBe(true);
    expect(() => validatePalaeoRingPayloadAgainstCatalog(payload, catalog, record)).not.toThrow();
  });

  it("keeps every promoted interval inside the declared reservation", async () => {
    const manifest = await packageManifest();
    const reservation = manifest.palaeoCoastlines!.reservation;
    // All three shipped classes: the reservation is their per-interval sum, so
    // leaving the mountain class out would validate a ceiling nothing tests.
    const catalogs = { lm: await classCatalog("lm"), sm: await classCatalog("sm"),
      m: await classCatalog("m") };
    const measured = new Map<string, { vertices: number; triangles: number; estimate: number }>();
    for (const [surfaceClass, catalog] of Object.entries(catalogs)) {
      for (const interval of catalog.intervals) {
        const prepared = preparePalaeoRingPayload(
          await payloadBuffer(surfaceClass as PalaeoClass, interval.payload.url),
          { maxEdgeDegrees: reservation.maxEdgeDegrees,
            maxVertices: reservation.maxIntervalVertices,
            maxTriangles: reservation.maxIntervalTriangles });
        const row = measured.get(interval.intervalId)
          ?? { vertices: 0, triangles: 0, estimate: 0 };
        row.vertices += prepared.geometry.vertexCount;
        row.triangles += prepared.geometry.triangleCount;
        row.estimate += interval.reservation.estimatedTrianglesAtOneDegree;
        measured.set(interval.intervalId, row);
        expect(prepared.geometry.maximumEdgeDegrees).toBeLessThanOrEqual(1);
      }
    }
    expect(measured.size).toBe(25);
    expect(Object.keys(catalogs)).toEqual(["lm", "sm", "m"]);
    for (const [intervalId, row] of measured) {
      expect(row.vertices, `${intervalId} vertices`).toBeLessThanOrEqual(reservation.maxIntervalVertices);
      expect(row.triangles, `${intervalId} triangles`).toBeLessThanOrEqual(reservation.maxIntervalTriangles);
    }
    // The compiler models per-triangle longest-edge bisection and this runtime
    // bisects conformingly, so the runtime count is systematically higher. The
    // reservation is the estimate scaled by 2.0 for exactly that reason; this
    // asserts the scale still covers the worst interval.
    const ratios = [...measured.values()].map((row) => row.triangles / row.estimate);
    // Measured 2026-09-15 over lm+sm+m: 1.88 at the worst interval (29-20 Ma,
    // 300,697 vertices and 483,487 triangles against a 256,939 estimate). The
    // bound is a drift detector, and the reservation is sized on the worst
    // interval's absolute count, which the per-interval assertions above check.
    expect(Math.max(...ratios)).toBeLessThan(2.2);
    expect(Math.min(...ratios)).toBeGreaterThan(1);
  }, 120_000);

  it("draws the LGM lowstand shelf at 0.021 Ma and nothing at 0 Ma", async () => {
    // The published LGM interval as the runtime actually resolves it: the
    // landmass payload carries the three footprints, the shallow-marine payload
    // is empty on purpose, and no interval covers the present day.
    const catalogs = { lm: await classCatalog("lm"), sm: await classCatalog("sm") };
    for (const catalog of Object.values(catalogs)) {
      const record = catalog.intervals.find((interval) => interval.intervalId === "lgm")!;
      expect(record.intervalIndex).toBe(24);
      expect(record.fromAgeMa).toBe(0.0265);
      expect(record.toAgeMa).toBe(0.0195);
      const payload = decodePalaeoRingPayload(
        await payloadBuffer(catalog.class as PalaeoClass, record.payload.url));
      expect(() => validatePalaeoRingPayloadAgainstCatalog(payload, catalog, record)).not.toThrow();
      // A eustatic contour says where land was, not where a shallow sea was.
      if (catalog.class === "sm") expect(payload.pieces).toHaveLength(0);
      else expect(payload.pieces.length).toBeGreaterThan(100);
    }
    // Selection against the real published catalog, at the timeline's own
    // `quaternary-lgm` chapter age and on both bounds of the window.
    const at = (ageMa: number) =>
      selectPalaeoCatalogInterval(catalogs.lm, ageMa)?.intervalId ?? null;
    expect(at(0.021)).toBe("lgm");
    expect(at(0.0265)).toBe("lgm");
    expect(at(0.0194)).toBeNull();
    expect(at(0.0266)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(1)).toBeNull();
    expect(at(90)).toBe("94-81");

    const record = catalogs.lm.intervals.find((interval) => interval.intervalId === "lgm")!;
    const prepared = preparePalaeoRingPayload(await payloadBuffer("lm", record.payload.url),
      { maxEdgeDegrees: 1, maxVertices: 300_000, maxTriangles: 480_000 });
    const { referenceDirections, indices } = prepared.geometry;
    const covers = (longitude: number, latitude: number) => {
      const direction = lonLat(longitude, latitude);
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const corner = (slot: number) => {
          const base = indices[triangle + slot]! * 3;
          return [referenceDirections[base]!, referenceDirections[base + 1]!,
            referenceDirections[base + 2]!];
        };
        if (insideSphericalTriangle(direction, corner(0), corner(1), corner(2))) return true;
      }
      return false;
    };
    expect(covers(2.5, 54.7), "Dogger Bank").toBe(true);
    expect(covers(108, 2), "Sunda shelf").toBe(true);
    expect(covers(-170, 65), "Bering land bridge").toBe(true);
    expect(covers(-0.1, 51.5), "London, unchanged present-day land").toBe(true);
    expect(covers(4, 58.5), "Norwegian Trench").toBe(false);
    // Outside the three footprints the layer draws nothing and the present-day
    // composition stays on screen.
    expect(covers(-60, -20), "South Atlantic, outside every footprint").toBe(false);
  }, 120_000);

  it("keeps a Lhasa piece with the Cao 2024 Lhasa ground at 220 Ma", async () => {
    // Cookie-cut alone would bind the Lhasa polygons to the partition that owns
    // the ground and carry them into the Tethys with India; the tracked
    // PLATEID1 override on 606 is what keeps them with Lhasa. This measures the
    // result against where the native Cao 2024 surface puts the same ground.
    const runtime = new CaoReconstructionRuntime(await packageManifest(), fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(220).prepared;
    expect(prepared.intervalId).toBe("224-203");
    const { copy, vertex } = posedVertices(prepared, 0);
    // Present-day Lhasa terrane: the southern Tibetan block north of the
    // Indus-Yarlung suture.
    let count = 0;
    const centroid: [number, number, number] = [0, 0, 0];
    const reference: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < copy.referenceDirections.length / 3; index += 1) {
      const sample = vertex(index);
      const longitude = Math.atan2(sample.reference[1], sample.reference[0]) * 180 / Math.PI;
      const latitude = Math.asin(sample.reference[2]) * 180 / Math.PI;
      if (longitude < 85 || longitude > 92 || latitude < 29.5 || latitude > 31.5) continue;
      if (sample.chart.support.kind !== "supported") continue;
      count += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        centroid[axis] += sample.posed[axis]!;
        reference[axis] += sample.reference[axis]!;
      }
    }
    expect(count).toBeGreaterThan(20);
    const normalise = (value: [number, number, number]) => {
      const length = Math.hypot(...value);
      return [value[0] / length, value[1] / length, value[2] / length] as const;
    };
    const palaeoCentroid = normalise(centroid);
    const presentCentroid = normalise(reference);
    prepared.release();

    // Where Cao 2024 itself puts that present-day ground at 220 Ma.
    const present = await runtime.request(0).prepared;
    const resource = createCaoFoundationGeometryResource(present, PICK_LIMITS);
    const pick = chartPickStateFromMotionFrame(await runtime.evaluateMotion(0));
    const ray = toRenderer(presentCentroid);
    const hit = intersectCaoFoundationSurface(resource,
      { chartPoses: pick.chartPoses, chartActive: pick.chartActive },
      [ray[0] * 3, ray[1] * 3, ray[2] * 3], [-ray[0], -ray[1], -ray[2]]);
    expect(hit).not.toBeNull();
    const revision = await runtime.request(220).prepared;
    const pose = revision.resolveAddress(
      revision.addressForChartDirection(hit!.chartIndex, presentCentroid));
    expect(pose.support.kind).toBe("supported");
    const distance = separationKm(palaeoCentroid, pose.direction!);
    expect(distance, `Lhasa palaeo centroid is ${distance.toFixed(3)} km from the Cao 2024 chart`)
      .toBeLessThan(500);
    revision.release();
    present.release();
    resource.dispose();
    runtime.dispose();
  }, 120_000);

  it("keeps a plate-315 landmass piece on the restored North Sea shelf at 270 Ma", async () => {
    // `entries_covering()` in the correction emitter skips restoration entries,
    // so without the explicit restoration branch of `palaeo-binding-entry-v1` a
    // piece on 315 would take native motion and sit about 70 km from the UK
    // block the restoration moved. The comparison is against one named native
    // carrier rather than whatever the pick returns at each vertex: Cao 2024
    // draws the Baltica-side continental outline across the same ground, and
    // that chart is not on 315 and is not restored.
    const runtime = new CaoReconstructionRuntime(await packageManifest(), fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(270).prepared;
    expect(prepared.intervalId).toBe("285-269");
    const { copy, vertex } = posedVertices(prepared, 0);
    const site = lonLat(-2.24, 53.48);
    let probe: ReturnType<typeof vertex> | null = null;
    let nearestKm = Infinity;
    for (let index = 0; index < copy.referenceDirections.length / 3; index += 1) {
      const sample = vertex(index);
      if (!sample.chart.fragmentOrCohortId.endsWith(":315")) continue;
      if (sample.chart.support.kind !== "supported") continue;
      const distance = separationKm(sample.reference, site);
      if (distance >= nearestKm) continue;
      nearestKm = distance;
      probe = sample;
    }
    expect(probe, "a landmass piece on North Sea partition 315").not.toBeNull();
    expect(nearestKm).toBeLessThan(25);
    // The restoration branch was taken, so the piece carries flag bit 4.
    expect(probe!.chart.flags & 4).toBe(4);
    prepared.release();

    const present = await runtime.request(0).prepared;
    const resource = createCaoFoundationGeometryResource(present, PICK_LIMITS);
    const pick = chartPickStateFromMotionFrame(await runtime.evaluateMotion(0));
    const ray = toRenderer(site);
    const carrier = intersectCaoFoundationSurface(resource,
      { chartPoses: pick.chartPoses, chartActive: pick.chartActive },
      [ray[0] * 3, ray[1] * 3, ray[2] * 3], [-ray[0], -ray[1], -ray[2]]);
    expect(carrier, "a native Cao 2024 chart over the UK block").not.toBeNull();
    const revision = await runtime.request(270).prepared;
    const pose = revision.resolveAddress(
      revision.addressForChartDirection(carrier!.chartIndex, probe!.reference));
    expect(pose.support.kind).toBe("supported");
    const distance = separationKm(probe!.posed, pose.direction!);
    expect(distance, `plate-315 palaeo piece is ${distance.toFixed(2)} km from the restored shelf`)
      .toBeLessThan(5);
    revision.release();
    present.release();
    resource.dispose();
    runtime.dispose();
  }, 120_000);

  it("fetches one requested-age motion tile when both chains want the same window", async () => {
    // Phase 3 note (d): the palaeo chain runs its own palette requests, so a
    // palaeo pose asked for before any native request in the same window used to
    // start a second fetch of the tile the foreground chain was about to load.
    const fetched: string[] = [];
    const counting: StaticAssetFetcher = async (url, signal) => {
      fetched.push(url);
      return fetcher(url, signal);
    };
    const runtime = new CaoReconstructionRuntime(await packageManifest(), counting);
    runtime.setPalaeoCoastlinesEnabled(true);
    const [prepared] = await Promise.all([
      runtime.requestPalaeoInterval(90).prepared,
      runtime.request(90).prepared,
    ]);
    const tiles = fetched.filter((url) => url.startsWith("motion-tiles/tile-"));
    expect(tiles.length, `tiles fetched: ${tiles.join(", ")}`).toBe(1);
    prepared.release();
    runtime.dispose();
  }, 120_000);

  it("draws the mountain class where Cao maps mountain and nowhere else", async () => {
    // The class the build withheld until 2026-09-15. Both witnesses are ground
    // Cao classes as mountain at 179-166 Ma and as neither landmass nor shallow
    // marine, so before the class shipped the browser painted them in the crust
    // blue the map key defines as "depth unmapped".
    const catalog = await classCatalog("m");
    expect(catalog.class).toBe("m");
    expect(catalog.className).toBe("mountain");
    expect(catalog.appearance).toBe("palaeo-mountain");
    expect(catalog.intervals).toHaveLength(25);
    const record = catalog.intervals.find((interval) => interval.intervalId === "179-166")!;
    const prepared = preparePalaeoRingPayload(await payloadBuffer("m", record.payload.url),
      { maxEdgeDegrees: 1, maxVertices: 380_000, maxTriangles: 580_000 });
    const { referenceDirections, indices } = prepared.geometry;
    const covers = (longitude: number, latitude: number) => {
      const direction = lonLat(longitude, latitude);
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const corner = (slot: number) => {
          const base = indices[triangle + slot]! * 3;
          return [referenceDirections[base]!, referenceDirections[base + 1]!,
            referenceDirections[base + 2]!];
        };
        if (insideSphericalTriangle(direction, corner(0), corner(1), corner(2))) return true;
      }
      return false;
    };
    expect(covers(-3, 58.8), "Scottish Highlands / Pentland Firth").toBe(true);
    expect(covers(4.5, 60.5), "Horda Platform").toBe(true);
    // The Viking Graben axis between them is not mountain in any Cao interval.
    expect(covers(2, 60.5), "Viking Graben axis").toBe(false);
    // And the class draws nothing over open ocean it never mapped.
    expect(covers(-140, -30), "central South Pacific").toBe(false);
  }, 120_000);

  it("covers the ground a Gondwana piece encloses and nothing outside it", async () => {
    // Earcut diagonals across a continent-sized piece become long great-circle
    // edges; the 1 degree refinement must leave the interior covered without
    // spilling a triangle into the open ocean beside it.
    const catalog = await classCatalog("lm");
    const record = catalog.intervals.find((interval) => interval.intervalId === "248-224")!;
    const prepared = preparePalaeoRingPayload(await payloadBuffer("lm", record.payload.url),
      { maxEdgeDegrees: 1, maxVertices: 300_000, maxTriangles: 480_000 });
    const { referenceDirections, indices } = prepared.geometry;
    const covers = (longitude: number, latitude: number) => {
      const direction = lonLat(longitude, latitude);
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const corner = (slot: number) => {
          const base = indices[triangle + slot]! * 3;
          return [referenceDirections[base]!, referenceDirections[base + 1]!,
            referenceDirections[base + 2]!];
        };
        if (insideSphericalTriangle(direction, corner(0), corner(1), corner(2))) return true;
      }
      return false;
    };
    // East Antarctica and the Australian craton are mapped landmass in the
    // 248-224 Ma interval; the South Pacific and the Southern Ocean are not.
    expect(covers(75, -70), "East Antarctica").toBe(true);
    expect(covers(133, -24), "central Australia").toBe(true);
    expect(covers(-140, -30), "central South Pacific").toBe(false);
    expect(covers(0, -60), "Southern Ocean off Queen Maud Land").toBe(false);
  }, 120_000);
});

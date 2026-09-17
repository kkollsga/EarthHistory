import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { decideIntervalRequest } from "./intervalSettle";
import { chartPickStateFromMotionFrame } from "./motionFrameV2";
import { CaoSurfaceResidencyStore, DEFAULT_SURFACE_RESIDENCY_POLICY, intervalUnit,
  loadVerifiedPalaeoClassCatalogs, palaeoWarmWindowIntervalIds, selectPalaeoIntervalForAge,
  type LoadedPalaeoClassCatalog,
  type LoadedPalaeoInterval, type SurfaceResidencyPolicy } from "./loaderV2";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import { validatePalaeoCoastlineAssets, type PalaeoCoastlineAssets,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import { createPalaeoTriangulationRunner } from "./palaeoTriangulate";
import { evaluateCaoPalaeoIntervalFrame, palaeoCoastlineEvidenceSummary,
  type CaoPalaeoIntervalFrame, type PreparedCaoPalaeoInterval } from "./palaeoIntervalV2";
import {
  PALAEO_OUTLINE_TONE_LAND,
  PALAEO_OUTLINE_TONE_SHALLOW,
  decodePalaeoOutlineToneTables,
  encodePalaeoOutlineToneTables,
  palaeoOutlineToneCounts,
  type PalaeoOutlineToneClass,
} from "./outlineTones";
import type { PreparedPaletteEntry } from "./palette";
import type { PalaeoCoastlineClassCatalog } from "./palaeoRings";
import { encodePalaeoRingPayload, palaeoClassCatalogDocumentFixture, palaeoClassCatalogFixture,
  type LonLat } from "./fixtures/palaeoRingFixtures";

const root = resolve("public/data/reconstruction/cao-v2.4");
const packageFetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const sha256 = (bytes: ArrayBuffer) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

const CATALOG_URL = "palaeo/lm/palaeo-lm-catalog.json";
/** The plate the fixture bindings ride; the real package palette poses it at every age. */
const BINDING_PLATE_ID = 101;

/** Three abutting map intervals of one class, with one off-schedule piece in the oldest. */
const INTERVALS = [
  { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380 },
  { intervalId: "380-360", intervalIndex: 1, fromAgeMa: 380, toAgeMa: 360 },
  { intervalId: "360-340", intervalIndex: 2, fromAgeMa: 360, toAgeMa: 340 },
] as const;

/**
 * The shipped schedule's padded bounds: an interval's exclusive young bound is
 * written 0.01 Ma above its neighbour's inclusive old bound, so the ages in
 * `(380, 380.01]` are covered by neither and the selector's seam fallback
 * answers the older map. `INTERVALS` above abuts exactly and has no seam.
 */
const SEAM_INTERVALS = [
  { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380.01 },
  { intervalId: "380-360", intervalIndex: 1, fromAgeMa: 380, toAgeMa: 360.01 },
] as const;

type IntervalSpec = { readonly intervalId: string; readonly intervalIndex: number;
  readonly fromAgeMa: number; readonly toAgeMa: number };

/**
 * One lifecycle per interval, plus the off-schedule piece the first interval
 * ships. `payloadFor` indexes into this, so the two must be generated from the
 * same schedule or a longer one would pose its pieces against another's dates.
 */
function lifecyclesFor(intervals: readonly IntervalSpec[]) {
  return [
    { youngestExclusiveMa: intervals[0]!.toAgeMa, oldestMa: intervals[0]!.fromAgeMa },
    // Off the published schedule: shipped inside the first interval with its own dates.
    { youngestExclusiveMa: 395, oldestMa: 400 },
    ...intervals.slice(1).map((interval) =>
      ({ youngestExclusiveMa: interval.toAgeMa, oldestMa: interval.fromAgeMa })),
  ];
}

const LIFECYCLES = lifecyclesFor(INTERVALS);

/**
 * A six-interval schedule for the background scheduler, whose order and pauses
 * are only visible where the walk has more than one interval left to take.
 */
const LONG_INTERVALS: readonly IntervalSpec[] = [
  ...INTERVALS,
  { intervalId: "340-320", intervalIndex: 3, fromAgeMa: 340, toAgeMa: 320 },
  { intervalId: "320-300", intervalIndex: 4, fromAgeMa: 320, toAgeMa: 300 },
  { intervalId: "300-280", intervalIndex: 5, fromAgeMa: 300, toAgeMa: 280 },
];

const square = (west: number, south: number, size: number): readonly LonLat[] => [
  [west, south], [west + size, south], [west + size, south + size], [west, south + size],
];

function payloadFor(interval: IntervalSpec): ArrayBuffer {
  const lifecycleIndex = interval.intervalIndex === 0 ? 0 : interval.intervalIndex + 1;
  const pieces = [{ chartIndex: 0, lifecycleIndex, rings: [{ lonLat: square(0, 0, 3) }] }];
  if (interval.intervalIndex === 0) {
    pieces.push({ chartIndex: 0, lifecycleIndex: 1, rings: [{ lonLat: square(20, 10, 2) }] });
  }
  return encodePalaeoRingPayload({ surfaceClass: "lm", intervalIndex: interval.intervalIndex,
    fromAgeMa: interval.fromAgeMa, toAgeMa: interval.toAgeMa, pieces });
}

/**
 * Outline segments the fixture's tone tables describe. Small on purpose: the
 * decoder's own segment-count check is exercised in `outlineTones.test.ts`, and
 * what matters here is that the manifest's tone asset is a real EHPT payload
 * one table per compiled interval, so a runtime fetch can be verified end to
 * end rather than against a four-byte stub.
 */
const TONE_SEGMENT_COUNT = 8;

function toneTablesPayload(schedule: readonly IntervalSpec[] = INTERVALS): Uint8Array {
  // Table i marks segment i light, so a decode that read the wrong table is
  // visible in the counts rather than only in the bytes.
  return encodePalaeoOutlineToneTables(schedule.map((_, table) =>
    Array.from({ length: TONE_SEGMENT_COUNT }, (_unused, segment) =>
      (segment === table ? PALAEO_OUTLINE_TONE_SHALLOW
        : PALAEO_OUTLINE_TONE_LAND) as PalaeoOutlineToneClass)), TONE_SEGMENT_COUNT);
}

interface PalaeoFixture {
  readonly section: PalaeoCoastlineAssets;
  readonly catalog: PalaeoCoastlineClassCatalog;
  readonly assets: Map<string, ArrayBuffer>;
  readonly fetcher: StaticAssetFetcher;
  readonly requestedUrls: string[];
}

function palaeoFixture(
  overrides: Partial<PalaeoCoastlineAssets["reservation"]> = {},
  schedule: readonly IntervalSpec[] = INTERVALS,
): PalaeoFixture {
  const assets = new Map<string, ArrayBuffer>();
  const intervals = schedule.map((interval) => {
    const payload = payloadFor(interval);
    const url = `palaeo-lm-${interval.intervalId}.ehpr`;
    assets.set(`palaeo/lm/${url}`, payload);
    const decodedPieces = interval.intervalIndex === 0 ? 2 : 1;
    return { ...interval, url, bytes: payload.byteLength, sha256: sha256(payload),
      pieces: decodedPieces, rings: decodedPieces, vertices: decodedPieces * 4 };
  });
  const catalogOptions = { bindingPlateId: BINDING_PLATE_ID, lifecycles: lifecyclesFor(schedule),
    intervals };
  const catalog = palaeoClassCatalogFixture(catalogOptions);
  const catalogBytes = new TextEncoder()
    .encode(JSON.stringify(palaeoClassCatalogDocumentFixture(catalogOptions))).buffer as ArrayBuffer;
  assets.set(CATALOG_URL, catalogBytes);
  const toneCatalog = new TextEncoder().encode("{}").buffer as ArrayBuffer;
  const tones = toneTablesPayload(schedule);
  const toneBinary = tones.buffer.slice(tones.byteOffset,
    tones.byteOffset + tones.byteLength) as ArrayBuffer;
  assets.set("palaeo/outline-tones.json", toneCatalog);
  assets.set("palaeo/outline-tones.ehpt", toneBinary);
  const asset = (url: string) => ({ url, bytes: assets.get(url)!.byteLength,
    sha256: sha256(assets.get(url)!) });
  const section: PalaeoCoastlineAssets = {
    id: "palaeo-coastlines-cao2017-v1",
    ageDomainMa: { youngest: 2.01, oldest: 402 },
    classes: [{ surfaceClass: "lm", catalog: asset(CATALOG_URL), baseColorRgb: [0.42, 0.37, 0.3] }],
    outlineTones: { catalog: asset("palaeo/outline-tones.json"),
      binary: asset("palaeo/outline-tones.ehpt") },
    reservation: { maxResidentSourceBytes: 4 * 1024 * 1024, maxIntervalVertices: 170_000,
      maxIntervalTriangles: 300_000, maxEdgeDegrees: 1, ...overrides },
  };
  const requestedUrls: string[] = [];
  const fetcher: StaticAssetFetcher = async (url, signal, options) => {
    const path = packageAssetPath(url);
    requestedUrls.push(path);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const bytes = assets.get(path);
    return bytes ? bytes.slice(0) : packageFetcher(url, signal, options);
  };
  return { section, catalog, assets, fetcher, requestedUrls };
}

async function loadedCatalogs(fixture: PalaeoFixture): Promise<readonly LoadedPalaeoClassCatalog[]> {
  return loadVerifiedPalaeoClassCatalogs(fixture.section, fixture.fetcher);
}

async function manifestWithPalaeo(section: PalaeoCoastlineAssets):
Promise<ReconstructionPackageManifestV2> {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
  return { ...manifest, palaeoCoastlines: section };
}

/**
 * The residency store with only its palaeo half attached. The interval cache
 * lives on `CaoSurfaceResidencyStore`, so the tests below drive it through the
 * unit API the runtime uses rather than through a store of its own.
 */
async function intervalResidency(
  section: PalaeoCoastlineAssets,
  catalogs: readonly LoadedPalaeoClassCatalog[],
  fetcher: StaticAssetFetcher,
  runner: ReturnType<typeof createPalaeoTriangulationRunner>,
  policy: SurfaceResidencyPolicy = DEFAULT_SURFACE_RESIDENCY_POLICY,
): Promise<CaoSurfaceResidencyStore> {
  const store = new CaoSurfaceResidencyStore(await manifestWithPalaeo(section), fetcher, policy);
  store.attachIntervals(section, catalogs, runner);
  return store;
}

describe("palaeo-coastline manifest section", () => {
  const domain = { youngest: 0, oldest: 1_800 };
  const corrupt = (mutate: (section: PalaeoCoastlineAssets) => void): PalaeoCoastlineAssets => {
    const section = structuredClone(palaeoFixture().section);
    mutate(section);
    return section;
  };

  it("accepts the declared class, tone and reservation shape", () => {
    expect(() => validatePalaeoCoastlineAssets(palaeoFixture().section, domain)).not.toThrow();
  });

  it("refuses a missing id, a domain outside the package, or a duplicated class", () => {
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section, { id: "" })), domain)).toThrow(/manifest section/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section, { ageDomainMa: { youngest: 2.01, oldest: 2_000 } })), domain))
      .toThrow(/manifest section/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section, { classes: [...section.classes, ...section.classes] })), domain))
      .toThrow(/class asset/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.classes[0]!, { baseColorRgb: [0.4, 0.3] })), domain))
      .toThrow(/class asset/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.outlineTones, { binary: { url: "", bytes: 0, sha256: "x" } })), domain))
      .toThrow(/manifest section/);
  });

  it("refuses a reservation above the renderer instance or the chord-sag bound", () => {
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.reservation, { maxEdgeDegrees: 1.28 })), domain)).toThrow(/reservation/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.reservation, { maxIntervalTriangles: 760_001 })), domain))
      .toThrow(/reservation/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.reservation, { maxResidentSourceBytes: 0 })), domain))
      .toThrow(/reservation/);
  });
});

describe("palaeo-coastline interval store", () => {
  it("keeps the current interval and both neighbours resident", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(fixture.section, await loadedCatalogs(fixture),
      fixture.fetcher, runner);
    store.noteCurrentAge(370);
    await store.load(intervalUnit("380-360"));
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("360-340"));
    // Three, not two: a crossing in either direction must find its neighbour
    // already decoded, and a reversal must not have thrown one away.
    expect(store.intervalLedger.residentCount).toBe(3);
    expect(store.intervalLedger.maximumResidentCount).toBe(3);
    const before = fixture.requestedUrls.length;
    expect(store.resident(intervalUnit("402-380"))).not.toBeNull();
    expect(store.resident(intervalUnit("360-340"))).not.toBeNull();
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("360-340"));
    expect(fixture.requestedUrls.length).toBe(before);
    store.dispose();
    runner.dispose();
  });

  /** The neighbour cache the prepared policy falls back to over its ceiling. */
  const NEAREST_POLICY: SurfaceResidencyPolicy =
    { ...DEFAULT_SURFACE_RESIDENCY_POLICY, residentIntervals: "nearest" };

  it("evicts the interval farthest from the current age, not the least recently read", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const twoIntervals = fixture.catalog.intervals[0]!.payload.bytes
      + fixture.catalog.intervals[1]!.payload.bytes;
    const store = await intervalResidency(
      { ...fixture.section, reservation: { ...fixture.section.reservation,
        maxResidentSourceBytes: twoIntervals } },
      await loadedCatalogs(fixture), fixture.fetcher, runner, NEAREST_POLICY);
    // 395 Ma sits inside 402-380. A least-recently-used order would evict that
    // interval, which is the one being drawn; the distance order evicts the far
    // 360-340 instead.
    store.noteCurrentAge(395);
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("380-360"));
    await store.load(intervalUnit("360-340"));
    expect(store.intervalLedger.residentCount).toBe(2);
    expect(store.resident(intervalUnit("402-380"))).not.toBeNull();
    expect(store.resident(intervalUnit("380-360"))).not.toBeNull();
    expect(store.resident(intervalUnit("360-340"))).toBeNull();
    store.dispose();
    runner.dispose();
  });

  it("bounds resident bytes as well as resident count", async () => {
    const fixture = palaeoFixture();
    const oneInterval = fixture.catalog.intervals[0]!.payload.bytes;
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(
      { ...fixture.section, reservation: { ...fixture.section.reservation,
        maxResidentSourceBytes: oneInterval } },
      await loadedCatalogs(fixture), fixture.fetcher, runner, NEAREST_POLICY);
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("380-360"));
    expect(store.intervalLedger.residentCount).toBe(1);
    expect(store.intervalLedger.residentSourceBytes).toBeLessThanOrEqual(oneInterval);
    store.dispose();
    runner.dispose();
  });

  it("keeps every prepared interval resident while the ceiling holds", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const largest = Math.max(...fixture.catalog.intervals.map((interval) => interval.payload.bytes));
    // The package reservation would bound the neighbour cache to one interval.
    // The prepared policy is not bounded by it: what a crossing needs decoded
    // is every interval, and the ceiling is what says how many that may be.
    const store = await intervalResidency(
      { ...fixture.section, reservation: { ...fixture.section.reservation,
        maxResidentSourceBytes: largest } },
      await loadedCatalogs(fixture), fixture.fetcher, runner);
    store.noteCurrentAge(395);
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("380-360"));
    await store.load(intervalUnit("360-340"));
    expect(store.intervalLedger.residentCount).toBe(3);
    expect(store.intervalLedger.maximumPreparedSourceBytes).toBe(64 * 1024 * 1024);
    store.dispose();
    runner.dispose();
  });

  it("trims to the prepared ceiling instead of collapsing to the neighbour cache", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const largest = Math.max(...fixture.catalog.intervals.map((interval) => interval.payload.bytes));
    const store = await intervalResidency(
      { ...fixture.section, reservation: { ...fixture.section.reservation,
        maxResidentSourceBytes: largest } },
      await loadedCatalogs(fixture), fixture.fetcher, runner,
      { ...DEFAULT_SURFACE_RESIDENCY_POLICY, maxPreparedBytes: largest });
    store.noteCurrentAge(395);
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("380-360"));
    await store.load(intervalUnit("360-340"));
    // Contract change: over the ceiling the store used to hand the whole set to
    // the neighbour cache. It now drops the farthest interval by age until the
    // set fits the ceiling again. Here the ceiling is one payload's worth of
    // bytes against a retained cost many times that, so the set trims to the
    // one interval being drawn either way; what the ceiling affords is what
    // survives, not a fixed three.
    expect(store.intervalLedger.residentCount).toBe(1);
    expect(store.resident(intervalUnit("402-380"))).not.toBeNull();
    store.dispose();
    runner.dispose();
  });

  it("counts retained typed-array bytes, not the payload file's", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(fixture.section, await loadedCatalogs(fixture),
      fixture.fetcher, runner);
    const loaded = await store.load(intervalUnit("402-380"));
    const interval = loaded.value as LoadedPalaeoInterval;
    const geometryBytes = interval.classes.reduce((sum, entry) => sum
      + entry.geometry.referenceDirections.byteLength + entry.geometry.indices.byteLength
      + (entry.geometry.pieceIndices?.byteLength ?? 0)
      + (entry.geometry.seamIds?.byteLength ?? 0), 0);
    // The payload file is a fraction of what the decoded interval holds; the
    // ledger the prepared ceiling reads must be the larger figure or the
    // ceiling bounds nothing.
    expect(geometryBytes).toBeGreaterThan(0);
    expect(store.intervalLedger.residentRetainedBytes)
      .toBe(store.intervalLedger.residentSourceBytes + geometryBytes);
    expect(store.intervalLedger.residentRetainedBytes)
      .toBeGreaterThan(store.intervalLedger.residentSourceBytes);
    store.dispose();
    runner.dispose();
  });

  it("holds what the prepared ceiling affords, above and below three", async () => {
    const fixture = palaeoFixture({}, LONG_INTERVALS);
    const catalogs = await loadedCatalogs(fixture);
    const runner = createPalaeoTriangulationRunner();
    const probe = await intervalResidency(fixture.section, catalogs, fixture.fetcher, runner);
    await probe.load(intervalUnit("402-380"));
    const oneInterval = probe.intervalLedger.residentRetainedBytes;
    probe.dispose();
    // Four affordable intervals: more than the neighbour cache's three, which
    // is what the fallback used to cut the prepared set down to.
    const store = await intervalResidency(fixture.section, catalogs, fixture.fetcher, runner,
      { ...DEFAULT_SURFACE_RESIDENCY_POLICY, maxPreparedBytes: oneInterval * 4 });
    store.noteCurrentAge(395);
    for (const id of ["402-380", "380-360", "360-340", "340-320", "320-300"]) {
      await store.load(intervalUnit(id));
    }
    expect(store.intervalLedger.residentCount).toBe(4);
    expect(store.intervalLedger.residentRetainedBytes).toBeLessThanOrEqual(oneInterval * 4);
    // Farthest from 395 Ma is the one that went.
    expect(store.resident(intervalUnit("320-300"))).toBeNull();
    expect(store.resident(intervalUnit("402-380"))).not.toBeNull();
    store.dispose();
    runner.dispose();
  });

  it("refuses an interval larger than the whole resident bound", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(
      { ...fixture.section, reservation: { ...fixture.section.reservation, maxResidentSourceBytes: 1 } },
      await loadedCatalogs(fixture), fixture.fetcher, runner);
    await expect(store.load(intervalUnit("402-380"))).rejects.toThrow(/resident byte bound/);
    expect(store.intervalLedger.residentCount).toBe(0);
    store.dispose();
    runner.dispose();
  });

  it("aborts per entry and holds at most two unsettled loads", async () => {
    const fixture = palaeoFixture();
    const gates = new Map<string, () => void>();
    const gatedFetcher: StaticAssetFetcher = async (url, signal, options) => {
      const path = packageAssetPath(url);
      if (path.endsWith(".ehpr")) {
        // A fetcher that ignores its abort signal must still not pin an entry.
        await new Promise<void>((release) => gates.set(path, release));
      }
      return fixture.fetcher(url, signal, options);
    };
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(fixture.section, await loadedCatalogs(fixture),
      gatedFetcher, runner);
    const first = new AbortController();
    const pendingFirst = store.load(intervalUnit("402-380"), first.signal);
    const pendingSecond = store.load(intervalUnit("380-360"));
    await new Promise((settle) => setTimeout(settle, 10));
    expect(store.intervalLedger.pendingCount).toBe(2);
    expect(store.intervalLedger.pendingReservedSourceBytes).toBeGreaterThan(0);
    first.abort();
    await expect(pendingFirst).rejects.toThrow(/aborted/);
    for (const release of gates.values()) release();
    await pendingSecond;
    expect(store.intervalLedger.residentCount).toBe(1);
    expect(store.intervalLedger.pendingCount).toBe(0);
    await expect(store.load(intervalUnit("402-380"), AbortSignal.abort())).rejects.toThrow(/aborted/);
    store.dispose();
    await expect(store.load(intervalUnit("360-340"))).rejects.toThrow(/disposed/);
    runner.dispose();
  });

  it("refuses a payload whose bytes are not the ones the catalog indexed", async () => {
    const fixture = palaeoFixture();
    const corruptFetcher: StaticAssetFetcher = async (url, signal, options) => {
      const bytes = await fixture.fetcher(url, signal, options);
      if (packageAssetPath(url).endsWith(".ehpr")) new Uint8Array(bytes)[40] ^= 0xff;
      return bytes;
    };
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(fixture.section, await loadedCatalogs(fixture),
      corruptFetcher, runner);
    await expect(store.load(intervalUnit("402-380"))).rejects.toThrow(/verification failed/);
    store.dispose();
    runner.dispose();
  });
});

describe("palaeo-coastline interval frame", () => {
  it("activates each piece on its own lifecycle, not on the payload's interval", async () => {
    const fixture = palaeoFixture();
    const catalogs = await loadedCatalogs(fixture);
    const runner = createPalaeoTriangulationRunner();
    const store = await intervalResidency(fixture.section, catalogs, fixture.fetcher, runner);
    const loaded = await store.load(intervalUnit("402-380"));
    const interval = loaded.value as LoadedPalaeoInterval;
    const entries = new Map<string, PreparedPaletteEntry>();
    // No palette entry resolves: every piece reports missing motion, not "active".
    const unposed = evaluateCaoPalaeoIntervalFrame(interval, entries, 398);
    expect(unposed.charts.map((chart) => chart.support.kind)).toEqual(["unsupported", "unsupported"]);
    const manifest = await manifestWithPalaeo(fixture.section);
    const runtime = new CaoReconstructionRuntime(manifest, fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const posed = await runtime.requestPalaeoInterval(398).prepared;
    expect(posed.charts).toHaveLength(2);
    expect(posed.charts.every((chart) => chart.support.kind === "supported")).toBe(true);
    expect(posed.activeChartCount).toBe(2);
    posed.release();
    // 390 Ma is inside the same payload, but the off-schedule piece ended at 395.
    const later = await runtime.requestPalaeoInterval(390).prepared;
    expect(later.intervalId).toBe("402-380");
    expect(later.charts.map((chart) => chart.support.kind)).toEqual(["supported", "inactive"]);
    expect(later.activeChartCount).toBe(1);
    // Static geometry is the interval's, so it does not change inside the interval.
    expect(later.batches[0]!.staticGeometryIdentity).toBe(posed.batches[0]!.staticGeometryIdentity);
    later.release();
    runtime.dispose();
    store.dispose();
    runner.dispose();
  });

  /**
   * A crossing into an already-prepared interval spent 55-65 ms turning it into
   * a publishable revision, and none of that work is a function of the age. The
   * identity strings, the frame scratch and the per-class batch descriptors —
   * `chartTriangleRanges` above all, one frozen object per piece — belong to
   * the resident interval. This is the assertion that they are built once:
   * every one of them comes back as the same instance, which is a stronger
   * statement than a call count because it also proves nothing was copied.
   */
  it("rebuilds only the age's half of a second request for the same interval", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const first = await runtime.requestPalaeoInterval(398).prepared;
    let macrotask = false;
    setTimeout(() => { macrotask = true; }, 0);
    const second = await runtime.requestPalaeoInterval(390).prepared;
    // Everything the request had to do, it did in microtasks: an interval this
    // runtime already holds never reaches a timer, a fetch or a worker.
    expect(macrotask).toBe(false);
    expect(second.intervalId).toBe(first.intervalId);

    // The descriptors: the same chart ranges and the same static geometry key.
    // The batch object itself is this revision's, because the released-lease
    // guard is, and it is the only per-request allocation a batch costs.
    expect(second.batches[0]!.chartTriangleRanges).toBe(first.batches[0]!.chartTriangleRanges);
    expect(second.batches[0]!.staticGeometryIdentity)
      .toBe(first.batches[0]!.staticGeometryIdentity);
    expect(second.batches[0]).not.toBe(first.batches[0]);
    expect(second.maximumEdgeDegrees).toBe(first.maximumEdgeDegrees);
    // The identity table: the evidence and surface-evidence records a chart
    // carries are the interval's own, not the age's.
    expect(second.charts[0]!.evidence).toBe(first.charts[0]!.evidence);
    expect(second.charts[0]!.surfaceEvidence).toBe(first.charts[0]!.surfaceEvidence);
    expect(second.charts[0]!.chartId).toBe(first.charts[0]!.chartId);
    // The frame scratch: two evaluations of the same interval write into one
    // set of chart objects and one palette buffer.
    const early = runtime.evaluatePalaeoMotionNow(396)!;
    const late = runtime.evaluatePalaeoMotionNow(392)!;
    expect(late.charts).toBe(early.charts);
    expect(late.paletteValues).toBe(early.paletteValues);

    // The age's half did move, and it is the half a publication reports.
    expect(second.requestedAgeMa).toBe(390);
    expect(second.activeChartCount).toBe(1);
    expect(first.activeChartCount).toBe(2);
    expect(second.identity).not.toBe(first.identity);

    // Releasing one revision's lease must not take the geometry the resident
    // interval still owns with it: the other revision of the same interval can
    // still copy it, and so can the member already on the GPU.
    first.release();
    expect(() => second.batches[0]!.createStaticGeometryCopy()).not.toThrow();
    expect(() => first.batches[0]!.createStaticGeometryCopy()).toThrow(/released/);
    second.release();
    runtime.dispose();
  });

  // Folded in from the deleted `palaeoPublication.test.ts`, which proved these
  // on the adapter that used to wrap an interval as a revision. The prepared
  // interval now states them itself, so they are asserted on the real one.
  it("states every absence a map interval has rather than leaving it to be inferred", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    expect(prepared.lineBatches).toEqual([]);
    expect(prepared.anchorIds).toEqual([]);
    expect(prepared.nativeBoundary).toMatchObject({ kind: "unavailable", reason: "source-absent" });
    expect(prepared.topologyOwnership).toMatchObject({ kind: "unavailable" });
    expect(prepared.materialCorrectionIdentity).toBeNull();
    expect(prepared.materialCorrections.qualifiedActiveCharts).toBe(0);
    // Every palaeo palette entry carries the same activation at both ends, so
    // the display fraction the renderer mixes with is a fixed 0, not a bracket.
    expect(prepared.display).toEqual({ youngerAgeMa: prepared.requestedAgeMa,
      olderAgeMa: prepared.requestedAgeMa, fraction: 0 });
    expect(prepared.resolveAnchor("anything")).toBeNull();
    expect(() => prepared.resolveAddress({} as never)).toThrow(/no material addresses/);
    expect(() => prepared.addressForChartDirection(0, [1, 0, 0])).toThrow(/no material addresses/);
    // The frame a scrub retargets with carries the same absence, so the renderer
    // is handed one shape whether it is publishing or re-posing.
    const frame = runtime.evaluatePalaeoMotionNow(390, "402-380")!;
    expect(frame.materialCorrections).toBe(prepared.materialCorrections);
    // One pose pair per chart, and the activation bit is the support verdict:
    // at 390 Ma the off-schedule piece has ended and is not drawn.
    const pick = chartPickStateFromMotionFrame(frame);
    expect(pick.chartPoses).toHaveLength(frame.charts.length * 8);
    expect([...pick.chartActive]).toEqual([1, 0]);
    prepared.release();
    runtime.dispose();
  });

  it("prepares the static-geometry copy the surface renderer consumes", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(370).prepared;
    expect(prepared.batches).toHaveLength(1);
    const batch = prepared.batches[0]!;
    expect(batch.batchId).toBe("palaeo-lm");
    expect(batch.surfaceAppearance).toBe("palaeo-land");
    expect(batch.nativePrecedence).toBe(false);
    expect(prepared.maximumEdgeDegrees).toBeLessThanOrEqual(1);
    const copy = batch.createStaticGeometryCopy();
    expect(copy.referenceDirections).toHaveLength(batch.vertexCount * 3);
    expect(copy.indices).toHaveLength(batch.triangleCount * 3);
    // Every palaeo vertex is its own seam and the renderer uploads none of
    // them, so the copy carries no seam-id array and the ledger counts none.
    expect(copy.seamIds).toBeNull();
    expect(copy.preparedEntryIndices).toHaveLength(batch.vertexCount);
    expect(copy.materialChartIndices).toHaveLength(batch.vertexCount);
    const bytes = [copy.referenceDirections, copy.indices, copy.preparedEntryIndices,
      copy.materialChartIndices].reduce((sum, array) => sum + array.byteLength, 0);
    expect(bytes).toBe(batch.staticGeometryBytes);
    for (let vertex = 0; vertex < batch.vertexCount; vertex += 1) {
      expect(Math.abs(Math.hypot(copy.referenceDirections[vertex * 3]!,
        copy.referenceDirections[vertex * 3 + 1]!, copy.referenceDirections[vertex * 3 + 2]!) - 1))
        .toBeLessThan(2e-6);
      expect(copy.preparedEntryIndices[vertex]!).toBeLessThan(prepared.motionPalette.entryCount);
    }
    for (let triangle = 0; triangle < batch.triangleCount; triangle += 1) {
      const owner = copy.materialChartIndices[copy.indices[triangle * 3]!];
      expect(copy.materialChartIndices[copy.indices[triangle * 3 + 1]!]).toBe(owner);
      expect(copy.materialChartIndices[copy.indices[triangle * 3 + 2]!]).toBe(owner);
    }
    // One buffer, not two: for a palaeo batch a piece is a chart and a palette
    // entry at once, so the material chart index and the prepared entry index
    // are the same number per vertex.
    expect(copy.materialChartIndices).toBe(copy.preparedEntryIndices);
    // A second copy of the same batch allocates nothing at all: the reference
    // directions and triangle indices are the resident interval's own arrays,
    // transferred out of the worker, and the entry indices are built once per
    // resident class geometry and cached against it.
    const again = batch.createStaticGeometryCopy();
    expect(again.referenceDirections).toBe(copy.referenceDirections);
    expect(again.indices).toBe(copy.indices);
    expect(again.preparedEntryIndices).toBe(copy.preparedEntryIndices);
    // The whole main-thread allocation a crossing pays for this batch is that
    // one index array — under a fifth of the bytes the copy used to duplicate.
    expect(copy.preparedEntryIndices.byteLength * 5).toBeLessThanOrEqual(batch.staticGeometryBytes);
    const covered = prepared.batches.flatMap((entry) => entry.chartTriangleRanges)
      .reduce((sum, range) => sum + range.triangleCount, 0);
    expect(covered).toBe(batch.triangleCount);
    expect(prepared.motionPalette.createValuesCopy()).toHaveLength(prepared.charts.length * 11);
    // The lease contract, unchanged by the descriptor being shared: releasing
    // this revision stops *this* revision reading the geometry. It does not
    // destroy the arrays — the resident interval still owns them, and another
    // revision of the same interval reads them through its own guard — which is
    // what the test above asserts from the other side.
    prepared.release();
    expect(() => batch.createStaticGeometryCopy()).toThrow(/released/);
    runtime.dispose();
  });
});

describe("palaeo-coastline runtime requests", () => {
  it("counts its own leases and refuses a third outstanding interval", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    expect(runtime.palaeoCoastlinesEnabled).toBe(true);
    const first = await runtime.requestPalaeoInterval(390).prepared;
    const second = await runtime.requestPalaeoInterval(370).prepared;
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(2);
    expect(() => runtime.requestPalaeoInterval(350)).toThrow(/release a palaeo-coastline interval/);
    first.release();
    second.release();
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    runtime.dispose();
  });

  it("aborts a superseded interval request and keeps its lease count at zero", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    // First request resolves the catalogs so the second knows which interval it wants.
    (await runtime.requestPalaeoInterval(390).prepared).release();
    const stale = runtime.requestPalaeoInterval(390);
    const fresh = runtime.requestPalaeoInterval(370);
    await expect(stale.prepared).rejects.toMatchObject({ name: "AbortError" });
    expect(stale.signal.aborted).toBe(true);
    const prepared = await fresh.prepared;
    expect(prepared.intervalId).toBe("380-360");
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(1);
    prepared.release();
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    runtime.dispose();
  });

  it("keeps a pending load alive when the new age is inside the same interval", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    // The first request resolves the catalogs so the next two know their interval.
    (await runtime.requestPalaeoInterval(398).prepared).release();
    runtime.setPalaeoCoastlinesEnabled(false);
    runtime.setPalaeoCoastlinesEnabled(true);
    const payloadFetches = () => fixture.requestedUrls.filter((url) => url.endsWith(".ehpr")).length;
    const before = payloadFetches();
    const first = runtime.requestPalaeoInterval(396);
    const second = runtime.requestPalaeoInterval(392);
    // Only the superseded revision is stale; its transfer keeps running, so the
    // newer age is served from the same single fetch.
    expect(first.signal.aborted).toBe(false);
    await expect(first.prepared).rejects.toMatchObject({ name: "AbortError" });
    const later = await second.prepared;
    expect(later.intervalId).toBe("402-380");
    expect(payloadFetches() - before).toBe(1);
    later.release();

    // A different interval is a different load, so the superseded one is aborted.
    const stale = runtime.requestPalaeoInterval(396);
    const elsewhere = runtime.requestPalaeoInterval(350);
    expect(stale.signal.aborted).toBe(true);
    await expect(stale.prepared).rejects.toMatchObject({ name: "AbortError" });
    (await elsewhere.prepared).release();
    runtime.dispose();
  });

  it("aborts in flight work and frees every palaeo byte when the mode is turned off", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const pending = runtime.requestPalaeoInterval(390);
    runtime.setPalaeoCoastlinesEnabled(false);
    await expect(pending.prepared).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.palaeoCoastlinesEnabled).toBe(false);
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBe(0);
    expect(runtime.ledger.palaeo.intervalStore.residentCount).toBe(0);
    expect(() => runtime.requestPalaeoInterval(390)).toThrow(/mode is disabled/);
    runtime.dispose();
  });

  it("releases a held interval when the mode is turned off under it", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(1);
    runtime.setPalaeoCoastlinesEnabled(false);
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    expect(() => prepared.batches[0]!.createStaticGeometryCopy()).toThrow(/released/);
    runtime.dispose();
  });

  it("refuses an age outside the published map intervals and a package without the section", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    expect(() => runtime.requestPalaeoInterval(0)).toThrow(/outside the palaeo-coastline domain/);
    expect(() => runtime.requestPalaeoInterval(500)).toThrow(/outside the palaeo-coastline domain/);
    // Inside the declared domain but past the compiled intervals of this fixture.
    await expect(runtime.requestPalaeoInterval(100).prepared).rejects.toThrow(/no palaeo-coastline interval/);
    runtime.dispose();
    // A build compiled without the Cao 2017 charts: the section is absent.
    const { palaeoCoastlines: _shipped, ...manifest } = JSON.parse(
      await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const bare = new CaoReconstructionRuntime(manifest, packageFetcher);
    expect(() => bare.setPalaeoCoastlinesEnabled(true)).toThrow(/no palaeo-coastline section/);
    expect(() => bare.requestPalaeoInterval(390)).toThrow(/no palaeo-coastline section/);
    bare.dispose();
  });

  it("fetches no palaeo bytes while the mode is off and leaves the native request untouched", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    const native = await runtime.request(12).prepared;
    expect(fixture.requestedUrls.some((url) => url.startsWith("palaeo/"))).toBe(false);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBe(0);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    expect(fixture.requestedUrls).toContain(CATALOG_URL);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBeGreaterThan(0);
    // The native lease and its payload survive the palaeo request beside it.
    expect(runtime.ledger.preparedLeaseCount).toBe(1);
    expect(native.batches[0]!.createStaticGeometryCopy().referenceDirections.length)
      .toBeGreaterThan(0);
    prepared.release();
    native.release();
    runtime.dispose();
  });

  it("warms an interval without taking a lease and never reports its own failure", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    await runtime.prefetchPalaeoInterval(390);
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    expect(runtime.ledger.palaeo.intervalStore.residentCount).toBe(1);
    const before = fixture.requestedUrls.length;
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    expect(fixture.requestedUrls.slice(before).filter((url) => url.endsWith(".ehpr"))).toHaveLength(0);
    prepared.release();
    // An age with no interval, and a disabled mode, both stay silent.
    await expect(runtime.prefetchPalaeoInterval(100)).resolves.toBeUndefined();
    runtime.setPalaeoCoastlinesEnabled(false);
    await expect(runtime.prefetchPalaeoInterval(390)).resolves.toBeUndefined();
    runtime.dispose();
  });

  it("selects the covering interval from the loaded class catalogs", async () => {
    const fixture = palaeoFixture();
    const catalogs = await loadedCatalogs(fixture);
    expect(selectPalaeoIntervalForAge(catalogs, 402)?.intervalId).toBe("402-380");
    expect(selectPalaeoIntervalForAge(catalogs, 380)?.intervalId).toBe("380-360");
    expect(selectPalaeoIntervalForAge(catalogs, 340)).toBeNull();
    expect(selectPalaeoIntervalForAge([], 380)).toBeNull();
  });
});

describe("palaeo-coastline manifest availability and the assets one enablement fetches", () => {
  it("reports a manifest without the section unavailable and fetches nothing palaeo", async () => {
    const fixture = palaeoFixture();
    // The published package now ships the Cao 2017 charts, so the unavailable
    // case is the section removed: a build compiled without them, which the
    // layer control must still disable rather than fall back from.
    const { palaeoCoastlines: shipped, ...manifest } = JSON.parse(
      await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    expect(shipped).toBeDefined();
    const runtime = new CaoReconstructionRuntime(manifest, fixture.fetcher);
    expect(runtime.palaeoCoastlineAssetsAvailable).toBe(false);
    expect(runtime.palaeoCoastlinesEnabled).toBe(false);
    // The layer control reads exactly this: unavailable, and disabled rather
    // than falling back, because there is nothing to fall back from.
    expect(() => runtime.setPalaeoCoastlinesEnabled(true)).toThrow(/no palaeo-coastline section/);
    await expect(runtime.loadPalaeoOutlineToneTables()).rejects.toThrow(/no palaeo-coastline section/);
    await expect(runtime.evaluatePalaeoMotion(390)).resolves.toBeNull();
    await expect(runtime.prefetchPalaeoInterval(390)).resolves.toBeUndefined();
    // A full native prepare beside it, to prove the absence is not just idleness.
    (await runtime.request(12).prepared).release();
    expect(fixture.requestedUrls.some((url) => url.startsWith("palaeo/"))).toBe(false);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBe(0);
    runtime.dispose();
  });

  it("fetches exactly the catalog, the active interval and the tone table once per enablement",
    async () => {
      const fixture = palaeoFixture();
      const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
        fixture.fetcher);
      expect(runtime.palaeoCoastlineAssetsAvailable).toBe(true);
      runtime.setPalaeoCoastlinesEnabled(true);
      const prepared = await runtime.requestPalaeoInterval(390).prepared;
      const tones = await runtime.loadPalaeoOutlineToneTables();
      const palaeoFetches = fixture.requestedUrls.filter((url) => url.startsWith("palaeo/"));
      expect(palaeoFetches).toEqual([
        CATALOG_URL,
        "palaeo/lm/palaeo-lm-402-380.ehpr",
        "palaeo/outline-tones.ehpt",
      ]);
      // The tone catalog JSON is declared but never needed at runtime: tables
      // are ordered oldest to youngest, so the interval index is the table.
      expect(palaeoFetches).not.toContain("palaeo/outline-tones.json");
      const decoded = decodePalaeoOutlineToneTables(tones, TONE_SEGMENT_COUNT);
      expect(decoded.tableCount).toBe(INTERVALS.length);
      expect(palaeoOutlineToneCounts(decoded, prepared.intervalIndex).lightSegments).toBe(1);
      // A second read inside the same enablement is the same bytes, not a second fetch.
      expect(await runtime.loadPalaeoOutlineToneTables()).toBe(tones);
      expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpt"))).toHaveLength(1);
      // And the ledger says them once, as a resident asset of the mode rather
      // than of an interval. The renderer's per-interval byte diagnostic used
      // to carry this constant, which made every interval look 311 KiB heavier
      // than its payload and made the shipped outline's fourfold growth read as
      // a per-interval regression.
      const toneBytes = runtime.ledger.palaeo.outlineToneSourceBytes;
      expect(toneBytes).toBe(tones.byteLength);
      const afterFirst = runtime.ledger.palaeo.totalSourceBytes;
      const second = await runtime.requestPalaeoInterval(370).prepared;
      expect(second.intervalId).not.toBe(prepared.intervalId);
      expect(runtime.ledger.palaeo.outlineToneSourceBytes).toBe(toneBytes);
      // The second interval adds its own payload and nothing else: no catalog,
      // no tone table, and no second copy of either in the total.
      expect(runtime.ledger.palaeo.totalSourceBytes)
        .toBe(afterFirst + second.activeSourceBytes);
      expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpt"))).toHaveLength(1);
      expect(fixture.requestedUrls.filter((url) => url === CATALOG_URL)).toHaveLength(1);
      second.release();
      prepared.release();
      // Turning the mode off drops them; turning it back on fetches once more.
      runtime.setPalaeoCoastlinesEnabled(false);
      runtime.setPalaeoCoastlinesEnabled(true);
      await runtime.loadPalaeoOutlineToneTables();
      expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpt"))).toHaveLength(2);
      await expect(runtime.loadPalaeoOutlineToneTables()).resolves.toBeInstanceOf(Uint8Array);
      runtime.setPalaeoCoastlinesEnabled(false);
      await expect(runtime.loadPalaeoOutlineToneTables()).rejects.toThrow(/mode is disabled/);
      runtime.dispose();
    });
});

describe("palaeo-coastline scrub retarget", () => {
  it("re-poses the resident interval and never fetches a payload of its own", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    // Nothing resident yet: a retarget answers null rather than starting a load.
    expect(await runtime.evaluatePalaeoMotion(390)).toBeNull();
    expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpr"))).toHaveLength(0);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    const before = fixture.requestedUrls.length;
    const frame = await runtime.evaluatePalaeoMotion(385);
    expect(frame?.intervalId).toBe("402-380");
    expect(frame?.requestedAgeMa).toBe(385);
    expect(frame?.charts).toHaveLength(prepared.charts.length);
    expect(fixture.requestedUrls).toHaveLength(before);
    // An age in a map that is not resident is not this interval's to pose.
    expect(await runtime.evaluatePalaeoMotion(370)).toBeNull();
    prepared.release();
    runtime.dispose();
  });

  it("poses a resident age synchronously, with no fetch and no promise", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    // Nothing resident: the synchronous path answers null rather than loading,
    // and says so before a caller spends a frame's evaluation on it.
    expect(runtime.palaeoMotionResidentAt(390)).toBe(false);
    expect(runtime.evaluatePalaeoMotionNow(390)).toBeNull();
    expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpr"))).toHaveLength(0);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    const before = fixture.requestedUrls.length;
    expect(runtime.palaeoMotionResidentAt(385)).toBe(true);
    // The same pose the awaited path gives, without the await: this is what
    // lets the charts retarget inside the native surface's own retarget.
    const immediate = runtime.evaluatePalaeoMotionNow(385);
    const awaited = await runtime.evaluatePalaeoMotion(385);
    expect(immediate?.intervalId).toBe("402-380");
    expect(immediate?.requestedAgeMa).toBe(385);
    expect(immediate?.charts).toHaveLength(prepared.charts.length);
    expect([...immediate!.paletteValues]).toEqual([...awaited!.paletteValues]);
    expect(fixture.requestedUrls).toHaveLength(before);
    // An age in a map that is not resident stays the async path's to fetch.
    expect(runtime.palaeoMotionResidentAt(370)).toBe(false);
    expect(runtime.evaluatePalaeoMotionNow(370)).toBeNull();
    // A disabled mode poses nothing at all, the same answer the async path gives.
    runtime.setPalaeoCoastlinesEnabled(false);
    expect(runtime.palaeoMotionResidentAt(385)).toBe(false);
    expect(runtime.evaluatePalaeoMotionNow(385)).toBeNull();
    prepared.release();
    runtime.dispose();
  });

  it("keeps posing the outgoing interval live once the age has crossed out of it", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    // The age has crossed into 380-360, but 402-380 is still the geometry on
    // screen. The pose follows the live age — the country outlines drawn over
    // this map already do — while only the lifecycle verdict is held inside the
    // published interval's own range, so its pieces are not called consumed.
    const crossing = runtime.evaluatePalaeoMotionNow(379.5, "402-380")!;
    expect(crossing.intervalId).toBe("402-380");
    expect(crossing.requestedAgeMa).toBe(379.5);
    expect(crossing.supportAgeMa).toBeCloseTo(380.001, 6);
    expect(crossing.charts.map((chart) => chart.support.kind)).toContain("supported");
    // The regression this pins: two samples past the boundary must not pose
    // identically. Held at the edge they did, and the map stood still under
    // outlines that were still moving. The frame reuses its buffers, so the
    // quaternion is copied before the next evaluation rewrites it.
    const atCrossing = [...crossing.charts[0]!.poseQuaternion];
    const further = runtime.evaluatePalaeoMotionNow(378.5, "402-380")!;
    expect(further.requestedAgeMa).toBe(378.5);
    expect([...further.charts[0]!.poseQuaternion]).not.toEqual(atCrossing);
    // A crossing the other way is live in the same way.
    const older = runtime.evaluatePalaeoMotionNow(410, "402-380")!;
    expect(older.requestedAgeMa).toBe(410);
    expect(older.supportAgeMa).toBe(402);
    // A jump of tens of megayears is not a crossing, and rotating this map to
    // an age its geometry never described would be extrapolation. Past the
    // excursion limit the pose falls back to the held support age.
    const jump = runtime.evaluatePalaeoMotionNow(345, "402-380")!;
    expect(jump.requestedAgeMa).toBeCloseTo(380.001, 6);
    expect(jump.supportAgeMa).toBeCloseTo(380.001, 6);
    // An age still inside the published interval carries one age, not two.
    const inside = runtime.evaluatePalaeoMotionNow(385, "402-380")!;
    expect(inside.requestedAgeMa).toBe(385);
    expect(inside.supportAgeMa).toBe(385);
    prepared.release();
    runtime.dispose();
  });

  it("poses a seam age against the published map instead of tearing the scene down", async () => {
    const fixture = palaeoFixture({}, SEAM_INTERVALS);
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const published = await runtime.requestPalaeoInterval(390).prepared;
    expect(published.intervalId).toBe("402-380");
    // The crossing first: the age is inside 380-360 while 402-380 is still the
    // geometry on screen, and the support age is held inside 402-380.
    const crossing = runtime.evaluatePalaeoMotionNow(379.5, "402-380")!;
    expect(crossing.intervalId).toBe("402-380");
    expect(crossing.supportAgeMa).toBeCloseTo(380.011, 6);
    // The shipped defect. An age in the seam belongs to no interval, so the
    // selector answers the older one — which is the interval already published,
    // so nothing here looks like a crossing at all and the support age used to
    // pass through unheld, a hair below 402-380's own young edge. Measured at
    // the 58 Ma end of a 117 -> 58 scrub, where the slider round-trip lands the
    // age at 58.00000000000009: the throw escaped the render-loop effect and
    // React unmounted the globe.
    const seamAgeMa = 380 + 1e-13;
    expect(selectPalaeoIntervalForAge(
      await loadVerifiedPalaeoClassCatalogs(fixture.section, fixture.fetcher),
      seamAgeMa)?.intervalId).toBe("402-380");
    const seam = runtime.evaluatePalaeoMotionNow(seamAgeMa, "402-380")!;
    expect(seam.intervalId).toBe("402-380");
    expect(seam.requestedAgeMa).toBe(seamAgeMa);
    expect(seam.supportAgeMa).toBeCloseTo(380.011, 6);
    expect(seam.charts.map((chart) => chart.support.kind)).toContain("supported");
    // The same age through the two paths that do not know what is published.
    expect(runtime.evaluatePalaeoMotionNow(seamAgeMa)!.intervalId).toBe("402-380");
    expect((await runtime.evaluatePalaeoMotion(seamAgeMa))!.intervalId).toBe("402-380");
    // No frame was skipped: the clamp answered every one of them.
    expect(runtime.ledger.palaeo.skippedFrames).toBe(0);
    // And the swap the scrub was heading for still lands. One lease at a time,
    // so the published interval is released before the next is asked for.
    published.release();
    const swapped = await runtime.requestPalaeoInterval(seamAgeMa).prepared;
    expect(swapped.intervalId).toBe("402-380");
    swapped.release();
    const younger = await runtime.requestPalaeoInterval(370).prepared;
    expect(younger.intervalId).toBe("380-360");
    expect(runtime.evaluatePalaeoMotionNow(370, "380-360")!.intervalId).toBe("380-360");
    younger.release();
    runtime.dispose();
  });

  it("finds its neighbour resident for a crossing in either direction", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const current = await runtime.requestPalaeoInterval(370).prepared;
    // Both neighbours are warmed as soon as this interval is the current one,
    // so a scrub that reverses direction crosses into a decoded interval too.
    await runtime.prefetchPalaeoInterval(390);
    await runtime.prefetchPalaeoInterval(350);
    // Residency is measured on the payloads: neither crossing below fetches,
    // decodes or triangulates anything again.
    const before = fixture.requestedUrls.filter((url) => url.endsWith(".ehpr")).length;
    expect(before).toBe(3);
    current.release();
    const older = await runtime.requestPalaeoInterval(390).prepared;
    expect(older.intervalId).toBe("402-380");
    older.release();
    const younger = await runtime.requestPalaeoInterval(350).prepared;
    expect(younger.intervalId).toBe("360-340");
    younger.release();
    expect(fixture.requestedUrls.filter((url) => url.endsWith(".ehpr")).length).toBe(before);
    runtime.dispose();
  });

  it("reuses one frame per resident interval and publishes an immutable copy of it", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const prepared = await runtime.requestPalaeoInterval(398).prepared;
    const publishedPoses = prepared.charts.map((chart) => [...chart.poseQuaternion]);
    const publishedPalette = [...prepared.motionPalette.createValuesCopy()];
    const publishedSupport = prepared.charts.map((chart) => chart.support.kind);
    const first = runtime.evaluatePalaeoMotionNow(398)!;
    const paletteBytes = (frame: CaoPalaeoIntervalFrame) => Array.from(new Uint8Array(
      frame.paletteValues.buffer, frame.paletteValues.byteOffset, frame.paletteValues.byteLength));
    const at398 = paletteBytes(first);
    // 390 Ma is the same interval with the off-schedule piece retired, so the
    // frame really is re-evaluated between the two reads below.
    const second = runtime.evaluatePalaeoMotionNow(390)!;
    expect(paletteBytes(second)).not.toEqual(at398);
    // The frame wrapper is a new object every evaluation — a render effect keyed
    // on the frame must still fire — while everything inside it is the same
    // instance, rewritten in place.
    expect(second).not.toBe(first);
    expect(second.paletteValues).toBe(first.paletteValues);
    expect(second.charts).toBe(first.charts);
    expect(second.charts[0]).toBe(first.charts[0]);
    expect(second.charts[0]!.poseQuaternion).toBe(first.charts[0]!.poseQuaternion);
    expect(second.charts[1]!.inversePoseQuaternion).toBe(first.charts[1]!.inversePoseQuaternion);
    // Re-evaluating the first age reproduces its bytes exactly: reuse is an
    // allocation change, not a value change.
    expect(paletteBytes(runtime.evaluatePalaeoMotionNow(398)!)).toEqual(at398);
    // The published revision keeps its own copy: a scrub inside the interval
    // must not move the poses the publication reports under its own age.
    expect(prepared.charts.map((chart) => [...chart.poseQuaternion])).toEqual(publishedPoses);
    expect(prepared.charts.map((chart) => chart.support.kind)).toEqual(publishedSupport);
    expect([...prepared.motionPalette.createValuesCopy()]).toEqual(publishedPalette);
    expect(prepared.charts[0]).not.toBe(first.charts[0]);
    expect(Object.isFrozen(prepared.charts[0])).toBe(true);
    prepared.release();
    runtime.dispose();
  });

  it("leaves no lease held when the mode is toggled during a scrub", async () => {
    const fixture = palaeoFixture();
    const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
      fixture.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const held = await runtime.requestPalaeoInterval(390).prepared;
    expect(runtime.palaeoLeaseCount).toBe(1);
    // A scrub sample and a fresh interval request are both in flight when the
    // toggle lands: the serial bump aborts them and the disable releases the
    // lease the published interval still holds.
    const retarget = runtime.evaluatePalaeoMotion(388);
    const inFlight = runtime.requestPalaeoInterval(370);
    runtime.setPalaeoCoastlinesEnabled(false);
    await expect(inFlight.prepared).rejects.toMatchObject({ name: "AbortError" });
    // Both chains report the same way a stale native prepare does, so App can
    // swallow one kind of failure rather than two.
    await expect(retarget).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.palaeoLeaseCount).toBe(0);
    expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBe(0);
    expect(() => held.batches[0]!.createStaticGeometryCopy()).toThrow(/released/);
    runtime.dispose();
  });
});

describe("palaeo-coastline evidence summary", () => {
  const summaryFor = (prepared: PreparedCaoPalaeoInterval | null) =>
    palaeoCoastlineEvidenceSummary(prepared, { loading: false, unavailableReason: null },
      (sourceId) => sourceId === "cao-2017-paleogeography"
        ? { citation: "Cao et al. 2017", url: "https://doi.org/10.5194/bg-14-5425-2017", year: 2017 }
        : sourceId === "north-sea-edit-ref" ? { citation: "Ziegler 1990", year: 1990 } : null);

  it("reads the interval, its active sources and its cited edits off the prepared interval",
    async () => {
      const fixture = palaeoFixture();
      const runtime = new CaoReconstructionRuntime(await manifestWithPalaeo(fixture.section),
        fixture.fetcher);
      runtime.setPalaeoCoastlinesEnabled(true);
      const prepared = await runtime.requestPalaeoInterval(390).prepared;
      const summary = summaryFor(prepared);
      expect(summary.intervalId).toBe("402-380");
      expect(summary.sourceIds).toEqual(["cao-2017-paleogeography"]);
      expect(summary.references).toHaveLength(1);
      expect(summary.references[0]).toMatchObject({ sourceId: "cao-2017-paleogeography",
        claim: "source-states", editorial: false, year: 2017 });
      // No chart in this fixture carries an editorial line, so nothing is a
      // synthesis and the badge must not claim one.
      expect(summary.editedChartIds).toEqual([]);
      expect(summary.unavailableReason).toBeNull();
      prepared.release();
      runtime.dispose();
    });

  it("marks an edited chart's own reference editorial and an absent build unavailable", () => {
    const edited = {
      intervalId: "94-81",
      activeSourceIds: ["cao-2017-paleogeography", "north-sea-edit-ref"],
      charts: [
        { chartId: "palaeo:lm:94-81:0", support: { kind: "supported" }, editorial: null,
          evidence: { sourceIds: ["cao-2017-paleogeography"] } },
        { chartId: "palaeo:lm:94-81:1", support: { kind: "supported" },
          editorial: "EarthHistory modification after Ziegler 1990",
          evidence: { sourceIds: ["cao-2017-paleogeography", "north-sea-edit-ref"] } },
        // Inactive charts contribute nothing: they are not on screen.
        { chartId: "palaeo:lm:94-81:2", support: { kind: "inactive" },
          editorial: "EarthHistory modification after an unrelated reference",
          evidence: { sourceIds: ["never-shown"] } },
      ],
    } as unknown as PreparedCaoPalaeoInterval;
    const summary = summaryFor(edited);
    expect(summary.editedChartIds).toEqual(["palaeo:lm:94-81:1"]);
    expect(summary.references.map((reference) => [reference.sourceId, reference.editorial]))
      .toEqual([["cao-2017-paleogeography", false], ["north-sea-edit-ref", true]]);
    expect(summary.references[1]).toMatchObject({ claim: "earthhistory-infers",
      constrains: "EarthHistory modification after Ziegler 1990" });

    const absent = palaeoCoastlineEvidenceSummary(null,
      { loading: false, unavailableReason: "Cao 2017 map charts are not in this build" });
    expect(absent).toMatchObject({ intervalId: null, sourceIds: [], references: [],
      editedChartIds: [], loading: false });
    expect(palaeoCoastlineEvidenceSummary(null, { loading: true, unavailableReason: null }).loading)
      .toBe(true);
  });
});

/**
 * The background walk that makes a crossing free: after the first interval of
 * an enablement is published, every remaining interval is fetched, decoded and
 * triangulated at idle priority so the scrub never reaches a cold one.
 */
describe("palaeo-coastline background preparation", () => {
  const intervalIdFromPath = (path: string): string | null =>
    /palaeo-lm-(.+)\.ehpr$/.exec(path)?.[1] ?? null;

  /**
   * The six-interval fixture with every payload fetch observable: the order
   * they start in, how many are ever in flight at once, and a gate per interval
   * so a fetch can be held open while the scheduler is watched.
   */
  function schedulerFixture(held: readonly string[] = []) {
    const fixture = palaeoFixture({}, LONG_INTERVALS);
    const holding = new Set(held);
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const fetcher: StaticAssetFetcher = async (url, signal, options) => {
      const intervalId = intervalIdFromPath(packageAssetPath(url));
      if (intervalId === null) return fixture.fetcher(url, signal, options);
      started.push(intervalId);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        if (holding.has(intervalId)) {
          await new Promise<void>((release) => gates.set(intervalId, release));
        }
        return await fixture.fetcher(url, signal, options);
      } finally {
        inFlight -= 1;
      }
    };
    const release = (intervalId: string) => {
      holding.delete(intervalId);
      gates.get(intervalId)?.();
      gates.delete(intervalId);
    };
    return { fixture, fetcher, started, release, peakInFlight: () => peakInFlight };
  }

  const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

  async function waitFor(ready: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!ready()) {
      if (Date.now() > deadline) throw new Error("background preparation did not reach the state");
      await delay(5);
    }
  }

  /**
   * The crossing policy's own predicate, asked of the runtime that answers it.
   *
   * A crossing into an interval the walk has already prepared must cost a swap,
   * not a settle: `decideIntervalRequest` reads `isPrepared`, and the pump
   * implements it through the runtime. If the runtime answered for the
   * published interval instead of the store, every crossing would pay the
   * 120 ms settle even though the map was in hand.
   */
  it("answers prepared for a walked neighbour, so a crossing into it is a swap", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const published = await runtime.requestPalaeoInterval(330).prepared;
    expect(published.intervalId).toBe("340-320");
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    // The neighbour the walk prepared, asked at its own midpoint exactly as the
    // pump's `intervalIsPrepared` asks it.
    expect(runtime.palaeoMotionResidentAt(310)).toBe(true);
    // And the decision the pump would take on that answer: a request at once,
    // with no settle, while the scrub is still moving fast.
    const decision = decideIntervalRequest({
      nowMs: 1_000, ageMa: 310, lastAgeMa: 330, lastAgeAtMs: 990,
      currentIntervalIndex: 4, preparedIntervalIndex: 3,
      isPrepared: (index) => index === 4,
    });
    expect(decision).toEqual({ kind: "request", index: 4, reason: "resident" });
    published.release();
    runtime.dispose();
  });

  /**
   * The same predicate, asked at a midpoint far from the camera.
   *
   * `palaeoMotionResidentAt` shares its resident lookup with the live pose, and
   * that lookup used to note the age it was asked about — which is the basis
   * the store measures eviction distance from. The pump asks the question at an
   * arbitrary interval's midpoint, so a probe far from the camera rewrote the
   * basis, and the next eviction judged the interval on screen the farthest
   * resident one and dropped what was being drawn. A residency question is a
   * read now; only the live-age paths note a basis.
   */
  it("leaves the eviction basis on the live age when a far midpoint is probed", async () => {
    const noted: number[] = [];
    const note = CaoSurfaceResidencyStore.prototype.noteCurrentAge;
    const recorder = vi.spyOn(CaoSurfaceResidencyStore.prototype, "noteCurrentAge")
      .mockImplementation(function (this: CaoSurfaceResidencyStore, requestedAgeMa: number) {
        noted.push(requestedAgeMa);
        note.call(this, requestedAgeMa);
      });
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const published = await runtime.requestPalaeoInterval(395).prepared;
    expect(published.intervalId).toBe("402-380");
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    // The live pose the camera is on: this path does note the age it draws.
    expect(runtime.evaluatePalaeoMotionNow(395, "402-380")).not.toBeNull();
    const beforeProbe = noted.length;
    // The pump's `intervalIsPrepared` question about the far edge of the warm
    // window, asked at that interval's own midpoint — 65 Ma from the pose.
    expect(runtime.palaeoMotionResidentAt(330)).toBe(true);
    expect(noted.slice(beforeProbe)).toEqual([]);
    const basis = noted[noted.length - 1]!;
    expect(basis).toBe(395);
    published.release();
    runtime.dispose();
    recorder.mockRestore();
    // And the consequence, against a real store left on the basis the engine
    // noted: the interval being drawn survives the eviction the next load
    // triggers, because the distances are still measured from the live age.
    const runner = createPalaeoTriangulationRunner();
    const twoIntervals = gated.fixture.catalog.intervals[0]!.payload.bytes
      + gated.fixture.catalog.intervals[1]!.payload.bytes;
    const store = await intervalResidency(
      { ...gated.fixture.section, reservation: { ...gated.fixture.section.reservation,
        maxResidentSourceBytes: twoIntervals } },
      await loadedCatalogs(gated.fixture), gated.fixture.fetcher, runner,
      { ...DEFAULT_SURFACE_RESIDENCY_POLICY, residentIntervals: "nearest" });
    store.noteCurrentAge(basis);
    await store.load(intervalUnit("402-380"));
    await store.load(intervalUnit("380-360"));
    await store.load(intervalUnit("340-320"));
    expect(store.intervalLedger.residentCount).toBeLessThanOrEqual(2);
    expect(store.resident(intervalUnit("402-380"))).not.toBeNull();
    expect(store.resident(intervalUnit("340-320"))).toBeNull();
    store.dispose();
    runner.dispose();
  });

  it("walks every remaining interval nearest by age, one job at a time", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const published = await runtime.requestPalaeoInterval(330).prepared;
    expect(published.intervalId).toBe("340-320");
    published.release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    // Nearest first from 330 Ma, ties broken by the published order: the walk
    // takes the intervals in the order a scrub would cross them.
    expect(gated.started).toEqual(["340-320", "360-340", "320-300", "380-360", "300-280", "402-380"]);
    expect(gated.peakInFlight()).toBe(1);
    expect(runtime.ledger.palaeo.preparedIntervals).toBe(6);
    expect(runtime.ledger.palaeo.preparingIntervalId).toBeNull();
    runtime.dispose();
  });

  /**
   * The idle pre-upload's half of the contract. The walk prepares the timeline
   * long before a scrub reaches most of it, but a prepared interval is only
   * decoded triangles until something uploads them: the scene is told each one
   * so it can take that upload at idle, and it needs a revision it can publish
   * without superseding the crossing that may be in flight.
   */
  it("tells a listener each interval the walk prepares and prepares a resident one off the chain",
    async () => {
      const gated = schedulerFixture();
      const runtime = new CaoReconstructionRuntime(
        await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
      runtime.setPalaeoCoastlinesEnabled(true);
      const notices: string[] = [];
      const stop = runtime.onPalaeoIntervalPrepared((notice) => {
        expect(notice.fromAgeMa).toBeGreaterThan(notice.toAgeMa);
        notices.push(notice.intervalId);
      });
      const published = await runtime.requestPalaeoInterval(330).prepared;
      published.release();
      await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
      // The interval the foreground request loaded is not one the walk prepared,
      // so the notices are exactly the five the walk took, in its own order.
      expect(notices).toEqual(["360-340", "320-300", "380-360", "300-280", "402-380"]);

      // Two of them, uploaded hidden by the scene, off the request chain: no
      // lease left behind, no supersession, and the pose is the interval's own.
      const request = runtime.requestPalaeoInterval(310);
      const first = runtime.prepareResidentPalaeoIntervalNow("360-340")!;
      expect(first.intervalId).toBe("360-340");
      expect(first.requestedAgeMa).toBe(350);
      expect(first.batches.length).toBeGreaterThan(0);
      first.release();
      const second = runtime.prepareResidentPalaeoIntervalNow("402-380")!;
      expect(second.identity).not.toBe(first.identity);
      second.release();
      // The foreground crossing that was in flight the whole time still lands.
      const crossing = await request.prepared;
      expect(crossing.intervalId).toBe("320-300");
      crossing.release();
      expect(runtime.ledger.palaeo.preparedLeaseCount).toBe(0);

      // An interval that is not resident, and a runtime with the mode off,
      // answer null rather than starting a load of their own.
      runtime.setPalaeoCoastlinesEnabled(false);
      expect(runtime.prepareResidentPalaeoIntervalNow("360-340")).toBeNull();
      stop();
      runtime.dispose();
    });

  it("starts no job while a foreground request is pending and resumes after it", async () => {
    const gated = schedulerFixture(["300-280"]);
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    const published = await runtime.requestPalaeoInterval(330).prepared;
    published.release();
    // Issued before the scheduler's first idle slot, which was scheduled while
    // the publication above was still on the stack.
    const pending = runtime.requestPalaeoInterval(290);
    await delay(150);
    // Only the two foreground intervals were ever fetched: the walk has five
    // intervals left and took none of them while the request was in flight.
    expect(gated.started).toEqual(["340-320", "300-280"]);
    expect(runtime.ledger.palaeo.preparingIntervalId).toBeNull();
    expect(runtime.ledger.palaeo.backgroundPreparationComplete).toBe(false);
    gated.release("300-280");
    const prepared = await pending.prepared;
    expect(prepared.intervalId).toBe("300-280");
    prepared.release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    // Four, not six: the crossing to 290 Ma re-centred the warm window on
    // `300-280`, the youngest interval of the fixture, so the window is the
    // three intervals above it and itself. `402-380` and `380-360` are outside
    // it and the walk stops at its edge.
    expect(new Set(gated.started).size).toBe(4);
    expect(runtime.ledger.palaeo.preparedIntervals).toBe(4);
    expect(runtime.ledger.palaeo.windowIntervals)
      .toEqual(["360-340", "340-320", "320-300", "300-280"]);
    runtime.dispose();
  });

  it("answers a foreground request for a prepared interval without fetching it again", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    (await runtime.requestPalaeoInterval(330).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    const fetchedBefore = gated.started.length;
    // The far end of the timeline, prepared last and never drawn: the crossing
    // it belongs to must cost no fetch at all.
    const prepared = await runtime.requestPalaeoInterval(390).prepared;
    expect(prepared.intervalId).toBe("402-380");
    expect(gated.started.length).toBe(fetchedBefore);
    prepared.release();
    runtime.dispose();
  });

  it("cancels the walk and frees every prepared interval when the layer goes off", async () => {
    const gated = schedulerFixture(["360-340"]);
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    (await runtime.requestPalaeoInterval(330).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.preparingIntervalId === "360-340");
    runtime.setPalaeoCoastlinesEnabled(false);
    const ledger = runtime.ledger.palaeo;
    expect(ledger.preparingIntervalId).toBeNull();
    expect(ledger.backgroundPreparationComplete).toBe(false);
    expect(ledger.preparedIntervals).toBe(0);
    expect(ledger.totalSourceBytes).toBe(0);
    const startedWhenOff = gated.started.length;
    gated.release("360-340");
    await delay(150);
    // Nothing the walk had queued survives the toggle.
    expect(gated.started.length).toBe(startedWhenOff);
    expect(runtime.ledger.palaeo.totalSourceBytes).toBe(0);
    runtime.dispose();
  });

  /**
   * The window's membership rule, on the shape the shipped schedule has: 24
   * contiguous Cao 2017 intervals and one detached LGM state. Stated on the
   * pure function because the runtime tests below can only reach a window
   * through a crossing, and an end of the schedule is exactly where a crossing
   * cannot centre one.
   */
  it("centres the warm window by schedule index, clamps at both ends and isolates the LGM state",
    () => {
      const schedule = [
        ...LONG_INTERVALS.map((interval) => ({ intervalId: interval.intervalId,
          intervalIndex: interval.intervalIndex })),
        { intervalId: "lgm", intervalIndex: 6 },
      ];
      const catalogs = [{ catalog: { intervals: schedule, detachedIntervalIds: ["lgm"] } }] as
        unknown as readonly LoadedPalaeoClassCatalog[];
      // The middle: three either side, seven in all.
      expect(palaeoWarmWindowIntervalIds(catalogs, "340-320", 3))
        .toEqual(["402-380", "380-360", "360-340", "340-320", "320-300", "300-280"]);
      // The oldest end: clamped, not slid inwards. Four intervals is the honest
      // answer where the schedule stops.
      expect(palaeoWarmWindowIntervalIds(catalogs, "402-380", 3))
        .toEqual(["402-380", "380-360", "360-340", "340-320"]);
      // The youngest end of the contiguous schedule; the detached state is not
      // its neighbour, so it is not swept in.
      expect(palaeoWarmWindowIntervalIds(catalogs, "300-280", 3))
        .toEqual(["360-340", "340-320", "320-300", "300-280"]);
      // The detached state is its own window of one, whatever the radius.
      expect(palaeoWarmWindowIntervalIds(catalogs, "lgm", 3)).toEqual(["lgm"]);
      // The low profile's radius of one.
      expect(palaeoWarmWindowIntervalIds(catalogs, "340-320", 1))
        .toEqual(["360-340", "340-320", "320-300"]);
      expect(palaeoWarmWindowIntervalIds(catalogs, null, 3)).toEqual([]);
      expect(palaeoWarmWindowIntervalIds([], "340-320", 3)).toEqual([]);
    });

  it("re-centres at idle: evicts the far side and prepares the near side", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    (await runtime.requestPalaeoInterval(390).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    // The oldest end: the window is `402-380` and the three below it.
    expect(runtime.ledger.palaeo.windowIntervals)
      .toEqual(["402-380", "380-360", "360-340", "340-320"]);
    expect(runtime.ledger.palaeo.preparedIntervals).toBe(4);
    const startedBefore = new Set(gated.started);
    expect(startedBefore.has("320-300")).toBe(false);

    // A crossing to the youngest end. The window re-centres on the crossing
    // itself — which is why the interval it draws is inside it — but the
    // preparation of what it newly covers is the walk's, at idle.
    (await runtime.requestPalaeoInterval(290).prepared).release();
    expect(runtime.ledger.palaeo.windowIntervals)
      .toEqual(["360-340", "340-320", "320-300", "300-280"]);
    // The far side is gone the moment the window moved: the two oldest
    // intervals were prepared and are not resident any more.
    expect(runtime.ledger.palaeo.preparedIntervals).toBeLessThanOrEqual(3);
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    expect(runtime.ledger.palaeo.preparedIntervals).toBe(4);
    // The near side was prepared by the walk, not by the crossing.
    expect(gated.started).toContain("320-300");
    runtime.dispose();
  });

  /**
   * The window is sized so a scrub cannot outrun it. Three boundaries is as far
   * as a fast sweep reaches before the walk has re-centred, and every interval
   * it crosses into is one the window already prepared — so no crossing fetches
   * and, in the scene, none uploads: each takes the retarget path onto a member
   * that is already warm.
   */
  it("crosses three boundaries inside the initial window without a single fetch", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    (await runtime.requestPalaeoInterval(390).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    const fetchesBefore = gated.started.length;
    const crossed: string[] = [];
    for (const ageMa of [370, 350, 330]) {
      const prepared = await runtime.requestPalaeoInterval(ageMa).prepared;
      crossed.push(prepared.intervalId);
      prepared.release();
    }
    expect(crossed).toEqual(["380-360", "360-340", "340-320"]);
    // Measured before the walk's next idle slot: the sweep itself started no
    // fetch, so every crossing was a swap of geometry already in hand.
    expect(gated.started.length).toBe(fetchesBefore);
    runtime.dispose();
  });

  it("restarts the walk on the next enablement", async () => {
    const gated = schedulerFixture();
    const runtime = new CaoReconstructionRuntime(
      await manifestWithPalaeo(gated.fixture.section), gated.fetcher);
    runtime.setPalaeoCoastlinesEnabled(true);
    (await runtime.requestPalaeoInterval(330).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    runtime.setPalaeoCoastlinesEnabled(false);
    runtime.setPalaeoCoastlinesEnabled(true);
    expect(runtime.ledger.palaeo.backgroundPreparationComplete).toBe(false);
    (await runtime.requestPalaeoInterval(330).prepared).release();
    await waitFor(() => runtime.ledger.palaeo.backgroundPreparationComplete);
    expect(runtime.ledger.palaeo.preparedIntervals).toBe(6);
    runtime.dispose();
  });
});

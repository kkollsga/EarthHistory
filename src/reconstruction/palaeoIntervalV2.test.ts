import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { CaoPalaeoIntervalStore, loadVerifiedPalaeoClassCatalogs, selectPalaeoIntervalForAge,
  type LoadedPalaeoClassCatalog } from "./loaderV2";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import { validatePalaeoCoastlineAssets, type PalaeoCoastlineAssets,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import { createPalaeoTriangulationRunner } from "./palaeoTriangulate";
import { evaluateCaoPalaeoIntervalFrame, palaeoCoastlineEvidenceSummary,
  type PreparedCaoPalaeoInterval } from "./palaeoIntervalV2";
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

const LIFECYCLES = [
  { youngestExclusiveMa: 380, oldestMa: 402 },
  // Off the published schedule: shipped inside 402-380 with its own dates.
  { youngestExclusiveMa: 395, oldestMa: 400 },
  { youngestExclusiveMa: 360, oldestMa: 380 },
  { youngestExclusiveMa: 340, oldestMa: 360 },
];

const square = (west: number, south: number, size: number): readonly LonLat[] => [
  [west, south], [west + size, south], [west + size, south + size], [west, south + size],
];

function payloadFor(interval: typeof INTERVALS[number]): ArrayBuffer {
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

function toneTablesPayload(): Uint8Array {
  // Table i marks segment i light, so a decode that read the wrong table is
  // visible in the counts rather than only in the bytes.
  return encodePalaeoOutlineToneTables(INTERVALS.map((_, table) =>
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

function palaeoFixture(overrides: Partial<PalaeoCoastlineAssets["reservation"]> = {}): PalaeoFixture {
  const assets = new Map<string, ArrayBuffer>();
  const intervals = INTERVALS.map((interval) => {
    const payload = payloadFor(interval);
    const url = `palaeo-lm-${interval.intervalId}.ehpr`;
    assets.set(`palaeo/lm/${url}`, payload);
    const decodedPieces = interval.intervalIndex === 0 ? 2 : 1;
    return { ...interval, url, bytes: payload.byteLength, sha256: sha256(payload),
      pieces: decodedPieces, rings: decodedPieces, vertices: decodedPieces * 4 };
  });
  const catalogOptions = { bindingPlateId: BINDING_PLATE_ID, lifecycles: LIFECYCLES, intervals };
  const catalog = palaeoClassCatalogFixture(catalogOptions);
  const catalogBytes = new TextEncoder()
    .encode(JSON.stringify(palaeoClassCatalogDocumentFixture(catalogOptions))).buffer as ArrayBuffer;
  assets.set(CATALOG_URL, catalogBytes);
  const toneCatalog = new TextEncoder().encode("{}").buffer as ArrayBuffer;
  const tones = toneTablesPayload();
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
      Object.assign(section.reservation, { maxIntervalTriangles: 580_001 })), domain))
      .toThrow(/reservation/);
    expect(() => validatePalaeoCoastlineAssets(corrupt((section) =>
      Object.assign(section.reservation, { maxResidentSourceBytes: 0 })), domain))
      .toThrow(/reservation/);
  });
});

describe("palaeo-coastline interval store", () => {
  it("keeps two intervals resident and evicts the least recently used", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const store = new CaoPalaeoIntervalStore(fixture.section, await loadedCatalogs(fixture),
      fixture.fetcher, runner);
    await store.load("402-380");
    await store.load("380-360");
    expect(store.ledger.residentCount).toBe(2);
    // Touching the older one makes the newer the eviction victim.
    await store.load("402-380");
    await store.load("360-340");
    expect(store.ledger.residentCount).toBe(2);
    const before = fixture.requestedUrls.length;
    await store.load("402-380");
    expect(fixture.requestedUrls.length).toBe(before);
    await store.load("380-360");
    expect(fixture.requestedUrls.length).toBeGreaterThan(before);
    store.dispose();
    runner.dispose();
  });

  it("bounds resident bytes as well as resident count", async () => {
    const fixture = palaeoFixture();
    const oneInterval = fixture.catalog.intervals[0]!.payload.bytes;
    const runner = createPalaeoTriangulationRunner();
    const store = new CaoPalaeoIntervalStore(
      { ...fixture.section, reservation: { ...fixture.section.reservation,
        maxResidentSourceBytes: oneInterval } },
      await loadedCatalogs(fixture), fixture.fetcher, runner);
    await store.load("402-380");
    await store.load("380-360");
    expect(store.ledger.residentCount).toBe(1);
    expect(store.ledger.residentSourceBytes).toBeLessThanOrEqual(oneInterval);
    store.dispose();
    runner.dispose();
  });

  it("refuses an interval larger than the whole resident bound", async () => {
    const fixture = palaeoFixture();
    const runner = createPalaeoTriangulationRunner();
    const store = new CaoPalaeoIntervalStore(
      { ...fixture.section, reservation: { ...fixture.section.reservation, maxResidentSourceBytes: 1 } },
      await loadedCatalogs(fixture), fixture.fetcher, runner);
    await expect(store.load("402-380")).rejects.toThrow(/resident byte bound/);
    expect(store.ledger.residentCount).toBe(0);
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
    const store = new CaoPalaeoIntervalStore(fixture.section, await loadedCatalogs(fixture),
      gatedFetcher, runner);
    const first = new AbortController();
    const pendingFirst = store.load("402-380", first.signal);
    const pendingSecond = store.load("380-360");
    await new Promise((settle) => setTimeout(settle, 10));
    expect(store.ledger.pendingCount).toBe(2);
    expect(store.ledger.pendingReservedSourceBytes).toBeGreaterThan(0);
    first.abort();
    await expect(pendingFirst).rejects.toThrow(/aborted/);
    for (const release of gates.values()) release();
    await pendingSecond;
    expect(store.ledger.residentCount).toBe(1);
    expect(store.ledger.pendingCount).toBe(0);
    await expect(store.load("402-380", AbortSignal.abort())).rejects.toThrow(/aborted/);
    store.dispose();
    await expect(store.load("360-340")).rejects.toThrow(/disposed/);
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
    const store = new CaoPalaeoIntervalStore(fixture.section, await loadedCatalogs(fixture),
      corruptFetcher, runner);
    await expect(store.load("402-380")).rejects.toThrow(/verification failed/);
    store.dispose();
    runner.dispose();
  });
});

describe("palaeo-coastline interval frame", () => {
  it("activates each piece on its own lifecycle, not on the payload's interval", async () => {
    const fixture = palaeoFixture();
    const catalogs = await loadedCatalogs(fixture);
    const runner = createPalaeoTriangulationRunner();
    const store = new CaoPalaeoIntervalStore(fixture.section, catalogs, fixture.fetcher, runner);
    const interval = await store.load("402-380");
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
    expect(copy.seamIds).toHaveLength(batch.vertexCount);
    expect(copy.preparedEntryIndices).toHaveLength(batch.vertexCount);
    expect(copy.materialChartIndices).toHaveLength(batch.vertexCount);
    expect(new Set(copy.seamIds).size).toBe(batch.vertexCount);
    const bytes = [copy.referenceDirections, copy.indices, copy.seamIds, copy.preparedEntryIndices,
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
    const covered = prepared.batches.flatMap((entry) => entry.chartTriangleRanges)
      .reduce((sum, range) => sum + range.triangleCount, 0);
    expect(covered).toBe(batch.triangleCount);
    expect(prepared.motionPalette.createValuesCopy()).toHaveLength(prepared.charts.length * 11);
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

import { describe, expect, it } from "vitest";
import {
  PALAEO_RING_FLAGS,
  decodePalaeoRingPayload,
  palaeoLifecycleActiveAtAge,
  palaeoPieceLimitationFlags,
  palaeoVertexDirection,
  selectPalaeoInterval,
  validatePalaeoCoastlineClassCatalog,
  validatePalaeoRingPayloadAgainstCatalog,
  type PalaeoCoastlineClassCatalog,
} from "./palaeoRings";
import { encodePalaeoRingPayload, palaeoClassCatalogFixture } from "./fixtures/palaeoRingFixtures";

const square = (west: number, south: number, size: number) => [
  [west, south], [west + size, south], [west + size, south + size], [west, south + size],
] as const;

describe("EHPR v1 ring payload", () => {
  it("round-trips pieces, implicit ring offsets, holes, flags and vertex directions", () => {
    const payload = decodePalaeoRingPayload(encodePalaeoRingPayload({
      surfaceClass: "sm", intervalIndex: 7, fromAgeMa: 94, toAgeMa: 81,
      pieces: [
        { chartIndex: 2, bindingIndex: 3, evidenceIndex: 1, lifecycleIndex: 4,
          flags: PALAEO_RING_FLAGS.frameConflict | PALAEO_RING_FLAGS.offSchedule,
          rings: [{ lonLat: square(10, 40, 4) }, { lonLat: square(11, 41, 1), hole: true }] },
        { chartIndex: 0, rings: [{ lonLat: square(-30, -10, 3) }] },
      ],
    }));
    expect(payload.surfaceClass).toBe("sm");
    expect(payload.classCode).toBe(2);
    expect(payload.intervalIndex).toBe(7);
    expect(payload.intervalOldestAgeMa).toBe(94);
    expect(payload.intervalYoungestAgeMa).toBe(81);
    expect(payload.ringCount).toBe(3);
    expect(payload.vertexCount).toBe(12);
    const [first, second] = payload.pieces;
    expect(first).toMatchObject({ chartIndex: 2, bindingIndex: 3, evidenceIndex: 1, lifecycleIndex: 4,
      firstRing: 0 });
    expect(first!.rings.map((ring) => [ring.firstVertex, ring.vertexCount, ring.hole]))
      .toEqual([[0, 4, false], [4, 4, true]]);
    expect(second!.rings.map((ring) => [ring.firstVertex, ring.vertexCount, ring.hole]))
      .toEqual([[8, 4, false]]);
    expect(second!.firstRing).toBe(2);
    expect(palaeoPieceLimitationFlags(first!)).toEqual([1, 8]);
    expect(palaeoPieceLimitationFlags(second!)).toEqual([]);
    // 0.005493 degrees of longitude is one grid step, so a decoded vertex sits
    // within half a step of the value the compiler quantised.
    const direction = palaeoVertexDirection(payload.vertices, 0);
    const longitude = Math.atan2(direction[1], direction[0]) * 180 / Math.PI;
    const latitude = Math.asin(direction[2]) * 180 / Math.PI;
    expect(longitude).toBeCloseTo(10, 2);
    expect(latitude).toBeCloseTo(40, 2);
    expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
  });

  it("rejects a payload whose magic, version or header size is not EHPR v1", () => {
    const pieces = [{ rings: [{ lonLat: square(0, 0, 2) }] }];
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, magic: "EHGB" })))
      .toThrow(/not an EHPR/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, version: 2 })))
      .toThrow(/unsupported EHPR/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, headerBytes: 40 })))
      .toThrow(/unsupported EHPR/);
    expect(() => decodePalaeoRingPayload(new ArrayBuffer(8))).toThrow(/shorter than its header/);
  });

  it("rejects declared counts that disagree with the bytes or with each other", () => {
    const pieces = [{ rings: [{ lonLat: square(0, 0, 2) }] },
      { rings: [{ lonLat: square(5, 5, 2) }] }];
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, declaredVertexCount: 9 })))
      .toThrow(/length disagrees/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, declaredPieceCount: 3 })))
      .toThrow(/length disagrees/);
    // One ring fewer in the header than the pieces own: the table cannot be read.
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: square(0, 0, 2) }, { lonLat: square(0.5, 0.5, 1), hole: true }] }],
      declaredRingCount: 1,
    }))).toThrow(/length disagrees/);
  });

  it("rejects a ring that runs past the vertex table and a vertex no ring owns", () => {
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: square(0, 0, 2) }] }],
      ringVertexCountOverride: { ringIndex: 0, value: 6 },
    }))).toThrow(/runs past the vertex table/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: square(0, 0, 2) }] }],
      ringVertexCountOverride: { ringIndex: 0, value: 3 },
    }))).toThrow(/vertices no ring owns/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: [[0, 0], [1, 0]] }] }],
    }))).toThrow(/fewer than three vertices/);
  });

  it("rejects an interior ring before any exterior ring in the same piece", () => {
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: square(0, 0, 2), hole: true }] }],
    }))).toThrow(/starts with an interior ring/);
    // A hole after its own exterior ring is the normal case.
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: [{ lonLat: square(0, 0, 4) }, { lonLat: square(1, 1, 1), hole: true }] }],
    }))).not.toThrow();
  });

  it("rejects an unknown class code, interval index, flag bit or empty interval range", () => {
    const pieces = [{ rings: [{ lonLat: square(0, 0, 2) }] }];
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, classCode: 4 })))
      .toThrow(/unknown EHPR palaeo surface class/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, intervalIndex: 24 })))
      .toThrow(/outside the published schedule/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({
      pieces: [{ rings: pieces[0]!.rings, flags: 64 }],
    }))).toThrow(/unknown flag bit/);
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, fromAgeMa: 380, toAgeMa: 402 })))
      .toThrow(/ordered non-empty range/);
  });

  it("treats a lifecycle as (TOAGE, FROMAGE]", () => {
    const lifecycle = { youngestExclusiveMa: 380, oldestMa: 402 };
    expect(palaeoLifecycleActiveAtAge(lifecycle, 402)).toBe(true);
    expect(palaeoLifecycleActiveAtAge(lifecycle, 380)).toBe(false);
    expect(palaeoLifecycleActiveAtAge(lifecycle, 380.0001)).toBe(true);
    expect(palaeoLifecycleActiveAtAge(lifecycle, 402.0001)).toBe(false);
    expect(palaeoLifecycleActiveAtAge(lifecycle, Number.NaN)).toBe(false);
  });
});

describe("palaeo-coastline class catalog", () => {
  const corrupt = (mutate: (catalog: PalaeoCoastlineClassCatalog) => void): PalaeoCoastlineClassCatalog => {
    const catalog = structuredClone(palaeoClassCatalogFixture());
    mutate(catalog);
    return catalog;
  };

  it("accepts the compiled shape and refuses a foreign class or format", () => {
    expect(() => validatePalaeoCoastlineClassCatalog(palaeoClassCatalogFixture())).not.toThrow();
    expect(() => validatePalaeoCoastlineClassCatalog(palaeoClassCatalogFixture(), "sm")).toThrow();
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog, { schemaVersion: 2 })))).toThrow();
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog, { appearance: "palaeo-shallow-marine" }))))
      .toThrow();
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.format, { magic: "EHGB" })))).toThrow();
  });

  it("requires a verbatim limitation line for every disclosing flag", () => {
    for (const bit of ["1", "2", "4", "8"]) {
      expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) => {
        delete (catalog.flagLimitations as Record<string, string>)[bit];
      }))).toThrow(/flag limitation/);
    }
  });

  it("refuses a reversed or empty lifecycle, a binding gap and an uncited edit", () => {
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.lifecycles[0]!, { youngestExclusiveMa: 402, oldestMa: 380 })))).toThrow(/reversed or empty/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.lifecycles[0]!, { youngestExclusiveMa: 402, oldestMa: 402 })))).toThrow(/reversed or empty/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) => {
      (catalog.bindings[0] as { entries: unknown }).entries = [
        { entryId: "plate-101-0-100", validTimeMa: { youngest: 0, oldest: 100 } },
        { entryId: "plate-101-200-400", validTimeMa: { youngest: 200, oldest: 400 } },
      ];
    }))).toThrow(/gap-free/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.evidence[0]!, { status: "derived-from-published-source" })))).toThrow(/evidence record/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.evidence[0]!, { sourceIds: [] }))))
      .toThrow(/evidence record/);
  });

  it("refuses an interval whose payload, reservation or schedule is wrong", () => {
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.intervals[0]!.reservation, { maximumEdgeDegrees: 1.28 })))).toThrow(/interval record/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.intervals[0]!.reservation, { vertices: 99 })))).toThrow(/interval record/);
    // A payload url is a bare file name resolved beside its own catalog.
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.intervals[0]!.simplified, { url: "../other/payload.ehpr" })))).toThrow(/interval record/);
    const gapped = palaeoClassCatalogFixture({ intervals: [
      { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
        url: "a.ehpr", bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 3 },
      { intervalId: "379-360", intervalIndex: 1, fromAgeMa: 379, toAgeMa: 360,
        url: "b.ehpr", bytes: 1, sha256: "b".repeat(64), pieces: 1, rings: 1, vertices: 3 },
    ] });
    expect(() => validatePalaeoCoastlineClassCatalog(gapped)).toThrow(/not contiguous/);
  });

  it("selects the covering interval with the same half-open rule as a piece", () => {
    const catalog = palaeoClassCatalogFixture({ intervals: [
      { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
        url: "a.ehpr", bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 3 },
      { intervalId: "380-360", intervalIndex: 1, fromAgeMa: 380, toAgeMa: 360,
        url: "b.ehpr", bytes: 1, sha256: "b".repeat(64), pieces: 1, rings: 1, vertices: 3 },
    ] });
    expect(selectPalaeoInterval(catalog, 402)?.intervalId).toBe("402-380");
    expect(selectPalaeoInterval(catalog, 380)?.intervalId).toBe("380-360");
    expect(selectPalaeoInterval(catalog, 360)).toBeNull();
    expect(selectPalaeoInterval(catalog, 403)).toBeNull();
  });
});

describe("payload and catalog cross-check", () => {
  const catalog = palaeoClassCatalogFixture({ intervals: [{ intervalId: "402-380", intervalIndex: 0,
    fromAgeMa: 402, toAgeMa: 380, url: "palaeo-lm-402-380.ehpr", bytes: 1, sha256: "a".repeat(64),
    pieces: 1, rings: 1, vertices: 4 }] });
  const record = catalog.intervals[0]!;
  const payload = (overrides: Parameters<typeof encodePalaeoRingPayload>[0]) =>
    decodePalaeoRingPayload(encodePalaeoRingPayload(overrides));
  const valid = { pieces: [{ rings: [{ lonLat: square(0, 0, 2) }] }] } as const;

  it("accepts a payload that is the interval and class its catalog declares", () => {
    expect(() => validatePalaeoRingPayloadAgainstCatalog(payload(valid), catalog, record)).not.toThrow();
  });

  it("refuses a foreign class, interval, count or dangling catalog index", () => {
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload({ ...valid, surfaceClass: "m" }), catalog, record)).toThrow(/not the interval/);
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload({ ...valid, fromAgeMa: 401 }), catalog, record)).toThrow(/not the interval/);
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload({ pieces: [...valid.pieces, { rings: [{ lonLat: square(9, 9, 2) }] }] }), catalog, record))
      .toThrow(/counts disagree/);
    for (const field of ["chartIndex", "bindingIndex", "evidenceIndex", "lifecycleIndex"] as const) {
      expect(() => validatePalaeoRingPayloadAgainstCatalog(
        payload({ pieces: [{ ...valid.pieces[0]!, [field]: 5 }] }), catalog, record))
        .toThrow(/catalog record that does not exist/);
    }
  });

  it("refuses a piece whose lifecycle does not overlap the interval it ships in", () => {
    const outside = palaeoClassCatalogFixture({
      lifecycles: [{ youngestExclusiveMa: 380, oldestMa: 402 }, { youngestExclusiveMa: 100, oldestMa: 200 }],
      intervals: [{ intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
        url: "palaeo-lm-402-380.ehpr", bytes: 1, sha256: "a".repeat(64),
        pieces: 1, rings: 1, vertices: 4 }],
    });
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload({ pieces: [{ ...valid.pieces[0]!, lifecycleIndex: 1 }] }), outside, outside.intervals[0]!))
      .toThrow(/does not overlap its own interval/);
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload(valid), outside, outside.intervals[0]!)).not.toThrow();
  });
});

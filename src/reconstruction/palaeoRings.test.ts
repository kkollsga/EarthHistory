import { describe, expect, it } from "vitest";
import {
  PALAEO_RING_FLAGS,
  decodePalaeoCoastlineClassCatalog,
  decodePalaeoRingPayload,
  indexPalaeoPaletteEntriesByPlate,
  palaeoBindingSeamCoversAge,
  palaeoLifecycleActiveAtAge,
  palaeoPieceLimitationFlags,
  palaeoVertexDirection,
  selectPalaeoBindingEntry,
  selectPalaeoCatalogInterval,
  validatePalaeoCoastlineClassCatalog,
  validatePalaeoRingPayloadAgainstCatalog,
  type PalaeoCoastlineClassCatalog,
} from "./palaeoRings";
import { CAO_2017_MAP_INTERVALS, selectPalaeoInterval } from "./outlineTones";
import { encodePalaeoRingPayload, palaeoClassCatalogDocumentFixture,
  palaeoClassCatalogFixture } from "./fixtures/palaeoRingFixtures";

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
    // 24 is the detached LGM interval and is published; 25 is past the schedule.
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, intervalIndex: 24 })))
      .not.toThrow();
    expect(() => decodePalaeoRingPayload(encodePalaeoRingPayload({ pieces, intervalIndex: 25 })))
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
      Object.assign(catalog, { schemaVersion: 1 })))).toThrow();
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog, { encoding: "palaeo-class-catalog-rows-v1" })))).toThrow();
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

  it("refuses a reversed or empty lifecycle, a foreign binding kind and an uncited edit", () => {
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.lifecycles[0]!, { youngestExclusiveMa: 402, oldestMa: 380 })))).toThrow(/reversed or empty/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.lifecycles[0]!, { youngestExclusiveMa: 402, oldestMa: 402 })))).toThrow(/reversed or empty/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.bindings[0]!, { kind: "deforming" })))).toThrow(/motion binding record/);
    expect(() => validatePalaeoCoastlineClassCatalog(corrupt((catalog) =>
      Object.assign(catalog.entrySelection, { rule: "palaeo-binding-entry-v0" }))))
      .toThrow(/palaeo-binding-entry-v1/);
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
      Object.assign(catalog.intervals[0]!.payload, { url: "../other/payload.ehpr" })))).toThrow(/interval record/);
    expect(() => palaeoClassCatalogFixture({ intervals: [
      { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
        bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 3 },
      { intervalId: "379-360", intervalIndex: 1, fromAgeMa: 379, toAgeMa: 360,
        bytes: 1, sha256: "b".repeat(64), pieces: 1, rings: 1, vertices: 3 },
    ] })).toThrow(/not contiguous/);
  });

  it("selects the covering interval with the same half-open rule as a piece", () => {
    const catalog = palaeoClassCatalogFixture({ intervals: [
      { intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
        bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 3 },
      { intervalId: "380-360", intervalIndex: 1, fromAgeMa: 380, toAgeMa: 360,
        bytes: 1, sha256: "b".repeat(64), pieces: 1, rings: 1, vertices: 3 },
    ] });
    expect(selectPalaeoCatalogInterval(catalog, 402)?.intervalId).toBe("402-380");
    expect(selectPalaeoCatalogInterval(catalog, 380)?.intervalId).toBe("380-360");
    expect(selectPalaeoCatalogInterval(catalog, 360)).toBeNull();
    expect(selectPalaeoCatalogInterval(catalog, 403)).toBeNull();
    expect(selectPalaeoCatalogInterval(catalog, Number.NaN)).toBeNull();
  });

  it("agrees with the canonical Cao 2017 interval table at every age", () => {
    // The catalog a build ships and the table the UI labels intervals from are
    // two transcriptions of one schedule. They run through the same predicate,
    // and this is what proves the two answers are the same interval — including
    // at the shared bounds and in the 10 kyr gaps the source leaves between
    // two maps, where a lookup that rounded either way would differ.
    const catalog = palaeoClassCatalogFixture({
      intervals: CAO_2017_MAP_INTERVALS.map((interval, index) => ({
        intervalId: interval.id, intervalIndex: index,
        fromAgeMa: interval.oldestMa, toAgeMa: interval.youngestMa,
        bytes: 1,
        sha256: String(index).padStart(64, "0"), pieces: 1, rings: 1, vertices: 3,
      })),
    });
    const ages = [0, 2.01, 2.02, 90, 94, 260, 380, 380.005, 380.02, 402, 402.001, 500];
    for (const interval of CAO_2017_MAP_INTERVALS) {
      ages.push(interval.oldestMa, interval.youngestMa, interval.youngestMa + 0.005);
    }
    for (let age = 5; age <= 400; age += 5) ages.push(age);
    for (const ageMa of ages) {
      const index = selectPalaeoInterval(CAO_2017_MAP_INTERVALS, ageMa);
      expect(selectPalaeoCatalogInterval(catalog, ageMa)?.intervalId ?? null)
        .toBe(index < 0 ? null : CAO_2017_MAP_INTERVALS[index]!.id);
    }
  });
});

describe("payload and catalog cross-check", () => {
  const catalog = palaeoClassCatalogFixture({ intervals: [{ intervalId: "402-380", intervalIndex: 0,
    fromAgeMa: 402, toAgeMa: 380, bytes: 1, sha256: "a".repeat(64),
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
        bytes: 1, sha256: "a".repeat(64),
        pieces: 1, rings: 1, vertices: 4 }],
    });
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload({ pieces: [{ ...valid.pieces[0]!, lifecycleIndex: 1 }] }), outside, outside.intervals[0]!))
      .toThrow(/does not overlap its own interval/);
    expect(() => validatePalaeoRingPayloadAgainstCatalog(
      payload(valid), outside, outside.intervals[0]!)).not.toThrow();
  });
});

describe("columnar catalog expansion", () => {
  it("expands parallel arrays into rows and ships no chart table", () => {
    const document = palaeoClassCatalogDocumentFixture({ chartCount: 7_154, bindings: [
      { bindingPlateId: 101, partitionPlateId: 101, kind: 0, gapSet: 0 },
      { bindingPlateId: 315, partitionPlateId: 315, kind: 2, gapSet: 1 },
    ], gapSets: [[], [{ youngestMa: 119.999999, oldestMa: 120, reason: "source-seam" }]] });
    expect(document.charts).toBeUndefined();
    const catalog = decodePalaeoCoastlineClassCatalog(document);
    expect(catalog.chartCount).toBe(7_154);
    expect(catalog.bindings.map((binding) => [binding.bindingPlateId, binding.kind]))
      .toEqual([[101, "partition"], [315, "restoration"]]);
    // A gap set is resolved onto the row, so the runtime never carries the index.
    expect(catalog.bindings[0]!.motionSupportGaps).toEqual([]);
    expect(catalog.bindings[1]!.motionSupportGaps)
      .toEqual([{ youngestMa: 119.999999, oldestMa: 120, reason: "source-seam" }]);
    // The payload url is derived from the template, never listed per interval.
    expect(catalog.intervals[0]!.payload.url).toBe("palaeo-lm-402-380.ehpr");
    expect(catalog.intervals[0]!.reservation.maximumEdgeDegrees).toBe(1);
  });

  it("refuses a column that disagrees with its own row count", () => {
    const document = palaeoClassCatalogDocumentFixture();
    const bindings = document.bindings as Record<string, unknown>;
    bindings.count = 2;
    expect(() => decodePalaeoCoastlineClassCatalog(document))
      .toThrow(/binding column bindingPlateId disagrees/);
    bindings.count = 1;
    (bindings.kind as number[]).push(0);
    expect(() => decodePalaeoCoastlineClassCatalog(document))
      .toThrow(/binding column kind disagrees/);
  });

  it("refuses a foreign encoding, an out-of-range gap set and a missing empty gap set", () => {
    expect(() => decodePalaeoCoastlineClassCatalog({
      ...palaeoClassCatalogDocumentFixture(), encoding: "rows-v1" }))
      .toThrow(/unsupported palaeo-coastline class catalog encoding/);
    expect(() => decodePalaeoCoastlineClassCatalog(palaeoClassCatalogDocumentFixture({
      bindings: [{ bindingPlateId: 101, partitionPlateId: 101, kind: 0, gapSet: 4 }] })))
      .toThrow(/points outside its own tables/);
    expect(() => decodePalaeoCoastlineClassCatalog({
      ...palaeoClassCatalogDocumentFixture(),
      gapSets: [[{ youngestMa: 1, oldestMa: 2, reason: "source-seam" }]] }))
      .toThrow(/missing their empty set/);
  });

  it("bounds a piece's chartIndex by chartCount alone", () => {
    const catalog = palaeoClassCatalogFixture({ chartCount: 3, intervals: [{
      intervalId: "402-380", intervalIndex: 0, fromAgeMa: 402, toAgeMa: 380,
      bytes: 1, sha256: "a".repeat(64), pieces: 1, rings: 1, vertices: 4 }] });
    const decode = (chartIndex: number) => validatePalaeoRingPayloadAgainstCatalog(
      decodePalaeoRingPayload(encodePalaeoRingPayload({
        pieces: [{ chartIndex, rings: [{ lonLat: square(0, 0, 2) }] }] })),
      catalog, catalog.intervals[0]!);
    expect(() => decode(2)).not.toThrow();
    expect(() => decode(3)).toThrow(/catalog record that does not exist/);
  });
});

describe("palaeo-binding-entry-v1", () => {
  const catalog = palaeoClassCatalogFixture({ recoveryPlateIds: [626] });
  const selection = catalog.entrySelection;
  const entry = (entryId: string, plateId: number, youngestAgeMa: number, oldestAgeMa: number) =>
    ({ entryId, plateId, youngestAgeMa, oldestAgeMa });
  const select = (entries: ReturnType<typeof entry>[], plateId: number, ageMa: number) =>
    selectPalaeoBindingEntry(entries, selection, plateId, ageMa)?.entryId ?? null;

  it("takes the covering entry with the largest youngest bound, closed at both ends", () => {
    const entries = [entry("plate-315-0-130", 315, 0, 130), entry("plate-315-130-505", 315, 130, 505)];
    expect(select(entries, 315, 90)).toBe("plate-315-0-130");
    // Where two entries meet, the one the chain walks into going older wins.
    expect(select(entries, 315, 130)).toBe("plate-315-130-505");
    expect(select(entries, 315, 505)).toBe("plate-315-130-505");
    expect(select(entries, 315, 506)).toBeNull();
    expect(select([], 315, 90)).toBeNull();
  });

  it("prefers a restoration entry over the native chain that also covers the age", () => {
    // Without this a palaeo chart on 315 takes native motion and detaches ~72 km
    // from its restored shelf at 270 Ma.
    const entries = [entry("plate-315-130-505", 315, 130, 505),
      entry("restoration-north-sea-plate-315-130-420", 315, 130, 420)];
    expect(select(entries, 315, 270)).toBe("restoration-north-sea-plate-315-130-420");
    expect(select(entries, 315, 460)).toBe("plate-315-130-505");
  });

  it("never falls back off a recovery plate", () => {
    const entries = [entry("native-recovery-plate-626-0-79.1", 626, 0, 79.1),
      entry("native-recovery-plate-626-79.100001-120", 626, 79.100001, 120),
      entry("plate-626-0-200", 626, 0, 200)];
    expect(select(entries, 626, 60)).toBe("native-recovery-plate-626-0-79.1");
    expect(select(entries, 626, 100)).toBe("native-recovery-plate-626-79.100001-120");
    // 150 Ma is covered by the native entry alone: a recovery plate is unposable there.
    expect(select(entries, 626, 150)).toBeNull();
    // The same entries on a plate that is not declared a recovery plate do fall back.
    expect(select(entries, 101, 150)).toBe("plate-626-0-200");
  });

  it("prefers a correction entry only at and above 410 Ma", () => {
    const entries = [entry("plate-201-0-540", 201, 0, 540),
      entry("correction-plate-201-0-540", 201, 0, 540)];
    expect(select(entries, 201, 409.999)).toBe("plate-201-0-540");
    expect(select(entries, 201, 410)).toBe("correction-plate-201-0-540");
    expect(select(entries, 201, 500)).toBe("correction-plate-201-0-540");
    // Only a correction entry covers the age: it is taken below 410 Ma too.
    expect(select([entries[1]!], 201, 100)).toBe("correction-plate-201-0-540");
  });

  it("reads a declared source seam as open at both ends", () => {
    const seamed = palaeoClassCatalogFixture({
      bindings: [{ bindingPlateId: 626, partitionPlateId: 626, kind: 3, gapSet: 1 }],
      gapSets: [[], [{ youngestMa: 119.999999, oldestMa: 120, reason: "source-seam" }]] });
    const binding = seamed.bindings[0]!;
    expect(palaeoBindingSeamCoversAge(binding, 119.9999995)).toBe(true);
    expect(palaeoBindingSeamCoversAge(binding, 120)).toBe(false);
    expect(palaeoBindingSeamCoversAge(binding, 119.999999)).toBe(false);
    expect(palaeoBindingSeamCoversAge(seamed.bindings[0]!, 90)).toBe(false);
  });

  it("indexes palette entries by the plate they pose", () => {
    const byPlate = indexPalaeoPaletteEntriesByPlate([
      entry("plate-101-0-100", 101, 0, 100), entry("plate-101-100-200", 101, 100, 200),
      entry("plate-201-0-100", 201, 0, 100)]);
    expect(byPlate.get(101)).toHaveLength(2);
    expect(byPlate.get(201)).toHaveLength(1);
    expect(byPlate.get(999)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CAO_2017_MAP_INTERVALS,
  CAO_2017_MAP_INTERVAL_MARKS_MA,
  PALAEO_INTERVAL_INITIAL_SELECTION,
  PALAEO_OUTLINE_TONE_DEEP,
  PALAEO_OUTLINE_TONE_HEADER_BYTES,
  PALAEO_OUTLINE_TONE_INACTIVE,
  PALAEO_OUTLINE_TONE_LAND,
  PALAEO_OUTLINE_TONE_SHALLOW,
  PALAEO_OUTLINE_TONE_TEXTURE_WIDTH,
  buildPalaeoOutlineToneTexels,
  decodePalaeoOutlineToneTables,
  encodePalaeoOutlineToneTables,
  nextPalaeoIntervalSelection,
  palaeoIntervalEvidenceStatus,
  palaeoIntervalLabel,
  palaeoOutlineToneBytesPerTable,
  palaeoOutlineToneClass,
  palaeoOutlineToneCounts,
  palaeoOutlineToneTextureRows,
  selectPalaeoInterval,
  type PalaeoOutlineToneClass,
} from "./outlineTones";

/** The shipped country-line batch: the segment count every table must match. */
const COUNTRY_LINE_SEGMENTS = 12_045;

function table(segmentCount: number, pattern: (index: number) => PalaeoOutlineToneClass) {
  return Array.from({ length: segmentCount }, (_, index) => pattern(index));
}

describe("palaeo outline tone tables (EHPT v1)", () => {
  it("round-trips every tone class through the packed 2-bit form", () => {
    // A segment count that is not a multiple of four, so the last byte is
    // partly padding: a decoder that read the padding as a segment would read
    // four extra dark segments here.
    const segmentCount = 13;
    const classes = table(segmentCount, (index) => (index % 4) as PalaeoOutlineToneClass);
    const second = table(segmentCount, () => PALAEO_OUTLINE_TONE_SHALLOW);
    const bytes = encodePalaeoOutlineToneTables([classes, second], segmentCount);
    expect(palaeoOutlineToneBytesPerTable(segmentCount)).toBe(4);
    expect(bytes.byteLength).toBe(PALAEO_OUTLINE_TONE_HEADER_BYTES + 2 * 4);

    const tables = decodePalaeoOutlineToneTables(bytes, segmentCount);
    expect(tables).toMatchObject({ version: 1, tableCount: 2, segmentCount, bytesPerTable: 4 });
    for (let index = 0; index < segmentCount; index += 1) {
      expect(palaeoOutlineToneClass(tables, 0, index)).toBe(classes[index]);
      expect(palaeoOutlineToneClass(tables, 1, index)).toBe(PALAEO_OUTLINE_TONE_SHALLOW);
    }
    // Both water classes take the light ink; land and an inactive segment do not.
    expect(palaeoOutlineToneCounts(tables, 0)).toEqual({
      darkSegments: 7, lightSegments: 6, inactiveSegments: 3,
    });
    expect(palaeoOutlineToneCounts(tables, 1))
      .toEqual({ darkSegments: 0, lightSegments: 13, inactiveSegments: 0 });

    // Indices outside the payload are a fault, not a silently clamped read.
    expect(() => palaeoOutlineToneClass(tables, 2, 0)).toThrow(/table index/);
    expect(() => palaeoOutlineToneClass(tables, 0, segmentCount)).toThrow(/segment index/);
  });

  it("rejects a malformed or mismatched payload instead of decoding it", () => {
    const segmentCount = 8;
    const classes = table(segmentCount, () => PALAEO_OUTLINE_TONE_DEEP);
    const good = encodePalaeoOutlineToneTables([classes], segmentCount);
    expect(() => decodePalaeoOutlineToneTables(good, segmentCount)).not.toThrow();

    const shortPayload = good.slice(0, PALAEO_OUTLINE_TONE_HEADER_BYTES - 1);
    expect(() => decodePalaeoOutlineToneTables(shortPayload, segmentCount))
      .toThrow(/shorter than its header/);

    const wrongMagic = good.slice();
    wrongMagic[0] = 0x45 + 1;
    expect(() => decodePalaeoOutlineToneTables(wrongMagic, segmentCount)).toThrow(/not EHPT/);

    const wrongVersion = good.slice();
    new DataView(wrongVersion.buffer).setUint16(4, 2, true);
    expect(() => decodePalaeoOutlineToneTables(wrongVersion, segmentCount))
      .toThrow(/unsupported palaeo outline tone version 2/);

    const wrongHeader = good.slice();
    new DataView(wrongHeader.buffer).setUint16(6, 40, true);
    expect(() => decodePalaeoOutlineToneTables(wrongHeader, segmentCount))
      .toThrow(/header length/);

    // The table is addressed by segment index, so a table compiled against a
    // different outline package would address the wrong segments with every
    // index still in range. That is the defect the count argument catches.
    expect(() => decodePalaeoOutlineToneTables(good, segmentCount + 1))
      .toThrow(/does not match the country line batch/);

    const wrongStride = good.slice();
    new DataView(wrongStride.buffer).setUint32(16, 3, true);
    expect(() => decodePalaeoOutlineToneTables(wrongStride, segmentCount)).toThrow(/table stride/);

    const truncated = good.slice(0, good.byteLength - 1);
    expect(() => decodePalaeoOutlineToneTables(truncated, segmentCount)).toThrow(/bytes, expected/);

    const reservedSet = good.slice();
    reservedSet[24] = 1;
    expect(() => decodePalaeoOutlineToneTables(reservedSet, segmentCount))
      .toThrow(/reserved header bytes/);

    const noTables = good.slice();
    new DataView(noTables.buffer).setUint32(8, 0, true);
    expect(() => decodePalaeoOutlineToneTables(noTables, segmentCount)).toThrow(/no table/);
  });

  it("expands a table into R8 texels the material samples by segment index", () => {
    const segmentCount = COUNTRY_LINE_SEGMENTS;
    const classes = table(segmentCount, (index) =>
      (index % 3 === 0 ? PALAEO_OUTLINE_TONE_SHALLOW : PALAEO_OUTLINE_TONE_LAND));
    const tables = decodePalaeoOutlineToneTables(
      encodePalaeoOutlineToneTables([classes], segmentCount), segmentCount);
    const rows = palaeoOutlineToneTextureRows(segmentCount);
    expect(rows).toBe(Math.ceil(segmentCount / PALAEO_OUTLINE_TONE_TEXTURE_WIDTH));

    const texels = buildPalaeoOutlineToneTexels(tables, 0);
    expect(texels.length).toBe(rows * PALAEO_OUTLINE_TONE_TEXTURE_WIDTH);
    expect(texels[0]).toBe(255);
    expect(texels[1]).toBe(0);
    expect(texels[3]).toBe(255);
    // Padding past the last segment must stay dark: a light pad texel would be
    // read by no segment today and by a real one after any count change.
    for (let index = segmentCount; index < texels.length; index += 1) {
      expect(texels[index]).toBe(0);
    }
    expect([...texels].filter((value) => value === 255))
      .toHaveLength(Math.ceil(segmentCount / 3));
  });

  it("keeps the canonical interval table identical to the Cao 2017 audit record", async () => {
    const audit = JSON.parse(await readFile(
      resolve("docs/research/palaeo-coastlines-cao2017-audit.json"), "utf8")) as {
        schedule: {
          canonicalIntervalCount: number;
          canonicalIntervals: { intervalId: string; fromAgeMa: number; toAgeMa: number }[];
        };
      };
    expect(audit.schedule.canonicalIntervalCount).toBe(24);
    expect(CAO_2017_MAP_INTERVALS).toHaveLength(24);
    expect(CAO_2017_MAP_INTERVALS.map((interval) => ({
      id: interval.id, youngestMa: interval.youngestMa, oldestMa: interval.oldestMa,
    }))).toEqual(audit.schedule.canonicalIntervals.map((interval) => ({
      id: interval.intervalId, youngestMa: interval.toAgeMa, oldestMa: interval.fromAgeMa,
    })));
    expect(CAO_2017_MAP_INTERVAL_MARKS_MA).toHaveLength(24);
    expect(CAO_2017_MAP_INTERVAL_MARKS_MA[0]).toBe(402);
    expect(CAO_2017_MAP_INTERVAL_MARKS_MA.at(-1)).toBe(11);
    expect(palaeoIntervalLabel(CAO_2017_MAP_INTERVALS[16]!)).toBe("94–81 Ma");
  });

  it("selects an interval by the source's half-open lifecycle rule", () => {
    const at = (ageMa: number) => {
      const index = selectPalaeoInterval(CAO_2017_MAP_INTERVALS, ageMa);
      return index < 0 ? null : CAO_2017_MAP_INTERVALS[index]!.id;
    };
    // The oldest bound is inclusive, so the domain's oldest age is mapped.
    expect(at(402)).toBe("402-380");
    expect(at(402.001)).toBeNull();
    // A shared bound belongs to the younger interval: 402-380 runs down to
    // 380.01 exclusive, so 380 itself is the first age of 380-359.
    expect(at(380)).toBe("380-359");
    expect(at(380.02)).toBe("402-380");
    // The 10 kyr the source leaves between two intervals belongs to neither,
    // and is answered as a gap rather than assigned to the nearest map.
    expect(at(380.005)).toBeNull();
    // Inside an interval, including the witnesses the audit probed.
    expect(at(90)).toBe("94-81");
    expect(at(260)).toBe("269-248");
    // The youngest bound is exclusive, so the domain's own youngest age has no
    // map and falls back like the present day does.
    expect(at(2.01)).toBeNull();
    expect(at(2.02)).toBe("11-2");
    expect(at(0)).toBeNull();
    expect(at(Number.NaN)).toBeNull();
    // Every canonical interval is reachable, and exactly one at each 5 Ma
    // checkpoint the audit measured.
    for (let age = 5; age <= 400; age += 5) {
      expect(CAO_2017_MAP_INTERVALS.filter((interval) =>
        age > interval.youngestMa && age <= interval.oldestMa)).toHaveLength(1);
    }
  });

  it("holds an interval change for a second frame so a bound cannot churn", () => {
    let state = PALAEO_INTERVAL_INITIAL_SELECTION;
    expect(state.index).toBe(-1);
    // A real crossing costs exactly one frame.
    state = nextPalaeoIntervalSelection(state, 16);
    expect(state.index).toBe(-1);
    state = nextPalaeoIntervalSelection(state, 16);
    expect(state.index).toBe(16);
    // A scrub resting on a bound alternates every frame and must never commit
    // the other interval: each swap is a geometry replacement and a tone upload.
    for (let frame = 0; frame < 8; frame += 1) {
      state = nextPalaeoIntervalSelection(state, frame % 2 === 0 ? 17 : 16);
      expect(state.index).toBe(16);
    }
    // And the delay does not accumulate: two agreeing frames still commit.
    state = nextPalaeoIntervalSelection(state, 17);
    state = nextPalaeoIntervalSelection(state, 17);
    expect(state.index).toBe(17);
    // Leaving the domain is the same one-frame rule.
    state = nextPalaeoIntervalSelection(state, -1);
    expect(state.index).toBe(17);
    state = nextPalaeoIntervalSelection(state, -1);
    expect(state.index).toBe(-1);
  });

  it("reports the epistemic status of the interval on screen", () => {
    const interval = CAO_2017_MAP_INTERVALS[16]!;
    // The published map's own age is the model output; anywhere else inside the
    // bin the same polygons are held under an interpolated pose.
    expect(palaeoIntervalEvidenceStatus(interval, 94, false)).toBe("model-output");
    expect(palaeoIntervalEvidenceStatus(interval, 90, false)).toBe("interpolation");
    expect(palaeoIntervalEvidenceStatus(interval, 81.02, false)).toBe("interpolation");
    // An edited chart is a synthesis at every age, including the map age.
    expect(palaeoIntervalEvidenceStatus(interval, 94, true)).toBe("synthesis");
    expect(palaeoIntervalEvidenceStatus(interval, 90, true)).toBe("synthesis");
    // No interval is not "no evidence of land": it is an unresolved status.
    expect(palaeoIntervalEvidenceStatus(null, 0, false)).toBe("unknown");
    expect(PALAEO_OUTLINE_TONE_LAND).toBe(0);
    expect(PALAEO_OUTLINE_TONE_INACTIVE).toBe(3);
  });
});

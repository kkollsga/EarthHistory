import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CaoReconstructionRuntime } from "./engineV2";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import type { ReconstructionPackageManifestV2 } from "./packageV2";

const packageRoot = resolve("public/data/reconstruction/cao-v2.4");

const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(packageRoot, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const EXACT_PRESENT_PREFIX = "country-present-reference:";
/** Central-Africa reading box used by the dashed-border reproduction captures. */
const CENTRAL_AFRICA = { lonMin: -5, lonMax: 40, latMin: 0, latMax: 35 } as const;

async function loadManifest(): Promise<ReconstructionPackageManifestV2> {
  return JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
}

function lonLat(x: number, y: number, z: number): [number, number] {
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI];
}

describe("modern-country reference segments at reconstructed ages", () => {
  it("keeps every segment active at 0 Ma and follows source fragments above it", async () => {
    const runtime = new CaoReconstructionRuntime(await loadManifest(), fetcher);
    try {
      const modern = await runtime.request(0).prepared;
      const line = modern.lineBatches.find((batch) => batch.batchId === "country-reference")!;
      const modernGeometry = line.createStaticGeometryCopy();
      const inactiveAtPresent = [];
      for (let segment = 0; segment < line.segmentCount; segment += 1) {
        const chart = modern.charts[modernGeometry.materialChartIndices[
          modernGeometry.lineIndices[segment * 2]!]!]!;
        if (chart.support.kind !== "supported") inactiveAtPresent.push(segment);
      }
      expect(line.segmentCount).toBe(51_048);
      expect(inactiveAtPresent).toEqual([]);
      modern.release();

      const past = await runtime.request(71.65).prepared;
      const pastLine = past.lineBatches.find((batch) => batch.batchId === "country-reference")!;
      const geometry = pastLine.createStaticGeometryCopy();
      let inBox = 0;
      let inactiveInBox = 0;
      let inactiveOnExactPresent = 0;
      let inactiveTotal = 0;
      for (let segment = 0; segment < pastLine.segmentCount; segment += 1) {
        const vertex = geometry.lineIndices[segment * 2]!;
        const chart = past.charts[geometry.materialChartIndices[vertex]!]!;
        const inactive = chart.support.kind !== "supported";
        if (inactive) {
          inactiveTotal += 1;
          if (chart.chartId.startsWith(EXACT_PRESENT_PREFIX)) inactiveOnExactPresent += 1;
        }
        const [lon, lat] = lonLat(geometry.referenceDirections[vertex * 3]!,
          geometry.referenceDirections[vertex * 3 + 1]!, geometry.referenceDirections[vertex * 3 + 2]!);
        if (lon < CENTRAL_AFRICA.lonMin || lon > CENTRAL_AFRICA.lonMax
            || lat < CENTRAL_AFRICA.latMin || lat > CENTRAL_AFRICA.latMax) continue;
        inBox += 1;
        if (inactive) {
          inactiveInBox += 1;
          // A central-Africa gap is only defensible where no accepted Cao
          // static fragment owns the segment at all.
          expect(chart.chartId.startsWith(EXACT_PRESENT_PREFIX)).toBe(true);
        }
      }
      // Bridged complement segments over one Africa plate; the survivors are the
      // subdivisions with no accepted neighbouring segment in the source partition.
      expect({ inBox, inactiveInBox }).toEqual({ inBox: 2_706, inactiveInBox: 13 });
      expect(inactiveTotal).toBe(5_435);
      expect(inactiveOnExactPresent).toBe(1_057);
      past.release();
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it("binds each formerly dashed Niger segment to the Cao plate verified at its shared endpoint", async () => {
    const runtime = new CaoReconstructionRuntime(await loadManifest(), fetcher);
    try {
      const revision = await runtime.request(71.65).prepared;
      const line = revision.lineBatches.find((batch) => batch.batchId === "country-reference")!;
      const geometry = line.createStaticGeometryCopy();
      const observed = [48_957, 48_958, 48_959, 48_960, 48_961, 48_962].map((segment) => {
        const chart = revision.charts[geometry.materialChartIndices[
          geometry.lineIndices[segment * 2]!]!]!;
        const plate = /:plate:(\d+):/.exec(chart.chartId)?.[1] ?? null;
        return { segment, plate, support: chart.support.kind, materialId: chart.materialId };
      });
      expect(observed).toEqual([
        { segment: 48_957, plate: "77141", support: "supported", materialId: "country:ner" },
        { segment: 48_958, plate: "77144", support: "supported", materialId: "country:ner" },
        { segment: 48_959, plate: "760", support: "supported", materialId: "country:ner" },
        { segment: 48_960, plate: "77144", support: "supported", materialId: "country:ner" },
        { segment: 48_961, plate: "760", support: "supported", materialId: "country:ner" },
        { segment: 48_962, plate: "77144", support: "supported", materialId: "country:ner" },
      ]);
      revision.release();
    } finally {
      runtime.dispose();
    }
  }, 120_000);
});

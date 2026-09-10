import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { evaluateCaoMotionFrame, resolveCaoDisplayBracket } from "./motionFrameV2";
import type { StaticAssetFetcher } from "./assetLoader";
import type { ReconstructionPackageManifestV2 } from "./packageV2";
import { loadVerifiedCaoFoundation } from "./loaderV2";

const root = resolve("public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("continuous Cao motion frames", () => {
  it("resolves display brackets from the live package domain without inventing ages", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    expect(manifest.ageDomainMa).toEqual({ youngest: 0, oldest: 540 });
    expect(resolveCaoDisplayBracket(manifest, 227.5)).toEqual({
      youngerAgeMa: 225, olderAgeMa: 230, fraction: 0.5, exactCheckpoint: false,
    });
    expect(resolveCaoDisplayBracket(manifest, 450)).toMatchObject({
      youngerAgeMa: 450, olderAgeMa: 450, fraction: 0, exactCheckpoint: true,
    });
    expect(() => resolveCaoDisplayBracket(manifest, 541)).toThrow(/domain/);
  });

  it("interpolates motion continuously between checkpoints and reuses evaluateMotion", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    const younger = evaluateCaoMotionFrame(manifest, foundation, 100);
    const mid = evaluateCaoMotionFrame(manifest, foundation, 102.5);
    const older = evaluateCaoMotionFrame(manifest, foundation, 105);
    expect(mid.display.fraction).toBeCloseTo(0.5, 6);
    expect(mid.entryCount).toBe(younger.entryCount);
    expect(mid.paletteValues).toHaveLength(mid.entryCount * 11);

    const supported = mid.charts.findIndex((chart) => chart.support.kind === "supported");
    expect(supported).toBeGreaterThanOrEqual(0);
    const offset = supported * 11;
    // Mid-frame motion fraction should sit between the endpoint evaluations for the
    // same chart when the subsegment spans the sample (not a discrete snap cheat).
    expect(mid.paletteValues[offset + 8]!).toBeGreaterThanOrEqual(0);
    expect(mid.paletteValues[offset + 8]!).toBeLessThanOrEqual(1);
    // Continuous ages must not collapse to a single discrete prepared snap.
    const midRow = mid.paletteValues.slice(offset, offset + 11);
    const youngRow = younger.paletteValues.slice(offset, offset + 11);
    expect(midRow.some((value, index) => value !== youngRow[index])).toBe(true);

    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const viaRuntime = await runtime.evaluateMotion(102.5);
    expect(viaRuntime.display).toEqual(mid.display);
    expect(viaRuntime.paletteValues[offset + 8]).toBeCloseTo(mid.paletteValues[offset + 8]!, 6);
    // Prefetch stays bounded to resident checkpoint capacity.
    await runtime.prefetchCheckpoints([100, 105, 110, 115]);
    expect(runtime.ledger.checkpoint.residentCount).toBeLessThanOrEqual(2);
    runtime.dispose();
    expect(older.requestedAgeMa).toBe(105);
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime, chartPickStateFromMotionFrame, packageAssetPath,
  type ReconstructionPackageManifestV2, type StaticAssetFetcher } from "./index";
import { createCaoFoundationGeometryResource, intersectCaoFoundationSurface }
  from "../render/reconstruction/caoFoundation";

/**
 * Cao v2.4 keeps the UK rigid relative to Baltica from 0 to 430 Ma, so the
 * North Sea rift never opened in the app. The tracked North Sea restoration
 * contract rotates the UK-side charts toward Norway between 130 and 430 Ma by
 * the published Mesozoic extension. This probe follows the charts under the
 * witness cities through the runtime and checks the closure the contract pins.
 */

const root = resolve("public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url) => {
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const direction = (lon: number, lat: number): [number, number, number] => {
  const a = lon * Math.PI / 180;
  const b = lat * Math.PI / 180;
  const c = Math.cos(b);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(b)];
};
const toRenderer = (d: readonly [number, number, number]): [number, number, number] => [d[0], d[2], -d[1]];
const km = (a: readonly number[], b: readonly number[]) =>
  Math.acos(Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!)) * 6371.0088;
const limits = { maxBatches: 512, maxVertices: 520_000, maxTriangles: 660_000,
  maxRetainedSourceBytes: 48 * 1024 * 1024, maxTextureSize: 2_048,
  maxPublicationBytes: 2 * 1024 * 1024, maxSpatialIndexBytes: 1024 * 1024 };

const SITES: Record<string, [number, number]> = {
  Shetland: [-1.2, 60.4], Aberdeen: [-2.1, 57.1], London: [-0.1, 51.5],
  Bergen: [5.3, 60.4], Stavanger: [5.73, 58.97], Amsterdam: [4.9, 52.37], Paris: [2.35, 48.86],
};

interface Contract {
  windowMa: { youngest: number; oldest: number };
  witnesses: { toleranceKm: number };
  angleSchedule: { ageMa: number; witnessClosureKm: Record<string, number> }[];
}

describe("North Sea restoration", () => {
  it("closes the Shetland-Bergen transect by the contract schedule and leaves Baltica fixed", async () => {
    const contract = JSON.parse(await readFile(
      resolve("data/corrections/north-sea-restoration/restoration-contract.json"), "utf8")) as Contract;
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const present = await runtime.request(0).prepared;
    const resource = createCaoFoundationGeometryResource(present, limits);
    const frame0 = await runtime.evaluateMotion(0);
    const pick0 = chartPickStateFromMotionFrame(frame0);
    const carriers = Object.fromEntries(Object.entries(SITES).map(([name, [lon, lat]]) => {
      const d = toRenderer(direction(lon, lat));
      const hit = intersectCaoFoundationSurface(resource,
        { chartPoses: pick0.chartPoses, chartActive: pick0.chartActive },
        [d[0] * 3, d[1] * 3, d[2] * 3], [-d[0], -d[1], -d[2]]);
      expect(hit, `${name} has a chart at present`).not.toBeNull();
      return [name, hit!.chartIndex];
    }));
    const positions = async (ageMa: number) => {
      const revision = ageMa === 0 ? present : await runtime.request(ageMa).prepared;
      const out: Record<string, readonly [number, number, number]> = {};
      for (const [name, [lon, lat]] of Object.entries(SITES)) {
        const pose = revision.resolveAddress(revision.addressForChartDirection(carriers[name]!, direction(lon, lat)));
        expect(pose.support.kind, `${name} at ${ageMa} Ma`).toBe("supported");
        out[name] = pose.direction!;
      }
      if (ageMa !== 0) revision.release();
      return out;
    };
    const presentPositions = await positions(0);
    const presentKm = (a: string, b: string) => km(presentPositions[a]!, presentPositions[b]!);
    const closureAt = (p: Record<string, readonly [number, number, number]>, a: string, b: string) =>
      presentKm(a, b) - km(p[a]!, p[b]!);
    // No restoration in the post-rift interval.
    for (const ageMa of [20, 100, contract.windowMa.youngest]) {
      const p = await positions(ageMa);
      expect(Math.abs(closureAt(p, "Shetland", "Bergen")), `no closure at ${ageMa} Ma`).toBeLessThan(0.5);
    }
    // Schedule knots inside the window reproduce the pinned closures.
    for (const row of contract.angleSchedule) {
      if (row.ageMa <= contract.windowMa.youngest || row.ageMa > 420) continue;
      const p = await positions(row.ageMa);
      for (const [pair, expected] of Object.entries(row.witnessClosureKm)) {
        const [a, b] = pair.split("-") as [string, string];
        expect(closureAt(p, a, b), `${pair} at ${row.ageMa} Ma`).toBeCloseTo(expected, -Math.log10(contract.witnesses.toleranceKm));
      }
      // Baltica-side witnesses share one rigid motion with each other and with Paris (Armorica-Baltica).
      expect(Math.abs(closureAt(p, "Bergen", "Amsterdam"))).toBeLessThan(0.5);
      expect(Math.abs(closureAt(p, "Bergen", "Stavanger"))).toBeLessThan(0.5);
    }
    // Full closure holds through the Carboniferous up to the Caledonian seam.
    const p300 = await positions(300);
    const p420 = await positions(420);
    const total = contract.angleSchedule.at(-1)!.witnessClosureKm["Shetland-Bergen"]!;
    expect(closureAt(p300, "Shetland", "Bergen")).toBeCloseTo(total, 0);
    expect(closureAt(p420, "Shetland", "Bergen")).toBeCloseTo(total, 0);
    present.release();
    resource.dispose();
    runtime.dispose();
  }, 120_000);
});

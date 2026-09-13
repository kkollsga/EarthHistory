import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import { loadVerifiedCaoFoundationMetadata, loadVerifiedCaoRequestedAgeMotionPalette,
  validateRequestedAgePaletteCoverage } from "./loaderV2";
import { decodeMotionPalette, selectPaletteMotionSubsegment, type PreparedPaletteEntry } from "./palette";
import { selectRequestedAgeMotionTile, validateRequestedAgeMotionTileIndex,
  verifyRequestedAgeMotionTileSourceIdentity, type RequestedAgeMotionTileIndex } from "./motionTiles";
import type { ReconstructionPackageManifestV2 } from "./packageV2";

const root = resolve(process.cwd(), "public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url) => {
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

async function fixture() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
  const index = JSON.parse(await readFile(resolve(root, manifest.motionPalette.requestedAgeTiles!.url), "utf8")) as
    RequestedAgeMotionTileIndex;
  const metadata = await loadVerifiedCaoFoundationMetadata(manifest, fetcher);
  return { manifest, index, metadata };
}

describe("requested-age motion tiles", () => {
  it("selects raw half-open windows without blurring sub-micro ages", async () => {
    const { manifest, index } = await fixture();
    validateRequestedAgeMotionTileIndex(index, manifest);
    expect(selectRequestedAgeMotionTile(index, 24.9999999).tileId).toContain("0000-0025");
    expect(selectRequestedAgeMotionTile(index, 25).tileId).toContain("0025-0050");
    expect(selectRequestedAgeMotionTile(index, 25.0000001).tileId).toContain("0025-0050");

    const mutated = structuredClone(index) as unknown as
      RequestedAgeMotionTileIndex & { tiles: Array<RequestedAgeMotionTileIndex["tiles"][number]> };
    mutated.tiles[0] = { ...mutated.tiles[0]!, validTimeMa: {
      ...mutated.tiles[0]!.validTimeMa, oldest: 25.0000001,
    } };
    expect(() => validateRequestedAgeMotionTileIndex(mutated, manifest))
      .toThrow(/tile descriptor/);
  });

  it.each([0, 74, 411, 1_800])("matches the all-age source records and pose at %s Ma", async (age) => {
    const { manifest, index, metadata } = await fixture();
    const tile = await loadVerifiedCaoRequestedAgeMotionPalette(manifest, metadata, age, fetcher, undefined, index);
    const fullBytes = await fetcher(manifest.motionPalette.binary.url);
    const full = decodeMotionPalette(metadata.paletteCatalog, fullBytes);
    await verifyRequestedAgeMotionTileSourceIdentity(tile.descriptor, tile.entries, full);
    validateRequestedAgePaletteCoverage(metadata.core, tile.entries, age);
    for (const [entryId, tiledEntry] of tile.entries) {
      const tiled = selectPaletteMotionSubsegment(tiledEntry, age);
      const source = selectPaletteMotionSubsegment(full.get(entryId)!, age);
      if (tiled === null) continue;
      expect(tiled).toEqual(source);
    }
  });

  it("rejects a missing active binding and an insufficient bracket before publication", async () => {
    const age = 411.013;
    const { manifest, index, metadata } = await fixture();
    const tile = await loadVerifiedCaoRequestedAgeMotionPalette(manifest, metadata, age, fetcher, undefined, index);
    const active = metadata.core.charts.find((chart) => chart.lifecycle.validTimeMa.youngest <= age
      && chart.lifecycle.validTimeMa.oldest >= age
      && (chart.motionBindings ?? []).some((binding) => binding.validTimeMa.youngest <= age
        && binding.validTimeMa.oldest >= age))!;
    const entryId = (active.motionBindings ?? []).filter((binding) => binding.validTimeMa.youngest <= age
      && binding.validTimeMa.oldest >= age).sort((left, right) => left.entryId.localeCompare(right.entryId))[0]!.entryId;
    const missing = new Map(tile.entries);
    missing.delete(entryId);
    expect(() => validateRequestedAgePaletteCoverage(metadata.core, missing, age)).toThrow(/does not cover/);

    const inadequate = new Map(tile.entries);
    const entry = inadequate.get(entryId)!;
    inadequate.set(entryId, Object.freeze({ ...entry, sampleCount: 1,
      oldestAgeMa: entry.youngestAgeMa }) as PreparedPaletteEntry);
    expect(() => validateRequestedAgePaletteCoverage(metadata.core, inadequate, age)).toThrow(/does not cover/);
  });
});

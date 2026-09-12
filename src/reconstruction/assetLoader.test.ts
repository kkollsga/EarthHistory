import { describe, expect, it } from "vitest";
import {
  contentAddressedAssetUrl,
  loadVerifiedBytes,
  packageAssetPath,
} from "./assetLoader";

describe("content-addressed Cao asset URLs", () => {
  it("appends the sha256 so stale caches cannot mix package promotes", () => {
    const asset = {
      url: "core.json",
      bytes: 4,
      sha256: "abcd".repeat(16),
    };
    expect(contentAddressedAssetUrl(asset)).toBe(`core.json?h=${asset.sha256}`);
    expect(packageAssetPath(contentAddressedAssetUrl(asset))).toBe("core.json");
  });

  it("rejects mismatched bytes after a content-addressed fetch", async () => {
    const asset = {
      url: "core.json",
      bytes: 4,
      sha256: "0".repeat(64),
    };
    await expect(loadVerifiedBytes(asset, async (url) => {
      expect(url).toContain("?h=");
      return new TextEncoder().encode("nope").buffer;
    })).rejects.toThrow(/verification failed \(core\.json\)/);
  });
});

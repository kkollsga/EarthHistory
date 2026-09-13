import { describe, expect, it } from "vitest";
import {
  contentAddressedAssetCacheMode,
  contentAddressedAssetUrl,
  loadVerifiedBytes,
  packageAssetPath,
} from "./assetLoader";

async function digest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("content-addressed Cao asset URLs", () => {
  it("appends the sha256 so stale caches cannot mix package promotes", () => {
    const asset = {
      url: "core.json",
      bytes: 4,
      sha256: "abcd".repeat(16),
    };
    expect(contentAddressedAssetUrl(asset)).toBe(`core.json?h=${asset.sha256}`);
    expect(packageAssetPath(contentAddressedAssetUrl(asset))).toBe("core.json");
    expect(contentAddressedAssetCacheMode(contentAddressedAssetUrl(asset))).toBe("force-cache");
  });

  it("caches only exact hash-qualified package requests", () => {
    const digest = "abcd".repeat(16);
    expect(contentAddressedAssetCacheMode(`core.json?h=${digest}`)).toBe("force-cache");
    expect(contentAddressedAssetCacheMode(`https://example.test/core.json?h=${digest}`)).toBe("force-cache");
    expect(contentAddressedAssetCacheMode("core.json")).toBe("no-store");
    expect(contentAddressedAssetCacheMode("core.json?h=abcd")).toBe("no-store");
    expect(contentAddressedAssetCacheMode(`core.json?h=${digest}&extra=1`)).toBe("no-store");
    expect(contentAddressedAssetCacheMode(`core.json?h=${digest}#fragment`)).toBe("no-store");
  });

  it("canonicalizes a sole stale hash query and leaves unknown queries uncached", () => {
    const current = "abcd".repeat(16);
    const stale = "1234".repeat(16);
    expect(contentAddressedAssetUrl({
      url: `core.json?h=${stale}`,
      bytes: 4,
      sha256: current,
    })).toBe(`core.json?h=${current}`);
    const unknown = contentAddressedAssetUrl({
      url: "core.json?download=1",
      bytes: 4,
      sha256: current,
    });
    expect(unknown).toBe("core.json?download=1");
    expect(contentAddressedAssetCacheMode(unknown)).toBe("no-store");
  });

  it("loads promoted same-filename bytes under their current verified hashes", async () => {
    const firstBytes = new TextEncoder().encode("first package").buffer as ArrayBuffer;
    const secondBytes = new TextEncoder().encode("second package").buffer as ArrayBuffer;
    const [firstHash, secondHash] = await Promise.all([digest(firstBytes), digest(secondBytes)]);
    const staleAuthoredHash = "0".repeat(64);
    const requests: string[] = [];
    const cache = new Map<string, ArrayBuffer>();
    const origins = new Map([
      [`core.json?h=${firstHash}`, firstBytes],
      [`core.json?h=${secondHash}`, secondBytes],
    ]);
    const fetcher = async (url: string) => {
      requests.push(url);
      const cached = cache.get(url);
      if (cached) return cached;
      const bytes = origins.get(url);
      if (!bytes) throw new Error(`unexpected package URL ${url}`);
      cache.set(url, bytes);
      return bytes;
    };

    const first = await loadVerifiedBytes({
      url: `core.json?h=${staleAuthoredHash}`,
      bytes: firstBytes.byteLength,
      sha256: firstHash,
    }, fetcher);
    const second = await loadVerifiedBytes({
      url: `core.json?h=${staleAuthoredHash}`,
      bytes: secondBytes.byteLength,
      sha256: secondHash,
    }, fetcher);

    expect(new TextDecoder().decode(first)).toBe("first package");
    expect(new TextDecoder().decode(second)).toBe("second package");
    expect(requests).toEqual([`core.json?h=${firstHash}`, `core.json?h=${secondHash}`]);
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

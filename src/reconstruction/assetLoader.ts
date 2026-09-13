import type { PackageAsset } from "./identity";

export type StaticAssetFetcher = (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

const SHA256 = /^[a-f0-9]{64}$/;

/** Content-addressed URL so browser/CDN caches cannot mix old bytes with a new manifest. */
export function contentAddressedAssetUrl(asset: PackageAsset): string {
  if (!asset.url || !SHA256.test(asset.sha256)) return asset.url;
  const query = asset.url.indexOf("?");
  if (query < 0) return `${asset.url}?h=${asset.sha256}`;
  const base = asset.url.slice(0, query);
  const rawQuery = asset.url.slice(query + 1);
  const params = new URLSearchParams(rawQuery);
  return !rawQuery.includes("#") && params.size === 1 && params.has("h")
    ? `${base}?h=${asset.sha256}`
    : asset.url;
}

/** Immutable hash-qualified package bytes may reuse the browser HTTP cache. */
export function contentAddressedAssetCacheMode(url: string): RequestCache {
  try {
    const parsed = new URL(url, "https://earthhistory.invalid/");
    const digest = parsed.searchParams.get("h");
    return parsed.hash === "" && parsed.searchParams.size === 1 && digest !== null && SHA256.test(digest)
      ? "force-cache"
      : "no-store";
  } catch {
    return "no-store";
  }
}

/** Strip the content-address query for filesystem fetchers in tests. */
export function packageAssetPath(url: string): string {
  const query = url.indexOf("?");
  return query < 0 ? url : url.slice(0, query);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadVerifiedBytes(
  asset: PackageAsset,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  const bytes = await fetcher(contentAddressedAssetUrl(asset), signal);
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  const digest = await sha256(bytes);
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new Error(`static reconstruction asset verification failed (${asset.url})`);
  }
  return bytes;
}

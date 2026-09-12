import type { PackageAsset } from "./identity";

export type StaticAssetFetcher = (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

/** Content-addressed URL so browser/CDN caches cannot mix old bytes with a new manifest. */
export function contentAddressedAssetUrl(asset: PackageAsset): string {
  if (!asset.url || asset.url.includes("?")) return asset.url;
  if (!asset.sha256 || asset.sha256.length < 16) return asset.url;
  return `${asset.url}?h=${asset.sha256}`;
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

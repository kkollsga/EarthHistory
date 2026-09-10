import type { PackageAsset } from "./identity";

export type StaticAssetFetcher = (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

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
  const bytes = await fetcher(asset.url, signal);
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  const digest = await sha256(bytes);
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new Error("static reconstruction asset verification failed");
  }
  return bytes;
}

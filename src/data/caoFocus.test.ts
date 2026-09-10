/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaoMaterialFocusResolver } from "./caoFocus";
import { loadCaoCoordinateViewBundle } from "./caoView";
import { decodePaleomapMotionCatalog } from "./paleomapMotion";
import { periodDirectionToLonLat } from "./temporal";
import type { LonLat } from "./types";

afterEach(() => vi.unstubAllGlobals());

function localAssetFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const requested = String(input);
    const assetPath = requested.includes("/data/") ? requested.slice(requested.indexOf("/data/") + 1) : requested;
    try {
      const path = resolve(process.cwd(), "public", assetPath);
      if (path.endsWith(".bin")) {
        const bytes = await readFile(path);
        return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { status: 200 });
      }
      return new Response(await readFile(path, "utf8"), { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

describe("Cao target-native material focus", () => {
  it("tracks ocean material from its actual endpoint and rejects a tampered lifecycle", async () => {
    const fetchMock = localAssetFetch();
    vi.stubGlobal("fetch", fetchMock);
    const paleomap = decodePaleomapMotionCatalog(JSON.parse(
      await readFile(resolve(process.cwd(), "public/data/paleomap-motion-v1.json"), "utf8"),
    ));
    const bundle = await loadCaoCoordinateViewBundle(paleomap);
    expect(await loadCaoCoordinateViewBundle(paleomap)).toBe(bundle);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const sourceResolver = bundle.oceanModel.createIntervalResolver(102.5, 100, 105);
    let coordinates: LonLat | undefined;
    for (let latitude = -60; latitude <= 60 && coordinates === undefined; latitude += 15) {
      for (let longitude = -180; longitude < 180; longitude += 15) {
        const direction = [Math.cos(latitude * Math.PI / 180) * Math.cos(longitude * Math.PI / 180),
          Math.cos(latitude * Math.PI / 180) * Math.sin(longitude * Math.PI / 180),
          Math.sin(latitude * Math.PI / 180)] as const;
        if (sourceResolver.resolveAt(direction)?.kind === "oceanic-crust") coordinates = periodDirectionToLonLat(direction);
      }
    }
    expect(coordinates).toBeDefined();
    const resolver = createCaoMaterialFocusResolver(bundle);
    const descriptor = resolver.create(coordinates!, 102.5);
    expect(descriptor).toMatchObject({ materialKind: "oceanic-crust", referenceAgeMa: 100 });
    expect(descriptor?.sourceTopologyId).toBeTruthy();
    const sameAge = resolver.resolve(descriptor!, 102.5);
    expect(sameAge?.[0]).toBeCloseTo(coordinates![0], 5);
    expect(sameAge?.[1]).toBeCloseTo(coordinates![1], 5);

    const tampered = { ...descriptor!, validTimeMa: { ...descriptor!.validTimeMa,
      oldest: (descriptor!.validTimeMa.oldest ?? 540) + 5 } };
    expect(resolver.resolve(tampered, 102.5)).toBeUndefined();
    expect(resolver.resolve({ ...descriptor!, materialId: `${descriptor!.materialId}:tampered` }, 102.5))
      .toBeUndefined();
    expect(resolver.resolve(descriptor!, 541)).toBeUndefined();
    expect(resolver.cachedIntervalCount).toBeLessThanOrEqual(3);
  });
});

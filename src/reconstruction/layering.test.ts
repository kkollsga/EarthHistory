/**
 * The layering rule this directory has to keep.
 *
 * `src/reconstruction/**` owns the package format, the residency store and the
 * request engine: everything that decides *what* surface geometry exists and
 * when it is resident. `src/render/**` owns WebGL resources and the scene. The
 * lower half must never import the upper half, or the loader stops being usable
 * (and testable) without a renderer.
 *
 * The rule binds product modules. Test modules in this directory legitimately
 * reach up to the renderer to check an end-to-end publication, so they are
 * exempt — the exemption is narrow and named here on purpose.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RECONSTRUCTION_ROOT = resolve("src/reconstruction");

/** Any `from "…"` or `import("…")` specifier, static or dynamic. */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function productModules(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...productModules(path));
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    found.push(path);
  }
  return found;
}

function renderImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const crossings: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const resolved = resolve(path, "..", specifier);
    if (resolved.startsWith(resolve("src/render") + "/")) crossings.push(specifier);
  }
  return crossings;
}

describe("reconstruction layering", () => {
  it("scans every product module in the directory", () => {
    const modules = productModules(RECONSTRUCTION_ROOT);
    expect(modules.length).toBeGreaterThan(20);
    expect(modules.some((path) => path.endsWith("/surfaceSource.ts"))).toBe(true);
    expect(modules.some((path) => path.endsWith("/engineV2.ts"))).toBe(true);
    expect(modules.some((path) => path.endsWith("/loaderV2.ts"))).toBe(true);
  });

  it("imports nothing from src/render", () => {
    const offenders = productModules(RECONSTRUCTION_ROOT)
      .map((path) => [path, renderImports(path)] as const)
      .filter(([, crossings]) => crossings.length > 0)
      .map(([path, crossings]) =>
        `${path.slice(resolve("src").length + 1)} -> ${crossings.join(", ")}`);
    expect(offenders).toEqual([]);
  });
});

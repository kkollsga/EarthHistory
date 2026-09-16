import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The header logo advertises the running build, so the package version is
// inlined at build and at test time instead of fetched at runtime.
const packageVersion = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
  ) as { version: string }
).version;

function copyThirdPartyNotices() {
  return {
    name: "copy-third-party-notices",
    apply: "build" as const,
    async writeBundle(options: { dir?: string }) {
      const outputDirectory = resolve(process.cwd(), options.dir ?? "dist");
      await copyFile(
        resolve(process.cwd(), "THIRD_PARTY_NOTICES.md"),
        resolve(outputDirectory, "THIRD_PARTY_NOTICES.md"),
      );
    },
  };
}

export default defineConfig({
  // Relative asset URLs let the same build run at a GitHub Pages project path.
  base: "./",
  plugins: [react(), copyThirdPartyNotices()],
  // Applies to `vite build`, `vite dev` and the Vitest runs that import
  // src/appVersion.ts, so the version constant is never an unreplaced token.
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  build: {
    target: "es2022",
    // Keep the static artifact budget for scientific controls; Vite's local
    // development server retains source-level debugging.
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

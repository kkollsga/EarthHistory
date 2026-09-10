import react from "@vitejs/plugin-react";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

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

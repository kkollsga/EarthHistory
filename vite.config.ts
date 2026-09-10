import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs let the same build run at a GitHub Pages project path.
  base: "./",
  plugins: [react()],
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

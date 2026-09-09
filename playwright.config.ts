import { defineConfig } from "@playwright/test";

const port = process.env.EARTHHISTORY_TEST_PORT ?? "4174";
const baseURL = `http://127.0.0.1:${port}/EarthHistory/`;

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `EARTHHISTORY_TEST_PORT=${port} node tests/browser/server.mjs`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});

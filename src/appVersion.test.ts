import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_VERSION, APP_VERSION_LABEL } from "./appVersion";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

describe("app version", () => {
  it("matches the version declared in package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("is a plain semantic version rather than an unreplaced define token", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });

  it("labels the version for the header logo tooltip", () => {
    expect(APP_VERSION_LABEL).toBe(`EarthHistory v${packageJson.version}`);
  });
});

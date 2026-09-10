import { describe, expect, it } from "vitest";
import { CAO_SOURCE_AGE_DOMAIN_MA, caoDisplayCheckpointAgesMa } from "./caoDomain";

describe("Cao source domain schedule", () => {
  it("spans the full Cao 2024 model to 1.8 Ga with budget-aware display knots", () => {
    expect(CAO_SOURCE_AGE_DOMAIN_MA).toEqual({ youngest: 0, oldest: 1_800 });
    const ages = caoDisplayCheckpointAgesMa();
    expect(ages[0]).toBe(0);
    expect(ages.at(-1)).toBe(1_800);
    expect(ages).toContain(540);
    expect(ages).toContain(550);
    expect(ages).toContain(1_000);
    // Dense 5 Ma through 540, then 10 Ma thereafter.
    expect(ages.filter((age) => age <= 540)).toHaveLength(109);
    expect(ages.length).toBe(235);
    for (let index = 1; index < ages.length; index += 1) {
      expect(ages[index]!).toBeGreaterThan(ages[index - 1]!);
    }
  });
});

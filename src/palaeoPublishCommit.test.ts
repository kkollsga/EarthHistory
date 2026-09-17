import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The publish frame's React commit.
 *
 * A crossing resolves a prepared interval and sets it as state; the scene
 * publishes it from an effect of that commit, so the commit is on the frame the
 * scrub crossed into the new map. Everything else that reads the prepared
 * interval has to stay off that frame — above all the evidence summary, which
 * walks every chart of the interval to decide which sources are posed, and the
 * map key rows it feeds, which grow with the interval.
 *
 * React's priorities are not observable from a node test, so these assert the
 * shape that produces them. A regression here is someone reading `palaeoPrepared`
 * directly again in the render path, which is exactly what put the walk back on
 * the publish frame.
 */
describe("palaeo publication commit", () => {
  const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

  it("publishes urgently and reports the interval in a later render", () => {
    // The state that drives the publication is urgent: the scene's effect keys
    // off it, and deferring it would delay the map itself.
    expect(source).toContain("setPalaeoPrepared(prepared);");
    // The reader is the deferred value, never the urgent one.
    expect(source).toContain("const reportedPalaeoPrepared = useDeferredValue(palaeoPrepared);");
    expect(source).toContain("palaeoCoastlineEvidenceSummary(reportedPalaeoPrepared,");
    const summary = source.slice(source.indexOf("palaeoCoastlineEvidenceSummary(reportedPalaeoPrepared,"));
    const dependencies = summary.slice(summary.indexOf("["), summary.indexOf("]") + 1);
    expect(dependencies).toContain("reportedPalaeoPrepared");
    expect(dependencies).not.toContain("palaeoPrepared,");
  });

  it("renders the map key rows from a memoised component", () => {
    expect(source).toContain("const PalaeoEvidenceKeyRows = memo(");
    expect(source).toContain("<PalaeoEvidenceKeyRows visible={palaeoKeyVisible} evidence={palaeoEvidence} />");
  });
});

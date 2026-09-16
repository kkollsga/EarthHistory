import { describe, expect, it } from "vitest";
import {
  CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES,
  CAO_FOUNDATION_SURFACE_PRECEDENCE,
  caoFoundationSurfaceClassAppearance,
  type CaoFoundationSurfaceClass,
} from "./caoFoundation";
import { DEFAULT_SURFACE_RESIDENCY_POLICY } from "../../reconstruction/loaderV2";
import {
  advanceSurfaceVisibilityHysteresis,
  resolveReleasableNativeSurfaceClasses,
  resolveSurfaceVisibility,
  surfaceSlotComposition,
  SURFACE_VISIBILITY_INITIAL_HYSTERESIS,
  type CaoPalaeoDomainBand,
  type SurfaceComposition,
} from "./surfaceVisibility";

/** One resolution with the hysteresis already settled on `visibleBand`. */
function settled(
  layerEnabled: boolean,
  band: CaoPalaeoDomainBand,
  visibleBand: CaoPalaeoDomainBand,
  published: boolean,
) {
  return resolveSurfaceVisibility({ layerEnabled, band, published,
    hysteresis: { visible: visibleBand !== "none", band: visibleBand, pendingFrames: 0 } });
}

const classes = (resolution: { visibleClasses: ReadonlySet<CaoFoundationSurfaceClass> }) =>
  CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
    resolution.visibleClasses.has(surfaceClass));

/** Today's composition: the Cao 2024 crust, restored margins, corrections and land. */
const TODAYS_COMPOSITION = ["shelf", "correction-shelf", "corrections", "land"];
/**
 * The Cao 2017 band draws exactly five levels: the deep-sea sphere, mapped
 * shallow sea, mapped land, mapped mountain and the country outlines. The four
 * here are the fills; the sphere and the outline overlay are not surface
 * classes. The Cao 2024 crust shelf is deliberately not one of them — where the
 * map maps nothing, unmapped ground reads as deep sea.
 */
const REALISTIC_COMPOSITION = ["correction-shelf", "palaeo-shallow-marine", "palaeo-land",
  "palaeo-mountain"];

describe("surface visibility resolver", () => {
  it("holds the fallback boundary for one frame before switching the domain", () => {
    // A request has to hold for a second consecutive frame before it is applied.
    let state = SURFACE_VISIBILITY_INITIAL_HYSTERESIS;
    expect(state).toEqual({ visible: false, band: "none", pendingFrames: 0 });
    state = advanceSurfaceVisibilityHysteresis(state, "cao-2017");
    expect(state).toEqual({ visible: false, band: "none", pendingFrames: 1 });
    state = advanceSurfaceVisibilityHysteresis(state, "cao-2017");
    expect(state).toEqual({ visible: true, band: "cao-2017", pendingFrames: 0 });
    // Steady state costs nothing.
    state = advanceSurfaceVisibilityHysteresis(state, "cao-2017");
    expect(state).toEqual({ visible: true, band: "cao-2017", pendingFrames: 0 });

    // A single frame across 402 Ma and straight back leaves the surface alone:
    // the blank-and-restore is what would read as a rendering fault.
    let flicker = advanceSurfaceVisibilityHysteresis(state, "none");
    expect(flicker).toEqual({ visible: true, band: "cao-2017", pendingFrames: 1 });
    flicker = advanceSurfaceVisibilityHysteresis(flicker, "cao-2017");
    expect(flicker).toEqual({ visible: true, band: "cao-2017", pendingFrames: 0 });

    // A real crossing still lands, one frame later.
    let crossing = advanceSurfaceVisibilityHysteresis(state, "none");
    crossing = advanceSurfaceVisibilityHysteresis(crossing, "none");
    expect(crossing).toEqual({ visible: false, band: "none", pendingFrames: 0 });
    // And the delay never accumulates: coming back is one frame again.
    crossing = advanceSurfaceVisibilityHysteresis(crossing, "cao-2017");
    crossing = advanceSurfaceVisibilityHysteresis(crossing, "cao-2017");
    expect(crossing).toEqual({ visible: true, band: "cao-2017", pendingFrames: 0 });

    // The LGM band is its own answer, and a band change spends the same frame.
    let lgm = advanceSurfaceVisibilityHysteresis(crossing, "lgm");
    expect(lgm).toEqual({ visible: true, band: "cao-2017", pendingFrames: 1 });
    lgm = advanceSurfaceVisibilityHysteresis(lgm, "lgm");
    expect(lgm).toEqual({ visible: true, band: "lgm", pendingFrames: 0 });
  });

  it("keeps native land drawn at the LGM band while the lowstand shelf draws over it", () => {
    // The LGM state is three footprints of exposed shelf, not a global
    // palaeogeography: hiding today's land would blank every coastline on Earth.
    const lgm = settled(true, "lgm", "lgm", true);
    expect(lgm.mode).toBe("on");
    expect(lgm.band).toBe("lgm");
    expect(lgm.palaeoDrawn).toBe(true);
    expect(lgm.nativeSurfaceMode).toBe("native");
    // And the Cao band still replaces it, so this is a band rule, not a retreat.
    const cao = settled(true, "cao-2017", "cao-2017", true);
    expect(cao.nativeSurfaceMode).toBe("palaeo");
  });

  it("keys native land off the effective mode, never off the layer flag", () => {
    // The defect this pins: with the layer on at a fallback age the palaeo
    // instance draws nothing, so hiding `batch-land` left bare shelf where
    // today's coastline belongs — Africa as shelf sea at 0 Ma.
    const state = (layerEnabled: boolean, insideDomain: boolean,
      domainVisible: boolean, published: boolean) =>
      settled(layerEnabled, insideDomain ? "cao-2017" : "none",
        domainVisible ? "cao-2017" : "none", published);

    // Layer off: today's composition, whatever the age or the resident charts.
    for (const insideDomain of [false, true]) {
      for (const domainVisible of [false, true]) {
        for (const published of [false, true]) {
          const off = state(false, insideDomain, domainVisible, published);
          expect(off.mode).toBe("off");
          expect(off.palaeoDrawn).toBe(false);
          expect(off.nativeSurfaceMode).toBe("native");
        }
      }
    }

    // Layer on outside 2.01-402 Ma: the notice says fallback and the native
    // stack keeps every class it draws with the layer off.
    for (const domainVisible of [false, true]) {
      const fallback = state(true, false, domainVisible, false);
      expect(fallback.mode).toBe("fallback");
      expect(fallback.palaeoDrawn).toBe(false);
      expect(fallback.nativeSurfaceMode).toBe("native");
    }

    // Layer on inside the domain, interval not on screen yet: land stays drawn
    // rather than blanking for the length of a fetch.
    expect(state(true, true, false, false).mode).toBe("loading");
    expect(state(true, true, false, true).mode).toBe("loading");
    expect(state(true, true, true, false).mode).toBe("loading");
    expect(state(true, true, false, true).nativeSurfaceMode).toBe("native");
    expect(state(true, true, true, false).nativeSurfaceMode).toBe("native");

    // Only a drawn palaeo interval hides native land.
    const on = state(true, true, true, true);
    expect(on.mode).toBe("on");
    expect(on.palaeoDrawn).toBe(true);
    expect(on.nativeSurfaceMode).toBe("palaeo");
  });

  it("carries the fallback hysteresis into the native land switch", () => {
    // The hysteresis band is what `palaeoDrawn` reads, so the two never
    // disagree: the frame that stops drawing palaeo charts is the frame native
    // land returns.
    let hysteresis = SURFACE_VISIBILITY_INITIAL_HYSTERESIS;
    const frame = (insideDomain: boolean) => {
      const resolution = resolveSurfaceVisibility({ layerEnabled: true,
        band: insideDomain ? "cao-2017" : "none", published: true,
        hysteresis, advanceHysteresis: true });
      hysteresis = resolution.hysteresis;
      return resolution;
    };
    // Scrubbing in across 402 Ma: two frames to show, and native land is hidden
    // in the same frame the palaeo charts appear, never before.
    expect(frame(true).nativeSurfaceMode).toBe("native");
    expect(frame(true).nativeSurfaceMode).toBe("palaeo");
    expect(frame(true).mode).toBe("on");
    // Scrubbing back out: the notice flips at once, the surfaces one frame
    // later, and they swap together.
    const leaving = frame(false);
    expect(leaving.mode).toBe("fallback");
    expect(leaving.nativeSurfaceMode).toBe("palaeo");
    const left = frame(false);
    expect(left.mode).toBe("fallback");
    expect(left.nativeSurfaceMode).toBe("native");
  });

  it("withholds the domain through the same hysteresis as a scrub out of the band", () => {
    // A withheld surface asks for no band, so the palaeo charts leave the
    // screen one frame later rather than blanking with the native stack.
    let hysteresis = SURFACE_VISIBILITY_INITIAL_HYSTERESIS;
    const frame = (surfaceWithheld: boolean) => {
      const resolution = resolveSurfaceVisibility({ layerEnabled: true, band: "cao-2017",
        published: true, hysteresis, surfaceWithheld, advanceHysteresis: true });
      hysteresis = resolution.hysteresis;
      return resolution;
    };
    frame(false);
    expect(frame(false).nativeSurfaceMode).toBe("palaeo");
    // The notice still says the age is inside the band; only the surface leaves.
    expect(frame(true).hysteresis.band).toBe("cao-2017");
    const withheld = frame(true);
    expect(withheld.hysteresis).toEqual({ visible: false, band: "none", pendingFrames: 0 });
    expect(withheld.palaeoDrawn).toBe(false);
    expect(withheld.mode).toBe("loading");
  });

  it("resolves one class set per band, layer flag and publication", () => {
    // The table the renderer slots are read from: (band x layer flag x
    // published) -> the classes on screen and the stack the native instance
    // draws. `lgm` is the one composition that is both.
    const table = [
      { band: "none", layerEnabled: false, published: false,
        composition: "native", mode: "off" },
      { band: "cao-2017", layerEnabled: false, published: true,
        composition: "native", mode: "off" },
      { band: "lgm", layerEnabled: false, published: true,
        composition: "native", mode: "off" },
      { band: "none", layerEnabled: true, published: true,
        composition: "native", mode: "fallback" },
      { band: "cao-2017", layerEnabled: true, published: false,
        composition: "native", mode: "loading" },
      { band: "lgm", layerEnabled: true, published: false,
        composition: "native", mode: "loading" },
      { band: "cao-2017", layerEnabled: true, published: true,
        composition: "realistic", mode: "on" },
      { band: "lgm", layerEnabled: true, published: true,
        composition: "lgm", mode: "on" },
    ] as const;
    const expected: Record<SurfaceComposition, readonly string[]> = {
      native: TODAYS_COMPOSITION,
      realistic: REALISTIC_COMPOSITION,
      // The LGM band draws the native stack and the lowstand shells over it, so
      // it is the union — the one composition where all seven classes are on
      // screen at once.
      lgm: ["shelf", "correction-shelf", "palaeo-shallow-marine", "corrections",
        "palaeo-land", "palaeo-mountain", "land"],
    };
    for (const row of table) {
      const resolution = settled(row.layerEnabled, row.band, row.band, row.published);
      const label = JSON.stringify(row);
      expect(resolution.mode, label).toBe(row.mode);
      expect(resolution.composition, label).toBe(row.composition);
      expect(resolution.nativeSurfaceMode, label)
        .toBe(row.composition === "realistic" ? "palaeo" : "native");
      expect(classes(resolution), label).toEqual(expected[row.composition]);
      // No class drawn in native land's own colour survives into the realistic
      // composition: that is what put a second land tone over the mapped
      // shallow seas.
      for (const landColoured of ["land", "corrections"] as const) {
        expect(resolution.visibleClasses.has(landColoured), `${landColoured} in ${label}`)
          .toBe(row.composition !== "realistic");
      }
    }
  });

  it("assigns every renderer slot per composition", () => {
    // The slot table is the plan's contract — the realistic data replaces the
    // native data *in the renderer, nothing else* — and it must agree with the
    // classes the shell table says are drawn.
    const native = surfaceSlotComposition("native");
    expect(native).toMatchObject({ land: "land", continents: "shelf", mountain: null,
      corrections: "corrections", correctionShelf: "correction-shelf",
      correctionShelfAppearance: "shelf", countryPolyline: "dark-ink" });
    const realistic = surfaceSlotComposition("realistic");
    expect(realistic).toMatchObject({ land: "palaeo-land",
      continents: "palaeo-shallow-marine", mountain: "palaeo-mountain", corrections: null,
      correctionShelf: "correction-shelf",
      correctionShelfAppearance: "palaeo-shallow-marine", countryPolyline: "two-tone" });
    // The LGM keeps today's slots and adds the lowstand shells over them.
    expect(surfaceSlotComposition("lgm")).toMatchObject({ ...native,
      overlay: ["palaeo-shallow-marine", "palaeo-land", "palaeo-mountain"] });

    // The declared appearance of the restored margin is the one the renderer
    // paints it with, in both compositions.
    expect(caoFoundationSurfaceClassAppearance("correction-shelf", "shelf", "native"))
      .toBe(native.correctionShelfAppearance);
    expect(caoFoundationSurfaceClassAppearance("correction-shelf", "shelf", "palaeo"))
      .toBe(realistic.correctionShelfAppearance);
    // A restored margin is never land-like, in either appearance.
    expect(CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES).not.toContain("correction-shelf");

    // Each slot table accounts for exactly the classes the resolver reports.
    for (const composition of ["native", "realistic", "lgm"] as const) {
      const slots = surfaceSlotComposition(composition);
      const declared = new Set<CaoFoundationSurfaceClass>([slots.land, slots.continents,
        slots.mountain, slots.corrections, slots.correctionShelf, ...slots.overlay]
        .filter((value): value is CaoFoundationSurfaceClass => value !== null));
      const resolution = settled(composition !== "native", composition === "lgm" ? "lgm" : "cao-2017",
        composition === "lgm" ? "lgm" : "cao-2017", composition !== "native");
      expect(resolution.composition).toBe(composition);
      expect([...declared].sort(), composition)
        .toEqual([...resolution.visibleClasses].sort());
    }
  });
});

describe("releasable native surface classes", () => {
  const policyWith = (releaseReplacedNativeGpuBuffers: boolean) =>
    ({ ...DEFAULT_SURFACE_RESIDENCY_POLICY, releaseReplacedNativeGpuBuffers });

  it("releases today's land and crust shelf only where the Cao 2017 map replaces them", () => {
    expect([...resolveReleasableNativeSurfaceClasses("realistic")].sort())
      .toEqual(["land", "shelf"]);
    // Neither replaced class is still drawn in that composition.
    const realistic = surfaceSlotComposition("realistic");
    for (const surfaceClass of resolveReleasableNativeSurfaceClasses("realistic")) {
      expect([realistic.land, realistic.continents, realistic.mountain, realistic.corrections,
        realistic.correctionShelf, ...realistic.overlay]).not.toContain(surfaceClass);
    }
  });

  it("releases nothing where the native stack is still on screen", () => {
    // The LGM band draws the native stack under the lowstand overlay, and a
    // fallback or still-loading age is the native composition outright.
    expect(resolveReleasableNativeSurfaceClasses("lgm")).toEqual([]);
    expect(resolveReleasableNativeSurfaceClasses("native")).toEqual([]);
  });

  it("releases nothing at all with the knob off", () => {
    for (const composition of ["native", "realistic", "lgm"] as const) {
      expect(resolveReleasableNativeSurfaceClasses(composition, policyWith(false)), composition)
        .toEqual([]);
    }
  });

  it("ships with the knob on and the pinned units the policy names", () => {
    expect(DEFAULT_SURFACE_RESIDENCY_POLICY.releaseReplacedNativeGpuBuffers).toBe(true);
    expect([...DEFAULT_SURFACE_RESIDENCY_POLICY.pinnedUnitIds].sort())
      .toEqual(["batch-land", "batch-shelf", "corrections", "restored-margin"]);
    expect(DEFAULT_SURFACE_RESIDENCY_POLICY.maximumResidentIntervalBytes).toBe(6 * 1024 * 1024);
    expect(DEFAULT_SURFACE_RESIDENCY_POLICY.maximumResidentIntervalCount).toBe(3);
  });
});

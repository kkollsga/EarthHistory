import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeferredPublishQueue, residentIntervalBudget, warmCaoMember, writeCaoResidencyDataset }
  from "./GlobeScene";

const HIGH_INTERVALS = 25;
const LOW_INTERVALS = 8;

/**
 * Residency is a memory policy. The automatic quality watchdog used to collapse
 * the ceiling to one interval during the first heavy load, with no path back,
 * so every later crossing paid a fresh upload — the cost the watchdog fires to
 * avoid. These hold the two owners apart.
 */
describe("resident map interval budget", () => {
  it("keeps the full budget when the watchdog is the only thing asking for less", () => {
    // "auto" is what the watchdog downgrades from; it never changes the request.
    expect(residentIntervalBudget("auto", 8)).toEqual(
      { intervals: HIGH_INTERVALS, bytes: 55 * 1024 * 1024 });
    expect(residentIntervalBudget("auto", undefined).intervals).toBe(HIGH_INTERVALS);
    expect(residentIntervalBudget("high", 8).intervals).toBe(HIGH_INTERVALS);
  });

  it("lowers the budget only for an explicit low profile or a small device", () => {
    expect(residentIntervalBudget("low", 8)).toEqual(
      { intervals: LOW_INTERVALS, bytes: 24 * 1024 * 1024 });
    expect(residentIntervalBudget("auto", 2).intervals).toBe(LOW_INTERVALS);
    expect(residentIntervalBudget("auto", 4).intervals).toBe(HIGH_INTERVALS);
  });

  it("leaves the ceiling untouched on the automatic effective-quality change", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    const body = (name: string) => {
      const start = source.indexOf(`${name}(value`);
      expect(start).toBeGreaterThan(0);
      const open = source.indexOf("{", start);
      let depth = 0;
      for (let index = open; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open, index);
      }
      throw new Error(`unbalanced body for ${name}`);
    };
    // `applyEffectiveQuality` is the watchdog's own path; `setQuality` is the
    // explicit selection that owns the budget.
    expect(body("private applyEffectiveQuality")).not.toContain("setResidentIntervalCeiling");
    expect(body("setQuality")).toContain("setResidentIntervalCeiling");
  });

  /**
   * The two residency keys used to be written only by the native revision path
   * and by a composition change. A map-interval crossing is neither — the
   * composition stays `palaeo` from the first entry into the band to the last —
   * so they froze at the first crossing's reading (20,395,812 B, one resident)
   * while the surface set went on to hold three members and 38,609,378 B. Every
   * reader of those keys was measuring a number that had stopped moving.
   */
  it("moves the residency keys on every interval publish and on the clear", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    const body = (signature: string) => {
      const start = source.indexOf(signature);
      expect(start).toBeGreaterThan(0);
      const open = source.indexOf("{", start);
      let depth = 0;
      for (let index = open; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open, index);
      }
      throw new Error(`unbalanced body for ${signature}`);
    };
    expect(body("private publishPreparedPalaeoIntervalNow(")).toContain(
      "this.publishCaoResidencyDataset()");
    expect(body("private clearPalaeoPublication()")).toContain("this.publishCaoResidencyDataset()");
  });

  it("reports the second interval publish, not the first", () => {
    let residents = 0;
    let gpuBytes = 0;
    const renderer = {
      residentGpuBytes: () => gpuBytes,
      residentIntervalCount: () => residents,
      releasedSurfaceClasses: () => ["land"],
    };
    const dataset: Record<string, string | undefined> = {};
    residents = 1; gpuBytes = 8_492_702;
    writeCaoResidencyDataset(dataset, renderer);
    expect(dataset.caoResidentIntervals).toBe("1");
    const first = dataset.caoFoundationGpuBytes;
    residents = 2; gpuBytes = 29_284_048;
    writeCaoResidencyDataset(dataset, renderer);
    expect(dataset.caoResidentIntervals).toBe("2");
    expect(dataset.caoFoundationGpuBytes).not.toBe(first);
    expect(dataset.caoFoundationReleasedClasses).toBe("land");
  });
});

/**
 * Parenting a hidden member uploads nothing: the renderer's object walk returns
 * early for `visible === false`, so a "preloaded" interval had no buffers and no
 * compiled program until the crossing that drew it — which is why the first
 * visit still cost a ~50 ms first-draw frame. These hold the warm to the two
 * things that make it worth doing: it reaches the renderer, and it leaves the
 * member hidden.
 */
describe("warming a preloaded hidden member", () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();

  it("compiles the hidden member exactly once and leaves it hidden", () => {
    const group = new THREE.Group();
    group.visible = false;
    const seen: { visible: boolean; object: THREE.Object3D; target: unknown }[] = [];
    const renderer = {
      compileAsync(object: THREE.Object3D, _camera: THREE.Camera, targetScene?: THREE.Object3D) {
        seen.push({ visible: object.visible, object, target: targetScene });
        return Promise.resolve();
      },
    };
    expect(warmCaoMember(renderer, group, camera, scene)).toBe(true);
    expect(seen).toHaveLength(1);
    // Visible for the traversal — the walk skips a hidden object — and hidden
    // again before any frame can draw it.
    expect(seen[0]!.visible).toBe(true);
    expect(seen[0]!.object).toBe(group);
    expect(seen[0]!.target).toBe(scene);
    expect(group.visible).toBe(false);
  });

  it("leaves the member hidden when the compile throws, and reports it", () => {
    const group = new THREE.Group();
    group.visible = false;
    const renderer = { compileAsync: () => { throw new Error("device lost"); } };
    expect(() => warmCaoMember(renderer, group, camera, scene)).toThrow("device lost");
    expect(group.visible).toBe(false);
  });

  it("reports a rejected compile without unhiding the member", async () => {
    const group = new THREE.Group();
    group.visible = false;
    const failures: unknown[] = [];
    const renderer = { compileAsync: () => Promise.reject(new Error("pipeline failed")) };
    expect(warmCaoMember(renderer, group, camera, scene, (error) => failures.push(error)))
      .toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect((failures[0] as Error).message).toBe("pipeline failed");
    expect(group.visible).toBe(false);
  });

  it("warms nothing on a renderer that cannot compile", () => {
    const group = new THREE.Group();
    group.visible = false;
    expect(warmCaoMember({}, group, camera, scene)).toBe(false);
    expect(group.visible).toBe(false);
  });

  it("asks the warmer once per preloaded member and never for the drawn one", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    expect(source).toContain("setMemberWarmer((group) => this.warmPalaeoMember(group))");
    const renderer = readFileSync(
      new URL("./reconstruction/caoFoundation.ts", import.meta.url), "utf8");
    // The warm hangs off `!present`, which is exactly the preload path.
    expect(renderer).toContain("if (!present && this.memberWarmer !== null)");
  });
});

/**
 * The ~26 ms publish used to run inside the age-change dispatch, where it was
 * the input handler's own cost. It belongs on the frame that first draws the
 * interval; what has to survive the move is the lease, which the publish takes
 * over and a deferred publish therefore has to own in the meantime.
 */
describe("deferred publish queue", () => {
  const payload = (released: string[], name: string) => ({ release: () => released.push(name) });

  it("publishes in the drain and not in the queue call", () => {
    const order: string[] = [];
    const queue = new DeferredPublishQueue<{ release(): void }, string>();
    queue.queue(payload([], "a"), (result) => order.push(`published:${result}`));
    expect(order).toEqual([]);
    expect(queue.pending()).toBe(true);
    expect(queue.drain(() => { order.push("publish"); return "ok"; })).toBe(true);
    expect(order).toEqual(["publish", "published:ok"]);
    expect(queue.pending()).toBe(false);
    expect(queue.drain(() => { order.push("again"); return "ok"; })).toBe(false);
    expect(order).toEqual(["publish", "published:ok"]);
  });

  it("keeps the latest of two publishes in one frame and releases the other", () => {
    const released: string[] = [];
    const answered: string[] = [];
    const queue = new DeferredPublishQueue<{ release(): void }, string>();
    const first = payload(released, "first");
    const second = payload(released, "second");
    queue.queue(first, (result) => answered.push(`first:${result}`));
    queue.queue(second, (result) => answered.push(`second:${result}`));
    // Superseded, not failed: the first caller hears nothing at all.
    expect(released).toEqual(["first"]);
    expect(answered).toEqual([]);
    const published: unknown[] = [];
    queue.drain((held) => { published.push(held); return "ok"; });
    expect(published).toEqual([second]);
    expect(answered).toEqual(["second:ok"]);
    expect(released).toEqual(["first"]);
  });

  it("carries a queued clear, which is not an empty queue", () => {
    const queue = new DeferredPublishQueue<{ release(): void }, string>();
    queue.queue(null);
    expect(queue.pending()).toBe(true);
    const published: unknown[] = [];
    queue.drain((held) => { published.push(held); return "ok"; });
    expect(published).toEqual([null]);
  });

  it("releases an abandoned publish and never publishes it", () => {
    const released: string[] = [];
    const queue = new DeferredPublishQueue<{ release(): void }, string>();
    queue.queue(payload(released, "stranded"), () => { throw new Error("must not answer"); });
    queue.abandon();
    expect(released).toEqual(["stranded"]);
    expect(queue.pending()).toBe(false);
    expect(queue.drain(() => { throw new Error("must not publish"); })).toBe(false);
  });

  it("drains before the frame renders, and abandons on dispose", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    const drain = source.indexOf("this.drainQueuedPalaeoPublish();");
    const render = source.indexOf("this.renderer.render(this.scene, this.camera);");
    expect(drain).toBeGreaterThan(0);
    expect(render).toBeGreaterThan(drain);
    expect(source).toContain("this.queuedPalaeoPublish.abandon();");
  });
});

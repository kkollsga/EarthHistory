import { describe, expect, it } from "vitest";
import { cubeRenderResidentIds, planCubeRender } from "./cubeRenderPlan";
import { CUBE_FACES, cubeTileId, type CubeTileKey } from "./cubeSphere";
import { balanceCubeSelection } from "./cubeLod";

const pxRoot: CubeTileKey = { face: "px", level: 0, x: 0, y: 0 };
const pxChildren: CubeTileKey[] = [
  { face: "px", level: 1, x: 0, y: 0 },
  { face: "px", level: 1, x: 1, y: 0 },
  { face: "px", level: 1, x: 0, y: 1 },
  { face: "px", level: 1, x: 1, y: 1 },
];

describe("cube render planning", () => {
  it("retains a resident parent until every visible replacement branch is ready", () => {
    const resident = new Set([cubeTileId(pxRoot), ...pxChildren.slice(0, 3).map(cubeTileId)]);
    const pending = planCubeRender(pxChildren, resident);
    expect(pending.renderKeys).toEqual([pxRoot]);
    expect(pending.nextRequests).toEqual([pxChildren[3]]);
    expect(pending.complete).toBe(false);

    resident.add(cubeTileId(pxChildren[3]));
    const ready = planCubeRender(pxChildren, resident);
    expect(ready.renderKeys).toEqual(pxChildren);
    expect(ready.nextRequests).toEqual([]);
    expect(ready.complete).toBe(true);
  });

  it("requests only visible child branches and can refine one face progressively", () => {
    const desired: CubeTileKey[] = [
      { face: "px", level: 2, x: 0, y: 0 },
      { face: "px", level: 2, x: 1, y: 0 },
      pxChildren[1],
    ];
    const resident = new Set([cubeTileId(pxRoot)]);
    const first = planCubeRender(desired, resident);
    expect(first.renderKeys).toEqual([pxRoot]);
    expect(first.nextRequests).toEqual(pxChildren.slice(0, 2));

    for (const key of first.nextRequests) resident.add(cubeTileId(key));
    const second = planCubeRender(desired, resident);
    expect(second.renderKeys).toEqual(pxChildren.slice(0, 2));
    expect(second.nextRequests).toEqual([
      { face: "px", level: 2, x: 0, y: 0 },
      { face: "px", level: 2, x: 1, y: 0 },
    ]);
  });

  it("requests missing roots without blanking an unrelated resident face", () => {
    const nxRoot: CubeTileKey = { face: "nx", level: 0, x: 0, y: 0 };
    const plan = planCubeRender([pxRoot, nxRoot], new Set([cubeTileId(pxRoot)]));
    expect(plan.renderKeys).toEqual([pxRoot]);
    expect(plan.nextRequests).toEqual([nxRoot]);
    expect(plan.complete).toBe(false);
  });

  it("rejects overlapping desired leaves instead of producing a stalled plan", () => {
    expect(() => planCubeRender(
      [pxRoot, pxChildren[0]],
      new Set([cubeTileId(pxRoot)]),
    )).toThrow(/non-overlapping/);
  });

  it("does not promote a resident face two levels beyond its rendered neighbor", () => {
    const levelTwo = (face: (typeof CUBE_FACES)[number]): CubeTileKey[] =>
      Array.from({ length: 16 }, (_, index) => ({
        face,
        level: 2,
        x: index % 4,
        y: Math.floor(index / 4),
      }));
    const desired = [...levelTwo("px"), ...levelTwo("pz")];
    const pzLevelTwo = levelTwo("pz");
    const resident = new Set([
      cubeTileId(pxRoot),
      cubeTileId({ face: "pz", level: 0, x: 0, y: 0 }),
      ...pzLevelTwo.map(cubeTileId),
    ]);
    const plan = planCubeRender(desired, resident);
    const independentlyBalanced = balanceCubeSelection(
      plan.renderKeys,
      4,
      Math.max(6, plan.renderKeys.length),
    );
    expect(independentlyBalanced.map(cubeTileId)).toEqual(plan.renderKeys.map(cubeTileId));
    expect(Math.max(...plan.renderKeys.map((key) => key.level))).toBeLessThanOrEqual(1);
    expect(plan.complete).toBe(false);
    expect(plan.nextRequests.length).toBeGreaterThan(0);
  });

  it("returns multiple complete sibling groups for bounded parallel generation", () => {
    const nxRoot: CubeTileKey = { face: "nx", level: 0, x: 0, y: 0 };
    const nxChildren: CubeTileKey[] = pxChildren.map((key) => ({ ...key, face: "nx" }));
    const resident = new Set([cubeTileId(pxRoot), cubeTileId(nxRoot)]);
    const plan = planCubeRender([...pxChildren, ...nxChildren], resident);
    expect(plan.renderKeys).toEqual([pxRoot, nxRoot]);
    expect(plan.nextRequests).toEqual([...pxChildren, ...nxChildren]);
    expect(plan.complete).toBe(false);
  });

  it("uses mesh-owned temporal fields without inserting them into the bounded cache", () => {
    const cached = new Set(pxChildren.slice(0, 3).map(cubeTileId));
    const resident = cubeRenderResidentIds(cached, [pxChildren[3]]);
    const plan = planCubeRender(pxChildren, resident);
    expect(plan.complete).toBe(true);
    expect(plan.nextRequests).toEqual([]);
    expect(cached.size).toBe(3);
    expect(cached.has(cubeTileId(pxChildren[3]))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildPatchStitchFanIndices, selectPatchLod, type PatchLodNode } from "./patchLod";

const edge = (side: "a" | "b", start: number, end: number) => (
  [{ seamId: "shared", side, start, end }] as const
);

const nodes: PatchLodNode[] = [
  { key: "a0", level: 0, triangleCount: 2, projectedErrorPixels: 100, edges: edge("a", 0, 1), children: ["a1l", "a1r"] },
  { key: "a1l", level: 1, triangleCount: 2, projectedErrorPixels: 80, edges: edge("a", 0, 0.5), children: ["a2a", "a2b"] },
  { key: "a1r", level: 1, triangleCount: 2, projectedErrorPixels: 5, edges: edge("a", 0.5, 1) },
  { key: "a2a", level: 2, triangleCount: 2, projectedErrorPixels: 2, edges: edge("a", 0, 0.25) },
  { key: "a2b", level: 2, triangleCount: 2, projectedErrorPixels: 2, edges: edge("a", 0.25, 0.5) },
  { key: "b0", level: 0, triangleCount: 2, projectedErrorPixels: 5, edges: edge("b", 0, 1), children: ["b1l", "b1r"] },
  { key: "b1l", level: 1, triangleCount: 2, projectedErrorPixels: 2, edges: edge("b", 0, 0.5) },
  { key: "b1r", level: 1, triangleCount: 2, projectedErrorPixels: 2, edges: edge("b", 0.5, 1) },
];

const limits = { maxLevel: 2, maxLeaves: 5, maxTriangles: 10, splitPixels: 20, mergePixels: 10 };

describe("patch LOD selection", () => {
  it("reserves shared-edge balance closure before accepting detail", () => {
    const selected = selectPatchLod(nodes, ["a0", "b0"], limits);
    expect(selected.leaves.map((leaf) => leaf.key)).toEqual(["a1r", "a2a", "a2b", "b1l", "b1r"]);
    expect(selected.stitches.map((stitch) => [stitch.coarseKey, stitch.fineKey]))
      .toEqual([["b1l", "a2a"], ["b1l", "a2b"]]);
    expect(selected.totalTriangles).toBe(10);
  });

  it("rejects an unaffordable split without post-hoc coarsening", () => {
    const selected = selectPatchLod(nodes, ["a0", "b0"], { ...limits, maxLeaves: 4, maxTriangles: 8 });
    expect(selected.leaves.map((leaf) => leaf.key)).toEqual(["a1l", "a1r", "b0"]);
    expect(selected.stitches).toHaveLength(2);
  });

  it("uses previous selection only for hysteresis and rejects seam holes", () => {
    const hysteresisNodes = nodes.map((node) => node.key === "a0"
      ? { ...node, projectedErrorPixels: 15 } : node);
    expect(selectPatchLod(hysteresisNodes, ["a0", "b0"], limits).leaves).toHaveLength(2);
    expect(selectPatchLod(hysteresisNodes, ["a0", "b0"], limits, new Set(["a1l", "a1r", "b0"]))
      .leaves.length).toBeGreaterThan(2);

    const broken = nodes.map((node) => node.key === "b1r"
      ? { ...node, edges: edge("b", 0.6, 1) } : node);
    expect(() => selectPatchLod(broken, ["a0", "b0"], limits)).toThrow(/coverage mismatch/);
  });

  it("rejects over-budget roots and duplicate same-side coverage", () => {
    expect(() => selectPatchLod(nodes, ["a0", "b0"], { ...limits, maxTriangles: 3 }))
      .toThrow(/roots exceed/);
    const duplicate = [...nodes, { ...nodes[7]!, key: "b1r-copy" }];
    expect(() => selectPatchLod(duplicate, ["a0", "b0", "b1r-copy"],
      { ...limits, maxLeaves: 6, maxTriangles: 12 })).toThrow(/coverage mismatch/);
  });

  it("emits coarse-side fan triangles using every fine edge segment", () => {
    const selected = selectPatchLod(nodes, ["a0", "b0"], limits);
    const indices = buildPatchStitchFanIndices([{ stitch: selected.stitches[0]!,
      coarseInteriorVertex: 8, fineBoundaryVertices: [1, 2, 3] }]);
    expect([...indices]).toEqual([8, 1, 2, 8, 2, 3]);
    expect(() => buildPatchStitchFanIndices([{ stitch: selected.stitches[0]!,
      coarseInteriorVertex: 1, fineBoundaryVertices: [1, 2] }])).toThrow(/degenerate/);
  });
});

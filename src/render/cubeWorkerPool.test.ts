import { describe, expect, it } from "vitest";
import { cubeWorkerPoolLimit, partitionCubeWorkerRequests } from "./cubeWorkerPool";

describe("cube worker pool planning", () => {
  it("caps workers by available hardware", () => {
    expect(cubeWorkerPoolLimit(undefined)).toBe(1);
    expect(cubeWorkerPoolLimit(4)).toBe(1);
    expect(cubeWorkerPoolLimit(6)).toBe(2);
    expect(cubeWorkerPoolLimit(10)).toBe(4);
    expect(cubeWorkerPoolLimit(64)).toBe(4);
  });

  it("partitions each tile exactly once across a bounded balanced batch", () => {
    const requests = ["px", "nx", "py", "ny", "pz", "nz"];
    const groups = partitionCubeWorkerRequests(requests, 4);
    expect(groups).toEqual([["px", "pz"], ["nx", "nz"], ["py"], ["ny"]]);
    expect(groups.flat()).toHaveLength(requests.length);
    expect(new Set(groups.flat())).toEqual(new Set(requests));
    expect(Math.max(...groups.map((group) => group.length)) -
      Math.min(...groups.map((group) => group.length))).toBeLessThanOrEqual(1);
  });

  it("handles empty and invalid limits without creating work", () => {
    expect(partitionCubeWorkerRequests([], 4)).toEqual([]);
    expect(partitionCubeWorkerRequests([1, 2], 0)).toEqual([[1, 2]]);
  });
});

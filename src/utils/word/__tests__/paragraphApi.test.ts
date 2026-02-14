import { describe, expect, it } from "bun:test";
import {
  buildScopedIndexSet,
  pickRepresentativeSamples,
} from "../paragraphApi";

describe("pickRepresentativeSamples", () => {
  it("returns evenly distributed samples when input exceeds max size", () => {
    const input = Array.from({ length: 10 }, (_, i) => i);
    const sampled = pickRepresentativeSamples(input, 3);
    expect(sampled).toEqual([0, 5, 9]);
  });

  it("returns a middle item when only one sample is requested", () => {
    const input = ["a", "b", "c", "d", "e"];
    const sampled = pickRepresentativeSamples(input, 1);
    expect(sampled).toEqual(["c"]);
  });
});

describe("buildScopedIndexSet", () => {
  it("returns null when no scoped indices are provided", () => {
    expect(buildScopedIndexSet(undefined, 10)).toBeNull();
    expect(buildScopedIndexSet([], 10)).toBeNull();
  });

  it("filters out invalid indices outside paragraph range", () => {
    const scoped = buildScopedIndexSet([-1, 0, 3, 8, 3, 99], 9);
    expect(scoped ? Array.from(scoped).sort((a, b) => a - b) : []).toEqual([0, 3, 8]);
  });
});

import { describe, expect, it } from "bun:test";
import { verifyScopedContentIntegrity } from "../contentCheckpoint";
import type { ScopedContentCheckpoint } from "../types";

function makeScopedCheckpoint(
  overrides?: Partial<ScopedContentCheckpoint>
): ScopedContentCheckpoint {
  return {
    paragraphCount: 5,
    paragraphIndices: [1, 3],
    totalCharCount: 20,
    paragraphHashes: ["hash-a", "hash-b"],
    ...overrides,
  };
}

describe("verifyScopedContentIntegrity", () => {
  it("passes when scoped checkpoints are identical", () => {
    const before = makeScopedCheckpoint();
    const after = makeScopedCheckpoint();
    expect(verifyScopedContentIntegrity(before, after)).toEqual({ valid: true });
  });

  it("fails when paragraph count changes", () => {
    const before = makeScopedCheckpoint({ paragraphCount: 5 });
    const after = makeScopedCheckpoint({ paragraphCount: 6 });
    const result = verifyScopedContentIntegrity(before, after);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("段落数量变化");
  });

  it("fails when scoped indices are different", () => {
    const before = makeScopedCheckpoint({ paragraphIndices: [1, 3] });
    const after = makeScopedCheckpoint({ paragraphIndices: [1, 4] });
    const result = verifyScopedContentIntegrity(before, after);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("索引");
  });

  it("fails with concrete paragraph hint when hash differs", () => {
    const before = makeScopedCheckpoint({ paragraphIndices: [2], paragraphHashes: ["before"] });
    const after = makeScopedCheckpoint({ paragraphIndices: [2], paragraphHashes: ["after"] });
    const result = verifyScopedContentIntegrity(before, after);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("第 3 段内容发生变化");
  });
});

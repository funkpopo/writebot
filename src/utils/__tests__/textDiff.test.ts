import { describe, expect, it } from "bun:test";
import { buildTextDiff } from "../textDiff";

describe("buildTextDiff", () => {
  it("returns semantic insertions and deletions while retaining shared text", () => {
    const diff = buildTextDiff("这是一段旧文字。", "这是一段新文字，已优化。");

    expect(diff.some((part) => part.kind === "delete" && part.text.includes("旧"))).toBe(true);
    expect(diff.some((part) => part.kind === "insert" && part.text.includes("新"))).toBe(true);
    expect(diff.filter((part) => part.kind === "equal").map((part) => part.text).join(""))
      .toContain("这是一段");
  });

  it("represents a cursor insertion as inserted content", () => {
    expect(buildTextDiff("", "新增内容")).toEqual([{ kind: "insert", text: "新增内容" }]);
  });
});

import { describe, expect, it } from "bun:test";
import {
  buildRevisionParagraphMessage,
  computeParagraphDiff,
  stripSourceAnchorMarkers,
} from "../revisionDiff";

describe("revisionDiff", () => {
  it("strips source anchor markers", () => {
    const text = "段落一[来源锚点：doc#1]\n\n段落二";
    expect(stripSourceAnchorMarkers(text)).toBe("段落一\n\n段落二");
  });

  it("computes replace/insert/delete paragraph diffs", () => {
    const before = ["A", "B", "C"];
    const after = ["A", "B2", "D"];
    const entries = computeParagraphDiff(before, after);
    expect(entries.some((item) => item.kind === "replace")).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("builds a readable revision diff message for the UI", () => {
    const before = "## 章节\n\n旧段落内容。\n\n保持不变的段落。";
    const after = "## 章节\n\n新段落内容更完整。\n\n保持不变的段落。\n\n新增收尾。";
    const message = buildRevisionParagraphMessage("背景介绍", before, after);
    expect(message).toContain("背景介绍（修订 diff）");
    expect(message).toContain("段落");
    expect(message).toMatch(/原文：|新文：/);
  });

  it("reports no structural changes when texts are equivalent after normalize", () => {
    const text = "## 标题\n\n同一段落";
    const message = buildRevisionParagraphMessage("无变化", text, text);
    expect(message).toContain("未提取到段落差异");
  });
});

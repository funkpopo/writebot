import { describe, expect, it } from "bun:test";
import {
  __sectionMemoryInternals,
  extractInsertedDelta,
  extractSectionContentByHeadings,
  resolveSectionContent,
} from "../sectionMemory";

describe("sectionMemory", () => {
  it("extracts section content by current and next section headings", () => {
    const text = [
      "# 文章标题",
      "## 背景",
      "背景段落 1",
      "背景段落 2",
      "## 方法",
      "方法段落",
    ].join("\n");

    const content = extractSectionContentByHeadings(text, "背景", ["方法"]);
    expect(content).toBe(["## 背景", "背景段落 1", "背景段落 2"].join("\n"));
  });

  it("prefers the last heading match when title appears multiple times", () => {
    const text = [
      "目录",
      "背景",
      "方法",
      "",
      "## 背景",
      "真正章节内容",
      "## 方法",
      "下一章节内容",
    ].join("\n");

    const content = extractSectionContentByHeadings(text, "背景", ["方法"]);
    expect(content).toBe(["## 背景", "真正章节内容"].join("\n"));
  });

  it("extracts delta when heading is missing", () => {
    const previous = "旧文档内容";
    const current = "旧文档内容\n新增段落 A\n新增段落 B";
    const delta = extractInsertedDelta(previous, current);
    expect(delta).toBe("新增段落 A\n新增段落 B");
  });

  it("resolves section content with heading strategy first", () => {
    const previous = "## 背景\n原始背景";
    const current = "## 背景\n扩展背景\n## 方法\n方法内容";

    const resolved = resolveSectionContent({
      previousDocumentText: previous,
      currentDocumentText: current,
      currentSectionTitle: "背景",
      nextSectionTitles: ["方法"],
    });

    expect(resolved.strategy).toBe("heading");
    expect(resolved.content).toBe("## 背景\n扩展背景");
  });

  it("falls back to delta when heading extraction is suspiciously short", () => {
    const previous = "目录\n背景\n方法";
    const current = "目录\n背景\n方法\n\n这里是新写的背景章节正文，长度明显更长。";

    const resolved = resolveSectionContent({
      previousDocumentText: previous,
      currentDocumentText: current,
      currentSectionTitle: "背景",
      nextSectionTitles: ["方法"],
    });

    expect(resolved.strategy).toBe("delta");
    expect(resolved.content).toBe("这里是新写的背景章节正文，长度明显更长。");
  });

  it("matches numbered headings with normalized comparison", () => {
    expect(__sectionMemoryInternals.isLikelyTitleMatch("2. 研究方法", "研究方法")).toBe(true);
    expect(__sectionMemoryInternals.isLikelyTitleMatch("第二部分：结论", "结论")).toBe(true);
  });
});

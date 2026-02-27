import { describe, expect, it } from "bun:test";
import {
  buildMemoryContextForSection,
  createLongTermMemory,
  mergeLongTermMemory,
  parseLongTermMemoryMarkdown,
  renderLongTermMemoryMarkdown,
  updateLongTermMemoryWithSection,
} from "../longTermMemory";
import type { ArticleOutline, OutlineSection } from "../types";

const baseSection: OutlineSection = {
  id: "s1",
  title: "背景介绍",
  level: 1,
  description: "介绍系统背景",
  keyPoints: ["WriteBot 定位", "术语统一"],
  estimatedParagraphs: 2,
};

const outline: ArticleOutline = {
  title: "测试文章",
  theme: "多 Agent",
  targetAudience: "产品经理",
  style: "专业",
  sections: [
    baseSection,
    {
      id: "s2",
      title: "实施方案",
      level: 1,
      description: "描述实施细节",
      keyPoints: ["长期记忆", "评审仲裁"],
      estimatedParagraphs: 3,
    },
  ],
  totalEstimatedParagraphs: 5,
};

describe("longTermMemory", () => {
  it("stores section summary and retrieves relevant context", () => {
    const memory = createLongTermMemory(
      outline,
      "请保持“WriteBot”术语统一。",
      ""
    );

    updateLongTermMemoryWithSection(
      memory,
      baseSection,
      "## 背景介绍\nWriteBot 是一个面向产品经理的写作助手。\n它强调术语一致性与结构化表达。"
    );

    const context = buildMemoryContextForSection(memory, outline.sections[1]);
    expect(context).toContain("术语表");
    expect(context).toContain("WriteBot");
    expect(context).toContain("相关章节摘要");
  });

  it("serializes and parses markdown snapshot", () => {
    const memory = createLongTermMemory(outline, "保持术语“WriteBot”一致。", "");
    updateLongTermMemoryWithSection(
      memory,
      baseSection,
      "## 背景介绍\nWriteBot 通过长期记忆减少重复描述。"
    );

    const markdown = renderLongTermMemoryMarkdown(memory, "2026-02-27T12:00:00.000Z");
    const parsed = parseLongTermMemoryMarkdown(markdown);

    expect(parsed).not.toBeNull();
    expect(parsed?.glossary.some((item) => item.term === "WriteBot")).toBe(true);
    expect(parsed?.sectionSummaries.length).toBeGreaterThan(0);
  });

  it("merges persisted memory with current run memory", () => {
    const memory = createLongTermMemory(outline, "", "");
    updateLongTermMemoryWithSection(
      memory,
      baseSection,
      "## 背景介绍\nWriteBot 术语应保持统一。"
    );

    mergeLongTermMemory(memory, {
      personas: ["目标读者：产品经理", "品牌语气：客观"],
      glossary: [
        { term: "WriteBot", note: "来自历史文档", frequency: 2 },
        { term: "Arbiter", note: "双审阅仲裁角色", frequency: 1 },
      ],
      sectionSummaries: [
        {
          sectionId: "history-1",
          sectionTitle: "历史经验",
          summary: "记录过去的复盘经验。",
          keywords: ["经验", "复盘"],
          updatedAt: "2026-02-26T00:00:00.000Z",
        },
      ],
    });

    const writebot = memory.glossary.find((item) => item.term === "WriteBot");
    expect(writebot).not.toBeUndefined();
    expect(writebot?.frequency).toBeGreaterThan(2);
    expect(memory.glossary.some((item) => item.term === "Arbiter")).toBe(true);
    expect(memory.sectionSummaries.some((item) => item.sectionId === "history-1")).toBe(true);
  });
});

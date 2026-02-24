import { describe, expect, it } from "bun:test";
import {
  extractPlanStageTitles,
  stripAgentExecutionMarkersFromWriteText,
} from "../stageWriteGuard";

describe("extractPlanStageTitles", () => {
  it("extracts numbered stage titles from plan markdown", () => {
    const planMarkdown = [
      "# plan.md",
      "## 阶段计划",
      "1. [ ] 需求分析与资料收集",
      "2. [ ] LLM核心技术资料整理",
      "3. [ ] 形成正式文稿并校对",
    ].join("\n");

    expect(extractPlanStageTitles(planMarkdown)).toEqual([
      "需求分析与资料收集",
      "LLM核心技术资料整理",
      "形成正式文稿并校对",
    ]);
  });
});

describe("stripAgentExecutionMarkersFromWriteText", () => {
  const planStageTitles = [
    "需求分析与资料收集",
    "LLM核心技术资料整理",
    "形成正式文稿并校对",
  ];

  it("removes leading stage directive and keeps document body", () => {
    const raw = [
      "第二阶段：LLM核心技术资料整理",
      "",
      "核心参考文献摘要",
      "",
      "1. \"Attention Is All You Need\"",
    ].join("\n");

    const result = stripAgentExecutionMarkersFromWriteText(raw, {
      currentStage: 2,
      totalStages: 3,
      planStageTitles,
    });

    expect(result.removedMarker).toBe(true);
    expect(result.text).toBe(
      ["核心参考文献摘要", "", "1. \"Attention Is All You Need\""].join("\n")
    );
  });

  it("removes control tags and stage markers together", () => {
    const raw = [
      "[[CONTENT]]",
      "第2阶段：LLM核心技术资料整理",
      "",
      "最终正文段落",
    ].join("\n");

    const result = stripAgentExecutionMarkersFromWriteText(raw, {
      currentStage: 2,
      totalStages: 3,
      planStageTitles,
    });

    expect(result.removedMarker).toBe(true);
    expect(result.text).toBe("最终正文段落");
  });

  it("does not strip normal content", () => {
    const raw = [
      "LLM核心技术资料整理",
      "",
      "这里是正文，不是阶段指示。",
    ].join("\n");

    const result = stripAgentExecutionMarkersFromWriteText(raw, {
      currentStage: 2,
      totalStages: 3,
      planStageTitles,
    });

    expect(result.removedMarker).toBe(false);
    expect(result.text).toBe(raw);
  });
});

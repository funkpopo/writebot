import { describe, expect, it } from "bun:test";
import type { PromptIntakeContract } from "../promptIntake";
import { tryRuleBasedPromptIntake } from "../promptIntake";
import {
  isLocalDocumentTask,
  isSelectionReviseTask,
} from "../localDocumentFlow";

function contract(overrides: Partial<PromptIntakeContract> = {}): PromptIntakeContract {
  return {
    rawPrompt: "润色选中文本",
    taskType: "revise_existing",
    primaryGoal: "润色当前选区",
    hardConstraints: [],
    outputRequirements: {},
    documentDependency: "needs_selection",
    missingCriticalInputs: [],
    mustAskUser: false,
    ...overrides,
  };
}

describe("isLocalDocumentTask", () => {
  it("accepts revise / summarize / continue / format", () => {
    expect(isLocalDocumentTask(contract({ taskType: "revise_existing" }))).toBe(true);
    expect(isLocalDocumentTask(contract({ taskType: "summarize" }))).toBe(true);
    expect(isLocalDocumentTask(contract({ taskType: "continue_document" }))).toBe(true);
    expect(isLocalDocumentTask(contract({ taskType: "format" }))).toBe(true);
  });

  it("rejects create_article and unknown", () => {
    expect(isLocalDocumentTask(contract({ taskType: "create_article" }))).toBe(false);
    expect(isLocalDocumentTask(contract({ taskType: "unknown_blocked", mustAskUser: true, missingCriticalInputs: ["x"] }))).toBe(false);
  });
});

describe("isSelectionReviseTask", () => {
  it("only matches selection-backed revise", () => {
    expect(isSelectionReviseTask(contract({ documentDependency: "needs_selection" }))).toBe(true);
    expect(isSelectionReviseTask(contract({
      taskType: "revise_existing",
      documentDependency: "needs_index",
    }))).toBe(false);
    expect(isSelectionReviseTask(contract({ taskType: "summarize" }))).toBe(false);
  });
});

describe("rule intake for local document tasks", () => {
  it("classifies summarize / continue / format short instructions", () => {
    const cases: Array<{ prompt: string; taskType: string }> = [
      { prompt: "总结", taskType: "summarize" },
      { prompt: "请生成摘要", taskType: "summarize" },
      { prompt: "总结这段内容的要点", taskType: "summarize" },
      { prompt: "总结这篇文章的要点", taskType: "summarize" },
      { prompt: "续写", taskType: "continue_document" },
      { prompt: "继续写", taskType: "continue_document" },
      { prompt: "往下写一段", taskType: "continue_document" },
      { prompt: "优化排版", taskType: "format" },
      { prompt: "调整格式", taskType: "format" },
      { prompt: "排版优化一下", taskType: "format" },
    ];

    for (const { prompt, taskType } of cases) {
      const result = tryRuleBasedPromptIntake(prompt);
      expect(result, `expected rule hit for: ${prompt}`).not.toBeNull();
      expect(result!.taskType).toBe(taskType);
      expect(isLocalDocumentTask(result!)).toBe(true);
    }
  });

  it("marks full-document summarize with needs_index", () => {
    const result = tryRuleBasedPromptIntake("总结这篇文章的要点");
    expect(result).not.toBeNull();
    expect(result!.taskType).toBe("summarize");
    expect(result!.documentDependency).toBe("needs_index");
  });

  it("keeps create_article off the local path", () => {
    const result = tryRuleBasedPromptIntake("写一篇关于远程办公的文章，约800字");
    expect(result).not.toBeNull();
    expect(result!.taskType).toBe("create_article");
    expect(isLocalDocumentTask(result!)).toBe(false);
  });
});

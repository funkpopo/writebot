import { describe, expect, it } from "bun:test";
import type { PromptIntakeContract } from "../promptIntake";
import { tryRuleBasedPromptIntake } from "../promptIntake";
import { isSelectionReviseTask } from "../selectionReviseFlow";

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

describe("isSelectionReviseTask", () => {
  it("accepts revise_existing with selection/ranges/none dependency", () => {
    expect(isSelectionReviseTask(contract({ documentDependency: "needs_selection" }))).toBe(true);
    expect(isSelectionReviseTask(contract({ documentDependency: "needs_ranges" }))).toBe(true);
    expect(isSelectionReviseTask(contract({ documentDependency: "none" }))).toBe(true);
  });

  it("rejects create_article and index-backed revise", () => {
    expect(isSelectionReviseTask(contract({
      taskType: "create_article",
      documentDependency: "none",
    }))).toBe(false);
    expect(isSelectionReviseTask(contract({
      taskType: "revise_existing",
      documentDependency: "needs_index",
    }))).toBe(false);
    expect(isSelectionReviseTask(contract({
      taskType: "summarize",
      documentDependency: "needs_selection",
    }))).toBe(false);
  });
});

describe("rule intake for selection revise", () => {
  it("classifies short polish/rewrite instructions as revise_existing + needs_selection", () => {
    const samples = [
      "润色",
      "请润色一下",
      "改写得更正式",
      "润色选中的段落",
      "把这段文字重写得更简洁",
      "polish this",
    ];

    for (const prompt of samples) {
      const result = tryRuleBasedPromptIntake(prompt);
      expect(result, `expected revise rule for: ${prompt}`).not.toBeNull();
      expect(result!.taskType).toBe("revise_existing");
      expect(result!.documentDependency).toBe("needs_selection");
      expect(isSelectionReviseTask(result!)).toBe(true);
    }
  });

  it("still routes article creation away from selection revise", () => {
    const result = tryRuleBasedPromptIntake("写一篇关于远程办公的文章，约800字");
    expect(result).not.toBeNull();
    expect(result!.taskType).toBe("create_article");
    expect(isSelectionReviseTask(result!)).toBe(false);
  });
});

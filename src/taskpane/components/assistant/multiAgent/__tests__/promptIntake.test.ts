import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import {
  buildPromptContractUserMessage,
  hashPromptIntakeContract,
  parsePromptIntakeContract,
  validatePromptIntakeContract,
} from "../promptIntake";

describe("promptIntake", () => {
  it("builds a create-article contract with preserved raw prompt and hard constraints", () => {
    const rawPrompt = "写一篇关于企业 AI 治理的文章，不要写引言，用中文，约800字，面向管理层。";

    const contract = parsePromptIntakeContract(rawPrompt);

    expect(contract.rawPrompt).toBe(rawPrompt);
    expect(contract.taskType).toBe("create_article");
    expect(contract.primaryGoal).toContain("企业 AI 治理");
    expect(contract.hardConstraints).toContain("不要写引言");
    expect(contract.outputRequirements.language).toBe("中文");
    expect(contract.outputRequirements.length).toBe("800字");
    expect(contract.outputRequirements.targetAudience).toContain("管理层");
    expect(contract.documentDependency).toBe("none");
    expect(contract.mustAskUser).toBe(false);
  });

  it("marks unknown prompts as blocked and validates with a structured error", () => {
    const contract = parsePromptIntakeContract("帮我处理一下");

    expect(contract.taskType).toBe("unknown_blocked");
    expect(contract.mustAskUser).toBe(true);
    expect(contract.missingCriticalInputs).toContain("可执行任务类型");
    expect(() => validatePromptIntakeContract(contract)).toThrow(AgentHarnessError);
  });

  it("requires a target document range for ambiguous revisions", () => {
    const contract = parsePromptIntakeContract("帮我润色一下，让语气更正式");

    expect(contract.taskType).toBe("revise_existing");
    expect(contract.documentDependency).toBe("needs_index");
    expect(contract.mustAskUser).toBe(true);
    expect(contract.missingCriticalInputs).toContain("目标文档范围");
  });

  it("recognizes targeted revision ranges without converting them into new-article tasks", () => {
    const contract = parsePromptIntakeContract("只改第二节，删掉口语化表达，其他章节不要动。");

    expect(contract.taskType).toBe("revise_existing");
    expect(contract.documentDependency).toBe("needs_ranges");
    expect(contract.hardConstraints).toContain("只改第二节");
    expect(contract.hardConstraints).toContain("不要动");
  });

  it("hashes equivalent contract data deterministically and exposes the contract to planner prompts", () => {
    const contract = parsePromptIntakeContract("写一篇关于远程办公管理的文章，必须包含风险控制，用中文。");
    const hashA = hashPromptIntakeContract(contract);
    const hashB = hashPromptIntakeContract({
      ...contract,
      outputRequirements: { ...contract.outputRequirements },
      hardConstraints: [...contract.hardConstraints],
    });

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^prompt_[0-9a-f]{8}$/);

    const plannerMessage = buildPromptContractUserMessage(contract);
    expect(plannerMessage).toContain("Prompt Intake Contract");
    expect(plannerMessage).toContain(contract.primaryGoal);
    expect(plannerMessage).toContain("必须包含风险控制");
  });
});

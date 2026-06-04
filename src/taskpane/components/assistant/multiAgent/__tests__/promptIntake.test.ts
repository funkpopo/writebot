import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import {
  buildPromptContractUserMessage,
  hashPromptIntakeContract,
  parsePromptIntakeContractFromResponse,
  validatePromptIntakeContract,
  type PromptIntakeContract,
} from "../promptIntake";

describe("promptIntake", () => {
  function createArticleContract(overrides: Partial<PromptIntakeContract> = {}): PromptIntakeContract {
    return {
      rawPrompt: "写一篇关于企业 AI 治理的文章，用中文，约800字，面向管理层。",
      taskType: "create_article",
      primaryGoal: "生成一篇面向管理层的企业 AI 治理文章",
      hardConstraints: ["必须覆盖治理角色与风险控制"],
      outputRequirements: {
        language: "中文",
        length: "约800字",
        targetAudience: "管理层",
      },
      documentDependency: "none",
      missingCriticalInputs: [],
      mustAskUser: false,
      ...overrides,
    };
  }

  it("parses a model-produced contract and binds the original raw prompt", () => {
    const expected = createArticleContract();

    const contract = parsePromptIntakeContractFromResponse(JSON.stringify(expected), expected.rawPrompt);

    expect(contract.rawPrompt).toBe(expected.rawPrompt);
    expect(contract.taskType).toBe("create_article");
    expect(contract.primaryGoal).toBe(expected.primaryGoal);
    expect(contract.hardConstraints).toContain("必须覆盖治理角色与风险控制");
    expect(contract.outputRequirements.language).toBe("中文");
    expect(contract.outputRequirements.length).toBe("约800字");
    expect(contract.outputRequirements.targetAudience).toBe("管理层");
    expect(contract.documentDependency).toBe("none");
    expect(contract.mustAskUser).toBe(false);
  });

  it("ignores model-produced rawPrompt and keeps the original user input", () => {
    const expected = createArticleContract();
    const response = JSON.stringify({
      ...expected,
      rawPrompt: "写一篇企业 AI 治理文章",
    });

    const contract = parsePromptIntakeContractFromResponse(response, expected.rawPrompt);

    expect(contract.rawPrompt).toBe(expected.rawPrompt);
  });

  it("accepts model contracts that omit rawPrompt", () => {
    const expected = createArticleContract();
    const responseContract: Partial<PromptIntakeContract> = { ...expected };
    delete responseContract.rawPrompt;

    const contract = parsePromptIntakeContractFromResponse(JSON.stringify(responseContract), expected.rawPrompt);

    expect(contract.rawPrompt).toBe(expected.rawPrompt);
    expect(contract.primaryGoal).toBe(expected.primaryGoal);
  });

  it("rejects invalid enum values from model output", () => {
    const expected = createArticleContract();
    const response = JSON.stringify({
      ...expected,
      taskType: "article",
    });

    expect(() => parsePromptIntakeContractFromResponse(response, expected.rawPrompt)).toThrow(
      "PromptIntakeContract.taskType 非法：article",
    );
  });

  it("validates blocked contracts with a structured error", () => {
    const contract = createArticleContract({
      rawPrompt: "帮我处理一下",
      taskType: "unknown_blocked",
      primaryGoal: "",
      hardConstraints: [],
      outputRequirements: {},
      missingCriticalInputs: ["可执行任务类型"],
      mustAskUser: true,
    });

    expect(() => validatePromptIntakeContract(contract)).toThrow(AgentHarnessError);
  });

  it("hashes equivalent contract data deterministically and exposes the contract to planner prompts", () => {
    const contract = createArticleContract({
      primaryGoal: "生成一篇关于远程办公管理的文章",
      hardConstraints: ["必须包含风险控制"],
    });
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

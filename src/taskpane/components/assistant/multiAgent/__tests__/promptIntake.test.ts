import { describe, expect, it } from "bun:test";
import { AgentHarnessError } from "../agentHarness";
import {
  buildPromptContractUserMessage,
  hashPromptIntakeContract,
  parsePromptIntakeContractFromResponse,
  tryRuleBasedPromptIntake,
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

describe("tryRuleBasedPromptIntake", () => {
  it("hits create_article for typical Chinese writing commands", () => {
    const samples = [
      "写一篇关于企业 AI 治理的文章，用中文，约800字，面向管理层。",
      "请生成一篇远程办公管理的报告",
      "帮我起草一篇人工智能伦理的文章，必须包含案例，不要空话",
      "撰写一份关于数据安全的方案",
      "Write an article about remote work policies",
    ];

    for (const prompt of samples) {
      const contract = tryRuleBasedPromptIntake(prompt);
      expect(contract, `expected rule hit for: ${prompt}`).not.toBeNull();
      expect(contract!.taskType).toBe("create_article");
      expect(contract!.documentDependency).toBe("none");
      expect(contract!.mustAskUser).toBe(false);
      expect(contract!.missingCriticalInputs).toEqual([]);
      expect(contract!.rawPrompt).toBe(prompt.trim());
      expect(contract!.primaryGoal.length).toBeGreaterThan(0);
      expect(() => validatePromptIntakeContract(contract!)).not.toThrow();
    }
  });

  it("extracts length, language, audience and hard constraints when present", () => {
    const contract = tryRuleBasedPromptIntake(
      "写一篇关于企业 AI 治理的文章，用中文，约800字，面向管理层，必须覆盖风险控制，不要堆砌术语",
    );
    expect(contract).not.toBeNull();
    expect(contract!.outputRequirements.language).toBe("中文");
    expect(contract!.outputRequirements.length).toBe("约800字");
    expect(contract!.outputRequirements.targetAudience).toBe("管理层");
    expect(contract!.hardConstraints.some((c) => c.includes("风险控制"))).toBe(true);
    expect(contract!.hardConstraints.some((c) => c.includes("堆砌术语"))).toBe(true);
    expect(contract!.primaryGoal).toContain("企业 AI 治理");
  });

  it("does not mis-route rewrite / continue / summarize / format intents to create", () => {
    const negatives = [
      "改写这段关于 AI 治理的内容，让它更简洁",
      "请润色一下选中的段落",
      "续写下一章，接着写风险管理",
      "继续写文档的结论部分",
      "总结这篇文章的要点",
      "帮我翻译成英文",
      "调整格式并排版标题",
      "修改第二段的表述",
      "把这段文字重写得更正式",
    ];

    for (const prompt of negatives) {
      expect(tryRuleBasedPromptIntake(prompt), `should not rule-create: ${prompt}`).toBeNull();
    }
  });

  it("is conservative on vague create prompts without a usable topic", () => {
    expect(tryRuleBasedPromptIntake("写一篇文章")).toBeNull();
    expect(tryRuleBasedPromptIntake("生成一篇")).toBeNull();
    expect(tryRuleBasedPromptIntake("写")).toBeNull();
    expect(tryRuleBasedPromptIntake("")).toBeNull();
  });
});

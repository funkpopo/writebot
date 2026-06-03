import { describe, expect, it } from "bun:test";
import type { AgentCheckpointFile } from "../../../../../utils/storageService";
import { evaluateCheckpointResume } from "../orchestrator";
import { attachPromptContractMetadata } from "../plannerAgent";
import { buildWriterSystemPrompt } from "../prompts";
import {
  hashPromptIntakeContract,
  type PromptIntakeContract,
} from "../promptIntake";
import type { ArticleOutline } from "../types";

const baseOutline: ArticleOutline = {
  title: "AI 治理实践",
  theme: "企业 AI 治理",
  targetAudience: "管理层",
  style: "专业、清晰",
  sections: [
    {
      id: "s1",
      title: "治理目标",
      level: 1,
      description: "说明治理目标与业务边界",
      keyPoints: ["风险控制", "职责划分"],
      estimatedParagraphs: 2,
    },
    {
      id: "s2",
      title: "落地机制",
      level: 1,
      description: "说明组织与流程机制",
      keyPoints: ["审批流程", "持续评估"],
      estimatedParagraphs: 2,
    },
  ],
  totalEstimatedParagraphs: 4,
};

function contract(overrides: Partial<PromptIntakeContract> = {}): PromptIntakeContract {
  return {
    rawPrompt: "写一篇关于企业 AI 治理的文章，用中文。",
    taskType: "create_article",
    primaryGoal: "生成一篇关于企业 AI 治理的文章",
    hardConstraints: ["必须覆盖风险控制"],
    outputRequirements: {
      language: "中文",
    },
    documentDependency: "none",
    missingCriticalInputs: [],
    mustAskUser: false,
    ...overrides,
  };
}

function checkpoint(overrides: Partial<AgentCheckpointFile["checkpoint"]>): AgentCheckpointFile {
  return {
    fileName: "checkpoint.json",
    path: "/api/checkpoint",
    checkpoint: {
      runId: "run_existing",
      request: "写一篇关于企业 AI 治理的文章，用中文。",
      promptContractHash: "prompt_old",
      nodeId: "planning",
      loopCount: 0,
      status: "running",
      runState: "running",
      outline: baseOutline,
      writtenSections: [],
      updatedAt: "2026-06-03T00:00:00.000Z",
      ...overrides,
    },
    updatedAt: "2026-06-03T00:00:00.000Z",
  };
}

describe("orchestrator prompt contract", () => {
  it("resumes only when raw prompt, contract hash, status, and outline are all valid", () => {
    const promptContract = contract();
    const contractHash = hashPromptIntakeContract(promptContract);

    const decision = evaluateCheckpointResume(
      checkpoint({
        request: promptContract.rawPrompt,
        promptContractHash: contractHash,
        outline: baseOutline,
      }),
      promptContract,
      contractHash,
    );

    expect(decision.canResume).toBe(true);
  });

  it("rejects checkpoint resume when raw prompt differs", () => {
    const promptContract = contract();
    const contractHash = hashPromptIntakeContract(promptContract);

    const decision = evaluateCheckpointResume(
      checkpoint({
        request: "写一篇关于企业 AI 治理的文章。",
        promptContractHash: contractHash,
      }),
      promptContract,
      contractHash,
    );

    expect(decision.canResume).toBe(false);
    expect(decision.mismatchReason).toBe("raw_prompt_mismatch");
  });

  it("rejects checkpoint resume when contract hash is missing or different", () => {
    const promptContract = contract();
    const contractHash = hashPromptIntakeContract(promptContract);

    expect(evaluateCheckpointResume(
      checkpoint({
        request: promptContract.rawPrompt,
        promptContractHash: undefined,
      }),
      promptContract,
      contractHash,
    ).mismatchReason).toBe("contract_hash_missing");

    expect(evaluateCheckpointResume(
      checkpoint({
        request: promptContract.rawPrompt,
        promptContractHash: "prompt_different",
      }),
      promptContract,
      contractHash,
    ).mismatchReason).toBe("contract_hash_mismatch");
  });

  it("attaches prompt contract metadata to planner output", () => {
    const promptContract = contract();
    const contractHash = hashPromptIntakeContract(promptContract);

    const outline = attachPromptContractMetadata(baseOutline, promptContract, contractHash);

    expect(outline.promptContractHash).toBe(contractHash);
    expect(outline.primaryGoal).toBe(promptContract.primaryGoal);
    expect(outline.hardConstraints).toContain("必须覆盖风险控制");
    expect(outline.outputRequirements?.language).toBe("中文");
  });

  it("passes prompt constraints into writer prompts without local semantic branching", () => {
    const promptContract = contract({
      hardConstraints: ["保留用户明确约束"],
      outputRequirements: {
        language: "中文",
        structure: "按合同要求组织正文",
      },
    });
    const contractHash = hashPromptIntakeContract(promptContract);
    const outline = attachPromptContractMetadata(baseOutline, promptContract, contractHash);

    const prompt = buildWriterSystemPrompt(outline, outline.sections[0], 0);

    expect(prompt).toContain("Prompt Intake Contract 约束");
    expect(prompt).toContain("保留用户明确约束");
    expect(prompt).toContain("按合同要求组织正文");
    expect(prompt).toContain("正文安排必须服从 Prompt Intake Contract 与当前章节定义");
  });
});

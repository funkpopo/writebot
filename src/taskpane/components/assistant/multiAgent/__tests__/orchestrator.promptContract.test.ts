import { describe, expect, it } from "bun:test";
import type { AgentCheckpointFile } from "../../../../../utils/storageService";
import { evaluateCheckpointResume } from "../orchestrator";
import {
  assertOutlineHonorsPromptContract,
  attachPromptContractMetadata,
} from "../plannerAgent";
import { buildWriterSystemPrompt } from "../prompts";
import {
  hashPromptIntakeContract,
  parsePromptIntakeContract,
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

function checkpoint(overrides: Partial<AgentCheckpointFile["checkpoint"]>): AgentCheckpointFile {
  return {
    fileName: "checkpoint.json",
    path: "/api/checkpoint",
    checkpoint: {
      runId: "run_existing",
      request: "写一篇关于企业 AI 治理的文章，不要写引言。",
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
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言。");
    const contractHash = hashPromptIntakeContract(contract);

    const decision = evaluateCheckpointResume(
      checkpoint({
        request: contract.rawPrompt,
        promptContractHash: contractHash,
        outline: baseOutline,
      }),
      contract,
      contractHash,
    );

    expect(decision.canResume).toBe(true);
  });

  it("rejects checkpoint resume when raw prompt differs", () => {
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言。");
    const contractHash = hashPromptIntakeContract(contract);

    const decision = evaluateCheckpointResume(
      checkpoint({
        request: "写一篇关于企业 AI 治理的文章。",
        promptContractHash: contractHash,
      }),
      contract,
      contractHash,
    );

    expect(decision.canResume).toBe(false);
    expect(decision.mismatchReason).toBe("raw_prompt_mismatch");
  });

  it("rejects checkpoint resume when contract hash is missing or different", () => {
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言。");
    const contractHash = hashPromptIntakeContract(contract);

    expect(evaluateCheckpointResume(
      checkpoint({
        request: contract.rawPrompt,
        promptContractHash: undefined,
      }),
      contract,
      contractHash,
    ).mismatchReason).toBe("contract_hash_missing");

    expect(evaluateCheckpointResume(
      checkpoint({
        request: contract.rawPrompt,
        promptContractHash: "prompt_different",
      }),
      contract,
      contractHash,
    ).mismatchReason).toBe("contract_hash_mismatch");
  });

  it("attaches prompt contract metadata to planner output", () => {
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言，用中文。");
    const contractHash = hashPromptIntakeContract(contract);

    const outline = attachPromptContractMetadata(baseOutline, contract, contractHash);

    expect(outline.promptContractHash).toBe(contractHash);
    expect(outline.primaryGoal).toBe(contract.primaryGoal);
    expect(outline.hardConstraints).toContain("不要写引言");
    expect(outline.outputRequirements?.language).toBe("中文");
  });

  it("rejects planner outlines that violate a no-introduction hard constraint", () => {
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言。");
    const outline: ArticleOutline = {
      ...baseOutline,
      sections: [
        {
          ...baseOutline.sections[0],
          title: "引言",
        },
      ],
    };

    expect(() => assertOutlineHonorsPromptContract(outline, contract)).toThrow("不要写引言");
  });

  it("passes prompt constraints into writer prompts and suppresses the default introduction rule", () => {
    const contract = parsePromptIntakeContract("写一篇关于企业 AI 治理的文章，不要写引言，用中文。");
    const contractHash = hashPromptIntakeContract(contract);
    const outline = attachPromptContractMetadata(baseOutline, contract, contractHash);

    const prompt = buildWriterSystemPrompt(outline, outline.sections[0], 0);

    expect(prompt).toContain("Prompt Intake Contract 约束");
    expect(prompt).toContain("不要写引言");
    expect(prompt).toContain("必须跳过引言段落");
    expect(prompt).not.toContain("需要包含文章标题（使用 # 一级标题）和引言段落");
  });
});

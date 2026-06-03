import { callAI, type AIRequestOptions } from "../../../../utils/aiService";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";

export type PromptTaskType =
  | "create_article"
  | "revise_existing"
  | "continue_document"
  | "summarize"
  | "format"
  | "unknown_blocked";

export type DocumentDependency =
  | "none"
  | "needs_index"
  | "needs_ranges"
  | "needs_selection";

export interface PromptOutputRequirements {
  length?: string;
  language?: string;
  format?: string;
  structure?: string;
  targetAudience?: string;
}

export interface PromptIntakeContract {
  rawPrompt: string;
  taskType: PromptTaskType;
  primaryGoal: string;
  hardConstraints: string[];
  outputRequirements: PromptOutputRequirements;
  documentDependency: DocumentDependency;
  missingCriticalInputs: string[];
  mustAskUser: boolean;
}

const TASK_TYPES: PromptTaskType[] = [
  "create_article",
  "revise_existing",
  "continue_document",
  "summarize",
  "format",
  "unknown_blocked",
];

const DOCUMENT_DEPENDENCIES: DocumentDependency[] = [
  "none",
  "needs_index",
  "needs_ranges",
  "needs_selection",
];

const PROMPT_INTAKE_SYSTEM_PROMPT = `你是 WriteBot 的 Prompt Intake Agent。你的唯一任务是把用户本轮原始需求转换为严格 JSON 契约，不能执行写作、不能生成大纲、不能改写用户需求。

输出要求：
1. 只输出有效 JSON，不要输出解释、Markdown、代码块或额外文本。
2. 必须保留 rawPrompt 为用户原始输入，逐字一致。
3. taskType 只能是：
   - create_article
   - revise_existing
   - continue_document
   - summarize
   - format
   - unknown_blocked
4. documentDependency 只能是：
   - none
   - needs_index
   - needs_ranges
   - needs_selection
5. hardConstraints 只记录用户明确禁止、必须遵守、范围限定或不可覆盖的要求。
6. outputRequirements 记录篇幅、语言、格式、结构、目标读者；无法确定的字段省略。
7. missingCriticalInputs 只记录无法合理推断且会阻止安全执行的关键信息。
8. mustAskUser 为 true 时表示必须中断询问，不能进入 planner。
9. 如果用户意图无法判断，taskType 必须是 unknown_blocked，mustAskUser 必须是 true。

JSON 结构：
{
  "rawPrompt": "用户原始输入",
  "taskType": "create_article",
  "primaryGoal": "本轮主要目标",
  "hardConstraints": [],
  "outputRequirements": {
    "length": "可选",
    "language": "可选",
    "format": "可选",
    "structure": "可选",
    "targetAudience": "可选"
  },
  "documentDependency": "none",
  "missingCriticalInputs": [],
  "mustAskUser": false
}`;

const PROMPT_INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "rawPrompt",
    "taskType",
    "primaryGoal",
    "hardConstraints",
    "outputRequirements",
    "documentDependency",
    "missingCriticalInputs",
    "mustAskUser",
  ],
  properties: {
    rawPrompt: { type: "string" },
    taskType: { type: "string", enum: TASK_TYPES },
    primaryGoal: { type: "string" },
    hardConstraints: {
      type: "array",
      items: { type: "string" },
    },
    outputRequirements: {
      type: "object",
      additionalProperties: false,
      properties: {
        length: { type: "string" },
        language: { type: "string" },
        format: { type: "string" },
        structure: { type: "string" },
        targetAudience: { type: "string" },
      },
    },
    documentDependency: { type: "string", enum: DOCUMENT_DEPENDENCIES },
    missingCriticalInputs: {
      type: "array",
      items: { type: "string" },
    },
    mustAskUser: { type: "boolean" },
  },
} as const;

function extractJsonObjectsFromText(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const candidates = [raw.trim(), ...extractJsonObjectsFromText(raw)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next complete JSON object candidate.
    }
  }
  throw new Error("无法解析 Prompt Intake JSON");
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`PromptIntakeContract.${key} 必须是字符串`);
  }
  return value;
}

function requireStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`PromptIntakeContract.${key} 必须是字符串数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`PromptIntakeContract.${key}[${index}] 必须是字符串`);
    }
    return item.trim();
  }).filter(Boolean);
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`PromptIntakeContract.${key} 必须是布尔值`);
  }
  return value;
}

function requireTaskType(obj: Record<string, unknown>): PromptTaskType {
  const value = requireString(obj, "taskType");
  if (!TASK_TYPES.includes(value as PromptTaskType)) {
    throw new Error(`PromptIntakeContract.taskType 非法：${value}`);
  }
  return value as PromptTaskType;
}

function requireDocumentDependency(obj: Record<string, unknown>): DocumentDependency {
  const value = requireString(obj, "documentDependency");
  if (!DOCUMENT_DEPENDENCIES.includes(value as DocumentDependency)) {
    throw new Error(`PromptIntakeContract.documentDependency 非法：${value}`);
  }
  return value as DocumentDependency;
}

function optionalStringField(obj: Record<string, unknown>, key: keyof PromptOutputRequirements): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`PromptIntakeContract.outputRequirements.${key} 必须是字符串`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOutputRequirements(value: unknown): PromptOutputRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PromptIntakeContract.outputRequirements 必须是对象");
  }
  const record = value as Record<string, unknown>;
  return {
    length: optionalStringField(record, "length"),
    language: optionalStringField(record, "language"),
    format: optionalStringField(record, "format"),
    structure: optionalStringField(record, "structure"),
    targetAudience: optionalStringField(record, "targetAudience"),
  };
}

export function parsePromptIntakeContractFromResponse(
  rawContent: string,
  expectedRawPrompt: string,
): PromptIntakeContract {
  const json = parseJsonObject(rawContent);
  const rawPrompt = requireString(json, "rawPrompt");
  if (rawPrompt !== expectedRawPrompt) {
    throw new Error("PromptIntakeContract.rawPrompt 必须与用户原始输入逐字一致");
  }

  const contract: PromptIntakeContract = {
    rawPrompt,
    taskType: requireTaskType(json),
    primaryGoal: requireString(json, "primaryGoal").trim(),
    hardConstraints: requireStringArray(json, "hardConstraints"),
    outputRequirements: normalizeOutputRequirements(json.outputRequirements),
    documentDependency: requireDocumentDependency(json),
    missingCriticalInputs: requireStringArray(json, "missingCriticalInputs"),
    mustAskUser: requireBoolean(json, "mustAskUser"),
  };

  validatePromptIntakeContractShape(contract);
  return contract;
}

export function validatePromptIntakeContractShape(contract: PromptIntakeContract): void {
  if (!contract.primaryGoal.trim() && !contract.mustAskUser) {
    throw new Error("PromptIntakeContract.primaryGoal 为空时 mustAskUser 必须为 true");
  }
  if (contract.taskType === "unknown_blocked" && !contract.mustAskUser) {
    throw new Error("unknown_blocked 必须设置 mustAskUser=true");
  }
  if (contract.mustAskUser && contract.missingCriticalInputs.length === 0) {
    throw new Error("mustAskUser=true 时必须说明 missingCriticalInputs");
  }
}

export function validatePromptIntakeContract(contract: PromptIntakeContract): void {
  try {
    validatePromptIntakeContractShape(contract);
  } catch (error) {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  if (contract.taskType === "unknown_blocked" || contract.mustAskUser) {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      `用户需求无法直接执行：${contract.missingCriticalInputs.join("、") || "需要补充任务信息"}`,
      {
        details: {
          taskType: contract.taskType,
          missingCriticalInputs: contract.missingCriticalInputs,
          primaryGoal: contract.primaryGoal,
        },
      },
    );
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPromptIntakeContract(contract: PromptIntakeContract): string {
  const canonical = stableStringify(contract);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `prompt_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildPromptContractUserMessage(contract: PromptIntakeContract): string {
  return [
    "## Prompt Intake Contract",
    JSON.stringify(contract, null, 2),
    "",
    "Planner 必须以 primaryGoal 为本轮最高业务目标，并逐条遵守 hardConstraints。",
    "历史 memory 只能补充术语和已写事实，不得覆盖或弱化 hardConstraints。",
  ].join("\n");
}

export async function createPromptIntakeContract(
  rawPrompt: string,
  harness: AgentHarnessRuntime,
  aiOptions?: AIRequestOptions,
): Promise<{ contract: PromptIntakeContract; contractHash: string }> {
  return harness.withAgentStep(
    "planner",
    "prompt_intake.create_contract",
    () => harness.runModelStep({
      agentId: "planner",
      stepName: "prompt_intake.create_contract",
      callModel: async () => {
        const result = await callAI(
          [
            "请为以下用户原始输入生成 PromptIntakeContract。",
            "必须逐字保留 rawPrompt。",
            "",
            "## 用户原始输入",
            rawPrompt,
          ].join("\n"),
          PROMPT_INTAKE_SYSTEM_PROMPT,
          {
            ...(aiOptions || {}),
            structuredOutput: {
              name: "prompt_intake_contract",
              schema: PROMPT_INTAKE_SCHEMA as unknown as Record<string, unknown>,
              strict: true,
            },
          },
        );
        return (result.rawMarkdown ?? result.content).trim();
      },
      parse: (rawContent) => {
        const contract = parsePromptIntakeContractFromResponse(rawContent, rawPrompt);
        const contractHash = hashPromptIntakeContract(contract);
        harness.recordEvent({
          kind: "prompt_contract_created",
          message: contract.mustAskUser ? "Prompt contract requires user input" : "Prompt contract accepted",
          metadata: {
            taskType: contract.taskType,
            documentDependency: contract.documentDependency,
            mustAskUser: contract.mustAskUser,
            missingCriticalInputs: contract.missingCriticalInputs,
            contractHash,
          },
        });
        return { contract, contractHash };
      },
      metadata: {
        rawPromptChars: rawPrompt.length,
      },
    }),
  );
}

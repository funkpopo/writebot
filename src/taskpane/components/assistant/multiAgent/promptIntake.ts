import { callAIStream, type AIRequestOptions, type StreamCallback } from "../../../../utils/aiService";
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

/** Intake 解析路径：规则快路径 vs LLM。 */
export type IntakePath = "rule" | "llm";

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

export interface CreatePromptIntakeResult {
  contract: PromptIntakeContract;
  contractHash: string;
  intakePath: IntakePath;
  intakeMs: number;
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
2. 不要输出 rawPrompt 字段；用户原始输入只作为判断依据，运行时会绑定原文。
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
    "taskType",
    "primaryGoal",
    "hardConstraints",
    "outputRequirements",
    "documentDependency",
    "missingCriticalInputs",
    "mustAskUser",
  ],
  properties: {
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

  const contract: PromptIntakeContract = {
    rawPrompt: expectedRawPrompt,
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

// ---------------------------------------------------------------------------
// Rule-based fast path: high-confidence create_article only
// ---------------------------------------------------------------------------

/** 明确非「新建文章」的意图信号：命中则绝不走规则 create。 */
const NON_CREATE_INTENT_RE =
  /改写|润色|修改|修订|重写|替换|删减|删掉|删除|校对|纠错|纠偏|扩写这段|压缩这段|精简这段|把选中|选中的|这段文字|这段内容|这段话|续写|接着写|继续写|往下写|补充上|在文末|在文中|总结|摘要|概括|提炼|翻译|排版|格式化|调整格式|套用样式|revise|rewrite|continue|summarize|translate|format|polish/i;

/** 高置信「新建文章」动词 + 量词/体裁。 */
const CREATE_ARTICLE_RE =
  /(?:请|帮我|麻烦|可否|能否)?(?:写|撰写|起草|生成|创作|产出|完成)(?:一)?(?:篇|份|个|章)?(?:关于|有关|针对|围绕)?[\s\S]{0,80}?(?:文章|短文|长文|报告|方案|说明|介绍|综述|论文|稿件|文案|博客|blog|article|essay|report)|(?:写一篇|写一份|写一个|撰写一篇|起草一篇|生成一篇|创作一篇|写篇|生成篇)/i;

/** 纯英文高置信新建。 */
const CREATE_ARTICLE_EN_RE =
  /^(?:please\s+)?(?:write|draft|compose|generate|create)\s+(?:a|an|the)\s+(?:short\s+|long\s+)?(?:article|essay|report|blog(?:\s*post)?|paper)\b/i;

const LENGTH_RE =
  /(?:约|大约|大概|左右)?\s*(\d{2,5})\s*(?:字|words?|字左右|字上下)/i;

const LANGUAGE_CN_RE = /中文|汉语|简体中文|普通话/;
const LANGUAGE_EN_RE = /英文|英语|English/i;
const AUDIENCE_RE = /面向\s*([^\s，,。；;、]{1,20})|(?:给|为)\s*([^\s，,。；;、]{1,12})\s*(?:读者|用户|客户|管理层|领导|学生|开发者|工程师)/;

/**
 * 从用户原文用规则尝试产出 create_article contract。
 * - 仅高置信「新建文章」返回 contract
 * - 歧义 / 改写续写 / 主题过弱 → 返回 null，由 LLM Intake 兜底
 * - 规则侧绝不主动 mustAskUser（避免误中断）；主题过弱直接放弃规则
 */
export function tryRuleBasedPromptIntake(rawPrompt: string): PromptIntakeContract | null {
  const text = rawPrompt.trim();
  if (!text || text.length < 4) return null;

  // 保守：任何非 create 信号 → 交给 LLM（避免误路由）
  if (NON_CREATE_INTENT_RE.test(text)) return null;

  const isCreate =
    CREATE_ARTICLE_RE.test(text) || CREATE_ARTICLE_EN_RE.test(text);
  if (!isCreate) return null;

  // 去掉寒暄前缀后，剩余应仍有可执行主题（避免「写一篇文章」空主题硬进管线）
  const topicHint = extractCreateTopicHint(text);
  if (!topicHint || topicHint.length < 2) return null;

  const outputRequirements: PromptOutputRequirements = {};
  const lengthMatch = text.match(LENGTH_RE);
  if (lengthMatch?.[1]) {
    outputRequirements.length = `约${lengthMatch[1]}字`;
  }
  if (LANGUAGE_CN_RE.test(text)) {
    outputRequirements.language = "中文";
  } else if (LANGUAGE_EN_RE.test(text)) {
    outputRequirements.language = "英文";
  }
  const audienceMatch = text.match(AUDIENCE_RE);
  if (audienceMatch) {
    const audience = (audienceMatch[1] || audienceMatch[2] || "").trim();
    if (audience) outputRequirements.targetAudience = audience;
  }

  const hardConstraints = extractHardConstraints(text);
  const primaryGoal = buildCreatePrimaryGoal(topicHint, outputRequirements);

  const contract: PromptIntakeContract = {
    rawPrompt: text,
    taskType: "create_article",
    primaryGoal,
    hardConstraints,
    outputRequirements,
    documentDependency: "none",
    missingCriticalInputs: [],
    mustAskUser: false,
  };

  try {
    validatePromptIntakeContractShape(contract);
  } catch {
    return null;
  }

  return contract;
}

function extractCreateTopicHint(text: string): string {
  let cleaned = text
    .replace(/^(?:请|帮我|麻烦你?|可否|能否)\s*/i, "")
    .replace(
      /^(?:写|撰写|起草|生成|创作|产出|完成)(?:一)?(?:篇|份|个|章)?(?:关于|有关|针对|围绕)?/i,
      "",
    )
    .replace(
      /^(?:write|draft|compose|generate|create)\s+(?:a|an|the)\s+(?:short\s+|long\s+)?(?:article|essay|report|blog(?:\s*post)?|paper)\s*(?:about|on|regarding)?\s*/i,
      "",
    )
    .trim();

  // 去掉体裁词与常见约束尾巴，保留主题
  cleaned = cleaned
    .replace(/^(?:的)?(?:文章|短文|长文|报告|方案|说明|介绍|综述|论文|稿件|文案|博客)\s*/i, "")
    .replace(/(?:文章|短文|长文|报告|方案|说明|介绍|综述|论文|稿件|文案|博客)$/i, "")
    .replace(/(?:，|,)?\s*(?:用)?(?:中文|英文|汉语|英语)\s*(?:写作|撰写|写)?/gi, "")
    .replace(/(?:，|,)?\s*(?:约|大约|大概)?\s*\d{2,5}\s*(?:字|words?)/gi, "")
    .replace(/(?:，|,)?\s*面向[^\s，,。；;]{1,20}/g, "")
    .replace(/(?:，|,)?\s*(?:不要|禁止|必须|务必)[^。；;]*/g, "")
    .replace(/^[的地得\s，,：:]+|[。．.！!？?\s]+$/g, "")
    .trim();

  // 若仍以体裁开头（如「文章关于 AI」），再剥一层
  cleaned = cleaned
    .replace(/^(?:文章|报告|方案)\s*(?:关于|有关|针对|围绕)?/i, "")
    .trim();

  return cleaned;
}

function buildCreatePrimaryGoal(
  topicHint: string,
  outputRequirements: PromptOutputRequirements,
): string {
  const parts = [`撰写一篇关于「${topicHint}」的文章`];
  if (outputRequirements.targetAudience) {
    parts.push(`面向${outputRequirements.targetAudience}`);
  }
  if (outputRequirements.language) {
    parts.push(`使用${outputRequirements.language}`);
  }
  if (outputRequirements.length) {
    parts.push(`篇幅${outputRequirements.length}`);
  }
  return parts.join("，");
}

function extractHardConstraints(text: string): string[] {
  const constraints: string[] = [];
  const banMatches = text.matchAll(/(?:不要|禁止|切勿|不可|不能)\s*([^，,。；;\n]{2,40})/g);
  for (const match of banMatches) {
    const item = match[1]?.trim();
    if (item) constraints.push(`不要${item}`);
  }
  const mustMatches = text.matchAll(/(?:必须|务必|一定要|需要)\s*([^，,。；;\n]{2,40})/g);
  for (const match of mustMatches) {
    const item = match[1]?.trim();
    if (item) constraints.push(`必须${item}`);
  }
  // 去重并限量，避免把整句塞进约束
  return Array.from(new Set(constraints)).slice(0, 8);
}

function recordPromptContractCreated(
  harness: AgentHarnessRuntime,
  contract: PromptIntakeContract,
  contractHash: string,
  intakePath: IntakePath,
  intakeMs: number,
): void {
  harness.recordEvent({
    kind: "prompt_contract_created",
    message: contract.mustAskUser
      ? "Prompt contract requires user input"
      : intakePath === "rule"
        ? "Prompt contract accepted via rule fast-path"
        : "Prompt contract accepted",
    metadata: {
      taskType: contract.taskType,
      documentDependency: contract.documentDependency,
      mustAskUser: contract.mustAskUser,
      missingCriticalInputs: contract.missingCriticalInputs,
      contractHash,
      intakePath,
      intakeMs,
    },
  });
}

export async function createPromptIntakeContract(
  rawPrompt: string,
  harness: AgentHarnessRuntime,
  aiOptions?: AIRequestOptions,
  onChunk?: StreamCallback,
): Promise<CreatePromptIntakeResult> {
  const startedAt = Date.now();

  const ruleContract = tryRuleBasedPromptIntake(rawPrompt);
  if (ruleContract) {
    const contractHash = hashPromptIntakeContract(ruleContract);
    const intakeMs = Math.max(0, Date.now() - startedAt);
    await harness.withAgentStep(
      "planner",
      "prompt_intake.create_contract_rule",
      async () => {
        recordPromptContractCreated(harness, ruleContract, contractHash, "rule", intakeMs);
        return { contract: ruleContract, contractHash };
      },
    );
    return {
      contract: ruleContract,
      contractHash,
      intakePath: "rule",
      intakeMs,
    };
  }

  return harness.withAgentStep(
    "planner",
    "prompt_intake.create_contract",
    () => harness.runModelStep({
      agentId: "planner",
      stepName: "prompt_intake.create_contract",
      callModel: async () => {
        const result = await callAIStream(
          [
            "请为以下用户原始输入生成 PromptIntakeContract。",
            "不要在 JSON 中输出 rawPrompt；运行时会绑定用户原始输入。",
            "",
            "## 用户原始输入",
            rawPrompt,
          ].join("\n"),
          PROMPT_INTAKE_SYSTEM_PROMPT,
          onChunk,
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
        const intakeMs = Math.max(0, Date.now() - startedAt);
        recordPromptContractCreated(harness, contract, contractHash, "llm", intakeMs);
        return {
          contract,
          contractHash,
          intakePath: "llm" as const,
          intakeMs,
        };
      },
      metadata: {
        rawPromptChars: rawPrompt.length,
        intakePath: "llm",
      },
    }),
  );
}

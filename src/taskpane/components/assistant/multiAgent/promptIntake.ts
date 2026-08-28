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

/**
 * OpenAI strict structured outputs require every property key to appear in
 * `required`. Optional fields therefore use string|null unions.
 */
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
      required: ["length", "language", "format", "structure", "targetAudience"],
      properties: {
        length: { type: ["string", "null"] },
        language: { type: ["string", "null"] },
        format: { type: ["string", "null"] },
        structure: { type: ["string", "null"] },
        targetAudience: { type: ["string", "null"] },
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

/** Max chars of raw user input sent to the intake model (contract still binds full rawPrompt). */
const INTAKE_MODEL_PROMPT_MAX_CHARS = 6000;

function stripThinkTags(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

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

function tryParseJsonRecord(candidate: string): Record<string, unknown> | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Parse a model response that may include markdown fences, think tags, or
 * surrounding commentary. Prefer objects that look like PromptIntakeContract.
 */
function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = stripThinkTags(raw);
  if (!cleaned) {
    throw new Error("无法解析 Prompt Intake JSON：模型返回为空");
  }

  const candidates: string[] = [cleaned];
  const fencedBlocks = Array.from(cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const block of fencedBlocks) {
    const content = (block[1] || "").trim();
    if (content) candidates.push(content);
  }

  const parsedObjects: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const direct = tryParseJsonRecord(candidate);
    if (direct) parsedObjects.push(direct);

    for (const objectText of extractJsonObjectsFromText(candidate)) {
      const parsed = tryParseJsonRecord(objectText);
      if (parsed) parsedObjects.push(parsed);
    }
  }

  if (parsedObjects.length === 0) {
    const preview = cleaned.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`无法解析 Prompt Intake JSON：未找到有效对象（预览: ${preview}）`);
  }

  const preferred = parsedObjects.find((item) =>
    typeof item.taskType === "string"
    || typeof item.primaryGoal === "string"
    || typeof item.documentDependency === "string"
  );
  return preferred || parsedObjects[0]!;
}

function truncateForIntakeModel(rawPrompt: string): string {
  const text = rawPrompt.trim();
  if (text.length <= INTAKE_MODEL_PROMPT_MAX_CHARS) return text;
  const headLen = Math.floor(INTAKE_MODEL_PROMPT_MAX_CHARS * 0.6);
  const tailLen = Math.floor(INTAKE_MODEL_PROMPT_MAX_CHARS * 0.3);
  const omitted = text.length - headLen - tailLen;
  return [
    text.slice(0, headLen),
    "",
    `...[中间已省略 ${omitted} 字，仅供意图分类；完整原文已在运行时绑定]...`,
    "",
    text.slice(-tailLen),
  ].join("\n");
}

function shouldFallbackToUnstructuredIntake(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || "";
  const statusMatch = message.match(/状态码\s*(\d+)/);
  const status = statusMatch ? Number.parseInt(statusMatch[1]!, 10) : NaN;
  const schemaUnsupportedHint =
    /response[_\s-]?format|response[_\s-]?schema|json[_\s-]?schema|schema|structured/i.test(message);
  if (schemaUnsupportedHint && Number.isFinite(status)) {
    return status === 400 || status === 404 || status === 415 || status === 422;
  }
  return schemaUnsupportedHint && !Number.isFinite(status);
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

/** 高置信局部改写 / 选区处理意图（用于规则快路径，避免无 LLM JSON）。 */
const REVISE_SELECTION_RE =
  /(?:润色|改写|修改|修订|重写|替换|删减|校对|纠错|扩写|压缩|精简|优化|整理)[\s\S]{0,40}?(?:选中|这段|该段|以下|上面|下文|文字|内容|段落|句子)|(?:把|将)?(?:选中|这段|该段|以下)[\s\S]{0,40}?(?:润色|改写|修改|重写|替换|删减|扩写|压缩|精简|优化)|polish|rewrite|revise|paraphrase/i;

/** 短指令润色/改写（依赖 Word 选区，不必写「选中」）。例：润色 / 改写得更正式 */
const REVISE_SHORT_INSTRUCTION_CN_RE =
  /^(?:请|帮我|麻烦你?)?(?:把|将)?(?:它|其)?(?:文字|内容|段落|文本|表达)?(?:润色|改写|重写|精简|扩写|优化|校对)(?:一下|下)?(?:得|的|为|成|成更|得更)?[\s\S]{0,40}$/i;
const REVISE_SHORT_INSTRUCTION_EN_RE =
  /^(?:please\s+)?(?:polish|rewrite|revise|paraphrase)\b[\s\S]{0,60}$/i;

function isShortReviseInstruction(text: string): boolean {
  const trimmed = text.trim();
  // Only short free-form instructions, not pasted essays.
  if (!trimmed || trimmed.length > 80) return false;
  return REVISE_SHORT_INSTRUCTION_CN_RE.test(trimmed) || REVISE_SHORT_INSTRUCTION_EN_RE.test(trimmed);
}

const SUMMARIZE_SELECTION_RE =
  /(?:总结|摘要|概括|提炼|归纳)[\s\S]{0,40}?(?:选中|这段|该段|以下|全文|文章|内容|要点)|(?:把|将)?(?:选中|这段|以下|全文)[\s\S]{0,40}?(?:总结|摘要|概括|提炼)|summarize|summary/i;

/** 短指令总结：总结 / 生成摘要 / 提炼要点 */
const SUMMARIZE_SHORT_RE =
  /^(?:请|帮我|麻烦你?)?(?:总结|摘要|概括|提炼要点|生成摘要|做个摘要|写个摘要)(?:一下|下)?[\s\S]{0,40}$/i;

const FORMAT_SELECTION_RE =
  /(?:排版|格式化|调整格式|套用样式|统一格式|优化排版|排版优化)|(?:format|typeset)/i;

/** 短指令排版：排版 / 优化排版 / 调整格式 */
const FORMAT_SHORT_RE =
  /^(?:请|帮我|麻烦你?)?(?:优化)?(?:排版|格式)(?:优化|调整|整理)?(?:一下|下)?[\s\S]{0,40}$/i;

const CONTINUE_DOC_RE =
  /(?:续写|接着写|继续写|往下写|补充上|在文末|continue\s+writing|continue\s+from)/i;

/** 短指令续写：续写 / 继续写 / 往下写 */
const CONTINUE_SHORT_RE =
  /^(?:请|帮我|麻烦你?)?(?:续写|接着写|继续写|往下写|继续往下写)(?:一下|下)?[\s\S]{0,40}$/i;

/**
 * 从用户原文用规则尝试产出 contract。
 * - 高置信「新建文章」→ create_article
 * - 高置信选区/局部改写、总结、排版、续写 → 对应 taskType（由管线后续校验是否放行）
 * - 歧义 / 主题过弱 → 返回 null，由 LLM Intake 兜底
 * - 规则侧 create 路径绝不主动 mustAskUser；主题过弱直接放弃规则
 */
export function tryRuleBasedPromptIntake(rawPrompt: string): PromptIntakeContract | null {
  const text = rawPrompt.trim();
  if (!text || text.length < 2) return null;

  // 选区/局部任务优先识别，避免误入 create_article 或依赖脆弱的 LLM JSON
  const localContract = tryRuleBasedLocalDocumentIntent(text);
  if (localContract) return localContract;

  // 保守：其余非 create 信号 → 交给 LLM
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

/**
 * 高置信局部文档任务（选区润色/改写、总结、排版、续写）。
 * 返回可校验的 contract，避免 LLM JSON 解析失败；是否进入写作管线由 orchestrator 决定。
 */
function tryRuleBasedLocalDocumentIntent(text: string): PromptIntakeContract | null {
  // 明确「写一篇/生成一篇…文章」时优先交给 create 路径，
  // 避免主题里出现「润色/总结」等词被误判为局部任务。
  if (CREATE_ARTICLE_RE.test(text) || CREATE_ARTICLE_EN_RE.test(text)) {
    return null;
  }

  let taskType: PromptTaskType | null = null;
  let primaryGoal = "";
  let documentDependency: DocumentDependency = "needs_selection";

  // Order matters: format/summarize/continue before revise, because short
  // revise patterns include broad verbs like「优化」that would steal「优化排版」.
  if (FORMAT_SELECTION_RE.test(text) || FORMAT_SHORT_RE.test(text)) {
    taskType = "format";
    primaryGoal = text.length <= 40
      ? `排版优化：${text}`
      : "按用户要求优化选区排版与结构";
    documentDependency = "needs_selection";
  } else if (SUMMARIZE_SELECTION_RE.test(text) || SUMMARIZE_SHORT_RE.test(text)) {
    taskType = "summarize";
    primaryGoal = text.length <= 40
      ? `总结：${text}`
      : "总结或提炼用户指定的文本要点";
    documentDependency = /全文|整篇|整篇文章|这篇文章|整个文档|document/i.test(text)
      ? "needs_index"
      : "needs_selection";
  } else if (CONTINUE_DOC_RE.test(text) || CONTINUE_SHORT_RE.test(text)) {
    taskType = "continue_document";
    primaryGoal = text.length <= 40
      ? `续写：${text}`
      : "基于现有文档继续写作";
    // 续写优先用选区/光标附近上文；index 仅作无选区时的兜底锚点
    documentDependency = "needs_selection";
  } else if (REVISE_SELECTION_RE.test(text) || isShortReviseInstruction(text)) {
    taskType = "revise_existing";
    primaryGoal = text.length <= 40
      ? `按指令处理当前选区：${text}`
      : "按用户指令改写或润色当前选区/指定文本";
    documentDependency = "needs_selection";
  }

  if (!taskType) return null;

  const contract: PromptIntakeContract = {
    rawPrompt: text,
    taskType,
    primaryGoal,
    hardConstraints: extractHardConstraints(text),
    outputRequirements: {},
    documentDependency,
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

  const intakeUserMessage = [
    "请为以下用户原始输入生成 PromptIntakeContract。",
    "不要在 JSON 中输出 rawPrompt；运行时会绑定用户原始输入。",
    "若输入很长，中间可能已省略，请仍根据可见指令与首尾上下文判断意图。",
    "",
    "## 用户原始输入",
    truncateForIntakeModel(rawPrompt),
  ].join("\n");

  return harness.withAgentStep(
    "planner",
    "prompt_intake.create_contract",
    () => harness.runModelStep({
      agentId: "planner",
      stepName: "prompt_intake.create_contract",
      outputContract: "PromptIntakeContract JSON",
      callModel: async () => {
        const callIntake = async (useStructured: boolean) => {
          const result = await callAIStream(
            intakeUserMessage,
            PROMPT_INTAKE_SYSTEM_PROMPT,
            onChunk,
            {
              ...(aiOptions || {}),
              ...(useStructured
                ? {
                    structuredOutput: {
                      name: "prompt_intake_contract",
                      schema: PROMPT_INTAKE_SCHEMA as unknown as Record<string, unknown>,
                      // strict schema is fully required-compatible; still fall back if provider rejects it
                      strict: true,
                    },
                  }
                : {}),
            },
          );
          return (result.rawMarkdown ?? result.content).trim();
        };

        try {
          return await callIntake(true);
        } catch (error) {
          if (!shouldFallbackToUnstructuredIntake(error)) throw error;
          return callIntake(false);
        }
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
        intakeModelPromptChars: intakeUserMessage.length,
        intakePath: "llm",
      },
    }),
  );
}

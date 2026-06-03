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

const TASK_PATTERNS: Array<{ taskType: Exclude<PromptTaskType, "unknown_blocked">; patterns: RegExp[] }> = [
  {
    taskType: "continue_document",
    patterns: [
      /继续(写|撰写|完成|展开|补充)?/,
      /续写/,
      /接着(写|上文|继续)/,
      /\bcontinue\b/i,
      /\bkeep writing\b/i,
    ],
  },
  {
    taskType: "revise_existing",
    patterns: [
      /(修改|修订|改写|润色|调整|优化|重写|替换|删除)/,
      /(只|仅|只要|只需).*(改|修改|修订|调整)/,
      /\b(revise|rewrite|edit|polish|change|replace|delete)\b/i,
    ],
  },
  {
    taskType: "summarize",
    patterns: [
      /(总结|摘要|概括|提炼|归纳)/,
      /\b(summarize|summary|recap)\b/i,
    ],
  },
  {
    taskType: "format",
    patterns: [
      /(排版|格式|样式|标题层级|字体|字号|行距|对齐|目录)/,
      /\b(format|layout|style|typography)\b/i,
    ],
  },
  {
    taskType: "create_article",
    patterns: [
      /(写|撰写|生成|起草|创作).{0,12}(文章|报告|方案|文案|论文|稿|材料|大纲|计划|邮件)/,
      /(写一篇|写一份|生成一篇|生成一份|撰写一篇|撰写一份)/,
      /\b(write|draft|create|generate)\b.{0,40}\b(article|report|essay|proposal|copy|document|post|plan)\b/i,
    ],
  },
];

const HARD_CONSTRAINT_PATTERNS = [
  /不要[^，。；;\n]*/g,
  /不能[^，。；;\n]*/g,
  /禁止[^，。；;\n]*/g,
  /必须[^，。；;\n]*/g,
  /务必[^，。；;\n]*/g,
  /只(?:改|修改|写|保留|输出|生成|使用)[^，。；;\n]*/g,
  /仅(?:改|修改|写|保留|输出|生成|使用)[^，。；;\n]*/g,
  /\bdo not\b[^.;\n]*/gi,
  /\bdon't\b[^.;\n]*/gi,
  /\bmust\b[^.;\n]*/gi,
  /\bonly\b[^.;\n]*/gi,
  /\bnever\b[^.;\n]*/gi,
] as const;

const LENGTH_PATTERNS = [
  /(\d+\s*(?:字|词|words?|characters?))/i,
  /(不少于\s*\d+\s*(?:字|词|words?|characters?))/i,
  /(不超过\s*\d+\s*(?:字|词|words?|characters?))/i,
  /(约\s*\d+\s*(?:字|词|words?|characters?))/i,
  /(\d+\s*[-~到至]\s*\d+\s*(?:字|词|words?|characters?))/i,
  /(短文|长文|简短|详细|精简|扩展版|brief|detailed|concise)/i,
] as const;

const FORMAT_PATTERNS = [
  /(Markdown|markdown|表格|列表|项目符号|编号|JSON|json|Word|word|标题|小标题)/,
  /\b(table|bullet|numbered list|markdown|json|heading|headings)\b/i,
] as const;

const STRUCTURE_PATTERNS = [
  /(不要写引言|不写引言|不要引言|无引言|不要结论|不写结论|分成\s*\d+\s*(?:节|章|部分)|\d+\s*(?:节|章|部分))/,
  /\b(no introduction|without introduction|no conclusion|without conclusion|\d+\s+sections?)\b/i,
] as const;

const AUDIENCE_PATTERNS = [
  /(?:面向|目标读者|受众|给|写给)([^，。；;\n]+)/,
  /\b(?:for|audience)\s+([^.;\n]+)/i,
] as const;

const LANGUAGE_PATTERNS = [
  /(中文|英文|日文|韩文|法文|德文|西班牙文|Chinese|English|Japanese|Korean|French|German|Spanish)/i,
] as const;

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeLine(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function detectTaskType(prompt: string): PromptTaskType {
  for (const candidate of TASK_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(prompt))) {
      return candidate.taskType;
    }
  }
  return "unknown_blocked";
}

function extractMatches(prompt: string, patterns: readonly RegExp[]): string[] {
  const values: string[] = [];
  for (const pattern of patterns) {
    const source = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of prompt.matchAll(source)) {
      values.push(match[1] || match[0]);
    }
  }
  return uniq(values);
}

function extractFirstMatch(prompt: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1] || match?.[0];
    if (value?.trim()) return normalizeLine(value);
  }
  return undefined;
}

function extractOutputRequirements(prompt: string): PromptOutputRequirements {
  return {
    length: extractFirstMatch(prompt, LENGTH_PATTERNS),
    language: extractFirstMatch(prompt, LANGUAGE_PATTERNS),
    format: extractFirstMatch(prompt, FORMAT_PATTERNS),
    structure: extractFirstMatch(prompt, STRUCTURE_PATTERNS),
    targetAudience: extractFirstMatch(prompt, AUDIENCE_PATTERNS),
  };
}

function detectDocumentDependency(taskType: PromptTaskType, prompt: string): DocumentDependency {
  if (taskType === "create_article" || taskType === "unknown_blocked") {
    return "none";
  }

  if (/(选中|所选|selection|selected text)/i.test(prompt)) {
    return "needs_selection";
  }

  if (/(第\s*[一二三四五六七八九十\d]+\s*(节|章|部分)|section\s+\d+|paragraph\s+\d+|段落\s*\d+)/i.test(prompt)) {
    return "needs_ranges";
  }

  return "needs_index";
}

function extractPrimaryGoal(prompt: string, taskType: PromptTaskType): string {
  const sentences = prompt
    .split(/[。！？!?;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences.length === 0) return "";

  const taskSentence = sentences.find((sentence) => {
    const type = detectTaskType(sentence);
    return type === taskType && type !== "unknown_blocked";
  });

  return normalizeLine(taskSentence || sentences[0]);
}

function inferMissingCriticalInputs(
  taskType: PromptTaskType,
  primaryGoal: string,
  prompt: string,
): string[] {
  const missing: string[] = [];
  if (!primaryGoal) {
    missing.push("用户本轮主要目标");
  }

  if (taskType === "unknown_blocked") {
    missing.push("可执行任务类型");
  }

  if (
    taskType === "create_article"
    && !/(关于|主题|围绕|以|topic|about|on)\s*[^，。；;\n]+/i.test(prompt)
    && prompt.length < 12
  ) {
    missing.push("文章主题");
  }

  if (
    (taskType === "revise_existing" || taskType === "summarize" || taskType === "format")
    && !/(全文|整篇|文档|第\s*[一二三四五六七八九十\d]+\s*(节|章|部分)|选中|所选|selection|section|paragraph|段落)/i.test(prompt)
  ) {
    missing.push("目标文档范围");
  }

  return uniq(missing);
}

export function parsePromptIntakeContract(rawPrompt: string): PromptIntakeContract {
  if (typeof rawPrompt !== "string") {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      "用户需求必须是字符串",
      { details: { rawPromptType: typeof rawPrompt } },
    );
  }

  const trimmed = rawPrompt.trim();
  if (!trimmed) {
    return {
      rawPrompt,
      taskType: "unknown_blocked",
      primaryGoal: "",
      hardConstraints: [],
      outputRequirements: {},
      documentDependency: "none",
      missingCriticalInputs: ["用户本轮主要目标", "可执行任务类型"],
      mustAskUser: true,
    };
  }

  const taskType = detectTaskType(trimmed);
  const primaryGoal = extractPrimaryGoal(trimmed, taskType);
  const outputRequirements = extractOutputRequirements(trimmed);
  const hardConstraints = extractMatches(trimmed, HARD_CONSTRAINT_PATTERNS);
  const missingCriticalInputs = inferMissingCriticalInputs(taskType, primaryGoal, trimmed);

  return {
    rawPrompt,
    taskType,
    primaryGoal,
    hardConstraints,
    outputRequirements,
    documentDependency: detectDocumentDependency(taskType, trimmed),
    missingCriticalInputs,
    mustAskUser: taskType === "unknown_blocked" || missingCriticalInputs.length > 0,
  };
}

export function validatePromptIntakeContract(contract: PromptIntakeContract): void {
  if (!contract || typeof contract !== "object") {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      "Prompt Intake Contract 不是有效对象",
    );
  }

  if (typeof contract.rawPrompt !== "string") {
    throw new AgentHarnessError(
      "prompt_contract_invalid",
      "Prompt Intake Contract 缺少 rawPrompt",
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

export function createPromptIntakeContract(
  rawPrompt: string,
  harness?: AgentHarnessRuntime,
): { contract: PromptIntakeContract; contractHash: string } {
  const contract = parsePromptIntakeContract(rawPrompt);
  const contractHash = hashPromptIntakeContract(contract);

  harness?.recordEvent({
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

  validatePromptIntakeContract(contract);
  return { contract, contractHash };
}

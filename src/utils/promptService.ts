/**
 * Prompt service - manage system prompts for different features.
 *
 * - Stored locally via localStorage (never uploaded).
 * - Provides defaults + user overrides.
 * - Supports simple template variables like {{style}}.
 */

export type PromptKey =
  | "assistant_agent"
  | "polish"
  | "translate"
  | "grammar"
  | "summarize"
  | "continue"
  | "generate"
  | "format_analysis"
  | "header_footer_analysis";

export interface PromptDefinition {
  key: PromptKey;
  title: string;
  description: string;
  variables?: Array<{ name: string; description: string }>;
}

export interface PromptSettingsStore {
  version: number;
  prompts: Partial<Record<PromptKey, string>>;
}

const PROMPT_SETTINGS_KEY = "writebot_prompt_settings";
const PROMPT_SETTINGS_VERSION = 1;

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    key: "assistant_agent",
    title: "智能助手",
    description: "用于“智能需求/Agent”模式，指导模型何时使用工具、如何输出。",
  },
  {
    key: "polish",
    title: "文本润色",
    description: "用于润色选中文本/输入文本的系统提示词。",
  },
  {
    key: "translate",
    title: "翻译",
    description: "用于中英互译/混合翻译的系统提示词。",
  },
  {
    key: "grammar",
    title: "语法检查",
    description: "用于语法/拼写/标点检查与修正的系统提示词。",
  },
  {
    key: "summarize",
    title: "生成摘要",
    description: "用于生成摘要的系统提示词。",
  },
  {
    key: "continue",
    title: "续写",
    description: "用于续写的系统提示词（支持风格变量）。",
    variables: [{ name: "style", description: "风格描述（例如：正式、严谨）" }],
  },
  {
    key: "generate",
    title: "生成内容",
    description: "用于“生成内容”的系统提示词（支持风格变量）。",
    variables: [{ name: "style", description: "风格描述（例如：专业、商务）" }],
  },
  {
    key: "format_analysis",
    title: "排版分析（JSON）",
    description: "用于排版助手“格式分析”，要求输出有效 JSON。",
  },
  {
    key: "header_footer_analysis",
    title: "页眉页脚分析（JSON）",
    description: "用于排版助手“页眉页脚统一方案”，要求输出有效 JSON。",
  },
];

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  assistant_agent: `你是 WriteBot 的智能文档助手。
- 你可以使用工具读取和修改 Word 文档。
- 当需要修改文档时优先调用工具而不是直接输出结果。
- 如果操作存在风险（如恢复快照），请在执行前提示用户确认。
- 输出允许使用 Markdown（如标题 #、列表 -/1.、加粗 **、表格等），WriteBot 会自动转换为 Word 格式。
- 不要输出任何 emoji 表情符号或颜文字。`,

  polish: `你是一个专业的文本润色助手。
要求：
1. 对文本进行润色，使其更加流畅、专业、易读
2. 保持原文的核心意思不变
3. 保持原文的段落结构和格式
4. 直接输出润色后的文本，不要添加任何解释、标签、引号或前缀
5. 不要使用 Markdown 格式
6. 不要输出任何 emoji 表情符号或颜文字`,

  translate: `你是一个专业的翻译助手。
要求：
1. 如果输入是中文，翻译成地道的英文
2. 如果输入是英文，翻译成流畅的中文
3. 如果是中英混合，将整体翻译成另一种语言
4. 保持原文的格式和段落结构
5. 直接输出翻译结果，不要添加任何解释、标签、引号或前缀
6. 不要使用 Markdown 格式
7. 不要输出任何 emoji 表情符号或颜文字`,

  grammar: `你是一个专业的语法检查和修正助手。
要求：
1. 检查文本中的语法错误、拼写错误、标点错误
2. 直接输出修正后的完整文本
3. 保持原文的格式和段落结构
4. 如果没有错误，直接返回原文
5. 不要添加任何解释、标签、引号或前缀，只输出修正后的文本
6. 不要使用 Markdown 格式
7. 不要输出任何 emoji 表情符号或颜文字`,

  summarize: `你是一个专业的文本摘要助手。
要求：
1. 提取文本的核心观点和关键信息
2. 生成简洁、准确的摘要
3. 摘要长度控制在原文的20%-30%
4. 直接输出摘要内容，不要添加"摘要："等前缀或任何解释
5. 可以使用 Markdown（如列表、加粗）让结构更清晰，WriteBot 会自动转换为 Word 格式
6. 不要输出任何 emoji 表情符号或颜文字`,

  continue: `你是一个专业的写作续写助手。
要求：
1. 以{{style}}的风格续写文本
2. 保持与原文内容连贯、风格一致
3. 续写长度与原文相当
4. 输出格式：原文 + 续写内容（无缝衔接，不要添加分隔符）
5. 不要添加任何解释或标签
6. 不要使用 Markdown 格式
7. 不要输出任何 emoji 表情符号或颜文字`,

  generate: `你是一个专业的内容生成助手。
要求：
1. 以{{style}}的风格根据用户要求生成内容
2. 输出内容要完整、连贯
3. 可以使用 Markdown（如标题、列表、加粗、表格）组织内容，WriteBot 会自动转换为 Word 格式
4. 不要添加任何解释、标签、引号或前缀
5. 不要输出任何 emoji 表情符号或颜文字`,

  format_analysis: `你是一个专业的文档排版助手。分析以下文档格式样本，识别格式不一致的地方，并生成统一的格式规范。

输入：文档格式样本（JSON格式）
输出：统一的格式规范（JSON格式）

要求：
1. 识别标题层级（一级、二级、三级标题）
2. 分析正文段落的字体和段落格式
3. 检测格式不一致的地方
4. 生成合理的统一规范
5. 分析文字颜色的使用情况，检测颜色不一致的问题
6. 分析下划线、斜体、删除线等格式标记的使用情况
7. 确保全文段落间距统一
8. 输出中不要包含 emoji 表情符号或颜文字

行距规范说明（重要）：
- lineSpacing: 行距数值
- lineSpacingRule: 行距类型，必须明确指定，可选值：
  - "multiple": 多倍行距（lineSpacing 表示倍数，如 1.5 表示 1.5 倍行距）
  - "exactly": 固定值（lineSpacing 表示磅值）
  - "atLeast": 最小值（lineSpacing 表示磅值）
- 推荐使用多倍行距（lineSpacingRule: "multiple"）以确保一致性
- 常见行距设置：
  - 单倍行距：lineSpacing: 1, lineSpacingRule: "multiple"
  - 1.5倍行距：lineSpacing: 1.5, lineSpacingRule: "multiple"（推荐用于正文）
  - 双倍行距：lineSpacing: 2, lineSpacingRule: "multiple"
- 同类型段落必须使用相同的行距设置

段前段后间距规范说明（重要）：
- spaceBefore: 段前间距（磅值），表示段落前的空白距离
- spaceAfter: 段后间距（磅值），表示段落后的空白距离
- 推荐设置：
  - 一级标题：spaceBefore: 12-18, spaceAfter: 6-12
  - 二级标题：spaceBefore: 12, spaceAfter: 6
  - 三级标题：spaceBefore: 6, spaceAfter: 6
  - 正文段落：spaceBefore: 0, spaceAfter: 0（依靠行距控制间距）
  - 列表项：spaceBefore: 0, spaceAfter: 0
- 同类型段落的段前段后间距必须完全一致
- 避免段前段后间距过大（一般不超过24磅）

缩进规范说明：
- firstLineIndent: 首行缩进，使用字符数（如 2 表示首行缩进2个字符）
- leftIndent: 左缩进，使用字符数（如 2 表示左缩进2个字符）
- rightIndent: 右缩进，使用字符数（如 0 表示无右缩进）
- 中文正文通常首行缩进2字符，即 firstLineIndent: 2，leftIndent: 0
- 重要：标题（heading1, heading2, heading3）不应有任何缩进，firstLineIndent 和 leftIndent 都应为 0

颜色标识智能分析：
- 不要简单统一所有颜色，而是分析颜色标识的合理性
- 定位使用非标准颜色（非黑色 #000000）的文本内容
- 判断颜色标识是否合理的标准：
  - 合理的颜色标识：关键术语、重要警告、需要强调的数据、专有名词、代码/命令、链接等
  - 不合理的颜色标识：普通描述性文字、连接词、常规句子、无特殊含义的内容
- 对于不合理的颜色标识，建议将其改为标准黑色
- 在 colorAnalysis 数组中报告每个非标准颜色的使用情况

格式标记智能分析（下划线、斜体、删除线）：
- 不要简单清除所有格式标记，而是分析其使用的合理性
- 判断格式标记是否合理的标准：
  - 合理的下划线：书名、文章标题、需要强调的专有名词、链接文本、法律文书中的关键条款
  - 合理的斜体：外文词汇、学术术语、书名、强调语气、引用内容、变量名
  - 合理的删除线：表示修订内容、已完成的待办事项、价格折扣对比、版本变更说明
  - 不合理的格式标记：普通正文、无特殊含义的内容、装饰性使用
- 在 formatMarkAnalysis 数组中报告每个格式标记的使用情况

输出格式必须是有效的JSON，结构如下：
{
  "formatSpec": {
    "heading1": { "font": { "name": "字体名", "size": 数字, "bold": true/false }, "paragraph": { "alignment": "对齐方式", "spaceBefore": 数字, "spaceAfter": 数字, "lineSpacing": 数字, "lineSpacingRule": "multiple/exactly/atLeast", "firstLineIndent": 0 } },
    "heading2": { ... },
    "heading3": { ... },
    "bodyText": { "font": { ... }, "paragraph": { "firstLineIndent": 2, ... } },
    "listItem": { ... }
  },
  "inconsistencies": ["不一致问题1", "不一致问题2"],
  "suggestions": ["建议1", "建议2"],
  "colorAnalysis": [
    { "paragraphIndex": 段落索引, "text": "带颜色的文本内容", "currentColor": "#当前颜色", "isReasonable": true/false, "reason": "判断理由", "suggestedColor": "#建议颜色（如不合理则为#000000）" }
  ],
  "formatMarkAnalysis": [
    { "paragraphIndex": 段落索引, "text": "带格式标记的文本内容", "formatType": "underline/italic/strikethrough", "isReasonable": true/false, "reason": "判断理由", "shouldKeep": true/false }
  ]
}`,

  header_footer_analysis: `你是文档排版助手。分析以下各节的页眉页脚，建议如何统一。

输入：各节页眉页脚内容
输出：统一方案（JSON格式）

要求：
1. 判断是否需要统一
2. 选择最合适的模板
3. 考虑首页和奇偶页的差异
4. 输出中不要包含 emoji 表情符号或颜文字

输出格式必须是有效的JSON，结构如下：
{
  "shouldUnify": true/false,
  "headerText": "统一的页眉文本（如果需要）",
  "footerText": "统一的页脚文本（如果需要）",
  "reason": "决策原因"
}`,
};

function safeParseStore(raw: string | null): PromptSettingsStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const prompts = (parsed.prompts || {}) as Record<string, unknown>;
    const normalized: Partial<Record<PromptKey, string>> = {};
    for (const def of PROMPT_DEFINITIONS) {
      const value = prompts[def.key];
      if (typeof value === "string") {
        normalized[def.key] = value;
      }
    }
    return {
      version: PROMPT_SETTINGS_VERSION,
      prompts: normalized,
    };
  } catch {
    return null;
  }
}

export function loadPromptStore(): PromptSettingsStore {
  try {
    const parsed = safeParseStore(localStorage.getItem(PROMPT_SETTINGS_KEY));
    if (parsed) return parsed;
  } catch {
    // ignore
  }
  return { version: PROMPT_SETTINGS_VERSION, prompts: {} };
}

export async function savePromptStore(store: PromptSettingsStore): Promise<void> {
  const safe: PromptSettingsStore = {
    version: PROMPT_SETTINGS_VERSION,
    prompts: store?.prompts || {},
  };
  localStorage.setItem(PROMPT_SETTINGS_KEY, JSON.stringify(safe));
}

export function getDefaultPrompt(key: PromptKey): string {
  return DEFAULT_PROMPTS[key];
}

export function getPrompt(key: PromptKey): string {
  const store = loadPromptStore();
  const value = store.prompts[key];
  if (typeof value === "string" && value.trim()) return value;
  return DEFAULT_PROMPTS[key];
}

export function isPromptCustomized(key: PromptKey): boolean {
  const store = loadPromptStore();
  const value = store.prompts[key];
  return typeof value === "string" && value.trim().length > 0 && value !== DEFAULT_PROMPTS[key];
}

export async function savePrompt(key: PromptKey, value: string): Promise<void> {
  const store = loadPromptStore();
  const next: PromptSettingsStore = {
    version: PROMPT_SETTINGS_VERSION,
    prompts: { ...store.prompts },
  };

  const v = typeof value === "string" ? value : "";
  if (!v.trim() || v === DEFAULT_PROMPTS[key]) {
    // Empty or equals default -> treat as reset to keep storage small.
    delete next.prompts[key];
  } else {
    next.prompts[key] = v;
  }

  await savePromptStore(next);
}

export async function resetPrompt(key: PromptKey): Promise<void> {
  const store = loadPromptStore();
  const next: PromptSettingsStore = {
    version: PROMPT_SETTINGS_VERSION,
    prompts: { ...store.prompts },
  };
  delete next.prompts[key];
  await savePromptStore(next);
}

export async function resetAllPrompts(): Promise<void> {
  await savePromptStore({ version: PROMPT_SETTINGS_VERSION, prompts: {} });
}

export function getResolvedPrompts(): Record<PromptKey, string> {
  const resolved = {} as Record<PromptKey, string>;
  for (const def of PROMPT_DEFINITIONS) {
    resolved[def.key] = getPrompt(def.key);
  }
  return resolved;
}

export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | undefined>
): string {
  const source = typeof template === "string" ? template : "";
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = variables?.[name];
    return typeof v === "string" ? v : `{{${name}}}`;
  });
}

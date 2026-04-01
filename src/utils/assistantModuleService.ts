export type AssistantModuleKind = "workflow" | "simple";
export type AssistantSimpleBehavior = "basic" | "translation" | "style";
export const ASSISTANT_MODULE_ICON_KEYS = [
  "agent",
  "polish",
  "translate",
  "grammar",
  "summarize",
  "continue",
  "generate",
  "description",
  "format",
  "settings",
  "search",
  "document",
  "document_text",
  "book",
  "notebook",
  "note",
  "clipboard_task",
  "pen",
  "edit",
  "compose",
  "chat",
  "chat_sparkle",
  "code",
  "data",
  "table",
  "target",
  "lightbulb",
  "brain",
  "apps",
  "rocket",
  "globe",
  "people",
  "mail",
  "calendar",
  "image",
  "camera",
  "folder",
  "home",
  "star",
  "heart",
  "tag",
  "receipt",
  "tasks",
  "slide_text",
  "text_bullet",
  "text_quote",
  "person_lightbulb",
  "scan",
  "custom",
] as const;

export type AssistantModuleIconKey = (typeof ASSISTANT_MODULE_ICON_KEYS)[number];

export interface AssistantModuleDefinition {
  id: string;
  label: string;
  description: string;
  kind: AssistantModuleKind;
  simpleBehavior?: AssistantSimpleBehavior;
  enabled: boolean;
  builtIn: boolean;
  order: number;
  inputPlaceholder?: string;
  promptKey?: string;
  defaultPrompt?: string;
  promptDescription?: string;
  iconKey?: AssistantModuleIconKey;
}

interface AssistantModuleStore {
  version: number;
  modules: AssistantModuleDefinition[];
  removedBuiltinIds: string[];
}

const ASSISTANT_MODULES_STORAGE_KEY = "writebot_assistant_modules";
const ASSISTANT_MODULES_VERSION = 1;
const DEFAULT_INPUT_PLACEHOLDER = "输入文本或从文档中选择内容...";

const BUILTIN_ASSISTANT_MODULES: readonly AssistantModuleDefinition[] = [
  {
    id: "agent",
    label: "智能需求",
    description: "多阶段写作流程，可自动规划大纲、撰写章节并回写文档。",
    kind: "workflow",
    enabled: true,
    builtIn: true,
    order: 10,
    inputPlaceholder: "描述你的需求，AI 会自动规划并写入文档...",
    iconKey: "agent",
  },
  {
    id: "polish",
    label: "润色",
    description: "润色选中文本或输入文本，使表达更自然流畅。",
    kind: "simple",
    simpleBehavior: "basic",
    enabled: true,
    builtIn: true,
    order: 20,
    promptKey: "polish",
    promptDescription: "用于润色选中文本/输入文本的系统提示词。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "polish",
  },
  {
    id: "translate",
    label: "翻译",
    description: "将文本翻译为指定语言，支持自动识别源语言。",
    kind: "simple",
    simpleBehavior: "translation",
    enabled: true,
    builtIn: true,
    order: 30,
    promptKey: "translate",
    promptDescription: "用于多语种翻译（支持自动识别源语言、指定目标语言）的系统提示词。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "translate",
  },
  {
    id: "grammar",
    label: "语法检查",
    description: "检查并修正文中的语法、拼写和标点问题。",
    kind: "simple",
    simpleBehavior: "basic",
    enabled: true,
    builtIn: true,
    order: 40,
    promptKey: "grammar",
    promptDescription: "用于语法/拼写/标点检查与修正的系统提示词。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "grammar",
  },
  {
    id: "summarize",
    label: "生成摘要",
    description: "提取重点并生成结构化摘要。",
    kind: "simple",
    simpleBehavior: "basic",
    enabled: true,
    builtIn: true,
    order: 50,
    promptKey: "summarize",
    promptDescription: "用于生成摘要的系统提示词。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "summarize",
  },
  {
    id: "continue",
    label: "续写内容",
    description: "根据现有内容继续写作，可结合风格参数输出。",
    kind: "simple",
    simpleBehavior: "style",
    enabled: true,
    builtIn: true,
    order: 60,
    promptKey: "continue",
    promptDescription: "用于续写的系统提示词（支持风格变量）。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "continue",
  },
  {
    id: "generate",
    label: "生成内容",
    description: "根据要求生成完整内容，可结合风格参数输出。",
    kind: "simple",
    simpleBehavior: "style",
    enabled: true,
    builtIn: true,
    order: 70,
    promptKey: "generate",
    promptDescription: "用于“生成内容”的系统提示词（支持风格变量）。",
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    iconKey: "generate",
  },
] as const;

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeOrder(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return fallback;
}

function normalizeAssistantModuleKind(
  value: unknown,
  fallback: AssistantModuleKind
): AssistantModuleKind {
  return value === "workflow" || value === "simple" ? value : fallback;
}

function normalizeSimpleBehavior(
  value: unknown,
  fallback: AssistantSimpleBehavior = "basic"
): AssistantSimpleBehavior {
  return value === "translation" || value === "style" || value === "basic"
    ? value
    : fallback;
}

function normalizeIconKey(
  value: unknown,
  fallback: AssistantModuleIconKey = "custom"
): AssistantModuleIconKey {
  return ASSISTANT_MODULE_ICON_KEYS.includes(value as AssistantModuleIconKey)
    ? value as AssistantModuleIconKey
    : fallback;
}

function sortModules(modules: AssistantModuleDefinition[]): AssistantModuleDefinition[] {
  return [...modules].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.label.localeCompare(b.label, "zh-CN");
  });
}

function getFallbackPromptDescription(module: Pick<AssistantModuleDefinition, "kind" | "label" | "simpleBehavior">): string {
  if (module.kind === "workflow") {
    return `用于“${module.label}”模块的流程配置。`;
  }
  if (module.simpleBehavior === "translation") {
    return `用于“${module.label}”模块的翻译提示词。`;
  }
  if (module.simpleBehavior === "style") {
    return `用于“${module.label}”模块的风格模板提示词。`;
  }
  return `用于“${module.label}”模块的系统提示词。`;
}

export function getDefaultPromptTemplateForBehavior(
  behavior: AssistantSimpleBehavior
): string {
  switch (behavior) {
    case "translation":
      return `你是一个专业的翻译助手。
要求：
1. 如果用户输入里明确给出目标语言（例如“目标语言：法语”），严格按该目标语言翻译
2. 若用户未指定目标语言，执行智能切换：中文译为英语，英语译为简体中文，其他语言默认译为英语
3. 准确保留原文语义、语气和上下文，不要遗漏关键信息
4. 保留原文段落结构、换行和基本格式；专有名词、代码、URL、数字在必要时可保持原样
5. 直接输出翻译后的正文，不要添加任何解释、标签、引号或前缀`;
    case "style":
      return `你是一个专业的文本处理助手。
要求：
1. 按照{{style}}的风格处理用户输入
2. 保持语义清晰、结构完整，必要时可补充自然过渡
3. 直接输出最终结果，不要添加解释、标签、引号或前缀
4. 除非用户明确要求，否则不要输出 emoji、颜文字或多余说明`;
    case "basic":
    default:
      return `你是一个专业的文本处理助手。
要求：
1. 根据用户当前模块的目标处理输入文本
2. 保持结果准确、清晰、可直接使用
3. 直接输出最终结果，不要添加解释、标签、引号或前缀
4. 除非用户明确要求，否则不要输出 emoji、颜文字或多余说明`;
  }
}

function normalizeBuiltinModule(
  builtin: AssistantModuleDefinition,
  value?: Partial<AssistantModuleDefinition>
): AssistantModuleDefinition {
  return {
    ...builtin,
    label: normalizeString(value?.label, builtin.label),
    description: normalizeString(value?.description, builtin.description),
    enabled: normalizeBoolean(value?.enabled, builtin.enabled),
    order: normalizeOrder(value?.order, builtin.order),
    inputPlaceholder: normalizeString(value?.inputPlaceholder, builtin.inputPlaceholder || DEFAULT_INPUT_PLACEHOLDER),
  };
}

function normalizeCustomModule(
  value: Partial<AssistantModuleDefinition>,
  index: number
): AssistantModuleDefinition | null {
  const id = normalizeString(value.id);
  if (!id) return null;

  const label = normalizeString(value.label, `自定义模块 ${index + 1}`);
  const kind = normalizeAssistantModuleKind(value.kind, "simple");
  const simpleBehavior = kind === "simple"
    ? normalizeSimpleBehavior(value.simpleBehavior, "basic")
    : undefined;

  return {
    id,
    label,
    description: normalizeString(value.description, "自定义文本处理模块"),
    kind,
    simpleBehavior,
    enabled: normalizeBoolean(value.enabled, true),
    builtIn: false,
    order: normalizeOrder(value.order, (index + 1) * 10),
    inputPlaceholder: normalizeString(value.inputPlaceholder, DEFAULT_INPUT_PLACEHOLDER),
    promptKey: kind === "simple"
      ? normalizeString(value.promptKey, `assistant_module_${id}`)
      : undefined,
    defaultPrompt: kind === "simple"
      ? normalizeString(
          value.defaultPrompt,
          getDefaultPromptTemplateForBehavior(simpleBehavior || "basic")
        )
      : undefined,
    promptDescription: kind === "simple"
      ? normalizeString(value.promptDescription, getFallbackPromptDescription({ kind, label, simpleBehavior }))
      : undefined,
    iconKey: normalizeIconKey(value.iconKey, "custom"),
  };
}

function safeParseStore(raw: string | null): AssistantModuleStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AssistantModuleStore>;
    const storedModules = Array.isArray(parsed.modules) ? parsed.modules : [];
    const removedBuiltinIds = Array.isArray(parsed.removedBuiltinIds)
      ? parsed.removedBuiltinIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      : [];

    const builtinIds = new Set(BUILTIN_ASSISTANT_MODULES.map((module) => module.id));
    const builtinOverrides = new Map<string, Partial<AssistantModuleDefinition>>();
    const customModules: AssistantModuleDefinition[] = [];

    for (let index = 0; index < storedModules.length; index += 1) {
      const item = storedModules[index];
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<AssistantModuleDefinition>;
      const id = normalizeString(candidate.id);
      if (!id) continue;
      if (builtinIds.has(id)) {
        builtinOverrides.set(id, candidate);
        continue;
      }
      const normalizedCustom = normalizeCustomModule(candidate, customModules.length);
      if (normalizedCustom) {
        customModules.push(normalizedCustom);
      }
    }

    const modules: AssistantModuleDefinition[] = [];
    for (const builtin of BUILTIN_ASSISTANT_MODULES) {
      if (removedBuiltinIds.includes(builtin.id) && !builtinOverrides.has(builtin.id)) {
        continue;
      }
      modules.push(normalizeBuiltinModule(builtin, builtinOverrides.get(builtin.id)));
    }

    modules.push(...customModules);

    return {
      version: ASSISTANT_MODULES_VERSION,
      modules: sortModules(modules),
      removedBuiltinIds,
    };
  } catch {
    return null;
  }
}

function loadAssistantModuleStore(): AssistantModuleStore {
  try {
    const parsed = safeParseStore(localStorage.getItem(ASSISTANT_MODULES_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    // ignore
  }

  return {
    version: ASSISTANT_MODULES_VERSION,
    modules: sortModules(BUILTIN_ASSISTANT_MODULES.map((module) => ({ ...module }))),
    removedBuiltinIds: [],
  };
}

export function getAllAssistantModules(): AssistantModuleDefinition[] {
  return loadAssistantModuleStore().modules;
}

export function getEnabledAssistantModules(): AssistantModuleDefinition[] {
  return getAllAssistantModules().filter((module) => module.enabled);
}

export function getAssistantModuleById(
  id: string | null | undefined
): AssistantModuleDefinition | undefined {
  if (!id) return undefined;
  return getAllAssistantModules().find((module) => module.id === id);
}

export function getAssistantModuleLabel(id: string | null | undefined): string {
  return getAssistantModuleById(id)?.label || "";
}

export function getFirstEnabledAssistantModuleId(): string | null {
  return getEnabledAssistantModules()[0]?.id || null;
}

function getNextCustomModuleName(modules: AssistantModuleDefinition[]): string {
  const existing = new Set(modules.map((module) => module.label.trim()).filter(Boolean));
  if (!existing.has("自定义模块")) return "自定义模块";
  let index = 1;
  while (existing.has(`自定义模块 ${index}`)) {
    index += 1;
  }
  return `自定义模块 ${index}`;
}

function createModuleId(): string {
  return `module_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNextModuleOrder(modules: AssistantModuleDefinition[]): number {
  const maxOrder = modules.reduce((max, module) => Math.max(max, module.order), 0);
  return maxOrder + 10;
}

export function createCustomAssistantModule(
  modules: AssistantModuleDefinition[],
  behavior: AssistantSimpleBehavior = "basic"
): AssistantModuleDefinition {
  const id = createModuleId();
  const label = getNextCustomModuleName(modules);
  return {
    id,
    label,
    description: "自定义文本处理模块",
    kind: "simple",
    simpleBehavior: behavior,
    enabled: true,
    builtIn: false,
    order: getNextModuleOrder(modules),
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    promptKey: `assistant_module_${id}`,
    defaultPrompt: getDefaultPromptTemplateForBehavior(behavior),
    promptDescription: getFallbackPromptDescription({
      kind: "simple",
      label,
      simpleBehavior: behavior,
    }),
    iconKey: behavior === "translation"
      ? "translate"
      : behavior === "style"
        ? "generate"
        : "description",
  };
}

export async function saveAssistantModules(modules: AssistantModuleDefinition[]): Promise<void> {
  const builtinIds = new Set(BUILTIN_ASSISTANT_MODULES.map((module) => module.id));
  const sanitizedModules = sortModules(
    modules
      .map((module, index) => {
        if (builtinIds.has(module.id)) {
          const builtin = BUILTIN_ASSISTANT_MODULES.find((item) => item.id === module.id);
          return builtin ? normalizeBuiltinModule(builtin, module) : null;
        }
        return normalizeCustomModule(module, index);
      })
      .filter((module): module is AssistantModuleDefinition => Boolean(module))
  );

  const removedBuiltinIds = BUILTIN_ASSISTANT_MODULES
    .map((module) => module.id)
    .filter((builtinId) => !sanitizedModules.some((module) => module.id === builtinId));

  const payload: AssistantModuleStore = {
    version: ASSISTANT_MODULES_VERSION,
    modules: sanitizedModules,
    removedBuiltinIds,
  };

  localStorage.setItem(ASSISTANT_MODULES_STORAGE_KEY, JSON.stringify(payload));
}

export async function resetAssistantModules(): Promise<void> {
  localStorage.removeItem(ASSISTANT_MODULES_STORAGE_KEY);
}

export function getAssistantModulePromptDefinitions(
  modules?: AssistantModuleDefinition[]
): Array<{
  key: string;
  title: string;
  description: string;
  variables?: Array<{ name: string; description: string }>;
}> {
  const source = modules ?? getAllAssistantModules();
  return source
    .filter((module) => module.kind === "simple" && module.promptKey)
    .map((module) => ({
      key: module.promptKey as string,
      title: module.label,
      description: normalizeString(
        module.promptDescription,
        getFallbackPromptDescription(module)
      ),
      variables: module.simpleBehavior === "style"
        ? [{ name: "style", description: "风格描述（例如：正式、专业、创意）" }]
        : undefined,
    }));
}

export function getDefaultAssistantModuleInputPlaceholder(
  module: Pick<AssistantModuleDefinition, "kind" | "simpleBehavior">
): string {
  if (module.kind === "workflow") {
    return "描述你的需求，AI 会自动规划并写入文档...";
  }
  if (module.simpleBehavior === "translation") {
    return "输入要翻译的文本，或先在文档中选择内容...";
  }
  if (module.simpleBehavior === "style") {
    return "输入要生成或续写的文本，或先在文档中选择内容...";
  }
  return DEFAULT_INPUT_PLACEHOLDER;
}

export function getAssistantModuleModeLabel(module: Pick<AssistantModuleDefinition, "kind" | "simpleBehavior">): string {
  if (module.kind === "workflow") return "智能流程";
  if (module.simpleBehavior === "translation") return "翻译";
  if (module.simpleBehavior === "style") return "风格模板";
  return "文本处理";
}

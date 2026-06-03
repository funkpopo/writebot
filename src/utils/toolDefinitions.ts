import { ToolDefinition, type ToolCallRequest } from "../types/tools";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_selected_text",
    description: "获取当前选中的文本内容",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "selection",
    parallelSafe: true,
    parameters: [],
  },
  {
    name: "get_document_text",
    description: "获取整个文档的文本内容（仅限手动诊断或普通非 Agent 功能；Agent workflow 禁止调用）",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [],
  },
  {
    name: "get_paragraphs",
    description: "获取文档中的段落列表（仅限手动诊断或普通非 Agent 功能；Agent workflow 使用 get_document_index + read_document_ranges）",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [
      {
        name: "includeFormat",
        type: "boolean",
        description: "是否包含段落格式信息",
        required: false,
        default: false,
      },
    ],
  },
  {
    name: "get_paragraph_by_index",
    description: "获取指定索引的段落内容（仅限手动诊断或普通非 Agent 功能；Agent workflow 使用 read_document_ranges）",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "paragraph",
    parallelSafe: true,
    parameters: [
      {
        name: "index",
        type: "number",
        description: "段落索引（从 0 开始）",
        required: true,
      },
    ],
  },
  {
    name: "get_document_structure",
    description: "获取文档结构信息（标题、列表等；仅限手动诊断或普通非 Agent 功能；Agent workflow 使用 get_document_index）",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [],
  },
  {
    name: "get_headers_footers",
    description: "获取文档所有节的页眉页脚内容",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [],
  },
  {
    name: "search_document",
    description: "在文档中搜索指定内容",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [
      {
        name: "query",
        type: "string",
        description: "要搜索的文本",
        required: true,
      },
      {
        name: "matchCase",
        type: "boolean",
        description: "是否区分大小写",
        required: false,
        default: false,
      },
      {
        name: "matchWholeWord",
        type: "boolean",
        description: "是否全词匹配",
        required: false,
        default: false,
      },
    ],
  },
  {
    name: "get_document_index",
    description: "获取轻量文档索引（段落、标题、列表、表格、页眉页脚摘要；不返回全文正文）",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "document",
    parallelSafe: true,
    parameters: [],
  },
  {
    name: "read_document_ranges",
    description: "按段落范围、段落索引、标题路径或搜索结果 ID 精准读取局部正文，并返回可用于后续编辑校验的 anchor",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "paragraph",
    parallelSafe: true,
    parameters: [
      {
        name: "ranges",
        type: "array",
        description: "段落范围数组，例如 [{\"start\": 3, \"end\": 8}]；end 省略时只读单段",
        required: false,
      },
      {
        name: "paragraphIndices",
        type: "array",
        description: "要读取的段落索引数组",
        required: false,
      },
      {
        name: "headingPath",
        type: "array",
        description: "标题路径，例如 [\"第一章\", \"研究背景\"]；读取该标题到同级/上级下一标题前的内容",
        required: false,
      },
      {
        name: "searchResultIds",
        type: "array",
        description: "搜索命中 ID 数组，当前支持 p{段落索引} 或 p{段落索引}_{hash}",
        required: false,
      },
      {
        name: "maxParagraphs",
        type: "number",
        description: "最多返回的段落数，默认 80",
        required: false,
        default: 80,
      },
    ],
  },
  {
    name: "read_nearby_context",
    description: "围绕段落索引、anchor 或搜索命中读取前后 N 段上下文，并返回 anchor",
    category: "query",
    riskLevel: "read",
    requiresConfirmation: false,
    scope: "paragraph",
    parallelSafe: true,
    parameters: [
      {
        name: "paragraphIndex",
        type: "number",
        description: "中心段落索引",
        required: false,
      },
      {
        name: "anchor",
        type: "object",
        description: "读取工具返回的段落 anchor",
        required: false,
      },
      {
        name: "searchResultId",
        type: "string",
        description: "搜索命中 ID，例如 p12 或 p12_abcd1234",
        required: false,
      },
      {
        name: "before",
        type: "number",
        description: "向前读取的段落数，默认 3",
        required: false,
        default: 3,
      },
      {
        name: "after",
        type: "number",
        description: "向后读取的段落数，默认 3",
        required: false,
        default: 3,
      },
    ],
  },
  {
    name: "replace_selected_text",
    description: "替换当前选中的文本",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "selection",
    supportsUndo: true,
    agentAutoExecute: false,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "替换后的文本",
        required: true,
      },
      {
        name: "preserveFormat",
        type: "boolean",
        description: "是否保留原格式",
        required: false,
        default: true,
      },
    ],
  },
  {
    name: "insert_text",
    description: "在指定位置插入文本",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "cursor",
    supportsUndo: true,
    agentAutoExecute: false,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "要插入的文本",
        required: true,
      },
      {
        name: "location",
        type: "string",
        description: "插入位置：cursor（光标），start（文档开头），end（文档末尾）",
        required: false,
        enum: ["cursor", "start", "end"],
        default: "cursor",
      },
    ],
  },
  {
    name: "append_text",
    description: "在文档末尾追加文本",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "document",
    supportsUndo: true,
    agentAutoExecute: false,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "要追加的文本",
        required: true,
      },
    ],
  },
  {
    name: "insert_after_paragraph",
    description: "在指定段落后插入文本（可精确控制插入位置）",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "paragraph",
    supportsUndo: true,
    agentAutoExecute: false,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "要插入的文本",
        required: true,
      },
      {
        name: "paragraphIndex",
        type: "number",
        description: "段落索引（从 0 开始），内容将插入到该段落之后",
        required: true,
      },
    ],
  },
  {
    name: "propose_edit",
    description: "生成结构化编辑事务计划，不直接写入文档",
    category: "document",
    riskLevel: "suggest",
    requiresConfirmation: false,
    scope: "document",
    agentAutoExecute: true,
    parameters: [
      { name: "operationType", type: "string", description: "事务操作类型", required: true, enum: [
        "replace_paragraph_range",
        "insert_at_anchor",
        "delete_paragraph_range",
        "rewrite_paragraph",
      ] },
      { name: "content", type: "string", description: "将要写入的内容", required: false },
      { name: "contentFormat", type: "string", description: "内容格式", required: false, enum: [
        "plain_text", "markdown", "html", "table",
      ], default: "plain_text" },
      {
        name: "expectedBefore",
        type: "object",
        description: "目标校验信息",
        required: true,
        properties: [
          { name: "expectedTextHash", type: "string", description: "目标文本 hash", required: false },
          { name: "expectedTextExcerpt", type: "string", description: "目标文本摘要", required: false },
          { name: "paragraphIndex", type: "number", description: "目标段落索引", required: false },
          { name: "anchor", type: "object", description: "读取工具返回的目标 anchor", required: false },
          { name: "paragraphTextHash", type: "string", description: "目标段落文本 hash", required: false },
          { name: "beforeTextHash", type: "string", description: "写入前 hash", required: false },
          { name: "afterTextHash", type: "string", description: "写入后 hash", required: false },
          { name: "headingPath", type: "array", description: "标题路径", required: false },
          { name: "occurrence", type: "number", description: "命中次序", required: false },
        ],
      },
      { name: "startParagraphIndex", type: "number", description: "起始段落索引", required: false },
      { name: "endParagraphIndex", type: "number", description: "结束段落索引", required: false },
    ],
  },
  {
    name: "apply_edit_transaction",
    description: "提交已验证的编辑事务",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "document",
    supportsUndo: true,
    agentAutoExecute: true,
    parameters: [
      { name: "transactionId", type: "string", description: "propose_edit 返回的事务 ID", required: true },
    ],
  },
  {
    name: "replace_paragraph_range",
    description: "替换指定段落范围",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "paragraph",
    supportsUndo: true,
    agentAutoExecute: true,
    parameters: [
      { name: "startParagraphIndex", type: "number", description: "起始段落索引", required: true },
      { name: "endParagraphIndex", type: "number", description: "结束段落索引", required: true },
      { name: "text", type: "string", description: "替换后的内容", required: true },
      { name: "contentFormat", type: "string", description: "内容格式", required: true, enum: [
        "plain_text", "markdown", "html", "table",
      ] },
      {
        name: "expectedBefore",
        type: "object",
        description: "目标校验信息",
        required: true,
        properties: [
          { name: "paragraphIndex", type: "number", description: "目标段落索引", required: false },
          { name: "anchor", type: "object", description: "读取工具返回的目标 anchor", required: false },
          { name: "paragraphTextHash", type: "string", description: "目标段落文本 hash", required: false },
          { name: "expectedTextHash", type: "string", description: "目标文本 hash", required: false },
          { name: "expectedTextExcerpt", type: "string", description: "目标文本摘要", required: false },
          { name: "beforeTextHash", type: "string", description: "写入前 hash", required: false },
          { name: "afterTextHash", type: "string", description: "写入后 hash", required: false },
          { name: "headingPath", type: "array", description: "标题路径", required: false },
          { name: "occurrence", type: "number", description: "命中次序", required: false },
        ],
      },
    ],
  },
  {
    name: "insert_at_anchor",
    description: "基于锚点插入内容",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "paragraph",
    supportsUndo: true,
    agentAutoExecute: true,
    parameters: [
      { name: "text", type: "string", description: "插入内容", required: true },
      { name: "contentFormat", type: "string", description: "内容格式", required: true, enum: [
        "plain_text", "markdown", "html", "table",
      ] },
      {
        name: "expectedBefore",
        type: "object",
        description: "锚点校验信息",
        required: true,
        properties: [
          { name: "paragraphIndex", type: "number", description: "锚点段落索引", required: false },
          { name: "anchor", type: "object", description: "读取工具返回的段落 anchor", required: false },
          { name: "paragraphTextHash", type: "string", description: "锚点段落文本 hash", required: false },
          { name: "expectedTextExcerpt", type: "string", description: "锚点文本摘要", required: false },
          { name: "headingPath", type: "array", description: "标题路径", required: false },
          { name: "occurrence", type: "number", description: "命中次序", required: false },
        ],
      },
    ],
  },
  {
    name: "delete_paragraph_range",
    description: "删除指定段落范围",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "paragraph",
    supportsUndo: true,
    agentAutoExecute: true,
    parameters: [
      { name: "startParagraphIndex", type: "number", description: "起始段落索引", required: true },
      { name: "endParagraphIndex", type: "number", description: "结束段落索引", required: true },
      {
        name: "expectedBefore",
        type: "object",
        description: "目标校验信息",
        required: true,
        properties: [
          { name: "expectedTextHash", type: "string", description: "目标文本 hash", required: false },
          { name: "expectedTextExcerpt", type: "string", description: "目标文本摘要", required: false },
          { name: "paragraphIndex", type: "number", description: "目标段落索引", required: false },
          { name: "anchor", type: "object", description: "读取工具返回的目标 anchor", required: false },
          { name: "paragraphTextHash", type: "string", description: "目标段落文本 hash", required: false },
          { name: "headingPath", type: "array", description: "标题路径", required: false },
          { name: "occurrence", type: "number", description: "命中次序", required: false },
        ],
      },
    ],
  },
  {
    name: "rewrite_paragraph",
    description: "重写单个段落",
    category: "document",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "paragraph",
    supportsUndo: true,
    agentAutoExecute: true,
    parameters: [
      { name: "paragraphIndex", type: "number", description: "段落索引", required: true },
      { name: "text", type: "string", description: "新的段落内容", required: true },
      { name: "contentFormat", type: "string", description: "内容格式", required: true, enum: [
        "plain_text", "markdown", "html", "table",
      ] },
      {
        name: "expectedBefore",
        type: "object",
        description: "目标校验信息",
        required: true,
        properties: [
          { name: "paragraphIndex", type: "number", description: "目标段落索引", required: false },
          { name: "anchor", type: "object", description: "读取工具返回的目标 anchor", required: false },
          { name: "paragraphTextHash", type: "string", description: "目标段落文本 hash", required: false },
          { name: "expectedTextHash", type: "string", description: "目标文本 hash", required: false },
          { name: "expectedTextExcerpt", type: "string", description: "目标文本摘要", required: false },
          { name: "beforeTextHash", type: "string", description: "写入前 hash", required: false },
          { name: "afterTextHash", type: "string", description: "写入后 hash", required: false },
          { name: "headingPath", type: "array", description: "标题路径", required: false },
          { name: "occurrence", type: "number", description: "命中次序", required: false },
        ],
      },
    ],
  },
  {
    name: "select_paragraph",
    description: "选中指定索引的段落",
    category: "document",
    riskLevel: "suggest",
    requiresConfirmation: false,
    scope: "paragraph",
    mutatesSelection: true,
    parameters: [
      {
        name: "index",
        type: "number",
        description: "段落索引（从 0 开始）",
        required: true,
      },
    ],
  },
  {
    name: "add_comment",
    description: "给选中文本添加批注",
    category: "document",
    riskLevel: "suggest",
    requiresConfirmation: true,
    scope: "selection",
    supportsUndo: true,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "批注内容",
        required: true,
      },
    ],
  },
  {
    name: "apply_format_to_selection",
    description: "对当前选区应用格式",
    category: "format",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "format",
    supportsUndo: true,
    parameters: [
      {
        name: "bold",
        type: "boolean",
        description: "是否加粗",
        required: false,
      },
      {
        name: "italic",
        type: "boolean",
        description: "是否斜体",
        required: false,
      },
      {
        name: "fontSize",
        type: "number",
        description: "字体大小（磅）",
        required: false,
      },
      {
        name: "fontName",
        type: "string",
        description: "字体名称",
        required: false,
      },
      {
        name: "color",
        type: "string",
        description: "字体颜色（如 #FF0000 或 red）",
        required: false,
      },
    ],
  },
  {
    name: "highlight_paragraphs",
    description: "高亮指定段落",
    category: "format",
    riskLevel: "write",
    requiresConfirmation: true,
    scope: "format",
    supportsUndo: true,
    parameters: [
      {
        name: "indices",
        type: "array",
        description: "段落索引数组",
        required: true,
      },
      {
        name: "color",
        type: "string",
        description: "高亮颜色（默认黄色）",
        required: false,
      },
    ],
  },
  {
    name: "create_snapshot",
    description: "创建文档快照",
    category: "document",
    riskLevel: "suggest",
    requiresConfirmation: false,
    scope: "snapshot",
    parameters: [
      {
        name: "description",
        type: "string",
        description: "快照描述",
        required: false,
      },
    ],
  },
  {
    name: "restore_snapshot",
    description: "恢复文档到指定快照（需要确认）",
    category: "document",
    riskLevel: "destructive",
    requiresConfirmation: true,
    scope: "snapshot",
    parameters: [
      {
        name: "snapshotId",
        type: "string",
        description: "快照 ID",
        required: true,
      },
    ],
  },
];

export const DEFAULT_ENABLED_TOOLS = TOOL_DEFINITIONS.map((tool) => tool.name);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export function requiresToolConfirmation(name: string): boolean {
  return getToolDefinition(name)?.requiresConfirmation ?? true;
}

export function isAgentAutoExecutableTool(name: string): boolean {
  return getToolDefinition(name)?.agentAutoExecute ?? false;
}

/**
 * Query tools that are safe to run concurrently (read-only, no selection mutation).
 * Excludes e.g. select_paragraph / writes / restore_snapshot.
 */
const PARALLEL_SAFE_READ_TOOL_NAMES = new Set<string>([
  "get_selected_text",
  "get_headers_footers",
  "search_document",
  "get_document_index",
  "read_document_ranges",
  "read_nearby_context",
]);

/**
 * When the model returns several read-only tool calls in one round, the host may
 * execute them in parallel to reduce wall-clock time.
 */
export function canParallelizeReadToolBatch(calls: ToolCallRequest[]): boolean {
  if (calls.length < 2) return false;
  return calls.every((c) => {
    const tool = getToolDefinition(c.name);
    return Boolean(
      tool
      && tool.riskLevel === "read"
      && tool.parallelSafe
      && PARALLEL_SAFE_READ_TOOL_NAMES.has(c.name)
    );
  });
}

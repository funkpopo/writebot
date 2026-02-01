import { ToolDefinition } from "../types/tools";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_selected_text",
    description: "获取当前选中的文本内容",
    category: "query",
    parameters: [],
  },
  {
    name: "get_document_text",
    description: "获取整个文档的文本内容",
    category: "query",
    parameters: [],
  },
  {
    name: "get_paragraphs",
    description: "获取文档中的段落列表",
    category: "query",
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
    description: "获取指定索引的段落内容",
    category: "query",
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
    description: "获取文档结构信息（标题、列表等）",
    category: "query",
    parameters: [],
  },
  {
    name: "get_headers_footers",
    description: "获取文档所有节的页眉页脚内容",
    category: "query",
    parameters: [],
  },
  {
    name: "search_document",
    description: "在文档中搜索指定内容",
    category: "query",
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
    name: "replace_selected_text",
    description: "替换当前选中的文本",
    category: "document",
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
    name: "select_paragraph",
    description: "选中指定索引的段落",
    category: "document",
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

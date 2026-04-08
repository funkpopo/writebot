import {
  getSelectedText,
  getDocumentText,
  getParagraphs,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  selectParagraphByIndex,
  addComment,
  highlightParagraphs,
  getDocumentOoxml,
  restoreDocumentOoxml,
  applyFormatToSelection,
  searchDocument,
  getParagraphByIndex,
  DocumentSnapshot,
} from "./wordApi";
import { ToolCallRequest, ToolCallResult, ToolDefinition } from "../types/tools";
import { getToolDefinition } from "./toolDefinitions";
import { sanitizeMarkdownToPlainText } from "./textSanitizer";
import { applyAiContentToWord, insertAiContentToWord, insertAiContentAfterParagraph } from "./wordContentApplier";

const SNAPSHOT_PREFIX = "snap";
const AUTO_APPLIED_TOOL_NAMES = new Set([
  "insert_text",
  "append_text",
  "insert_after_paragraph",
  "replace_selected_text",
]);
const MIN_REPLAY_VALIDATION_TEXT_LENGTH = 24;

export interface ToolWriteReplayDescriptor {
  replayKey: string;
  idempotencyKey: string;
  toolName: string;
  toolCallId: string;
  argsDigest: string;
  locationHint: string;
  normalizedText: string;
  textHash: string;
}

export interface ToolWriteReplayValidationResult {
  status: "matched" | "missing" | "unsupported";
  message: string;
}

function nowSnapshotId(): string {
  return `${SNAPSHOT_PREFIX}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeReplayText(value: string): string {
  return sanitizeMarkdownToPlainText(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReplayCallId(value: string): string {
  return value.trim().toLowerCase().replace(/_[0-9a-z]{6,}$/i, "");
}

function getWriteLocationHint(toolCall: ToolCallRequest): string {
  const args = toolCall.arguments || {};
  if (toolCall.name === "append_text") {
    return "end";
  }
  if (toolCall.name === "insert_text") {
    const location = toString(args.location);
    return location === "start" || location === "end" ? location : "cursor";
  }
  if (toolCall.name === "insert_after_paragraph") {
    const paragraphIndex = toNumber(args.paragraphIndex);
    return paragraphIndex === null ? "paragraph:unknown" : `paragraph:${paragraphIndex}`;
  }
  if (toolCall.name === "replace_selected_text") {
    return "selection";
  }
  return "unknown";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "是"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "否"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function toString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}

function parseIndices(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toNumber(item))
      .filter((item): item is number => item !== null);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，\s]+/)
      .map((item) => toNumber(item))
      .filter((item): item is number => item !== null);
  }
  const single = toNumber(value);
  return single !== null ? [single] : [];
}

export class ToolExecutor {
  private snapshots: Map<string, DocumentSnapshot> = new Map();

  isAutoAppliedTool(toolName: string): boolean {
    return AUTO_APPLIED_TOOL_NAMES.has(toolName);
  }

  buildWriteReplayDescriptor(toolCall: ToolCallRequest): ToolWriteReplayDescriptor | null {
    if (!this.isAutoAppliedTool(toolCall.name)) return null;
    const rawText = toString(toolCall.arguments?.text);
    const normalizedText = rawText ? normalizeReplayText(rawText) : "";
    if (!normalizedText) return null;

    const locationHint = getWriteLocationHint(toolCall);
    const argsDigest = stableHash(stableSerialize({
      name: toolCall.name,
      locationHint,
      arguments: toolCall.arguments || {},
    }));

    return {
      replayKey: `${toolCall.name}:${normalizeReplayCallId(toolCall.id)}:${locationHint}`,
      idempotencyKey: stableHash(stableSerialize({
        name: toolCall.name,
        locationHint,
        normalizedText,
      })),
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      argsDigest,
      locationHint,
      normalizedText,
      textHash: stableHash(normalizedText),
    };
  }

  async validateNormalizedWriteReplay(normalizedText: string): Promise<ToolWriteReplayValidationResult> {
    if (!normalizedText || normalizedText.length < MIN_REPLAY_VALIDATION_TEXT_LENGTH) {
      return {
        status: "unsupported",
        message: "待校验文本过短，跳过自动重放校验",
      };
    }

    const documentText = normalizeReplayText(await getDocumentText());
    if (!documentText) {
      return {
        status: "missing",
        message: "当前文档为空，未匹配到历史写入",
      };
    }

    return documentText.includes(normalizedText)
      ? {
        status: "matched",
        message: "文档中已匹配到相同写入内容",
      }
      : {
        status: "missing",
        message: "文档中未匹配到历史写入内容",
      };
  }

  async execute(toolCall: ToolCallRequest): Promise<ToolCallResult> {
    const tool = getToolDefinition(toolCall.name);
    if (!tool) {
      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        error: `未注册的工具: ${toolCall.name}`,
      };
    }

    const args = this.applyDefaults(tool, toolCall.arguments ?? {});
    const validationError = this.validateParameters(tool, args);
    if (validationError) {
      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        error: validationError,
      };
    }

    try {
      switch (toolCall.name) {
        case "get_selected_text": {
          const result = await getSelectedText();
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "get_document_text": {
          const result = await getDocumentText();
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "get_paragraphs": {
          const includeFormat = toBoolean(args.includeFormat) ?? false;
          const result = includeFormat ? await getAllParagraphsInfo() : await getParagraphs();
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "get_paragraph_by_index": {
          const index = toNumber(args.index);
          if (index === null) {
            throw new Error("参数 index 需要是数字");
          }
          const result = await getParagraphByIndex(index);
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "get_document_structure": {
          const paragraphs = await getAllParagraphsInfo();
          const headings = paragraphs
            .filter((para) => para.outlineLevel !== undefined && para.text.trim())
            .map((para) => ({
              index: para.index,
              level: para.outlineLevel,
              text: para.text,
            }));
          const listItemCount = paragraphs.filter((para) => para.isListItem).length;
          const structure = {
            paragraphCount: paragraphs.length,
            headingCount: headings.length,
            listItemCount,
            headings,
          };
          return { id: toolCall.id, name: toolCall.name, success: true, result: structure };
        }
        case "get_headers_footers": {
          const result = await getSectionHeadersFooters();
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "search_document": {
          const query = toString(args.query)?.trim();
          if (!query) {
            throw new Error("参数 query 不能为空");
          }
          const matchCase = toBoolean(args.matchCase) ?? false;
          const matchWholeWord = toBoolean(args.matchWholeWord) ?? false;
          const result = await searchDocument(query, { matchCase, matchWholeWord });
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "replace_selected_text": {
          const rawText = toString(args.text) ?? "";
          const preserveFormat = toBoolean(args.preserveFormat) ?? true;
          await applyAiContentToWord(rawText, {
            preserveSelectionFormat: preserveFormat,
            renderMarkdownWhenPreserveFormat: true,
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "insert_text": {
          const rawText = toString(args.text) ?? "";
          const location = toString(args.location);
          const normalizedLocation =
            location === "start" || location === "end" ? location : "cursor";
          await insertAiContentToWord(rawText, { location: normalizedLocation });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "append_text": {
          const rawText = toString(args.text) ?? "";
          await insertAiContentToWord(rawText, { location: "end" });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "insert_after_paragraph": {
          const rawText = toString(args.text) ?? "";
          const paragraphIndex = toNumber(args.paragraphIndex);
          if (paragraphIndex === null) {
            throw new Error("参数 paragraphIndex 需要是数字");
          }
          await insertAiContentAfterParagraph(rawText, paragraphIndex);
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "select_paragraph": {
          const index = toNumber(args.index);
          if (index === null) {
            throw new Error("参数 index 需要是数字");
          }
          await selectParagraphByIndex(index);
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "add_comment": {
          const text = sanitizeMarkdownToPlainText(toString(args.text) ?? "");
          await addComment(text);
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "apply_format_to_selection": {
          await applyFormatToSelection({
            bold: toBoolean(args.bold) ?? undefined,
            italic: toBoolean(args.italic) ?? undefined,
            fontSize: toNumber(args.fontSize) ?? undefined,
            fontName: toString(args.fontName) ?? undefined,
            color: toString(args.color) ?? undefined,
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "highlight_paragraphs": {
          const indices = parseIndices(args.indices);
          if (indices.length === 0) {
            throw new Error("参数 indices 不能为空");
          }
          const color = toString(args.color) ?? undefined;
          await highlightParagraphs(indices, color || "#FFFF00");
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "create_snapshot": {
          const description = toString(args.description) ?? undefined;
          const snapshot = await getDocumentOoxml();
          if (description) {
            snapshot.description = description;
          }
          const snapshotId = nowSnapshotId();
          this.snapshots.set(snapshotId, snapshot);
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: { snapshotId, createdAt: snapshot.createdAt, description },
          };
        }
        case "restore_snapshot": {
          const snapshotId = toString(args.snapshotId);
          if (!snapshotId) {
            throw new Error("参数 snapshotId 不能为空");
          }
          const snapshot = this.snapshots.get(snapshotId);
          if (!snapshot) {
            throw new Error("未找到指定快照");
          }
          await restoreDocumentOoxml(snapshot);
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        default:
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: false,
            error: `未实现的工具: ${toolCall.name}`,
          };
      }
    } catch (error) {
      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        error: error instanceof Error ? error.message : "工具执行失败",
      };
    }
  }

  private applyDefaults(tool: ToolDefinition, args: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...args };
    for (const param of tool.parameters) {
      if (merged[param.name] === undefined && param.default !== undefined) {
        merged[param.name] = param.default;
      }
    }
    return merged;
  }

  private validateParameters(tool: ToolDefinition, args: Record<string, unknown>): string | null {
    const errors: string[] = [];
    for (const param of tool.parameters) {
      const value = args[param.name];
      if (param.required && (value === undefined || value === null || value === "")) {
        errors.push(`缺少必要参数: ${param.name}`);
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
        errors.push(`参数 ${param.name} 必须是 ${param.enum.join("/")}`);
        continue;
      }

      switch (param.type) {
        case "string":
          if (typeof value !== "string") {
            errors.push(`参数 ${param.name} 应为字符串`);
          }
          break;
        case "number":
          if (toNumber(value) === null) {
            errors.push(`参数 ${param.name} 应为数字`);
          }
          break;
        case "boolean":
          if (toBoolean(value) === null) {
            errors.push(`参数 ${param.name} 应为布尔值`);
          }
          break;
        case "array":
          if (!Array.isArray(value)) {
            errors.push(`参数 ${param.name} 应为数组`);
          }
          break;
        case "object":
          if (typeof value !== "object" || Array.isArray(value)) {
            errors.push(`参数 ${param.name} 应为对象`);
          }
          break;
      }
    }

    return errors.length > 0 ? errors.join("; ") : null;
  }
}

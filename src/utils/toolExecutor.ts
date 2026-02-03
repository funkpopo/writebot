import {
  getSelectedText,
  getDocumentText,
  getParagraphs,
  getAllParagraphsInfo,
  getSectionHeadersFooters,
  getSelectedTextWithFormat,
  replaceSelectedTextWithFormat,
  replaceSelectedText,
  insertText,
  appendText,
  selectParagraphByIndex,
  addComment,
  highlightParagraphs,
  getDocumentOoxml,
  restoreDocumentOoxml,
  applyFormatToSelection,
  searchDocument,
  getParagraphByIndex,
  insertTextAtLocation,
  insertTable,
  insertTableAtLocation,
  DocumentSnapshot,
} from "./wordApi";
import { ToolCallRequest, ToolCallResult, ToolDefinition } from "../types/tools";
import { getToolDefinition } from "./toolDefinitions";
import { parseMarkdownWithTables, sanitizeMarkdownToPlainText } from "./textSanitizer";
import type { ParsedContent } from "./textSanitizer";

const SNAPSHOT_PREFIX = "snap";

function nowSnapshotId(): string {
  return `${SNAPSHOT_PREFIX}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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

async function insertParsedSegmentsAtCursor(segments: ParsedContent["segments"]): Promise<void> {
  for (const segment of segments) {
    if (segment.type === "text") {
      const safeText = sanitizeMarkdownToPlainText(segment.content);
      if (safeText.trim()) {
        await insertText(safeText + "\n");
      }
      continue;
    }

    await insertTable({ headers: segment.data.headers, rows: segment.data.rows });
    await insertText("\n");
  }
}

async function insertParsedSegmentsAtBodyLocation(
  segments: ParsedContent["segments"],
  location: "start" | "end"
): Promise<void> {
  const ordered = location === "start" ? [...segments].reverse() : segments;

  for (const segment of ordered) {
    if (segment.type === "text") {
      const safeText = sanitizeMarkdownToPlainText(segment.content);
      if (safeText.trim()) {
        await insertTextAtLocation(safeText + "\n", location);
      }
      continue;
    }

    // When inserting at the beginning, inserting "start" repeatedly reverses order.
    // We already reversed segments; now ensure the trailing newline ends up AFTER the table.
    if (location === "start") {
      await insertTextAtLocation("\n", "start");
      await insertTableAtLocation({ headers: segment.data.headers, rows: segment.data.rows }, "start");
      continue;
    }

    await insertTableAtLocation({ headers: segment.data.headers, rows: segment.data.rows }, "end");
    await insertTextAtLocation("\n", "end");
  }
}

export class ToolExecutor {
  private snapshots: Map<string, DocumentSnapshot> = new Map();

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
          const parsed = parseMarkdownWithTables(rawText);
          const preserveFormat = toBoolean(args.preserveFormat) ?? true;
          if (parsed.hasTable) {
            // Mixed content (text + table) cannot reliably preserve the original selection format.
            // Clear selection and insert content at cursor position.
            await replaceSelectedText("");
            await insertParsedSegmentsAtCursor(parsed.segments);
          } else {
            const text = sanitizeMarkdownToPlainText(rawText);
            if (preserveFormat) {
              const { format } = await getSelectedTextWithFormat();
              await replaceSelectedTextWithFormat(text, format);
            } else {
              await replaceSelectedText(text);
            }
          }
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "insert_text": {
          const rawText = toString(args.text) ?? "";
          const parsed = parseMarkdownWithTables(rawText);
          const location = toString(args.location) || "cursor";
          if (location === "start" || location === "end") {
            if (parsed.hasTable) {
              await insertParsedSegmentsAtBodyLocation(parsed.segments, location);
            } else {
              const text = sanitizeMarkdownToPlainText(rawText);
              await insertTextAtLocation(text, location);
            }
          } else {
            if (parsed.hasTable) {
              await insertParsedSegmentsAtCursor(parsed.segments);
            } else {
              const text = sanitizeMarkdownToPlainText(rawText);
              await insertText(text);
            }
          }
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "append_text": {
          const rawText = toString(args.text) ?? "";
          const parsed = parseMarkdownWithTables(rawText);
          if (parsed.hasTable) {
            await insertParsedSegmentsAtBodyLocation(parsed.segments, "end");
          } else {
            const text = sanitizeMarkdownToPlainText(rawText);
            await appendText(text);
          }
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

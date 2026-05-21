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
  getDocumentIndex,
  readDocumentRanges,
  readNearbyContext,
  DocumentSnapshot,
} from "./wordApi";
import { ToolCallRequest, ToolCallResult, ToolDefinition } from "../types/tools";
import { getToolDefinition } from "./toolDefinitions";
import { sanitizeMarkdownToPlainText } from "./textSanitizer";
import { applyAiContentToWord, insertAiContentToWord, insertAiContentAfterParagraph } from "./wordContentApplier";
import { editTransactionService } from "./editTransactionService";
import type { ExplicitContentFormat } from "./documentText";
import type { EditTransaction, EditTransactionPlanInput } from "./editTransactionTypes";

const SNAPSHOT_PREFIX = "snap";
const AUTO_APPLIED_TOOL_NAMES = new Set([
  "insert_text",
  "append_text",
  "insert_after_paragraph",
  "replace_selected_text",
  "replace_paragraph_range",
  "insert_at_anchor",
  "delete_paragraph_range",
  "rewrite_paragraph",
  "apply_edit_transaction",
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
  private plannedTransactions: Map<string, EditTransaction> = new Map();

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
          const [matches, documentIndex] = await Promise.all([
            searchDocument(query, { matchCase, matchWholeWord }),
            getDocumentIndex(),
          ]);
          const indexByParagraph = new Map(documentIndex.paragraphs.map((item) => [item.index, item]));
          const result = matches.map((match) => {
            const indexed = indexByParagraph.get(match.index);
            return {
              ...match,
              id: indexed?.anchor.anchorId || `p${match.index}`,
              anchor: indexed?.anchor,
            };
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "get_document_index": {
          const result = await getDocumentIndex();
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "read_document_ranges": {
          const ranges = Array.isArray(args.ranges)
            ? args.ranges.map((item) => {
              const record = (item || {}) as Record<string, unknown>;
              return {
                start: toNumber(record.start) ?? 0,
                end: toNumber(record.end) ?? undefined,
              };
            })
            : undefined;
          const paragraphIndices = parseIndices(args.paragraphIndices);
          const headingPath = Array.isArray(args.headingPath)
            ? args.headingPath.map((item) => String(item))
            : undefined;
          const searchResultIds = Array.isArray(args.searchResultIds)
            ? args.searchResultIds.map((item) => String(item))
            : undefined;
          const result = await readDocumentRanges({
            ranges,
            paragraphIndices,
            headingPath,
            searchResultIds,
            maxParagraphs: toNumber(args.maxParagraphs) ?? undefined,
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "read_nearby_context": {
          const result = await readNearbyContext({
            paragraphIndex: toNumber(args.paragraphIndex) ?? undefined,
            anchor: args.anchor && typeof args.anchor === "object"
              ? args.anchor as Parameters<typeof readNearbyContext>[0]["anchor"]
              : undefined,
            searchResultId: toString(args.searchResultId) ?? undefined,
            before: toNumber(args.before) ?? undefined,
            after: toNumber(args.after) ?? undefined,
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result };
        }
        case "replace_selected_text": {
          const rawText = toString(args.text) ?? "";
          const preserveFormat = toBoolean(args.preserveFormat) ?? true;
          await applyAiContentToWord(rawText, {
            preserveSelectionFormat: preserveFormat,
            renderMarkdownWhenPreserveFormat: true,
            contentFormat: "plain_text",
          });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "insert_text": {
          const rawText = toString(args.text) ?? "";
          const location = toString(args.location);
          const normalizedLocation =
            location === "start" || location === "end" ? location : "cursor";
          await insertAiContentToWord(rawText, { location: normalizedLocation, contentFormat: "plain_text" });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "append_text": {
          const rawText = toString(args.text) ?? "";
          await insertAiContentToWord(rawText, { location: "end", contentFormat: "plain_text" });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "insert_after_paragraph": {
          const rawText = toString(args.text) ?? "";
          const paragraphIndex = toNumber(args.paragraphIndex);
          if (paragraphIndex === null) {
            throw new Error("参数 paragraphIndex 需要是数字");
          }
          await insertAiContentAfterParagraph(rawText, paragraphIndex, { contentFormat: "plain_text" });
          return { id: toolCall.id, name: toolCall.name, success: true, result: "ok" };
        }
        case "propose_edit": {
          const planned = this.buildPlannedTransactionFromToolArgs(toolCall.id, args);
          const previewed = await editTransactionService.previewDiff(planned);
          this.plannedTransactions.set(previewed.id, previewed);
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: {
              transactionId: previewed.id,
              preview: previewed.preview,
              status: previewed.status,
            },
          };
        }
        case "apply_edit_transaction": {
          const transactionId = toString(args.transactionId)?.trim();
          if (!transactionId) {
            throw new Error("参数 transactionId 不能为空");
          }
          const planned = this.plannedTransactions.get(transactionId) || await editTransactionService.loadTransaction(transactionId);
          if (!planned) {
            throw new Error("未找到指定 transactionId 对应的事务");
          }
          const validated = await editTransactionService.validateTarget(planned);
          const captured = await editTransactionService.captureBefore(validated);
          const committed = await editTransactionService.commitEdit(captured);
          const verified = await editTransactionService.verifyAfter(committed);
          this.plannedTransactions.set(transactionId, verified);
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: {
              transactionId,
              status: verified.status,
              operationType: verified.operation.type,
            },
          };
        }
        case "replace_paragraph_range":
        case "insert_at_anchor":
        case "delete_paragraph_range":
        case "rewrite_paragraph": {
          const planned = this.buildWriteTransactionFromStructuredTool(toolCall);
          const previewed = await editTransactionService.previewDiff(planned);
          const validated = await editTransactionService.validateTarget(previewed);
          const captured = await editTransactionService.captureBefore(validated);
          const committed = await editTransactionService.commitEdit(captured);
          const verified = await editTransactionService.verifyAfter(committed);
          this.plannedTransactions.set(verified.id, verified);
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: {
              transactionId: verified.id,
              status: verified.status,
              operationType: verified.operation.type,
            },
          };
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
          const planned = editTransactionService.planEdit({
            source: "agent_tool",
            operationGroupId: toolCall.id,
            operation: {
              type: "apply_format",
              content: "apply_format_to_selection",
              contentFormat: "plain_text",
            },
            scope: { kind: "selection" },
          });
          const validated = await editTransactionService.validateTarget(planned);
          const captured = await editTransactionService.captureBefore(validated);
          await applyFormatToSelection({
            bold: toBoolean(args.bold) ?? undefined,
            italic: toBoolean(args.italic) ?? undefined,
            fontSize: toNumber(args.fontSize) ?? undefined,
            fontName: toString(args.fontName) ?? undefined,
            color: toString(args.color) ?? undefined,
          });
          const finalized = await editTransactionService.finalizeExternalEdit(captured, {
            allowContentChange: false,
          });
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: { transactionId: finalized.id, status: finalized.status },
          };
        }
        case "highlight_paragraphs": {
          const indices = parseIndices(args.indices);
          if (indices.length === 0) {
            throw new Error("参数 indices 不能为空");
          }
          const sortedIndices = [...indices].sort((left, right) => left - right);
          const planned = editTransactionService.planEdit({
            source: "agent_tool",
            operationGroupId: toolCall.id,
            operation: {
              type: "apply_format",
              content: "highlight_paragraphs",
              contentFormat: "plain_text",
            },
            scope: {
              kind: "paragraph_range",
              startParagraphIndex: sortedIndices[0],
              endParagraphIndex: sortedIndices[sortedIndices.length - 1],
            },
          });
          const validated = await editTransactionService.validateTarget(planned);
          const captured = await editTransactionService.captureBefore(validated);
          const color = toString(args.color) ?? undefined;
          await highlightParagraphs(indices, color || "#FFFF00");
          const finalized = await editTransactionService.finalizeExternalEdit(captured, {
            allowContentChange: false,
            affectedParagraphRange: {
              startIndex: sortedIndices[0],
              endIndex: sortedIndices[sortedIndices.length - 1],
            },
          });
          return {
            id: toolCall.id,
            name: toolCall.name,
            success: true,
            result: { transactionId: finalized.id, status: finalized.status },
          };
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

  private validateParameterValue(param: ToolDefinition["parameters"][number], value: unknown, path: string): string[] {
    const errors: string[] = [];
    if (param.required && (value === undefined || value === null || value === "")) {
      errors.push(`缺少必要参数: ${path}`);
      return errors;
    }

    if (value === undefined || value === null) {
      return errors;
    }

    if (param.enum && typeof value === "string" && !param.enum.includes(value)) {
      errors.push(`参数 ${path} 必须是 ${param.enum.join("/")}`);
      return errors;
    }

    switch (param.type) {
      case "string":
        if (typeof value !== "string") {
          errors.push(`参数 ${path} 应为字符串`);
        }
        break;
      case "number":
        if (toNumber(value) === null) {
          errors.push(`参数 ${path} 应为数字`);
        }
        break;
      case "boolean":
        if (toBoolean(value) === null) {
          errors.push(`参数 ${path} 应为布尔值`);
        }
        break;
      case "array":
        if (!Array.isArray(value)) {
          errors.push(`参数 ${path} 应为数组`);
        }
        break;
      case "object":
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          errors.push(`参数 ${path} 应为对象`);
        } else if (param.properties?.length) {
          const record = value as Record<string, unknown>;
          for (const property of param.properties) {
            errors.push(...this.validateParameterValue(property, record[property.name], `${path}.${property.name}`));
          }
        }
        break;
    }

    return errors;
  }

  private validateParameters(tool: ToolDefinition, args: Record<string, unknown>): string | null {
    const errors: string[] = [];
    for (const param of tool.parameters) {
      errors.push(...this.validateParameterValue(param, args[param.name], param.name));
    }

    return errors.length > 0 ? errors.join("; ") : null;
  }

  private buildPlannedTransactionFromToolArgs(toolCallId: string, args: Record<string, unknown>): EditTransaction {
    const operationType = toString(args.operationType);
    if (!operationType) {
      throw new Error("参数 operationType 不能为空");
    }
    const contentFormat = (toString(args.contentFormat) || "plain_text") as ExplicitContentFormat;
    const expectedBefore = (args.expectedBefore || {}) as Record<string, unknown>;
    const startParagraphIndex = toNumber(args.startParagraphIndex);
    const endParagraphIndex = toNumber(args.endParagraphIndex);
    const scope =
      operationType === "insert_at_anchor"
        ? { kind: "paragraph_anchor" as const, anchorParagraphIndex: toNumber(expectedBefore.paragraphIndex) ?? undefined }
        : {
          kind: "paragraph_range" as const,
          startParagraphIndex: startParagraphIndex ?? toNumber(expectedBefore.paragraphIndex) ?? 0,
          endParagraphIndex: endParagraphIndex ?? startParagraphIndex ?? toNumber(expectedBefore.paragraphIndex) ?? 0,
        };
    const planInput: EditTransactionPlanInput = {
      source: "agent_tool",
      operationGroupId: toolCallId,
      operation: {
        type: operationType as EditTransaction["operation"]["type"],
        content: toString(args.content) ?? undefined,
        contentFormat,
      },
      scope,
      expectedBefore: this.toEditTargetExpectation(expectedBefore),
    };
    return editTransactionService.planEdit(planInput);
  }

  private buildWriteTransactionFromStructuredTool(toolCall: ToolCallRequest): EditTransaction {
    const args = toolCall.arguments || {};
    const expectedBefore = this.toEditTargetExpectation((args.expectedBefore || {}) as Record<string, unknown>);
    const contentFormat = (toString(args.contentFormat) || "plain_text") as ExplicitContentFormat;

    switch (toolCall.name) {
      case "replace_paragraph_range":
        return editTransactionService.planEdit({
          source: "agent_tool",
          operationGroupId: toolCall.id,
          operation: {
            type: "replace_paragraph_range",
            content: toString(args.text) ?? "",
            contentFormat,
          },
          scope: {
            kind: "paragraph_range",
            startParagraphIndex: toNumber(args.startParagraphIndex) ?? 0,
            endParagraphIndex: toNumber(args.endParagraphIndex) ?? 0,
          },
          expectedBefore,
        });
      case "insert_at_anchor":
        return editTransactionService.planEdit({
          source: "agent_tool",
          operationGroupId: toolCall.id,
          operation: {
            type: "insert_at_anchor",
            content: toString(args.text) ?? "",
            contentFormat,
          },
          scope: {
            kind: "paragraph_anchor",
            anchorParagraphIndex: typeof expectedBefore.paragraphIndex === "number" ? expectedBefore.paragraphIndex : undefined,
          },
          expectedBefore,
        });
      case "delete_paragraph_range":
        return editTransactionService.planEdit({
          source: "agent_tool",
          operationGroupId: toolCall.id,
          operation: { type: "delete_paragraph_range" },
          scope: {
            kind: "paragraph_range",
            startParagraphIndex: toNumber(args.startParagraphIndex) ?? 0,
            endParagraphIndex: toNumber(args.endParagraphIndex) ?? 0,
          },
          expectedBefore,
        });
      case "rewrite_paragraph": {
        const paragraphIndex = toNumber(args.paragraphIndex) ?? 0;
        return editTransactionService.planEdit({
          source: "agent_tool",
          operationGroupId: toolCall.id,
          operation: {
            type: "rewrite_paragraph",
            content: toString(args.text) ?? "",
            contentFormat,
          },
          scope: {
            kind: "paragraph_range",
            startParagraphIndex: paragraphIndex,
            endParagraphIndex: paragraphIndex,
          },
          expectedBefore,
        });
      }
      default:
        throw new Error(`不支持的结构化编辑工具: ${toolCall.name}`);
    }
  }

  private toEditTargetExpectation(value: Record<string, unknown>) {
    const anchor = value.anchor && typeof value.anchor === "object" && !Array.isArray(value.anchor)
      ? value.anchor as Record<string, unknown>
      : undefined;
    return {
      anchor: anchor
        ? {
          anchorId: toString(anchor.anchorId) ?? undefined,
          paragraphIndex: toNumber(anchor.paragraphIndex) ?? undefined,
          paragraphTextHash: toString(anchor.paragraphTextHash) ?? undefined,
          normalizedExcerpt: toString(anchor.normalizedExcerpt) ?? undefined,
          headingPath: Array.isArray(anchor.headingPath)
            ? anchor.headingPath.map((item) => String(item))
            : undefined,
          occurrence: toNumber(anchor.occurrence) ?? undefined,
          beforeNeighborHash: toString(anchor.beforeNeighborHash) ?? undefined,
          afterNeighborHash: toString(anchor.afterNeighborHash) ?? undefined,
        }
        : undefined,
      expectedTextHash: toString(value.expectedTextHash) ?? undefined,
      expectedTextExcerpt: toString(value.expectedTextExcerpt) ?? undefined,
      paragraphIndex: toNumber(value.paragraphIndex) ?? toNumber(anchor?.paragraphIndex) ?? undefined,
      paragraphTextHash: toString(value.paragraphTextHash) ?? toString(anchor?.paragraphTextHash) ?? undefined,
      beforeTextHash: toString(value.beforeTextHash) ?? undefined,
      afterTextHash: toString(value.afterTextHash) ?? undefined,
      headingPath: Array.isArray(value.headingPath)
        ? value.headingPath.map((item) => String(item))
        : Array.isArray(anchor?.headingPath)
          ? anchor.headingPath.map((item) => String(item))
        : undefined,
      occurrence: toNumber(value.occurrence) ?? toNumber(anchor?.occurrence) ?? undefined,
    };
  }
}

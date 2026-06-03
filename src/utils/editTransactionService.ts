/* global Word */

import {
  captureBodyUndoSnapshotIfSizeAllows,
  captureScopedUndoSnapshotFromParagraphIndices,
  captureScopedUndoSnapshotFromRanges,
  finalizeUndoSnapshot,
  getParagraphByIndex,
  getParagraphCountInDocument,
  getParagraphsInfoByIndices,
  getParagraphIndicesInSelection,
  getSelectedText,
  restoreUndoSnapshot,
} from "./wordApi";
import {
  buildExcerpt,
  normalizeDocumentText,
  resolveExpectedPlainText,
  stableTextHash,
  type ExplicitContentFormat,
} from "./documentText";
import {
  loadEditTransactionRecord,
  loadEditTransactionsByOperationGroup,
  saveEditTransactionRecord,
  type StoredEditTransactionRecord,
} from "./storageService";
import {
  applyAiContentToWord,
  insertAiContentAfterParagraph,
  insertAiContentToWord,
} from "./wordContentApplier";
import type {
  EditTargetExpectation,
  EditTargetState,
  EditTransaction,
  EditTransactionDiffPreview,
  EditTransactionPlanInput,
  EditRollbackPreview,
} from "./editTransactionTypes";

function nowIso(): string {
  return new Date().toISOString();
}

function createTransactionId(): string {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeFormat(contentFormat?: ExplicitContentFormat): ExplicitContentFormat {
  return contentFormat || "plain_text";
}

function ensureWriteContent(content: string | undefined): string {
  const value = String(content ?? "");
  if (!value.trim()) {
    throw new Error("编辑事务缺少可写入内容");
  }
  return value;
}

function buildStateFromText(
  text: string,
  paragraphCount: number,
  extra?: Partial<EditTargetState>,
): EditTargetState {
  const normalized = normalizeDocumentText(text);
  return {
    text,
    textHash: stableTextHash(normalized),
    excerpt: buildExcerpt(normalized),
    paragraphCount,
    ...extra,
  };
}

function assertExpectation(state: EditTargetState, expected?: EditTargetExpectation): void {
  if (!expected) return;

  const expectedHash = expected.expectedTextHash || expected.beforeTextHash;
  if (expectedHash && state.textHash !== expectedHash) {
    throw new Error("目标内容 hash 与 expectedBefore 不一致");
  }

  if (expected.expectedTextExcerpt) {
    const actual = normalizeDocumentText(state.text);
    const expectedExcerpt = normalizeDocumentText(expected.expectedTextExcerpt);
    if (!actual.includes(expectedExcerpt)) {
      throw new Error("目标内容摘要与 expectedBefore 不一致");
    }
  }

  if (
    typeof expected.paragraphIndex === "number"
    && typeof state.startParagraphIndex === "number"
    && !expected.anchor
    && !expected.paragraphTextHash
    && !expected.expectedTextExcerpt
    && state.startParagraphIndex !== expected.paragraphIndex
  ) {
    throw new Error("目标段落索引与 expectedBefore 不一致");
  }

  if (expected.paragraphTextHash && state.paragraphTexts?.length) {
    const matched = state.paragraphTexts.some((text) => stableTextHash(text) === expected.paragraphTextHash);
    if (!matched) {
      throw new Error("目标段落 hash 与 expectedBefore 不一致");
    }
  }
}

function getExpectedAnchor(expected?: EditTargetExpectation): NonNullable<EditTargetExpectation["anchor"]> | undefined {
  if (expected?.anchor) {
    return expected.anchor;
  }
  if (
    expected
    && (
      typeof expected.paragraphIndex === "number"
      || expected.paragraphTextHash
      || expected.expectedTextExcerpt
      || expected.headingPath?.length
    )
  ) {
    return {
      paragraphIndex: expected.paragraphIndex,
      paragraphTextHash: expected.paragraphTextHash,
      normalizedExcerpt: expected.expectedTextExcerpt,
      headingPath: expected.headingPath,
      occurrence: expected.occurrence,
    };
  }
  return undefined;
}

function neighborMatches(
  paragraphs: Array<{ index: number; text: string }>,
  position: number,
  anchor: NonNullable<EditTargetExpectation["anchor"]>
): boolean {
  const beforeOk = !anchor.beforeNeighborHash
    || stableTextHash(paragraphs[position - 1]?.text || "") === anchor.beforeNeighborHash;
  const afterOk = !anchor.afterNeighborHash
    || stableTextHash(paragraphs[position + 1]?.text || "") === anchor.afterNeighborHash;
  return beforeOk && afterOk;
}

export function resolveAnchorParagraphIndexFromParagraphs(
  paragraphs: Array<{ index: number; text: string }>,
  expected?: EditTargetExpectation
): number | null {
  const anchor = getExpectedAnchor(expected);
  if (!anchor || paragraphs.length === 0) return null;

  if (typeof anchor.paragraphIndex === "number") {
    const directPosition = paragraphs.findIndex((item) => item.index === anchor.paragraphIndex);
    const direct = directPosition >= 0 ? paragraphs[directPosition] : undefined;
    if (direct && (!anchor.paragraphTextHash || stableTextHash(direct.text) === anchor.paragraphTextHash)) {
      return direct.index;
    }
  }

  if (anchor.paragraphTextHash) {
    const hashMatches = paragraphs
      .map((item, position) => ({ item, position }))
      .filter(({ item }) => stableTextHash(item.text) === anchor.paragraphTextHash);
    const neighborMatch = hashMatches.find(({ position }) => neighborMatches(paragraphs, position, anchor));
    if (neighborMatch) return neighborMatch.item.index;
    if (hashMatches.length === 1) return hashMatches[0].item.index;
  }

  const excerpt = normalizeDocumentText(anchor.normalizedExcerpt || expected?.expectedTextExcerpt || "");
  if (excerpt) {
    const matches = paragraphs.filter((item) => normalizeDocumentText(item.text).includes(excerpt));
    const occurrence = Math.max(1, anchor.occurrence || expected?.occurrence || 1);
    if (matches.length >= occurrence) {
      return matches[occurrence - 1].index;
    }
  }

  if (anchor.headingPath?.length) {
    const targetHeading = normalizeDocumentText(anchor.headingPath[anchor.headingPath.length - 1] || "");
    const matches = paragraphs.filter((item) => normalizeDocumentText(item.text) === targetHeading);
    const occurrence = Math.max(1, anchor.occurrence || expected?.occurrence || 1);
    if (matches.length >= occurrence) {
      return matches[occurrence - 1].index;
    }
  }

  return null;
}

async function getParagraphRangeState(startIndex: number, endIndex: number): Promise<EditTargetState> {
  const paragraphCount = await getParagraphCountInDocument();
  if (paragraphCount <= 0 || startIndex >= paragraphCount || endIndex < startIndex) {
    return buildStateFromText("", paragraphCount, {
      startParagraphIndex: Math.max(0, startIndex),
      endParagraphIndex: undefined,
      paragraphTexts: [],
    });
  }

  const boundedStart = Math.max(0, Math.min(startIndex, paragraphCount - 1));
  const boundedEnd = Math.max(boundedStart, Math.min(endIndex, paragraphCount - 1));
  const indices: number[] = [];
  for (let index = boundedStart; index <= boundedEnd; index += 1) {
    indices.push(index);
  }
  const items = await getParagraphsInfoByIndices(indices);
  if (items.length !== indices.length) {
    throw new Error("目标段落范围无法完整读取");
  }
  const text = items.map((item) => item.text).join("\n");
  return buildStateFromText(text, paragraphCount, {
    startParagraphIndex: boundedStart,
    endParagraphIndex: boundedEnd,
    paragraphTexts: items.map((item) => item.text),
  });
}

async function resolveAnchorParagraphIndex(expected?: EditTargetExpectation): Promise<number> {
  const anchor = getExpectedAnchor(expected);
  const paragraphIndex = anchor?.paragraphIndex ?? expected?.paragraphIndex;
  if (typeof paragraphIndex !== "number") {
    throw new Error("insert_at_anchor expectedBefore 必须提供 paragraphIndex；禁止通过全文扫描定位锚点");
  }

  const paragraph = await getParagraphByIndex(paragraphIndex);
  if (!paragraph) {
    throw new Error("anchor 段落不存在");
  }

  const state = buildStateFromText(paragraph.text, await getParagraphCountInDocument(), {
    startParagraphIndex: paragraph.index,
    endParagraphIndex: paragraph.index,
    paragraphTexts: [paragraph.text],
  });
  assertExpectation(state, expected);
  return paragraph.index;
}

async function deleteParagraphRange(startIndex: number, endIndex: number): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    if (startIndex < 0 || endIndex < startIndex || endIndex >= paragraphs.items.length) {
      throw new Error("删除段落范围超出文档范围");
    }

    for (let index = endIndex; index >= startIndex; index -= 1) {
      paragraphs.items[index].delete();
    }
    await context.sync();
  });
}

async function replaceParagraphRange(
  startIndex: number,
  endIndex: number,
  content: string,
  contentFormat: ExplicitContentFormat,
): Promise<void> {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    if (startIndex < 0 || endIndex < startIndex || endIndex >= paragraphs.items.length) {
      throw new Error("替换段落范围超出文档范围");
    }

    const startRange = paragraphs.items[startIndex].getRange();
    const targetRange =
      startIndex === endIndex
        ? startRange
        : startRange.expandTo(paragraphs.items[endIndex].getRange());

    const rawContent = ensureWriteContent(content);
    if (contentFormat === "plain_text" || contentFormat === "table") {
      targetRange.insertText(rawContent, Word.InsertLocation.replace);
    } else {
      const { markdownToWordHtml } = await import("./markdownRenderer");
      targetRange.insertHtml(markdownToWordHtml(rawContent, { renderHeadingsAsParagraphs: true }), Word.InsertLocation.replace);
    }
    await context.sync();
  });
}

function resolvePostCommitRange(
  transaction: EditTransaction,
  paragraphCountAfter: number,
): { start: number; end: number } | null {
  const paragraphCountBefore = transaction.before?.paragraphCount;
  if (typeof paragraphCountBefore !== "number") {
    return null;
  }

  const delta = paragraphCountAfter - paragraphCountBefore;
  switch (transaction.operation.type) {
    case "replace_paragraph_range":
    case "rewrite_paragraph": {
      if (transaction.scope.kind !== "paragraph_range") return null;
      const originalCount = transaction.scope.endParagraphIndex - transaction.scope.startParagraphIndex + 1;
      const updatedCount = Math.max(0, originalCount + delta);
      if (updatedCount <= 0) return null;
      return {
        start: transaction.scope.startParagraphIndex,
        end: transaction.scope.startParagraphIndex + updatedCount - 1,
      };
    }
    case "delete_paragraph_range": {
      if (transaction.scope.kind !== "paragraph_range") return null;
      if (paragraphCountAfter <= transaction.scope.startParagraphIndex) return null;
      return {
        start: transaction.scope.startParagraphIndex,
        end: transaction.scope.startParagraphIndex,
      };
    }
    case "insert_after_paragraph": {
      if (typeof transaction.operation.paragraphIndex !== "number" || delta <= 0) return null;
      return {
        start: transaction.operation.paragraphIndex + 1,
        end: transaction.operation.paragraphIndex + delta,
      };
    }
    case "insert_at_anchor": {
      const anchorIndex = transaction.before?.startParagraphIndex;
      if (typeof anchorIndex !== "number" || delta <= 0) return null;
      return {
        start: anchorIndex + 1,
        end: anchorIndex + delta,
      };
    }
    case "append_text": {
      if (delta <= 0) return null;
      return {
        start: paragraphCountBefore,
        end: paragraphCountBefore + delta - 1,
      };
    }
    case "insert_text": {
      if (delta <= 0) return null;
      if (transaction.scope.kind === "cursor" && transaction.scope.location === "start") {
        return { start: 0, end: delta - 1 };
      }
      if (transaction.scope.kind === "cursor" && transaction.scope.location === "end") {
        return { start: paragraphCountBefore, end: paragraphCountBefore + delta - 1 };
      }
      return null;
    }
    default:
      return null;
  }
}

function buildEmptyPostCommitState(
  paragraphCountAfter: number,
  startParagraphIndex?: number,
): EditTargetState {
  return buildStateFromText("", paragraphCountAfter, {
    startParagraphIndex,
    endParagraphIndex: undefined,
    paragraphTexts: [],
  });
}

function normalizeVerificationText(value: string): string {
  return normalizeDocumentText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function isExpectedAfterSatisfied(after: EditTargetState, expectedText: string): boolean {
  const expected = normalizeVerificationText(expectedText);
  if (!expected) return true;
  const actual = normalizeVerificationText(after.text);
  return actual === expected || actual.includes(expected);
}

function toStoredRecord(transaction: EditTransaction): StoredEditTransactionRecord {
  return transaction;
}

function describeTransactionTarget(transaction: EditTransaction): string {
  if (transaction.scope.kind === "paragraph_range") {
    return `第 ${transaction.scope.startParagraphIndex}-${transaction.scope.endParagraphIndex} 段`;
  }
  if (transaction.scope.kind === "selection") {
    return "当前选区";
  }
  if (transaction.scope.kind === "cursor") {
    return transaction.scope.location === "start"
      ? "文档开头"
      : transaction.scope.location === "end"
        ? "文档末尾"
        : "当前光标";
  }
  if (transaction.scope.kind === "paragraph_anchor") {
    return typeof transaction.scope.anchorParagraphIndex === "number"
      ? `锚点段落 ${transaction.scope.anchorParagraphIndex}`
      : "锚点段落";
  }
  return "整篇文档";
}

export class EditTransactionService {
  planEdit(input: EditTransactionPlanInput): EditTransaction {
    const contentFormat = normalizeFormat(input.operation.contentFormat);
    const content = input.operation.content;
    const expectedPlainText = content ? resolveExpectedPlainText(content, contentFormat) : "";
    const expectedAfterHash = expectedPlainText ? stableTextHash(expectedPlainText) : undefined;

    return {
      id: createTransactionId(),
      source: input.source,
      operationGroupId: input.operationGroupId,
      operation: {
        ...input.operation,
        contentFormat,
      },
      scope: input.scope,
      expectedBefore: input.expectedBefore,
      expectedAfter: expectedAfterHash ? { afterTextHash: expectedAfterHash } : undefined,
      status: "planned",
      createdAt: nowIso(),
    };
  }

  async previewDiff(transaction: EditTransaction): Promise<EditTransaction> {
    const before = await this.readTargetState(transaction);
    const afterText = transaction.operation.content
      ? resolveExpectedPlainText(
        transaction.operation.content,
        normalizeFormat(transaction.operation.contentFormat),
      )
      : "";
    const preview: EditTransactionDiffPreview = {
      title: transaction.operation.type,
      beforeText: before.excerpt,
      afterText: buildExcerpt(afterText),
      summary: afterText
        ? `将把目标内容改为 ${buildExcerpt(afterText, 60)}`
        : "将执行无正文写入的编辑操作",
    };
    const next = {
      ...transaction,
      before,
      preview,
      status: "previewed" as const,
    };
    await this.persistTransaction(next);
    return next;
  }

  async validateTarget(transaction: EditTransaction): Promise<EditTransaction> {
    const before = await this.readTargetState(transaction);
    try {
      assertExpectation(before, transaction.expectedBefore);
    } catch (error) {
      const blocked = {
        ...transaction,
        before,
        status: "blocked_target_changed" as const,
        errorMessage: error instanceof Error ? error.message : "目标内容校验失败",
      };
      await this.persistTransaction(blocked);
      throw error;
    }

    const next = {
      ...transaction,
      before,
    };
    await this.persistTransaction(next);
    return next;
  }

  async captureBefore(transaction: EditTransaction): Promise<EditTransaction> {
    let snapshot = null;
    if (transaction.scope.kind === "selection") {
      const indices = await getParagraphIndicesInSelection();
      if (indices.length > 0) {
        snapshot = await captureScopedUndoSnapshotFromParagraphIndices(indices, transaction.operation.type);
      } else {
        snapshot = await captureBodyUndoSnapshotIfSizeAllows(transaction.operation.type);
      }
    } else if (transaction.scope.kind === "paragraph_range") {
      snapshot = await captureScopedUndoSnapshotFromRanges(
        [{
          startIndex: transaction.scope.startParagraphIndex,
          paragraphCount: transaction.scope.endParagraphIndex - transaction.scope.startParagraphIndex + 1,
          description: transaction.operation.type,
        }],
        transaction.operation.type,
      );
    } else if (transaction.operation.type === "insert_after_paragraph" && typeof transaction.operation.paragraphIndex === "number") {
      snapshot = await captureScopedUndoSnapshotFromRanges(
        [{
          startIndex: transaction.operation.paragraphIndex + 1,
          paragraphCount: 0,
          description: transaction.operation.type,
        }],
        transaction.operation.type,
      );
    } else if (transaction.operation.type === "insert_at_anchor") {
      const anchorIndex = await resolveAnchorParagraphIndex(transaction.expectedBefore);
      snapshot = await captureScopedUndoSnapshotFromRanges(
        [{
          startIndex: anchorIndex + 1,
          paragraphCount: 0,
          description: transaction.operation.type,
        }],
        transaction.operation.type,
      );
    } else if (transaction.operation.type === "append_text" || transaction.scope.kind === "document") {
      const paragraphCount = await getParagraphCountInDocument();
      snapshot = await captureScopedUndoSnapshotFromRanges(
        [{ startIndex: paragraphCount, paragraphCount: 0, description: transaction.operation.type }],
        transaction.operation.type,
      );
    } else if (transaction.scope.kind === "cursor" && transaction.scope.location === "start") {
      snapshot = await captureScopedUndoSnapshotFromRanges(
        [{ startIndex: 0, paragraphCount: 0, description: transaction.operation.type }],
        transaction.operation.type,
      );
    } else {
      snapshot = await captureBodyUndoSnapshotIfSizeAllows(transaction.operation.type);
    }

    if (!snapshot) {
      throw new Error("写入前快照捕获失败，事务已停止");
    }

    const next = {
      ...transaction,
      snapshot,
    };
    await this.persistTransaction(next);
    return next;
  }

  async commitEdit(transaction: EditTransaction): Promise<EditTransaction> {
    const content = transaction.operation.content;
    const contentFormat = normalizeFormat(transaction.operation.contentFormat);
    const committing = {
      ...transaction,
      status: "committing" as const,
      errorMessage: undefined,
    };
    await this.persistTransaction(committing);

    try {
      switch (transaction.operation.type) {
        case "replace_selection":
          await applyAiContentToWord(ensureWriteContent(content), {
            requireSelection: true,
            preserveSelectionFormat: transaction.operation.preserveSelectionFormat ?? true,
            renderMarkdownWhenPreserveFormat: false,
            contentFormat,
          });
          break;
        case "insert_text":
          await insertAiContentToWord(ensureWriteContent(content), {
            location: transaction.scope.kind === "cursor" ? (transaction.scope.location || "cursor") : "cursor",
            contentFormat,
          });
          break;
        case "append_text":
          await insertAiContentToWord(ensureWriteContent(content), {
            location: "end",
            contentFormat,
          });
          break;
        case "insert_after_paragraph":
          if (typeof transaction.operation.paragraphIndex !== "number") {
            throw new Error("insert_after_paragraph 缺少 paragraphIndex");
          }
          await insertAiContentAfterParagraph(
            ensureWriteContent(content),
            transaction.operation.paragraphIndex,
            { contentFormat },
          );
          break;
        case "replace_paragraph_range":
          if (transaction.scope.kind !== "paragraph_range") {
            throw new Error("replace_paragraph_range 需要 paragraph_range scope");
          }
          await replaceParagraphRange(
            transaction.scope.startParagraphIndex,
            transaction.scope.endParagraphIndex,
            ensureWriteContent(content),
            contentFormat,
          );
          break;
        case "rewrite_paragraph":
          if (transaction.scope.kind !== "paragraph_range") {
            throw new Error("rewrite_paragraph 需要 paragraph_range scope");
          }
          await replaceParagraphRange(
            transaction.scope.startParagraphIndex,
            transaction.scope.endParagraphIndex,
            ensureWriteContent(content),
            contentFormat,
          );
          break;
        case "delete_paragraph_range":
          if (transaction.scope.kind !== "paragraph_range") {
            throw new Error("delete_paragraph_range 需要 paragraph_range scope");
          }
          await deleteParagraphRange(transaction.scope.startParagraphIndex, transaction.scope.endParagraphIndex);
          break;
        case "insert_at_anchor": {
          const anchorIndex = await resolveAnchorParagraphIndex(transaction.expectedBefore);
          await insertAiContentAfterParagraph(ensureWriteContent(content), anchorIndex, { contentFormat });
          break;
        }
        default:
          throw new Error(`不支持的事务操作: ${String(transaction.operation.type)}`);
      }
    } catch (error) {
      const expectedPlainText = transaction.operation.content
        ? resolveExpectedPlainText(
          transaction.operation.content,
          normalizeFormat(transaction.operation.contentFormat),
        )
        : undefined;
      if (expectedPlainText) {
        try {
          const after = await this.readPostCommitState(committing);
          if (isExpectedAfterSatisfied(after, expectedPlainText)) {
            const committed = {
              ...committing,
              after,
              status: "committed" as const,
              committedAt: nowIso(),
            };
            await this.persistTransaction(committed);
            return committed;
          }
        } catch {
          // Keep unknown_commit_state below.
        }
      }
      const unknown = {
        ...committing,
        status: "unknown_commit_state" as const,
        errorMessage: `unknown_commit_state:${committing.id}:${error instanceof Error ? error.message : "提交失败"}`,
      };
      await this.persistTransaction(unknown);
      throw new Error(unknown.errorMessage);
    }

    const committed = {
      ...committing,
      status: "committed" as const,
      committedAt: nowIso(),
    };
    await this.persistTransaction(committed);
    return committed;
  }

  async verifyAfter(transaction: EditTransaction): Promise<EditTransaction> {
    const verifying = {
      ...transaction,
      status: "verifying" as const,
    };
    await this.persistTransaction(verifying);

    const after = await this.readPostCommitState(verifying);
    const expectedPlainText = verifying.operation.content
      ? resolveExpectedPlainText(
          verifying.operation.content,
          normalizeFormat(verifying.operation.contentFormat),
        )
      : undefined;

    if (expectedPlainText && !isExpectedAfterSatisfied(after, expectedPlainText)) {
      const failed = {
        ...verifying,
        after,
        status: "failed" as const,
        errorMessage: "写入后校验失败：目标内容与计划不一致",
      };
      await this.persistTransaction(failed);
      throw new Error(failed.errorMessage);
    }

    if (verifying.operation.type === "delete_paragraph_range" && verifying.before) {
      const paragraphCountReduced = after.paragraphCount < verifying.before.paragraphCount;
      const targetChanged = after.textHash !== verifying.before.textHash;
      if (!paragraphCountReduced || !targetChanged) {
        const failed = {
          ...verifying,
          after,
          status: "failed" as const,
          errorMessage: "删除后校验失败：目标范围仍未按计划消失",
        };
        await this.persistTransaction(failed);
        throw new Error(failed.errorMessage);
      }
    }

    const paragraphCountAfter = await getParagraphCountInDocument();
    const finalizedSnapshot = verifying.snapshot
      ? finalizeUndoSnapshot(verifying.snapshot, paragraphCountAfter)
      : undefined;

    const committed = {
      ...verifying,
      snapshot: finalizedSnapshot,
      after,
      status: "committed" as const,
    };
    await this.persistTransaction(committed);
    return committed;
  }

  async finalizeExternalEdit(
    transaction: EditTransaction,
    options?: {
      allowContentChange?: boolean;
      expectedAfterText?: string;
      affectedParagraphRange?: { startIndex: number; endIndex: number };
    }
  ): Promise<EditTransaction> {
    const verifying = {
      ...transaction,
      status: "verifying" as const,
    };
    await this.persistTransaction(verifying);

    const readTransaction = options?.affectedParagraphRange
      ? {
        ...verifying,
        scope: {
          kind: "paragraph_range" as const,
          startParagraphIndex: options.affectedParagraphRange.startIndex,
          endParagraphIndex: options.affectedParagraphRange.endIndex,
        },
      }
      : verifying;
    const after = await this.readTargetState(readTransaction);
    const expectedAfterHash = options?.expectedAfterText
      ? stableTextHash(options.expectedAfterText)
      : (!options?.allowContentChange && verifying.before ? verifying.before.textHash : undefined);

    if (expectedAfterHash && after.textHash !== expectedAfterHash) {
      const failed = {
        ...verifying,
        after,
        status: "failed" as const,
        errorMessage: "格式事务校验失败：正文内容发生未声明变化",
      };
      await this.persistTransaction(failed);
      throw new Error(failed.errorMessage);
    }

    const paragraphCountAfter = await getParagraphCountInDocument();
    const finalizedSnapshot = verifying.snapshot
      ? finalizeUndoSnapshot(verifying.snapshot, paragraphCountAfter)
      : undefined;
    const committed = {
      ...verifying,
      snapshot: finalizedSnapshot,
      after,
      status: "committed" as const,
      committedAt: verifying.committedAt || nowIso(),
    };
    await this.persistTransaction(committed);
    return committed;
  }

  async executeTransactionById(transactionId: string): Promise<EditTransaction> {
    const transaction = await this.loadTransaction(transactionId);
    if (!transaction) {
      throw new Error("未找到指定事务");
    }
    const validated = await this.validateTarget(transaction);
    const captured = validated.snapshot ? validated : await this.captureBefore(validated);
    const committed = await this.commitEdit(captured);
    return this.verifyAfter(committed);
  }

  async inspectUnknownCommitState(transactionOrId: EditTransaction | string): Promise<{
    status: "already_committed" | "definitely_not_committed" | "indeterminate";
    transaction: EditTransaction;
    message: string;
  }> {
    const transaction = typeof transactionOrId === "string"
      ? await this.loadTransaction(transactionOrId)
      : transactionOrId;
    if (!transaction) {
      throw new Error("未找到指定事务");
    }

    const expectedAfterHash =
      transaction.expectedAfter?.afterTextHash
      || (transaction.operation.content
        ? stableTextHash(resolveExpectedPlainText(
          transaction.operation.content,
          normalizeFormat(transaction.operation.contentFormat),
        ))
        : undefined);

    try {
      const after = await this.readPostCommitState(transaction);
      if (expectedAfterHash && after.textHash === expectedAfterHash) {
        const committed = {
          ...transaction,
          after,
          status: "committed" as const,
          committedAt: transaction.committedAt || nowIso(),
        };
        await this.persistTransaction(committed);
        return {
          status: "already_committed",
          transaction: committed,
          message: "已确认该事务实际上已经写入成功。",
        };
      }
    } catch {
      // Fall through to target validation.
    }

    try {
      const before = await this.readTargetState(transaction);
      assertExpectation(before, transaction.expectedBefore);
      return {
        status: "definitely_not_committed",
        transaction: {
          ...transaction,
          before,
        },
        message: "已确认该事务尚未写入，可以重新提交。",
      };
    } catch {
      return {
        status: "indeterminate",
        transaction,
        message: "无法明确判断该事务是否已写入，请人工检查文档后再处理。",
      };
    }
  }

  async retryUnknownCommit(transactionOrId: EditTransaction | string): Promise<EditTransaction> {
    const inspection = await this.inspectUnknownCommitState(transactionOrId);
    if (inspection.status === "already_committed") {
      return inspection.transaction;
    }
    if (inspection.status !== "definitely_not_committed") {
      throw new Error("当前事务状态不明确，不能自动重新提交");
    }
    const transaction = inspection.transaction;
    const captured = transaction.snapshot ? transaction : await this.captureBefore(transaction);
    const committed = await this.commitEdit(captured);
    return this.verifyAfter(committed);
  }

  async rollbackEdit(transactionOrId: EditTransaction | string): Promise<EditTransaction> {
    const transaction = typeof transactionOrId === "string"
      ? await this.loadTransaction(transactionOrId)
      : transactionOrId;
    if (!transaction) {
      throw new Error("未找到可撤回的事务记录");
    }
    if (!transaction.snapshot) {
      throw new Error("事务缺少撤回快照，无法回滚");
    }

    const preview = await this.previewRollback(transaction);
    if (!preview.canRollback) {
      const blocked = {
        ...transaction,
        status: "blocked_target_changed" as const,
        errorMessage: preview.blockedReason || "该内容已被修改，需要手动撤回",
      };
      await this.persistTransaction(blocked);
      throw new Error(blocked.errorMessage);
    }

    const rolling = {
      ...transaction,
      status: "rolling_back" as const,
      errorMessage: undefined,
    };
    await this.persistTransaction(rolling);
    await restoreUndoSnapshot(transaction.snapshot);

    const rolledBack = {
      ...rolling,
      status: "rolled_back" as const,
      rolledBackAt: nowIso(),
    };
    await this.persistTransaction(rolledBack);
    const rollbackRecord = this.createRollbackRecord(rolledBack, preview);
    await this.persistTransaction(rollbackRecord);
    return rolledBack;
  }

  async previewRollback(transactionOrId: EditTransaction | string): Promise<EditRollbackPreview> {
    const transaction = typeof transactionOrId === "string"
      ? await this.loadTransaction(transactionOrId)
      : transactionOrId;
    if (!transaction) {
      throw new Error("未找到可撤回的事务记录");
    }
    if (!transaction.snapshot) {
      return {
        transactionId: transaction.id,
        operationGroupId: transaction.operationGroupId,
        title: "撤回不可用",
        targetDescription: describeTransactionTarget(transaction),
        currentText: "",
        restoreText: transaction.before?.text || "",
        currentTextHash: "",
        restoreTextHash: transaction.before?.textHash,
        canRollback: false,
        blockedReason: "事务缺少撤回快照，无法回滚",
      };
    }

    let current: EditTargetState;
    try {
      current = await this.readPostCommitState(transaction);
    } catch (error) {
      return {
        transactionId: transaction.id,
        operationGroupId: transaction.operationGroupId,
        title: "撤回目标无法读取",
        targetDescription: describeTransactionTarget(transaction),
        currentText: "",
        restoreText: transaction.before?.text || "",
        currentTextHash: "",
        restoreTextHash: transaction.before?.textHash,
        canRollback: false,
        blockedReason: error instanceof Error ? error.message : "撤回目标无法读取",
      };
    }

    const expectedAfterHash = transaction.after?.textHash;
    const canRollback = !expectedAfterHash || current.textHash === expectedAfterHash;
    return {
      transactionId: transaction.id,
      operationGroupId: transaction.operationGroupId,
      title: `撤回 ${transaction.operation.type}`,
      targetDescription: describeTransactionTarget(transaction),
      currentText: current.excerpt || current.text,
      restoreText: transaction.before?.excerpt || transaction.before?.text || "",
      currentTextHash: current.textHash,
      restoreTextHash: transaction.before?.textHash,
      affectedParagraphRange: {
        startParagraphIndex: current.startParagraphIndex ?? transaction.before?.startParagraphIndex,
        endParagraphIndex: current.endParagraphIndex ?? transaction.before?.endParagraphIndex,
      },
      canRollback,
      blockedReason: canRollback ? undefined : "目标内容已变化，请从变更记录中手动复制需要恢复的内容。",
    };
  }

  async rollbackEditGroup(operationGroupId: string): Promise<EditTransaction[]> {
    const transactions = (await loadEditTransactionsByOperationGroup(operationGroupId))
      .filter((transaction) => transaction.status === "committed" && !transaction.rollbackOf)
      .sort((left, right) => {
        const l = Date.parse(left.committedAt || left.createdAt);
        const r = Date.parse(right.committedAt || right.createdAt);
        return Number.isFinite(r - l) ? r - l : 0;
      });
    const rolledBack: EditTransaction[] = [];
    for (const transaction of transactions) {
      rolledBack.push(await this.rollbackEdit(transaction));
    }
    return rolledBack;
  }

  private createRollbackRecord(
    transaction: EditTransaction,
    preview: EditRollbackPreview
  ): EditTransaction {
    return {
      id: createTransactionId(),
      source: transaction.source,
      operationGroupId: transaction.operationGroupId,
      operation: {
        type: "apply_format",
        content: `rollback:${transaction.id}`,
        contentFormat: "plain_text",
      },
      scope: transaction.scope,
      before: {
        text: preview.currentText,
        textHash: preview.currentTextHash,
        excerpt: buildExcerpt(preview.currentText),
        paragraphCount: transaction.after?.paragraphCount || transaction.before?.paragraphCount || 0,
        startParagraphIndex: preview.affectedParagraphRange?.startParagraphIndex,
        endParagraphIndex: preview.affectedParagraphRange?.endParagraphIndex,
      },
      after: transaction.before,
      status: "committed",
      createdAt: nowIso(),
      committedAt: nowIso(),
      rollbackOf: transaction.id,
    };
  }

  async persistTransaction(transaction: EditTransaction): Promise<void> {
    await saveEditTransactionRecord(toStoredRecord(transaction));
  }

  async loadTransaction(id: string): Promise<EditTransaction | null> {
    return loadEditTransactionRecord(id);
  }

  private async readTargetState(transaction: EditTransaction): Promise<EditTargetState> {
    if (transaction.scope.kind === "selection") {
      const selectedText = await getSelectedText();
      const paragraphIndices = await getParagraphIndicesInSelection();
      return buildStateFromText(selectedText, await getParagraphCountInDocument(), {
        paragraphIndices,
        startParagraphIndex: paragraphIndices.length ? Math.min(...paragraphIndices) : undefined,
        endParagraphIndex: paragraphIndices.length ? Math.max(...paragraphIndices) : undefined,
      });
    }

    if (transaction.scope.kind === "paragraph_range") {
      return getParagraphRangeState(transaction.scope.startParagraphIndex, transaction.scope.endParagraphIndex);
    }

    if (transaction.operation.type === "insert_after_paragraph" && typeof transaction.operation.paragraphIndex === "number") {
      const paragraph = await getParagraphByIndex(transaction.operation.paragraphIndex);
      if (!paragraph) {
        throw new Error("目标段落不存在");
      }
      return buildStateFromText(paragraph.text, await getParagraphCountInDocument(), {
        startParagraphIndex: paragraph.index,
        endParagraphIndex: paragraph.index,
        paragraphTexts: [paragraph.text],
      });
    }

    if (transaction.operation.type === "insert_at_anchor") {
      const anchorIndex = await resolveAnchorParagraphIndex(transaction.expectedBefore);
      const paragraph = await getParagraphByIndex(anchorIndex);
      if (!paragraph) {
        throw new Error("anchor 段落不存在");
      }
      return buildStateFromText(paragraph.text, await getParagraphCountInDocument(), {
        startParagraphIndex: paragraph.index,
        endParagraphIndex: paragraph.index,
        paragraphTexts: [paragraph.text],
      });
    }

    return buildStateFromText("", await getParagraphCountInDocument());
  }

  private async readPostCommitState(transaction: EditTransaction): Promise<EditTargetState> {
    const paragraphCountAfter = await getParagraphCountInDocument();
    switch (transaction.operation.type) {
      case "replace_paragraph_range":
      case "rewrite_paragraph":
      case "insert_after_paragraph":
      case "insert_at_anchor":
      case "append_text":
      case "insert_text": {
        const range = resolvePostCommitRange(transaction, paragraphCountAfter);
        if (!range) {
          throw new Error("写入后无法根据 transaction scope 定位 changed range");
        }
        return getParagraphRangeState(range.start, range.end);
      }
      case "delete_paragraph_range":
        if (transaction.scope.kind !== "paragraph_range") {
          throw new Error("缺少 paragraph_range scope");
        }
        if (paragraphCountAfter <= transaction.scope.startParagraphIndex) {
          return buildEmptyPostCommitState(paragraphCountAfter, transaction.scope.startParagraphIndex);
        }
        return getParagraphRangeState(transaction.scope.startParagraphIndex, transaction.scope.startParagraphIndex);
      case "replace_selection": {
        throw new Error("replace_selection 写后校验需要 selection range，Agent pipeline 不允许全文扫描定位");
      }
      default:
        return this.readTargetState(transaction);
    }
  }
}

export const editTransactionService = new EditTransactionService();

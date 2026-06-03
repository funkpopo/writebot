import type { ToolCallResult } from "../../../../types/tools";
import { editTransactionService } from "../../../../utils/editTransactionService";
import type { EditTransaction } from "../../../../utils/editTransactionTypes";
import type { DocumentIndexRangePatch, DocumentRangeReadResult } from "../../../../utils/wordApi";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";
import {
  DocumentSession,
  type DocumentIndexSummary,
} from "./documentSession";
import type { OutlineSection } from "./types";

const CONTENT_WRITE_TOOL_NAMES = new Set([
  "insert_at_anchor",
  "replace_paragraph_range",
  "rewrite_paragraph",
]);

export async function readDocumentText(
  harness: AgentHarnessRuntime,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const event = harness.recordEvent({
    kind: "document_read_failed",
    message: "Full document reads are forbidden in the agent pipeline",
    metadata,
  });
  harness.completeEvent(event, {
    kind: "document_read_failed",
    metadata: {
      ...(metadata || {}),
      code: "forbidden_full_document_read",
    },
  });
  throw new AgentHarnessError(
    "forbidden_full_document_read",
    "Agent workflow 禁止读取全文；必须使用 DocumentSession 索引和局部 range。",
    { details: metadata },
  );
}

export async function initializeDocumentSession(
  harness: AgentHarnessRuntime,
  metadata?: Record<string, unknown>,
): Promise<DocumentSession> {
  return DocumentSession.create(harness, metadata);
}

export async function refreshDocumentIndex(
  session: DocumentSession,
  harness: AgentHarnessRuntime,
  reason: string,
  patch: DocumentIndexRangePatch,
): Promise<void> {
  await session.refresh(harness, reason, patch);
}

export async function readIndexedRanges(
  session: DocumentSession,
  harness: AgentHarnessRuntime,
  request: Parameters<DocumentSession["readRanges"]>[1],
  metadata?: Record<string, unknown>,
) {
  return session.readRanges(harness, request, metadata);
}

export async function readSectionByHeading(
  session: DocumentSession,
  harness: AgentHarnessRuntime,
  section: OutlineSection,
  nextSection?: OutlineSection,
  metadata?: Record<string, unknown>,
) {
  return session.readSectionByHeading(harness, section, nextSection, metadata);
}

export interface WrittenSectionResolution {
  transactionIds: string[];
  range: DocumentRangeReadResult;
}

function extractTransactionId(result: ToolCallResult): string | null {
  if (!result.success || !CONTENT_WRITE_TOOL_NAMES.has(result.name)) return null;
  if (!result.result || typeof result.result !== "object") return null;
  const transactionId = (result.result as { transactionId?: unknown }).transactionId;
  return typeof transactionId === "string" && transactionId.trim()
    ? transactionId.trim()
    : null;
}

function getReadableTransactionRange(transaction: EditTransaction): { start: number; end: number } {
  if (transaction.status !== "committed") {
    throw new AgentHarnessError(
      "tool_contract_violation",
      `写入事务 ${transaction.id} 尚未 committed，不能作为章节内容来源。`,
      {
        agentId: "writer",
        details: {
          transactionId: transaction.id,
          status: transaction.status,
          operationType: transaction.operation.type,
        },
      },
    );
  }

  if (transaction.operation.type === "delete_paragraph_range") {
    throw new AgentHarnessError(
      "tool_contract_violation",
      `删除事务 ${transaction.id} 不能作为写入章节内容来源。`,
      {
        agentId: "writer",
        details: {
          transactionId: transaction.id,
          operationType: transaction.operation.type,
        },
      },
    );
  }

  const start = transaction.after?.startParagraphIndex;
  const end = transaction.after?.endParagraphIndex;
  if (
    typeof start !== "number"
    || typeof end !== "number"
    || !Number.isFinite(start)
    || !Number.isFinite(end)
    || start < 0
    || end < start
  ) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `事务 ${transaction.id} 缺少可读取的 after range。`,
      {
        agentId: "writer",
        details: {
          transactionId: transaction.id,
          operationType: transaction.operation.type,
          after: transaction.after,
        },
      },
    );
  }

  return { start: Math.floor(start), end: Math.floor(end) };
}

async function loadCommittedWriteRanges(
  transactionIds: string[],
  metadata?: Record<string, unknown>,
): Promise<Array<{ transactionId: string; start: number; end: number }>> {
  const ranges: Array<{ transactionId: string; start: number; end: number }> = [];
  for (const transactionId of transactionIds) {
    const transaction = await editTransactionService.loadTransaction(transactionId);
    if (!transaction) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `未找到结构化写入事务 ${transactionId}，无法读取写入后的章节范围。`,
        {
          agentId: "writer",
          details: {
            transactionId,
            metadata,
          },
        },
      );
    }
    const range = getReadableTransactionRange(transaction);
    ranges.push({ transactionId, ...range });
  }
  return ranges;
}

export async function resolveWrittenSectionFromTransaction(params: {
  session: DocumentSession;
  harness: AgentHarnessRuntime;
  section: OutlineSection;
  nextSection?: OutlineSection;
  toolResults: ToolCallResult[];
  metadata?: Record<string, unknown>;
}): Promise<WrittenSectionResolution> {
  const transactionIds = params.toolResults
    .map((result) => extractTransactionId(result))
    .filter((transactionId): transactionId is string => Boolean(transactionId));

  if (transactionIds.length === 0) {
    throw new AgentHarnessError(
      "tool_contract_violation",
      `写入后缺少可验证的结构化 transaction result：${params.section.title}`,
      {
        agentId: "writer",
        details: {
          sectionId: params.section.id,
          sectionTitle: params.section.title,
          toolResults: params.toolResults.map((result) => ({
            id: result.id,
            name: result.name,
            success: result.success,
            error: result.error,
          })),
          metadata: params.metadata,
        },
      },
    );
  }

  const committedRanges = await loadCommittedWriteRanges(transactionIds, params.metadata);
  const start = Math.min(...committedRanges.map((range) => range.start));
  const end = Math.max(...committedRanges.map((range) => range.end));
  const [range] = await params.session.readRanges(
    params.harness,
    {
      ranges: [{ start, end }],
      maxParagraphs: Math.max(1, end - start + 1),
    },
    {
      ...(params.metadata || {}),
      transactionIds,
      transactionRanges: committedRanges,
      sectionId: params.section.id,
      sectionTitle: params.section.title,
    },
  );
  if (!range) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `写入后事务范围读取为空：${params.section.title}`,
      {
        agentId: "writer",
        details: {
          sectionId: params.section.id,
          sectionTitle: params.section.title,
          transactionIds,
          transactionRanges: committedRanges,
        },
      },
    );
  }

  return { transactionIds, range };
}

export function buildDocumentIndexSummary(session: DocumentSession): DocumentIndexSummary {
  return session.getSummary();
}

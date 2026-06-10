import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import {
  buildExcerpt,
  normalizeDocumentText,
  resolveExpectedPlainText,
  stableTextHash,
} from "../../../../utils/documentText";
import type { ExplicitContentFormat } from "../../../../utils/documentText";
import { loadEditTransactions } from "../../../../utils/storageService";
import type { EditTransaction } from "../../../../utils/editTransactionTypes";
import type { DocumentIndexParagraph, DocumentRangeReadResult } from "../../../../utils/wordApi";
import { AgentHarnessError, type AgentHarnessRuntime } from "./agentHarness";
import type { DocumentSession } from "./documentSession";
import type { OutlineSection, SectionWriteResult } from "./types";

export type DeterministicWriteMode = "new_section" | "revision";

export interface WriterWriteFingerprint {
  normalizedText: string;
  plainText: string;
  textHash: string;
  operationGroupId: string;
  anchorKey?: string;
  targetRangeKey?: string;
}

export interface DuplicateWriteGuardResult {
  status: "clear" | "duplicate" | "conflict";
  code?: "duplicate_write_detected" | "tool_contract_violation";
  message?: string;
  matchedBy?: "runtime_section_cache" | "runtime_segment_hash" | "transaction_ledger" | "document_index_hash" | "target_range_preview";
  transactionId?: string;
  sectionId?: string;
  expectedHash?: string;
  actualHash?: string;
}

const WRITER_WRITE_TOOL_NAMES = new Set([
  "insert_at_anchor",
  "replace_paragraph_range",
  "rewrite_paragraph",
]);

function compactHashInput(value: string): string {
  return normalizeDocumentText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function stableIdHash(value: string): string {
  const normalized = compactHashInput(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeWriteText(value: string, contentFormat: ExplicitContentFormat): string {
  return normalizeDocumentText(resolveExpectedPlainText(value, contentFormat));
}

function normalizeTitle(value: string): string {
  return normalizeDocumentText(value)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\(?\d+[\).、:：\-\s]+/, "")
    .replace(/[：:。．、,，;；!?！？"“”'‘’]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function getCommittedAgentWrites(): Promise<EditTransaction[]> {
  return loadEditTransactions().then((transactions) =>
    transactions.filter((transaction) =>
      transaction.source === "agent_tool"
      && transaction.status === "committed"
      && WRITER_WRITE_TOOL_NAMES.has(transaction.operation.type)
    ),
  );
}

function buildAnchorKey(anchor: DocumentIndexParagraph | null | undefined): string | undefined {
  if (!anchor) return undefined;
  return [
    `p${anchor.index}`,
    anchor.anchor.anchorId || "",
    anchor.textHash || anchor.anchor.paragraphTextHash || "",
  ].filter(Boolean).join(":");
}

function buildRangeKey(range: DocumentRangeReadResult | undefined): string | undefined {
  if (!range) return undefined;
  return `p${range.startParagraphIndex}-${range.endParagraphIndex}:${stableTextHash(range.text)}`;
}

export function buildWriterOperationGroupId(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  contentHash?: string;
  targetRange?: Pick<DocumentRangeReadResult, "startParagraphIndex" | "endParagraphIndex" | "text">;
}): string {
  const suffix = params.mode === "revision" && params.targetRange
    ? stableIdHash([
      params.targetRange.startParagraphIndex,
      params.targetRange.endParagraphIndex,
      stableTextHash(params.targetRange.text),
      params.contentHash || "",
    ].join(":"))
    : stableIdHash(params.contentHash || params.section.title);
  return `writer_${params.mode}_${params.section.id}_${suffix}`;
}

export function buildWriterWriteFingerprint(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  text: string;
  contentFormat?: ExplicitContentFormat;
  anchorParagraph?: DocumentIndexParagraph | null;
  targetRange?: DocumentRangeReadResult;
}): WriterWriteFingerprint {
  const contentFormat = params.contentFormat || "markdown";
  const normalizedText = normalizeDocumentText(params.text);
  const plainText = normalizeWriteText(params.text, contentFormat);
  const textHash = stableTextHash(plainText);
  const operationGroupId = buildWriterOperationGroupId({
    mode: params.mode,
    section: params.section,
    contentHash: textHash,
    targetRange: params.targetRange,
  });
  return {
    normalizedText,
    plainText,
    textHash,
    operationGroupId,
    anchorKey: buildAnchorKey(params.anchorParagraph),
    targetRangeKey: buildRangeKey(params.targetRange),
  };
}

function sectionCacheResult(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  writtenSections: SectionWriteResult[];
  textHash: string;
}): DuplicateWriteGuardResult {
  const existing = params.writtenSections.find((section) => section.sectionId === params.section.id);
  if (!existing?.content?.trim()) return { status: "clear" };

  const existingHash = stableTextHash(existing.content);
  const existingMarkdownHash = stableTextHash(normalizeWriteText(existing.content, "markdown"));
  if (existingHash === params.textHash || existingMarkdownHash === params.textHash) {
    return {
      status: "duplicate",
      code: "duplicate_write_detected",
      message: `章节 ${params.section.title} 已在运行时缓存中写入相同内容，已阻断重复写入。`,
      matchedBy: "runtime_section_cache",
      sectionId: params.section.id,
      expectedHash: params.textHash,
      actualHash: existingHash === params.textHash ? existingHash : existingMarkdownHash,
    };
  }

  if (params.mode === "new_section") {
    return {
      status: "conflict",
      code: "tool_contract_violation",
      message: `章节 ${params.section.title} 已存在不同内容，不能作为新章节重复追加。`,
      matchedBy: "runtime_section_cache",
      sectionId: params.section.id,
      expectedHash: params.textHash,
      actualHash: existingHash,
    };
  }

  return { status: "clear" };
}

function segmentHashResult(params: {
  writtenSegments: string[];
  textHash: string;
}): DuplicateWriteGuardResult {
  const matched = params.writtenSegments.some((segment) =>
    stableTextHash(segment) === params.textHash
    || stableTextHash(normalizeWriteText(segment, "markdown")) === params.textHash
  );
  if (!matched) return { status: "clear" };
  return {
    status: "duplicate",
    code: "duplicate_write_detected",
    message: "运行时写入片段 hash 已命中相同内容，已阻断重复写入。",
    matchedBy: "runtime_segment_hash",
    expectedHash: params.textHash,
    actualHash: params.textHash,
  };
}

function indexHashResult(params: {
  mode: DeterministicWriteMode;
  documentSession: DocumentSession;
  textHash: string;
}): DuplicateWriteGuardResult {
  if (params.mode !== "new_section") return { status: "clear" };
  const matched = params.documentSession.getIndex().paragraphs.find((paragraph) =>
    paragraph.textHash === params.textHash
    || (paragraph.preview && stableTextHash(paragraph.preview) === params.textHash)
  );
  if (!matched) return { status: "clear" };
  return {
    status: "duplicate",
    code: "duplicate_write_detected",
    message: `DocumentSession 索引中已存在相同段落 hash（p${matched.index}），已阻断重复写入。`,
    matchedBy: "document_index_hash",
    expectedHash: params.textHash,
    actualHash: matched.textHash,
  };
}

function headingConflictResult(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  documentSession: DocumentSession;
  textHash: string;
}): DuplicateWriteGuardResult {
  if (params.mode !== "new_section") return { status: "clear" };
  const sectionTitle = normalizeTitle(params.section.title);
  if (!sectionTitle) return { status: "clear" };
  const matched = params.documentSession.getIndex().paragraphs.find((paragraph) =>
    (paragraph.kind === "heading" || paragraph.outlineLevel !== undefined || /^#{1,6}\s+\S+/.test(paragraph.preview || ""))
    && normalizeTitle(paragraph.preview || "") === sectionTitle
  );
  if (!matched) return { status: "clear" };
  return {
    status: "conflict",
    code: "tool_contract_violation",
    message: `DocumentSession 索引中已存在同名章节标题「${params.section.title}」（p${matched.index}），但未能证明这是同一写入；已阻断相似重复追加。`,
    matchedBy: "document_index_hash",
    sectionId: params.section.id,
    expectedHash: params.textHash,
    actualHash: matched.textHash,
  };
}

function targetRangeResult(params: {
  mode: DeterministicWriteMode;
  targetRange?: DocumentRangeReadResult;
  textHash: string;
}): DuplicateWriteGuardResult {
  if (params.mode !== "revision" || !params.targetRange) return { status: "clear" };
  const targetHash = stableTextHash(params.targetRange.text);
  const targetMarkdownHash = stableTextHash(normalizeWriteText(params.targetRange.text, "markdown"));
  if (targetHash !== params.textHash && targetMarkdownHash !== params.textHash) return { status: "clear" };
  return {
    status: "duplicate",
    code: "duplicate_write_detected",
    message: "目标章节 range 已经等于待修订内容，已阻断重复修订写入。",
    matchedBy: "target_range_preview",
    expectedHash: params.textHash,
    actualHash: targetHash === params.textHash ? targetHash : targetMarkdownHash,
  };
}

async function ledgerResult(params: {
  operationGroupId: string;
  textHash: string;
}): Promise<DuplicateWriteGuardResult> {
  const transactions = await getCommittedAgentWrites();
  for (const transaction of transactions) {
    const sameGroup = transaction.operationGroupId === params.operationGroupId;
    const candidateText = transaction.operation.content || transaction.after?.text || transaction.preview?.afterText || "";
    const candidateFormat = transaction.operation.contentFormat || "plain_text";
    const candidateHash = stableTextHash(normalizeWriteText(candidateText, candidateFormat));

    if (sameGroup && candidateHash === params.textHash) {
      return {
        status: "duplicate",
        code: "duplicate_write_detected",
        message: `transaction ledger 已存在相同 operationGroupId 的已提交写入：${transaction.id}`,
        matchedBy: "transaction_ledger",
        transactionId: transaction.id,
        expectedHash: params.textHash,
        actualHash: candidateHash,
      };
    }

    if (sameGroup && candidateHash !== params.textHash) {
      return {
        status: "conflict",
        code: "tool_contract_violation",
        message: `transaction ledger 中 operationGroupId ${params.operationGroupId} 已提交不同内容：${transaction.id}`,
        matchedBy: "transaction_ledger",
        transactionId: transaction.id,
        expectedHash: params.textHash,
        actualHash: candidateHash,
      };
    }
  }

  return { status: "clear" };
}

function firstBlockingResult(results: DuplicateWriteGuardResult[]): DuplicateWriteGuardResult {
  return results.find((result) => result.status !== "clear") || { status: "clear" };
}

export async function checkDuplicateWriteGuard(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  text: string;
  contentFormat?: ExplicitContentFormat;
  documentSession: DocumentSession;
  writtenSections: SectionWriteResult[];
  writtenSegments: string[];
  targetRange?: DocumentRangeReadResult;
  anchorParagraph?: DocumentIndexParagraph | null;
}): Promise<DuplicateWriteGuardResult & { fingerprint: WriterWriteFingerprint }> {
  const fingerprint = buildWriterWriteFingerprint({
    mode: params.mode,
    section: params.section,
    text: params.text,
    contentFormat: params.contentFormat,
    anchorParagraph: params.anchorParagraph,
    targetRange: params.targetRange,
  });

  const localResult = firstBlockingResult([
    sectionCacheResult({
      mode: params.mode,
      section: params.section,
      writtenSections: params.writtenSections,
      textHash: fingerprint.textHash,
    }),
    segmentHashResult({
      writtenSegments: params.writtenSegments,
      textHash: fingerprint.textHash,
    }),
    indexHashResult({
      mode: params.mode,
      documentSession: params.documentSession,
      textHash: fingerprint.textHash,
    }),
    headingConflictResult({
      mode: params.mode,
      section: params.section,
      documentSession: params.documentSession,
      textHash: fingerprint.textHash,
    }),
    targetRangeResult({
      mode: params.mode,
      targetRange: params.targetRange,
      textHash: fingerprint.textHash,
    }),
  ]);
  if (localResult.status !== "clear") {
    return { ...localResult, fingerprint };
  }

  const ledger = await ledgerResult({
    operationGroupId: fingerprint.operationGroupId,
    textHash: fingerprint.textHash,
  });
  return { ...ledger, fingerprint };
}

export function throwIfDuplicateWriteBlocked(params: {
  result: DuplicateWriteGuardResult;
  section: OutlineSection;
  harness: AgentHarnessRuntime;
  mode: DeterministicWriteMode;
}): void {
  if (params.result.status === "clear") return;

  params.harness.recordEvent({
    kind: "tool_batch_failed",
    agentId: "writer",
    message: params.result.message || "Writer deterministic write blocked",
    toolNames: [],
    toolCount: 0,
    toolFailureCount: 1,
    metadata: {
      code: params.result.code,
      mode: params.mode,
      sectionId: params.section.id,
      sectionTitle: params.section.title,
      matchedBy: params.result.matchedBy,
      transactionId: params.result.transactionId,
      expectedHash: params.result.expectedHash,
      actualHash: params.result.actualHash,
    },
  });

  throw new AgentHarnessError(
    params.result.code || "tool_contract_violation",
    params.result.message || `Writer 写入被阻断：${params.section.title}`,
    {
      agentId: "writer",
      details: {
        mode: params.mode,
        sectionId: params.section.id,
        sectionTitle: params.section.title,
        matchedBy: params.result.matchedBy,
        transactionId: params.result.transactionId,
        expectedHash: params.result.expectedHash,
        actualHash: params.result.actualHash,
      },
    },
  );
}

export function buildInsertAtAnchorToolCall(params: {
  section: OutlineSection;
  text: string;
  anchorParagraph: DocumentIndexParagraph;
  operationGroupId: string;
}): ToolCallRequest {
  return {
    id: params.operationGroupId,
    name: "insert_at_anchor",
    arguments: {
      text: params.text,
      contentFormat: "markdown",
      expectedBefore: {
        paragraphIndex: params.anchorParagraph.index,
        anchor: params.anchorParagraph.anchor,
        paragraphTextHash: params.anchorParagraph.textHash,
        expectedTextExcerpt: params.anchorParagraph.preview,
        headingPath: params.anchorParagraph.headingPath,
      },
    },
  };
}

export function buildReplaceRangeToolCall(params: {
  section: OutlineSection;
  text: string;
  targetRange: DocumentRangeReadResult;
  operationGroupId: string;
}): ToolCallRequest {
  const firstParagraph = params.targetRange.paragraphs[0];
  const expectedText = params.targetRange.text;
  return {
    id: params.operationGroupId,
    name: "replace_paragraph_range",
    arguments: {
      startParagraphIndex: params.targetRange.startParagraphIndex,
      endParagraphIndex: params.targetRange.endParagraphIndex,
      text: params.text,
      contentFormat: "markdown",
      expectedBefore: {
        paragraphIndex: params.targetRange.startParagraphIndex,
        anchor: firstParagraph?.anchor,
        paragraphTextHash: firstParagraph?.textHash,
        expectedTextHash: stableTextHash(expectedText),
        expectedTextExcerpt: buildExcerpt(expectedText),
        beforeTextHash: stableTextHash(expectedText),
        headingPath: firstParagraph?.headingPath,
      },
    },
  };
}

export function assertSingleWriteTransaction(params: {
  section: OutlineSection;
  toolResults: ToolCallResult[];
  expectedToolName: "insert_at_anchor" | "replace_paragraph_range" | "rewrite_paragraph";
}): void {
  const successfulWrites = params.toolResults.filter((result) =>
    result.success && result.name === params.expectedToolName
  );
  if (successfulWrites.length !== 1) {
    throw new AgentHarnessError(
      "tool_contract_violation",
      `章节 ${params.section.title} 必须且只能产生 1 次 ${params.expectedToolName} transaction，实际 ${successfulWrites.length} 次。`,
      {
        agentId: "writer",
        details: {
          sectionId: params.section.id,
          expectedToolName: params.expectedToolName,
          successfulWriteCount: successfulWrites.length,
          toolResults: params.toolResults.map((result) => ({
            id: result.id,
            name: result.name,
            success: result.success,
            error: result.error,
          })),
        },
      },
    );
  }
}

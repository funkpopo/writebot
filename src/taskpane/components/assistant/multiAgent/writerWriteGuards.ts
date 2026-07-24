/**
 * Writer 写入契约（简单优先、少失败）
 *
 * 所有权：sectionId + writtenSections/checkpoint。
 * 落盘：未写 → insert；相同 → skip；不同 → replace（禁止 append）。
 * 标题扫描只做 skip/replace 定位，不 hard-fail。
 * 防重复：cache → 标题 range → 修订 target → ledger；不做全文读、不叠 LLM。
 */
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
  /**
   * - clear: 可直接追加写入
   * - duplicate: 内容已存在，应幂等跳过（不抛错）
   * - reuse_range: 同名章节已在文档中，应替换该 range 而非末尾追加
   * - conflict: 真正冲突，阻断写入
   */
  status: "clear" | "duplicate" | "conflict" | "reuse_range";
  code?: "duplicate_write_detected" | "tool_contract_violation";
  message?: string;
  matchedBy?:
    | "runtime_section_cache"
    | "runtime_segment_hash"
    | "transaction_ledger"
    | "document_index_hash"
    | "document_index_heading"
    | "target_range_preview";
  transactionId?: string;
  sectionId?: string;
  expectedHash?: string;
  actualHash?: string;
  /** reuse_range 时给出可替换的索引范围（还需 readRanges 取 expectedBefore）。 */
  existingRange?: {
    startParagraphIndex: number;
    endParagraphIndex: number;
  };
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

/**
 * 主所有权：sectionId ∈ writtenSections（checkpoint/runtime）。
 * 相同 → skip；不同且有 range → replace；不同且无 range → clear，交给标题扫描补定位。
 */
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
      message: `章节 ${params.section.title}（sectionId=${params.section.id}）已在 checkpoint/runtime 缓存中，内容一致，跳过重复写入。`,
      matchedBy: "runtime_section_cache",
      sectionId: params.section.id,
      expectedHash: params.textHash,
      actualHash: existingHash === params.textHash ? existingHash : existingMarkdownHash,
      existingRange: existing.range
        ? {
          startParagraphIndex: existing.range.startParagraphIndex,
          endParagraphIndex: existing.range.endParagraphIndex,
        }
        : undefined,
    };
  }

  if (params.mode === "new_section") {
    // 写过且不同：有 range 则 replace，禁止 append；无 range 则放行给 headingPresence 补定位
    if (
      existing.range
      && Number.isFinite(existing.range.startParagraphIndex)
      && Number.isFinite(existing.range.endParagraphIndex)
      && existing.range.endParagraphIndex >= existing.range.startParagraphIndex
    ) {
      return {
        status: "reuse_range",
        code: "duplicate_write_detected",
        message: `章节 ${params.section.title}（sectionId=${params.section.id}）已在缓存中但内容不同，将替换已有 range，禁止末尾追加。`,
        matchedBy: "runtime_section_cache",
        sectionId: params.section.id,
        expectedHash: params.textHash,
        actualHash: existingHash,
        existingRange: {
          startParagraphIndex: existing.range.startParagraphIndex,
          endParagraphIndex: existing.range.endParagraphIndex,
        },
      };
    }
    return { status: "clear" };
  }

  // revision：内容不同是预期，由 targetRange 路径处理
  return { status: "clear" };
}

function compactComparableText(value: string): string {
  return normalizeDocumentText(value)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 从索引 preview 拼出同名章节的近似正文（不发起 Word 读）。
 * 用于判断「已写完可跳过」vs「需替换 range」。
 */
function collectExistingSectionTextFromIndex(
  documentSession: DocumentSession,
  sectionTitle: string,
): { start: number; end: number; text: string } | null {
  const range = documentSession.resolveSectionRange(sectionTitle);
  if (!range) return null;
  const paragraphs = documentSession.getIndex().paragraphs
    .filter((paragraph) => paragraph.index >= range.start && paragraph.index <= range.end)
    .sort((a, b) => a.index - b.index);
  if (paragraphs.length === 0) return null;
  const text = paragraphs
    .map((paragraph) => (paragraph.preview || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    start: range.start,
    end: range.end,
    text,
  };
}

/**
 * 辅助定位（非所有权来源）：标题扫描只用于 skip / replace。
 * - 内容等价 → duplicate
 * - 内容不同/部分写入 → reuse_range
 * - 无法定位 range → clear（正常 insert）
 * 绝不因「仅有同名标题」而 conflict 吓停。
 */
function headingPresenceResult(params: {
  mode: DeterministicWriteMode;
  section: OutlineSection;
  documentSession: DocumentSession;
  text: string;
  textHash: string;
}): DuplicateWriteGuardResult {
  if (params.mode !== "new_section") return { status: "clear" };
  const sectionTitle = normalizeTitle(params.section.title);
  if (!sectionTitle) return { status: "clear" };

  const existing = collectExistingSectionTextFromIndex(params.documentSession, params.section.title);
  if (!existing) return { status: "clear" };

  const existingComparable = compactComparableText(existing.text);
  const intendedComparable = compactComparableText(
    normalizeWriteText(params.text, "markdown"),
  );
  if (!existingComparable) {
    // 仅有空壳标题/空 range：替换写入，避免再 append 出第二个同名标题
    return {
      status: "reuse_range",
      code: "duplicate_write_detected",
      message: `文档中已有同名章节标题「${params.section.title}」（p${existing.start}），将替换该 range 而非重复追加。`,
      matchedBy: "document_index_heading",
      sectionId: params.section.id,
      expectedHash: params.textHash,
      actualHash: stableTextHash(existing.text),
      existingRange: {
        startParagraphIndex: existing.start,
        endParagraphIndex: existing.end,
      },
    };
  }

  if (
    existingComparable === intendedComparable
    || stableTextHash(existingComparable) === stableTextHash(intendedComparable)
  ) {
    return {
      status: "duplicate",
      code: "duplicate_write_detected",
      message: `文档中已存在同名章节「${params.section.title}」且内容一致，跳过重复写入。`,
      matchedBy: "document_index_heading",
      sectionId: params.section.id,
      expectedHash: params.textHash,
      actualHash: stableTextHash(existing.text),
      existingRange: {
        startParagraphIndex: existing.start,
        endParagraphIndex: existing.end,
      },
    };
  }

  // 部分写入（existing 是 intended 前缀）或内容漂移：统一替换，保证高成功率
  return {
    status: "reuse_range",
    code: "duplicate_write_detected",
    message: `文档中已有同名章节「${params.section.title}」（p${existing.start}-p${existing.end}），将替换已有 range 以避免重复追加。`,
    matchedBy: "document_index_heading",
    sectionId: params.section.id,
    expectedHash: params.textHash,
    actualHash: stableTextHash(existing.text),
    existingRange: {
      startParagraphIndex: existing.start,
      endParagraphIndex: existing.end,
    },
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
    message: "目标章节 range 已经等于待修订内容，跳过重复修订写入。",
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
      // 同组不同内容：放行本次写入（fingerprint 已含内容 hash，极少撞车）。
      // 不再 hard-fail，避免用户因 ledger 边角被吓停。
      return { status: "clear" };
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

  // 精简链路：sectionId cache → 标题 range → 修订 target → ledger 幂等
  // writtenSegments 保留参数兼容调用方，不再参与误杀式 hash 匹配
  void params.writtenSegments;
  const localResult = firstBlockingResult([
    sectionCacheResult({
      mode: params.mode,
      section: params.section,
      writtenSections: params.writtenSections,
      textHash: fingerprint.textHash,
    }),
    headingPresenceResult({
      mode: params.mode,
      section: params.section,
      documentSession: params.documentSession,
      text: params.text,
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

/**
 * 仅 conflict 阻断。duplicate / reuse_range 由调用方做幂等跳过或替换写入。
 */
export function throwIfDuplicateWriteBlocked(params: {
  result: DuplicateWriteGuardResult;
  section: OutlineSection;
  harness: AgentHarnessRuntime;
  mode: DeterministicWriteMode;
}): void {
  if (params.result.status === "clear") return;
  if (params.result.status === "duplicate" || params.result.status === "reuse_range") return;

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
      guardStatus: params.result.status,
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
        guardStatus: params.result.status,
      },
    },
  );
}

export function buildSkippedDuplicateWriteResult(params: {
  operationGroupId: string;
  message: string;
}): ToolCallResult {
  return {
    id: params.operationGroupId,
    name: "insert_at_anchor",
    success: true,
    result: params.message.startsWith("跳过重复写入")
      ? params.message
      : `跳过重复写入：${params.message}`,
  };
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

/**
 * Streaming paragraph flush may produce multiple insert_at_anchor transactions
 * under one chapter write. Require at least one successful write of the expected type.
 */
export function assertWriteTransactions(params: {
  section: OutlineSection;
  toolResults: ToolCallResult[];
  expectedToolName: "insert_at_anchor" | "replace_paragraph_range" | "rewrite_paragraph";
  minCount?: number;
  maxCount?: number;
}): void {
  const minCount = params.minCount ?? 1;
  const maxCount = params.maxCount;
  const successfulWrites = params.toolResults.filter((result) =>
    result.success && result.name === params.expectedToolName
  );
  const count = successfulWrites.length;
  const tooFew = count < minCount;
  const tooMany = typeof maxCount === "number" && count > maxCount;
  if (tooFew || tooMany) {
    const boundLabel = typeof maxCount === "number"
      ? `${minCount}..${maxCount}`
      : `>= ${minCount}`;
    throw new AgentHarnessError(
      "tool_contract_violation",
      `章节 ${params.section.title} 的 ${params.expectedToolName} transaction 次数需为 ${boundLabel}，实际 ${count} 次。`,
      {
        agentId: "writer",
        details: {
          sectionId: params.section.id,
          expectedToolName: params.expectedToolName,
          successfulWriteCount: count,
          minCount,
          maxCount,
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

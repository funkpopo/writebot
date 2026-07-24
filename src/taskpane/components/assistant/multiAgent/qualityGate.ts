import { getBodyDefaultFormat, normalizeNewParagraphsFormat } from "../../../../utils/wordApi";
import {
  AgentHarnessError,
  type AgentHarnessRuntime,
} from "./agentHarness";
import { resolveWrittenSectionFromTransaction } from "./documentRuntime";
import {
  buildMemoryContextForSection,
  updateLongTermMemoryWithSection,
  type LongTermMemoryState,
} from "./longTermMemory";
import { runConsensusReview } from "./reviewConsensus";
import { buildRevisionParagraphMessage, stripSourceAnchorMarkers } from "./revisionDiff";
import type { RuntimeAgentOptions } from "./runtimeOptions";
import type { ReviewCycleOutcome, RunMetricsDraft, TrackedToolExecutor } from "./runtimeTypes";
import type { DocumentSession, ReviewContextBundle } from "./documentSession";
import {
  isReviewScoreAcceptable,
  shouldAutoReviseReviewFeedback,
} from "./qualityPolicy";
import {
  ensureSectionWriteText,
  shiftWrittenSectionRangesAfter,
  toSectionWriteRange,
  updateWrittenSectionCache,
} from "./sectionWriteFlow";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  ReviewFeedback,
  SectionFeedback,
  SectionWriteResult,
} from "./types";
import { draftRevisionSection } from "./writerAgent";
import { persistLongTermMemory } from "./checkpointRuntime";
import {
  assertSingleWriteTransaction,
  buildReplaceRangeToolCall,
  checkDuplicateWriteGuard,
  throwIfDuplicateWriteBlocked,
} from "./writerWriteGuards";

export function toRevisionFeedback(
  sectionFeedback: SectionFeedback | undefined,
  reviewFeedback: ReviewFeedback,
): string {
  const parts: string[] = [];

  if (sectionFeedback && sectionFeedback.issues.length > 0) {
    parts.push("## 审阅问题");
    parts.push(...sectionFeedback.issues.map((issue) => `- ${issue}`));
  }

  if (sectionFeedback && sectionFeedback.suggestions.length > 0) {
    parts.push("## 修改建议");
    parts.push(...sectionFeedback.suggestions.map((suggestion) => `- ${suggestion}`));
  }

  if (reviewFeedback.coherenceIssues.length > 0) {
    parts.push("## 连贯性问题");
    parts.push(...reviewFeedback.coherenceIssues.map((issue) => `- ${issue}`));
  }

  if (reviewFeedback.globalSuggestions.length > 0) {
    parts.push("## 全局优化建议");
    parts.push(...reviewFeedback.globalSuggestions.map((suggestion) => `- ${suggestion}`));
  }

  if (parts.length === 0) {
    parts.push("请在保留章节结构的前提下，提升逻辑连贯性、语言准确性与可读性。");
  }

  return parts.join("\n");
}

async function normalizeBodyFormatAfterGlobalRevision(): Promise<void> {
  const bodyFormat = await getBodyDefaultFormat();
  if (!bodyFormat) return;
  await normalizeNewParagraphsFormat(0, bodyFormat);
}

async function readCachedWrittenSectionRange(params: {
  documentSession: DocumentSession;
  harness: AgentHarnessRuntime;
  writtenSections: SectionWriteResult[];
  sectionId: string;
  sectionTitle: string;
  metadata?: Record<string, unknown>;
}) {
  const written = params.writtenSections.find((item) => item.sectionId === params.sectionId);
  if (!written?.range) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `修订前缺少已写章节的 transaction range：${params.sectionTitle}`,
      {
        agentId: "writer",
        details: {
          sectionId: params.sectionId,
          sectionTitle: params.sectionTitle,
          writtenSectionFound: Boolean(written),
        },
      },
    );
  }

  const [range] = await params.documentSession.readRanges(
    params.harness,
    {
      ranges: [{
        start: written.range.startParagraphIndex,
        end: written.range.endParagraphIndex,
      }],
      maxParagraphs: Math.max(1, written.range.paragraphCount),
    },
    {
      ...(params.metadata || {}),
      sectionId: params.sectionId,
      sectionTitle: params.sectionTitle,
      source: "written_section_range",
      cachedRange: written.range,
    },
  );
  if (!range) {
    throw new AgentHarnessError(
      "document_range_unresolved",
      `修订前缓存范围读取为空：${params.sectionTitle}`,
      {
        agentId: "writer",
        details: {
          sectionId: params.sectionId,
          sectionTitle: params.sectionTitle,
          cachedRange: written.range,
        },
      },
    );
  }

  return range;
}

function throwIfCancelled(callbacks: OrchestratorCallbacks): void {
  if (!callbacks.isRunCancelled()) return;
  throw new AgentHarnessError("cancelled", "Agent 运行已取消");
}

export function shouldTriggerQualityGate(
  feedback: ReviewFeedback,
): boolean {
  return shouldAutoReviseReviewFeedback(feedback);
}

function pickSectionsForScoreRevision(
  outline: ArticleOutline,
): string[] {
  return outline.sections.map((section) => section.id);
}

async function runConsensusReviewWithTelemetry(params: {
  outline: ArticleOutline;
  reviewBundle: ReviewContextBundle;
  round: number;
  previousFeedback?: ReviewFeedback;
  focusSectionId?: string;
  callbacks: OrchestratorCallbacks;
  runMetrics: RunMetricsDraft;
  runtimeOptions: RuntimeAgentOptions;
  harness: AgentHarnessRuntime;
}): Promise<{ feedback: ReviewFeedback; conflictCount: number; agreementRate: number }> {
  const {
    outline,
    reviewBundle,
    round,
    previousFeedback,
    focusSectionId,
    callbacks,
    runMetrics,
    runtimeOptions,
    harness,
  } = params;

  const consensus = await runConsensusReview({
    outline,
    reviewBundle,
    round,
    previousFeedback,
    focusSectionId,
    harness,
    reviewerOptions: runtimeOptions.reviewer,
    criticOptions: runtimeOptions.critic,
    arbiterOptions: runtimeOptions.arbiter,
    onChunk: callbacks.onChunk,
  });

  runMetrics.reviewRounds += 1;
  callbacks.onReviewResult(consensus.finalFeedback);
  callbacks.addChatMessage(
    `双审阅一致率 ${(consensus.agreementRate * 100).toFixed(1)}%，冲突项 ${consensus.conflictCount}。`,
    { uiOnly: true },
  );

  return {
    feedback: consensus.finalFeedback,
    conflictCount: consensus.conflictCount,
    agreementRate: consensus.agreementRate,
  };
}

export async function runGlobalReviewAndRevision(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  memory: LongTermMemoryState;
  executeToolCalls: TrackedToolExecutor;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
  harness: AgentHarnessRuntime;
  documentSession: DocumentSession;
}): Promise<ReviewCycleOutcome> {
  const {
    outline,
    callbacks,
    writtenSections,
    memory,
    executeToolCalls,
    runMetrics,
    writtenContentSegments,
    runtimeOptions,
    harness,
    documentSession,
  } = params;

  callbacks.onPhaseChange("reviewing", "正在进行全局连贯性审校...");

  const firstReviewBundle = documentSession.buildReviewContextBundle(outline, writtenSections);
  const firstReview = await runConsensusReviewWithTelemetry({
    outline,
    reviewBundle: firstReviewBundle,
    round: 1,
    callbacks,
    runMetrics,
    runtimeOptions,
    harness,
  });
  const firstFeedback = firstReview.feedback;
  runMetrics.finalReviewScore = firstFeedback.overallScore;

  throwIfCancelled(callbacks);
  const gateTriggered = shouldTriggerQualityGate(firstFeedback);
  runMetrics.qualityGateTriggered = gateTriggered;
  if (!gateTriggered) {
    runMetrics.qualityGatePassed = true;
    return { qualityGatePassed: true, needsReplan: false, revisionPerformed: false, reasons: [] };
  }

  runMetrics.qualityGatePassed = false;
  const reviseSectionIds = pickSectionsForScoreRevision(outline);
  if (reviseSectionIds.length === 0) {
    callbacks.addChatMessage(
      `全局审校未通过（${firstFeedback.overallScore}/10），但未识别到可自动修订的章节，请人工复核。`,
      { uiOnly: true },
    );
    return {
      qualityGatePassed: false,
      needsReplan: true,
      revisionPerformed: false,
      reasons: ["no_revisable_sections"],
    };
  }

  let revisionPerformed = false;

  for (const sectionId of reviseSectionIds) {
    throwIfCancelled(callbacks);
    const sectionIndex = outline.sections.findIndex((item) => item.id === sectionId);
    if (sectionIndex < 0) continue;
    const section = outline.sections[sectionIndex];
    const sectionFeedback = firstFeedback.sectionFeedback.find((item) => item.sectionId === sectionId);
    const revisionFeedback = toRevisionFeedback(sectionFeedback, firstFeedback);
    const beforeRevisionRange = await readCachedWrittenSectionRange({
      documentSession,
      harness,
      writtenSections,
      sectionId: section.id,
      sectionTitle: section.title,
      metadata: { phase: "revising", sectionId: section.id, moment: "before_revision" },
    });
    runMetrics.rangeReadCount += 1;
    const memoryContext = buildMemoryContextForSection(memory, section);

    callbacks.onPhaseChange("revising", `正在根据全局审校修改：${section.title}`);

    const rawRevisionDraft = await draftRevisionSection({
      outline,
      section,
      sectionIndex,
      onChunk: callbacks.onChunk,
      isRunCancelled: callbacks.isRunCancelled,
      harness,
      revisionFeedback,
      currentSectionContent: beforeRevisionRange.text,
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    if (!rawRevisionDraft.trim()) {
      throw new AgentHarnessError(
        "state_contract_violation",
        `Writer 修订草稿为空：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
      );
    }

    const normalizedRevisionText = ensureSectionWriteText(
      outline,
      sectionIndex,
      rawRevisionDraft,
    );
    const duplicateGuard = await checkDuplicateWriteGuard({
      mode: "revision",
      section,
      text: normalizedRevisionText,
      contentFormat: "markdown",
      documentSession,
      writtenSections,
      writtenSegments: writtenContentSegments,
      targetRange: beforeRevisionRange,
    });
    if (duplicateGuard.status !== "clear") {
      runMetrics.duplicateWriteBlockedCount += 1;
    }
    throwIfDuplicateWriteBlocked({
      result: duplicateGuard,
      section,
      harness,
      mode: "revision",
    });

    const revisionToolCall = buildReplaceRangeToolCall({
      section,
      text: normalizedRevisionText,
      targetRange: beforeRevisionRange,
      operationGroupId: duplicateGuard.fingerprint.operationGroupId,
    });
    callbacks.onToolCalls([revisionToolCall]);
    const revisionToolResults = await executeToolCalls([revisionToolCall], writtenContentSegments);
    const failedRevisionTool = revisionToolResults.find((item) => !item.success);
    if (failedRevisionTool) {
      throw new AgentHarnessError(
        "tool_batch_failed",
        failedRevisionTool.error || `章节 ${section.title} 修订写入失败`,
        {
          agentId: "writer",
          details: {
            sectionId: section.id,
            failedTool: failedRevisionTool.name,
            failedToolId: failedRevisionTool.id,
          },
        },
      );
    }
    assertSingleWriteTransaction({
      section,
      toolResults: revisionToolResults,
      expectedToolName: "replace_paragraph_range",
    });

    const { transactionIds, range: afterRevisionRange } = await resolveWrittenSectionFromTransaction({
      session: documentSession,
      harness,
      section,
      nextSection: outline.sections[sectionIndex + 1],
      toolResults: revisionToolResults,
      metadata: { phase: "revising", sectionId: section.id, moment: "after_revision" },
    });
    runMetrics.rangeReadCount += 1;
    const rawSectionContent = afterRevisionRange.text.trim();
    if (!rawSectionContent) {
      throw new AgentHarnessError(
        "document_range_unresolved",
        `修订后无法在 Word 文档中定位章节内容：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
      );
    }
    const sectionContent = stripSourceAnchorMarkers(rawSectionContent);
    const rangeDelta = afterRevisionRange.paragraphCount - beforeRevisionRange.paragraphCount;
    shiftWrittenSectionRangesAfter(
      writtenSections,
      beforeRevisionRange.endParagraphIndex,
      rangeDelta,
      section.id,
    );

    runMetrics.revisedSections.add(section.id);
    revisionPerformed = true;
    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
      writtenSections.find((item) => item.sectionId === section.id)?.sourceAnchors || [],
      toSectionWriteRange(afterRevisionRange, transactionIds),
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);

    if (sectionContent) {
      const beforeText = stripSourceAnchorMarkers(beforeRevisionRange.text);
      const revisionDiffMessage = buildRevisionParagraphMessage(
        section.title,
        beforeText,
        sectionContent,
      );
      callbacks.addChatMessage(
        `已完成全局审校修订：${section.title}。\n\n${revisionDiffMessage}`,
        { uiOnly: true },
      );
    }
  }

  await normalizeBodyFormatAfterGlobalRevision();

  throwIfCancelled(callbacks);
  callbacks.onPhaseChange("reviewing", "正在进行二次全局审校...");

  const secondReviewBundle = documentSession.buildReviewContextBundle(
    outline,
    writtenSections,
    Array.from(runMetrics.revisedSections),
  );
  const secondReview = await runConsensusReviewWithTelemetry({
    outline,
    reviewBundle: secondReviewBundle,
    round: 2,
    previousFeedback: firstFeedback,
    callbacks,
    runMetrics,
    runtimeOptions,
    harness,
  });
  const secondFeedback = secondReview.feedback;
  runMetrics.finalReviewScore = secondFeedback.overallScore;
  throwIfCancelled(callbacks);

  const replanReasons: string[] = [];
  if (!isReviewScoreAcceptable(secondFeedback.overallScore)) {
    replanReasons.push("score_below_4");
  }

  if (shouldTriggerQualityGate(secondFeedback)) {
    callbacks.addChatMessage(
      `全局质量门控仍未通过：${secondFeedback.overallScore}/10，请人工复核重点章节。`,
      { uiOnly: true },
    );
    runMetrics.qualityGatePassed = false;
  } else {
    runMetrics.qualityGatePassed = true;
  }
  return {
    qualityGatePassed: runMetrics.qualityGatePassed,
    needsReplan: replanReasons.length > 0 && !runMetrics.qualityGatePassed,
    revisionPerformed,
    reasons: replanReasons,
  };
}

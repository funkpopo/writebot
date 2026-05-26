import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import { getBodyDefaultFormat, normalizeNewParagraphsFormat } from "../../../../utils/wordApi";
import {
  AgentHarnessError,
  type AgentHarnessRuntime,
} from "./agentHarness";
import {
  buildMemoryContextForSection,
  updateLongTermMemoryWithSection,
  type LongTermMemoryState,
} from "./longTermMemory";
import { runConsensusReview } from "./reviewConsensus";
import { buildRevisionParagraphMessage, stripSourceAnchorMarkers } from "./revisionDiff";
import type { RuntimeAgentOptions } from "./runtimeOptions";
import type { ReviewCycleOutcome, RunMetricsDraft, TrackedToolExecutor } from "./runtimeTypes";
import { resolveSectionContent } from "./sectionMemory";
import { updateWrittenSectionCache } from "./sectionWriteFlow";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  ReviewFeedback,
  SectionFeedback,
  SectionWriteResult,
  VerificationFeedback,
} from "./types";
import { verifySectionFacts } from "./verifierAgent";
import { writeSection } from "./writerAgent";
import { readDocumentText } from "./documentRuntime";
import { persistLongTermMemory } from "./checkpointRuntime";

export function toRevisionFeedback(
  sectionFeedback: SectionFeedback | undefined,
  reviewFeedback: ReviewFeedback,
  verificationFeedback?: VerificationFeedback,
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

  if (verificationFeedback) {
    const failedClaims = verificationFeedback.claims.filter((item) => item.verdict === "fail");
    const anchors = verificationFeedback.claims.flatMap((item) => item.sourceAnchors).filter(Boolean);
    if (failedClaims.length > 0) {
      parts.push("## 事实核验未通过项");
      for (const item of failedClaims) {
        const reason = item.reason ? `（原因：${item.reason}）` : "";
        parts.push(`- ${item.claim}${reason}`);
      }
    }
    if (anchors.length > 0) {
      parts.push("## 关键结论来源锚点");
      for (const anchor of Array.from(new Set(anchors))) {
        parts.push(`- ${anchor}`);
      }
      parts.push("请先删除该章节内已有的旧来源锚点标记（如 [来源锚点: p3]），再按新内容仅保留仍有效的锚点。");
    }
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

export function collectSourceAnchors(feedback: VerificationFeedback | undefined): string[] {
  if (!feedback) return [];
  const anchors = feedback.claims.flatMap((item) => item.sourceAnchors);
  return Array.from(new Set(anchors.filter((anchor) => anchor.trim().length > 0)));
}

function throwIfCancelled(callbacks: OrchestratorCallbacks): void {
  if (!callbacks.isRunCancelled()) return;
  throw new AgentHarnessError("cancelled", "Agent 运行已取消");
}

export async function runFactVerification(params: {
  outline: ArticleOutline;
  sectionId: string;
  sectionText: string;
  callbacks: OrchestratorCallbacks;
  runtimeOptions: RuntimeAgentOptions;
  harness: AgentHarnessRuntime;
}): Promise<VerificationFeedback> {
  const { outline, sectionId, sectionText, callbacks, runtimeOptions, harness } = params;
  const section = outline.sections.find((item) => item.id === sectionId);
  if (!section) {
    throw new AgentHarnessError(
      "state_contract_violation",
      `事实核验失败：大纲中不存在章节 ${sectionId}`,
      { agentId: "verifier", details: { sectionId } },
    );
  }

  callbacks.onPhaseChange("reviewing", `正在进行事实核验：${section.title}`);
  const feedback = await verifySectionFacts({
    section,
    sectionText,
    declarationPoints: section.keyPoints,
    harness,
    aiOptions: runtimeOptions.verifier,
  });

  const failedClaims = feedback.claims.filter((item) => item.verdict === "fail");
  if (failedClaims.length > 0) {
    callbacks.addChatMessage(
      `事实核验未通过：${section.title}（${failedClaims.length} 条结论证据不足或缺少来源锚点）。`,
      { uiOnly: true },
    );
  } else {
    callbacks.addChatMessage(
      `事实核验通过：${section.title}（已生成 ${collectSourceAnchors(feedback).length} 个来源锚点）。`,
      { uiOnly: true },
    );
  }
  return feedback;
}

function shouldTriggerQualityGate(
  feedback: ReviewFeedback,
): boolean {
  if (feedback.sectionFeedback.some((item) => item.needsRevision)) return true;
  return feedback.coherenceIssues.length > 0;
}

function pickSectionsForGlobalRevision(
  outline: ArticleOutline,
  feedback: ReviewFeedback,
): string[] {
  const sectionIds = new Set<string>();

  for (const sectionFeedback of feedback.sectionFeedback) {
    if (sectionFeedback.needsRevision || sectionFeedback.issues.length > 0 || sectionFeedback.suggestions.length > 0) {
      sectionIds.add(sectionFeedback.sectionId);
    }
  }

  if (sectionIds.size === 0 && (feedback.coherenceIssues.length > 0 || feedback.globalSuggestions.length > 0)) {
    for (const section of outline.sections) {
      sectionIds.add(section.id);
    }
  }

  return outline.sections
    .filter((section) => sectionIds.has(section.id))
    .map((section) => section.id);
}

async function runConsensusReviewWithTelemetry(params: {
  outline: ArticleOutline;
  documentText: string;
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
    documentText,
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
    documentText,
    round,
    previousFeedback,
    focusSectionId,
    harness,
    reviewerOptions: runtimeOptions.reviewer,
    criticOptions: runtimeOptions.critic,
    arbiterOptions: runtimeOptions.arbiter,
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
  } = params;

  callbacks.onPhaseChange("reviewing", "正在进行全局连贯性审校...");

  let docText = await readDocumentText(harness, { phase: "reviewing", moment: "first_review" });
  const firstReview = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 1,
    callbacks,
    runMetrics,
    runtimeOptions,
    harness,
  });
  const firstFeedback = firstReview.feedback;
  runMetrics.finalReviewScore = firstFeedback.overallScore;
  const verificationBySectionId = new Map<string, VerificationFeedback>();
  for (const section of writtenSections) {
    throwIfCancelled(callbacks);
    const verification = await runFactVerification({
      outline,
      sectionId: section.sectionId,
      sectionText: section.content,
      callbacks,
      runtimeOptions,
      harness,
    });
    verificationBySectionId.set(section.sectionId, verification);
  }

  throwIfCancelled(callbacks);
  const verifierGateTriggered = Array.from(verificationBySectionId.values()).some(
    (item) => item.verdict === "fail",
  );
  const gateTriggered = shouldTriggerQualityGate(firstFeedback) || verifierGateTriggered;
  runMetrics.qualityGateTriggered = gateTriggered;
  for (const section of writtenSections) {
    const verification = verificationBySectionId.get(section.sectionId);
    updateWrittenSectionCache(
      writtenSections,
      section.sectionId,
      section.sectionTitle,
      section.content,
      collectSourceAnchors(verification),
    );
  }
  if (!gateTriggered) {
    runMetrics.qualityGatePassed = true;
    return { qualityGatePassed: true, needsReplan: false, reasons: [] };
  }

  runMetrics.qualityGatePassed = false;
  const reviseSectionIds = Array.from(new Set([
    ...pickSectionsForGlobalRevision(outline, firstFeedback),
    ...Array.from(verificationBySectionId.entries())
      .filter(([, feedback]) => feedback.verdict === "fail")
      .map(([sectionId]) => sectionId),
  ]));
  if (reviseSectionIds.length === 0) {
    callbacks.addChatMessage(
      `全局审校未通过（${firstFeedback.overallScore}/10），但未识别到可自动修订的章节，请人工复核。`,
      { uiOnly: true },
    );
    return { qualityGatePassed: false, needsReplan: true, reasons: ["no_revisable_sections"] };
  }

  for (const sectionId of reviseSectionIds) {
    throwIfCancelled(callbacks);
    const sectionIndex = outline.sections.findIndex((item) => item.id === sectionId);
    if (sectionIndex < 0) continue;
    const section = outline.sections[sectionIndex];
    const sectionFeedback = firstFeedback.sectionFeedback.find((item) => item.sectionId === sectionId);
    const verificationFeedback = verificationBySectionId.get(sectionId);
    const revisionFeedback = toRevisionFeedback(sectionFeedback, firstFeedback, verificationFeedback);
    const beforeRevisionText = await readDocumentText(
      harness,
      { phase: "revising", sectionId: section.id, moment: "before_revision" },
    );
    const beforeSectionContent = resolveSectionContent({
      previousDocumentText: "",
      currentDocumentText: beforeRevisionText,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(sectionIndex + 1).map((item) => item.title),
    }).content.trim();
    const memoryContext = buildMemoryContextForSection(memory, section);

    callbacks.onPhaseChange("revising", `正在根据全局审校修改：${section.title}`);

    await writeSection({
      outline,
      section,
      sectionIndex,
      previousSections: writtenSections,
      allTools: TOOL_DEFINITIONS,
      onChunk: callbacks.onChunk,
      executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      harness,
      revisionFeedback,
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    runMetrics.revisedSections.add(section.id);

    const afterRevisionText = await readDocumentText(
      harness,
      { phase: "revising", sectionId: section.id, moment: "after_revision" },
    );
    const rawSectionContent = resolveSectionContent({
      previousDocumentText: beforeRevisionText,
      currentDocumentText: afterRevisionText,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(sectionIndex + 1).map((item) => item.title),
    }).content.trim();
    if (!rawSectionContent) {
      throw new AgentHarnessError(
        "state_contract_violation",
        `修订后无法在 Word 文档中定位章节内容：${section.title}`,
        { agentId: "writer", details: { sectionId: section.id, sectionIndex } },
      );
    }
    const sectionContent = stripSourceAnchorMarkers(rawSectionContent);

    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
      collectSourceAnchors(verificationFeedback),
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);

    if (sectionContent) {
      const revisionParagraphMessage = buildRevisionParagraphMessage(
        section.title,
        beforeSectionContent,
        sectionContent,
      );
      callbacks.addChatMessage(
        `已完成全局审校修订：${section.title}。`,
        { uiOnly: true },
      );
      callbacks.onDocumentSnapshot(revisionParagraphMessage, `${section.title} 修订段落`);
    }
  }

  await normalizeBodyFormatAfterGlobalRevision();

  throwIfCancelled(callbacks);
  callbacks.onPhaseChange("reviewing", "正在进行二次全局审校...");

  docText = await readDocumentText(harness, { phase: "reviewing", moment: "second_review" });
  const secondReview = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 2,
    previousFeedback: firstFeedback,
    callbacks,
    runMetrics,
    runtimeOptions,
    harness,
  });
  const secondFeedback = secondReview.feedback;
  runMetrics.finalReviewScore = secondFeedback.overallScore;
  let secondVerifyFailed = false;
  for (const section of writtenSections) {
    throwIfCancelled(callbacks);
    const verification = await runFactVerification({
      outline,
      sectionId: section.sectionId,
      sectionText: section.content,
      callbacks,
      runtimeOptions,
      harness,
    });
    if (verification.verdict === "fail") {
      secondVerifyFailed = true;
    }
    updateWrittenSectionCache(
      writtenSections,
      section.sectionId,
      section.sectionTitle,
      section.content,
      collectSourceAnchors(verification),
    );
  }

  const replanReasons: string[] = [];
  if (secondFeedback.overallScore <= 7) {
    replanReasons.push("low_score");
  }
  const conflictThreshold = Math.max(1, Math.ceil(outline.sections.length / 3));
  if (secondReview.conflictCount >= conflictThreshold) {
    replanReasons.push("high_conflict");
  }
  if (secondVerifyFailed) {
    replanReasons.push("insufficient_evidence");
  }

  if (shouldTriggerQualityGate(secondFeedback) || secondVerifyFailed) {
    callbacks.addChatMessage(
      `全局质量门控仍未通过：${secondFeedback.overallScore}/10（含事实核验），请人工复核重点章节。`,
      { uiOnly: true },
    );
    runMetrics.qualityGatePassed = false;
  } else {
    runMetrics.qualityGatePassed = true;
  }
  return {
    qualityGatePassed: runMetrics.qualityGatePassed,
    needsReplan: replanReasons.length > 0 && !runMetrics.qualityGatePassed,
    reasons: replanReasons,
  };
}

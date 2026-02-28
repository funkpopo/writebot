import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import {
  getAIConfig,
  type AIRequestOptions,
} from "../../../../utils/aiService";
import {
  clearAgentCheckpoint,
  getDefaultParallelSectionConcurrency,
  loadAgentCheckpoint,
  loadAgentMemory,
  saveAgentCheckpoint,
  saveAgentMemory,
} from "../../../../utils/storageService";
import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import { getDocumentText } from "../../../../utils/wordApi";
import {
  buildMemoryContextForSection,
  createLongTermMemory,
  mergeLongTermMemory,
  parseLongTermMemoryMarkdown,
  renderLongTermMemoryMarkdown,
  updateLongTermMemoryWithSection,
  type LongTermMemoryState,
} from "./longTermMemory";
import {
  appendPipelineMetrics,
  buildPipelineMetricsDashboard,
  type PipelineRunMetrics,
} from "./pipelineMetrics";
import { generateOutline } from "./plannerAgent";
import { runConsensusReview } from "./reviewConsensus";
import { resolveSectionContent } from "./sectionMemory";
import { verifySectionFacts } from "./verifierAgent";
import { draftSection, writeSection } from "./writerAgent";
import { runTaskGraph, type TaskGraphNode } from "./taskGraph";
import type {
  ArticleOutline,
  OutlineSection,
  OrchestratorCallbacks,
  ReviewFeedback,
  SectionFeedback,
  SectionWriteResult,
  VerificationFeedback,
} from "./types";

interface RuntimeAgentOptions {
  planner: AIRequestOptions | undefined;
  writer: AIRequestOptions | undefined;
  reviewer: AIRequestOptions | undefined;
  critic: AIRequestOptions | undefined;
  arbiter: AIRequestOptions | undefined;
  verifier: AIRequestOptions | undefined;
  parallelSectionConcurrency: number;
}

function normalizeTemperature(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(2, Math.max(0, value));
}

function normalizeParallelSectionConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return getDefaultParallelSectionConcurrency();
  }
  const normalized = Math.floor(value);
  return Math.min(6, Math.max(1, normalized));
}

function createAgentRequestOptions(
  model: string | undefined,
  temperature: number | undefined,
): AIRequestOptions | undefined {
  const options: AIRequestOptions = {};
  const trimmedModel = model?.trim();
  if (trimmedModel) {
    options.model = trimmedModel;
  }
  const normalizedTemperature = normalizeTemperature(temperature);
  if (normalizedTemperature !== undefined) {
    options.temperature = normalizedTemperature;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function cloneOptionsWithTemperature(
  options: AIRequestOptions | undefined,
  fallbackTemperature: number,
): AIRequestOptions | undefined {
  const cloned = { ...(options || {}) };
  if (typeof cloned.temperature !== "number") {
    cloned.temperature = fallbackTemperature;
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function getRuntimeAgentOptions(): RuntimeAgentOptions {
  const config = getAIConfig();
  const reviewer = createAgentRequestOptions(config.reviewerModel, config.reviewerTemperature);

  return {
    planner: createAgentRequestOptions(config.plannerModel, config.plannerTemperature),
    writer: createAgentRequestOptions(config.writerModel, config.writerTemperature),
    reviewer,
    critic: cloneOptionsWithTemperature(reviewer, 0.35),
    arbiter: cloneOptionsWithTemperature(reviewer, 0),
    verifier: cloneOptionsWithTemperature(reviewer, 0),
    parallelSectionConcurrency: normalizeParallelSectionConcurrency(config.parallelSectionConcurrency),
  };
}

async function safeGetDocumentText(fallback = ""): Promise<string> {
  try {
    return await getDocumentText();
  } catch {
    return fallback;
  }
}

async function hydrateLongTermMemoryFromPersistence(
  memory: LongTermMemoryState,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  try {
    const persisted = await loadAgentMemory();
    if (!persisted?.content?.trim()) return;
    const parsed = parseLongTermMemoryMarkdown(persisted.content);
    if (!parsed) {
      callbacks.addChatMessage(
        "检测到历史 memory.md，但无法解析 Snapshot，已跳过历史记忆加载。",
        { uiOnly: true },
      );
      return;
    }
    mergeLongTermMemory(memory, parsed);
    callbacks.addChatMessage(`已加载历史记忆：${persisted.path}`, { uiOnly: true });
  } catch (error) {
    console.error("加载长期记忆失败:", error);
  }
}

async function persistLongTermMemory(
  memory: LongTermMemoryState,
): Promise<void> {
  const markdown = renderLongTermMemoryMarkdown(memory);
  await saveAgentMemory({ content: markdown });
}

interface RunMetricsDraft {
  runId: string;
  startedAt: string;
  startMs: number;
  totalSections: number;
  revisedSections: Set<string>;
  reviewRounds: number;
  toolCalls: number;
  toolFailures: number;
  duplicateWriteSkips: number;
  qualityGateTriggered: boolean;
  qualityGatePassed: boolean;
  finalReviewScore: number | null;
}

interface ReviewCycleOutcome {
  qualityGatePassed: boolean;
  needsReplan: boolean;
  reasons: string[];
}

interface PipelineRuntimeState {
  runId: string;
  request: string;
  outline: ArticleOutline | null;
  documentContext: string;
  memory: LongTermMemoryState | null;
  writtenSections: SectionWriteResult[];
  writtenContentSegments: string[];
  runMetrics: RunMetricsDraft | null;
  reviewCycleCount: number;
  maxReviewCycles: number;
  shouldStop: boolean;
  completed: boolean;
}

function createRunMetricsDraft(totalSections: number, runId?: string): RunMetricsDraft {
  return {
    runId: runId || `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    startMs: Date.now(),
    totalSections,
    revisedSections: new Set<string>(),
    reviewRounds: 0,
    toolCalls: 0,
    toolFailures: 0,
    duplicateWriteSkips: 0,
    qualityGateTriggered: false,
    qualityGatePassed: true,
    finalReviewScore: null,
  };
}

function finalizeRunMetrics(draft: RunMetricsDraft): PipelineRunMetrics {
  return {
    runId: draft.runId,
    startedAt: draft.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - draft.startMs),
    totalSections: draft.totalSections,
    revisedSections: draft.revisedSections.size,
    reviewRounds: draft.reviewRounds,
    toolCalls: draft.toolCalls,
    toolFailures: draft.toolFailures,
    duplicateWriteSkips: draft.duplicateWriteSkips,
    qualityGateTriggered: draft.qualityGateTriggered,
    qualityGatePassed: draft.qualityGatePassed,
    finalReviewScore: draft.finalReviewScore,
  };
}

function createTrackedToolExecutor(
  callbacks: OrchestratorCallbacks,
  runMetrics: RunMetricsDraft,
): (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]> {
  return async (toolCalls, writtenSegments) => {
    runMetrics.toolCalls += toolCalls.length;
    const results = await callbacks.executeToolCalls(toolCalls, writtenSegments);

    for (const result of results) {
      if (!result.success) {
        runMetrics.toolFailures += 1;
        continue;
      }
      const text = typeof result.result === "string" ? result.result : "";
      if (text.includes("跳过重复写入")) {
        runMetrics.duplicateWriteSkips += 1;
      }
    }

    return results;
  };
}

function toRevisionFeedback(
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
      parts.push("请确保关键结论附近显式附带可追溯来源锚点（如 [来源锚点: p3]）。");
    }
  }

  if (parts.length === 0) {
    parts.push("请在保留章节结构的前提下，提升逻辑连贯性、语言准确性与可读性。");
  }

  return parts.join("\n");
}

function collectSourceAnchors(feedback: VerificationFeedback | undefined): string[] {
  if (!feedback) return [];
  const anchors = feedback.claims.flatMap((item) => item.sourceAnchors);
  return Array.from(new Set(anchors.filter((anchor) => anchor.trim().length > 0)));
}

async function runFactVerification(params: {
  outline: ArticleOutline;
  sectionId: string;
  sectionText: string;
  callbacks: OrchestratorCallbacks;
  runtimeOptions: RuntimeAgentOptions;
}): Promise<VerificationFeedback> {
  const { outline, sectionId, sectionText, callbacks, runtimeOptions } = params;
  const section = outline.sections.find((item) => item.id === sectionId);
  if (!section) {
    return { verdict: "fail", claims: [], evidence: [] };
  }

  callbacks.onPhaseChange("reviewing", `正在进行事实核验：${section.title}`);
  const feedback = await verifySectionFacts({
    section,
    sectionText,
    declarationPoints: section.keyPoints,
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

function updateWrittenSectionCache(
  writtenSections: SectionWriteResult[],
  sectionId: string,
  sectionTitle: string,
  content: string,
  sourceAnchors: string[] = [],
): void {
  const index = writtenSections.findIndex((item) => item.sectionId === sectionId);
  if (index >= 0) {
    writtenSections[index] = { sectionId, sectionTitle, content, sourceAnchors };
    return;
  }
  writtenSections.push({ sectionId, sectionTitle, content, sourceAnchors });
}

function ensureSectionWriteText(
  outline: ArticleOutline,
  sectionIndex: number,
  rawContent: string,
): string {
  const section = outline.sections[sectionIndex];
  const trimmed = rawContent.trim();
  const hasDocTitle = new RegExp(`^\\s*#\\s+${escapeRegExp(outline.title)}\\s*$`, "m").test(trimmed);
  const hasSectionHeading = new RegExp(`^\\s*##\\s+${escapeRegExp(section.title)}\\s*$`, "m").test(trimmed);

  let normalized = trimmed;
  if (sectionIndex === 0) {
    if (!hasDocTitle) {
      normalized = `# ${outline.title}\n\n${normalized}`;
    }
    if (!hasSectionHeading) {
      const withoutLeadingTitle = normalized
        .replace(new RegExp(`^\\s*#\\s+${escapeRegExp(outline.title)}\\s*`, "m"), "")
        .trim();
      normalized = `# ${outline.title}\n\n## ${section.title}\n\n${withoutLeadingTitle}`;
    }
  } else if (!hasSectionHeading) {
    normalized = `## ${section.title}\n\n${normalized}`;
  }

  return `${normalized.trimEnd()}\n\n`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOutlineSection(value: unknown): value is OutlineSection {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.level === "number"
    && typeof item.description === "string"
    && Array.isArray(item.keyPoints)
    && typeof item.estimatedParagraphs === "number";
}

function isArticleOutline(value: unknown): value is ArticleOutline {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === "string"
    && typeof item.theme === "string"
    && typeof item.targetAudience === "string"
    && typeof item.style === "string"
    && Array.isArray(item.sections)
    && item.sections.every((section) => isOutlineSection(section))
    && typeof item.totalEstimatedParagraphs === "number";
}

function normalizeWrittenSections(value: unknown): SectionWriteResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        sectionId: typeof record.sectionId === "string" ? record.sectionId : "",
        sectionTitle: typeof record.sectionTitle === "string" ? record.sectionTitle : "",
        content: typeof record.content === "string" ? record.content : "",
        sourceAnchors: Array.isArray(record.sourceAnchors)
          ? record.sourceAnchors.filter((anchor): anchor is string => typeof anchor === "string")
          : [],
      };
    })
    .filter((item) => item.sectionId && item.sectionTitle);
}

async function persistPipelineCheckpoint(
  nodeId: string,
  status: "running" | "completed" | "error" | "cancelled",
  state: PipelineRuntimeState,
): Promise<void> {
  await saveAgentCheckpoint({
    checkpoint: {
      runId: state.runId,
      request: state.request,
      nodeId,
      loopCount: state.reviewCycleCount,
      status,
      outline: state.outline || undefined,
      writtenSections: state.writtenSections,
      updatedAt: new Date().toISOString(),
    },
    memorySnapshot: state.memory || undefined,
  });
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
  } = params;

  const consensus = await runConsensusReview({
    outline,
    documentText,
    round,
    previousFeedback,
    focusSectionId,
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

async function appendSectionDraftToDocument(
  sectionContent: string,
  sectionId: string,
  callbacks: OrchestratorCallbacks,
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>,
  writtenContentSegments: string[],
): Promise<void> {
  const toolCall: ToolCallRequest = {
    id: `parallel_append_${sectionId}_${Date.now().toString(36)}`,
    name: "append_text",
    arguments: { text: sectionContent },
  };

  callbacks.onToolCalls([toolCall]);
  const results = await executeToolCalls([toolCall], writtenContentSegments);
  const failed = results.find((item) => !item.success);
  if (failed) {
    throw new Error(failed.error || `章节 ${sectionId} 写入失败`);
  }
}

async function runGlobalReviewAndRevision(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  memory: LongTermMemoryState;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
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
  } = params;

  callbacks.onPhaseChange("reviewing", "正在进行全局连贯性审校...");

  let docText = await safeGetDocumentText(
    writtenSections.map((section) => section.content).join("\n\n")
  );
  const firstReview = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 1,
    callbacks,
    runMetrics,
    runtimeOptions,
  });
  const firstFeedback = firstReview.feedback;
  runMetrics.finalReviewScore = firstFeedback.overallScore;
  const verificationBySectionId = new Map<string, VerificationFeedback>();
  for (const section of writtenSections) {
    if (callbacks.isRunCancelled()) {
      return { qualityGatePassed: false, needsReplan: false, reasons: ["cancelled"] };
    }
    const verification = await runFactVerification({
      outline,
      sectionId: section.sectionId,
      sectionText: section.content,
      callbacks,
      runtimeOptions,
    });
    verificationBySectionId.set(section.sectionId, verification);
  }

  if (callbacks.isRunCancelled()) {
    return { qualityGatePassed: false, needsReplan: false, reasons: ["cancelled"] };
  }
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
    if (callbacks.isRunCancelled()) {
      return { qualityGatePassed: false, needsReplan: false, reasons: ["cancelled"] };
    }
    const sectionIndex = outline.sections.findIndex((item) => item.id === sectionId);
    if (sectionIndex < 0) continue;
    const section = outline.sections[sectionIndex];
    const sectionFeedback = firstFeedback.sectionFeedback.find((item) => item.sectionId === sectionId);
    const verificationFeedback = verificationBySectionId.get(sectionId);
    const revisionFeedback = toRevisionFeedback(sectionFeedback, firstFeedback, verificationFeedback);
    const beforeRevisionText = await safeGetDocumentText();
    const memoryContext = buildMemoryContextForSection(memory, section);

    callbacks.onPhaseChange("revising", `正在根据全局审校修改：${section.title}`);

    const revisionResult = await writeSection({
      outline,
      section,
      sectionIndex,
      previousSections: writtenSections,
      allTools: TOOL_DEFINITIONS,
      onChunk: callbacks.onChunk,
      executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      revisionFeedback,
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    runMetrics.revisedSections.add(section.id);

    const afterRevisionText = await safeGetDocumentText(revisionResult.assistantContent);
    const sectionContent = resolveSectionContent({
      previousDocumentText: beforeRevisionText,
      currentDocumentText: afterRevisionText,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(sectionIndex + 1).map((item) => item.title),
    }).content.trim() || revisionResult.assistantContent.trim();

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
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 修订完成`);
    }
  }

  if (callbacks.isRunCancelled()) {
    return { qualityGatePassed: false, needsReplan: false, reasons: ["cancelled"] };
  }
  callbacks.onPhaseChange("reviewing", "正在进行二次全局审校...");

  docText = await safeGetDocumentText(
    writtenSections.map((section) => section.content).join("\n\n")
  );
  const secondReview = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 2,
    previousFeedback: firstFeedback,
    callbacks,
    runMetrics,
    runtimeOptions,
  });
  const secondFeedback = secondReview.feedback;
  runMetrics.finalReviewScore = secondFeedback.overallScore;
  let secondVerifyFailed = false;
  for (const section of writtenSections) {
    if (callbacks.isRunCancelled()) {
      return { qualityGatePassed: false, needsReplan: false, reasons: ["cancelled"] };
    }
    const verification = await runFactVerification({
      outline,
      sectionId: section.sectionId,
      sectionText: section.content,
      callbacks,
      runtimeOptions,
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

async function runParallelDraftAndWrite(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  completedSectionIds?: Set<string>;
  memory: LongTermMemoryState;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    completedSectionIds,
    memory,
    executeToolCalls,
    runMetrics,
    writtenContentSegments,
    runtimeOptions,
    onSectionPersisted,
  } = params;

  const total = outline.sections.length;
  callbacks.onPhaseChange("writing", `正在并行生成 ${total} 个章节草稿...`);
  const completed = completedSectionIds || new Set<string>();

  const drafts = new Array<string>(total).fill("");
  let cursor = 0;

  const workerCount = Math.min(total, runtimeOptions.parallelSectionConcurrency);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (callbacks.isRunCancelled()) return;
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= total) return;

      const section = outline.sections[currentIndex];
      if (completed.has(section.id)) {
        drafts[currentIndex] = "";
        continue;
      }
      const memoryContext = buildMemoryContextForSection(memory, section);
      drafts[currentIndex] = await draftSection({
        outline,
        section,
        sectionIndex: currentIndex,
        memoryContext,
        isRunCancelled: callbacks.isRunCancelled,
        aiOptions: runtimeOptions.writer,
      });
    }
  });

  await Promise.all(workers);
  if (callbacks.isRunCancelled()) return;

  for (let i = 0; i < outline.sections.length; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    callbacks.onSectionStart(i, total, section.title);
    callbacks.onPhaseChange("writing", `正在写入 ${i + 1}/${total}：${section.title}`);

    const beforeWriteText = await safeGetDocumentText();
    const normalizedSectionText = ensureSectionWriteText(
      outline,
      i,
      drafts[i] || section.description || "",
    );
    await appendSectionDraftToDocument(
      normalizedSectionText,
      section.id,
      callbacks,
      executeToolCalls,
      writtenContentSegments,
    );

    const afterWriteText = await safeGetDocumentText(normalizedSectionText);
    const resolvedSectionContent = resolveSectionContent({
      previousDocumentText: beforeWriteText,
      currentDocumentText: afterWriteText,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(i + 1).map((item) => item.title),
    });
    const sectionContent = resolvedSectionContent.content.trim() || normalizedSectionText.trim();

    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);
    if (onSectionPersisted) {
      await onSectionPersisted();
    }

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }
}

async function runSequentialSectionFlow(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  completedSectionIds?: Set<string>;
  memory: LongTermMemoryState;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    completedSectionIds,
    memory,
    executeToolCalls,
    runMetrics,
    writtenContentSegments,
    runtimeOptions,
    onSectionPersisted,
  } = params;

  const total = outline.sections.length;
  const completed = completedSectionIds || new Set<string>();
  for (let i = 0; i < total; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    if (completed.has(section.id)) {
      callbacks.onSectionStart(i, total, section.title);
      callbacks.onSectionDone(i, total, section.title);
      continue;
    }
    const memoryContext = buildMemoryContextForSection(memory, section);
    const sectionDocumentBeforeWrite = await safeGetDocumentText();
    callbacks.onSectionStart(i, total, section.title);
    callbacks.onPhaseChange("writing", `正在撰写 ${i + 1}/${total}：${section.title}`);

    const result = await writeSection({
      outline,
      section,
      sectionIndex: i,
      previousSections: writtenSections,
      allTools: TOOL_DEFINITIONS,
      onChunk: callbacks.onChunk,
      executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      memoryContext,
      aiOptions: runtimeOptions.writer,
    });
    let latestAssistantContent = result.assistantContent;

    if (callbacks.isRunCancelled()) return;
    callbacks.onPhaseChange("reviewing", `正在审阅：${section.title}`);

    const docText = await safeGetDocumentText(result.assistantContent);
    const reviewResult = await runConsensusReviewWithTelemetry({
      outline,
      documentText: docText,
      round: 1,
      focusSectionId: section.id,
      callbacks,
      runMetrics,
      runtimeOptions,
    });
    const feedback = reviewResult.feedback;

    const sectionFeedback = feedback.sectionFeedback.find((item) => item.sectionId === section.id);
    const documentForVerification = await safeGetDocumentText(latestAssistantContent);
    const resolvedForVerification = resolveSectionContent({
      previousDocumentText: sectionDocumentBeforeWrite,
      currentDocumentText: documentForVerification,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(i + 1).map((item) => item.title),
    });
    const sectionTextForVerification = resolvedForVerification.content.trim() || latestAssistantContent.trim();
    const verificationFeedback = await runFactVerification({
      outline,
      sectionId: section.id,
      sectionText: sectionTextForVerification,
      callbacks,
      runtimeOptions,
    });
    const needsRevision = Boolean(sectionFeedback?.needsRevision || verificationFeedback.verdict === "fail");
    if (needsRevision) {
      callbacks.onPhaseChange("revising", `正在修改：${section.title}`);
      const revisionResult = await writeSection({
        outline,
        section,
        sectionIndex: i,
        previousSections: writtenSections,
        allTools: TOOL_DEFINITIONS,
        onChunk: callbacks.onChunk,
        executeToolCalls,
        writtenContentSegments,
        isRunCancelled: callbacks.isRunCancelled,
        revisionFeedback: toRevisionFeedback(sectionFeedback, feedback, verificationFeedback),
        memoryContext: buildMemoryContextForSection(memory, section),
        aiOptions: runtimeOptions.writer,
      });
      runMetrics.revisedSections.add(section.id);
      latestAssistantContent = revisionResult.assistantContent || latestAssistantContent;
    }

    const documentAfterSection = await safeGetDocumentText(latestAssistantContent);
    const resolvedSectionContent = resolveSectionContent({
      previousDocumentText: sectionDocumentBeforeWrite,
      currentDocumentText: documentAfterSection,
      currentSectionTitle: section.title,
      nextSectionTitles: outline.sections.slice(i + 1).map((item) => item.title),
    });
    const sectionContent = resolvedSectionContent.content.trim() || latestAssistantContent.trim();

    updateWrittenSectionCache(
      writtenSections,
      section.id,
      section.title,
      sectionContent,
      collectSourceAnchors(verificationFeedback),
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);
    if (onSectionPersisted) {
      await onSectionPersisted();
    }

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }
}

/**
 * Main multi-agent pipeline:
 * Planner → Writer(Parallel Draft/Sequential Tool Write) → Reviewer(LLM Quality Gate) → Reviser.
 */
export async function runMultiAgentPipeline(
  userRequirement: string,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const runtimeOptions = getRuntimeAgentOptions();
  const documentContext = await safeGetDocumentText();
  const checkpoint = await loadAgentCheckpoint();
  const canResume = checkpoint
    && checkpoint.checkpoint.request === userRequirement
    && checkpoint.checkpoint.status === "running"
    && isArticleOutline(checkpoint.checkpoint.outline);
  const resumedRunId = canResume
    ? checkpoint.checkpoint.runId
    : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const state: PipelineRuntimeState = {
    runId: resumedRunId,
    request: userRequirement,
    outline: canResume ? (checkpoint!.checkpoint.outline as ArticleOutline) : null,
    documentContext,
    memory: null,
    writtenSections: canResume ? normalizeWrittenSections(checkpoint?.checkpoint.writtenSections) : [],
    writtenContentSegments: [],
    runMetrics: null,
    reviewCycleCount: canResume ? checkpoint!.checkpoint.loopCount : 0,
    maxReviewCycles: 3,
    shouldStop: false,
    completed: false,
  };

  state.writtenContentSegments.push(...state.writtenSections.map((item) => item.content.trim()).filter(Boolean));

  if (canResume) {
    callbacks.addChatMessage(`检测到可恢复运行：${state.runId}，从节点 ${checkpoint!.checkpoint.nodeId} 继续。`, { uiOnly: true });
  }

  const saveCheckpoint = async (
    nodeId: string,
    status: "running" | "completed" | "error" | "cancelled" = "running",
  ): Promise<void> => {
    await persistPipelineCheckpoint(nodeId, status, state);
  };

  const onSectionPersisted = async (): Promise<void> => {
    await saveCheckpoint("writing_sections");
  };

  const executeFlow = async (): Promise<void> => {
    const startNodeId = canResume ? checkpoint!.checkpoint.nodeId : "planning";
    const nodes: TaskGraphNode<PipelineRuntimeState>[] = [
      {
        id: "planning",
        run: async (runtimeState) => {
          callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");
          const outline = await generateOutline(
            runtimeState.request,
            runtimeState.documentContext,
            runtimeOptions.planner,
          );
          runtimeState.outline = outline;
          runtimeState.runMetrics = createRunMetricsDraft(outline.sections.length, runtimeState.runId);
          await saveCheckpoint("planning");
        },
        next: () => "awaiting_confirmation",
      },
      {
        id: "awaiting_confirmation",
        run: async (runtimeState) => {
          if (!runtimeState.outline) {
            throw new Error("缺少可确认的大纲");
          }
          callbacks.onPhaseChange("awaiting_confirmation", "请确认文章大纲");
          const confirmed = await callbacks.onOutlineReady(runtimeState.outline);
          if (!confirmed) {
            runtimeState.shouldStop = true;
            callbacks.onPhaseChange("idle", "已取消");
            await saveCheckpoint("awaiting_confirmation", "cancelled");
            return;
          }
          await saveCheckpoint("awaiting_confirmation");
        },
        next: (runtimeState) => (runtimeState.shouldStop ? null : "init_memory"),
      },
      {
        id: "init_memory",
        run: async (runtimeState) => {
          if (!runtimeState.outline) {
            throw new Error("初始化记忆失败：缺少大纲");
          }
          if (!runtimeState.memory) {
            runtimeState.memory = createLongTermMemory(
              runtimeState.outline,
              runtimeState.request,
              runtimeState.documentContext,
            );
            await hydrateLongTermMemoryFromPersistence(runtimeState.memory, callbacks);
            if (canResume && checkpoint?.memorySnapshot && typeof checkpoint.memorySnapshot === "object") {
              mergeLongTermMemory(runtimeState.memory, checkpoint.memorySnapshot as Partial<LongTermMemoryState>);
            }
            await persistLongTermMemory(runtimeState.memory);
          }
          if (!runtimeState.runMetrics) {
            runtimeState.runMetrics = createRunMetricsDraft(runtimeState.outline.sections.length, runtimeState.runId);
          }
          await saveCheckpoint("init_memory");
        },
        next: () => "writing_sections",
      },
      {
        id: "writing_sections",
        run: async (runtimeState) => {
          if (!runtimeState.outline || !runtimeState.memory || !runtimeState.runMetrics) {
            throw new Error("写作阶段状态不完整");
          }
          const executeToolCalls = createTrackedToolExecutor(callbacks, runtimeState.runMetrics);
          const completedSectionIds = new Set(runtimeState.writtenSections.map((item) => item.sectionId));
          if (runtimeState.outline.sections.length > 1) {
            await runParallelDraftAndWrite({
              outline: runtimeState.outline,
              callbacks,
              writtenSections: runtimeState.writtenSections,
              completedSectionIds,
              memory: runtimeState.memory,
              executeToolCalls,
              runMetrics: runtimeState.runMetrics,
              writtenContentSegments: runtimeState.writtenContentSegments,
              runtimeOptions,
              onSectionPersisted,
            });
          } else {
            await runSequentialSectionFlow({
              outline: runtimeState.outline,
              callbacks,
              writtenSections: runtimeState.writtenSections,
              completedSectionIds,
              memory: runtimeState.memory,
              executeToolCalls,
              runMetrics: runtimeState.runMetrics,
              writtenContentSegments: runtimeState.writtenContentSegments,
              runtimeOptions,
              onSectionPersisted,
            });
          }
          await saveCheckpoint("writing_sections");
        },
        next: () => "review_cycle",
      },
      {
        id: "review_cycle",
        maxVisits: 3,
        run: async (runtimeState) => {
          if (!runtimeState.outline || !runtimeState.memory || !runtimeState.runMetrics) {
            throw new Error("审阅阶段状态不完整");
          }
          const executeToolCalls = createTrackedToolExecutor(callbacks, runtimeState.runMetrics);
          const outcome = await runGlobalReviewAndRevision({
            outline: runtimeState.outline,
            callbacks,
            writtenSections: runtimeState.writtenSections,
            memory: runtimeState.memory,
            executeToolCalls,
            runMetrics: runtimeState.runMetrics,
            writtenContentSegments: runtimeState.writtenContentSegments,
            runtimeOptions,
          });
          runtimeState.reviewCycleCount += 1;
          runtimeState.shouldStop = outcome.qualityGatePassed
            || !outcome.needsReplan
            || runtimeState.reviewCycleCount >= runtimeState.maxReviewCycles;

          if (outcome.needsReplan && !runtimeState.shouldStop) {
            callbacks.addChatMessage(
              `触发重规划：${outcome.reasons.join("、")}。将自动插入补写/重审循环（第 ${runtimeState.reviewCycleCount + 1} 轮）。`,
              { uiOnly: true },
            );
          }
          await saveCheckpoint("review_cycle");
        },
        next: (runtimeState) => (runtimeState.shouldStop ? "finalize" : "review_cycle"),
      },
      {
        id: "finalize",
        run: async (runtimeState) => {
          if (!runtimeState.runMetrics) return;
          const finalizedMetrics = finalizeRunMetrics(runtimeState.runMetrics);
          const metricsHistory = appendPipelineMetrics(finalizedMetrics);
          callbacks.addChatMessage(
            buildPipelineMetricsDashboard(finalizedMetrics, metricsHistory),
            { uiOnly: true },
          );
          callbacks.onPhaseChange("completed", "文章撰写完成");
          runtimeState.completed = true;
          await saveCheckpoint("finalize", "completed");
          await clearAgentCheckpoint();
        },
        next: () => null,
      },
    ];

    await runTaskGraph(
      nodes,
      startNodeId,
      state,
      callbacks.isRunCancelled,
    );
  };

  try {
    await executeFlow();
  } catch (error) {
    if (!callbacks.isRunCancelled()) {
      await saveCheckpoint("error", "error");
    }
    throw error;
  }
}

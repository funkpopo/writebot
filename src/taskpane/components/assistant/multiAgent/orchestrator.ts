import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import {
  getAIConfig,
  type AIRequestOptions,
} from "../../../../utils/aiService";
import {
  getDefaultParallelSectionConcurrency,
  loadAgentMemory,
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
import { draftSection, writeSection } from "./writerAgent";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  ReviewFeedback,
  SectionFeedback,
  SectionWriteResult,
} from "./types";

interface RuntimeAgentOptions {
  planner: AIRequestOptions | undefined;
  writer: AIRequestOptions | undefined;
  reviewer: AIRequestOptions | undefined;
  critic: AIRequestOptions | undefined;
  arbiter: AIRequestOptions | undefined;
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

function createRunMetricsDraft(totalSections: number): RunMetricsDraft {
  return {
    runId: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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

function updateWrittenSectionCache(
  writtenSections: SectionWriteResult[],
  sectionId: string,
  sectionTitle: string,
  content: string,
): void {
  const index = writtenSections.findIndex((item) => item.sectionId === sectionId);
  if (index >= 0) {
    writtenSections[index] = { sectionId, sectionTitle, content };
    return;
  }
  writtenSections.push({ sectionId, sectionTitle, content });
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
}): Promise<ReviewFeedback> {
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

  return consensus.finalFeedback;
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
}): Promise<void> {
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
  const firstFeedback = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 1,
    callbacks,
    runMetrics,
    runtimeOptions,
  });
  runMetrics.finalReviewScore = firstFeedback.overallScore;

  if (callbacks.isRunCancelled()) return;
  const gateTriggered = shouldTriggerQualityGate(firstFeedback);
  runMetrics.qualityGateTriggered = gateTriggered;
  if (!gateTriggered) {
    runMetrics.qualityGatePassed = true;
    return;
  }

  runMetrics.qualityGatePassed = false;
  const reviseSectionIds = pickSectionsForGlobalRevision(outline, firstFeedback);
  if (reviseSectionIds.length === 0) {
    callbacks.addChatMessage(
      `全局审校未通过（${firstFeedback.overallScore}/10），但未识别到可自动修订的章节，请人工复核。`,
      { uiOnly: true },
    );
    return;
  }

  for (const sectionId of reviseSectionIds) {
    if (callbacks.isRunCancelled()) return;
    const sectionIndex = outline.sections.findIndex((item) => item.id === sectionId);
    if (sectionIndex < 0) continue;
    const section = outline.sections[sectionIndex];
    const sectionFeedback = firstFeedback.sectionFeedback.find((item) => item.sectionId === sectionId);
    const revisionFeedback = toRevisionFeedback(sectionFeedback, firstFeedback);
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
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 修订完成`);
    }
  }

  if (callbacks.isRunCancelled()) return;
  callbacks.onPhaseChange("reviewing", "正在进行二次全局审校...");

  docText = await safeGetDocumentText(
    writtenSections.map((section) => section.content).join("\n\n")
  );
  const secondFeedback = await runConsensusReviewWithTelemetry({
    outline,
    documentText: docText,
    round: 2,
    previousFeedback: firstFeedback,
    callbacks,
    runMetrics,
    runtimeOptions,
  });
  runMetrics.finalReviewScore = secondFeedback.overallScore;

  if (shouldTriggerQualityGate(secondFeedback)) {
    callbacks.addChatMessage(
      `全局质量门控仍未通过：${secondFeedback.overallScore}/10，请人工复核重点章节。`,
      { uiOnly: true },
    );
    runMetrics.qualityGatePassed = false;
  } else {
    runMetrics.qualityGatePassed = true;
  }
}

async function runParallelDraftAndWrite(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  memory: LongTermMemoryState;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
}): Promise<void> {
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

  const total = outline.sections.length;
  callbacks.onPhaseChange("writing", `正在并行生成 ${total} 个章节草稿...`);

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

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }

  await runGlobalReviewAndRevision({
    outline,
    callbacks,
    writtenSections,
    memory,
    executeToolCalls,
    runMetrics,
    writtenContentSegments,
    runtimeOptions,
  });
}

async function runSequentialSectionFlow(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  memory: LongTermMemoryState;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  runMetrics: RunMetricsDraft;
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
}): Promise<void> {
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

  const total = outline.sections.length;
  for (let i = 0; i < total; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
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
    const feedback = await runConsensusReviewWithTelemetry({
      outline,
      documentText: docText,
      round: 1,
      focusSectionId: section.id,
      callbacks,
      runMetrics,
      runtimeOptions,
    });

    const sectionFeedback = feedback.sectionFeedback.find((item) => item.sectionId === section.id);
    if (sectionFeedback?.needsRevision) {
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
        revisionFeedback: toRevisionFeedback(sectionFeedback, feedback),
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
    );
    updateLongTermMemoryWithSection(memory, section, sectionContent);
    await persistLongTermMemory(memory);

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
  const writtenSections: SectionWriteResult[] = [];
  const writtenContentSegments: string[] = [];
  const runtimeOptions = getRuntimeAgentOptions();

  callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");
  const documentContext = await safeGetDocumentText();
  const outline = await generateOutline(
    userRequirement,
    documentContext,
    runtimeOptions.planner,
  );

  if (callbacks.isRunCancelled()) return;

  callbacks.onPhaseChange("awaiting_confirmation", "请确认文章大纲");
  const confirmed = await callbacks.onOutlineReady(outline);
  if (!confirmed) {
    callbacks.onPhaseChange("idle", "已取消");
    return;
  }

  if (callbacks.isRunCancelled()) return;

  const memory = createLongTermMemory(outline, userRequirement, documentContext);
  await hydrateLongTermMemoryFromPersistence(memory, callbacks);
  await persistLongTermMemory(memory);
  const runMetrics = createRunMetricsDraft(outline.sections.length);
  const executeToolCalls = createTrackedToolExecutor(callbacks, runMetrics);

  if (outline.sections.length > 1) {
    await runParallelDraftAndWrite({
      outline,
      callbacks,
      writtenSections,
      memory,
      executeToolCalls,
      runMetrics,
      writtenContentSegments,
      runtimeOptions,
    });
  } else {
    await runSequentialSectionFlow({
      outline,
      callbacks,
      writtenSections,
      memory,
      executeToolCalls,
      runMetrics,
      writtenContentSegments,
      runtimeOptions,
    });
    await runGlobalReviewAndRevision({
      outline,
      callbacks,
      writtenSections,
      memory,
      executeToolCalls,
      runMetrics,
      writtenContentSegments,
      runtimeOptions,
    });
  }

  if (callbacks.isRunCancelled()) return;
  const finalizedMetrics = finalizeRunMetrics(runMetrics);
  const metricsHistory = appendPipelineMetrics(finalizedMetrics);
  callbacks.addChatMessage(
    buildPipelineMetricsDashboard(finalizedMetrics, metricsHistory),
    { uiOnly: true },
  );
  callbacks.onPhaseChange("completed", "文章撰写完成");
}

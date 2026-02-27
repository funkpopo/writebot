import type { ToolCallRequest } from "../../../../types/tools";
import {
  getAIConfig,
  type AIRequestOptions,
} from "../../../../utils/aiService";
import {
  getDefaultParallelSectionConcurrency,
  getDefaultQualityGateMinScore,
} from "../../../../utils/storageService";
import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import { getDocumentText } from "../../../../utils/wordApi";
import { generateOutline } from "./plannerAgent";
import { reviewDocument } from "./reviewerAgent";
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
  parallelSectionConcurrency: number;
  qualityGateMinScore: number;
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

function normalizeQualityGateMinScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return getDefaultQualityGateMinScore();
  }
  return Math.min(10, Math.max(1, Math.round(value)));
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

function getRuntimeAgentOptions(): RuntimeAgentOptions {
  const config = getAIConfig();

  return {
    planner: createAgentRequestOptions(config.plannerModel, config.plannerTemperature),
    writer: createAgentRequestOptions(config.writerModel, config.writerTemperature),
    reviewer: createAgentRequestOptions(config.reviewerModel, config.reviewerTemperature),
    parallelSectionConcurrency: normalizeParallelSectionConcurrency(config.parallelSectionConcurrency),
    qualityGateMinScore: normalizeQualityGateMinScore(config.qualityGateMinScore),
  };
}

async function safeGetDocumentText(fallback = ""): Promise<string> {
  try {
    return await getDocumentText();
  } catch {
    return fallback;
  }
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
  minScore: number,
): boolean {
  if (feedback.overallScore < minScore) return true;
  if (feedback.coherenceIssues.length > 0) return true;
  return feedback.sectionFeedback.some((item) => item.needsRevision);
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

async function appendSectionDraftToDocument(
  sectionContent: string,
  sectionId: string,
  callbacks: OrchestratorCallbacks,
  writtenContentSegments: string[],
): Promise<void> {
  const toolCall: ToolCallRequest = {
    id: `parallel_append_${sectionId}_${Date.now().toString(36)}`,
    name: "append_text",
    arguments: { text: sectionContent },
  };

  callbacks.onToolCalls([toolCall]);
  const results = await callbacks.executeToolCalls([toolCall], writtenContentSegments);
  const failed = results.find((item) => !item.success);
  if (failed) {
    throw new Error(failed.error || `章节 ${sectionId} 写入失败`);
  }
}

async function runGlobalReviewAndRevision(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    writtenContentSegments,
    runtimeOptions,
  } = params;

  callbacks.onPhaseChange("reviewing", `正在进行全局连贯性审校（门控分 ${runtimeOptions.qualityGateMinScore}/10）...`);

  let docText = await safeGetDocumentText(
    writtenSections.map((section) => section.content).join("\n\n")
  );
  const firstFeedback = await reviewDocument({
    outline,
    documentText: docText,
    round: 1,
    aiOptions: runtimeOptions.reviewer,
  });
  callbacks.onReviewResult(firstFeedback);

  if (callbacks.isRunCancelled()) return;
  if (!shouldTriggerQualityGate(firstFeedback, runtimeOptions.qualityGateMinScore)) {
    return;
  }

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

    callbacks.onPhaseChange("revising", `正在根据全局审校修改：${section.title}`);

    const revisionResult = await writeSection({
      outline,
      section,
      sectionIndex,
      previousSections: writtenSections,
      allTools: TOOL_DEFINITIONS,
      onChunk: callbacks.onChunk,
      executeToolCalls: callbacks.executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      revisionFeedback,
      aiOptions: runtimeOptions.writer,
    });

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

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 修订完成`);
    }
  }

  if (callbacks.isRunCancelled()) return;
  callbacks.onPhaseChange("reviewing", "正在进行二次全局审校...");

  docText = await safeGetDocumentText(
    writtenSections.map((section) => section.content).join("\n\n")
  );
  const secondFeedback = await reviewDocument({
    outline,
    documentText: docText,
    round: 2,
    previousFeedback: firstFeedback,
    aiOptions: runtimeOptions.reviewer,
  });
  callbacks.onReviewResult(secondFeedback);

  if (shouldTriggerQualityGate(secondFeedback, runtimeOptions.qualityGateMinScore)) {
    callbacks.addChatMessage(
      `全局质量门控仍未通过：${secondFeedback.overallScore}/10，请人工复核重点章节。`,
      { uiOnly: true },
    );
  }
}

async function runParallelDraftAndWrite(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
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
      drafts[currentIndex] = await draftSection({
        outline,
        section,
        sectionIndex: currentIndex,
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

    if (sectionContent) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }
    callbacks.onSectionDone(i, total, section.title);
  }

  await runGlobalReviewAndRevision({
    outline,
    callbacks,
    writtenSections,
    writtenContentSegments,
    runtimeOptions,
  });
}

async function runSequentialSectionFlow(params: {
  outline: ArticleOutline;
  callbacks: OrchestratorCallbacks;
  writtenSections: SectionWriteResult[];
  writtenContentSegments: string[];
  runtimeOptions: RuntimeAgentOptions;
}): Promise<void> {
  const {
    outline,
    callbacks,
    writtenSections,
    writtenContentSegments,
    runtimeOptions,
  } = params;

  const total = outline.sections.length;
  for (let i = 0; i < total; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
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
      executeToolCalls: callbacks.executeToolCalls,
      writtenContentSegments,
      isRunCancelled: callbacks.isRunCancelled,
      aiOptions: runtimeOptions.writer,
    });
    let latestAssistantContent = result.assistantContent;

    if (callbacks.isRunCancelled()) return;
    callbacks.onPhaseChange("reviewing", `正在审阅：${section.title}`);

    const docText = await safeGetDocumentText(result.assistantContent);
    const feedback = await reviewDocument({
      outline,
      documentText: docText,
      round: 1,
      focusSectionId: section.id,
      aiOptions: runtimeOptions.reviewer,
    });
    callbacks.onReviewResult(feedback);

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
        executeToolCalls: callbacks.executeToolCalls,
        writtenContentSegments,
        isRunCancelled: callbacks.isRunCancelled,
        revisionFeedback: toRevisionFeedback(sectionFeedback, feedback),
        aiOptions: runtimeOptions.writer,
      });
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

  if (outline.sections.length > 1) {
    await runParallelDraftAndWrite({
      outline,
      callbacks,
      writtenSections,
      writtenContentSegments,
      runtimeOptions,
    });
  } else {
    await runSequentialSectionFlow({
      outline,
      callbacks,
      writtenSections,
      writtenContentSegments,
      runtimeOptions,
    });
    await runGlobalReviewAndRevision({
      outline,
      callbacks,
      writtenSections,
      writtenContentSegments,
      runtimeOptions,
    });
  }

  if (callbacks.isRunCancelled()) return;
  callbacks.onPhaseChange("completed", "文章撰写完成");
}

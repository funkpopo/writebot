import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import { getDocumentText } from "../../../../utils/wordApi";
import { generateOutline } from "./plannerAgent";
import { writeSection } from "./writerAgent";
import { reviewDocument } from "./reviewerAgent";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  ReviewFeedback,
  SectionWriteResult,
} from "./types";

const MAX_REVIEW_ROUNDS = 2;

/**
 * Main multi-agent pipeline: Planner → Writer (per section) → Reviewer → Reviser.
 * The orchestrator is pure TypeScript control flow, not an AI agent.
 */
export async function runMultiAgentPipeline(
  userRequirement: string,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const writtenSections: SectionWriteResult[] = [];
  const writtenContentSegments: string[] = [];

  // ── Phase 1: Planning ──
  callbacks.onPhaseChange("planning", "正在分析需求并生成文章大纲...");

  let documentContext = "";
  try {
    documentContext = await getDocumentText();
  } catch {
    // Empty document is fine
  }

  const outline = await generateOutline(userRequirement, documentContext);

  if (callbacks.isRunCancelled()) return;

  // ── Phase 2: User Confirmation ──
  callbacks.onPhaseChange("awaiting_confirmation", "请确认文章大纲");
  const confirmed = await callbacks.onOutlineReady(outline);
  if (!confirmed) {
    callbacks.onPhaseChange("idle", "已取消");
    return;
  }

  if (callbacks.isRunCancelled()) return;

  // ── Phase 3: Section-by-Section Writing ──
  callbacks.onPhaseChange("writing", "开始撰写文章...");
  await writeSections(outline, writtenSections, writtenContentSegments, callbacks);

  if (callbacks.isRunCancelled()) return;

  // ── Phase 4: Review Loop (max 2 rounds) ──
  const allFeedback: ReviewFeedback[] = [];

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    if (callbacks.isRunCancelled()) return;

    callbacks.onPhaseChange("reviewing", `正在审阅文档（第 ${round} 轮）...`);

    let fullText = "";
    try {
      fullText = await getDocumentText();
    } catch {
      // If we can't read the document, skip review
      break;
    }

    const feedback = await reviewDocument({
      outline,
      documentText: fullText,
      round,
      previousFeedback: allFeedback[round - 2],
    });

    allFeedback.push(feedback);
    callbacks.onReviewResult(feedback);

    if (callbacks.isRunCancelled()) return;

    // Check if revision is needed
    const sectionsNeedingRevision = feedback.sectionFeedback.filter((sf) => sf.needsRevision);

    if (sectionsNeedingRevision.length === 0 || feedback.overallScore >= 8) {
      callbacks.addChatMessage(
        `审阅完成（评分 ${feedback.overallScore}/10）：文章质量良好，无需修改。`,
      );
      break;
    }

    if (round < MAX_REVIEW_ROUNDS) {
      // Revise sections that need it
      callbacks.onPhaseChange(
        "revising",
        `正在修改 ${sectionsNeedingRevision.length} 个章节...`,
      );

      callbacks.addChatMessage(
        `审阅完成（评分 ${feedback.overallScore}/10），需要修改 ${sectionsNeedingRevision.length} 个章节。`,
      );

      await reviseSections(
        outline,
        writtenSections,
        writtenContentSegments,
        sectionsNeedingRevision,
        feedback,
        callbacks,
      );
    } else {
      callbacks.addChatMessage(
        `审阅完成（评分 ${feedback.overallScore}/10），已达到最大修改轮次。`,
      );
    }
  }

  callbacks.onPhaseChange("completed", "文章撰写完成");
}

// ── Internal helpers ──

async function writeSections(
  outline: ArticleOutline,
  writtenSections: SectionWriteResult[],
  writtenContentSegments: string[],
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  for (let i = 0; i < outline.sections.length; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    callbacks.onSectionStart(i, outline.sections.length, section.title);
    callbacks.onPhaseChange(
      "writing",
      `正在撰写 ${i + 1}/${outline.sections.length}：${section.title}`,
    );

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
    });

    if (callbacks.isRunCancelled()) return;

    // Read back what was written for context in subsequent sections
    let sectionContent = "";
    try {
      sectionContent = await getDocumentText();
    } catch {
      // fallback: use the assistant content
      sectionContent = result.assistantContent;
    }

    writtenSections.push({
      sectionId: section.id,
      sectionTitle: section.title,
      content: sectionContent,
    });

    callbacks.onSectionDone(i, outline.sections.length, section.title);
  }
}

async function reviseSections(
  outline: ArticleOutline,
  writtenSections: SectionWriteResult[],
  writtenContentSegments: string[],
  sectionsToRevise: ReviewFeedback["sectionFeedback"],
  feedback: ReviewFeedback,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  for (const sectionFeedback of sectionsToRevise) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections.find((s) => s.id === sectionFeedback.sectionId);
    if (!section) continue;

    const sectionIndex = outline.sections.indexOf(section);

    // Build revision context from feedback
    const revisionParts: string[] = [];
    if (sectionFeedback.issues.length > 0) {
      revisionParts.push("## 审阅问题");
      revisionParts.push(...sectionFeedback.issues.map((i) => `- ${i}`));
    }
    if (sectionFeedback.suggestions.length > 0) {
      revisionParts.push("## 修改建议");
      revisionParts.push(...sectionFeedback.suggestions.map((s) => `- ${s}`));
    }
    if (feedback.coherenceIssues.length > 0) {
      revisionParts.push("## 连贯性问题");
      revisionParts.push(...feedback.coherenceIssues.map((c) => `- ${c}`));
    }
    const revisionFeedback = revisionParts.join("\n");

    callbacks.onPhaseChange(
      "revising",
      `正在修改：${section.title}`,
    );

    await writeSection({
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
    });

    if (callbacks.isRunCancelled()) return;
  }
}

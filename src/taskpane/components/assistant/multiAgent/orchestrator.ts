import { TOOL_DEFINITIONS } from "../../../../utils/toolDefinitions";
import { getDocumentText } from "../../../../utils/wordApi";
import { generateOutline } from "./plannerAgent";
import { writeSection } from "./writerAgent";
import { reviewDocument } from "./reviewerAgent";
import type {
  OrchestratorCallbacks,
  SectionWriteResult,
} from "./types";

/**
 * Main multi-agent pipeline: Planner → (Writer → Reviewer → Reviser) per section.
 * Each section is written, reviewed, and revised before moving to the next.
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

  // ── Phase 3: Per-section Write → Review → Revise loop ──
  for (let i = 0; i < outline.sections.length; i++) {
    if (callbacks.isRunCancelled()) return;

    const section = outline.sections[i];
    const total = outline.sections.length;
    callbacks.onSectionStart(i, total, section.title);

    // ── 3a: Write ──
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
    });

    if (callbacks.isRunCancelled()) return;

    // ── 3b: Review this section ──
    callbacks.onPhaseChange("reviewing", `正在审阅：${section.title}`);

    let docText = "";
    try {
      docText = await getDocumentText();
    } catch {
      docText = result.assistantContent;
    }

    const feedback = await reviewDocument({
      outline,
      documentText: docText,
      round: 1,
      focusSectionId: section.id,
    });

    callbacks.onReviewResult(feedback);

    if (callbacks.isRunCancelled()) return;

    const sectionFb = feedback.sectionFeedback.find((sf) => sf.sectionId === section.id);
    const needsRevision = sectionFb?.needsRevision && feedback.overallScore < 8;

    // ── 3c: Revise if needed ──
    if (needsRevision && sectionFb) {
      callbacks.onPhaseChange("revising", `正在修改：${section.title}`);

      const revisionParts: string[] = [];
      if (sectionFb.issues.length > 0) {
        revisionParts.push("## 审阅问题");
        revisionParts.push(...sectionFb.issues.map((issue) => `- ${issue}`));
      }
      if (sectionFb.suggestions.length > 0) {
        revisionParts.push("## 修改建议");
        revisionParts.push(...sectionFb.suggestions.map((s) => `- ${s}`));
      }
      if (feedback.coherenceIssues.length > 0) {
        revisionParts.push("## 连贯性问题");
        revisionParts.push(...feedback.coherenceIssues.map((c) => `- ${c}`));
      }

      await writeSection({
        outline,
        section,
        sectionIndex: i,
        previousSections: writtenSections,
        allTools: TOOL_DEFINITIONS,
        onChunk: callbacks.onChunk,
        executeToolCalls: callbacks.executeToolCalls,
        writtenContentSegments,
        isRunCancelled: callbacks.isRunCancelled,
        revisionFeedback: revisionParts.join("\n"),
      });

      if (callbacks.isRunCancelled()) return;
    }

    // ── 3d: Record section content and snapshot ──
    let sectionContent = "";
    try {
      sectionContent = await getDocumentText();
    } catch {
      sectionContent = result.assistantContent;
    }

    writtenSections.push({
      sectionId: section.id,
      sectionTitle: section.title,
      content: sectionContent,
    });

    if (sectionContent.trim()) {
      callbacks.onDocumentSnapshot(sectionContent, `${section.title} 完成`);
    }

    callbacks.onSectionDone(i, total, section.title);
  }

  callbacks.onPhaseChange("completed", "文章撰写完成");
}

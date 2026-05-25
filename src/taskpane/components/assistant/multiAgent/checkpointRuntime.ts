import {
  loadAgentMemory,
  saveAgentCheckpoint,
  saveAgentMemory,
} from "../../../../utils/storageService";
import {
  mergeLongTermMemory,
  parseLongTermMemoryMarkdown,
  renderLongTermMemoryMarkdown,
  type LongTermMemoryState,
} from "./longTermMemory";
import type { PipelineRuntimeState } from "./runtimeTypes";
import type {
  ArticleOutline,
  OrchestratorCallbacks,
  OutlineSection,
  SectionWriteResult,
} from "./types";

export async function hydrateLongTermMemoryFromPersistence(
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

export async function persistLongTermMemory(
  memory: LongTermMemoryState,
): Promise<void> {
  const markdown = renderLongTermMemoryMarkdown(memory);
  await saveAgentMemory({ content: markdown });
}

export function isOutlineSection(value: unknown): value is OutlineSection {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.level === "number"
    && typeof item.description === "string"
    && Array.isArray(item.keyPoints)
    && typeof item.estimatedParagraphs === "number";
}

export function isArticleOutline(value: unknown): value is ArticleOutline {
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

export function normalizeWrittenSections(value: unknown): SectionWriteResult[] {
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

export async function persistPipelineCheckpoint(
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

/** 节完成后批量落盘（memory + checkpoint），减少每节一次 I/O。 */
const SECTION_PERSIST_EVERY = 2;

export interface SectionFlushState {
  sectionsSinceDiskFlush: number;
}

export function createSectionFlushState(): SectionFlushState {
  return { sectionsSinceDiskFlush: 0 };
}

export async function flushAfterSectionIfDue(params: {
  sectionLoopIndex: number;
  totalSections: number;
  flushState: SectionFlushState;
  memory: LongTermMemoryState;
  onSectionPersisted?: () => Promise<void>;
}): Promise<void> {
  const { sectionLoopIndex, totalSections, flushState, memory, onSectionPersisted } = params;
  flushState.sectionsSinceDiskFlush += 1;
  const isLast = sectionLoopIndex === totalSections - 1;
  if (flushState.sectionsSinceDiskFlush < SECTION_PERSIST_EVERY && !isLast) {
    return;
  }
  await persistLongTermMemory(memory);
  if (onSectionPersisted) {
    await onSectionPersisted();
  }
  flushState.sectionsSinceDiskFlush = 0;
}

export async function flushSectionPersistenceIfPending(
  flushState: SectionFlushState,
  memory: LongTermMemoryState,
  onSectionPersisted?: () => Promise<void>,
): Promise<void> {
  if (flushState.sectionsSinceDiskFlush === 0) return;
  await persistLongTermMemory(memory);
  if (onSectionPersisted) {
    await onSectionPersisted();
  }
  flushState.sectionsSinceDiskFlush = 0;
}

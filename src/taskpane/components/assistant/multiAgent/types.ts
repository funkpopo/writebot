import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { StreamCallback } from "../../../../utils/ai/types";
import type {
  DocumentDependency,
  PromptOutputRequirements,
  PromptTaskType,
} from "./promptIntake";

// ── Outline (Planner output) ──

export interface OutlineSection {
  id: string;
  title: string;
  level: number;
  description: string;
  keyPoints: string[];
  estimatedParagraphs: number;
}

export interface ArticleOutline {
  title: string;
  theme: string;
  targetAudience: string;
  style: string;
  sections: OutlineSection[];
  totalEstimatedParagraphs: number;
  promptContractHash?: string;
  taskType?: PromptTaskType;
  primaryGoal?: string;
  hardConstraints?: string[];
  outputRequirements?: PromptOutputRequirements;
  documentDependency?: DocumentDependency;
}

// ── Multi-Agent state ──

export type MultiAgentPhase =
  | "idle"
  | "planning"
  | "awaiting_confirmation"
  | "writing"
  | "completed"
  | "error";

export interface SectionWriteRange {
  startParagraphIndex: number;
  endParagraphIndex: number;
  paragraphCount: number;
  rangeId?: string;
  transactionIds?: string[];
}

export interface SectionWriteResult {
  sectionId: string;
  sectionTitle: string;
  content: string;
  range?: SectionWriteRange;
}

export interface MultiAgentProgress {
  phase: MultiAgentPhase;
  outline: ArticleOutline | null;
  currentSectionIndex: number;
  totalSections: number;
  message: string;
}

// ── Orchestrator callbacks ──

export interface OrchestratorCallbacks {
  onPhaseChange: (phase: MultiAgentPhase, message?: string) => void;
  onOutlineReady: (outline: ArticleOutline) => Promise<boolean>;
  onSectionStart: (sectionIndex: number, total: number, title: string) => void;
  onSectionDone: (sectionIndex: number, total: number, title: string) => void;
  onChunk: StreamCallback;
  onToolCalls: (toolCalls: ToolCallRequest[]) => void;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  isRunCancelled: () => boolean;
  addChatMessage: (content: string, options?: { thinking?: string; uiOnly?: boolean }) => void;
  /** Called after each major phase with the current document text, so the UI can show a snapshot. */
  onDocumentSnapshot: (text: string, label: string) => void;
}

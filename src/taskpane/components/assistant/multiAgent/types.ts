import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { StreamCallback } from "../../../../utils/ai/types";

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
}

// ── Review (Reviewer output) ──

export interface SectionFeedback {
  sectionId: string;
  issues: string[];
  suggestions: string[];
  needsRevision: boolean;
}

export interface ReviewFeedback {
  round: number;
  overallScore: number;
  sectionFeedback: SectionFeedback[];
  coherenceIssues: string[];
  globalSuggestions: string[];
}

// ── Multi-Agent state ──

export type MultiAgentPhase =
  | "idle"
  | "planning"
  | "awaiting_confirmation"
  | "writing"
  | "reviewing"
  | "revising"
  | "completed"
  | "error";

export interface SectionWriteResult {
  sectionId: string;
  sectionTitle: string;
  content: string;
}

export interface MultiAgentProgress {
  phase: MultiAgentPhase;
  outline: ArticleOutline | null;
  currentSectionIndex: number;
  totalSections: number;
  reviewRound: number;
  message: string;
}

// ── Orchestrator callbacks ──

export interface OrchestratorCallbacks {
  onPhaseChange: (phase: MultiAgentPhase, message?: string) => void;
  onOutlineReady: (outline: ArticleOutline) => Promise<boolean>;
  onSectionStart: (sectionIndex: number, total: number, title: string) => void;
  onSectionDone: (sectionIndex: number, total: number, title: string) => void;
  onReviewResult: (feedback: ReviewFeedback) => void;
  onChunk: StreamCallback;
  onToolCalls: (toolCalls: ToolCallRequest[]) => void;
  executeToolCalls: (toolCalls: ToolCallRequest[], writtenSegments: string[]) => Promise<ToolCallResult[]>;
  isRunCancelled: () => boolean;
  addChatMessage: (content: string, options?: { thinking?: string; uiOnly?: boolean }) => void;
  /** Called after each major phase with the current document text, so the UI can show a snapshot. */
  onDocumentSnapshot: (text: string, label: string) => void;
}

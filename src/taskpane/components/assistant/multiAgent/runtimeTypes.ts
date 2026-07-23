import type { ToolCallRequest, ToolCallResult } from "../../../../types/tools";
import type { AgentNodeId, AgentRunState } from "../../../../utils/agentRunState";
import type { AgentRunTrace } from "./agentHarness";
import type { DocumentSession } from "./documentSession";
import type { LongTermMemoryState } from "./longTermMemory";
import type { PipelineRunMetrics } from "./pipelineMetrics";
import type { PromptIntakeContract } from "./promptIntake";
import type {
  ArticleOutline,
  SectionWriteResult,
} from "./types";

export interface RunMetricsDraft {
  runId: string;
  startedAt: string;
  startMs: number;
  totalSections: number;
  revisedSections: Set<string>;
  reviewRounds: number;
  toolCalls: number;
  toolFailures: number;
  duplicateWriteSkips: number;
  duplicateWriteBlockedCount: number;
  writeTransactionCount: number;
  fullDocumentReadCount: number;
  documentIndexBuildCount: number;
  rangeReadCount: number;
  qualityGateTriggered: boolean;
  qualityGatePassed: boolean;
  finalReviewScore: number | null;
  intakePath?: "rule" | "llm";
  intakeMs?: number;
}

export interface ReviewCycleOutcome {
  qualityGatePassed: boolean;
  needsReplan: boolean;
  revisionPerformed: boolean;
  reasons: string[];
}

export interface PipelineRuntimeState {
  runId: string;
  request: string;
  promptContract: PromptIntakeContract;
  promptContractHash: string;
  /** Prompt Intake 路径，写入 runMetrics 时带上。 */
  intakePath?: "rule" | "llm";
  /** Prompt Intake 耗时（ms）。 */
  intakeMs?: number;
  trace: AgentRunTrace;
  outline: ArticleOutline | null;
  documentSession: DocumentSession | null;
  memory: LongTermMemoryState | null;
  writtenSections: SectionWriteResult[];
  writtenContentSegments: string[];
  runMetrics: RunMetricsDraft | null;
  reviewCycleCount: number;
  maxReviewCycles: number;
  completed: boolean;
  runState: AgentRunState;
  currentNodeId: AgentNodeId | null;
}

export type TrackedToolExecutor = (
  toolCalls: ToolCallRequest[],
  writtenSegments: string[],
) => Promise<ToolCallResult[]>;

export function createRunMetricsDraft(
  totalSections: number,
  runId?: string,
  intake?: { intakePath?: "rule" | "llm"; intakeMs?: number },
): RunMetricsDraft {
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
    duplicateWriteBlockedCount: 0,
    writeTransactionCount: 0,
    fullDocumentReadCount: 0,
    documentIndexBuildCount: 0,
    rangeReadCount: 0,
    qualityGateTriggered: false,
    qualityGatePassed: true,
    finalReviewScore: null,
    intakePath: intake?.intakePath,
    intakeMs: intake?.intakeMs,
  };
}

export function finalizeRunMetrics(draft: RunMetricsDraft): PipelineRunMetrics {
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
    duplicateWriteBlockedCount: draft.duplicateWriteBlockedCount,
    writeTransactionCount: draft.writeTransactionCount,
    fullDocumentReadCount: draft.fullDocumentReadCount,
    documentIndexBuildCount: draft.documentIndexBuildCount,
    rangeReadCount: draft.rangeReadCount,
    qualityGateTriggered: draft.qualityGateTriggered,
    qualityGatePassed: draft.qualityGatePassed,
    finalReviewScore: draft.finalReviewScore,
    intakePath: draft.intakePath,
    intakeMs: draft.intakeMs,
  };
}

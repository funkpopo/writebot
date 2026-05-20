import type { ExplicitContentFormat } from "./documentText";
import type { UndoSnapshot } from "./wordApi";

export type EditTransactionSource = "manual_apply" | "agent_tool" | "format_optimizer";
export type EditTransactionStatus =
  | "planned"
  | "previewed"
  | "committing"
  | "committed"
  | "verifying"
  | "rolling_back"
  | "rolled_back"
  | "failed"
  | "blocked_target_changed"
  | "unknown_commit_state";

export type EditOperationType =
  | "replace_selection"
  | "insert_text"
  | "append_text"
  | "insert_after_paragraph"
  | "replace_paragraph_range"
  | "insert_at_anchor"
  | "delete_paragraph_range"
  | "rewrite_paragraph"
  | "apply_format";

export interface EditTargetExpectation {
  expectedTextHash?: string;
  expectedTextExcerpt?: string;
  paragraphIndex?: number;
  paragraphTextHash?: string;
  beforeTextHash?: string;
  afterTextHash?: string;
  headingPath?: string[];
  occurrence?: number;
}

export interface EditScopeSelection {
  kind: "selection";
}

export interface EditScopeCursor {
  kind: "cursor";
  location?: "cursor" | "start" | "end";
}

export interface EditScopeParagraphRange {
  kind: "paragraph_range";
  startParagraphIndex: number;
  endParagraphIndex: number;
}

export interface EditScopeParagraphAnchor {
  kind: "paragraph_anchor";
  anchorParagraphIndex?: number;
  occurrence?: number;
}

export interface EditScopeDocument {
  kind: "document";
}

export type EditScope =
  | EditScopeSelection
  | EditScopeCursor
  | EditScopeParagraphRange
  | EditScopeParagraphAnchor
  | EditScopeDocument;

export interface EditOperation {
  type: EditOperationType;
  content?: string;
  contentFormat?: ExplicitContentFormat;
  paragraphIndex?: number;
  preserveSelectionFormat?: boolean;
}

export interface EditTargetState {
  text: string;
  textHash: string;
  excerpt: string;
  paragraphCount: number;
  paragraphIndices?: number[];
  startParagraphIndex?: number;
  endParagraphIndex?: number;
  paragraphTexts?: string[];
}

export interface EditTransactionDiffPreview {
  title: string;
  beforeText: string;
  afterText: string;
  summary: string;
}

export interface EditTransaction {
  id: string;
  source: EditTransactionSource;
  operationGroupId?: string;
  operation: EditOperation;
  scope: EditScope;
  before?: EditTargetState;
  after?: EditTargetState;
  expectedBefore?: EditTargetExpectation;
  expectedAfter?: EditTargetExpectation;
  status: EditTransactionStatus;
  createdAt: string;
  committedAt?: string;
  rolledBackAt?: string;
  snapshot?: UndoSnapshot;
  preview?: EditTransactionDiffPreview;
  errorMessage?: string;
}

export interface EditTransactionPlanInput {
  source: EditTransactionSource;
  operationGroupId?: string;
  operation: EditOperation;
  scope: EditScope;
  expectedBefore?: EditTargetExpectation;
}

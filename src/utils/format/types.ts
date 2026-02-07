/**
 * AI排版服务 - 类型定义
 * 所有接口、类型和常量
 */

import {
  FormatSpecification,
  DocumentSnapshot,
} from "../wordApi";

// Re-export FormatSpecification and DocumentSnapshot so consumers can access them
export type { FormatSpecification, DocumentSnapshot };

/**
 * 格式分析结果接口
 */
export interface FormatAnalysisResult {
  formatSpec: FormatSpecification;
  inconsistencies: string[];
  suggestions: string[];
  colorAnalysis?: ColorAnalysisItem[];
  formatMarkAnalysis?: FormatMarkAnalysisItem[];
}

/**
 * 颜色分析项接口
 */
export interface ColorAnalysisItem {
  paragraphIndex: number;
  text: string;
  currentColor: string;
  isReasonable: boolean;
  reason: string;
  suggestedColor: string;
}

/**
 * 格式标记分析项接口（下划线、斜体、删除线）
 */
export interface FormatMarkAnalysisItem {
  paragraphIndex: number;
  text: string;
  formatType: "underline" | "italic" | "strikethrough";
  isReasonable: boolean;
  reason: string;
  shouldKeep: boolean;
}

/**
 * 页眉页脚统一方案接口
 */
export interface HeaderFooterUnifyPlan {
  shouldUnify: boolean;
  headerText?: string;
  footerText?: string;
  reason: string;
}

/**
 * 作用范围类型
 */
export type FormatScopeType =
  | "selection"
  | "currentSection"
  | "document"
  | "headings"
  | "bodyText"
  | "paragraphs";

/**
 * 作用范围
 */
export interface FormatScope {
  type: FormatScopeType;
  paragraphIndices?: number[];
}

export type IssueSeverity = "info" | "warning" | "error";

export interface IssueItem {
  id: string;
  description: string;
  paragraphIndices: number[];
  severity: IssueSeverity;
  sample?: string;
}

export interface IssueCategory {
  id: string;
  title: string;
  summary: string;
  items: IssueItem[];
}

export type ChangeType =
  | "heading-level-fix"
  | "heading-style"
  | "body-style"
  | "list-style"
  | "heading-numbering"
  | "toc-update"
  | "table-style"
  | "caption-style"
  | "image-alignment"
  | "header-footer-template"
  | "color-correction"
  | "mixed-typography"
  | "punctuation-spacing"
  | "pagination-control"
  | "special-content"
  | "underline-removal"
  | "italic-removal"
  | "strikethrough-removal";

export interface ChangeItem {
  id: string;
  title: string;
  description: string;
  paragraphIndices: number[];
  type: ChangeType;
  preview?: string;
  requiresContentChange?: boolean;
  data?: Record<string, unknown>;
}

export interface ChangePlan {
  items: ChangeItem[];
  formatSpec?: FormatSpecification | null;
}

export interface FormatAnalysisSession {
  scope: FormatScope;
  paragraphCount: number;
  sectionCount: number;
  issues: IssueCategory[];
  formatSpec: FormatSpecification | null;
  colorAnalysis: ColorAnalysisItem[];
  formatMarkAnalysis: FormatMarkAnalysisItem[];
  suggestions: string[];
  inconsistencies: string[];
  changePlan: ChangePlan;
}

export interface OperationLogEntry {
  id: string;
  title: string;
  timestamp: number;
  scope: FormatScope;
  itemIds: string[];
  summary: string;
  snapshot: DocumentSnapshot;
}

export interface HeaderFooterTemplate {
  primaryHeader: string;
  primaryFooter: string;
  firstPageHeader?: string;
  firstPageFooter?: string;
  evenPageHeader?: string;
  evenPageFooter?: string;
  useDifferentFirstPage: boolean;
  useDifferentOddEven: boolean;
  includePageNumber: boolean;
  includeDate: boolean;
  includeDocumentName: boolean;
}

export interface TypographyOptions {
  chineseFont: string;
  englishFont: string;
  enforceSpacing: boolean;
  enforcePunctuation: boolean;
}

/**
 * 进度回调类型
 */
export type ProgressCallback = (
  current: number,
  total: number,
  message: string
) => void;

export interface CancelToken {
  cancelled: boolean;
  abortController?: AbortController;
}

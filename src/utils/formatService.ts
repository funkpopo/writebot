/**
 * AI排版服务
 * 提供文档格式分析、统一和应用功能
 *
 * 此文件为向后兼容的桶式重导出文件。
 * 实际实现已拆分至 ./format/ 目录下的各模块。
 */

// Re-export all types
export type {
  FormatAnalysisResult,
  ColorAnalysisItem,
  FormatMarkAnalysisItem,
  HeaderFooterUnifyPlan,
  FormatScopeType,
  FormatScope,
  IssueSeverity,
  IssueItem,
  IssueCategory,
  ChangeType,
  ChangeItem,
  ChangePlan,
  FormatAnalysisSession,
  OperationLogEntry,
  HeaderFooterTemplate,
  TypographyOptions,
  ProgressCallback,
  CancelToken,
} from "./format";

// Re-export all functions
export {
  analyzeAndGenerateFormatSpec,
  analyzeFormatSession,
  resolveScopeParagraphIndices,
  applyFormatSpecification,
  unifyHeadersFooters,
  getDocumentFormatPreview,
  applyColorAnalysisCorrections,
  getOperationLogs,
  addOperationLog,
  finalizeOperationLog,
  undoLastOptimization,
  applyHeaderFooterTemplate,
  applyTypographyNormalization,
  removeUnderline,
  removeItalic,
  removeStrikethrough,
  applyChangePlan,
} from "./format";

/**
 * AI排版服务 - 模块入口
 * 重新导出所有公共API
 */

// Types
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
} from "./types";

// Planner (includes analyzeAndGenerateFormatSpec, analyzeFormatSession, resolveScopeParagraphIndices)
export {
  analyzeAndGenerateFormatSpec,
  analyzeFormatSession,
  resolveScopeParagraphIndices,
} from "./planner";

// Appliers (all application/execution functions)
export {
  applyFormatSpecification,
  unifyHeadersFooters,
  getDocumentFormatPreview,
  applyColorAnalysisCorrections,
  getOperationLogs,
  addOperationLog,
  undoLastOptimization,
  applyHeaderFooterTemplate,
  applyTypographyNormalization,
  removeUnderline,
  removeItalic,
  removeStrikethrough,
  applyChangePlan,
} from "./appliers";

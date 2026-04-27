// Types and constants
export {
  VALID_ALIGNMENTS,
  COLOR_NAME_MAP,
  type FontFormat,
  type LineSpacingRule,
  type ParagraphFormat,
  type TextFormat,
  type SelectionFormat,
  type MarkdownHeadingStyleTarget,
  type SearchResult,
  type ParagraphSample,
  type TableFormatSample,
  type DocumentFormatSample,
  type ParagraphInfo,
  type SectionHeaderFooter,
  type HeaderFooterSnapshot,
  type SectionSnapshot,
  type ParagraphSnapshot,
  type DocumentSnapshot,
  type ParagraphAnchor,
  type ParagraphRangeUndoBlock,
  type ScopedUndoSnapshot,
  type DocumentUndoSnapshot,
  type UndoSnapshot,
  type ContentCheckpoint,
  type ScopedContentCheckpoint,
  type FormatSpecification,
  type ColorCorrectionItem,
  type TableData,
} from "./types";

// Selection API
export {
  getSelectedText,
  getSelectedTextWithFormat,
  addSelectionChangedHandler,
  removeSelectionChangedHandler,
  deleteSelection,
} from "./selectionApi";

// Insert/Replace API
export {
  replaceSelectedText,
  replaceSelectedTextWithFormat,
  insertTextWithFormat,
  insertText,
  insertHtml,
  insertHtmlWithHeadingStyles,
  replaceSelectionWithHtml,
  replaceSelectionWithHtmlAndHeadingStyles,
  insertTextAtLocation,
  insertHtmlAtLocation,
  insertHtmlAtLocationWithHeadingStyles,
  appendText,
  insertTextAfterParagraph,
  insertHtmlAfterParagraph,
  insertHtmlAfterParagraphWithHeadingStyles,
} from "./insertApi";

// Document API
export {
  getDocumentText,
  searchDocument,
  getDocumentName,
  getDocumentOoxml,
  getDocumentBodyOoxml,
  restoreDocumentOoxml,
} from "./documentApi";

// Format API
export {
  setBold,
  setItalic,
  addComment,
  applyFormatToSelection,
  applyFormatToParagraphsSafe,
  applyFormatToParagraphsBatch,
  applyColorCorrections,
  getAvailableFonts,
} from "./formatApi";

// Paragraph API
export {
  getParagraphs,
  getParagraphByIndex,
  getParagraphCountInSelection,
  getParagraphCountInDocument,
  getParagraphIndicesInSelection,
  getParagraphIndicesInCurrentSection,
  selectParagraphByIndex,
  highlightParagraphs,
  clearParagraphHighlights,
  getParagraphSnapshots,
  restoreParagraphSnapshots,
  sampleDocumentFormats,
  getAllParagraphsInfo,
  getBodyDefaultFormat,
  normalizeNewParagraphsFormat,
  type BodyDefaultFormat,
} from "./paragraphApi";

// Header/Footer API
export {
  getSectionHeadersFooters,
  applyHeaderFooterToAllSections,
} from "./headerFooterApi";

// Table API
export {
  insertTableFromValues,
  insertTable,
  appendTable,
  insertTableAtLocation,
  replaceSelectionWithTable,
} from "./tableApi";

// Content Checkpoint
export {
  createContentCheckpoint,
  createScopedContentCheckpoint,
  verifyContentIntegrity,
  verifyScopedContentIntegrity,
} from "./contentCheckpoint";

// Undo API
export {
  type ParagraphRangeSpec,
  compressParagraphIndices,
  resolveUndoBlockTarget,
  captureDocumentUndoSnapshot,
  captureBodyUndoSnapshot,
  captureBodyUndoSnapshotIfSizeAllows,
  FULL_BODY_UNDO_MAX_PARAGRAPHS,
  captureScopedUndoSnapshotFromRanges,
  captureScopedUndoSnapshotFromParagraphIndices,
  finalizeUndoSnapshot,
  restoreUndoSnapshot,
} from "./undoApi";

/**
 * 有效的Word对齐方式
 */
export const VALID_ALIGNMENTS = ["Left", "Centered", "Right", "Justified", "left", "centered", "right", "justified"];

export const COLOR_NAME_MAP: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  gray: "#808080",
  grey: "#808080",
  orange: "#FFA500",
  purple: "#800080",
  brown: "#A52A2A",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  "黑色": "#000000",
  "白色": "#FFFFFF",
  "红色": "#FF0000",
  "绿色": "#008000",
  "蓝色": "#0000FF",
  "黄色": "#FFFF00",
  "灰色": "#808080",
  "橙色": "#FFA500",
  "紫色": "#800080",
  "棕色": "#A52A2A",
  "青色": "#00FFFF",
  "品红": "#FF00FF",
};

/**
 * 字体格式信息接口
 */
export interface FontFormat {
  name?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strikeThrough?: boolean;
  color?: string;
  highlightColor?: string;
}

/**
 * 行距规则类型
 * - "multiple": 多倍行距（如 1.5 表示 1.5 倍行距）
 * - "exactly": 固定值（以磅为单位）
 * - "atLeast": 最小值（以磅为单位）
 */
export type LineSpacingRule = "multiple" | "exactly" | "atLeast";

/**
 * 段落格式信息接口
 */
export interface ParagraphFormat {
  alignment?: string;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  lineSpacing?: number;
  lineSpacingRule?: LineSpacingRule;
  spaceBefore?: number;
  spaceAfter?: number;
  /**
   * Preserve paragraph style name when replacing generated plain text,
   * so Heading/List styles won't collapse to Normal.
   */
  style?: string;
}

/**
 * 完整格式信息接口
 */
export interface TextFormat {
  font: FontFormat;
  paragraph: ParagraphFormat;
}

/**
 * 选区格式（支持按段落记录）
 */
export interface SelectionFormat extends TextFormat {
  paragraphs?: TextFormat[];
}

export interface MarkdownHeadingStyleTarget {
  level: 1 | 2 | 3;
  text: string;
}

/**
 * 文档搜索结果
 */
export interface SearchResult {
  index: number;
  text: string;
  matchCount: number;
}

/**
 * 段落样本接口
 */
export interface ParagraphSample {
  text: string;
  styleId?: string;
  outlineLevel?: number;
  font: FontFormat;
  paragraph: ParagraphFormat;
  index: number;
}

/**
 * 表格格式样本接口
 */
export interface TableFormatSample {
  rowCount: number;
  columnCount: number;
  index: number;
}

/**
 * 文档格式采样结果接口
 */
export interface DocumentFormatSample {
  headings: ParagraphSample[];
  bodyText: ParagraphSample[];
  lists: ParagraphSample[];
  tables: TableFormatSample[];
}

/**
 * 段落基本信息接口
 */
export interface ParagraphInfo {
  index: number;
  text: string;
  styleId?: string;
  outlineLevel?: number;
  isListItem: boolean;
  listLevel?: number;
  listString?: string;
  pageBreakBefore?: boolean;
  font: FontFormat;
  paragraph: ParagraphFormat;
}

/**
 * 节的页眉页脚信息接口
 */
export interface SectionHeaderFooter {
  sectionIndex: number;
  header: {
    primary?: string;
    firstPage?: string;
    evenPages?: string;
  };
  footer: {
    primary?: string;
    firstPage?: string;
    evenPages?: string;
  };
}

export interface HeaderFooterSnapshot {
  text?: string;
  ooxml?: string;
}

export interface SectionSnapshot {
  sectionIndex: number;
  pageSetup: {
    differentFirstPageHeaderFooter?: boolean;
    oddAndEvenPagesHeaderFooter?: boolean;
  };
  header: {
    primary?: HeaderFooterSnapshot;
    firstPage?: HeaderFooterSnapshot;
    evenPages?: HeaderFooterSnapshot;
  };
  footer: {
    primary?: HeaderFooterSnapshot;
    firstPage?: HeaderFooterSnapshot;
    evenPages?: HeaderFooterSnapshot;
  };
}

/**
 * 段落快照接口（用于回退）
 */
export interface ParagraphSnapshot {
  index: number;
  text: string;
  styleId?: string;
  isListItem: boolean;
  listLevel?: number;
  font: FontFormat;
  paragraph: ParagraphFormat;
}

/**
 * 文档快照接口（OOXML）
 */
export interface DocumentSnapshot {
  ooxml: string;
  createdAt: number;
  description?: string;
  sections?: SectionSnapshot[];
}

/**
 * 内容检查点接口
 */
export interface ContentCheckpoint {
  paragraphCount: number;
  totalCharCount: number;
  paragraphHashes: string[];
}

/**
 * 格式规范接口
 */
export interface FormatSpecification {
  heading1?: { font: FontFormat; paragraph: ParagraphFormat };
  heading2?: { font: FontFormat; paragraph: ParagraphFormat };
  heading3?: { font: FontFormat; paragraph: ParagraphFormat };
  bodyText?: { font: FontFormat; paragraph: ParagraphFormat };
  listItem?: { font: FontFormat; paragraph: ParagraphFormat };
}

/**
 * 颜色修正项接口
 */
export interface ColorCorrectionItem {
  paragraphIndex: number;
  suggestedColor: string;
}

/**
 * 表格数据接口
 */
export interface TableData {
  headers: string[];
  rows: string[][];
}

import type { DocumentIndex, DocumentIndexParagraph } from "./documentIndex";

/** Compact, actionable preflight report that does not expose the full document text. */
export type DocumentQualityIssueKind =
  | "empty_paragraph_run" | "trailing_empty_paragraphs" | "heading_level_jump"
  | "duplicate_heading" | "empty_heading_section" | "long_paragraph"
  | "heading_style_inconsistency" | "missing_page_furniture";

export interface DocumentQualityIssue {
  kind: DocumentQualityIssueKind;
  severity: "info" | "warning";
  message: string;
  paragraphIndices?: number[];
  headingPath?: string[];
}

export interface DocumentQualityReport {
  summary: { paragraphCount: number; headingCount: number; tableCount: number; listItemCount: number; totalCharCount: number; issueCount: number; warningCount: number };
  issues: DocumentQualityIssue[];
}

const LONG_PARAGRAPH_THRESHOLD = 800;
const isEmpty = (paragraph: DocumentIndexParagraph) => paragraph.kind === "empty" || paragraph.textLength === 0;

export function analyzeDocumentQuality(index: DocumentIndex): DocumentQualityReport {
  const issues: DocumentQualityIssue[] = [];
  const paragraphs = index.paragraphs;
  let runStart = -1;
  for (let position = 0; position <= paragraphs.length; position += 1) {
    const paragraph = paragraphs[position];
    if (paragraph && isEmpty(paragraph)) { if (runStart < 0) runStart = position; continue; }
    if (runStart >= 0) {
      const runLength = position - runStart;
      const indices = paragraphs.slice(runStart, position).map((item) => item.index);
      if (position === paragraphs.length) {
        issues.push({ kind: "trailing_empty_paragraphs", severity: "info", message: `文档末尾有 ${runLength} 个空段落，可能造成额外空白页。`, paragraphIndices: indices });
      } else if (runLength >= 2) {
        issues.push({ kind: "empty_paragraph_run", severity: "info", message: `发现连续 ${runLength} 个空段落；建议使用段前/段后间距代替空行。`, paragraphIndices: indices });
      }
      runStart = -1;
    }
  }

  const seenHeadings = new Map<string, number>();
  let previousLevel = 0;
  for (let headingPosition = 0; headingPosition < index.headings.length; headingPosition += 1) {
    const heading = index.headings[headingPosition];
    if (previousLevel > 0 && heading.level > previousLevel + 1) {
      issues.push({ kind: "heading_level_jump", severity: "warning", message: `标题层级从 ${previousLevel} 级直接跳到 ${heading.level} 级。`, paragraphIndices: [heading.index], headingPath: heading.headingPath });
    }
    previousLevel = heading.level;
    const duplicateKey = `${heading.level}:${heading.text}`;
    const previousIndex = seenHeadings.get(duplicateKey);
    if (previousIndex !== undefined) {
      issues.push({ kind: "duplicate_heading", severity: "info", message: `与段落 ${previousIndex} 的 ${heading.level} 级标题重复：${heading.text}`, paragraphIndices: [previousIndex, heading.index], headingPath: heading.headingPath });
    } else seenHeadings.set(duplicateKey, heading.index);

    const nextHeading = index.headings[headingPosition + 1];
    const end = nextHeading ? nextHeading.index : paragraphs.length;
    if (!paragraphs.slice(heading.index + 1, end).some((item) => !isEmpty(item) && item.kind !== "heading")) {
      issues.push({ kind: "empty_heading_section", severity: "warning", message: "该标题下没有正文、列表或表格内容。", paragraphIndices: [heading.index], headingPath: heading.headingPath });
    }
  }

  for (const paragraph of paragraphs) {
    if (paragraph.kind === "body" && paragraph.textLength > LONG_PARAGRAPH_THRESHOLD) {
      issues.push({ kind: "long_paragraph", severity: "info", message: `正文段落约 ${paragraph.textLength} 个字符，建议检查是否应拆分。`, paragraphIndices: [paragraph.index], headingPath: paragraph.headingPath });
    }
  }

  const stylesByLevel = new Map<number, Map<string, number[]>>();
  for (const paragraph of paragraphs.filter((item) => item.kind === "heading")) {
    if (!paragraph.styleId || paragraph.outlineLevel === undefined) continue;
    const styles = stylesByLevel.get(paragraph.outlineLevel) || new Map<string, number[]>();
    styles.set(paragraph.styleId, [...(styles.get(paragraph.styleId) || []), paragraph.index]);
    stylesByLevel.set(paragraph.outlineLevel, styles);
  }
  for (const [level, styles] of stylesByLevel) {
    if (styles.size > 1) issues.push({ kind: "heading_style_inconsistency", severity: "info", message: `${level} 级标题使用了 ${styles.size} 种样式，建议统一标题样式。`, paragraphIndices: [...styles.values()].flat() });
  }

  if (index.headingCount >= 3 && index.headersFooters.length > 0 && index.headersFooters.every((item) => item.headerCharCount === 0 && item.footerCharCount === 0)) {
    issues.push({ kind: "missing_page_furniture", severity: "info", message: "文档已有多个标题，但未检测到页眉或页脚；长文档通常应补充页码或文档标识。" });
  }
  return { summary: { paragraphCount: index.paragraphCount, headingCount: index.headingCount, tableCount: index.tableCount, listItemCount: index.listItemCount, totalCharCount: index.totalCharCount, issueCount: issues.length, warningCount: issues.filter((item) => item.severity === "warning").length }, issues };
}

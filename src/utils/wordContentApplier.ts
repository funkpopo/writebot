import {
  deleteSelection,
  getSelectedText,
  getSelectedTextWithFormat,
  getBodyDefaultFormat,
  normalizeNewParagraphsFormat,
  normalizeInsertedParagraphsFormat,
  insertHtml,
  insertHtmlWithHeadingStyles,
  insertHtmlAtLocation,
  insertHtmlAtLocationWithHeadingStyles,
  insertHtmlAfterParagraph,
  insertHtmlAfterParagraphWithHeadingStyles,
  insertTextAfterParagraph,
  insertTable,
  insertTableAtLocation,
  insertTableFromValues,
  insertText,
  insertTextWithFormat,
  insertTextAtLocation,
  replaceSelectedText,
  replaceSelectedTextWithFormat,
  replaceSelectionWithHtml,
} from "./wordApi";
import { parseMarkdownWithTables, sanitizeMarkdownToPlainText } from "./textSanitizer";
import {
  extractMarkdownHeadingStyleTargets,
  looksLikeMarkdown,
  markdownToWordHtml,
} from "./markdownRenderer";
import type { ParsedContent } from "./textSanitizer";
import type { ExplicitContentFormat } from "./documentText";

const WORD_BODY_PARAGRAPH_HTML_OPTIONS = {
  renderHeadingsAsParagraphs: true,
} as const;

export interface ApplyAiContentOptions {
  /**
   * If true, the function returns "cancelled" when there is no selected text.
   * Useful for context-menu commands where replacement is expected.
   */
  requireSelection?: boolean;
  /**
   * Optional guard shown when no text is selected and insertion would happen at the cursor.
   */
  confirmInsertWithoutSelection?: () => boolean | Promise<boolean>;
  /**
   * Whether plain-text replacement should preserve existing selection format.
   */
  preserveSelectionFormat?: boolean;
  /**
   * When preserving format, whether non-table Markdown should still render as rich text.
   */
  renderMarkdownWhenPreserveFormat?: boolean;
  contentFormat?: ExplicitContentFormat;
}

export interface InsertAiContentOptions {
  location?: "cursor" | "start" | "end";
  contentFormat?: ExplicitContentFormat;
}

export interface InsertAiContentAfterParagraphOptions {
  contentFormat?: ExplicitContentFormat;
}

function parseTabDelimitedTable(rawContent: string): {
  isTabTable: boolean;
  lines: string[];
} {
  const normalized = rawContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const isTabTable =
    lines.length > 0
    && lines.every((line) => line.includes("\t"))
    && lines.some((line) => line.split("\t").length >= 2);

  return { isTabTable, lines };
}

function toTabTableValues(lines: string[][]): string[][] {
  const colCount = Math.max(1, ...lines.map((row) => row.length));
  return lines.map((row) => {
    const normalizedRow = row.slice(0, colCount);
    while (normalizedRow.length < colCount) {
      normalizedRow.push("");
    }
    return normalizedRow;
  });
}

/**
 * 将 tab 分隔表格行转换为 Markdown 管道表，交给 markdownToWordHtml 渲染成
 * 原生 Word 表格（用于按锚点/段落插入路径）。
 */
function tabTableLinesToMarkdownTable(lines: string[]): string {
  const rawRows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  const rows = toTabTableValues(rawRows).map((row) =>
    row.map((cell) => cell.replace(/\|/g, "\\|"))
  );
  const colCount = rows[0]?.length || 1;
  const toLine = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const separator = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
  return [toLine(rows[0] || [""]), separator, ...rows.slice(1).map(toLine)].join("\n");
}

async function insertTableValuesAtCursor(values: string[][]): Promise<void> {
  await insertTableFromValues(values);
  await insertText("\n");
}

async function insertTableValuesAtBodyLocation(
  values: string[][],
  location: "start" | "end"
): Promise<void> {
  const [header = []] = values;
  const rows = values.slice(1);
  await insertTableAtLocation(
    {
      headers: header,
      rows,
    },
    location
  );
  await insertTextAtLocation("\n", location);
}

async function insertParsedSegmentsAtCursor(segments: ParsedContent["segments"]): Promise<void> {
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.content.trim()) {
        await insertHtml(markdownToWordHtml(segment.content, WORD_BODY_PARAGRAPH_HTML_OPTIONS));
      }
      continue;
    }

    await insertTable({ headers: segment.data.headers, rows: segment.data.rows });
    await insertText("\n");
  }
}

async function insertParsedSegmentsAtBodyLocation(
  segments: ParsedContent["segments"],
  location: "start" | "end"
): Promise<void> {
  const ordered = location === "start" ? [...segments].reverse() : segments;

  for (const segment of ordered) {
    if (segment.type === "text") {
      if (segment.content.trim()) {
        await insertHtmlAtLocation(
          markdownToWordHtml(segment.content, WORD_BODY_PARAGRAPH_HTML_OPTIONS),
          location
        );
      }
      continue;
    }

    if (location === "start") {
      await insertTextAtLocation("\n", "start");
      await insertTableAtLocation({ headers: segment.data.headers, rows: segment.data.rows }, "start");
      continue;
    }

    await insertTableAtLocation({ headers: segment.data.headers, rows: segment.data.rows }, "end");
    await insertTextAtLocation("\n", "end");
  }
}

/**
 * 将 LLM 输出中的字面量转义序列（如两字符 \n）转为实际控制字符。
 * JSON 解析通常会处理 \\n → \n，但部分模型会输出双重转义 \\\\n → \\n，
 * 导致到达此处时仍为字面量 \n 而非真正换行。
 */
function normalizeLiteralEscapes(text: string): string {
  return text
    .replace(/\\r\\n/g, "\r\n")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n");
}

interface PlainTextBoundaryOptions {
  enforceTrailingNewline?: boolean;
}

/**
 * sanitizeMarkdownToPlainText() 会 trim 掉首尾空白，可能吞掉用于断段的换行。
 * 这里按原始输入恢复必要的段落边界，避免写入后与相邻段落粘连。
 */
function restorePlainTextBoundaries(
  plainText: string,
  sourceText: string,
  options: PlainTextBoundaryOptions = {},
): string {
  if (!plainText.trim()) return plainText;

  const normalizedSource = String(sourceText ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  let normalized = plainText;
  const sourceHasLeadingNewline = /^\s*\n/u.test(normalizedSource);
  const sourceHasTrailingNewline = /\n\s*$/u.test(normalizedSource);

  if (sourceHasLeadingNewline && !normalized.startsWith("\n")) {
    normalized = `\n${normalized}`;
  }

  if ((sourceHasTrailingNewline || options.enforceTrailingNewline) && !/\r?\n$/u.test(normalized)) {
    normalized = `${normalized}\n`;
  }

  return normalized;
}

export async function applyAiContentToWord(
  content: string,
  options: ApplyAiContentOptions = {}
): Promise<"applied" | "cancelled"> {
  let rawContent = typeof content === "string" ? content : String(content ?? "");
  rawContent = normalizeLiteralEscapes(rawContent);
  if (!rawContent.trim()) return "cancelled";

  const preserveSelectionFormat = options.preserveSelectionFormat ?? true;
  const renderMarkdownWhenPreserveFormat = options.renderMarkdownWhenPreserveFormat ?? true;
  const requestedFormat = options.contentFormat;

  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = parseTabDelimitedTable(rawContent);
  const shouldRenderMarkdown =
    requestedFormat === "table"
    || parsed.hasTable
    || tabTable.isTabTable
    || (
      (requestedFormat === "markdown" || requestedFormat === "html" || looksLikeMarkdown(rawContent))
      && (!preserveSelectionFormat || renderMarkdownWhenPreserveFormat)
    );

  const selectedText = await getSelectedText();
  const hasSelection = selectedText.trim().length > 0;

  if (!hasSelection) {
    if (options.requireSelection) {
      return "cancelled";
    }
    if (options.confirmInsertWithoutSelection) {
      const confirmed = await options.confirmInsertWithoutSelection();
      if (!confirmed) return "cancelled";
    }
  }

  if (shouldRenderMarkdown) {
    if (tabTable.isTabTable) {
      if (hasSelection) {
        await deleteSelection();
      }

      const rawRows = tabTable.lines.map((line) => line.split("\t").map((cell) => cell.trim()));
      const values = toTabTableValues(rawRows);
      await insertTableValuesAtCursor(values);
      return "applied";
    }

    if (parsed.hasTable) {
      if (hasSelection) {
        await deleteSelection();
      }

      await insertParsedSegmentsAtCursor(parsed.segments);
      return "applied";
    }

    const html = markdownToWordHtml(rawContent, WORD_BODY_PARAGRAPH_HTML_OPTIONS);
    if (hasSelection) {
      await replaceSelectionWithHtml(html);
    } else {
      await insertHtml(html);
    }
    return "applied";
  }

  const safeContent = restorePlainTextBoundaries(
    sanitizeMarkdownToPlainText(rawContent),
    rawContent,
  );
  if (!safeContent.trim()) return "cancelled";

  if (!hasSelection) {
    if (preserveSelectionFormat) {
      const { format } = await getSelectedTextWithFormat();
      await insertTextWithFormat(safeContent, format);
    } else {
      await insertText(safeContent);
    }
    return "applied";
  }

  if (preserveSelectionFormat) {
    const { format } = await getSelectedTextWithFormat();
    await replaceSelectedTextWithFormat(safeContent, format);
  } else {
    await replaceSelectedText(safeContent);
  }
  return "applied";
}

export async function insertAiContentToWord(
  content: string,
  options: InsertAiContentOptions = {}
): Promise<"applied" | "cancelled"> {
  let rawContent = typeof content === "string" ? content : String(content ?? "");
  rawContent = normalizeLiteralEscapes(rawContent);
  if (!rawContent.trim()) return "cancelled";

  // 插入前：获取正文默认格式和段落数，用于插入后归一化
  let bodyFormat: Awaited<ReturnType<typeof getBodyDefaultFormat>> = null;
  try {
    bodyFormat = await getBodyDefaultFormat();
  } catch {
    // 空文档或获取失败，跳过格式归一化
  }
  const beforeCount = bodyFormat?.paragraphCount ?? 0;

  const location = options.location || "cursor";
  const requestedFormat = options.contentFormat;
  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = parseTabDelimitedTable(rawContent);

  const maybeNormalize = async () => {
    if (!bodyFormat || beforeCount <= 0) return;
    try {
      if (location === "start") {
        // 新段落插入在文档开头：只归一化真正插入的头部区间。
        await normalizeInsertedParagraphsFormat(-1, beforeCount, bodyFormat);
      } else if (location === "end") {
        await normalizeNewParagraphsFormat(beforeCount, bodyFormat);
      }
      // cursor 插入点未知（可能在文档中部），跳过归一化，避免误改原有段落格式。
    } catch {
      // 归一化失败不影响主流程
    }
  };

  if (tabTable.isTabTable) {
    const rawRows = tabTable.lines.map((line) => line.split("\t").map((cell) => cell.trim()));
    const values = toTabTableValues(rawRows);

    if (location === "start" || location === "end") {
      await insertTableValuesAtBodyLocation(values, location);
    } else {
      await insertTableValuesAtCursor(values);
    }
    await maybeNormalize();
    return "applied";
  }

  if (parsed.hasTable) {
    if (location === "start" || location === "end") {
      await insertParsedSegmentsAtBodyLocation(parsed.segments, location);
    } else {
      await insertParsedSegmentsAtCursor(parsed.segments);
    }
    await maybeNormalize();
    return "applied";
  }

  const shouldRenderMarkdown =
    requestedFormat === "markdown"
    || requestedFormat === "html"
    || looksLikeMarkdown(rawContent);
  if (shouldRenderMarkdown) {
    const html = markdownToWordHtml(rawContent, WORD_BODY_PARAGRAPH_HTML_OPTIONS);
    const headingTargets = extractMarkdownHeadingStyleTargets(rawContent);
    if (location === "start" || location === "end") {
      if (headingTargets.length > 0) {
        await insertHtmlAtLocationWithHeadingStyles(html, location, headingTargets);
      } else {
        await insertHtmlAtLocation(html, location);
      }
    } else if (headingTargets.length > 0) {
      await insertHtmlWithHeadingStyles(html, headingTargets);
    } else {
      await insertHtml(html);
    }
    await maybeNormalize();
    return "applied";
  }

  const plainText = restorePlainTextBoundaries(
    sanitizeMarkdownToPlainText(rawContent),
    rawContent,
    { enforceTrailingNewline: true },
  );
  if (!plainText.trim()) return "cancelled";

  if (location === "start" || location === "end") {
    await insertTextAtLocation(plainText, location);
  } else {
    await insertText(plainText);
  }
  await maybeNormalize();

  return "applied";
}

/**
 * 在指定段落后插入 AI 内容（支持 Markdown/表格渲染为原生 Word 内容、标题样式、格式归一化）。
 * 这是 Agent 结构化写入（insert_at_anchor）的核心提交路径，任何内容形态都不应抛错中断。
 */
export async function insertAiContentAfterParagraph(
  content: string,
  paragraphIndex: number,
  options: InsertAiContentAfterParagraphOptions = {},
): Promise<"applied" | "cancelled"> {
  let rawContent = typeof content === "string" ? content : String(content ?? "");
  rawContent = normalizeLiteralEscapes(rawContent);
  if (!rawContent.trim()) return "cancelled";

  let bodyFormat: Awaited<ReturnType<typeof getBodyDefaultFormat>> = null;
  try {
    bodyFormat = await getBodyDefaultFormat();
  } catch {
    // ignore
  }
  const beforeCount = bodyFormat?.paragraphCount ?? 0;

  const maybeNormalize = async () => {
    if (bodyFormat && beforeCount > 0) {
      try {
        // 只归一化锚点之后真正新插入的段落，避免误改文档尾部原有内容。
        await normalizeInsertedParagraphsFormat(paragraphIndex, beforeCount, bodyFormat);
      } catch {
        // ignore
      }
    }
  };

  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = parseTabDelimitedTable(rawContent);
  const requestedFormat = options.contentFormat;

  // 表格统一走 HTML 表格渲染：Word 的 insertHtml 会将 <table> 转换成原生 Word 表格。
  const renderSource = tabTable.isTabTable
    ? tabTableLinesToMarkdownTable(tabTable.lines)
    : rawContent;

  const shouldRenderRich =
    tabTable.isTabTable
    || parsed.hasTable
    || requestedFormat === "table"
    || requestedFormat === "markdown"
    || requestedFormat === "html"
    || looksLikeMarkdown(rawContent);

  if (shouldRenderRich) {
    const html = markdownToWordHtml(renderSource, WORD_BODY_PARAGRAPH_HTML_OPTIONS);
    const headingTargets = extractMarkdownHeadingStyleTargets(renderSource);
    if (headingTargets.length > 0) {
      await insertHtmlAfterParagraphWithHeadingStyles(html, paragraphIndex, headingTargets);
    } else {
      await insertHtmlAfterParagraph(html, paragraphIndex);
    }
    await maybeNormalize();
    return "applied";
  }

  const plainText = restorePlainTextBoundaries(
    sanitizeMarkdownToPlainText(rawContent),
    rawContent,
    { enforceTrailingNewline: true },
  );
  if (!plainText.trim()) return "cancelled";

  await insertTextAfterParagraph(plainText, paragraphIndex);
  await maybeNormalize();
  return "applied";
}

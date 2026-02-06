import {
  deleteSelection,
  getSelectedText,
  getSelectedTextWithFormat,
  insertHtml,
  insertHtmlAtLocation,
  insertHtmlAtLocationWithHeadingStyles,
  insertHtmlWithHeadingStyles,
  insertTable,
  insertTableAtLocation,
  insertTableFromValues,
  insertText,
  insertTextWithFormat,
  insertTextAtLocation,
  replaceSelectedText,
  replaceSelectedTextWithFormat,
  replaceSelectionWithHtml,
  replaceSelectionWithHtmlAndHeadingStyles,
} from "./wordApi";
import { parseMarkdownWithTables, sanitizeMarkdownToPlainText } from "./textSanitizer";
import {
  extractMarkdownHeadingStyleTargets,
  looksLikeMarkdown,
  markdownToWordHtml,
} from "./markdownRenderer";
import type { ParsedContent } from "./textSanitizer";

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
}

export interface InsertAiContentOptions {
  location?: "cursor" | "start" | "end";
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
        await insertHtml(markdownToWordHtml(segment.content));
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
        await insertHtmlAtLocation(markdownToWordHtml(segment.content), location);
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

export async function applyAiContentToWord(
  content: string,
  options: ApplyAiContentOptions = {}
): Promise<"applied" | "cancelled"> {
  const rawContent = typeof content === "string" ? content : String(content ?? "");
  if (!rawContent.trim()) return "cancelled";

  const preserveSelectionFormat = options.preserveSelectionFormat ?? true;
  const renderMarkdownWhenPreserveFormat = options.renderMarkdownWhenPreserveFormat ?? true;

  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = parseTabDelimitedTable(rawContent);
  const shouldRenderMarkdown =
    parsed.hasTable
    || tabTable.isTabTable
    || (
      looksLikeMarkdown(rawContent)
      && (!preserveSelectionFormat || renderMarkdownWhenPreserveFormat)
    );

  try {
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

      const html = markdownToWordHtml(rawContent);
      const headingTargets = extractMarkdownHeadingStyleTargets(rawContent);
      if (hasSelection) {
        if (headingTargets.length > 0) {
          await replaceSelectionWithHtmlAndHeadingStyles(html, headingTargets);
        } else {
          await replaceSelectionWithHtml(html);
        }
      } else if (headingTargets.length > 0) {
        await insertHtmlWithHeadingStyles(html, headingTargets);
      } else {
        await insertHtml(html);
      }
      return "applied";
    }

    const safeContent = sanitizeMarkdownToPlainText(rawContent);
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
  } catch (error) {
    console.error("应用内容失败:", error);

    const fallbackText = sanitizeMarkdownToPlainText(rawContent);
    if (!fallbackText.trim()) return "cancelled";

    try {
      const selectedText = await getSelectedText();
      const hasSelection = selectedText.trim().length > 0;
      if (!hasSelection && options.requireSelection) {
        return "cancelled";
      }

      if (hasSelection) {
        if (preserveSelectionFormat) {
          const { format } = await getSelectedTextWithFormat();
          await replaceSelectedTextWithFormat(fallbackText, format);
        } else {
          await replaceSelectedText(fallbackText);
        }
      } else {
        if (preserveSelectionFormat) {
          const { format } = await getSelectedTextWithFormat();
          await insertTextWithFormat(fallbackText, format);
        } else {
          await insertText(fallbackText);
        }
      }
      return "applied";
    } catch (fallbackError) {
      console.error("回退插入也失败:", fallbackError);
      throw fallbackError;
    }
  }
}

export async function insertAiContentToWord(
  content: string,
  options: InsertAiContentOptions = {}
): Promise<"applied" | "cancelled"> {
  const rawContent = typeof content === "string" ? content : String(content ?? "");
  if (!rawContent.trim()) return "cancelled";

  const location = options.location || "cursor";
  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = parseTabDelimitedTable(rawContent);

  if (tabTable.isTabTable) {
    const rawRows = tabTable.lines.map((line) => line.split("\t").map((cell) => cell.trim()));
    const values = toTabTableValues(rawRows);

    if (location === "start" || location === "end") {
      await insertTableValuesAtBodyLocation(values, location);
    } else {
      await insertTableValuesAtCursor(values);
    }
    return "applied";
  }

  if (parsed.hasTable) {
    if (location === "start" || location === "end") {
      await insertParsedSegmentsAtBodyLocation(parsed.segments, location);
    } else {
      await insertParsedSegmentsAtCursor(parsed.segments);
    }
    return "applied";
  }

  const shouldRenderMarkdown = looksLikeMarkdown(rawContent);
  if (shouldRenderMarkdown) {
    const html = markdownToWordHtml(rawContent);
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
    return "applied";
  }

  const plainText = sanitizeMarkdownToPlainText(rawContent);
  if (!plainText.trim()) return "cancelled";

  if (location === "start" || location === "end") {
    await insertTextAtLocation(plainText, location);
  } else {
    await insertText(plainText);
  }

  return "applied";
}

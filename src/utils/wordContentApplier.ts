import {
  deleteSelection,
  getSelectedText,
  getSelectedTextWithFormat,
  insertHtml,
  insertTable,
  insertTableFromValues,
  insertText,
  replaceSelectedText,
  replaceSelectedTextWithFormat,
  replaceSelectionWithHtml,
} from "./wordApi";
import { parseMarkdownWithTables, sanitizeMarkdownToPlainText } from "./textSanitizer";
import { looksLikeMarkdown, markdownToWordHtml } from "./markdownRenderer";

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
}

function isPureTabDelimitedTable(rawContent: string): {
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

export async function applyAiContentToWord(
  content: string,
  options: ApplyAiContentOptions = {}
): Promise<"applied" | "cancelled"> {
  const rawContent = typeof content === "string" ? content : String(content ?? "");
  if (!rawContent.trim()) return "cancelled";

  const parsed = parseMarkdownWithTables(rawContent);
  const tabTable = isPureTabDelimitedTable(rawContent);
  const shouldRenderMarkdown =
    parsed.hasTable || tabTable.isTabTable || looksLikeMarkdown(rawContent);

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
        const colCount = Math.max(1, ...rawRows.map((row) => row.length));
        const values = rawRows.map((row) => {
          const normalizedRow = row.slice(0, colCount);
          while (normalizedRow.length < colCount) {
            normalizedRow.push("");
          }
          return normalizedRow;
        });

        await insertTableFromValues(values);
        await insertText("\n");
        return "applied";
      }

      if (parsed.hasTable) {
        if (hasSelection) {
          await deleteSelection();
        }

        for (const segment of parsed.segments) {
          if (segment.type === "text") {
            if (segment.content.trim()) {
              await insertHtml(markdownToWordHtml(segment.content));
            }
            continue;
          }

          await insertTable({
            headers: segment.data.headers,
            rows: segment.data.rows,
          });
          await insertText("\n");
        }

        return "applied";
      }

      const html = markdownToWordHtml(rawContent);
      if (hasSelection) {
        await replaceSelectionWithHtml(html);
      } else {
        await insertHtml(html);
      }
      return "applied";
    }

    const safeContent = sanitizeMarkdownToPlainText(rawContent);
    if (!safeContent.trim()) return "cancelled";

    if (!hasSelection) {
      await insertText(safeContent);
      return "applied";
    }

    const { format } = await getSelectedTextWithFormat();
    await replaceSelectedTextWithFormat(safeContent, format);
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
        await replaceSelectedText(fallbackText);
      } else {
        await insertText(fallbackText);
      }
      return "applied";
    } catch (fallbackError) {
      console.error("回退插入也失败:", fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Convert common Markdown constructs to plain text.
 *
 * Goal: make AI outputs safe to insert into Word as plain text (avoid headings, fences, etc.)
 * Note: This is intentionally conservative; it aims to remove "formatting markers" while
 * preserving readable content and line breaks.
 */

// Emoji handling:
// - We want to ensure LLM outputs don't contain emoji characters.
// - Prefer Unicode property escapes when available (modern Chromium/WebView2),
//   but fall back to a broad codepoint-range heuristic.
let EMOJI_PRESENTATION_RE: RegExp | null = null;
try {
  // Matches characters that are default rendered as emoji.
  EMOJI_PRESENTATION_RE = new RegExp("\\p{Emoji_Presentation}", "gu");
} catch {
  EMOJI_PRESENTATION_RE = null;
}

// Fallback range matcher for environments without Unicode property escapes.
// This intentionally targets common emoji blocks; it is not a complete Unicode emoji parser.
const EMOJI_FALLBACK_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu;

/**
 * Strip emoji-like characters from text.
 * This is a best-effort filter (prompt instructions + runtime sanitization).
 */
export function stripEmojis(input: string): string {
  if (!input) return "";
  let text = String(input);

  // Remove emoji presentation selectors / joiners / keycap combiners.
  // - FE0F: emoji variation selector
  // - FE0E: text variation selector
  // - 200D: ZWJ (emoji sequences)
  // - 20E3: combining enclosing keycap
  text = text.replace(/[\u200D\uFE0E\uFE0F\u20E3]/g, "");

  // Skin tone modifiers.
  text = text.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");

  if (EMOJI_PRESENTATION_RE) {
    return text.replace(EMOJI_PRESENTATION_RE, "");
  }
  return text.replace(EMOJI_FALLBACK_RE, "");
}

export function sanitizeMarkdownToPlainText(input: string): string {
  if (!input) return "";

  let text = stripEmojis(String(input));

  // Normalize newlines to simplify regex logic.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Convert Markdown tables to tab-delimited plain text.
  // This makes the output much easier to read in chat and easier to paste/convert into a Word table.
  text = convertMarkdownTablesToPlainText(text);

  // Remove fenced code blocks while keeping inner text.
  // Handles:
  // ```
  // code
  // ```
  // and ```json ... ```
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_, code: string) => {
    return code.replace(/\n$/, "");
  });
  text = text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, (_, code: string) => {
    return code.replace(/\n$/, "");
  });

  // Inline code: `text` -> text
  text = text.replace(/`([^`]+)`/g, "$1");

  // Headings: ### Title -> Title
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Blockquotes: > quote -> quote
  text = text.replace(/^\s{0,3}>\s?/gm, "");

  // Horizontal rules -> remove line
  text = text.replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, "");

  // Unordered lists: - item / * item / + item -> • item
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "• ");

  // Ordered lists: 1) item / 1. item -> 1. item
  text = text.replace(/^\s{0,3}(\d+)[.)]\s+/gm, "$1. ");

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");

  // Links: [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Bold/italic markers - keep content.
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  text = text.replace(/__([\s\S]+?)__/g, "$1");

  // Italic: *text* / _text_ (avoid greedily eating across lines)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2");

  // Trim line trailing spaces.
  text = text.replace(/[ \t]+$/gm, "");

  // Remove excessive leading/trailing blank lines.
  return text.trim();
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("|")) return false;

  // Strip optional leading/trailing pipes before splitting.
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);

  const parts = body.split("|").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return false;

  // Match typical separator cells: --- / :--- / ---: / :---:
  return parts.every((part) => /^:?-{3,}:?$/.test(part));
}

function isPotentialMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("|")) return false;
  // Avoid treating separator rows as normal rows.
  if (isMarkdownTableSeparatorLine(trimmed)) return false;
  // Require some non-pipe content to reduce false positives.
  return /[^|\s]/.test(trimmed);
}

function isPotentialTabDelimitedTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("\t")) return false;
  const parts = trimmed.split("\t");
  if (parts.length < 2) return false;
  return parts.some((part) => part.trim().length > 0);
}

function splitTabDelimitedRow(line: string): string[] {
  // Keep empty cells (e.g. "a\t\tb") while trimming whitespace.
  return line.split("\t").map((cell) => cell.trim());
}

function splitMarkdownTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);

  const cells: string[] = [];
  let current = "";

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      // Unescape common escaped characters inside table cells.
      if (next === "|" || next === "\\") {
        current += next;
        i += 1;
        continue;
      }
      // Keep the backslash if it's not escaping a pipe/backslash.
      current += ch;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeCells(cells: string[], colCount: number): string[] {
  const normalized = cells.slice(0, colCount);
  while (normalized.length < colCount) normalized.push("");
  return normalized;
}

function convertMarkdownTablesToPlainText(input: string): string {
  if (!input) return "";
  const lines = input.split("\n");
  const out: string[] = [];

  // Avoid converting table-like text inside fenced code blocks.
  // We can detect fences here because this runs before fence removal.
  let inCodeFence = false;

  let i = 0;
  while (i < lines.length) {
    const fenceLine = lines[i].trim();
    if (fenceLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      out.push(lines[i]);
      i += 1;
      continue;
    }

    if (inCodeFence) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const header = lines[i];
    const separator = lines[i + 1];

    if (
      typeof separator === "string" &&
      isPotentialMarkdownTableRow(header) &&
      isMarkdownTableSeparatorLine(separator)
    ) {
      // Determine column count from the separator row (most reliable).
      const separatorCols = splitMarkdownTableRow(separator);
      const colCount = Math.max(separatorCols.length, 1);

      const tableLines: string[] = [header];
      let j = i + 2;
      while (j < lines.length) {
        const row = lines[j];
        if (!row.trim()) break;
        if (!isPotentialMarkdownTableRow(row)) break;
        tableLines.push(row);
        j += 1;
      }

      const headerCells = normalizeCells(splitMarkdownTableRow(header), colCount);
      const rowCells = tableLines.slice(1).map((row) =>
        normalizeCells(splitMarkdownTableRow(row), colCount)
      );

      // Emit a tab-delimited block (no separator row).
      out.push(headerCells.join("\t"));
      for (const row of rowCells) {
        out.push(row.join("\t"));
      }

      i = j;
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }

  return out.join("\n");
}

/**
 * Markdown 表格数据结构
 */
export interface MarkdownTableData {
  headers: string[];
  rows: string[][];
  startIndex: number;
  endIndex: number;
}

/**
 * 解析结果：包含表格和非表格内容
 */
export interface ParsedContent {
  segments: Array<
    | { type: "text"; content: string }
    | { type: "table"; data: MarkdownTableData }
  >;
  hasTable: boolean;
}

/**
 * 从 Markdown 文本中提取表格数据和非表格内容
 * 用于在 Word 中插入真正的表格
 */
export function parseMarkdownWithTables(input: string): ParsedContent {
  if (!input) {
    return { segments: [], hasTable: false };
  }

  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const segments: ParsedContent["segments"] = [];
  let hasTable = false;
  let inCodeFence = false;
  let currentTextLines: string[] = [];

  const cleanCell = (value: string): string => {
    // Markdown table cells are conceptually single-line. Flatten accidental newlines.
    const singleLine = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+/g, " ").trim();
    return sanitizeMarkdownToPlainText(singleLine);
  };

  const flushText = () => {
    if (currentTextLines.length > 0) {
      segments.push({ type: "text", content: currentTextLines.join("\n") });
      currentTextLines = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const fenceLine = lines[i].trim();
    if (fenceLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      currentTextLines.push(lines[i]);
      i += 1;
      continue;
    }

    if (inCodeFence) {
      currentTextLines.push(lines[i]);
      i += 1;
      continue;
    }

    // Support tab-delimited tables. This is important because sanitizeMarkdownToPlainText()
    // converts Markdown pipe tables into tab-delimited text for readability.
    if (isPotentialTabDelimitedTableRow(lines[i])) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const row = lines[j];
        if (!row.trim()) break;
        if (!isPotentialTabDelimitedTableRow(row)) break;
        tableLines.push(row);
        j += 1;
      }

      // Require at least header + 1 row to reduce false positives.
      if (tableLines.length >= 2) {
        flushText();

        const rawCells = tableLines.map(splitTabDelimitedRow);
        const colCount = Math.max(1, ...rawCells.map((row) => row.length));
        const normalized = rawCells.map((row) => normalizeCells(row, colCount).map(cleanCell));

        segments.push({
          type: "table",
          data: {
            headers: normalized[0],
            rows: normalized.slice(1),
            startIndex: i,
            endIndex: j - 1,
          },
        });

        hasTable = true;
        i = j;
        continue;
      }
    }

    const header = lines[i];
    const separator = lines[i + 1];

    if (
      typeof separator === "string" &&
      isPotentialMarkdownTableRow(header) &&
      isMarkdownTableSeparatorLine(separator)
    ) {
      // Found a table - flush any pending text first
      flushText();

      const separatorCols = splitMarkdownTableRow(separator);
      const colCount = Math.max(separatorCols.length, 1);

      const tableLines: string[] = [header];
      let j = i + 2;
      while (j < lines.length) {
        const row = lines[j];
        if (!row.trim()) break;
        if (!isPotentialMarkdownTableRow(row)) break;
        tableLines.push(row);
        j += 1;
      }

      const headerCells = normalizeCells(splitMarkdownTableRow(header), colCount).map(cleanCell);
      const rowCells = tableLines.slice(1).map((row) =>
        normalizeCells(splitMarkdownTableRow(row), colCount).map(cleanCell)
      );

      segments.push({
        type: "table",
        data: {
          headers: headerCells,
          rows: rowCells,
          startIndex: i,
          endIndex: j - 1,
        },
      });

      hasTable = true;
      i = j;
      continue;
    }

    currentTextLines.push(lines[i]);
    i += 1;
  }

  // Flush any remaining text
  flushText();

  return { segments, hasTable };
}

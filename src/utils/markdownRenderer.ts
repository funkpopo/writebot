import { stripEmojis } from "./textSanitizer";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(text: string): string {
  // Same escaping rules as normal text, but kept separate for clarity.
  return escapeHtml(text);
}

function normalizeUrl(raw: string): string | null {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return null;

  const lower = url.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("#")
  ) {
    return url;
  }

  // Block potentially dangerous protocols (e.g. javascript:, data:).
  return null;
}

function renderInlineMarkdown(raw: string): string {
  const input = typeof raw === "string" ? raw : String(raw ?? "");

  // Protect code spans / links / images from subsequent escaping & emphasis regex passes.
  const tokens: Array<{ key: string; html: string }> = [];
  let text = input;

  const makeKey = (prefix: string) => `\u0000${prefix}${tokens.length}\u0000`;

  // Images: ![alt](url) -> alt (we intentionally do not embed remote images in Word)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string) => {
    const key = makeKey("IMG");
    tokens.push({ key, html: escapeHtml(alt || "") });
    return key;
  });

  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const key = makeKey("CODE");
    tokens.push({ key, html: `<code>${escapeHtml(code)}</code>` });
    return key;
  });

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
    const key = makeKey("LINK");
    const safeUrl = normalizeUrl(url);
    if (!safeUrl) {
      // Unsafe / unsupported URL -> degrade gracefully to "text (url)".
      tokens.push({ key, html: `${escapeHtml(label)} (${escapeHtml(url)})` });
      return key;
    }
    tokens.push({
      key,
      html: `<a href="${escapeHtmlAttr(safeUrl)}">${escapeHtml(label)}</a>`,
    });
    return key;
  });

  // Escape everything else.
  text = escapeHtml(text);

  // Strikethrough: ~~text~~
  text = text.replace(/~~([\s\S]+?)~~/g, "<del>$1</del>");

  // Bold: **text** / __text__
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");

  // Italic: *text* / _text_
  // Keep this conservative to avoid eating across lines and avoid conflicting with bold markers.
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  // Restore protected tokens.
  for (const token of tokens) {
    text = text.split(token.key).join(token.html);
  }

  return text;
}

function isHorizontalRuleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function parseHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return { level: match[1].length, text: match[2] };
}

function parseUnorderedListItem(line: string): string | null {
  const match = line.match(/^\s{0,3}[-*+]\s+(.+?)\s*$/);
  return match ? match[1] : null;
}

function parseOrderedListItem(line: string): string | null {
  const match = line.match(/^\s{0,3}\d+[.)]\s+(.+?)\s*$/);
  return match ? match[1] : null;
}

function parseBlockquoteLine(line: string): string | null {
  const match = line.match(/^\s{0,3}>\s?(.*)$/);
  return match ? match[1] : null;
}

export interface MarkdownHeadingStyleTarget {
  level: 1 | 2 | 3;
  text: string;
}

function normalizeHeadingTargetText(raw: string): string {
  let text = stripEmojis(String(raw || ""));

  // Keep only the rendered heading label for inline markdown constructs.
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/~~([\s\S]+?)~~/g, "$1");
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, "$1");
  text = text.replace(/__([\s\S]+?)__/g, "$1");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2");

  return text.replace(/\s+/g, " ").trim();
}

export function extractMarkdownHeadingStyleTargets(input: string): MarkdownHeadingStyleTarget[] {
  if (!input) return [];

  const text = stripEmojis(String(input)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const targets: MarkdownHeadingStyleTarget[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const heading = parseHeading(line);
    if (!heading) continue;
    if (heading.level < 1 || heading.level > 3) continue;

    const normalizedText = normalizeHeadingTargetText(heading.text);
    if (!normalizedText) continue;

    targets.push({
      level: heading.level as 1 | 2 | 3,
      text: normalizedText,
    });
  }

  return targets;
}

export function looksLikeMarkdown(input: string): boolean {
  if (!input) return false;
  const text = String(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (/```/.test(text)) return true;
  if (/^\s{0,3}#{1,6}\s+\S/m.test(text)) return true;
  if (/^\s{0,3}>\s+\S/m.test(text)) return true;
  if (/^\s{0,3}[-*+]\s+\S/m.test(text)) return true;
  if (/^\s{0,3}\d+[.)]\s+\S/m.test(text)) return true;
  if (/\*\*[\s\S]+?\*\*/.test(text) || /__[\s\S]+?__/.test(text)) return true;
  if (/`[^`]+`/.test(text)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) return true;
  if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m.test(text)) return true;

  // Markdown tables (very common in LLM outputs)
  if (/\|/.test(text) && /\n/.test(text)) {
    // Header + separator row.
    const tableLike = /^\s*\|?.+\|.+\|?\s*$\n^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
    if (tableLike.test(text)) return true;
  }

  return false;
}

/**
 * Convert a Markdown-ish string into a safe HTML fragment that Word can ingest via `insertHtml`.
 *
 * Scope (intentionally conservative):
 * - headings (# .. ######)
 * - unordered / ordered lists
 * - bold / italic / strike / inline code / links
 * - fenced code blocks
 * - blockquotes (simple)
 * - horizontal rules
 *
 * Notes:
 * - This intentionally does NOT support raw HTML passthrough for safety.
 * - Tables are handled separately by `parseMarkdownWithTables()` + `insertTable()`.
 */
export function markdownToWordHtml(input: string): string {
  const raw = stripEmojis(typeof input === "string" ? input : String(input ?? ""));
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return "<div></div>";

  const lines = text.split("\n");
  const blocks: string[] = [];

  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  let inCodeFence = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join("\n");
    const html = renderInlineMarkdown(joined).replace(/\n/g, "<br />");
    if (html.trim()) {
      blocks.push(`<p>${html}</p>`);
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    const items = listItems.map((item) => `<li>${item}</li>`).join("");
    blocks.push(`<${listType}>${items}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (!inCodeFence) return;
    const code = codeLines.join("\n");
    blocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    inCodeFence = false;
    codeLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fenceLine = line.trim();
    if (fenceLine.startsWith("```")) {
      if (inCodeFence) {
        // End fence
        flushCode();
      } else {
        // Start fence
        flushParagraph();
        flushList();
        inCodeFence = true;
        codeLines = [];
      }
      i += 1;
      continue;
    }

    if (inCodeFence) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      i += 1;
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr />");
      i += 1;
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      flushParagraph();
      flushList();
      const h = Math.min(Math.max(heading.level, 1), 6);
      blocks.push(`<h${h}>${renderInlineMarkdown(heading.text)}</h${h}>`);
      i += 1;
      continue;
    }

    // Blockquotes (simple: consecutive quote lines -> one blockquote)
    const quoteStart = parseBlockquoteLine(line);
    if (quoteStart !== null) {
      flushParagraph();
      flushList();
      const quoteLines: string[] = [quoteStart];
      let j = i + 1;
      while (j < lines.length) {
        const q = parseBlockquoteLine(lines[j]);
        if (q === null) break;
        quoteLines.push(q);
        j += 1;
      }
      const quoteHtml = renderInlineMarkdown(quoteLines.join("\n")).replace(/\n/g, "<br />");
      blocks.push(`<blockquote><p>${quoteHtml}</p></blockquote>`);
      i = j;
      continue;
    }

    const ulItem = parseUnorderedListItem(line);
    if (ulItem !== null) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(renderInlineMarkdown(ulItem));
      i += 1;
      continue;
    }

    const olItem = parseOrderedListItem(line);
    if (olItem !== null) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(renderInlineMarkdown(olItem));
      i += 1;
      continue;
    }

    // Normal paragraph line
    paragraphLines.push(line);
    i += 1;
  }

  // Flush any pending state.
  if (inCodeFence) flushCode();
  flushParagraph();
  flushList();

  return `<div>${blocks.join("")}</div>`;
}


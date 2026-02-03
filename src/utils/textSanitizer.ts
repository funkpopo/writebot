/**
 * Convert common Markdown constructs to plain text.
 *
 * Goal: make AI outputs safe to insert into Word as plain text (avoid headings, fences, etc.)
 * Note: This is intentionally conservative; it aims to remove "formatting markers" while
 * preserving readable content and line breaks.
 */

export function sanitizeMarkdownToPlainText(input: string): string {
  if (!input) return "";

  let text = String(input);

  // Normalize newlines to simplify regex logic.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

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


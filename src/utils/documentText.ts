import { sanitizeMarkdownToPlainText } from "./textSanitizer";

export type ExplicitContentFormat = "plain_text" | "markdown" | "html" | "table";

export function normalizeDocumentText(value: string): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stableTextHash(value: string): string {
  const normalized = normalizeDocumentText(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildExcerpt(value: string, maxLength = 120): string {
  const normalized = normalizeDocumentText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function resolveExpectedPlainText(content: string, contentFormat: ExplicitContentFormat): string {
  const raw = String(content ?? "");
  switch (contentFormat) {
    case "plain_text":
    case "table":
      return raw;
    case "markdown":
    case "html":
      return sanitizeMarkdownToPlainText(raw);
    default:
      return raw;
  }
}


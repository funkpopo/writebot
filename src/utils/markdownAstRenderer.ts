import type { Content, PhrasingContent, Root } from "mdast";
import { unified } from "unified";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

export interface MarkdownAstRenderOptions {
  renderHeadingsAsParagraphs?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  return /^(?:(?:https?|mailto|tel):|#)/i.test(value) ? value : null;
}

function renderInline(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
        return escapeHtml(node.value);
      case "break":
        return "<br />";
      case "strong":
        return `<strong>${renderInline(node.children)}</strong>`;
      case "emphasis":
        return `<em>${renderInline(node.children)}</em>`;
      case "delete":
        return `<del>${renderInline(node.children)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml(node.value)}</code>`;
      case "link": {
        const href = normalizeUrl(node.url);
        const label = renderInline(node.children);
        return href ? `<a href="${escapeHtml(href)}">${label}</a>` : `${label} (${escapeHtml(node.url)})`;
      }
      case "image":
        return escapeHtml(node.alt || "");
      case "html":
        return escapeHtml(node.value);
      default:
        return "children" in node
          ? renderInline(node.children as PhrasingContent[])
          : "";
    }
  }).join("");
}

function renderListItem(children: Content[], options: MarkdownAstRenderOptions): string {
  return children.map((child, index) => {
    if (child.type === "paragraph") {
      const content = renderInline(child.children);
      return index === 0 ? content : `<p>${content}</p>`;
    }
    return renderBlock(child, options);
  }).join("");
}

function renderBlock(node: Content, options: MarkdownAstRenderOptions): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${renderInline(node.children)}</p>`;
    case "heading": {
      const content = renderInline(node.children);
      if (options.renderHeadingsAsParagraphs) return `<p>${content}</p>`;
      return `<h${node.depth}>${content}</h${node.depth}>`;
    }
    case "blockquote":
      return `<blockquote>${node.children.map((child) => renderBlock(child, options)).join("")}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const items = node.children
        .map((item) => `<li>${renderListItem(item.children, options)}</li>`)
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case "code":
      return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
    case "thematicBreak":
      return "<hr />";
    case "table": {
      const rows = node.children.map((row, rowIndex) => {
        const tag = rowIndex === 0 ? "th" : "td";
        return `<tr>${row.children.map((cell) => `<${tag}>${renderInline(cell.children)}</${tag}>`).join("")}</tr>`;
      });
      const head = rows.length ? `<thead>${rows[0]}</thead>` : "";
      const body = rows.length > 1 ? `<tbody>${rows.slice(1).join("")}</tbody>` : "";
      return `<table border="1" style="border-collapse:collapse;">${head}${body}</table>`;
    }
    case "html":
      return `<p>${escapeHtml(node.value)}</p>`;
    default:
      return "children" in node
        ? (node.children as Content[]).map((child) => renderBlock(child, options)).join("")
        : "";
  }
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks);

export function parseMarkdownAst(input: string): Root {
  const parsed = markdownProcessor.parse(input);
  return markdownProcessor.runSync(parsed) as Root;
}

export function renderMarkdownAstToWordHtml(
  input: string,
  options: MarkdownAstRenderOptions = {},
): string {
  const root = parseMarkdownAst(input);
  return `<div>${root.children.map((node) => renderBlock(node, options)).join("")}</div>`;
}

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Components } from "react-markdown";

export interface MarkdownViewProps {
  content: string;
  className?: string;
}

const components: Components = {
  a: ({ href, children, ...props }) => {
    // Avoid rendering unsafe protocols.
    const safeHref =
      typeof href === "string" &&
      (href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#"))
        ? href
        : undefined;

    return (
      <a
        href={safeHref}
        target={safeHref ? "_blank" : undefined}
        rel={safeHref ? "noreferrer noopener" : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
  table: ({ children, ...props }) => (
    <div style={{ overflowX: "auto" }}>
      <table {...props}>{children}</table>
    </div>
  ),
  img: ({ alt }) => <span>{alt || ""}</span>,
};

const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className }) => {
  const text = typeof content === "string" ? content : String(content ?? "");
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownView;

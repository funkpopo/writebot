import { describe, expect, it } from "bun:test";
import { markdownToWordHtml } from "../markdownRenderer";

describe("markdownToWordHtml", () => {
  it("renders markdown headings as body paragraphs when requested", () => {
    const html = markdownToWordHtml("# 一级标题\n\n这里是正文。", {
      renderHeadingsAsParagraphs: true,
    });

    expect(html).toContain("<p>一级标题</p>");
    expect(html).toContain("<p>这里是正文。</p>");
    expect(html).not.toContain("<h1>");
  });

  it("keeps default heading rendering when no body-paragraph override is provided", () => {
    const html = markdownToWordHtml("# 一级标题\n\n这里是正文。");

    expect(html).toContain("<h1>一级标题</h1>");
    expect(html).toContain("<p>这里是正文。</p>");
  });
});

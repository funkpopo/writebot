import { describe, expect, it } from "bun:test";
import {
  extractWordHtmlPlainText,
  markdownToWordHtml,
  markdownToWordVerificationText,
} from "../markdownRenderer";
import { resolveExpectedPlainText } from "../documentText";

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

  it("renders markdown pipe tables as native HTML tables", () => {
    const html = markdownToWordHtml(
      "前置段落\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |\n\n后置段落",
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th>名称</th>");
    expect(html).toContain("<td>苹果</td>");
    expect(html).toContain("<td>5</td>");
    expect(html).toContain("<p>前置段落</p>");
    expect(html).toContain("<p>后置段落</p>");
    expect(html).not.toContain("| 名称 |");
  });

  it("renders inline markdown inside table cells", () => {
    const html = markdownToWordHtml("| A | B |\n| --- | --- |\n| **加粗** | [链接](https://example.com) |");

    expect(html).toContain("<td><strong>加粗</strong></td>");
    expect(html).toContain('<a href="https://example.com">链接</a>');
  });

  it("does not treat pipe rows without a separator as tables", () => {
    const html = markdownToWordHtml("a | b\n继续正文");

    expect(html).not.toContain("<table");
  });
});

describe("markdownToWordVerificationText", () => {
  it("matches what Word list paragraphs will contain (no bullet markers)", () => {
    const text = markdownToWordVerificationText("- 第一点\n- 第二点\n1. 第三点");

    expect(text).toContain("第一点");
    expect(text).toContain("第三点");
    expect(text).not.toContain("•");
    expect(text).not.toMatch(/1\.\s/);
  });

  it("keeps only link labels (Word hyperlink text excludes the URL)", () => {
    const text = markdownToWordVerificationText("参考 [官方文档](https://example.com/docs) 获取详情");

    expect(text).toContain("官方文档");
    expect(text).not.toContain("https://example.com/docs");
  });

  it("flattens tables into cell text without pipes", () => {
    const text = markdownToWordVerificationText("| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |");

    expect(text).toContain("名称");
    expect(text).toContain("苹果");
    expect(text).not.toContain("|");
  });

  it("unescapes html entities emitted by the renderer", () => {
    const text = markdownToWordVerificationText("A & B < C \"引号\"");

    expect(text).toContain("A & B < C \"引号\"");
    expect(text).not.toContain("&amp;");
  });
});

describe("extractWordHtmlPlainText", () => {
  it("turns block boundaries into newlines and strips inline tags", () => {
    const text = extractWordHtmlPlainText("<div><p>甲</p><p><strong>乙</strong><br />丙</p></div>");

    expect(text).toBe("甲\n乙\n丙");
  });
});

describe("resolveExpectedPlainText", () => {
  it("uses rendered verification text for markdown content", () => {
    const expected = resolveExpectedPlainText("- 项目 [链接](https://example.com)", "markdown");

    expect(expected).toContain("项目");
    expect(expected).toContain("链接");
    expect(expected).not.toContain("•");
    expect(expected).not.toContain("https://example.com");
  });

  it("keeps plain text content untouched", () => {
    expect(resolveExpectedPlainText("原文\n保持", "plain_text")).toBe("原文\n保持");
  });
});

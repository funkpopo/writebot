import { describe, expect, it } from "bun:test";
import { __formatAiIntegrationInternals } from "../aiIntegration";

describe("__formatAiIntegrationInternals.parseJSONObjectFromContent", () => {
  it("extracts JSON object from fenced noisy content", () => {
    const content = [
      "这是模型解释说明，不是 JSON。",
      "```json",
      "{\"ok\":true,\"nested\":{\"value\":42}}",
      "```",
      "以上是结果。",
    ].join("\n");

    const parsed = __formatAiIntegrationInternals.parseJSONObjectFromContent(content);
    expect(parsed).toEqual({
      ok: true,
      nested: { value: 42 },
    });
  });

  it("extracts balanced JSON object from mixed prose", () => {
    const content = "前缀文本 {\"a\":1,\"b\":{\"c\":\"x\"}} 后缀文本";
    const parsed = __formatAiIntegrationInternals.parseJSONObjectFromContent(content);
    expect(parsed).toEqual({
      a: 1,
      b: { c: "x" },
    });
  });
});

describe("__formatAiIntegrationInternals.parseFormatAnalysisResult", () => {
  it("parses noisy JSON and filters invalid analysis items", () => {
    const content = [
      "以下是分析结果：",
      "```json",
      JSON.stringify({
        formatSpec: {
          bodyText: {
            font: { name: "宋体", size: 12 },
            paragraph: { lineSpacing: 1.5, lineSpacingRule: "multiple" },
          },
        },
        inconsistencies: ["  标题样式不一致  ", "", 123],
        suggestions: [" 先统一标题 ", " ", null],
        colorAnalysis: [
          {
            paragraphIndex: 3,
            text: "彩色段落",
            currentColor: "#FF0000",
            isReasonable: false,
            reason: "颜色不统一",
            suggestedColor: "#000000",
          },
          {
            paragraphIndex: -1,
            text: "无效",
          },
        ],
        formatMarkAnalysis: [
          {
            paragraphIndex: 4,
            text: "下划线",
            formatType: "underline",
            isReasonable: false,
            reason: "无语义",
            shouldKeep: false,
          },
          {
            paragraphIndex: 5,
            text: "未知格式",
            formatType: "unknown",
            shouldKeep: false,
          },
        ],
      }, null, 2),
      "```",
      "请按此执行。",
    ].join("\n");

    const parsed = __formatAiIntegrationInternals.parseFormatAnalysisResult(content);
    expect(parsed.inconsistencies).toEqual(["标题样式不一致"]);
    expect(parsed.suggestions).toEqual(["先统一标题"]);
    expect(parsed.colorAnalysis?.length).toBe(1);
    expect(parsed.colorAnalysis?.[0].paragraphIndex).toBe(3);
    expect(parsed.formatMarkAnalysis?.length).toBe(1);
    expect(parsed.formatMarkAnalysis?.[0].formatType).toBe("underline");
    expect(parsed.formatSpec.bodyText?.font.name).toBe("宋体");
  });

  it("throws when no JSON object can be parsed", () => {
    expect(() =>
      __formatAiIntegrationInternals.parseFormatAnalysisResult("纯文本，无任何 JSON")
    ).toThrow("无法解析AI返回的格式规范");
  });
});

describe("__formatAiIntegrationInternals.parseHeaderFooterPlan", () => {
  it("returns fallback plan when content is unparsable", () => {
    const parsed = __formatAiIntegrationInternals.parseHeaderFooterPlan("无效响应");
    expect(parsed.shouldUnify).toBe(false);
    expect(parsed.reason).toContain("无法解析");
  });
});

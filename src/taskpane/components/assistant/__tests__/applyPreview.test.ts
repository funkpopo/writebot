import { describe, expect, it } from "bun:test";
import { buildApplyPreviewSegments, mergeApplyPreviewSegments } from "../applyPreview";

describe("buildApplyPreviewSegments", () => {
  it("keeps headings attached to the following paragraph block", () => {
    const segments = buildApplyPreviewSegments("# 一、项目背景\n\n这里是第一段。\n\n这里是第二段。");

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      kind: "text",
      rawContent: "# 一、项目背景\n\n这里是第一段。",
    });
    expect(segments[1]).toMatchObject({
      kind: "text",
      rawContent: "这里是第二段。",
    });
  });

  it("keeps markdown tables as standalone preview segments", () => {
    const segments = buildApplyPreviewSegments(
      "导语说明。\n\n| 指标 | 数值 |\n| --- | --- |\n| 成本 | 12 |\n| 周期 | 5天 |\n\n结论建议。"
    );

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "table", "text"]);
    expect(segments[1]?.rawContent).toContain("| 指标 | 数值 |");
    expect(segments[1]?.rawContent).toContain("| 成本 | 12 |");
  });
});

describe("mergeApplyPreviewSegments", () => {
  it("merges selected segments in original order", () => {
    const segments = buildApplyPreviewSegments("第一段。\n\n第二段。\n\n第三段。");
    const merged = mergeApplyPreviewSegments(segments, [segments[0].id, segments[2].id]);

    expect(merged).toBe("第一段。\n\n第三段。");
  });

  it("returns empty string when every segment is rejected", () => {
    const segments = buildApplyPreviewSegments("第一段。\n\n第二段。");

    expect(mergeApplyPreviewSegments(segments, [])).toBe("");
  });
});

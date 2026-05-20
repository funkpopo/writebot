import { describe, expect, it } from "bun:test";
import { reviewAssistantWriteContent } from "../contentReview";

describe("reviewAssistantWriteContent", () => {
  it("delegates write-content review to the AI and returns the reviewed text", async () => {
    const calls: Array<{ prompt: string; systemPrompt?: string }> = [];
    const result = await reviewAssistantWriteContent(
      "昆明素有春城美誉，夏季气候宜人。\n昆明素有春城美誉，夏季气候宜人。",
      "帮我写一篇关于昆明夏季的文章，总字数控制在100字以内",
      {
        callReviewAI: async (prompt, systemPrompt) => {
          calls.push({ prompt, systemPrompt });
          return {
            content: "昆明夏季清爽宜人，阳光明亮却不灼热。翠湖微风、西山远景相映成趣，是适合漫步避暑的春城时光。",
            plainText: "昆明夏季清爽宜人，阳光明亮却不灼热。翠湖微风、西山远景相映成趣，是适合漫步避暑的春城时光。",
            rawMarkdown: "昆明夏季清爽宜人，阳光明亮却不灼热。翠湖微风、西山远景相映成趣，是适合漫步避暑的春城时光。",
          };
        },
        getReviewPrompt: () => "review prompt",
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("用户原始需求");
    expect(calls[0].prompt).toContain("待写入草稿");
    expect(calls[0].systemPrompt).toBe("review prompt");
    expect(result.blocked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.text).toBe("昆明夏季清爽宜人，阳光明亮却不灼热。翠湖微风、西山远景相映成趣，是适合漫步避暑的春城时光。");
  });

  it("blocks writing when the AI review returns no writable content", async () => {
    const result = await reviewAssistantWriteContent("草稿", "写一段文字", {
      callReviewAI: async () => ({ content: "", plainText: "", rawMarkdown: "" }),
      getReviewPrompt: () => "review prompt",
    });

    expect(result.blocked).toBe(true);
    expect(result.text).toBe("草稿");
    expect(result.messages.join("；")).toContain("模型审查未返回可写入内容");
  });
});

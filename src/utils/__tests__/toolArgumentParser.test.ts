import { describe, expect, it } from "bun:test";
import { parseToolArguments } from "../toolArgumentParser";

describe("parseToolArguments", () => {
  it("accepts JSON records", () => {
    expect(parseToolArguments('{"startIndex":1,"content":"正文"}')).toEqual({
      startIndex: 1,
      content: "正文",
    });
  });

  it("rejects arrays and preserves malformed JSON for diagnostics", () => {
    expect(parseToolArguments(["unexpected"])).toEqual({});
    expect(parseToolArguments("{broken")).toEqual({ _raw: "{broken" });
  });
});

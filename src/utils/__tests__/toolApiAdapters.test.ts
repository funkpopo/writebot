import { describe, expect, it } from "bun:test";
import { toOpenAITools } from "../toolApiAdapters";
import { TOOL_DEFINITIONS } from "../toolDefinitions";

describe("tool API adapters", () => {
  it("preserves nested object constraints in provider schemas", () => {
    const replace = toOpenAITools(TOOL_DEFINITIONS).find((tool) => tool.function.name === "replace_paragraph_range");
    const expectedBefore = replace?.function.parameters.properties.expectedBefore;
    expect(expectedBefore?.type).toBe("object");
    expect(expectedBefore?.properties?.anchor?.type).toBe("object");
    expect(expectedBefore?.properties?.paragraphIndex?.type).toBe("number");
  });
});

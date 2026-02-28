import { describe, expect, it } from "bun:test";
import { parseVerificationFeedback } from "../outlineParser";

describe("outlineParser verification", () => {
  it("parses verification payload and keeps pass verdict", () => {
    const raw = JSON.stringify({
      verdict: "pass",
      claims: [
        {
          claim: "结论 A",
          verdict: "pass",
          evidenceIds: ["e1"],
          sourceAnchors: ["p2"],
        },
      ],
      evidence: [
        {
          id: "e1",
          quote: "这是证据片段",
          anchor: "p2",
        },
      ],
    });
    const parsed = parseVerificationFeedback(raw);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.evidence).toHaveLength(1);
  });

  it("forces fail when claim has no source anchors", () => {
    const raw = JSON.stringify({
      verdict: "pass",
      claims: [
        {
          claim: "结论 B",
          verdict: "pass",
          evidenceIds: [],
          sourceAnchors: [],
        },
      ],
      evidence: [],
    });
    const parsed = parseVerificationFeedback(raw);
    expect(parsed.verdict).toBe("fail");
    expect(parsed.claims[0]?.verdict).toBe("fail");
  });
});

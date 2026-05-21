import { describe, expect, it } from "bun:test";
import { stableTextHash } from "../documentText";
import { resolveAnchorParagraphIndexFromParagraphs } from "../editTransactionService";

describe("resolveAnchorParagraphIndexFromParagraphs", () => {
  const paragraphs = [
    { index: 0, text: "Intro" },
    { index: 1, text: "Original target" },
    { index: 2, text: "After" },
  ];

  it("uses direct paragraph index when hash still matches", () => {
    const resolved = resolveAnchorParagraphIndexFromParagraphs(paragraphs, {
      anchor: {
        paragraphIndex: 1,
        paragraphTextHash: stableTextHash("Original target"),
      },
    });

    expect(resolved).toBe(1);
  });

  it("relocates by paragraph hash when the recorded index drifted", () => {
    const current = [
      { index: 0, text: "Inserted before" },
      { index: 1, text: "Intro" },
      { index: 2, text: "Original target" },
      { index: 3, text: "After" },
    ];

    const resolved = resolveAnchorParagraphIndexFromParagraphs(current, {
      anchor: {
        paragraphIndex: 1,
        paragraphTextHash: stableTextHash("Original target"),
        beforeNeighborHash: stableTextHash("Intro"),
        afterNeighborHash: stableTextHash("After"),
      },
    });

    expect(resolved).toBe(2);
  });

  it("falls back to excerpt occurrence when no hash is available", () => {
    const resolved = resolveAnchorParagraphIndexFromParagraphs(paragraphs, {
      anchor: {
        normalizedExcerpt: "Original",
        occurrence: 1,
      },
    });

    expect(resolved).toBe(1);
  });
});

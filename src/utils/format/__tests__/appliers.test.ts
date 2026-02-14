import { describe, expect, it } from "bun:test";
import type { ChangeItem } from "../types";
import {
  orderChangeItemsForExecution,
  mergeTypographyChangeItems,
  remapIndicesAfterDeletion,
} from "../appliers";

function makeItem(
  id: string,
  type: ChangeItem["type"],
  indices: number[],
  extra?: Partial<ChangeItem>
): ChangeItem {
  return {
    id,
    title: id,
    description: id,
    type,
    paragraphIndices: indices,
    ...extra,
  };
}

describe("orderChangeItemsForExecution", () => {
  it("places structural pagination operations at the end", () => {
    const ordered = orderChangeItemsForExecution([
      makeItem("a", "heading-style", [1]),
      makeItem("b", "pagination-control", [2]),
      makeItem("c", "special-content", [3]),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});

describe("remapIndicesAfterDeletion", () => {
  it("adjusts remaining indices after deleted paragraphs", () => {
    const remapped = remapIndicesAfterDeletion([1, 3, 4, 8], [0, 4, 6]);
    expect(remapped).toEqual([0, 2, 5]);
  });

  it("returns sorted unique indices when no deletion happened", () => {
    const remapped = remapIndicesAfterDeletion([5, 2, 2, 1], []);
    expect(remapped).toEqual([1, 2, 5]);
  });
});

describe("mergeTypographyChangeItems", () => {
  it("merges mixed typography and punctuation spacing into one execution item", () => {
    const merged = mergeTypographyChangeItems([
      makeItem("a", "heading-style", [1]),
      makeItem("mixed", "mixed-typography", [2, 3], {
        requiresContentChange: true,
        data: {
          typography: {
            chineseFont: "宋体",
            englishFont: "Calibri",
            enforceSpacing: true,
            enforcePunctuation: false,
          },
        },
      }),
      makeItem("special", "special-content", [5]),
      makeItem("punct", "punctuation-spacing", [3, 4], {
        requiresContentChange: true,
        data: {
          typography: {
            enforceSpacing: true,
            enforcePunctuation: true,
          },
        },
      }),
    ], {
      chineseFont: "微软雅黑",
      englishFont: "Arial",
      enforceSpacing: false,
      enforcePunctuation: false,
    });

    expect(merged.map((item) => item.id)).toEqual(["a", "mixed+punct", "special"]);
    expect(merged[1].type).toBe("mixed-typography");
    expect(merged[1].paragraphIndices).toEqual([2, 3, 4]);
    expect(merged[1].requiresContentChange).toBe(true);

    const mergedTypography = merged[1].data?.typography as {
      chineseFont: string;
      englishFont: string;
      enforceSpacing: boolean;
      enforcePunctuation: boolean;
    };
    expect(mergedTypography).toEqual({
      chineseFont: "微软雅黑",
      englishFont: "Arial",
      enforceSpacing: true,
      enforcePunctuation: true,
    });

    expect(merged[1].data?.mergedChangeIds).toEqual(["mixed", "punct"]);
  });
});

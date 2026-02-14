/* global Word */

import { ContentCheckpoint, ScopedContentCheckpoint } from "./types";
import { simpleHash } from "./utils";

function normalizeScopedIndices(indices: number[], paragraphCount: number): number[] {
  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < paragraphCount)
    )
  ).sort((a, b) => a - b);
}

/**
 * 创建内容检查点
 */
export async function createContentCheckpoint(): Promise<ContentCheckpoint> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const hashes: string[] = [];
    let totalChars = 0;

    for (const para of paragraphs.items) {
      para.load("text");
    }
    await context.sync();

    for (const para of paragraphs.items) {
      hashes.push(simpleHash(para.text));
      totalChars += para.text.length;
    }

    return {
      paragraphCount: paragraphs.items.length,
      totalCharCount: totalChars,
      paragraphHashes: hashes,
    };
  });
}

/**
 * 创建局部内容检查点（仅采样触达段落）
 */
export async function createScopedContentCheckpoint(
  paragraphIndices: number[]
): Promise<ScopedContentCheckpoint> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    const normalizedIndices = normalizeScopedIndices(paragraphIndices, paragraphs.items.length);
    for (const index of normalizedIndices) {
      paragraphs.items[index].load("text");
    }
    await context.sync();

    const hashes: string[] = [];
    let totalChars = 0;
    for (const index of normalizedIndices) {
      const text = paragraphs.items[index].text || "";
      hashes.push(simpleHash(text));
      totalChars += text.length;
    }

    return {
      paragraphCount: paragraphs.items.length,
      paragraphIndices: normalizedIndices,
      totalCharCount: totalChars,
      paragraphHashes: hashes,
    };
  });
}

/**
 * 验证内容完整性
 */
export function verifyContentIntegrity(
  before: ContentCheckpoint,
  after: ContentCheckpoint
): { valid: boolean; error?: string } {
  if (before.paragraphCount !== after.paragraphCount) {
    return {
      valid: false,
      error: `段落数量变化: ${before.paragraphCount} -> ${after.paragraphCount}`,
    };
  }
  if (before.totalCharCount !== after.totalCharCount) {
    return {
      valid: false,
      error: `字符数变化: ${before.totalCharCount} -> ${after.totalCharCount}`,
    };
  }
  for (let i = 0; i < before.paragraphHashes.length; i++) {
    if (before.paragraphHashes[i] !== after.paragraphHashes[i]) {
      return {
        valid: false,
        error: `第 ${i + 1} 段内容发生变化`,
      };
    }
  }
  return { valid: true };
}

/**
 * 验证局部内容完整性（仅比较触达段落）
 */
export function verifyScopedContentIntegrity(
  before: ScopedContentCheckpoint,
  after: ScopedContentCheckpoint
): { valid: boolean; error?: string } {
  if (before.paragraphCount !== after.paragraphCount) {
    return {
      valid: false,
      error: `段落数量变化: ${before.paragraphCount} -> ${after.paragraphCount}`,
    };
  }

  if (before.paragraphIndices.length !== after.paragraphIndices.length) {
    return {
      valid: false,
      error: "局部校验段落集合发生变化",
    };
  }

  for (let i = 0; i < before.paragraphIndices.length; i++) {
    if (before.paragraphIndices[i] !== after.paragraphIndices[i]) {
      return {
        valid: false,
        error: "局部校验段落索引发生变化",
      };
    }
  }

  if (before.totalCharCount !== after.totalCharCount) {
    return {
      valid: false,
      error: `局部字符数变化: ${before.totalCharCount} -> ${after.totalCharCount}`,
    };
  }

  for (let i = 0; i < before.paragraphHashes.length; i++) {
    if (before.paragraphHashes[i] !== after.paragraphHashes[i]) {
      const paragraphIndex = before.paragraphIndices[i];
      return {
        valid: false,
        error: `第 ${paragraphIndex + 1} 段内容发生变化`,
      };
    }
  }

  return { valid: true };
}

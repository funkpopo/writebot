/* global Word */

import { ContentCheckpoint } from "./types";
import { simpleHash } from "./utils";

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

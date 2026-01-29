/**
 * 上下文管理器
 * 用于管理AI调用时的上下文长度，避免超出token限制
 */

/**
 * 上下文管理器类
 */
export class ContextManager {
  private maxTokens: number;

  constructor(maxTokens: number = 4000) {
    this.maxTokens = maxTokens;
  }

  /**
   * 估算文本的token数量
   * 使用简单的估算方法：中文约1.5字符/token，英文约4字符/token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    let chineseCount = 0;
    let otherCount = 0;

    for (const char of text) {
      if (/[\u4e00-\u9fa5]/.test(char)) {
        chineseCount++;
      } else {
        otherCount++;
      }
    }

    // 中文约1.5字符/token，其他约4字符/token
    return Math.ceil(chineseCount / 1.5 + otherCount / 4);
  }

  /**
   * 获取最大token数
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * 设置最大token数
   */
  setMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  /**
   * 分块处理大数据集
   * @param items 要处理的项目数组
   * @param processor 处理函数
   * @param getItemSize 获取单个项目大小的函数
   */
  async processInChunks<T>(
    items: T[],
    processor: (chunk: T[]) => Promise<void>,
    getItemSize: (item: T) => number
  ): Promise<void> {
    let currentChunk: T[] = [];
    let currentSize = 0;

    for (const item of items) {
      const itemSize = getItemSize(item);

      // 如果单个项目超过最大限制，单独处理
      if (itemSize > this.maxTokens) {
        if (currentChunk.length > 0) {
          await processor(currentChunk);
          currentChunk = [];
          currentSize = 0;
        }
        await processor([item]);
        continue;
      }

      // 如果添加当前项目会超过限制，先处理当前块
      if (currentSize + itemSize > this.maxTokens && currentChunk.length > 0) {
        await processor(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(item);
      currentSize += itemSize;
    }

    // 处理剩余的项目
    if (currentChunk.length > 0) {
      await processor(currentChunk);
    }
  }

  /**
   * 压缩格式样本，减少token消耗
   * @param samples 格式样本数组
   * @param maxTextLength 每个样本的最大文本长度
   */
  compressFormatSamples<T extends { text: string }>(
    samples: T[],
    maxTextLength: number = 50
  ): T[] {
    return samples.map((sample) => ({
      ...sample,
      text:
        sample.text.length > maxTextLength
          ? sample.text.substring(0, maxTextLength) + "..."
          : sample.text,
    }));
  }

  /**
   * 将格式样本转换为紧凑的JSON字符串
   */
  formatSamplesToCompactJSON(samples: unknown): string {
    return JSON.stringify(samples, null, 0);
  }
}

/**
 * 默认上下文管理器实例
 */
export const defaultContextManager = new ContextManager();

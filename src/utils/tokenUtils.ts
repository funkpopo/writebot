/**
 * 应用内默认的最大输出 token 数。
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65_535;

/**
 * 已知的错误/哨兵值：某些 OpenAI-compatible 服务会返回一个极大的数表示“无限制”，
 * 这会导致 UI/配置里出现明显错误的值。
 */
export const INVALID_MAX_OUTPUT_TOKENS_SENTINELS = new Set([999_999_999]);

/**
 * 将未知值规范化为“可接受的最大输出 token”。
 * - 返回 undefined：表示值无效/不可信，应当忽略并回退到其它策略
 */
export function normalizeMaxOutputTokens(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;

  // tokens 必须是正整数；对小数做向下取整，避免写入 4096.5 这类脏值
  const intVal = Math.floor(value);
  if (intVal <= 0) return undefined;

  if (!Number.isSafeInteger(intVal)) return undefined;

  // 过滤已知的“无限制/哨兵”错误值
  if (INVALID_MAX_OUTPUT_TOKENS_SENTINELS.has(intVal)) return undefined;

  return intVal;
}

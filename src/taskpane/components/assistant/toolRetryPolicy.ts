const RETRYABLE_WRITE_ERROR_PATTERNS: RegExp[] = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /fetch/i,
  /busy/i,
  /throttle/i,
  /generalexception/i,
  /internal/i,
  /temporar/i,
  /service unavailable/i,
  /connection/i,
  /socket/i,
  /richapi\.error/i,
  /超时/u,
  /网络/u,
  /繁忙/u,
  /稍后/u,
  /重试/u,
  /暂时/u,
  /服务不可用/u,
];

export const MAX_WRITE_TOOL_RETRIES = 2;

export function isRetryableWriteToolError(errorMessage?: string): boolean {
  const message = typeof errorMessage === "string" ? errorMessage.trim() : "";
  if (!message) return true;
  return RETRYABLE_WRITE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Network fetch utilities with proxy fallback.
 */

// 本地代理服务器地址
export const LOCAL_PROXY_URL = "https://localhost:53000/api/proxy";

// 是否使用代理（当直接请求失败时自动启用）
export let useProxy = false;

export interface SmartFetchRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryJitterMs?: number;
}

interface ResolvedRetryOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryJitterMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 400;
const DEFAULT_RETRY_JITTER_MS = 200;

function resolveRetryOptions(options?: SmartFetchRetryOptions): ResolvedRetryOptions {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(1, Number(options?.timeoutMs)) : DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isFinite(options?.maxRetries) ? Math.max(0, Number(options?.maxRetries)) : DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = Number.isFinite(options?.retryBaseDelayMs)
    ? Math.max(0, Number(options?.retryBaseDelayMs))
    : DEFAULT_RETRY_BASE_DELAY_MS;
  const retryJitterMs = Number.isFinite(options?.retryJitterMs)
    ? Math.max(0, Number(options?.retryJitterMs))
    : DEFAULT_RETRY_JITTER_MS;

  return { timeoutMs, maxRetries, retryBaseDelayMs, retryJitterMs };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function isTimeoutLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === "TimeoutError") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|请求超时/i.test(message);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (isTimeoutLikeError(error)) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /network|failed to fetch|fetch failed|connection/i.test(error.message);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`请求超时（${timeoutMs}ms）`);
  error.name = "TimeoutError";
  return error;
}

function getRetryDelayMs(
  attempt: number,
  retryBaseDelayMs: number,
  retryJitterMs: number
): number {
  if (attempt <= 0 || retryBaseDelayMs <= 0) {
    return 0;
  }
  const exponential = retryBaseDelayMs * (2 ** (attempt - 1));
  const jitter = retryJitterMs > 0 ? Math.floor(Math.random() * retryJitterMs) : 0;
  return exponential + jitter;
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError("操作已取消"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function createRequestSignal(
  sourceSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal?: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  if (!sourceSignal && timeoutMs <= 0) {
    return {
      signal: undefined,
      cleanup: () => undefined,
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const abortFromSource = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (sourceSignal) {
    if (sourceSignal.aborted) {
      abortFromSource();
    } else {
      sourceSignal.addEventListener("abort", abortFromSource, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (sourceSignal) {
        sourceSignal.removeEventListener("abort", abortFromSource);
      }
    },
    didTimeout: () => timedOut,
  };
}

async function executeSingleFetchAttempt(
  mode: "direct" | "proxy",
  url: string,
  options: RequestInit,
  retryOptions: ResolvedRetryOptions
): Promise<Response> {
  const { signal, cleanup, didTimeout } = createRequestSignal(options.signal ?? undefined, retryOptions.timeoutMs);
  const requestOptions = signal ? { ...options, signal } : options;

  try {
    if (mode === "proxy") {
      return await fetchWithProxy(url, requestOptions);
    }
    return await fetch(url, requestOptions);
  } catch (error) {
    if (didTimeout()) {
      throw createTimeoutError(retryOptions.timeoutMs);
    }
    throw error;
  } finally {
    cleanup();
  }
}

async function executeFetchWithRetry(
  mode: "direct" | "proxy",
  url: string,
  options: RequestInit,
  retryOptions: ResolvedRetryOptions
): Promise<Response> {
  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = getRetryDelayMs(attempt, retryOptions.retryBaseDelayMs, retryOptions.retryJitterMs);
      await waitForRetry(delayMs, options.signal ?? undefined);
    }

    try {
      const response = await executeSingleFetchAttempt(mode, url, options, retryOptions);
      if (!isRetryableStatus(response.status) || attempt === retryOptions.maxRetries) {
        return response;
      }

      try {
        await response.body?.cancel?.();
      } catch {
        // 忽略响应流取消失败
      }
      continue;
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      if (!isRetryableNetworkError(error) || attempt === retryOptions.maxRetries) {
        throw error;
      }
    }
  }

  throw new Error("API 请求失败: 已达到最大重试次数");
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 仅供测试重置状态，业务代码无需调用
 */
export function resetSmartFetchState(): void {
  useProxy = false;
}

/**
 * 通过本地代理发送请求（解决 CORS 问题）
 */
export async function fetchWithProxy(
  url: string,
  options: RequestInit
): Promise<Response> {
  const proxyUrl = `${LOCAL_PROXY_URL}?target=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, options);
}

/**
 * 智能 fetch：先尝试直接请求，如果遇到 CORS 错误则使用代理
 */
export async function smartFetch(
  url: string,
  options: RequestInit,
  retryOptions?: SmartFetchRetryOptions
): Promise<Response> {
  const resolvedRetryOptions = resolveRetryOptions(retryOptions);

  // 如果已知需要使用代理，直接使用代理
  if (useProxy) {
    try {
      return await executeFetchWithRetry("proxy", url, options, resolvedRetryOptions);
    } catch (proxyError) {
      if (isAbortLikeError(proxyError)) {
        throw proxyError;
      }
      const errorMsg = formatErrorMessage(proxyError);
      throw new Error(`API 请求失败（通过代理）: ${errorMsg}。请确保本地服务器正在运行。`);
    }
  }

  try {
    return await executeFetchWithRetry("direct", url, options, resolvedRetryOptions);
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw error;
    }
    // 检查是否是 CORS、超时或网络错误
    if (isRetryableNetworkError(error)) {
      console.log("直接请求失败，尝试使用本地代理...");
      useProxy = true;
      try {
        return await executeFetchWithRetry("proxy", url, options, resolvedRetryOptions);
      } catch (proxyError) {
        if (isAbortLikeError(proxyError)) {
          throw proxyError;
        }
        const errorMsg = formatErrorMessage(proxyError);
        throw new Error(
          `API 请求失败: 直接请求被阻止（可能是 CORS/网络/超时问题），代理请求也失败: ${errorMsg}。` +
          `请确保本地服务器正在运行，或检查 API 端点是否正确。`
        );
      }
    }
    throw error;
  }
}

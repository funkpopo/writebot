import { describe, expect, it } from "bun:test";
import {
  LOCAL_PROXY_URL,
  resetSmartFetchState,
  smartFetch,
  useProxy,
} from "../fetch";

const originalFetch = globalThis.fetch;

function toRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

describe("smartFetch", () => {
  it("retries 429/5xx responses and returns the eventual success response", async () => {
    resetSmartFetchState();
    let callCount = 0;
    try {
      globalThis.fetch = (async () => {
        callCount += 1;
        if (callCount < 3) {
          return new Response("retry", { status: 429 });
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const response = await smartFetch("https://example.com/retry", {}, {
        maxRetries: 2,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });

      expect(response.status).toBe(200);
      expect(callCount).toBe(3);
      expect(useProxy).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      resetSmartFetchState();
    }
  });

  it("does not retry non-retryable 4xx responses", async () => {
    resetSmartFetchState();
    let callCount = 0;
    try {
      globalThis.fetch = (async () => {
        callCount += 1;
        return new Response("bad request", { status: 400 });
      }) as typeof fetch;

      const response = await smartFetch("https://example.com/bad-request", {}, {
        maxRetries: 3,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });

      expect(response.status).toBe(400);
      expect(callCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      resetSmartFetchState();
    }
  });

  it("falls back to proxy when direct request fails with network error", async () => {
    resetSmartFetchState();
    const calledUrls: string[] = [];
    try {
      globalThis.fetch = (async (input) => {
        const url = toRequestUrl(input);
        calledUrls.push(url);
        if (url.startsWith(LOCAL_PROXY_URL)) {
          return new Response("proxy-ok", { status: 200 });
        }
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;

      const response = await smartFetch("https://example.com/network", {}, {
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });

      expect(response.status).toBe(200);
      expect(calledUrls).toHaveLength(2);
      expect(calledUrls[0]).toBe("https://example.com/network");
      expect(calledUrls[1].startsWith(LOCAL_PROXY_URL)).toBe(true);
      expect(useProxy).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      resetSmartFetchState();
    }
  });

  it("treats timeout as retryable and falls back to proxy", async () => {
    resetSmartFetchState();
    const calledUrls: string[] = [];
    try {
      globalThis.fetch = (async (input, init) => {
        const url = toRequestUrl(input);
        calledUrls.push(url);

        if (url.startsWith(LOCAL_PROXY_URL)) {
          return new Response("proxy-timeout-ok", { status: 200 });
        }

        const signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      }) as typeof fetch;

      const response = await smartFetch("https://example.com/timeout", {}, {
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 10,
      });

      expect(response.status).toBe(200);
      expect(calledUrls).toHaveLength(2);
      expect(calledUrls[0]).toBe("https://example.com/timeout");
      expect(calledUrls[1].startsWith(LOCAL_PROXY_URL)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      resetSmartFetchState();
    }
  });

  it("tracks proxy health per endpoint instead of switching all endpoints globally", async () => {
    resetSmartFetchState();
    const endpointA = "https://api.example.com/v1/chat/completions";
    const endpointB = "https://api.other.com/v1/messages";
    const calledUrls: string[] = [];

    try {
      globalThis.fetch = (async (input) => {
        const url = toRequestUrl(input);
        calledUrls.push(url);

        if (url.startsWith(LOCAL_PROXY_URL)) {
          return new Response("proxy-ok", { status: 200 });
        }

        if (url === endpointA) {
          throw new TypeError("Failed to fetch");
        }

        if (url === endpointB) {
          return new Response("direct-ok", { status: 200 });
        }

        return new Response("unexpected", { status: 500 });
      }) as typeof fetch;

      const responseA = await smartFetch(endpointA, {}, {
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });
      expect(responseA.status).toBe(200);

      const responseB = await smartFetch(endpointB, {}, {
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });
      expect(responseB.status).toBe(200);

      const responseASecond = await smartFetch(endpointA, {}, {
        maxRetries: 0,
        retryBaseDelayMs: 1,
        retryJitterMs: 0,
        timeoutMs: 5_000,
      });
      expect(responseASecond.status).toBe(200);

      expect(calledUrls).toHaveLength(4);
      expect(calledUrls[0]).toBe(endpointA);
      expect(calledUrls[1].startsWith(LOCAL_PROXY_URL)).toBe(true);
      expect(calledUrls[2]).toBe(endpointB);
      expect(calledUrls[3].startsWith(LOCAL_PROXY_URL)).toBe(true);
      expect(useProxy).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      resetSmartFetchState();
    }
  });
});

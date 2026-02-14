import { describe, expect, it } from "bun:test";
import { __formatAiIntegrationInternals } from "../../format/aiIntegration";

describe("structured output fallback policy", () => {
  const shouldFallback = __formatAiIntegrationInternals.shouldFallbackToUnstructured;

  it("falls back for schema-related 4xx errors", () => {
    expect(shouldFallback(new Error("API 请求失败: 状态码 400, response_schema 不支持"))).toBe(true);
    expect(shouldFallback(new Error("状态码 422: json schema unsupported"))).toBe(true);
  });

  it("does not fallback for non-schema errors", () => {
    expect(shouldFallback(new Error("状态码 500: internal server error"))).toBe(false);
    expect(shouldFallback(new Error("状态码 401: unauthorized"))).toBe(false);
  });

  it("does not fallback for unknown non-error input", () => {
    expect(shouldFallback(null)).toBe(false);
    expect(shouldFallback("schema error")).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import { isRetryableWriteToolError } from "../toolRetryPolicy";

describe("isRetryableWriteToolError", () => {
  it("returns true for transient timeout/network errors", () => {
    expect(isRetryableWriteToolError("Request timeout")).toBe(true);
    expect(isRetryableWriteToolError("Network error")).toBe(true);
    expect(isRetryableWriteToolError("GeneralException")).toBe(true);
    expect(isRetryableWriteToolError("Word 主机繁忙，请稍后重试")).toBe(true);
  });

  it("returns false for deterministic argument errors", () => {
    expect(isRetryableWriteToolError("缺少必要参数: text")).toBe(false);
    expect(isRetryableWriteToolError("参数 text 应为字符串")).toBe(false);
  });

  it("defaults to retry when error text is unavailable", () => {
    expect(isRetryableWriteToolError(undefined)).toBe(true);
    expect(isRetryableWriteToolError("")).toBe(true);
  });
});

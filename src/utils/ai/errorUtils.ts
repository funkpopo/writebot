/**
 * Provider API error helpers.
 */

function getStatusSuggestion(status: number): string {
  if (status === 401 || status === 403) {
    return "请检查 API Key、模型权限与账号状态。";
  }
  if (status === 429) {
    return "请求过于频繁或额度不足，请稍后重试并检查配额。";
  }
  if (status >= 500) {
    return "服务端暂时不可用，请稍后重试。";
  }
  if (status >= 400) {
    return "请检查请求参数与模型配置是否正确。";
  }
  return "请稍后重试，或检查网络与代理配置。";
}

function extractMessageFromBody(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const candidate = payload as Record<string, unknown>;
  const directMessage = candidate.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }
  const detail = candidate.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  const errorBlock = candidate.error;
  if (typeof errorBlock === "string" && errorBlock.trim()) {
    return errorBlock.trim();
  }
  if (errorBlock && typeof errorBlock === "object") {
    const nested = errorBlock as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
    if (typeof nested.type === "string" && nested.type.trim()) {
      return nested.type.trim();
    }
  }
  return undefined;
}

function clipText(text: string, maxLength = 240): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

async function extractResponseMessage(response: Response): Promise<string | undefined> {
  const raw = (await response.text()).trim();
  if (!raw) {
    return undefined;
  }

  try {
    const json = JSON.parse(raw);
    const parsed = extractMessageFromBody(json);
    if (parsed) {
      return clipText(parsed);
    }
  } catch {
    // Fall back to plain text preview.
  }

  return clipText(raw.replace(/\s+/g, " "));
}

export async function buildProviderRequestError(
  providerName: string,
  response: Response
): Promise<Error> {
  const status = response.status;
  const message = await extractResponseMessage(response);
  const suggestion = getStatusSuggestion(status);
  const detail = message ? `；响应体：${message}` : "";
  return new Error(
    `${providerName} API 请求失败（状态码 ${status}）` +
    `；建议：${suggestion}${detail}`
  );
}

export async function ensureResponseOk(
  providerName: string,
  response: Response
): Promise<void> {
  if (response.ok) {
    return;
  }
  throw await buildProviderRequestError(providerName, response);
}

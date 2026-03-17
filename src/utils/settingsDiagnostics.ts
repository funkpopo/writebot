import { ensureApiEndpointPath, resolveApiEndpoint, withQueryParams } from "./ai/endpointResolver";
import { smartFetch } from "./ai/fetch";
import {
  AIProfile,
  APIType,
  getDefaultRequestTimeoutMs,
  normalizeRequestTimeoutMs,
} from "./storageService";
import { buildLocalServiceUrl, withLocalServiceHeaders } from "./localServiceClient";

const DIAGNOSTICS_API = buildLocalServiceUrl("/api/diagnostics");
const DEFAULT_CONNECTION_TEST_PROMPT = "ping";

export interface RuntimeDiagnostics {
  service: {
    status: string;
    mode: string;
    serviceAccount: string | null;
    executablePath: string;
    baseDir: string;
  };
  port: {
    host: string;
    port: number;
    listening: boolean;
  };
  certificate: {
    filesPresent: boolean;
    rootInstalled: boolean | null;
    subject: string | null;
    validTo: string | null;
    certPath: string;
  };
  manifest: {
    version: string | null;
    path: string | null;
  };
  storage: {
    backend: string;
    filePath: string;
    exists: boolean;
  };
  outboundProxy: {
    enabled: boolean;
    protocol: string | null;
    endpoint: string | null;
    hasAuth: boolean;
  };
  security: {
    sameOriginOnly: boolean;
    clientHeaderRequired: boolean;
    proxyMethod: string;
    staticTargetResolution: boolean;
    blocksPrivateAddresses: boolean;
  };
  runtime: {
    platform: string;
    pid: number;
    isPkg: boolean;
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: APIType;
  endpoint: string;
  model: string;
  latencyMs: number;
  message: string;
  detail?: string;
}

export interface ModelProbeResult {
  ok: boolean;
  provider: APIType;
  endpoint: string;
  currentModel: string;
  currentModelAvailable: boolean;
  models: string[];
  message: string;
  detail?: string;
}

function stripKnownEndpointSuffix(apiType: APIType, apiEndpoint: string): string {
  const trimmed = apiEndpoint.trim();
  if (!trimmed) return trimmed;

  if (apiType === "openai") {
    return trimmed
      .replace(/\/v1\/chat\/completions(?:\/.*)?$/i, "/")
      .replace(/\/chat\/completions(?:\/.*)?$/i, "/")
      .replace(/\/v1\/models(?:\/.*)?$/i, "/")
      .replace(/\/models(?:\/.*)?$/i, "/");
  }

  if (apiType === "anthropic") {
    return trimmed
      .replace(/\/v1\/messages(?:\/.*)?$/i, "/")
      .replace(/\/messages(?:\/.*)?$/i, "/")
      .replace(/\/v1\/models(?:\/.*)?$/i, "/")
      .replace(/\/models(?:\/.*)?$/i, "/");
  }

  return trimmed.replace(/\/v1beta\/models(?:\/.*)?$/i, "/").replace(/\/models(?:\/.*)?$/i, "/");
}

function getRequestModel(profile: Pick<AIProfile, "model">): string {
  return profile.model.trim();
}

function normalizeGeminiModelName(model: string): string {
  return model.trim().replace(/^models\//i, "");
}

async function parseFailureDetail(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw.trim()) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errorValue = parsed.error;
    if (typeof errorValue === "string") {
      return errorValue;
    }
    if (errorValue && typeof errorValue === "object") {
      const errorRecord = errorValue as Record<string, unknown>;
      if (typeof errorRecord.message === "string") {
        return errorRecord.message;
      }
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Fall back to raw text below.
  }

  return raw.trim();
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function getProfileTimeoutMs(profile: Pick<AIProfile, "requestTimeoutMs">): number {
  return normalizeRequestTimeoutMs(profile.requestTimeoutMs) ?? getDefaultRequestTimeoutMs();
}

function buildConnectionTestRequest(profile: AIProfile): {
  endpoint: string;
  options: RequestInit;
  timeoutMs: number;
} {
  const model = getRequestModel(profile);
  const timeoutMs = getProfileTimeoutMs(profile);
  const signal = createTimeoutSignal(timeoutMs);

  if (profile.apiType === "openai") {
    return {
      endpoint: resolveApiEndpoint({
        apiType: "openai",
        apiEndpoint: profile.apiEndpoint,
        model,
      }),
      options: {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: DEFAULT_CONNECTION_TEST_PROMPT }],
        }),
      },
      timeoutMs,
    };
  }

  if (profile.apiType === "anthropic") {
    return {
      endpoint: resolveApiEndpoint({
        apiType: "anthropic",
        apiEndpoint: profile.apiEndpoint,
        model,
      }),
      options: {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: DEFAULT_CONNECTION_TEST_PROMPT }],
        }),
      },
      timeoutMs,
    };
  }

  const endpoint = withQueryParams(
    resolveApiEndpoint({
      apiType: "gemini",
      apiEndpoint: profile.apiEndpoint,
      model,
    }),
    { key: profile.apiKey }
  );

  return {
    endpoint,
    options: {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: DEFAULT_CONNECTION_TEST_PROMPT }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 8,
        },
      }),
    },
    timeoutMs,
  };
}

function buildModelProbeRequest(profile: AIProfile): {
  endpoint: string;
  options: RequestInit;
  timeoutMs: number;
} {
  const baseEndpoint = stripKnownEndpointSuffix(profile.apiType, profile.apiEndpoint);
  const timeoutMs = getProfileTimeoutMs(profile);
  const signal = createTimeoutSignal(timeoutMs);

  if (profile.apiType === "openai") {
    return {
      endpoint: ensureApiEndpointPath(baseEndpoint, "v1/models"),
      options: {
        method: "GET",
        signal,
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
        },
      },
      timeoutMs,
    };
  }

  if (profile.apiType === "anthropic") {
    return {
      endpoint: ensureApiEndpointPath(baseEndpoint, "v1/models"),
      options: {
        method: "GET",
        signal,
        headers: {
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      timeoutMs,
    };
  }

  return {
    endpoint: withQueryParams(ensureApiEndpointPath(baseEndpoint, "v1beta/models"), {
      key: profile.apiKey,
    }),
    options: {
      method: "GET",
      signal,
    },
    timeoutMs,
  };
}

function extractProbeModels(profile: AIProfile, payload: unknown): string[] {
  const record = payload as Record<string, unknown>;

  if (profile.apiType === "openai" || profile.apiType === "anthropic") {
    const data = Array.isArray(record.data) ? record.data : [];
    return data
      .map((item) => {
        const modelRecord = item as Record<string, unknown>;
        return typeof modelRecord.id === "string" ? modelRecord.id.trim() : "";
      })
      .filter((item) => item.length > 0);
  }

  const models = Array.isArray(record.models) ? record.models : [];
  return models
    .flatMap((item) => {
      const modelRecord = item as Record<string, unknown>;
      const methods = Array.isArray(modelRecord.supportedGenerationMethods)
        ? modelRecord.supportedGenerationMethods
        : [];
      if (!methods.some((method) => method === "generateContent")) {
        return [];
      }
      const candidates = [
        typeof modelRecord.baseModelId === "string" ? modelRecord.baseModelId.trim() : "",
        typeof modelRecord.name === "string" ? normalizeGeminiModelName(modelRecord.name) : "",
      ];
      return candidates.filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
    })
    .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);
}

export async function loadRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
  const response = await fetch(DIAGNOSTICS_API, {
    method: "GET",
    headers: withLocalServiceHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseFailureDetail(response));
  }

  return (await response.json()) as RuntimeDiagnostics;
}

export async function testAIProfileConnection(profile: AIProfile): Promise<ConnectionTestResult> {
  const { endpoint, options, timeoutMs } = buildConnectionTestRequest(profile);
  const startedAt = Date.now();

  try {
    const response = await smartFetch(endpoint, options, {
      timeoutMs,
      maxRetries: 0,
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const detail = await parseFailureDetail(response);
      return {
        ok: false,
        provider: profile.apiType,
        endpoint,
        model: profile.model,
        latencyMs,
        message: "连接测试失败",
        detail,
      };
    }

    try {
      await response.body?.cancel?.();
    } catch {
      // ignore response body cancellation failure
    }

    return {
      ok: true,
      provider: profile.apiType,
      endpoint,
      model: profile.model,
      latencyMs,
      message: "连接正常，当前模型可用",
    };
  } catch (error) {
    return {
      ok: false,
      provider: profile.apiType,
      endpoint,
      model: profile.model,
      latencyMs: Date.now() - startedAt,
      message: "连接测试失败",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeAIProfileModels(profile: AIProfile): Promise<ModelProbeResult> {
  const { endpoint, options, timeoutMs } = buildModelProbeRequest(profile);

  try {
    const response = await smartFetch(endpoint, options, {
      timeoutMs,
      maxRetries: 0,
    });

    if (!response.ok) {
      return {
        ok: false,
        provider: profile.apiType,
        endpoint,
        currentModel: profile.model,
        currentModelAvailable: false,
        models: [],
        message: "模型探测失败",
        detail: await parseFailureDetail(response),
      };
    }

    const payload = await response.json();
    const models = extractProbeModels(profile, payload).slice(0, 40);
    const currentModel = profile.apiType === "gemini"
      ? normalizeGeminiModelName(profile.model)
      : profile.model.trim();
    const currentModelAvailable = models.includes(currentModel);

    return {
      ok: true,
      provider: profile.apiType,
      endpoint,
      currentModel: profile.model,
      currentModelAvailable,
      models,
      message: models.length > 0 ? "已获取可用模型列表" : "接口可访问，但未返回模型列表",
    };
  } catch (error) {
    return {
      ok: false,
      provider: profile.apiType,
      endpoint,
      currentModel: profile.model,
      currentModelAvailable: false,
      models: [],
      message: "模型探测失败",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

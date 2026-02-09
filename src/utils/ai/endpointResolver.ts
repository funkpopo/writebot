import { APIType } from "../storageService";

const OPENAI_COMPLETIONS_PATH = "v1/chat/completions";
const ANTHROPIC_MESSAGES_PATH = "v1/messages";
const GEMINI_GENERATE_PATH = "v1beta/models/{model}:generateContent";
const GEMINI_STREAM_PATH = "v1beta/models/{model}:streamGenerateContent";

function removeDuplicatedLeadingSegment(basePath: string, pathSuffix: string): string {
  const suffixSegments = pathSuffix.split("/");
  const firstSegment = suffixSegments[0]?.toLowerCase();
  if (!firstSegment) return pathSuffix;

  const normalizedBasePath = basePath.replace(/\/+$/, "").toLowerCase();
  if (!normalizedBasePath.endsWith(`/${firstSegment}`)) {
    return pathSuffix;
  }

  const [, ...rest] = suffixSegments;
  return rest.join("/");
}

function joinBaseAndPath(baseUrl: string, pathSuffix: string): string {
  const cleanedBase = baseUrl.trim();
  const cleanedSuffix = pathSuffix.replace(/^\/+/, "");

  try {
    const url = new URL(cleanedBase);
    const basePath = url.pathname.replace(/\/+$/, "");
    const suffix = removeDuplicatedLeadingSegment(basePath, cleanedSuffix);
    const prefix = basePath ? `${basePath}/` : "/";
    url.pathname = `${prefix}${suffix}`.replace(/\/{2,}/g, "/");
    return url.toString();
  } catch {
    const basePath = cleanedBase.replace(/\/+$/, "");
    const suffix = removeDuplicatedLeadingSegment(basePath, cleanedSuffix);
    return `${basePath}/${suffix}`;
  }
}

function ensurePath(endpoint: string, requiredPath: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;

  const normalizedRequiredPath = `/${requiredPath}`.toLowerCase();
  if (trimmed.toLowerCase().includes(normalizedRequiredPath)) {
    return trimmed;
  }

  return joinBaseAndPath(trimmed, requiredPath);
}

function normalizeGeminiModel(model: string | undefined): string {
  const trimmed = model?.trim() || "gemini-1.5-pro";
  return trimmed.replace(/^models\//i, "");
}

function applyGeminiModel(pathTemplate: string, model: string): string {
  return pathTemplate.replace(/\{model\}/gi, model);
}

function normalizeGeminiActionEndpoint(endpoint: string, stream: boolean): string {
  const lower = endpoint.toLowerCase();
  const hasGenerate = lower.includes(":generatecontent");
  const hasStreamGenerate = lower.includes(":streamgeneratecontent");

  if (stream && hasGenerate && !hasStreamGenerate) {
    return endpoint.replace(/:generateContent/i, ":streamGenerateContent");
  }

  if (!stream && hasStreamGenerate) {
    return endpoint.replace(/:streamGenerateContent/i, ":generateContent");
  }

  return endpoint;
}

export function resolveApiEndpoint(params: {
  apiType: APIType;
  apiEndpoint: string;
  model: string;
  stream?: boolean;
}): string {
  const { apiType, apiEndpoint, model, stream = false } = params;
  const trimmedEndpoint = apiEndpoint?.trim() || "";
  if (!trimmedEndpoint) return trimmedEndpoint;

  if (apiType === "openai") {
    return ensurePath(trimmedEndpoint, OPENAI_COMPLETIONS_PATH);
  }

  if (apiType === "anthropic") {
    return ensurePath(trimmedEndpoint, ANTHROPIC_MESSAGES_PATH);
  }

  const normalizedModel = normalizeGeminiModel(model);
  const pathTemplate = stream ? GEMINI_STREAM_PATH : GEMINI_GENERATE_PATH;
  const requiredPath = applyGeminiModel(pathTemplate, normalizedModel);

  const endpointWithModel = trimmedEndpoint.replace(/\{model\}/gi, normalizedModel);
  const lower = endpointWithModel.toLowerCase();
  if (lower.includes(":generatecontent") || lower.includes(":streamgeneratecontent")) {
    return normalizeGeminiActionEndpoint(endpointWithModel, stream);
  }

  return joinBaseAndPath(endpointWithModel, requiredPath);
}

export function withQueryParams(url: string, params: Record<string, string>): string {
  try {
    const parsedUrl = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      parsedUrl.searchParams.set(key, value);
    });
    return parsedUrl.toString();
  } catch {
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${query}`;
  }
}

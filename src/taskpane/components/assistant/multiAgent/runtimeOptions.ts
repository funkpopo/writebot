import {
  getAIConfig,
  type AIRequestOptions,
} from "../../../../utils/aiService";
import { getDefaultParallelSectionConcurrency } from "../../../../utils/storageService";

export interface RuntimeAgentOptions {
  planner: AIRequestOptions | undefined;
  writer: AIRequestOptions | undefined;
  parallelSectionConcurrency: number;
}

export function normalizeTemperature(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(2, Math.max(0, value));
}

export function normalizeParallelSectionConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return getDefaultParallelSectionConcurrency();
  }
  const normalized = Math.floor(value);
  return Math.min(6, Math.max(1, normalized));
}

export function createAgentRequestOptions(
  model: string | undefined,
  temperature: number | undefined,
): AIRequestOptions | undefined {
  const options: AIRequestOptions = {};
  const trimmedModel = model?.trim();
  if (trimmedModel) {
    options.model = trimmedModel;
  }
  const normalizedTemperature = normalizeTemperature(temperature);
  if (normalizedTemperature !== undefined) {
    options.temperature = normalizedTemperature;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

export function getRuntimeAgentOptions(): RuntimeAgentOptions {
  const config = getAIConfig();

  return {
    planner: createAgentRequestOptions(config.plannerModel, config.plannerTemperature),
    writer: createAgentRequestOptions(config.writerModel, config.writerTemperature),
    parallelSectionConcurrency: normalizeParallelSectionConcurrency(config.parallelSectionConcurrency),
  };
}

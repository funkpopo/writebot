import { z } from "zod";

const toolArgumentsSchema = z.record(z.string(), z.unknown());

export function parseToolArguments(input: unknown): Record<string, unknown> {
  let candidate = input;
  if (typeof input === "string") {
    try {
      candidate = JSON.parse(input);
    } catch {
      return { _raw: input };
    }
  }

  const result = toolArgumentsSchema.safeParse(candidate);
  if (result.success) return result.data;
  return typeof input === "string" ? { _raw: input } : {};
}

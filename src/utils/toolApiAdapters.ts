import { ToolDefinition, ToolCallRequest } from "../types/tools";

type JsonSchemaType = "object" | "array" | "string" | "number" | "boolean";

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty | { type: JsonSchemaType };
  properties?: Record<string, JsonSchemaProperty>;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

function toJsonSchema(tool: ToolDefinition): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    const schema: JsonSchemaProperty = {
      type: param.type as JsonSchemaType,
      description: param.description,
    };

    if (param.enum) {
      schema.enum = param.enum;
    }

    if (param.default !== undefined) {
      schema.default = param.default;
    }

    if (param.type === "array") {
      schema.items = { type: "string" };
    }

    if (param.type === "object") {
      schema.properties = {};
    }

    properties[param.name] = schema;

    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
  };
}

function parseArguments(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object") {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: args };
    }
    return { _raw: args };
  }
  return {};
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool),
    },
  }));
}

export function parseOpenAIToolCalls(response: any): ToolCallRequest[] {
  const calls = response?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];

  return calls.map((call: any, index: number) => ({
    id: call.id || `${call.function?.name || "tool"}_${index}`,
    name: call.function?.name || "unknown",
    arguments: parseArguments(call.function?.arguments),
  }));
}

export function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toJsonSchema(tool),
  }));
}

export function parseAnthropicToolCalls(response: any): ToolCallRequest[] {
  const blocks = response?.content;
  if (!Array.isArray(blocks)) return [];

  return blocks
    .filter((block: any) => block?.type === "tool_use")
    .map((block: any, index: number) => ({
      id: block.id || `${block.name || "tool"}_${index}`,
      name: block.name || "unknown",
      arguments: parseArguments(block.input),
    }));
}

export function toGeminiTools(tools: ToolDefinition[]): GeminiTool {
  return {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool),
    })),
  };
}

export function parseGeminiToolCalls(response: any): ToolCallRequest[] {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];

  const results: ToolCallRequest[] = [];
  parts.forEach((part: any, index: number) => {
    const call = part?.functionCall || part?.function_call;
    if (!call) return;
    results.push({
      id: call.id || `${call.name || "tool"}_${index}`,
      name: call.name || "unknown",
      arguments: parseArguments(call.args ?? call.arguments ?? call.argsJson),
    });
  });

  return results;
}

export function serializeToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? {});
  } catch {
    return String(result ?? "");
  }
}

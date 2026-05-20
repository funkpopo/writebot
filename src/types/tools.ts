export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
  properties?: ToolParameter[];
}

export type AgentPermissionMode = "default" | "auto_review" | "full_access";

export interface ToolDefinition {
  name: string;
  description: string;
  category: "document" | "format" | "query" | "external";
  riskLevel: "read" | "suggest" | "write" | "destructive";
  requiresConfirmation: boolean;
  scope: "selection" | "cursor" | "paragraph" | "document" | "format" | "snapshot";
  mutatesSelection?: boolean;
  supportsUndo?: boolean;
  parallelSafe?: boolean;
  agentAutoExecute?: boolean;
  parameters: ToolParameter[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

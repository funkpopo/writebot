/**
 * Agent 权限模式存储（localStorage）
 */

import type { AgentPermissionMode } from "../../types/tools";

export const AGENT_PERMISSION_MODE_KEY = "writebot_agent_permission_mode";
const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode = "default";

function normalizeAgentPermissionMode(value: unknown): AgentPermissionMode {
  return value === "auto_review" || value === "full_access" || value === "default"
    ? value
    : DEFAULT_AGENT_PERMISSION_MODE;
}

export function loadAgentPermissionMode(): AgentPermissionMode {
  try {
    return normalizeAgentPermissionMode(localStorage.getItem(AGENT_PERMISSION_MODE_KEY));
  } catch {
    return DEFAULT_AGENT_PERMISSION_MODE;
  }
}

export function saveAgentPermissionMode(mode: AgentPermissionMode): void {
  try {
    localStorage.setItem(AGENT_PERMISSION_MODE_KEY, normalizeAgentPermissionMode(mode));
  } catch {
    // ignore permission preference persistence failure
  }
}

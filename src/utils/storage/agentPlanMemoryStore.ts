/**
 * Agent 计划/记忆文件存储 - plan.md / memory.md
 * 服务端（本地服务）为主存储，localStorage 仅作运行时缓存。
 */

import { buildLocalServiceUrl, withLocalServiceHeaders } from "../localServiceClient";

const AGENT_PLAN_KEY = "writebot_agent_plan_md";
const AGENT_PLAN_API = buildLocalServiceUrl("/api/plan");
const AGENT_MEMORY_KEY = "writebot_agent_memory_md";
const AGENT_MEMORY_API = buildLocalServiceUrl("/api/memory");

export interface AgentPlanFile {
  fileName: "plan.md";
  path: string;
  content: string;
  request: string;
  stageCount: number;
  updatedAt: string;
}

export interface AgentMemoryFile {
  fileName: "memory.md";
  path: string;
  content: string;
  updatedAt: string;
}

export function getAgentPlanPath(): string {
  return AGENT_PLAN_API;
}

export async function saveAgentPlan(params: {
  content: string;
  request: string;
  stageCount: number;
}): Promise<AgentPlanFile> {
  const file: AgentPlanFile = {
    fileName: "plan.md",
    path: AGENT_PLAN_API,
    content: params.content,
    request: params.request,
    stageCount: params.stageCount,
    updatedAt: new Date().toISOString(),
  };

  try {
    await fetch(AGENT_PLAN_API, {
      method: "PUT",
      headers: withLocalServiceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(file),
    });
  } catch (e) {
    console.error("保存 Agent plan.md 到服务端失败:", e);
  }

  // 同步写入 localStorage 作为运行时缓存（不作为持久化来源）
  try {
    localStorage.setItem(AGENT_PLAN_KEY, JSON.stringify(file));
  } catch { /* ignore */ }

  return file;
}

export async function loadAgentPlan(): Promise<AgentPlanFile | null> {
  try {
    const res = await fetch(AGENT_PLAN_API, {
      headers: withLocalServiceHeaders(),
      cache: "no-store",
    });
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentPlanFile>;
      if (parsed && typeof parsed.content === "string") {
        return {
          fileName: "plan.md",
          path: AGENT_PLAN_API,
          content: parsed.content,
          request: typeof parsed.request === "string" ? parsed.request : "",
          stageCount:
            typeof parsed.stageCount === "number" && Number.isFinite(parsed.stageCount)
              ? Math.max(1, Math.floor(parsed.stageCount))
              : 1,
          updatedAt:
            typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
              ? parsed.updatedAt
              : new Date().toISOString(),
        };
      }
    }
  } catch (e) {
    console.error("从服务端加载 Agent plan.md 失败:", e);
  }
  return null;
}

export async function clearAgentPlan(): Promise<void> {
  try {
    await fetch(AGENT_PLAN_API, {
      method: "DELETE",
      headers: withLocalServiceHeaders(),
    });
  } catch (e) {
    console.error("从服务端清除 Agent plan.md 失败:", e);
  }
  try {
    localStorage.removeItem(AGENT_PLAN_KEY);
  } catch { /* ignore */ }
}

export function getAgentMemoryPath(): string {
  return AGENT_MEMORY_API;
}

function normalizeAgentMemoryFile(value: Partial<AgentMemoryFile>): AgentMemoryFile | null {
  if (!value || typeof value.content !== "string") {
    return null;
  }
  const normalizedPath = typeof value.path === "string" && value.path.trim()
    ? value.path
    : AGENT_MEMORY_API;
  return {
    fileName: "memory.md",
    path: normalizedPath,
    content: value.content,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

function loadAgentMemoryFromCache(): AgentMemoryFile | null {
  try {
    const cached = localStorage.getItem(AGENT_MEMORY_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as Partial<AgentMemoryFile>;
    return normalizeAgentMemoryFile(parsed);
  } catch {
    return null;
  }
}

export async function saveAgentMemory(params: {
  content: string;
}): Promise<AgentMemoryFile> {
  const file: AgentMemoryFile = {
    fileName: "memory.md",
    path: AGENT_MEMORY_API,
    content: params.content,
    updatedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(AGENT_MEMORY_API, {
      method: "PUT",
      headers: withLocalServiceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(file),
    });
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentMemoryFile>;
      if (typeof parsed.path === "string" && parsed.path.trim()) {
        file.path = parsed.path;
      }
      if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
        file.updatedAt = parsed.updatedAt;
      }
    }
  } catch (e) {
    console.error("保存 Agent memory.md 到服务端失败:", e);
  }

  try {
    localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(file));
  } catch { /* ignore */ }

  return file;
}

export async function loadAgentMemory(): Promise<AgentMemoryFile | null> {
  try {
    const res = await fetch(AGENT_MEMORY_API, {
      headers: withLocalServiceHeaders(),
      cache: "no-store",
    });
    if (res.ok) {
      const parsed = (await res.json()) as Partial<AgentMemoryFile>;
      const normalized = normalizeAgentMemoryFile(parsed);
      if (normalized) {
        try {
          localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(normalized));
        } catch { /* ignore */ }
        return normalized;
      }
    }
  } catch (e) {
    console.error("从服务端加载 Agent memory.md 失败:", e);
  }
  return loadAgentMemoryFromCache();
}

export async function clearAgentMemory(): Promise<void> {
  try {
    await fetch(AGENT_MEMORY_API, {
      method: "DELETE",
      headers: withLocalServiceHeaders(),
    });
  } catch (e) {
    console.error("从服务端清除 Agent memory.md 失败:", e);
  }
  try {
    localStorage.removeItem(AGENT_MEMORY_KEY);
  } catch { /* ignore */ }
}

/**
 * 在页面关闭阶段尽力清理 memory.md：
 * - 立即清空本地缓存（同步）
 * - 使用 keepalive 请求删除服务端文件（异步，页面退出期间尽力送达）
 */
export function clearAgentMemoryOnShutdown(): void {
  try {
    localStorage.removeItem(AGENT_MEMORY_KEY);
  } catch {
    // ignore
  }

  try {
    void fetch(AGENT_MEMORY_API, {
      method: "DELETE",
      headers: withLocalServiceHeaders(),
      keepalive: true,
    });
  } catch {
    // ignore
  }
}

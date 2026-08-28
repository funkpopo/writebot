/**
 * Agent 管线检查点存储 - checkpoint.json
 * 服务端（本地服务）为主存储（带 revision 乐观并发控制），localStorage 仅作运行时缓存。
 */

import {
  isAgentNodeId,
  isAgentRunState,
  isAgentCheckpointStatus,
  type AgentCheckpointStatus,
  type AgentNodeId,
  type AgentRunState,
} from "../agentRunState";
import { buildLocalServiceUrl, withLocalServiceHeaders } from "../localServiceClient";

const AGENT_CHECKPOINT_KEY = "writebot_agent_checkpoint";
const AGENT_CHECKPOINT_API = buildLocalServiceUrl("/api/checkpoint");
const AGENT_CHECKPOINT_RECOVERY_VERSION = 1;
const MAX_AGENT_TOOL_REPLAY_ENTRIES = 96;

export interface PipelineCheckpointData {
  runId: string;
  request: string;
  promptContract?: unknown;
  promptContractHash?: string;
  nodeId: AgentNodeId;
  loopCount: number;
  status: AgentCheckpointStatus;
  runState?: AgentRunState;
  outline?: unknown;
  writtenSections?: unknown;
  documentSession?: unknown;
  updatedAt: string;
}

export interface AgentCheckpointFile {
  fileName: "checkpoint.json";
  path: string;
  checkpoint: PipelineCheckpointData;
  memorySnapshotPath?: string;
  memorySnapshot?: unknown;
  recoveryState?: AgentCheckpointRecoveryState;
  revision?: number;
  checkpointHash?: string;
  updatedAt: string;
}

export type AgentCheckpointToolReplayStatus = "prepared" | "committed" | "failed" | "skipped";
export type AgentCheckpointToolReplayVerificationStatus =
  | "pending"
  | "matched"
  | "missing"
  | "conflict"
  | "unsupported";

export interface AgentCheckpointToolReplayEntry {
  replayKey: string;
  idempotencyKey: string;
  toolName: string;
  toolCallId: string;
  argsDigest: string;
  locationHint?: string;
  normalizedText?: string;
  textHash?: string;
  status: AgentCheckpointToolReplayStatus;
  verificationStatus?: AgentCheckpointToolReplayVerificationStatus;
  verificationMessage?: string;
  preparedAt?: string;
  committedAt?: string;
  updatedAt: string;
}

export interface AgentCheckpointRecoveryState {
  version: number;
  toolReplays: AgentCheckpointToolReplayEntry[];
}

export function getAgentCheckpointPath(): string {
  return AGENT_CHECKPOINT_API;
}

function normalizeCheckpointData(value: unknown): PipelineCheckpointData | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const request = typeof record.request === "string" ? record.request : "";
  const nodeId = isAgentNodeId(record.nodeId) ? record.nodeId : "";
  const loopCount = typeof record.loopCount === "number" && Number.isFinite(record.loopCount)
    ? Math.max(0, Math.floor(record.loopCount))
    : 0;
  const statusCandidate = typeof record.status === "string" ? record.status : "running";
  const status = isAgentCheckpointStatus(statusCandidate)
    ? statusCandidate
    : "running";
  if (!runId || !nodeId) return null;
  return {
    runId,
    request,
    promptContract: record.promptContract,
    promptContractHash:
      typeof record.promptContractHash === "string" && record.promptContractHash.trim()
        ? record.promptContractHash
        : undefined,
    nodeId,
    loopCount,
    status,
    runState: isAgentRunState(record.runState) ? record.runState : undefined,
    outline: record.outline,
    writtenSections: record.writtenSections,
    documentSession: record.documentSession,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

function toSortableTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCheckpointReplayStatus(value: unknown): AgentCheckpointToolReplayStatus {
  return value === "committed" || value === "failed" || value === "skipped"
    ? value
    : "prepared";
}

function normalizeCheckpointReplayVerificationStatus(
  value: unknown
): AgentCheckpointToolReplayVerificationStatus | undefined {
  return value === "pending"
    || value === "matched"
    || value === "missing"
    || value === "conflict"
    || value === "unsupported"
    ? value
    : undefined;
}

function normalizeAgentCheckpointToolReplayEntry(
  value: unknown
): AgentCheckpointToolReplayEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const replayKey = typeof record.replayKey === "string" ? record.replayKey.trim() : "";
  const idempotencyKey =
    typeof record.idempotencyKey === "string" ? record.idempotencyKey.trim() : "";
  const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
  const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId.trim() : "";
  const argsDigest = typeof record.argsDigest === "string" ? record.argsDigest.trim() : "";
  if (!replayKey || !idempotencyKey || !toolName || !toolCallId || !argsDigest) {
    return null;
  }

  return {
    replayKey,
    idempotencyKey,
    toolName,
    toolCallId,
    argsDigest,
    locationHint:
      typeof record.locationHint === "string" && record.locationHint.trim()
        ? record.locationHint
        : undefined,
    normalizedText:
      typeof record.normalizedText === "string" && record.normalizedText.trim()
        ? record.normalizedText
        : undefined,
    textHash:
      typeof record.textHash === "string" && record.textHash.trim()
        ? record.textHash
        : undefined,
    status: normalizeCheckpointReplayStatus(record.status),
    verificationStatus: normalizeCheckpointReplayVerificationStatus(record.verificationStatus),
    verificationMessage:
      typeof record.verificationMessage === "string" && record.verificationMessage.trim()
        ? record.verificationMessage
        : undefined,
    preparedAt:
      typeof record.preparedAt === "string" && record.preparedAt.trim()
        ? record.preparedAt
        : undefined,
    committedAt:
      typeof record.committedAt === "string" && record.committedAt.trim()
        ? record.committedAt
        : undefined,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeAgentCheckpointRecoveryState(
  value: unknown
): AgentCheckpointRecoveryState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.toolReplays)
    ? record.toolReplays
      .map((item) => normalizeAgentCheckpointToolReplayEntry(item))
      .filter((item): item is AgentCheckpointToolReplayEntry => item !== null)
    : [];

  if (entries.length === 0) return undefined;

  const deduped = new Map<string, AgentCheckpointToolReplayEntry>();
  for (const entry of entries) {
    const previous = deduped.get(entry.idempotencyKey);
    if (!previous || toSortableTimestamp(entry.updatedAt) >= toSortableTimestamp(previous.updatedAt)) {
      deduped.set(entry.idempotencyKey, entry);
    }
  }

  const sortedEntries = Array.from(deduped.values())
    .sort((a, b) => toSortableTimestamp(b.updatedAt) - toSortableTimestamp(a.updatedAt))
    .slice(0, MAX_AGENT_TOOL_REPLAY_ENTRIES);

  if (sortedEntries.length === 0) return undefined;

  const version = typeof record.version === "number" && Number.isFinite(record.version)
    ? Math.max(1, Math.floor(record.version))
    : AGENT_CHECKPOINT_RECOVERY_VERSION;

  return {
    version,
    toolReplays: sortedEntries,
  };
}

function mergeAgentCheckpointRecoveryState(
  base: AgentCheckpointRecoveryState | undefined,
  next: AgentCheckpointRecoveryState | undefined
): AgentCheckpointRecoveryState | undefined {
  if (!base) return next;
  if (!next) return base;
  return normalizeAgentCheckpointRecoveryState({
    version: Math.max(base.version, next.version),
    toolReplays: [...base.toolReplays, ...next.toolReplays],
  });
}

function normalizeAgentCheckpointFile(value: unknown): AgentCheckpointFile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const checkpoint = normalizeCheckpointData(record.checkpoint ?? value);
  if (!checkpoint) return null;
  return {
    fileName: "checkpoint.json",
    path:
      typeof record.path === "string" && record.path.trim()
        ? record.path
        : AGENT_CHECKPOINT_API,
    checkpoint,
    memorySnapshotPath:
      typeof record.memorySnapshotPath === "string" && record.memorySnapshotPath.trim()
        ? record.memorySnapshotPath
        : undefined,
    memorySnapshot: record.memorySnapshot,
    recoveryState: normalizeAgentCheckpointRecoveryState(record.recoveryState),
    revision:
      typeof record.revision === "number" && Number.isFinite(record.revision)
        ? Math.max(0, Math.floor(record.revision))
        : undefined,
    checkpointHash:
      typeof record.checkpointHash === "string" && record.checkpointHash.trim()
        ? record.checkpointHash
        : undefined,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

function loadAgentCheckpointFromCache(): AgentCheckpointFile | null {
  try {
    const cached = localStorage.getItem(AGENT_CHECKPOINT_KEY);
    if (!cached) return null;
    return normalizeAgentCheckpointFile(JSON.parse(cached));
  } catch {
    return null;
  }
}

function writeAgentCheckpointToCache(file: AgentCheckpointFile): void {
  try {
    localStorage.setItem(AGENT_CHECKPOINT_KEY, JSON.stringify(file));
  } catch {
    // ignore
  }
}

export async function saveAgentCheckpoint(params: {
  checkpoint: PipelineCheckpointData;
  memorySnapshot?: unknown;
  recoveryState?: AgentCheckpointRecoveryState;
  baseRevision?: number;
}): Promise<AgentCheckpointFile> {
  let base = loadAgentCheckpointFromCache();

  const buildPayload = (currentBase?: AgentCheckpointFile | null) => {
    const shouldReuseRecoveryState = currentBase?.checkpoint.runId === params.checkpoint.runId;
    const reusableRecoveryState = shouldReuseRecoveryState ? currentBase?.recoveryState : undefined;
    const payload: Record<string, unknown> = {
      fileName: "checkpoint.json" as const,
      path: AGENT_CHECKPOINT_API,
      checkpoint: params.checkpoint,
      recoveryState: params.recoveryState
        ? mergeAgentCheckpointRecoveryState(reusableRecoveryState, params.recoveryState)
        : reusableRecoveryState,
      revision: currentBase?.revision ?? params.baseRevision,
      updatedAt: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(params, "memorySnapshot")) {
      payload.memorySnapshot = params.memorySnapshot;
    }

    return payload;
  };

  let normalized = normalizeAgentCheckpointFile(buildPayload(base));
  if (!normalized) {
    throw new Error("保存 checkpoint 失败：参数不合法");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = buildPayload(base);
    normalized = normalizeAgentCheckpointFile(payload) || normalized;

    try {
      const res = await fetch(AGENT_CHECKPOINT_API, {
        method: "PUT",
        headers: withLocalServiceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const parsed = await res.json();
        const fromServer = normalizeAgentCheckpointFile(parsed);
        if (fromServer) {
          normalized = fromServer;
        }
        writeAgentCheckpointToCache(normalized);
        return normalized;
      }

      if (res.status === 409) {
        const parsed = await res.json().catch(() => null);
        const current = normalizeAgentCheckpointFile(
          parsed && typeof parsed === "object" && "current" in (parsed as Record<string, unknown>)
            ? (parsed as { current?: unknown }).current
            : parsed
        );
        if (current) {
          base = current;
          continue;
        }
      }
    } catch (e) {
      console.error("保存 Agent checkpoint 到服务端失败:", e);
      break;
    }
  }

  writeAgentCheckpointToCache(normalized);
  return normalized;
}

export async function loadAgentCheckpoint(): Promise<AgentCheckpointFile | null> {
  try {
    const res = await fetch(AGENT_CHECKPOINT_API, {
      headers: withLocalServiceHeaders(),
      cache: "no-store",
    });
    if (res.ok) {
      const parsed = await res.json();
      const normalized = normalizeAgentCheckpointFile(parsed);
      if (normalized) {
        writeAgentCheckpointToCache(normalized);
        return normalized;
      }
    }
  } catch (e) {
    console.error("从服务端加载 Agent checkpoint 失败:", e);
  }

  return loadAgentCheckpointFromCache();
}

export async function clearAgentCheckpoint(): Promise<void> {
  try {
    await fetch(AGENT_CHECKPOINT_API, {
      method: "DELETE",
      headers: withLocalServiceHeaders(),
    });
  } catch (e) {
    console.error("从服务端清除 Agent checkpoint 失败:", e);
  }
  try {
    localStorage.removeItem(AGENT_CHECKPOINT_KEY);
  } catch { /* ignore */ }
}

export async function upsertAgentCheckpointToolReplayEntry(
  entry: AgentCheckpointToolReplayEntry
): Promise<AgentCheckpointFile | null> {
  const normalizedEntry = normalizeAgentCheckpointToolReplayEntry(entry);
  if (!normalizedEntry) {
    throw new Error("保存 checkpoint 重放记录失败：参数不合法");
  }

  const base = loadAgentCheckpointFromCache() ?? await loadAgentCheckpoint();
  if (!base) return null;

  const nextEntries = [...(base.recoveryState?.toolReplays || [])];
  const index = nextEntries.findIndex((item) => item.idempotencyKey === normalizedEntry.idempotencyKey);
  if (index >= 0) {
    nextEntries[index] = {
      ...nextEntries[index],
      ...normalizedEntry,
      updatedAt: normalizedEntry.updatedAt,
    };
  } else {
    nextEntries.push(normalizedEntry);
  }

  const recoveryState = normalizeAgentCheckpointRecoveryState({
    version: base.recoveryState?.version ?? AGENT_CHECKPOINT_RECOVERY_VERSION,
    toolReplays: nextEntries,
  });

  return saveAgentCheckpoint({
    checkpoint: base.checkpoint,
    recoveryState,
    baseRevision: base.revision,
  });
}

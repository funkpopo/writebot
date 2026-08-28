/**
 * WriteBot 本地服务 - 数据规范化纯函数
 * 从 local-server.js 拆出，便于单元测试（代理设置 / 设置存储 / checkpoint 记录）。
 */

'use strict';

const crypto = require('crypto');

const DEFAULT_SYSTEM_PROXY_PORTS = {
  http: 8080,
  socks5: 1080,
};

const CHECKPOINT_STATUSES = ['running', 'completed', 'error', 'cancelled'];
const TOOL_REPLAY_STATUSES = ['prepared', 'committed', 'failed', 'skipped'];
const TOOL_REPLAY_VERIFICATION_STATUSES = ['pending', 'matched', 'missing', 'conflict', 'unsupported'];

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function computeCheckpointHash(checkpoint) {
  return sha256Hex(stableStringify(checkpoint || null));
}

function isValidSettingsStore(store) {
  return !!store
    && typeof store === 'object'
    && Array.isArray(store.profiles)
    && typeof store.activeProfileId === 'string';
}

function normalizeStoredProxySettings(value, defaultPorts = DEFAULT_SYSTEM_PROXY_PORTS) {
  if (!value || typeof value !== 'object') {
    return {
      enabled: false,
      protocol: 'http',
      host: '',
      port: defaultPorts.http,
      username: '',
      password: '',
    };
  }

  const record = value;
  const protocol = record.protocol === 'socks5' ? 'socks5' : 'http';
  const parsedPort = Number.parseInt(String(record.port || ''), 10);
  const defaultPort = defaultPorts[protocol];
  const host = typeof record.host === 'string' ? record.host.trim().replace(/^\[|\]$/g, '') : '';
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';

  return {
    enabled: record.enabled === true,
    protocol,
    host,
    port: Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : defaultPort,
    username,
    password,
  };
}

function normalizeCheckpointRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  const request = typeof record.request === 'string' ? record.request : '';
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : '';
  if (!runId || !nodeId) return null;
  const loopCount = Number.isFinite(record.loopCount) ? Math.max(0, Math.floor(record.loopCount)) : 0;
  const status = CHECKPOINT_STATUSES.includes(record.status)
    ? record.status
    : 'running';
  return {
    runId,
    request,
    nodeId,
    loopCount,
    status,
    outline: record.outline,
    writtenSections: record.writtenSections,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : new Date().toISOString(),
  };
}

function normalizeToolReplayEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const replayKey = typeof record.replayKey === 'string' ? record.replayKey.trim() : '';
  const idempotencyKey = typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : '';
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : '';
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId.trim() : '';
  const argsDigest = typeof record.argsDigest === 'string' ? record.argsDigest.trim() : '';
  if (!replayKey || !idempotencyKey || !toolName || !toolCallId || !argsDigest) {
    return null;
  }

  const status = TOOL_REPLAY_STATUSES.includes(record.status)
    ? record.status
    : 'prepared';
  const verificationStatus = TOOL_REPLAY_VERIFICATION_STATUSES.includes(record.verificationStatus)
    ? record.verificationStatus
    : undefined;

  return {
    replayKey,
    idempotencyKey,
    toolName,
    toolCallId,
    argsDigest,
    locationHint: typeof record.locationHint === 'string' && record.locationHint.trim()
      ? record.locationHint
      : undefined,
    normalizedText: typeof record.normalizedText === 'string' && record.normalizedText.trim()
      ? record.normalizedText
      : undefined,
    textHash: typeof record.textHash === 'string' && record.textHash.trim()
      ? record.textHash
      : undefined,
    status,
    verificationStatus,
    verificationMessage: typeof record.verificationMessage === 'string' && record.verificationMessage.trim()
      ? record.verificationMessage
      : undefined,
    preparedAt: typeof record.preparedAt === 'string' && record.preparedAt.trim()
      ? record.preparedAt
      : undefined,
    committedAt: typeof record.committedAt === 'string' && record.committedAt.trim()
      ? record.committedAt
      : undefined,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : new Date().toISOString(),
  };
}

function normalizeCheckpointRecoveryState(value, maxReplays = 96) {
  if (!value || typeof value !== 'object') return undefined;
  const record = value;
  const entries = Array.isArray(record.toolReplays)
    ? record.toolReplays
      .map((item) => normalizeToolReplayEntry(item))
      .filter(Boolean)
    : [];
  if (entries.length === 0) return undefined;

  const deduped = new Map();
  for (const entry of entries) {
    const previous = deduped.get(entry.idempotencyKey);
    if (!previous || Date.parse(entry.updatedAt) >= Date.parse(previous.updatedAt)) {
      deduped.set(entry.idempotencyKey, entry);
    }
  }

  return {
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(record.version)) : 1,
    toolReplays: Array.from(deduped.values())
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, maxReplays),
  };
}

module.exports = {
  DEFAULT_SYSTEM_PROXY_PORTS,
  stableStringify,
  sha256Hex,
  computeCheckpointHash,
  isValidSettingsStore,
  normalizeStoredProxySettings,
  normalizeCheckpointRecord,
  normalizeToolReplayEntry,
  normalizeCheckpointRecoveryState,
};

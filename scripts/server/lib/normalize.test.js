/**
 * 数据规范化纯函数测试（代理设置 / 设置存储 / checkpoint 记录）
 */
const { describe, it, expect } = require('bun:test');
const normalize = require('./normalize.js');

describe('normalizeStoredProxySettings', () => {
  it('returns disabled defaults for invalid input', () => {
    expect(normalize.normalizeStoredProxySettings(undefined)).toEqual({
      enabled: false,
      protocol: 'http',
      host: '',
      port: 8080,
      username: '',
      password: '',
    });
    expect(normalize.normalizeStoredProxySettings('nope')).toEqual(
      normalize.normalizeStoredProxySettings(null)
    );
  });

  it('normalizes protocol, host and port', () => {
    const result = normalize.normalizeStoredProxySettings({
      enabled: true,
      protocol: 'socks5',
      host: ' [Proxy.Example.com] ',
      port: '99999',
      username: ' user ',
      password: 'pass',
    });
    expect(result).toEqual({
      enabled: true,
      protocol: 'socks5',
      host: 'Proxy.Example.com',
      port: 1080, // 超出范围回退默认端口
      username: 'user',
      password: 'pass',
    });
  });

  it('keeps valid ports and falls back per protocol', () => {
    expect(normalize.normalizeStoredProxySettings({ protocol: 'http', port: 3128 }).port).toBe(3128);
    expect(normalize.normalizeStoredProxySettings({ protocol: 'http' }).port).toBe(8080);
    expect(normalize.normalizeStoredProxySettings({ protocol: 'socks5' }).port).toBe(1080);
    expect(normalize.normalizeStoredProxySettings({ port: 0 }).port).toBe(8080);
    expect(normalize.normalizeStoredProxySettings({ port: -1 }).port).toBe(8080);
  });
});

describe('isValidSettingsStore', () => {
  it('requires object with profiles array and activeProfileId string', () => {
    expect(normalize.isValidSettingsStore({ profiles: [], activeProfileId: 'a' })).toBe(true);
    expect(normalize.isValidSettingsStore({ profiles: 'x', activeProfileId: 'a' })).toBe(false);
    expect(normalize.isValidSettingsStore({ profiles: [] })).toBe(false);
    expect(normalize.isValidSettingsStore(null)).toBe(false);
    expect(normalize.isValidSettingsStore('store')).toBe(false);
  });
});

describe('normalizeCheckpointRecord', () => {
  it('returns null for missing runId/nodeId or invalid input', () => {
    expect(normalize.normalizeCheckpointRecord(null)).toBe(null);
    expect(normalize.normalizeCheckpointRecord({ runId: 'r' })).toBe(null);
    expect(normalize.normalizeCheckpointRecord({ nodeId: 'n' })).toBe(null);
  });

  it('normalizes fields and clamps loopCount', () => {
    const result = normalize.normalizeCheckpointRecord({
      runId: ' run-1 ',
      nodeId: 'write',
      loopCount: 2.7,
      status: 'weird',
      outline: { sections: [] },
    });
    expect(result.runId).toBe('run-1');
    expect(result.nodeId).toBe('write');
    expect(result.loopCount).toBe(2);
    expect(result.status).toBe('running');
    expect(result.outline).toEqual({ sections: [] });
    expect(typeof result.updatedAt).toBe('string');
  });

  it('preserves valid status and updatedAt', () => {
    const result = normalize.normalizeCheckpointRecord({
      runId: 'r',
      nodeId: 'n',
      status: 'completed',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.status).toBe('completed');
    expect(result.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('normalizeToolReplayEntry', () => {
  const validEntry = {
    replayKey: 'rk',
    idempotencyKey: 'ik',
    toolName: 'insert_text',
    toolCallId: 'tc_1',
    argsDigest: 'digest',
  };

  it('returns null when required fields are missing', () => {
    expect(normalize.normalizeToolReplayEntry(null)).toBe(null);
    expect(normalize.normalizeToolReplayEntry({ ...validEntry, toolName: '' })).toBe(null);
    expect(normalize.normalizeToolReplayEntry({ ...validEntry, argsDigest: '  ' })).toBe(null);
  });

  it('falls back to prepared status and trims fields', () => {
    const result = normalize.normalizeToolReplayEntry({
      ...validEntry,
      toolName: ' insert_text ',
      status: 'nonsense',
    });
    expect(result.toolName).toBe('insert_text');
    expect(result.status).toBe('prepared');
    expect(result.verificationStatus).toBeUndefined();
  });

  it('keeps valid status/verification values', () => {
    const result = normalize.normalizeToolReplayEntry({
      ...validEntry,
      status: 'committed',
      verificationStatus: 'matched',
    });
    expect(result.status).toBe('committed');
    expect(result.verificationStatus).toBe('matched');
  });
});

describe('normalizeCheckpointRecoveryState', () => {
  const entry = (idempotencyKey, updatedAt) => ({
    replayKey: `rk-${idempotencyKey}`,
    idempotencyKey,
    toolName: 'insert_text',
    toolCallId: `tc_${idempotencyKey}`,
    argsDigest: 'digest',
    updatedAt,
  });

  it('returns undefined for empty/invalid input', () => {
    expect(normalize.normalizeCheckpointRecoveryState(null)).toBeUndefined();
    expect(normalize.normalizeCheckpointRecoveryState({ toolReplays: [] })).toBeUndefined();
    expect(normalize.normalizeCheckpointRecoveryState({ toolReplays: [null, {}] })).toBeUndefined();
  });

  it('dedupes by idempotencyKey keeping the newest updatedAt', () => {
    const result = normalize.normalizeCheckpointRecoveryState({
      version: 2,
      toolReplays: [
        normalize.normalizeToolReplayEntry(entry('a', '2026-01-01T00:00:00.000Z')),
        normalize.normalizeToolReplayEntry(entry('a', '2026-01-02T00:00:00.000Z')),
        normalize.normalizeToolReplayEntry(entry('b', '2026-01-03T00:00:00.000Z')),
      ].filter(Boolean),
    });
    expect(result.version).toBe(2);
    expect(result.toolReplays).toHaveLength(2);
    // 按更新时间倒序
    expect(result.toolReplays[0].idempotencyKey).toBe('b');
    expect(result.toolReplays[1].idempotencyKey).toBe('a');
    expect(result.toolReplays[1].updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('respects the max replays limit', () => {
    const entries = [];
    for (let i = 0; i < 10; i += 1) {
      entries.push(normalize.normalizeToolReplayEntry(entry(`k${i}`, '2026-01-01T00:00:00.000Z')));
    }
    const result = normalize.normalizeCheckpointRecoveryState({ toolReplays: entries }, 3);
    expect(result.toolReplays).toHaveLength(3);
  });
});

describe('stableStringify / computeCheckpointHash', () => {
  it('produces key-order-independent hashes', () => {
    const hash1 = normalize.computeCheckpointHash({ a: 1, b: { x: 1, y: 2 } });
    const hash2 = normalize.computeCheckpointHash({ b: { x: 1, y: 2 }, a: 1 });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores undefined properties', () => {
    expect(normalize.computeCheckpointHash({ a: 1, b: undefined }))
      .toBe(normalize.computeCheckpointHash({ a: 1 }));
  });

  it('handles null/undefined checkpoints', () => {
    expect(normalize.computeCheckpointHash(null)).toBe(normalize.computeCheckpointHash(undefined));
  });
});

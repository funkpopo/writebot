/**
 * 安全校验纯函数测试（URL / 来源 / 回环地址 / 代理目标校验、转义）
 */
const { describe, it, expect } = require('bun:test');
const security = require('./security.js');

const ORIGIN = 'https://localhost:53000';

describe('isLoopbackAddress', () => {
  it('accepts loopback addresses including IPv4-mapped IPv6', () => {
    expect(security.isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(security.isLoopbackAddress('::1')).toBe(true);
    expect(security.isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(security.isLoopbackAddress('::FFFF:127.0.0.1')).toBe(true);
    expect(security.isLoopbackAddress('localhost')).toBe(true);
  });

  it('rejects empty and non-loopback addresses', () => {
    expect(security.isLoopbackAddress('')).toBe(false);
    expect(security.isLoopbackAddress(undefined)).toBe(false);
    expect(security.isLoopbackAddress(null)).toBe(false);
    expect(security.isLoopbackAddress('192.168.1.10')).toBe(false);
    expect(security.isLoopbackAddress('::ffff:192.168.1.10')).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('accepts loopback hostnames with IPv6 brackets', () => {
    expect(security.isLoopbackHost('localhost')).toBe(true);
    expect(security.isLoopbackHost('LOCALHOST')).toBe(true);
    expect(security.isLoopbackHost('127.0.0.1')).toBe(true);
    expect(security.isLoopbackHost('[::1]')).toBe(true);
    expect(security.isLoopbackHost('::1')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(security.isLoopbackHost('example.com')).toBe(false);
    expect(security.isLoopbackHost('127.0.0.2')).toBe(false);
    expect(security.isLoopbackHost('')).toBe(false);
    expect(security.isLoopbackHost(undefined)).toBe(false);
  });
});

describe('matchesAllowedOrigin', () => {
  it('allows empty/absent origin headers (non-CORS clients)', () => {
    expect(security.matchesAllowedOrigin('', ORIGIN)).toBe(true);
    expect(security.matchesAllowedOrigin(undefined, ORIGIN)).toBe(true);
  });

  it('allows exact origin match', () => {
    expect(security.matchesAllowedOrigin(ORIGIN, ORIGIN)).toBe(true);
  });

  it('rejects cross-origin values and malformed URLs', () => {
    expect(security.matchesAllowedOrigin('https://evil.example.com', ORIGIN)).toBe(false);
    expect(security.matchesAllowedOrigin('https://localhost:53001', ORIGIN)).toBe(false);
    expect(security.matchesAllowedOrigin('not-a-url', ORIGIN)).toBe(false);
  });
});

describe('isAuthorizedApiRequest', () => {
  const options = {
    clientHeaderName: 'x-writebot-client',
    clientHeaderValue: 'writebot-taskpane',
    origin: ORIGIN,
  };

  const makeReq = (headers, remoteAddress = '127.0.0.1') => ({
    headers,
    socket: { remoteAddress },
  });

  it('accepts a well-formed local taskpane request', () => {
    const req = makeReq({
      'x-writebot-client': 'writebot-taskpane',
      origin: ORIGIN,
    });
    expect(security.isAuthorizedApiRequest(req, options)).toBe(true);
  });

  it('rejects missing/wrong client header', () => {
    expect(security.isAuthorizedApiRequest(makeReq({ origin: ORIGIN }), options)).toBe(false);
    expect(
      security.isAuthorizedApiRequest(makeReq({ 'x-writebot-client': 'other-client' }), options)
    ).toBe(false);
  });

  it('rejects non-loopback remote address', () => {
    const req = makeReq(
      { 'x-writebot-client': 'writebot-taskpane' },
      '192.168.1.10'
    );
    expect(security.isAuthorizedApiRequest(req, options)).toBe(false);
  });

  it('rejects cross-origin Origin/Referer headers', () => {
    const req = makeReq({
      'x-writebot-client': 'writebot-taskpane',
      origin: 'https://evil.example.com',
    });
    expect(security.isAuthorizedApiRequest(req, options)).toBe(false);

    const req2 = makeReq({
      'x-writebot-client': 'writebot-taskpane',
      referer: 'https://evil.example.com/taskpane.html',
    });
    expect(security.isAuthorizedApiRequest(req2, options)).toBe(false);
  });
});

describe('isForbiddenProxyTarget', () => {
  it('forbids non-http(s) protocols and targets with credentials', () => {
    expect(security.isForbiddenProxyTarget(null)).toBe(true);
    expect(security.isForbiddenProxyTarget({ protocol: 'ftp:', hostname: 'example.com' })).toBe(true);
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', username: 'u' })).toBe(true);
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', password: 'p' })).toBe(true);
  });

  it('forbids loopback hostnames', () => {
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', hostname: 'localhost' })).toBe(true);
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', hostname: '127.0.0.1' })).toBe(true);
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', hostname: '[::1]' })).toBe(true);
  });

  it('allows public http(s) targets', () => {
    expect(security.isForbiddenProxyTarget({ protocol: 'https:', hostname: 'api.openai.com' })).toBe(false);
    expect(security.isForbiddenProxyTarget({ protocol: 'http:', hostname: 'example.com' })).toBe(false);
  });
});

describe('isObviouslyLocalHostname', () => {
  it('flags loopback and link-local style names', () => {
    expect(security.isObviouslyLocalHostname('localhost')).toBe(true);
    expect(security.isObviouslyLocalHostname('foo.localhost')).toBe(true);
    expect(security.isObviouslyLocalHostname('myhost.local')).toBe(true);
    expect(security.isObviouslyLocalHostname('myhost.internal')).toBe(true);
    expect(security.isObviouslyLocalHostname('nas.local')).toBe(true);
    expect(security.isObviouslyLocalHostname('NAS.LOCAL.')).toBe(true); // 尾部点号被去除
  });

  it('flags bare single-label hostnames without dots', () => {
    expect(security.isObviouslyLocalHostname('intranet')).toBe(true);
  });

  it('allows public FQDNs and IPs', () => {
    expect(security.isObviouslyLocalHostname('api.openai.com')).toBe(false);
    expect(security.isObviouslyLocalHostname('142.250.196.142')).toBe(false);
  });
});

describe('buildProxyUrl / formatHostForUrl', () => {
  it('formats IPv6 hosts with brackets', () => {
    expect(security.formatHostForUrl('::1')).toBe('[::1]');
    expect(security.formatHostForUrl('127.0.0.1')).toBe('127.0.0.1');
    expect(security.formatHostForUrl('[::1]')).toBe('[::1]');
  });

  it('builds proxy url with credentials encoded', () => {
    expect(
      security.buildProxyUrl({ protocol: 'http', host: 'proxy.local', port: 8080, username: '', password: '' })
    ).toBe('http://proxy.local:8080');
    expect(
      security.buildProxyUrl({ protocol: 'socks5', host: '::1', port: 1080, username: 'u', password: 'p' })
    ).toBe('socks5://u:p@[::1]:1080');
  });

  it('formats display endpoint', () => {
    expect(security.formatProxyEndpointForDisplay({ host: 'proxy.local', port: 8080 })).toBe('proxy.local:8080');
    expect(security.formatProxyEndpointForDisplay(null)).toBe(null);
  });
});

describe('escaping', () => {
  it('escapes PowerShell single quotes', () => {
    expect(security.escapePowerShellString("it's")).toBe("it''s");
  });

  it('escapes XML entities', () => {
    expect(security.escapeXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });
});

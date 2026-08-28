/**
 * API 代理处理器测试（离线：注入假 DNS 目标 + 假传输层）
 */
const { describe, it, expect } = require('bun:test');
const { EventEmitter } = require('events');
const { createProxyHandler, collectRequestBody } = require('./proxy.js');

const ORIGIN = 'https://localhost:53000';

function makeSendJson() {
  const responses = [];
  const sendJson = (res, statusCode, payload) => {
    res.headersSent = true;
    responses.push({ statusCode, payload });
    res.end();
  };
  return { sendJson, responses };
}

/** 构造可收集 body 的假请求 */
function makeReq(method, url, headers, bodyChunks) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.destroy = () => {};
  req.socket = { remoteAddress: '127.0.0.1' };
  if (bodyChunks) {
    setImmediate(() => {
      for (const chunk of bodyChunks) req.emit('data', chunk);
      req.emit('end');
    });
  }
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writeHeadCalls = [];
  res.written = [];
  res.writeHead = (status, headers) => {
    res.headersSent = true;
    res.writeHeadCalls.push({ status, headers });
  };
  res.write = (chunk) => res.written.push(chunk);
  res.end = () => {
    res.ended = true;
  };
  res.destroy = () => {};
  return res;
}

/** 构造假传输层：记录请求选项，异步回调响应 */
function makeTransport(responseFactory) {
  const requests = [];
  const transport = {
    requests,
    request(options, callback) {
      requests.push(options);
      const proxyReq = new EventEmitter();
      proxyReq.write = () => {};
      proxyReq.end = () => {
        setImmediate(() => {
          const proxyRes = responseFactory(options);
          callback(proxyRes);
        });
      };
      return proxyReq;
    },
  };
  return transport;
}

function makeSuccessTransport() {
  return makeTransport(() => {
    const proxyRes = new EventEmitter();
    proxyRes.statusCode = 200;
    proxyRes.headers = { 'content-type': 'application/json; charset=utf-8' };
    setImmediate(() => {
      proxyRes.emit('data', Buffer.from('{"ok":true}'));
      proxyRes.emit('end');
    });
    return proxyRes;
  });
}

function makeHandler(transport) {
  const { sendJson, responses } = makeSendJson();
  const handle = createProxyHandler({
    sendJson,
    getEffectiveOutboundProxySettings: () => null,
    origin: ORIGIN,
    getHttpModule: () => transport,
    getHttpsModule: () => transport,
  });
  return { handle, responses };
}

describe('handleApiProxy: 请求校验', () => {
  it('拒绝白名单之外的 HTTP 方法 (405)', async () => {
    const transport = makeSuccessTransport();
    const { handle, responses } = makeHandler(transport);
    await handle(makeReq('TRACE', '/api/proxy?target=https://93.184.216.34/'), makeRes());
    expect(responses).toHaveLength(1);
    expect(responses[0].statusCode).toBe(405);
    expect(responses[0].payload.error).toBe('method_not_allowed');
    expect(transport.requests).toHaveLength(0);
  });

  it('缺少 target 参数返回 400', async () => {
    const { handle, responses } = makeHandler(makeSuccessTransport());
    await handle(makeReq('GET', '/api/proxy'), makeRes());
    expect(responses[0].statusCode).toBe(400);
    expect(responses[0].payload.error).toBe('missing_target');
  });

  it('非法 target URL 返回 400', async () => {
    const { handle, responses } = makeHandler(makeSuccessTransport());
    await handle(makeReq('GET', '/api/proxy?target=%3A%2F%2Fnot-a-url'), makeRes());
    expect(responses[0].statusCode).toBe(400);
    expect(responses[0].payload.error).toBe('invalid_target_url');
  });

  it('回环地址目标被拒绝 (400 forbidden_target_url)', async () => {
    const { handle, responses } = makeHandler(makeSuccessTransport());
    await handle(makeReq('GET', '/api/proxy?target=' + encodeURIComponent('http://127.0.0.1:8080/x')), makeRes());
    expect(responses[0].statusCode).toBe(400);
    expect(responses[0].payload.error).toBe('forbidden_target_url');
  });

  it('本地主机名目标被拒绝 (403)', async () => {
    const { handle, responses } = makeHandler(makeSuccessTransport());
    await handle(makeReq('GET', '/api/proxy?target=' + encodeURIComponent('http://nas.local/x')), makeRes());
    expect(responses[0].statusCode).toBe(403);
    expect(responses[0].payload.error).toBe('forbidden_target_url');
    expect(responses[0].payload.message).toContain('forbidden_target_host');
  });

  it('带凭据的 target URL 被拒绝', async () => {
    const { handle, responses } = makeHandler(makeSuccessTransport());
    await handle(
      makeReq('GET', '/api/proxy?target=' + encodeURIComponent('https://user:pass@93.184.216.34/x')),
      makeRes()
    );
    expect(responses[0].statusCode).toBe(400);
    expect(responses[0].payload.error).toBe('forbidden_target_url');
  });
});

describe('handleApiProxy: 请求转发', () => {
  it('POST 转发白名单头与请求体，不转发 Cookie 等私有头', async () => {
    const transport = makeSuccessTransport();
    const { handle, responses } = makeHandler(transport);
    const body = Buffer.from('{"prompt":"hi"}');
    const res = makeRes();
    await handle(
      makeReq('POST', '/api/proxy?target=' + encodeURIComponent('https://93.184.216.34/v1/chat'), {
        'content-type': 'application/json',
        authorization: 'Bearer sk-test',
        'x-api-key': 'key-123',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching',
        'openai-beta': 'assistants-v2',
        cookie: 'session=secret',
        'x-forwarded-for': '10.0.0.1',
      }, [body]),
      res
    );
    // 等待上游响应流结束
    await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
    expect(transport.requests).toHaveLength(1);
    const options = transport.requests[0];
    expect(options.hostname).toBe('93.184.216.34');
    expect(options.path).toBe('/v1/chat');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
    expect(options.headers['x-api-key']).toBe('key-123');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers['anthropic-beta']).toBe('prompt-caching');
    expect(options.headers['openai-beta']).toBe('assistants-v2');
    expect(options.headers['Content-Length']).toBe(String(body.length));
    // 私有头不得转发
    expect(options.headers.Cookie).toBeUndefined();
    expect(options.headers['x-forwarded-for']).toBeUndefined();

    // 响应透传
    expect(res.writeHeadCalls).toHaveLength(1);
    expect(res.writeHeadCalls[0].status).toBe(200);
    expect(res.writeHeadCalls[0].headers['Cache-Control']).toBe('no-store');
    expect(res.writeHeadCalls[0].headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(res.written.join('')).toBe('{"ok":true}');
    expect(responses).toHaveLength(0);
  });

  it('GET 请求不携带请求体', async () => {
    const transport = makeSuccessTransport();
    const { handle } = makeHandler(transport);
    await handle(makeReq('GET', '/api/proxy?target=' + encodeURIComponent('https://93.184.216.34/v1/models'), {}), makeRes());
    await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
    expect(transport.requests[0].method).toBe('GET');
    expect(transport.requests[0].headers['Content-Length']).toBeUndefined();
  });
});

describe('handleApiProxy: 错误处理', () => {
  it('请求体超限返回 413', async () => {
    const transport = makeSuccessTransport();
    const { handle, responses } = makeHandler(transport);
    const bigChunk = Buffer.alloc(17 * 1024 * 1024);
    await handle(
      makeReq('POST', '/api/proxy?target=' + encodeURIComponent('https://93.184.216.34/v1/x'), {}, [bigChunk]),
      makeRes()
    );
    expect(responses[0].statusCode).toBe(413);
    expect(responses[0].payload.error).toBe('proxy_payload_too_large');
    expect(transport.requests).toHaveLength(0);
  });

  it('上游请求错误返回 502', async () => {
    const responses = [];
    const errorTransport = {
      request(options, callback) {
        const proxyReq = new EventEmitter();
        proxyReq.write = () => {};
        proxyReq.end = () => {
          setImmediate(() => proxyReq.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })));
        };
        return proxyReq;
      },
    };
    const handler = createProxyHandler({
      sendJson: (r, s, p) => {
        r.headersSent = true;
        responses.push({ statusCode: s, payload: p });
      },
      getEffectiveOutboundProxySettings: () => null,
      origin: ORIGIN,
      getHttpModule: () => errorTransport,
      getHttpsModule: () => errorTransport,
    });
    const res = makeRes();
    await handler(makeReq('GET', '/api/proxy?target=' + encodeURIComponent('https://93.184.216.34/x'), {}), res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(responses).toHaveLength(1);
    expect(responses[0].statusCode).toBe(502);
    expect(responses[0].payload.code).toBe('ECONNREFUSED');
  });
});

describe('collectRequestBody', () => {
  it('GET/HEAD 返回空 Buffer，不读取请求体', async () => {
    const req = new EventEmitter();
    req.method = 'GET';
    const result = await collectRequestBody(req);
    expect(result.length).toBe(0);
  });

  it('POST 聚合所有 chunk', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.destroy = () => {};
    const promise = collectRequestBody(req);
    req.emit('data', Buffer.from('hello '));
    req.emit('data', Buffer.from('world'));
    req.emit('end');
    const result = await promise;
    expect(result.toString()).toBe('hello world');
  });
});

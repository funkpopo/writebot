/**
 * WriteBot 本地服务 - API 代理（出站转发）模块
 * 从 local-server.js 拆出：DNS 解析校验 / 出站代理 Agent / 请求体收集 /
 * 可注入依赖的 handleApiProxy（便于离线单元测试）。
 */

'use strict';

const fs = require('fs');

const security = require('./lib/security');

// ── 懒加载 node 核心 / 代理依赖 ──────────────────────────────
let httpsModule = null;
function getHttps() {
  if (!httpsModule) httpsModule = require('https');
  return httpsModule;
}

let httpModule = null;
function getHttp() {
  if (!httpModule) httpModule = require('http');
  return httpModule;
}

let dnsModule = null;
function getDns() {
  if (!dnsModule) dnsModule = require('dns');
  return dnsModule;
}

let netModule = null;
function getNet() {
  if (!netModule) netModule = require('net');
  return netModule;
}

// 仅在实际发起 API 代理时加载，降低服务模式待机/仅静态文件服时的内存占用
let ipaddrModule = null;
function getIpaddr() {
  if (!ipaddrModule) ipaddrModule = require('ipaddr.js');
  return ipaddrModule;
}

let httpProxyAgentClasses = null;
function getHttpProxyAgentClasses() {
  if (!httpProxyAgentClasses) {
    const { HttpProxyAgent } = require('http-proxy-agent');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    httpProxyAgentClasses = { HttpProxyAgent, HttpsProxyAgent };
  }
  return httpProxyAgentClasses;
}

let socksProxyAgentModulePromise = null;

async function loadSocksProxyAgentClass() {
  if (!socksProxyAgentModulePromise) {
    socksProxyAgentModulePromise = import('socks-proxy-agent');
  }

  const mod = await socksProxyAgentModulePromise;
  return mod.SocksProxyAgent || (mod.default && mod.default.SocksProxyAgent) || mod.default || mod;
}

// ── 目标校验（DNS 解析 + 地址段检查）─────────────────────────
function getAddressBlockReason(address) {
  try {
    const ipaddr = getIpaddr();
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && typeof parsed.isIPv4MappedAddress === 'function' && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }

    const range = parsed.range();
    if (range === 'unicast') return null;
    // 198.18.0.0/15（benchmarking 保留段）被 Clash/sing-box 等 TUN 客户端用作
    // fake-ip DNS 返回值；此时放行才能让请求进入 TUN 隧道正常转发
    if (range === 'benchmarking') return null;
    return range;
  } catch {
    return 'invalid';
  }
}

async function resolveTargetAddresses(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (getNet().isIP(normalized)) {
    return [normalized];
  }

  const resolved = await getDns().promises.lookup(normalized, { all: true, verbatim: true });
  const addresses = resolved
    .map((entry) => (entry && typeof entry.address === 'string' ? entry.address : ''))
    .filter(Boolean);

  return Array.from(new Set(addresses));
}

async function assertAllowedProxyTarget(parsedTarget) {
  const hostname = String(parsedTarget.hostname || '').replace(/^\[|\]$/g, '');

  if (security.isObviouslyLocalHostname(hostname)) {
    throw new Error(`forbidden_target_host:${hostname || 'unknown'}`);
  }

  const addresses = await resolveTargetAddresses(hostname);
  if (addresses.length === 0) {
    throw new Error(`target_resolution_empty:${hostname}`);
  }

  for (const address of addresses) {
    const blockReason = getAddressBlockReason(address);
    if (blockReason) {
      throw new Error(`forbidden_target_address:${address}:${blockReason}`);
    }
  }

  return addresses;
}

async function createOutboundAgent(parsedTarget, proxySettings) {
  if (!proxySettings) {
    return undefined;
  }

  const proxyUrl = security.buildProxyUrl(proxySettings);
  if (proxySettings.protocol === 'socks5') {
    const SocksProxyAgent = await loadSocksProxyAgentClass();
    return new SocksProxyAgent(proxyUrl);
  }

  const { HttpProxyAgent, HttpsProxyAgent } = getHttpProxyAgentClasses();
  return parsedTarget.protocol === 'https:'
    ? new HttpsProxyAgent(proxyUrl)
    : new HttpProxyAgent(proxyUrl);
}

// ── 请求体收集 ──────────────────────────────────────────────
function collectRequestBody(req) {
  const methodsWithoutBody = new Set(['GET', 'HEAD']);
  if (methodsWithoutBody.has(req.method || '')) {
    return Promise.resolve(Buffer.alloc(0));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    const maxBytes = 16 * 1024 * 1024;

    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        reject(new Error('proxy_payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (tooLarge) {
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

/**
 * 创建 API 代理请求处理器（用于解决 CORS 问题，将请求转发到目标 API）。
 *
 * @param {object} options
 * @param {(res: object, statusCode: number, payload: object) => void} options.sendJson
 * @param {() => object|null} options.getEffectiveOutboundProxySettings
 * @param {string} options.origin 本服务 ORIGIN，用于解析请求 URL
 * @param {() => object} [options.getHttpModule] 可注入（测试用）
 * @param {() => object} [options.getHttpsModule] 可注入（测试用）
 */
function createProxyHandler(options) {
  const {
    sendJson,
    getEffectiveOutboundProxySettings,
    origin,
    getHttpModule = getHttp,
    getHttpsModule = getHttps,
  } = options;

  return async function handleApiProxy(req, res) {
    const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
    if (!allowedMethods.has(req.method || '')) {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    // 从查询参数获取目标 URL
    const urlObj = new URL(req.url, origin);
    const targetUrl = urlObj.searchParams.get('target');

    if (!targetUrl) {
      sendJson(res, 400, { error: 'missing_target' });
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      sendJson(res, 400, { error: 'invalid_target_url' });
      return;
    }

    if (security.isForbiddenProxyTarget(parsedTarget)) {
      sendJson(res, 400, { error: 'forbidden_target_url' });
      return;
    }

    try {
      await assertAllowedProxyTarget(parsedTarget);
    } catch (error) {
      const message = error && error.message ? error.message : 'target_validation_failed';
      const isForbiddenTarget = String(message).startsWith('forbidden_target_');
      sendJson(res, isForbiddenTarget ? 403 : 502, {
        error: isForbiddenTarget ? 'forbidden_target_url' : 'target_resolution_failed',
        message,
      });
      return;
    }

    let body;
    try {
      body = await collectRequestBody(req);
    } catch (error) {
      const message = error && error.message ? error.message : 'read_body_failed';
      const statusCode = message === 'proxy_payload_too_large' ? 413 : 500;
      console.error('读取请求体失败:', message);
      sendJson(res, statusCode, { error: message });
      return;
    }

    const forwardHeaders = {};
    if (req.headers['content-type']) {
      forwardHeaders['Content-Type'] = req.headers['content-type'];
    }
    if (req.headers.accept) {
      forwardHeaders.Accept = req.headers.accept;
    }
    if (req.headers.authorization) {
      forwardHeaders.Authorization = req.headers.authorization;
    }
    if (req.headers['x-api-key']) {
      forwardHeaders['x-api-key'] = req.headers['x-api-key'];
    }
    if (req.headers['anthropic-version']) {
      forwardHeaders['anthropic-version'] = req.headers['anthropic-version'];
    }
    if (req.headers['anthropic-beta']) {
      forwardHeaders['anthropic-beta'] = req.headers['anthropic-beta'];
    }
    if (req.headers['openai-beta']) {
      forwardHeaders['openai-beta'] = req.headers['openai-beta'];
    }
    if (body.length > 0) {
      forwardHeaders['Content-Length'] = String(body.length);
    }

    let agent;
    try {
      agent = await createOutboundAgent(parsedTarget, getEffectiveOutboundProxySettings());
    } catch (error) {
      const message = error && error.message ? error.message : 'create_proxy_agent_failed';
      console.error('创建代理连接失败:', message);
      sendJson(res, 500, {
        error: 'create_proxy_agent_failed',
        message,
      });
      return;
    }

    const requestOptions = {
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
      path: parsedTarget.pathname + parsedTarget.search,
      method: req.method,
      headers: forwardHeaders,
      agent,
    };

    const transport = parsedTarget.protocol === 'https:' ? getHttpsModule() : getHttpModule();
    let proxyReq;
    try {
      proxyReq = transport.request(requestOptions, (proxyRes) => {
        const responseHeaders = {
          'Cache-Control': 'no-store',
        };
        if (proxyRes.headers['content-type']) {
          responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
        }
        if (proxyRes.headers['transfer-encoding']) {
          responseHeaders['Transfer-Encoding'] = proxyRes.headers['transfer-encoding'];
        }
        if (proxyRes.headers['content-length']) {
          responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
        }

        res.writeHead(proxyRes.statusCode || 502, responseHeaders);

        proxyRes.on('data', (chunk) => {
          res.write(chunk);
        });

        proxyRes.on('end', () => {
          res.end();
        });
      });
    } catch (error) {
      const message = error && error.message ? error.message : 'create_upstream_request_failed';
      console.error('创建上游请求失败:', message);
      sendJson(res, 500, {
        error: 'create_upstream_request_failed',
        message,
      });
      return;
    }

    proxyReq.on('error', (error) => {
      console.error('API 代理请求失败:', error.message);
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      sendJson(res, 502, {
        error: 'API 代理请求失败',
        message: error.message,
        code: error.code,
      });
    });

    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();
  };
}

module.exports = {
  getAddressBlockReason,
  resolveTargetAddresses,
  assertAllowedProxyTarget,
  createOutboundAgent,
  collectRequestBody,
  createProxyHandler,
};

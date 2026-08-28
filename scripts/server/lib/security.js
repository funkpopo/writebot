/**
 * WriteBot 本地服务 - 安全校验纯函数
 * 从 local-server.js 拆出，便于单元测试（URL/来源/回环地址/代理目标校验、转义）。
 */

'use strict';

const net = require('net');

function isLoopbackAddress(remoteAddress) {
  if (!remoteAddress) return false;
  const normalized = String(remoteAddress).replace(/^::ffff:/i, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function matchesAllowedOrigin(value, origin) {
  if (!value) return true;
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/**
 * API 请求鉴权：客户端标识头 + 回环来源 + Origin/Referer 同源校验。
 */
function isAuthorizedApiRequest(req, options) {
  const { clientHeaderName, clientHeaderValue, origin } = options;
  const clientHeader = String(
    (req.headers && req.headers[clientHeaderName]) || ''
  ).trim().toLowerCase();
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer : '';

  return clientHeader === clientHeaderValue
    && isLoopbackAddress(req.socket && req.socket.remoteAddress)
    && matchesAllowedOrigin(originHeader, origin)
    && matchesAllowedOrigin(refererHeader, origin);
}

function isObviouslyLocalHostname(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!normalized) return true;
  if (isLoopbackHost(normalized) || normalized.endsWith('.localhost')) {
    return true;
  }
  if (
    normalized.endsWith('.local')
    || normalized.endsWith('.localdomain')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.lan')
    || normalized.endsWith('.home')
    || normalized.endsWith('.corp')
  ) {
    return true;
  }
  return net.isIP(normalized) === 0 && !normalized.includes('.');
}

function isForbiddenProxyTarget(parsedTarget) {
  if (!parsedTarget || !['http:', 'https:'].includes(parsedTarget.protocol)) {
    return true;
  }

  if (parsedTarget.username || parsedTarget.password) {
    return true;
  }

  if (isLoopbackHost(parsedTarget.hostname)) {
    return true;
  }

  return false;
}

function formatHostForUrl(hostname) {
  return hostname && hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function formatProxyEndpointForDisplay(proxySettings) {
  if (!proxySettings) {
    return null;
  }
  return `${proxySettings.host}:${proxySettings.port}`;
}

function buildProxyUrl(proxySettings) {
  const credentials = proxySettings.username || proxySettings.password
    ? `${encodeURIComponent(proxySettings.username || '')}:${encodeURIComponent(proxySettings.password || '')}@`
    : '';
  return `${proxySettings.protocol}://${credentials}${formatHostForUrl(proxySettings.host)}:${proxySettings.port}`;
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  isLoopbackAddress,
  isLoopbackHost,
  matchesAllowedOrigin,
  isAuthorizedApiRequest,
  isObviouslyLocalHostname,
  isForbiddenProxyTarget,
  formatHostForUrl,
  formatProxyEndpointForDisplay,
  buildProxyUrl,
  escapePowerShellString,
  escapeXml,
};

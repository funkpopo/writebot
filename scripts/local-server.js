/**
 * WriteBot 本地 HTTPS 服务器
 * - 支持自动注册随 Word 启动
 * - 检测到 Word 启动后再启动服务
 * - Word 关闭后自动退出
 */

const https = require('https');
const http = require('http');
const dns = require('dns');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn, spawnSync } = require('child_process');
const { URL } = require('url');

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

const PORT = 53000;
const HOST = 'localhost';
const ORIGIN = `https://${HOST}:${PORT}`;
const LOCAL_SERVICE_CLIENT_HEADER = 'x-writebot-client';
const LOCAL_SERVICE_CLIENT_VALUE = 'writebot-taskpane';
const SERVICE_ACCOUNT_NAME = 'LocalService';
const DEFAULT_SYSTEM_PROXY_PORTS = {
  http: 8080,
  socks5: 1080,
};

let socksProxyAgentModulePromise = null;

// 检测是否为打包的可执行文件（支持 pkg 和 Bun）
const isPkg = typeof process.pkg !== 'undefined' ||
  (process.execPath.endsWith('.exe') && !process.execPath.includes('node.exe') && !process.execPath.includes('bun.exe'));

// 获取基础目录
let BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;
let CERTS_DIR = path.join(BASE_DIR, 'certs');

if (!isPkg) {
  const candidate = path.join(BASE_DIR, 'taskpane.html');
  if (!fs.existsSync(candidate)) {
    BASE_DIR = path.resolve(__dirname, '..', 'dist');
  }

  const certCandidate = path.join(BASE_DIR, 'certs');
  if (fs.existsSync(certCandidate)) {
    CERTS_DIR = certCandidate;
  } else {
    CERTS_DIR = path.resolve(__dirname, '..', 'dist-local', 'certs');
  }
}

// 证书路径
const certPath = path.join(CERTS_DIR, 'funkpopo-writebot.crt');
const keyPath = path.join(CERTS_DIR, 'funkpopo-writebot.key');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const silentMode = args.has('--silent');
const serviceMode = args.has('--service');

const SERVICE_NAME = 'WriteBot';
const SERVICE_WRAPPER_EXE = 'WriteBotService.exe';
const SERVICE_CONFIG_XML = 'WriteBotService.xml';

function getArgValue(flag) {
  const index = rawArgs.indexOf(flag);
  if (index >= 0 && index < rawArgs.length - 1) {
    return rawArgs[index + 1];
  }
  return null;
}

function normalizePathForCompare(value) {
  return path.resolve(value).replace(/[\\\/]+$/, '').toLowerCase();
}

function copyFileSync(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest, options = {}) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (options.skip && options.skip.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, options);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function queryServiceState() {
  if (process.platform !== 'win32') return null;

  const result = spawnSync('sc', ['query', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  const match = result.stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  return match ? match[1].toUpperCase() : null;
}

function stopService(baseDir, exePath) {
  if (process.platform !== 'win32') return;

  if (fs.existsSync(exePath)) {
    spawnSync(exePath, ['stop'], { stdio: 'inherit', cwd: baseDir });
  } else {
    spawnSync('sc', ['stop', SERVICE_NAME], { stdio: 'inherit' });
  }
}

function startService(baseDir, exePath) {
  if (process.platform !== 'win32') return;

  if (fs.existsSync(exePath)) {
    spawnSync(exePath, ['start'], { stdio: 'inherit', cwd: baseDir });
  } else {
    spawnSync('sc', ['start', SERVICE_NAME], { stdio: 'inherit' });
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServiceState(expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = queryServiceState();
    if (!state || state === expected) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

function isProcessRunningByPath(exePath) {
  if (process.platform !== 'win32') return false;

  const escapedPath = escapePowerShellString(path.resolve(exePath));
  const script = `
$target = '${escapedPath}'
$proc = Get-Process -Name WriteBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }
if ($proc) { Write-Output $proc.Count } else { Write-Output 0 }
`;

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return false;
  }
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) && count > 0;
}

function stopProcessByPath(exePath) {
  if (process.platform !== 'win32') return;

  const escapedPath = escapePowerShellString(path.resolve(exePath));
  const script = `
$target = '${escapedPath}'
Get-Process -Name WriteBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target } | Stop-Process -Force
`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
}

async function waitForProcessExit(exePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunningByPath(exePath)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

function isLoopbackAddress(remoteAddress) {
  if (!remoteAddress) return false;
  const normalized = String(remoteAddress).replace(/^::ffff:/i, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function matchesAllowedOrigin(value) {
  if (!value) return true;
  try {
    return new URL(value).origin === ORIGIN;
  } catch {
    return false;
  }
}

function isAuthorizedApiRequest(req) {
  const clientHeader = String(req.headers[LOCAL_SERVICE_CLIENT_HEADER] || '').trim().toLowerCase();
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer : '';

  return clientHeader === LOCAL_SERVICE_CLIENT_VALUE
    && isLoopbackAddress(req.socket && req.socket.remoteAddress)
    && matchesAllowedOrigin(originHeader)
    && matchesAllowedOrigin(refererHeader);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function parseJsonRequest(req, onComplete, onError) {
  let body = '';
  let tooLarge = false;

  req.on('data', (chunk) => {
    body += chunk.toString();
    if (body.length > 1024 * 1024) {
      tooLarge = true;
      req.destroy();
    }
  });

  req.on('end', () => {
    if (tooLarge) {
      onError(new Error('payload_too_large'));
      return;
    }

    try {
      onComplete(body ? JSON.parse(body) : {});
    } catch (error) {
      onError(error);
    }
  });

  req.on('error', onError);
}

function runPowerShell(script, input) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      input,
      windowsHide: true,
    }
  );
}

function protectStringForStorage(plaintext) {
  if (!plaintext) return '';
  if (process.platform !== 'win32') {
    return Buffer.from(plaintext, 'utf8').toString('base64');
  }

  const script = `
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrEmpty($inputBase64)) { exit 1 }
$bytes = [Convert]::FromBase64String($inputBase64)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

  const result = runPowerShell(script, Buffer.from(plaintext, 'utf8').toString('base64'));
  if (result.status !== 0 || !result.stdout) {
    throw new Error(result.stderr?.trim() || 'dpapi_protect_failed');
  }
  return result.stdout.trim();
}

function unprotectStringFromStorage(ciphertext) {
  if (!ciphertext) return '';
  if (process.platform !== 'win32') {
    return Buffer.from(ciphertext, 'base64').toString('utf8');
  }

  const script = `
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrEmpty($inputBase64)) { exit 1 }
$bytes = [Convert]::FromBase64String($inputBase64)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $bytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
`;

  const result = runPowerShell(script, ciphertext);
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'dpapi_unprotect_failed');
  }
  return result.stdout || '';
}

function isValidSettingsStore(store) {
  return !!store
    && typeof store === 'object'
    && Array.isArray(store.profiles)
    && typeof store.activeProfileId === 'string';
}

function saveSecureSettingsStore(store) {
  if (!isValidSettingsStore(store)) {
    throw new Error('invalid_settings_store');
  }

  ensureDataDir();
  const payload = protectStringForStorage(JSON.stringify(store));
  const wrapped = {
    version: 1,
    backend: 'windows-dpapi-local-machine',
    updatedAt: new Date().toISOString(),
    payload,
  };

  fs.writeFileSync(SETTINGS_STORE_FILE, JSON.stringify(wrapped, null, 2), 'utf8');
  return wrapped;
}

function loadSecureSettingsStore() {
  if (!fs.existsSync(SETTINGS_STORE_FILE)) {
    return null;
  }

  const raw = fs.readFileSync(SETTINGS_STORE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.payload !== 'string') {
    throw new Error('invalid_settings_store_file');
  }

  const plaintext = unprotectStringFromStorage(parsed.payload);
  const store = JSON.parse(plaintext);
  if (!isValidSettingsStore(store)) {
    throw new Error('invalid_settings_store');
  }
  return store;
}

async function loadSocksProxyAgentClass() {
  if (!socksProxyAgentModulePromise) {
    socksProxyAgentModulePromise = import('socks-proxy-agent');
  }

  const mod = await socksProxyAgentModulePromise;
  return mod.SocksProxyAgent || (mod.default && mod.default.SocksProxyAgent) || mod.default || mod;
}

function normalizeStoredProxySettings(value) {
  if (!value || typeof value !== 'object') {
    return {
      enabled: false,
      protocol: 'http',
      host: '',
      port: DEFAULT_SYSTEM_PROXY_PORTS.http,
      username: '',
      password: '',
    };
  }

  const record = value;
  const protocol = record.protocol === 'socks5' ? 'socks5' : 'http';
  const parsedPort = Number.parseInt(String(record.port || ''), 10);
  const defaultPort = DEFAULT_SYSTEM_PROXY_PORTS[protocol];
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

function getEffectiveOutboundProxySettings() {
  try {
    const store = loadSecureSettingsStore();
    const proxy = normalizeStoredProxySettings(store && store.systemProxy);
    if (!proxy.enabled || !proxy.host) {
      return null;
    }

    if (/:\/\//.test(proxy.host) || /[/?#]/.test(proxy.host) || proxy.host.includes('@')) {
      return null;
    }

    return proxy;
  } catch {
    return null;
  }
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

function getAddressBlockReason(address) {
  try {
    const ipaddr = getIpaddr();
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && typeof parsed.isIPv4MappedAddress === 'function' && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }

    const range = parsed.range();
    return range === 'unicast' ? null : range;
  } catch {
    return 'invalid';
  }
}

async function resolveTargetAddresses(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (net.isIP(normalized)) {
    return [normalized];
  }

  const resolved = await dns.promises.lookup(normalized, { all: true, verbatim: true });
  const addresses = resolved
    .map((entry) => (entry && typeof entry.address === 'string' ? entry.address : ''))
    .filter(Boolean);

  return Array.from(new Set(addresses));
}

async function assertAllowedProxyTarget(parsedTarget) {
  const hostname = String(parsedTarget.hostname || '').replace(/^\[|\]$/g, '');

  if (isObviouslyLocalHostname(hostname)) {
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

  const proxyUrl = buildProxyUrl(proxySettings);
  if (proxySettings.protocol === 'socks5') {
    const SocksProxyAgent = await loadSocksProxyAgentClass();
    return new SocksProxyAgent(proxyUrl);
  }

  const { HttpProxyAgent, HttpsProxyAgent } = getHttpProxyAgentClasses();
  return parsedTarget.protocol === 'https:'
    ? new HttpsProxyAgent(proxyUrl)
    : new HttpProxyAgent(proxyUrl);
}

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

function getManifestPath() {
  const candidates = [
    path.join(BASE_DIR, 'manifest.xml'),
    path.resolve(__dirname, '..', 'manifest.xml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getManifestVersion() {
  const manifestPath = getManifestPath();
  if (!manifestPath) {
    return { path: null, version: null };
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const match = raw.match(/<Version>([^<]+)<\/Version>/i);
    return {
      path: manifestPath,
      version: match ? match[1].trim() : null,
    };
  } catch {
    return {
      path: manifestPath,
      version: null,
    };
  }
}

function queryInstalledServiceAccount() {
  if (process.platform !== 'win32') return null;

  const result = spawnSync('sc', ['qc', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  const match = result.stdout.match(/SERVICE_START_NAME\s*:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

function isCertificateInstalled(certFilePath) {
  if (process.platform !== 'win32' || !fs.existsSync(certFilePath)) {
    return null;
  }

  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certFilePath));
    const thumbprint = cert.fingerprint.replace(/:/g, '').trim();
    const script = `
$thumb = '${escapePowerShellString(thumbprint)}'
$found = @(
  Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb }
  Get-ChildItem Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb }
).Count -gt 0
if ($found) { Write-Output 'true' } else { Write-Output 'false' }
`;
    const result = runPowerShell(script);
    if (result.status !== 0) {
      return null;
    }
    return result.stdout.trim().toLowerCase() === 'true';
  } catch {
    return null;
  }
}

function getCertificateDiagnostics() {
  const filesPresent = fs.existsSync(certPath) && fs.existsSync(keyPath);
  const diagnostics = {
    filesPresent,
    rootInstalled: null,
    subject: null,
    validTo: null,
    certPath,
  };

  if (!filesPresent) {
    return diagnostics;
  }

  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
    diagnostics.subject = cert.subject || null;
    diagnostics.validTo = cert.validTo ? new Date(cert.validTo).toISOString() : null;
  } catch {
    // ignore parse failure
  }

  diagnostics.rootInstalled = isCertificateInstalled(certPath);
  return diagnostics;
}

function buildDiagnosticsPayload() {
  const manifest = getManifestVersion();
  const installedServiceAccount = queryInstalledServiceAccount();
  const outboundProxy = getEffectiveOutboundProxySettings();

  return {
    service: {
      status: serverState === 'running' ? 'running' : serverState,
      mode: serviceMode ? 'windows-service' : 'desktop-process',
      serviceAccount: serviceMode ? (installedServiceAccount || SERVICE_ACCOUNT_NAME) : 'CurrentUser',
      executablePath: process.execPath,
      baseDir: BASE_DIR,
    },
    port: {
      host: HOST,
      port: PORT,
      listening: serverState === 'running',
    },
    certificate: getCertificateDiagnostics(),
    manifest,
    storage: {
      backend: 'Windows DPAPI (LocalMachine)',
      filePath: SETTINGS_STORE_FILE,
      exists: fs.existsSync(SETTINGS_STORE_FILE),
    },
    outboundProxy: {
      enabled: !!outboundProxy,
      protocol: outboundProxy ? outboundProxy.protocol.toUpperCase() : null,
      endpoint: formatProxyEndpointForDisplay(outboundProxy),
      hasAuth: !!(outboundProxy && (outboundProxy.username || outboundProxy.password)),
    },
    security: {
      sameOriginOnly: true,
      clientHeaderRequired: true,
      proxyMethod: 'GET/POST/PUT/PATCH/DELETE/HEAD',
      staticTargetResolution: true,
      blocksPrivateAddresses: true,
    },
    runtime: {
      platform: process.platform,
      pid: process.pid,
      isPkg,
    },
  };
}

function handleApiDiagnostics(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  sendJson(res, 200, buildDiagnosticsPayload());
}

function handleApiSettingsStore(req, res) {
  if (req.method === 'GET') {
    try {
      const store = loadSecureSettingsStore();
      if (!store) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }

      sendJson(res, 200, store);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'load_settings_store_failed' });
    }
    return;
  }

  if (req.method === 'PUT') {
    parseJsonRequest(
      req,
      (parsed) => {
        try {
          saveSecureSettingsStore(parsed);
          sendJson(res, 200, {
            ok: true,
            backend: 'windows-dpapi-local-machine',
            path: SETTINGS_STORE_FILE,
          });
        } catch (error) {
          sendJson(res, 500, { error: error.message || 'save_settings_store_failed' });
        }
      },
      (error) => {
        const statusCode = error && error.message === 'payload_too_large' ? 413 : 400;
        sendJson(res, statusCode, { error: error.message || 'invalid_json' });
      }
    );
    return;
  }

  if (req.method === 'DELETE') {
    try {
      if (fs.existsSync(SETTINGS_STORE_FILE)) {
        fs.unlinkSync(SETTINGS_STORE_FILE);
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'delete_settings_store_failed' });
    }
    return;
  }

  sendJson(res, 405, { error: 'method_not_allowed' });
}

async function runUpdate(targetDir) {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 更新。');
    return;
  }

  if (!isPkg) {
    console.error('更新操作仅支持打包后的 WriteBot.exe，请使用分发包内的 WriteBot.exe。');
    return;
  }

  const sourceDir = path.dirname(process.execPath);
  const resolvedTarget = path.resolve(targetDir);
  if (!fs.existsSync(resolvedTarget)) {
    console.error('更新失败：目标目录不存在。');
    console.error(`目标目录: ${resolvedTarget}`);
    return;
  }

  if (normalizePathForCompare(sourceDir) === normalizePathForCompare(resolvedTarget)) {
    console.error('更新失败：源目录与目标目录相同。');
    console.error('请将新版本解压到临时目录后，从新目录运行 WriteBot.exe --update "目标目录"。');
    return;
  }

  const targetServiceExe = path.join(resolvedTarget, SERVICE_WRAPPER_EXE);
  const targetAppExe = path.join(resolvedTarget, 'WriteBot.exe');

  console.log('开始更新 WriteBot...');
  const serviceState = queryServiceState();
  const hasService = serviceState !== null;
  const wasRunning = serviceState === 'RUNNING';

  if (hasService) {
    console.log('正在停止服务...');
    stopService(resolvedTarget, targetServiceExe);
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) {
      console.error('服务停止超时，请以管理员身份重试或手动停止服务后再更新。');
      return;
    }
  } else {
    stopProcessByPath(targetAppExe);
  }

  const exited = await waitForProcessExit(targetAppExe, 15000);
  if (!exited) {
    console.error('WriteBot 仍在运行，无法替换文件。请先关闭 Word 或结束 WriteBot 进程后重试。');
    return;
  }

  try {
    copyDirSync(sourceDir, resolvedTarget, { skip: ['logs'] });
  } catch (error) {
    console.error('更新失败：文件复制出错。');
    console.error(error.message);
    return;
  }

  if (hasService && wasRunning) {
    console.log('正在启动服务...');
    startService(resolvedTarget, path.join(resolvedTarget, SERVICE_WRAPPER_EXE));
  }

  console.log('更新完成。');
}

const updateTarget = getArgValue('--update') || getArgValue('--update-to');
const waitForWord = args.has('--wait-for-word');

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ── 数据存储目录 ──
const DATA_DIR = path.join(BASE_DIR, 'data');
const PLAN_FILE = path.join(DATA_DIR, 'plan.json');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.md');
const CHECKPOINT_FILE = path.join(DATA_DIR, 'checkpoint.json');
const MEMORY_SNAPSHOT_FILE = path.join(DATA_DIR, 'memory-snapshot.json');
const SETTINGS_STORE_FILE = path.join(DATA_DIR, 'settings.secure.json');
const MAX_MEMORY_SNAPSHOT_BYTES = 96 * 1024;
const CHECKPOINT_RECORD_VERSION = 2;
const MAX_CHECKPOINT_TOOL_REPLAYS = 96;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function trimText(value, maxLen) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function compactMemorySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const source = snapshot;
  const personas = Array.isArray(source.personas)
    ? source.personas.filter((item) => typeof item === 'string').slice(0, 10).map((item) => trimText(item, 120))
    : [];
  const glossary = Array.isArray(source.glossary)
    ? source.glossary
      .filter((item) => item && typeof item === 'object')
      .slice(0, 80)
      .map((item) => ({
        term: trimText(item.term, 60),
        note: trimText(item.note, 120),
        frequency: Number.isFinite(item.frequency) ? Math.max(1, Math.floor(item.frequency)) : 1,
      }))
    : [];
  const sectionSummaries = Array.isArray(source.sectionSummaries)
    ? source.sectionSummaries
      .filter((item) => item && typeof item === 'object')
      .slice(0, 80)
      .map((item) => ({
        sectionId: trimText(item.sectionId, 48),
        sectionTitle: trimText(item.sectionTitle, 80),
        summary: trimText(item.summary, 300),
        keywords: Array.isArray(item.keywords)
          ? item.keywords.filter((keyword) => typeof keyword === 'string').slice(0, 16).map((keyword) => trimText(keyword, 40))
          : [],
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      }))
    : [];
  return { personas, glossary, sectionSummaries };
}

function ensureSnapshotByteLimit(snapshot, maxBytes) {
  const compact = compactMemorySnapshot(snapshot);
  if (!compact) return null;

  const draft = {
    updatedAt: new Date().toISOString(),
    memory: compact,
  };
  let serialized = JSON.stringify(draft, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
    return draft;
  }

  while (
    (draft.memory.sectionSummaries.length > 12 || draft.memory.glossary.length > 12)
    && Buffer.byteLength(serialized, 'utf8') > maxBytes
  ) {
    if (draft.memory.sectionSummaries.length > 12) {
      draft.memory.sectionSummaries.pop();
    }
    if (draft.memory.glossary.length > 12) {
      draft.memory.glossary.pop();
    }
    serialized = JSON.stringify(draft, null, 2);
  }

  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    draft.memory.personas = draft.memory.personas.slice(0, 3).map((item) => trimText(item, 60));
    draft.memory.sectionSummaries = draft.memory.sectionSummaries.slice(0, 8).map((item) => ({
      ...item,
      summary: trimText(item.summary, 140),
      keywords: item.keywords.slice(0, 8),
    }));
    draft.memory.glossary = draft.memory.glossary.slice(0, 8).map((item) => ({
      ...item,
      note: trimText(item.note, 60),
    }));
  }
  return draft;
}

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

function writeFileAtomicSync(filePath, content) {
  ensureDataDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore
    }
    throw error;
  }
}

function writeJsonAtomicSync(filePath, value) {
  writeFileAtomicSync(filePath, JSON.stringify(value, null, 2));
}

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function normalizeCheckpointRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  const request = typeof record.request === 'string' ? record.request : '';
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : '';
  if (!runId || !nodeId) return null;
  const loopCount = Number.isFinite(record.loopCount) ? Math.max(0, Math.floor(record.loopCount)) : 0;
  const status = ['running', 'completed', 'error', 'cancelled'].includes(record.status)
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

  const status = ['prepared', 'committed', 'failed', 'skipped'].includes(record.status)
    ? record.status
    : 'prepared';
  const verificationStatus = ['pending', 'matched', 'missing', 'conflict', 'unsupported']
    .includes(record.verificationStatus)
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

function normalizeCheckpointRecoveryState(value) {
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
      .slice(0, MAX_CHECKPOINT_TOOL_REPLAYS),
  };
}

function computeCheckpointHash(checkpoint) {
  return sha256Hex(stableStringify(checkpoint || null));
}

function normalizeCheckpointEnvelope(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const checkpoint = normalizeCheckpointRecord(record.checkpoint || value);
  if (!checkpoint) return null;
  return {
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(record.version)) : CHECKPOINT_RECORD_VERSION,
    revision: Number.isFinite(record.revision) ? Math.max(0, Math.floor(record.revision)) : 0,
    checkpoint,
    recoveryState: normalizeCheckpointRecoveryState(record.recoveryState),
    checkpointHash: typeof record.checkpointHash === 'string' && record.checkpointHash.trim()
      ? record.checkpointHash
      : computeCheckpointHash(checkpoint),
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : new Date().toISOString(),
  };
}

function readCheckpointEnvelope() {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  return normalizeCheckpointEnvelope(JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')));
}

function normalizeMemorySnapshotEnvelope(value) {
  if (!value || typeof value !== 'object') return null;
  const record = value;
  const hasMemoryField = Object.prototype.hasOwnProperty.call(record, 'memory');
  if (!hasMemoryField) return null;
  const checkpointHash = typeof record.checkpointHash === 'string' && record.checkpointHash.trim()
    ? record.checkpointHash
    : '';
  return {
    version: Number.isFinite(record.version) ? Math.max(1, Math.floor(record.version)) : CHECKPOINT_RECORD_VERSION,
    revision: Number.isFinite(record.revision) ? Math.max(0, Math.floor(record.revision)) : 0,
    checkpointHash,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : new Date().toISOString(),
    memory: record.memory,
  };
}

function readMemorySnapshotEnvelope() {
  if (!fs.existsSync(MEMORY_SNAPSHOT_FILE)) return null;
  return normalizeMemorySnapshotEnvelope(JSON.parse(fs.readFileSync(MEMORY_SNAPSHOT_FILE, 'utf8')));
}

function getMatchedMemorySnapshotEnvelope(checkpointEnvelope, memoryEnvelope) {
  if (!checkpointEnvelope || !memoryEnvelope) return null;
  if (!memoryEnvelope.checkpointHash || memoryEnvelope.checkpointHash !== checkpointEnvelope.checkpointHash) {
    return null;
  }
  return memoryEnvelope;
}

function buildCheckpointApiResponse(checkpointEnvelope, memoryEnvelope) {
  const matchedMemory = getMatchedMemorySnapshotEnvelope(checkpointEnvelope, memoryEnvelope);
  return {
    fileName: 'checkpoint.json',
    path: CHECKPOINT_FILE,
    checkpoint: checkpointEnvelope.checkpoint,
    recoveryState: checkpointEnvelope.recoveryState,
    revision: checkpointEnvelope.revision,
    checkpointHash: checkpointEnvelope.checkpointHash,
    memorySnapshotPath: matchedMemory ? MEMORY_SNAPSHOT_FILE : undefined,
    memorySnapshot: matchedMemory ? matchedMemory.memory : undefined,
    updatedAt: checkpointEnvelope.updatedAt,
  };
}

function checkpointEnvelopeSignature(checkpointEnvelope) {
  if (!checkpointEnvelope) return '';
  return sha256Hex(stableStringify({
    checkpoint: checkpointEnvelope.checkpoint,
    recoveryState: checkpointEnvelope.recoveryState || null,
  }));
}

function memorySnapshotSignature(memoryEnvelope) {
  if (!memoryEnvelope) return '';
  return sha256Hex(stableStringify({
    checkpointHash: memoryEnvelope.checkpointHash,
    memory: memoryEnvelope.memory,
  }));
}

/**
 * /api/plan 接口处理
 * GET  - 读取 plan.json
 * PUT  - 写入 plan.json
 * DELETE - 删除 plan.json
 */
function handleApiPlan(req, res) {
  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(PLAN_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const content = fs.readFileSync(PLAN_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        ensureDataDir();
        fs.writeFileSync(PLAN_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    try {
      if (fs.existsSync(PLAN_FILE)) {
        fs.unlinkSync(PLAN_FILE);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

/**
 * /api/memory 接口处理
 * GET  - 读取 memory.md
 * PUT  - 写入 memory.md
 * DELETE - 删除 memory.md
 */
function handleApiMemory(req, res) {
  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(MEMORY_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      const content = fs.readFileSync(MEMORY_FILE, 'utf8');
      const stats = fs.statSync(MEMORY_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        fileName: 'memory.md',
        path: MEMORY_FILE,
        content,
        updatedAt: stats.mtime.toISOString(),
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const content = typeof parsed.content === 'string' ? parsed.content : '';
        ensureDataDir();
        fs.writeFileSync(MEMORY_FILE, content, 'utf8');
        const stats = fs.statSync(MEMORY_FILE);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          fileName: 'memory.md',
          path: MEMORY_FILE,
          updatedAt: stats.mtime.toISOString(),
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        fs.unlinkSync(MEMORY_FILE);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

/**
 * /api/checkpoint 接口处理
 * GET  - 读取 checkpoint.json + memory-snapshot.json
 * PUT  - 写入 checkpoint.json + memory-snapshot.json（覆盖写入，防止无限增长）
 * DELETE - 删除 checkpoint.json + memory-snapshot.json
 */
function handleApiCheckpoint(req, res) {
  if (req.method === 'GET') {
    try {
      const checkpointEnvelope = readCheckpointEnvelope();
      if (!checkpointEnvelope) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildCheckpointApiResponse(
        checkpointEnvelope,
        readMemorySnapshotEnvelope(),
      )));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const checkpoint = normalizeCheckpointRecord(parsed && typeof parsed.checkpoint === 'object'
          ? parsed.checkpoint
          : null);
        if (!checkpoint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_checkpoint_payload' }));
          return;
        }

        const existingCheckpoint = readCheckpointEnvelope();
        const existingMemory = readMemorySnapshotEnvelope();
        const requestedRevision = Number.isFinite(parsed.revision)
          ? Math.max(0, Math.floor(parsed.revision))
          : undefined;
        const hasMemorySnapshotField = Object.prototype.hasOwnProperty.call(parsed, 'memorySnapshot');
        const nextRecoveryState = normalizeCheckpointRecoveryState(parsed.recoveryState)
          || (existingCheckpoint && existingCheckpoint.checkpoint.runId === checkpoint.runId
            ? existingCheckpoint.recoveryState
            : undefined);

        const desiredEnvelope = {
          version: CHECKPOINT_RECORD_VERSION,
          revision: existingCheckpoint ? existingCheckpoint.revision + 1 : 1,
          checkpoint,
          recoveryState: nextRecoveryState,
          checkpointHash: computeCheckpointHash(checkpoint),
          updatedAt: new Date().toISOString(),
        };

        let desiredMemoryEnvelope = existingMemory;
        if (hasMemorySnapshotField) {
          if (parsed.memorySnapshot && typeof parsed.memorySnapshot === 'object') {
            const compacted = ensureSnapshotByteLimit(parsed.memorySnapshot, MAX_MEMORY_SNAPSHOT_BYTES);
            desiredMemoryEnvelope = compacted
              ? {
                version: CHECKPOINT_RECORD_VERSION,
                revision: desiredEnvelope.revision,
                checkpointHash: desiredEnvelope.checkpointHash,
                updatedAt: new Date().toISOString(),
                memory: compacted.memory,
              }
              : null;
          } else if (parsed.memorySnapshot === null) {
            desiredMemoryEnvelope = null;
          } else {
            desiredMemoryEnvelope = null;
          }
        }

        const sameCheckpointPayload = existingCheckpoint
          && checkpointEnvelopeSignature(existingCheckpoint) === checkpointEnvelopeSignature({
            ...desiredEnvelope,
            revision: existingCheckpoint.revision,
            updatedAt: existingCheckpoint.updatedAt,
          });
        const sameMemoryPayload = hasMemorySnapshotField
          ? memorySnapshotSignature(getMatchedMemorySnapshotEnvelope(
            { ...desiredEnvelope, revision: existingCheckpoint ? existingCheckpoint.revision : desiredEnvelope.revision },
            desiredMemoryEnvelope,
          )) === memorySnapshotSignature(getMatchedMemorySnapshotEnvelope(existingCheckpoint, existingMemory))
          : true;

        if (existingCheckpoint && requestedRevision !== undefined && requestedRevision !== existingCheckpoint.revision) {
          if (sameCheckpointPayload && sameMemoryPayload) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(buildCheckpointApiResponse(existingCheckpoint, existingMemory)));
            return;
          }
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'revision_conflict',
            current: buildCheckpointApiResponse(existingCheckpoint, existingMemory),
          }));
          return;
        }

        if (existingCheckpoint && sameCheckpointPayload && sameMemoryPayload) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildCheckpointApiResponse(existingCheckpoint, existingMemory)));
          return;
        }

        ensureDataDir();
        writeJsonAtomicSync(CHECKPOINT_FILE, desiredEnvelope);
        if (hasMemorySnapshotField) {
          if (desiredMemoryEnvelope) {
            writeJsonAtomicSync(MEMORY_SNAPSHOT_FILE, desiredMemoryEnvelope);
          } else {
            removeFileIfExists(MEMORY_SNAPSHOT_FILE);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildCheckpointApiResponse(
          desiredEnvelope,
          hasMemorySnapshotField ? desiredMemoryEnvelope : existingMemory,
        )));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    try {
      removeFileIfExists(CHECKPOINT_FILE);
      removeFileIfExists(MEMORY_SNAPSHOT_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

function ensureCerts() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('');
    console.error('错误: 未找到 SSL 证书文件');
    console.error(`证书路径: ${path.join(BASE_DIR, 'certs')}`);
    console.error('');
    if (process.platform === 'win32' && !silentMode && !serviceMode) {
      require('child_process').spawnSync('pause', { shell: true, stdio: 'inherit' });
    }
    process.exit(1);
  }
}

function hideConsoleWindow() {
  if (process.platform !== 'win32') return;

  try {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$hWnd = [Win32]::GetConsoleWindow()
if ($hWnd -ne [IntPtr]::Zero) { [Win32]::ShowWindow($hWnd, 0) | Out-Null }
`;
    spawnSync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore' });
  } catch {
    // 忽略失败，继续运行
  }
}

function getStartupCommand() {
  if (isPkg) {
    // 直接运行 exe，确保开机启动进程为 WriteBot.exe
    return {
      commandString: `"${process.execPath}" --wait-for-word --silent`,
      file: process.execPath,
      args: ['--wait-for-word', '--silent'],
    };
  }

  const scriptPath = path.resolve(__dirname, 'local-server.js');
  return {
    commandString: `"${process.execPath}" "${scriptPath}" --wait-for-word --silent`,
    file: process.execPath,
    args: [scriptPath, '--wait-for-word', '--silent'],
  };
}

function startBackgroundWaiter(startInfo) {
  try {
    const child = spawn(startInfo.file, startInfo.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch (error) {
    console.error('后台启动失败:', error.message);
    return false;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureDirectory(pathValue) {
  if (!fs.existsSync(pathValue)) {
    fs.mkdirSync(pathValue, { recursive: true });
  }
}

function grantServiceDirectoryPermissions(targetDir) {
  if (process.platform !== 'win32') return true;

  const principal = 'NT AUTHORITY\\LOCAL SERVICE';
  const target = path.resolve(targetDir);
  const dataDir = path.join(target, 'data');
  const logsDir = path.join(target, 'logs');

  ensureDirectory(dataDir);
  ensureDirectory(logsDir);

  const commands = [
    ['icacls', [target, '/grant', `${principal}:(OI)(CI)RX`, '/T', '/C']],
    ['icacls', [dataDir, '/grant', `${principal}:(OI)(CI)M`, '/T', '/C']],
    ['icacls', [logsDir, '/grant', `${principal}:(OI)(CI)M`, '/T', '/C']],
  ];

  for (const [command, commandArgs] of commands) {
    const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      return false;
    }
  }

  return true;
}

function getServiceWrapperPaths() {
  const baseDir = isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..', 'assets', 'winsw');
  return {
    baseDir,
    exePath: path.join(baseDir, SERVICE_WRAPPER_EXE),
    xmlPath: path.join(baseDir, SERVICE_CONFIG_XML),
  };
}

function ensureServiceConfig(paths) {
  if (fs.existsSync(paths.xmlPath)) return;

  const scriptPath = path.resolve(__dirname, 'local-server.js');
  const executable = isPkg ? 'WriteBot.exe' : process.execPath;
  const argumentsText = isPkg
    ? '--wait-for-word --silent --service'
    : `"${scriptPath}" --wait-for-word --silent --service`;

  const workingDir = isPkg ? '%BASE%' : path.resolve(__dirname, '..');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<service>
  <id>${SERVICE_NAME}</id>
  <name>${SERVICE_NAME}</name>
  <description>WriteBot 写作助手本地服务</description>
  <executable>${escapeXml(executable)}</executable>
  <arguments>${escapeXml(argumentsText)}</arguments>
  <workingdirectory>${escapeXml(workingDir)}</workingdirectory>
  <logpath>%BASE%\\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <startmode>Automatic</startmode>
  <stoptimeout>10sec</stoptimeout>
  <serviceaccount>
    <username>${SERVICE_ACCOUNT_NAME}</username>
  </serviceaccount>
  <onfailure action="restart" delay="5 sec"/>
</service>
`;

  fs.writeFileSync(paths.xmlPath, xml, 'utf8');
}

function installStartup() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 注册自启动');
    return;
  }

  const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const startInfo = getStartupCommand();

  const result = spawnSync('reg', ['add', runKey, '/v', 'WriteBot', '/t', 'REG_SZ', '/d', startInfo.commandString, '/f'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log('已注册随 Word 启动（登录后自动等待 Word 运行）');
    const started = startBackgroundWaiter(startInfo);
    if (started) {
      console.log('已在当前会话后台启动等待进程');
    } else {
      console.log('未能在当前会话启动等待进程，请手动运行 WriteBot.exe --wait-for-word --silent 或重新登录');
    }
  } else {
    console.error('注册失败，请以普通用户权限重试');
  }
}

function uninstallStartup() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 取消自启动');
    return;
  }

  const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const result = spawnSync('reg', ['delete', runKey, '/v', 'WriteBot', '/f'], { stdio: 'inherit' });

  if (result.status === 0) {
    console.log('已取消随 Word 启动');
  } else {
    console.error('取消失败（可能未注册）');
  }
}

function installService() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 安装服务');
    return false;
  }
  if (!isPkg) {
    console.error('服务安装仅支持打包后的 WriteBot.exe，请使用 release/WriteBot/WriteBot.exe 执行。');
    return false;
  }

  const paths = getServiceWrapperPaths();
  if (!fs.existsSync(paths.exePath)) {
    console.error('未找到服务包装器:', paths.exePath);
    console.error('请使用打包后的 WriteBot.exe，并确保 WriteBotService.exe 位于同一目录。');
    return false;
  }

  ensureServiceConfig(paths);
  const aclReady = grantServiceDirectoryPermissions(path.dirname(process.execPath));
  if (!aclReady) {
    console.error(`未能授予 ${SERVICE_ACCOUNT_NAME} 访问安装目录的权限。`);
    return false;
  }

  const installResult = spawnSync(paths.exePath, ['install'], { stdio: 'inherit', cwd: paths.baseDir });
  if (installResult.status !== 0) {
    console.error('服务安装失败，可能需要管理员权限或服务已存在。');
    return false;
  }

  const startResult = spawnSync(paths.exePath, ['start'], { stdio: 'inherit', cwd: paths.baseDir });
  if (startResult.status === 0) {
    console.log(`服务已安装并启动（${SERVICE_ACCOUNT_NAME}，自动启动）。`);
  } else {
    console.log('服务已安装，但启动失败，请手动启动或检查权限。');
  }
  return true;
}

function uninstallService() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 卸载服务');
    return false;
  }
  if (!isPkg) {
    console.error('服务卸载仅支持打包后的 WriteBot.exe，请使用 release/WriteBot/WriteBot.exe 执行。');
    return false;
  }

  const paths = getServiceWrapperPaths();
  if (!fs.existsSync(paths.exePath)) {
    console.error('未找到服务包装器:', paths.exePath);
    console.error('请使用打包后的 WriteBot.exe，并确保 WriteBotService.exe 位于同一目录。');
    return false;
  }

  spawnSync(paths.exePath, ['stop'], { stdio: 'inherit', cwd: paths.baseDir });
  const uninstallResult = spawnSync(paths.exePath, ['uninstall'], { stdio: 'inherit', cwd: paths.baseDir });
  if (uninstallResult.status === 0) {
    console.log('服务已卸载。');
    return true;
  } else {
    console.error('服务卸载失败，可能需要管理员权限或服务不存在。');
    return false;
  }
}

const TASKLIST_EXE =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')
    : 'tasklist';

/** 使用 execFile 直接调用 tasklist，避免每轮 exec 额外拉起 cmd 进程。 */
function checkWordProcess(callback) {
  if (process.platform !== 'win32') {
    callback(false);
    return;
  }
  execFile(
    TASKLIST_EXE,
    ['/FI', 'IMAGENAME eq WINWORD.EXE', '/NH'],
    { windowsHide: true, maxBuffer: 64 * 1024 },
    (error, stdout) => {
      const isRunning = !!stdout && String(stdout).toLowerCase().includes('winword.exe');
      callback(isRunning);
    }
  );
}

/** Word 已运行时保持较快轮询，便于 Word 关闭后及时 stopServer。 */
const WORD_CHECK_ACTIVE_MS = 3000;
/** 无 Word、HTTPS 已停时拉长间隔，减少子进程/定时器唤醒与 V8 压力（可与响应折中，单位 ms）。 */
const WORD_CHECK_IDLE_MS = 8000;

let wordWasRunning = false;
let checkInterval = null;
let serviceWordPollTimer = null;
let serviceMonitorStarted = false;
let server = null;
let serverState = 'stopped';
let wantServerRunning = false;

function startWordMonitor() {
  if (checkInterval) return;

  checkInterval = setInterval(() => {
    checkWordProcess((isRunning) => {
      if (isRunning) {
        wordWasRunning = true;
      } else if (wordWasRunning && !isRunning) {
        console.log('');
        console.log('检测到 Word 已关闭，服务即将退出...');
        setTimeout(() => process.exit(0), 1000);
      }
    });
  }, 3000);

  checkWordProcess((isRunning) => {
    if (isRunning) wordWasRunning = true;
  });
}

function startServiceMonitor() {
  if (serviceMonitorStarted) return;
  serviceMonitorStarted = true;

  const scheduleNext = (delayMs) => {
    if (serviceWordPollTimer) {
      clearTimeout(serviceWordPollTimer);
    }
    serviceWordPollTimer = setTimeout(tick, delayMs);
  };

  const tick = () => {
    checkWordProcess((isRunning) => {
      wantServerRunning = isRunning;
      if (isRunning) {
        if (serverState === 'stopped') startServer();
      } else if (serverState === 'running') {
        stopServer();
      }
      const nextDelay = isRunning ? WORD_CHECK_ACTIVE_MS : WORD_CHECK_IDLE_MS;
      scheduleNext(nextDelay);
    });
  };

  tick();
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

/**
 * API 代理处理函数
 * 用于解决 CORS 问题，将请求转发到目标 API
 */
async function handleApiProxy(req, res) {
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
  if (!allowedMethods.has(req.method || '')) {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  // 从查询参数获取目标 URL
  const urlObj = new URL(req.url, ORIGIN);
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

  if (isForbiddenProxyTarget(parsedTarget)) {
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

  const transport = parsedTarget.protocol === 'https:' ? https : http;
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
}

function startServer() {
  if (serverState !== 'stopped') return;

  ensureCerts();
  serverState = 'starting';

  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  server = https.createServer(options, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const requestUrl = new URL(req.url, ORIGIN);
    const pathname = requestUrl.pathname;

    if (pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!isAuthorizedApiRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      if (req.method === 'OPTIONS') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
    }

    // API 代理功能
    if (pathname === '/api/proxy') {
      void handleApiProxy(req, res).catch((error) => {
        console.error('API 代理处理失败:', error);
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: 'proxy_handler_failed',
            message: error && error.message ? error.message : String(error),
          });
        } else {
          res.destroy();
        }
      });
      return;
    }

    // Plan 文件存储 API
    if (pathname === '/api/plan') {
      handleApiPlan(req, res);
      return;
    }

    // Memory 文件存储 API
    if (pathname === '/api/memory') {
      handleApiMemory(req, res);
      return;
    }

    // Checkpoint 文件存储 API
    if (pathname === '/api/checkpoint') {
      handleApiCheckpoint(req, res);
      return;
    }

    if (pathname === '/api/settings-store') {
      handleApiSettingsStore(req, res);
      return;
    }

    if (pathname === '/api/diagnostics') {
      handleApiDiagnostics(req, res);
      return;
    }

    // 解析请求路径
    let urlPath = pathname;
    if (urlPath === '/') urlPath = '/taskpane.html';

    // 安全检查
    const normalizedPath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(BASE_DIR, normalizedPath);

    if (!filePath.startsWith(BASE_DIR)) {
      res.writeHead(403);
      res.end('403 Forbidden');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('404 Not Found');
        } else {
          res.writeHead(500);
          res.end('500 Internal Server Error');
        }
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
      });
      res.end(content);
    });
  });

  server.on('error', (err) => {
    serverState = 'stopped';
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`错误: 端口 ${PORT} 已被占用`);
      console.error('');
    } else {
      console.error('服务器错误:', err.message);
    }
    if (process.platform === 'win32' && !silentMode && !serviceMode) {
      require('child_process').spawnSync('pause', { shell: true, stdio: 'inherit' });
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    serverState = 'running';
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║     WriteBot 写作助手 - 服务已启动        ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');
    console.log(`  服务地址: https://${HOST}:${PORT}`);
    console.log('');
    console.log(`  提示: Word 关闭后服务会${serviceMode ? '停止并等待下一次启动' : '自动退出'}`);
    console.log('');
  });
}

function stopServer() {
  if (!server || serverState !== 'running') return;
  serverState = 'stopping';
  server.close(() => {
    serverState = 'stopped';
    server = null;
    if (serviceMode) {
      console.log('');
      console.log('服务已停止，等待 Word 再次启动...');
      console.log('');
    }
    if (wantServerRunning) {
      startServer();
    }
  });
}

function handleShutdown() {
  if (serviceWordPollTimer) {
    clearTimeout(serviceWordPollTimer);
    serviceWordPollTimer = null;
  }
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
}

/**
 * 清理过期日志文件
 * 删除 logs 目录中超过指定天数的日志文件
 */
function cleanupOldLogs(maxAgeDays = 7) {
  const logsDir = path.join(isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..'), 'logs');
  if (!fs.existsSync(logsDir)) return;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const files = fs.readdirSync(logsDir);
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 忽略单个文件的删除失败
      }
    }
  } catch {
    // 忽略清理失败，不影响主流程
  }
}

async function main() {
  cleanupOldLogs();

  if (updateTarget) {
    await runUpdate(updateTarget);
    return;
  }

  if (args.has('--install-startup')) {
    installStartup();
    return;
  }

  if (args.has('--uninstall-startup')) {
    uninstallStartup();
    return;
  }

  if (args.has('--install-service')) {
    const ok = installService();
    process.exit(ok ? 0 : 1);
  }

  if (args.has('--uninstall-service')) {
    const ok = uninstallService();
    process.exit(ok ? 0 : 1);
  }

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  if (serviceMode) {
    console.log('服务模式已启动，等待 Word 启动...');
    startServiceMonitor();
  } else if (waitForWord) {
    ensureCerts();
    if (silentMode) hideConsoleWindow();
    console.log('等待 Word 启动...');
    const waitInterval = setInterval(() => {
      checkWordProcess((isRunning) => {
        if (isRunning) {
          clearInterval(waitInterval);
          startServer();
          startWordMonitor();
        }
      });
    }, 2000);

    // 立即检查一次
    checkWordProcess((isRunning) => {
      if (isRunning) {
        clearInterval(waitInterval);
        startServer();
        startWordMonitor();
      }
    });
  } else {
    startServer();
    startWordMonitor();
  }
}

main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});

/**
 * WriteBot 本地 HTTPS 服务器
 * - 支持自动注册随 Word 启动
 * - 检测到 Word 启动后再启动服务
 * - Word 关闭后自动退出
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn, spawnSync } = require('child_process');
const { URL } = require('url');

const PORT = 53000;
const HOST = 'localhost';

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
    <username>LocalSystem</username>
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

  const installResult = spawnSync(paths.exePath, ['install'], { stdio: 'inherit', cwd: paths.baseDir });
  if (installResult.status !== 0) {
    console.error('服务安装失败，可能需要管理员权限或服务已存在。');
    return false;
  }

  const startResult = spawnSync(paths.exePath, ['start'], { stdio: 'inherit', cwd: paths.baseDir });
  if (startResult.status === 0) {
    console.log('服务已安装并启动（LocalSystem，自动启动）。');
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

function checkWordProcess(callback) {
  exec('tasklist /FI "IMAGENAME eq WINWORD.EXE" /NH', (error, stdout) => {
    const isRunning = !!stdout && stdout.toLowerCase().includes('winword.exe');
    callback(isRunning);
  });
}

let wordWasRunning = false;
let checkInterval = null;
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
  if (checkInterval) return;

  const tick = () => {
    checkWordProcess((isRunning) => {
      wantServerRunning = isRunning;
      if (isRunning) {
        if (serverState === 'stopped') startServer();
      } else if (serverState === 'running') {
        stopServer();
      }
    });
  };

  checkInterval = setInterval(tick, 3000);
  tick();
}

/**
 * API 代理处理函数
 * 用于解决 CORS 问题，将请求转发到目标 API
 */
function handleApiProxy(req, res) {
  // 从查询参数获取目标 URL
  const urlObj = new URL(req.url, `https://${HOST}:${PORT}`);
  const targetUrl = urlObj.searchParams.get('target');

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 target 参数' }));
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '无效的目标 URL' }));
    return;
  }

  // 收集请求体
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    // 构建转发请求的 headers
    const forwardHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };

    // 转发认证相关的 headers
    if (req.headers['authorization']) {
      forwardHeaders['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['x-api-key']) {
      forwardHeaders['x-api-key'] = req.headers['x-api-key'];
    }
    if (req.headers['anthropic-version']) {
      forwardHeaders['anthropic-version'] = req.headers['anthropic-version'];
    }

    const requestOptions = {
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
      path: parsedTarget.pathname + parsedTarget.search,
      method: req.method,
      headers: forwardHeaders,
    };

    const protocol = parsedTarget.protocol === 'https:' ? https : http;
    const proxyReq = protocol.request(requestOptions, (proxyRes) => {
      // 设置响应头
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Transfer-Encoding': proxyRes.headers['transfer-encoding'] || 'identity',
      });

      // 流式转发响应
      proxyRes.on('data', chunk => {
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();
      });
    });

    proxyReq.on('error', (error) => {
      console.error('API 代理请求失败:', error.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'API 代理请求失败',
        message: error.message,
        code: error.code,
      }));
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });

  req.on('error', (error) => {
    console.error('读取请求体失败:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '读取请求体失败' }));
  });
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
    // 处理 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // API 代理功能
    if (req.url.startsWith('/api/proxy')) {
      handleApiProxy(req, res);
      return;
    }

    // Plan 文件存储 API
    if (req.url === '/api/plan' || req.url.startsWith('/api/plan?')) {
      handleApiPlan(req, res);
      return;
    }

    // 解析请求路径
    let urlPath = req.url.split('?')[0];
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

      res.writeHead(200, { 'Content-Type': contentType });
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

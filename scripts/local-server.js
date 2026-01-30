/**
 * WriteBot 本地 HTTPS 服务器
 * - 支持自动注册随 Word 启动
 * - 检测到 Word 启动后再启动服务
 * - Word 关闭后自动退出
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawnSync } = require('child_process');

const PORT = 3000;
const HOST = 'localhost';

// 检测是否为 pkg 打包的可执行文件
const isPkg = typeof process.pkg !== 'undefined';

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
const certPath = path.join(CERTS_DIR, 'localhost.crt');
const keyPath = path.join(CERTS_DIR, 'localhost.key');

const args = new Set(process.argv.slice(2));

if (args.has('--install-startup')) {
  installStartup();
  process.exit(0);
}

if (args.has('--uninstall-startup')) {
  uninstallStartup();
  process.exit(0);
}

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

function ensureCerts() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('');
    console.error('错误: 未找到 SSL 证书文件');
    console.error(`证书路径: ${path.join(BASE_DIR, 'certs')}`);
    console.error('');
    if (process.platform === 'win32') {
      require('child_process').spawnSync('pause', { shell: true, stdio: 'inherit' });
    }
    process.exit(1);
  }
}

function installStartup() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows 注册自启动');
    return;
  }

  const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  let command = '';

  if (isPkg) {
    command = `"${process.execPath}" --wait-for-word`;
  } else {
    const scriptPath = path.resolve(__dirname, 'local-server.js');
    command = `"${process.execPath}" "${scriptPath}" --wait-for-word`;
  }

  const result = spawnSync('reg', ['add', runKey, '/v', 'WriteBot', '/t', 'REG_SZ', '/d', command, '/f'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log('已注册随 Word 启动（登录后后台等待 Word 运行）');
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

function checkWordProcess(callback) {
  exec('tasklist /FI "IMAGENAME eq WINWORD.EXE" /NH', (error, stdout) => {
    const isRunning = !!stdout && stdout.toLowerCase().includes('winword.exe');
    callback(isRunning);
  });
}

let wordWasRunning = false;
let checkInterval = null;
let serverStarted = false;
let server = null;

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

function startServer() {
  if (serverStarted) return;

  ensureCerts();

  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  server = https.createServer(options, (req, res) => {
    // 处理 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
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
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`错误: 端口 ${PORT} 已被占用`);
      console.error('');
    } else {
      console.error('服务器错误:', err.message);
    }
    if (process.platform === 'win32') {
      require('child_process').spawnSync('pause', { shell: true, stdio: 'inherit' });
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    serverStarted = true;
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║     WriteBot 写作助手 - 服务已启动        ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');
    console.log(`  服务地址: https://${HOST}:${PORT}`);
    console.log('');
    console.log('  提示: Word 关闭后服务会自动退出');
    console.log('');
  });
}

if (waitForWord) {
  ensureCerts();
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

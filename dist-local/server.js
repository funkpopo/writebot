/**
 * WriteBot 本地 HTTPS 服务器
 * 支持独立运行，自动监控 Word 进程
 * Word 关闭时服务自动退出
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3000;
const HOST = 'localhost';

// 检测是否为 pkg 打包的可执行文件
const isPkg = typeof process.pkg !== 'undefined';

// 获取基础目录
const BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;

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

// 证书路径
const certPath = path.join(BASE_DIR, 'certs', 'localhost.crt');
const keyPath = path.join(BASE_DIR, 'certs', 'localhost.key');

// 检查证书文件
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

const options = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

// 检查 Word 进程是否运行
let wordWasRunning = false;
let checkInterval = null;

function checkWordProcess() {
  exec('tasklist /FI "IMAGENAME eq WINWORD.EXE" /NH', (error, stdout) => {
    const isRunning = stdout.toLowerCase().includes('winword.exe');

    if (isRunning) {
      wordWasRunning = true;
    } else if (wordWasRunning && !isRunning) {
      // Word 曾经运行过，现在关闭了
      console.log('');
      console.log('检测到 Word 已关闭，服务即将退出...');
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }
  });
}

const server = https.createServer(options, (req, res) => {
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
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     WriteBot 写作助手 - 服务已启动        ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  服务地址: https://${HOST}:${PORT}`);
  console.log('');
  console.log('  提示: Word 关闭后服务会自动退出');
  console.log('');

  // 开始监控 Word 进程
  checkInterval = setInterval(checkWordProcess, 3000);
  checkWordProcess(); // 立即检查一次
});

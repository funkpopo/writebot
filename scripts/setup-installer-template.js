/**
 * WriteBot 单文件安装/更新器模板（由 build-setup-bun.js 生成并用 Bun 编译）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVICE_NAME = 'WriteBot';
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), 'WriteBot');

const PAYLOAD_MAGIC = Buffer.from('WBPKGv1');
const PAYLOAD_TRAILER_SIZE = PAYLOAD_MAGIC.length + 8;

function getCleanArgs() {
  const args = process.argv.slice(1);
  if (args.length > 0 && args[0].toLowerCase().endsWith('.js')) {
    args.shift();
  }
  return args;
}

function getArgValue(flag, args) {
  const index = args.indexOf(flag);
  if (index >= 0 && index < args.length - 1) {
    return args[index + 1];
  }
  return null;
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function readExact(fd, buffer, offset, length, position) {
  let total = 0;
  while (total < length) {
    const bytesRead = fs.readSync(fd, buffer, offset + total, length - total, position + total);
    if (!bytesRead) {
      throw new Error('读取安装器数据失败。');
    }
    total += bytesRead;
  }
}

function readPayloadFromSelf() {
  const exePath = process.execPath;
  const fd = fs.openSync(exePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size <= PAYLOAD_TRAILER_SIZE) {
      throw new Error('安装器损坏：未找到 payload。');
    }

    const trailer = Buffer.alloc(PAYLOAD_TRAILER_SIZE);
    readExact(fd, trailer, 0, PAYLOAD_TRAILER_SIZE, stat.size - PAYLOAD_TRAILER_SIZE);

    const magic = trailer.subarray(0, PAYLOAD_MAGIC.length);
    if (!magic.equals(PAYLOAD_MAGIC)) {
      throw new Error('安装器损坏：payload 标记不匹配。');
    }

    const payloadLength = Number(trailer.readBigUInt64BE(PAYLOAD_MAGIC.length));
    if (!Number.isFinite(payloadLength) || payloadLength <= 0) {
      throw new Error('安装器损坏：payload 长度异常。');
    }

    const payloadStart = stat.size - PAYLOAD_TRAILER_SIZE - payloadLength;
    if (payloadStart < 0) {
      throw new Error('安装器损坏：payload 越界。');
    }

    const payload = Buffer.alloc(payloadLength);
    readExact(fd, payload, 0, payloadLength, payloadStart);
    return payload;
  } finally {
    fs.closeSync(fd);
  }
}

function printUsage() {
  console.log('');
  console.log('WriteBot 单文件安装/更新器');
  console.log('');
  console.log('用法:');
  console.log('  WriteBotSetup.exe --target "C:\\Users\\User\\WriteBot"');
  console.log('');
  console.log('参数:');
  console.log('  --target <路径>  自定义安装目录（默认: 当前用户目录下的 WriteBot）');
  console.log('  --help           显示帮助');
  console.log('');
}

function isAdmin() {
  const result = spawnSync('net', ['session'], { stdio: 'ignore' });
  return result.status === 0;
}

function relaunchAsAdmin(args) {
  const exePath = process.execPath;
  const forwarded = args.filter((arg) => arg !== '--elevated');
  forwarded.push('--elevated');

  const argList = forwarded.map((arg) => `'${escapePowerShell(arg)}'`).join(', ');
  const argPart = forwarded.length > 0 ? `-ArgumentList ${argList}` : '';
  const script = `Start-Process -FilePath '${escapePowerShell(exePath)}' ${argPart} -Verb RunAs`;

  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
}

function getServiceState() {
  const result = spawnSync('sc', ['query', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const match = result.stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  return match ? match[1].toUpperCase() : null;
}

function getServiceBinaryPath() {
  const result = spawnSync('sc', ['qc', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const match = result.stdout.match(/BINARY_PATH_NAME\s*:\s*(.+)$/im);
  if (!match) return null;

  let raw = match[1].trim();
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end > 1) {
      raw = raw.slice(1, end);
    }
  } else {
    raw = raw.split(' ')[0];
  }
  return raw;
}

function normalizePath(value) {
  return path.resolve(value).replace(/[\\\/]+$/, '').toLowerCase();
}

function stopService() {
  spawnSync('sc', ['stop', SERVICE_NAME], { stdio: 'inherit' });
}

function deleteService() {
  spawnSync('sc', ['delete', SERVICE_NAME], { stdio: 'inherit' });
}

function startService() {
  spawnSync('sc', ['start', SERVICE_NAME], { stdio: 'inherit' });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServiceState(expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getServiceState();
    if (!state || state === expected) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

function isProcessRunningByPath(exePath) {
  const script = `
$target = '${escapePowerShell(path.resolve(exePath))}'
$proc = Get-Process -Name WriteBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }
if ($proc) { Write-Output $proc.Count } else { Write-Output 0 }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return false;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) && count > 0;
}

function stopProcessByPath(exePath) {
  const script = `
$target = '${escapePowerShell(path.resolve(exePath))}'
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

function extractPayload(targetDir) {
  const tempZip = path.join(os.tmpdir(), `WriteBot-${Date.now()}.zip`);
  const payload = readPayloadFromSelf();
  fs.writeFileSync(tempZip, payload);

  const psCommand = `Expand-Archive -Path '${escapePowerShell(tempZip)}' -DestinationPath '${escapePowerShell(
    targetDir
  )}' -Force`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
  fs.unlinkSync(tempZip);

  if (result.status !== 0) {
    throw new Error('解压失败，请重试或检查权限。');
  }
}

function installCert(targetDir) {
  const certPath = path.join(targetDir, 'certs', 'funkpopo-writebot.crt');
  if (!fs.existsSync(certPath)) {
    console.error('未找到证书文件:', certPath);
    return false;
  }

  const result = spawnSync('certutil', ['-addstore', '-f', 'Root', certPath], { stdio: 'inherit' });
  return result.status === 0;
}

function installService(targetDir) {
  const exePath = path.join(targetDir, 'WriteBot.exe');
  if (!fs.existsSync(exePath)) {
    console.error('未找到 WriteBot.exe:', exePath);
    return false;
  }
  const result = spawnSync(exePath, ['--install-service'], { stdio: 'inherit', cwd: targetDir });
  return result.status === 0;
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows。');
    process.exit(1);
  }

  const args = getCleanArgs();
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const targetArg = getArgValue('--target', args) || getArgValue('--path', args);
  const serviceBinary = getServiceBinaryPath();
  const serviceDir = serviceBinary ? path.dirname(serviceBinary) : null;
  const targetDir = path.resolve(targetArg || serviceDir || DEFAULT_INSTALL_DIR);

  if (!isAdmin() && !args.includes('--elevated')) {
    console.log('需要管理员权限，正在请求提升...');
    relaunchAsAdmin(args);
    return;
  }

  console.log('');
  console.log('WriteBot 安装/更新开始...');
  console.log(`目标目录: ${targetDir}`);

  let serviceState = getServiceState();
  let serviceExists = serviceState !== null;

  if (serviceExists && serviceDir && normalizePath(serviceDir) !== normalizePath(targetDir)) {
    console.log('检测到服务路径不同，准备重新安装服务...');
    stopService();
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) {
      throw new Error('服务停止超时，请手动停止服务后重试。');
    }
    deleteService();
    await sleep(1000);
    serviceExists = false;
  } else if (serviceExists) {
    console.log('正在停止服务...');
    stopService();
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) {
      throw new Error('服务停止超时，请手动停止服务后重试。');
    }
  }

  const targetExe = path.join(targetDir, 'WriteBot.exe');
  stopProcessByPath(targetExe);
  const exited = await waitForProcessExit(targetExe, 15000);
  if (!exited) {
    throw new Error('WriteBot 仍在运行，无法替换文件。请关闭 Word 后重试。');
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log('正在写入文件...');
  extractPayload(targetDir);

  console.log('正在安装证书...');
  const certOk = installCert(targetDir);
  if (!certOk) {
    console.error('证书安装失败，请检查权限或手动安装。');
  }

  console.log('正在安装/启动服务...');
  let serviceOk = true;
  serviceState = getServiceState();
  serviceExists = serviceState !== null;
  if (serviceExists) {
    startService();
  } else {
    const installed = installService(targetDir);
    if (!installed) {
      console.error('服务安装失败，请检查权限或稍后重试。');
      serviceOk = false;
    }
  }

  console.log('');
  if (!serviceOk) {
    console.error('WriteBot 安装完成，但服务安装失败。');
    process.exit(1);
  }
  console.log('WriteBot 安装/更新完成。');
}

main().catch((error) => {
  console.error('安装失败:', error.message || error);
  process.exit(1);
});

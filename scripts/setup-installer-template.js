/**
 * WriteBot 单文件安装/更新器模板（由 build-setup-bun.js 生成并用 Bun 编译）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const SERVICE_NAME = 'WriteBot';
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), 'WriteBot');
const APP_VERSION = '__WRITEBOT_VERSION__';
const SETUP_FILENAME = '__WRITEBOT_SETUP_NAME__';

const PAYLOAD_MAGIC = Buffer.from('WBPKGv1');
const PAYLOAD_TRAILER_SIZE = PAYLOAD_MAGIC.length + 8;

// ─── 用户输入 ───

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function promptUser(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

// ─── 参数解析 ───

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

// ─── Payload 读取 ───

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

// ─── 权限与提权 ───

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

// ─── 服务管理 ───

function getServiceState() {
  const result = spawnSync('sc', ['query', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  const match = result.stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  return match ? match[1].toUpperCase() : null;
}

function getServiceBinaryPath() {
  const result = spawnSync('sc', ['qc', SERVICE_NAME], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  const match = result.stdout.match(/BINARY_PATH_NAME\s*:\s*(.+)$/im);
  if (!match) return null;
  let raw = match[1].trim();
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end > 1) raw = raw.slice(1, end);
  } else {
    raw = raw.split(' ')[0];
  }
  return raw;
}

function normalizePath(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
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
    if (!state || state === expected) return true;
    await sleep(500);
  }
  return false;
}

// ─── 进程管理 ───

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
    if (!isProcessRunningByPath(exePath)) return true;
    await sleep(500);
  }
  return false;
}

// ─── 安装操作 ───

function extractPayload(targetDir) {
  const tempZip = path.join(os.tmpdir(), `WriteBot-${Date.now()}.zip`);
  const payload = readPayloadFromSelf();
  fs.writeFileSync(tempZip, payload);
  const psCommand = `Expand-Archive -Path '${escapePowerShell(tempZip)}' -DestinationPath '${escapePowerShell(targetDir)}' -Force`;
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

function removeCert() {
  spawnSync('certutil', ['-delstore', 'Root', 'funkpopo-writebot'], { stdio: 'inherit' });
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

// ─── 卸载操作 ───

async function doUninstall(rl) {
  console.log('');
  console.log('正在查找已安装的 WriteBot...');
  const serviceBinary = getServiceBinaryPath();
  const serviceDir = serviceBinary ? path.dirname(serviceBinary) : null;
  const serviceState = getServiceState();
  const serviceExists = serviceState !== null;

  if (!serviceExists && !serviceDir) {
    console.log('');
    console.log('未检测到已安装的 WriteBot 服务。');
    const answer = await promptUser(rl, '是否手动指定安装目录进行清理？(y/N): ');
    if (answer.toLowerCase() !== 'y') return;
    const customDir = await promptUser(rl, '请输入安装目录路径: ');
    if (!customDir || !fs.existsSync(customDir)) {
      console.log('目录不存在，取消卸载。');
      return;
    }
    await performUninstall(customDir, false);
    return;
  }

  const installDir = serviceDir || DEFAULT_INSTALL_DIR;
  console.log('检测到安装目录: ' + installDir);
  console.log('');
  const confirm = await promptUser(rl, '确认要卸载 WriteBot 吗？(y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('已取消卸载。');
    return;
  }
  await performUninstall(installDir, serviceExists);
}

async function performUninstall(installDir, serviceExists) {
  if (serviceExists) {
    console.log('正在停止服务...');
    stopService();
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) {
      console.error('服务停止超时，请手动停止后重试。');
      return;
    }
    console.log('正在删除服务...');
    deleteService();
    await sleep(1000);
  }
  const targetExe = path.join(installDir, 'WriteBot.exe');
  if (fs.existsSync(targetExe)) {
    stopProcessByPath(targetExe);
    await waitForProcessExit(targetExe, 10000);
  }
  console.log('正在移除证书...');
  removeCert();
  if (fs.existsSync(installDir)) {
    console.log('正在删除安装目录...');
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
      console.log('安装目录已删除。');
    } catch (e) {
      console.error('删除目录失败: ' + e.message);
      console.log('请手动删除目录: ' + installDir);
    }
  }
  console.log('');
  console.log('========================================');
  console.log('  WriteBot 卸载完成！');
  console.log('========================================');
  console.log('');
  console.log('如果之前在 Word 信任中心配置过加载项目录，');
  console.log('可以在 Word 中手动移除：');
  console.log('  文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的加载项目录');
  console.log('');
}

// ─── 安装流程 ───

async function doInstall(targetDir) {
  console.log('');
  console.log('安装目录: ' + targetDir);
  console.log('');
  let serviceState = getServiceState();
  let serviceExists = serviceState !== null;
  const serviceBinary = getServiceBinaryPath();
  const serviceDir = serviceBinary ? path.dirname(serviceBinary) : null;

  if (serviceExists && serviceDir && normalizePath(serviceDir) !== normalizePath(targetDir)) {
    console.log('检测到服务路径不同，准备重新安装服务...');
    stopService();
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) throw new Error('服务停止超时，请手动停止服务后重试。');
    deleteService();
    await sleep(1000);
    serviceExists = false;
  } else if (serviceExists) {
    console.log('正在停止服务...');
    stopService();
    const stopped = await waitForServiceState('STOPPED', 20000);
    if (!stopped) throw new Error('服务停止超时，请手动停止服务后重试。');
  }

  const targetExe = path.join(targetDir, 'WriteBot.exe');
  stopProcessByPath(targetExe);
  const exited = await waitForProcessExit(targetExe, 15000);
  if (!exited) throw new Error('WriteBot 仍在运行，无法替换文件。请关闭 Word 后重试。');

  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  console.log('正在写入文件...');
  extractPayload(targetDir);
  console.log('正在安装证书...');
  const certOk = installCert(targetDir);
  if (!certOk) console.error('证书安装失败，请检查权限或手动安装。');

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
  return { serviceOk, targetDir };
}

// ─── 安装后引导 ───

function showPostInstallGuide(targetDir, serviceOk) {
  console.log('');
  console.log('========================================');
  if (serviceOk) {
    console.log('  WriteBot 安装/更新完成！');
  } else {
    console.log('  WriteBot 安装完成（服务安装失败）');
  }
  console.log('========================================');
  console.log('');
  console.log('安装路径: ' + targetDir);
  console.log('');
  console.log('----------------------------------------');
  console.log('  接下来请按以下步骤配置 Word（仅首次需要）');
  console.log('----------------------------------------');
  console.log('');
  console.log('【第一步】设置安装目录的共享权限');
  console.log('');
  console.log('  1. 打开文件资源管理器，找到安装目录：');
  console.log('     ' + targetDir);
  console.log('  2. 右键点击「WriteBot」文件夹 ->「属性」->「共享」选项卡');
  console.log('  3. 点击「共享」按钮，配置共享权限');
  console.log('  4. 共享完成后，复制显示的共享路径');
  console.log('');
  console.log('【第二步】配置 Word 信任中心');
  console.log('');
  console.log('  1. 打开 Word');
  console.log('  2. 点击左上角「文件」->「选项」->「信任中心」->「信任中心设置」');
  console.log('  3. 在左侧选择「受信任的加载项目录」');
  console.log('  4. 在「目录 URL」中粘贴刚才复制的共享路径');
  console.log('  5. 点击「添加目录」按钮');
  console.log('  6. 勾选新添加目录的「在菜单中显示」复选框');
  console.log('  7. 点击「确定」保存设置');
  console.log('');
  console.log('【第三步】导入加载项');
  console.log('');
  console.log('  1. 重新打开 Word（如果已打开请先关闭再打开）');
  console.log('  2. 点击顶部菜单栏「插入」->「获取加载项」(或「我的加载项」)');
  console.log('  3. 在弹出窗口中选择「共享文件夹」选项卡');
  console.log('  4. 找到「WriteBot 写作助手」，点击「添加」');
  console.log('');
  console.log('【第四步】开始使用');
  console.log('');
  console.log('  1. 点击顶部菜单栏「开始」选项卡');
  console.log('  2. 在右侧找到「WriteBot」按钮，点击即可打开侧边栏');
  console.log('  3. 首次使用需要在「设置」中填入你的 AI 服务 API 密钥');
  console.log('');
  console.log('----------------------------------------');
  console.log('');
}

// ─── 主流程 ───

function printBanner() {
  console.log('');
  console.log('========================================');
  console.log('       WriteBot 安装程序');
  console.log(`         版本: v${APP_VERSION}`);
  console.log('========================================');
  console.log('');
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('仅支持 Windows。');
    process.exit(1);
  }

  const args = getCleanArgs();
  if (args.includes('--help') || args.includes('-h')) {
    console.log('');
    console.log(`WriteBot 安装/卸载程序 v${APP_VERSION}`);
    console.log('');
    console.log('用法:');
    console.log(`  ${SETUP_FILENAME}                              交互式安装/卸载`);
    console.log(`  ${SETUP_FILENAME} --target "D:\\WriteBot"  指定安装目录`);
    console.log('');
    return;
  }

  const targetArg = getArgValue('--target', args) || getArgValue('--path', args);

  // 提权检查
  if (!isAdmin() && !args.includes('--elevated')) {
    console.log('需要管理员权限，正在请求提升...');
    relaunchAsAdmin(args);
    return;
  }

  const rl = createRL();

  try {
    printBanner();

    // 显示菜单
    console.log('请选择操作：');
    console.log('');
    console.log('  [1] 安装 / 更新 WriteBot');
    console.log('  [2] 卸载 WriteBot');
    console.log('  [3] 退出');
    console.log('');

    const choice = await promptUser(rl, '请输入选项 (1/2/3): ');

    if (choice === '3') {
      console.log('已退出。');
      rl.close();
      return;
    }

    if (choice === '2') {
      await doUninstall(rl);
      await promptUser(rl, '输入 ok 关闭窗口: ');
      rl.close();
      return;
    }

    if (choice !== '1') {
      console.log('无效选项，已退出。');
      rl.close();
      return;
    }

    // 安装流程
    const serviceBinary = getServiceBinaryPath();
    const serviceDir = serviceBinary ? path.dirname(serviceBinary) : null;
    const targetDir = path.resolve(targetArg || serviceDir || DEFAULT_INSTALL_DIR);

    const { serviceOk } = await doInstall(targetDir);
    showPostInstallGuide(targetDir, serviceOk);

    await promptUser(rl, '输入 ok 关闭窗口: ');
    rl.close();
  } catch (error) {
    console.error('');
    console.error('操作失败:', error.message || error);
    console.error('');
    await promptUser(rl, '输入 ok 关闭窗口: ');
    rl.close();
    process.exit(1);
  }
}

main();

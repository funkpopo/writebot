/**
 * WriteBot 本地服务 - 服务/进程生命周期管理模块
 * 从 local-server.js 拆出：Windows 服务查询/启停、Word 进程检测、日志清理。
 * 通过 createLifecycle 注入常量，便于测试与复用。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execFile } = require('child_process');

const security = require('./lib/security');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} options
 * @param {string} options.serviceName Windows 服务名（如 'WriteBot'）
 * @param {string} options.logsDir 日志目录（用于清理过期日志）
 * @param {string} options.tasklistExe tasklist 可执行文件路径
 */
function createLifecycle(options) {
  const { serviceName, logsDir, tasklistExe } = options;

  function queryServiceState() {
    if (process.platform !== 'win32') return null;

    const result = spawnSync('sc', ['query', serviceName], { encoding: 'utf8' });
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
      spawnSync('sc', ['stop', serviceName], { stdio: 'inherit' });
    }
  }

  function startService(baseDir, exePath) {
    if (process.platform !== 'win32') return;

    if (fs.existsSync(exePath)) {
      spawnSync(exePath, ['start'], { stdio: 'inherit', cwd: baseDir });
    } else {
      spawnSync('sc', ['start', serviceName], { stdio: 'inherit' });
    }
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

    const escapedPath = security.escapePowerShellString(path.resolve(exePath));
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

    const escapedPath = security.escapePowerShellString(path.resolve(exePath));
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

  /** 使用 execFile 直接调用 tasklist，避免每轮 exec 额外拉起 cmd 进程。 */
  function checkWordProcess(callback) {
    if (process.platform !== 'win32') {
      callback(false);
      return;
    }
    execFile(
      tasklistExe,
      ['/FI', 'IMAGENAME eq WINWORD.EXE', '/NH'],
      { windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const isRunning = !!stdout && String(stdout).toLowerCase().includes('winword.exe');
        callback(isRunning);
      }
    );
  }

  /**
   * 清理过期日志文件：删除 logs 目录中超过指定天数的日志文件
   */
  function cleanupOldLogs(maxAgeDays = 7) {
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

  return {
    sleep,
    queryServiceState,
    stopService,
    startService,
    waitForServiceState,
    isProcessRunningByPath,
    stopProcessByPath,
    waitForProcessExit,
    checkWordProcess,
    cleanupOldLogs,
  };
}

module.exports = { sleep, createLifecycle };

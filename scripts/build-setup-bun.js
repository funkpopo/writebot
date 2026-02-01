/**
 * 使用 Bun 构建 WriteBot 单文件安装/更新器
 *
 * 输出: release/WriteBotSetup.exe
 * 用法: node scripts/build-setup-bun.js [--skip-build]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'WriteBot');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'setup-installer-template.js');
const INSTALLER_JS = path.join(RELEASE_DIR, 'WriteBotSetup.js');
const ZIP_PATH = path.join(RELEASE_DIR, 'WriteBotPayload.zip');
const SETUP_EXE = path.join(RELEASE_DIR, 'WriteBotSetup.exe');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')}`);
  }
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function buildPackage(skipBuild) {
  if (skipBuild) return;
  console.log('构建本地分发包...');
  run('node', ['scripts/build-local-package.js'], { cwd: ROOT_DIR });
}

function ensurePaths() {
  if (!fs.existsSync(PACKAGE_DIR)) {
    throw new Error(`未找到分发目录: ${PACKAGE_DIR}`);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`未找到安装器模板: ${TEMPLATE_PATH}`);
  }
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }
}

function createZip() {
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
  console.log('打包离线资源...');
  const psCommand = `Compress-Archive -Path '${escapePowerShell(
    path.join(PACKAGE_DIR, '*')
  )}' -DestinationPath '${escapePowerShell(ZIP_PATH)}' -Force`;
  run('powershell.exe', ['-NoProfile', '-Command', psCommand], { cwd: ROOT_DIR });
}

function chunkBase64(base64, size = 100000) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += size) {
    chunks.push(base64.slice(i, i + size));
  }
  return chunks;
}

function buildInstallerSource() {
  console.log('生成安装器源码...');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const base64 = fs.readFileSync(ZIP_PATH).toString('base64');
  const chunks = chunkBase64(base64);
  const chunkLines = chunks.map((chunk) => `  '${chunk}'`).join(',\n');
  const output = template.replace('/* __PAYLOAD_CHUNKS__ */', chunkLines);

  fs.writeFileSync(INSTALLER_JS, output, 'utf8');
}

function buildExecutable() {
  console.log('使用 Bun 构建单文件安装器...');
  run('bun', ['build', INSTALLER_JS, '--compile', '--outfile', SETUP_EXE], { cwd: ROOT_DIR });
}

function cleanup() {
  if (fs.existsSync(INSTALLER_JS)) {
    fs.unlinkSync(INSTALLER_JS);
  }
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
}

function main() {
  const skipBuild = process.argv.includes('--skip-build');
  buildPackage(skipBuild);
  ensurePaths();
  createZip();
  buildInstallerSource();
  buildExecutable();
  cleanup();

  console.log('');
  console.log('构建完成:');
  console.log(`  ${SETUP_EXE}`);
  console.log('');
}

main();

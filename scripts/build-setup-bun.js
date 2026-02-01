/**
 * 使用 Bun 构建 WriteBot 单文件安装/更新器
 *
 * 输出: release/WriteBotSetup.exe
 * 用法: bun scripts/build-setup-bun.js [--skip-build]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_LOCAL_DIR = path.join(ROOT_DIR, 'dist-local');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const PACKAGE_DIR = path.join(RELEASE_DIR, 'WriteBot');
const CERTS_DIR = path.join(DIST_LOCAL_DIR, 'certs');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'setup-installer-template.js');
const INSTALLER_JS = path.join(RELEASE_DIR, 'WriteBotSetup.js');
const ZIP_PATH = path.join(RELEASE_DIR, 'WriteBotPayload.zip');
const SETUP_EXE = path.join(RELEASE_DIR, 'WriteBotSetup.exe');
const WIN_SW_DIR = path.join(ROOT_DIR, 'assets', 'winsw');
const WIN_SW_EXE = path.join(WIN_SW_DIR, 'WriteBotService.exe');
const WIN_SW_XML = path.join(WIN_SW_DIR, 'WriteBotService.xml');
const WIN_SW_LICENSE = path.join(WIN_SW_DIR, 'LICENSE.txt');

const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')}`);
  }
}

function copyFileSync(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function chunkBase64(base64, size = 100000) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += size) {
    chunks.push(base64.slice(i, i + size));
  }
  return chunks;
}

async function buildLocalPackage() {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     WriteBot 本地分发包构建               ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  // 1. 检查/生成证书
  console.log('步骤 1/4: 检查 SSL 证书...');
  const certFile = path.join(CERTS_DIR, 'funkpopo-writebot.crt');
  const keyFile = path.join(CERTS_DIR, 'funkpopo-writebot.key');

  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    console.log('  证书不存在，正在生成...');
    run('bun', ['scripts/generate-certs.js'], { cwd: ROOT_DIR });
  } else {
    console.log('  证书已存在');
  }

  // 2. 运行 webpack 生产构建
  console.log('\n步骤 2/4: 运行 webpack 生产构建...');
  run('bun', ['run', 'build'], { cwd: ROOT_DIR });

  // 3. 创建输出目录
  console.log('\n步骤 3/4: 准备输出目录...');
  if (fs.existsSync(PACKAGE_DIR)) {
    fs.rmSync(PACKAGE_DIR, { recursive: true });
  }
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });

  // 4. 复制文件
  console.log('\n步骤 4/4: 复制文件...');

  // 复制构建产物
  console.log('  复制构建产物...');
  copyDirSync(DIST_DIR, PACKAGE_DIR);

  // 复制证书
  console.log('  复制证书...');
  copyDirSync(CERTS_DIR, path.join(PACKAGE_DIR, 'certs'));

  // 复制证书安装脚本
  console.log('  复制证书安装脚本...');
  const installCertScript = path.join(ROOT_DIR, 'scripts', 'install-cert.bat');
  if (fs.existsSync(installCertScript)) {
    copyFileSync(installCertScript, path.join(PACKAGE_DIR, 'install-cert.bat'));
  }

  // 复制 manifest
  console.log('  复制 manifest...');
  copyFileSync(path.join(ROOT_DIR, 'manifest.xml'), path.join(PACKAGE_DIR, 'manifest.xml'));

  // 打包可执行文件（使用 Bun）
  console.log('  打包可执行文件...');
  const serverPath = path.join(ROOT_DIR, 'scripts', 'local-server.js');
  const outputExe = path.join(PACKAGE_DIR, 'WriteBot.exe');

  run('bun', ['build', serverPath, '--compile', '--minify', '--outfile', outputExe], { cwd: ROOT_DIR });
  console.log('  已生成 WriteBot.exe');

  // 创建 VBS 启动器
  console.log('  创建后台启动器...');
  const vbsContent = `' WriteBot 后台启动器
' 用于隐藏 CMD 窗口运行 WriteBot.exe

Set WshShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' 检查命令行参数
Set args = WScript.Arguments
strArgs = ""
For Each arg In args
    strArgs = strArgs & " " & arg
Next

' 隐藏窗口运行
WshShell.Run """" & strPath & "\\WriteBot.exe""" & strArgs, 0, False
`;
  fs.writeFileSync(path.join(PACKAGE_DIR, 'WriteBot.vbs'), vbsContent, 'utf8');
  console.log('  已生成 WriteBot.vbs');

  // 复制 Windows 服务包装器（WinSW）
  if (fs.existsSync(WIN_SW_EXE)) {
    console.log('  复制 Windows 服务包装器...');
    copyFileSync(WIN_SW_EXE, path.join(PACKAGE_DIR, 'WriteBotService.exe'));
    if (fs.existsSync(WIN_SW_XML)) {
      copyFileSync(WIN_SW_XML, path.join(PACKAGE_DIR, 'WriteBotService.xml'));
    }
    if (fs.existsSync(WIN_SW_LICENSE)) {
      copyFileSync(WIN_SW_LICENSE, path.join(PACKAGE_DIR, 'WinSW.LICENSE.txt'));
    }
  }

  // 创建用户说明
  const readmeContent = `# WriteBot 写作助手

## 使用方法

### 单文件安装/更新（唯一方式）

1. 以管理员身份运行 WriteBotSetup.exe
2. 默认安装到 C:\\Users\\<用户名>\\WriteBot，可用 --target "D:\\WriteBot" 自定义路径
3. 安装器会自动安装证书与服务
4. 打开 Word 并加载加载项

## 注意事项

- 使用服务模式时：服务随系统启动后台运行（LocalSystem），Word 启动后自动提供服务，Word 关闭后会停止服务并继续等待
- 请勿移动或删除此文件夹

## 更新方式（唯一方式）

再次运行最新的 WriteBotSetup.exe 即可自动更新（含服务停止/重启与证书安装）。

## 常见问题

### 加载项显示"由于内容未经有效安全证书签名，因此已被阻止"
请重新以管理员身份运行 WriteBotSetup.exe，然后重启 Word。
`;
  fs.writeFileSync(path.join(PACKAGE_DIR, 'README.txt'), readmeContent, 'utf8');

  console.log('');
  console.log('本地分发包构建完成');
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

function buildInstallerSource() {
  console.log('生成安装器源码...');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const base64 = fs.readFileSync(ZIP_PATH).toString('base64');
  const chunks = chunkBase64(base64);
  const chunkLines = chunks.map((chunk) => `  '${chunk}'`).join(',\n');
  const output = template.replace('/* __PAYLOAD_CHUNKS__ */', chunkLines);

  fs.writeFileSync(INSTALLER_JS, output, 'utf8');
}

function buildSetupExecutable() {
  console.log('使用 Bun 构建单文件安装器...');
  run('bun', ['build', INSTALLER_JS, '--compile', '--minify', '--outfile', SETUP_EXE], { cwd: ROOT_DIR });
}

function cleanup() {
  if (fs.existsSync(INSTALLER_JS)) {
    fs.unlinkSync(INSTALLER_JS);
  }
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');

  if (!skipBuild) {
    await buildLocalPackage();
  }

  if (!fs.existsSync(PACKAGE_DIR)) {
    throw new Error(`未找到分发目录: ${PACKAGE_DIR}`);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`未找到安装器模板: ${TEMPLATE_PATH}`);
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     构建单文件安装器                      ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  createZip();
  buildInstallerSource();
  buildSetupExecutable();
  cleanup();

  console.log('');
  console.log('构建完成:');
  console.log(`  ${SETUP_EXE}`);
  console.log('');
}

main().catch((error) => {
  console.error('构建失败:', error.message || error);
  process.exit(1);
});

/**
 * WriteBot 本地分发包构建脚本
 * 将项目打包为可分发给用户的本地部署包
 *
 * 用法: node scripts/build-local-package.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { load: loadResEdit } = require('resedit/cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_LOCAL_DIR = path.join(ROOT_DIR, 'dist-local');
const OUTPUT_DIR = path.join(ROOT_DIR, 'release', 'WriteBot');
const CERTS_DIR = path.join(DIST_LOCAL_DIR, 'certs');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const WIN_SW_DIR = path.join(ROOT_DIR, 'assets', 'winsw');
const WIN_SW_EXE = path.join(WIN_SW_DIR, 'WriteBotService.exe');
const WIN_SW_XML = path.join(WIN_SW_DIR, 'WriteBotService.xml');
const WIN_SW_LICENSE = path.join(WIN_SW_DIR, 'LICENSE.txt');

const APP_INFO = {
  name: 'WriteBot',
  displayName: 'WriteBot 写作助手',
  companyName: 'WriteBot',
  version: PACKAGE_JSON.version || '1.0.0',
};

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

function normalizeVersion(version) {
  const parts = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value));

  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4);
}

async function applyWindowsMetadata(exePath) {
  const ResEdit = await loadResEdit();
  const [major, minor, patch, build] = normalizeVersion(APP_INFO.version);
  const lang = 1033;
  const codepage = 1200;

  const exeData = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();

  vi.setFileVersion(major, minor, patch, build, lang);
  vi.setProductVersion(major, minor, patch, build, lang);
  vi.setStringValues({ lang, codepage }, {
    FileDescription: APP_INFO.displayName,
    ProductName: APP_INFO.name,
    CompanyName: APP_INFO.companyName,
    ProductVersion: APP_INFO.version,
    FileVersion: APP_INFO.version,
    OriginalFilename: path.basename(exePath),
    InternalName: APP_INFO.name,
    LegalCopyright: `Copyright (c) ${new Date().getFullYear()} ${APP_INFO.companyName}`,
  });

  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  const newBinary = exe.generate();

  const tempPath = `${exePath}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(newBinary));
  fs.renameSync(tempPath, exePath);
}

async function main() {
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
    try {
      execSync('node scripts/generate-certs.js', { stdio: 'inherit', cwd: ROOT_DIR });
    } catch (error) {
      console.error('  证书生成失败，请手动运行: node scripts/generate-certs.js');
      process.exit(1);
    }
  } else {
    console.log('  证书已存在');
  }

  // 2. 运行 webpack 生产构建
  console.log('\n步骤 2/4: 运行 webpack 生产构建...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (error) {
    console.error('构建失败');
    process.exit(1);
  }

  // 3. 创建输出目录
  console.log('\n步骤 3/4: 准备输出目录...');
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 4. 复制文件
  console.log('\n步骤 4/4: 复制文件...');

  // 复制构建产物
  console.log('  复制构建产物...');
  copyDirSync(DIST_DIR, OUTPUT_DIR);

  // 复制证书
  console.log('  复制证书...');
  copyDirSync(CERTS_DIR, path.join(OUTPUT_DIR, 'certs'));

  // 复制证书安装脚本
  console.log('  复制证书安装脚本...');
  const installCertScript = path.join(ROOT_DIR, 'scripts', 'install-cert.bat');
  if (fs.existsSync(installCertScript)) {
    copyFileSync(installCertScript, path.join(OUTPUT_DIR, 'install-cert.bat'));
  }

  // 复制 manifest（以根目录版本为准）
  console.log('  复制 manifest...');
  copyFileSync(path.join(ROOT_DIR, 'manifest.xml'), path.join(OUTPUT_DIR, 'manifest.xml'));

  // 打包可执行文件
  console.log('  打包可执行文件...');
  try {
    const tempServerPath = path.join(OUTPUT_DIR, 'server.js');
    copyFileSync(path.join(ROOT_DIR, 'scripts', 'local-server.js'), tempServerPath);

    execSync(
      `npx @yao-pkg/pkg "${tempServerPath}" --target node18-win-x64 --output "${path.join(OUTPUT_DIR, 'WriteBot.exe')}"`,
      { stdio: 'inherit', cwd: ROOT_DIR }
    );

    fs.unlinkSync(tempServerPath);
    await applyWindowsMetadata(path.join(OUTPUT_DIR, 'WriteBot.exe'));
    console.log('  已生成 WriteBot.exe');
  } catch (error) {
    console.error('  打包可执行文件失败');
    process.exit(1);
  }

  // 创建 VBS 启动器（隐藏窗口运行）
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
  fs.writeFileSync(path.join(OUTPUT_DIR, 'WriteBot.vbs'), vbsContent, 'utf8');
  console.log('  已生成 WriteBot.vbs');

  // 复制 Windows 服务包装器（WinSW）
  if (fs.existsSync(WIN_SW_EXE)) {
    console.log('  复制 Windows 服务包装器...');
    copyFileSync(WIN_SW_EXE, path.join(OUTPUT_DIR, 'WriteBotService.exe'));
    if (fs.existsSync(WIN_SW_XML)) {
      copyFileSync(WIN_SW_XML, path.join(OUTPUT_DIR, 'WriteBotService.xml'));
    }
    if (fs.existsSync(WIN_SW_LICENSE)) {
      copyFileSync(WIN_SW_LICENSE, path.join(OUTPUT_DIR, 'WinSW.LICENSE.txt'));
    }
  } else {
    console.log('  未找到 Windows 服务包装器，跳过服务安装支持');
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
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.txt'), readmeContent, 'utf8');

  // 输出完成信息
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║              构建完成                     ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`分发包位置: ${OUTPUT_DIR}`);
  console.log('');
  console.log('目录结构:');
  console.log('  WriteBot/');
  console.log('  ├── WriteBot.exe        # 本地服务（控制台模式）');
  console.log('  ├── WriteBot.vbs        # 后台静默启动器');
  console.log('  ├── WriteBotService.exe # Windows 服务包装器（LocalSystem）');
  console.log('  ├── WriteBotService.xml # Windows 服务配置');
  console.log('  ├── install-cert.bat    # SSL 证书安装脚本');
  console.log('  ├── manifest.xml        # 加载项清单');
  console.log('  ├── README.txt          # 使用说明');
  console.log('  ├── certs/              # SSL 证书');
  console.log('  └── assets/             # 静态资源');
  console.log('');
}

main().catch((error) => {
  console.error('构建脚本执行失败:', error);
  process.exit(1);
});

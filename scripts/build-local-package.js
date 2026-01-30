/**
 * WriteBot 本地分发包构建脚本
 * 将项目打包为可分发给用户的本地部署包
 *
 * 用法: node scripts/build-local-package.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_LOCAL_DIR = path.join(ROOT_DIR, 'dist-local');
const OUTPUT_DIR = path.join(ROOT_DIR, 'release', 'WriteBot');
const CERTS_DIR = path.join(DIST_LOCAL_DIR, 'certs');

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

function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     WriteBot 本地分发包构建               ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  // 1. 检查/生成证书
  console.log('步骤 1/5: 检查 SSL 证书...');
  const certFile = path.join(CERTS_DIR, 'localhost.crt');
  const keyFile = path.join(CERTS_DIR, 'localhost.key');

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
  console.log('\n步骤 2/5: 运行 webpack 生产构建...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (error) {
    console.error('构建失败');
    process.exit(1);
  }

  // 3. 创建输出目录
  console.log('\n步骤 3/5: 准备输出目录...');
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 4. 复制文件
  console.log('\n步骤 4/5: 复制文件...');

  // 复制构建产物
  console.log('  复制构建产物...');
  copyDirSync(DIST_DIR, OUTPUT_DIR);

  // 复制证书
  console.log('  复制证书...');
  copyDirSync(CERTS_DIR, path.join(OUTPUT_DIR, 'certs'));

  // 复制 manifest
  console.log('  复制 manifest...');
  copyFileSync(
    path.join(DIST_LOCAL_DIR, 'manifest.xml'),
    path.join(OUTPUT_DIR, 'manifest.xml')
  );

  // 5. 打包可执行文件
  console.log('\n步骤 5/5: 打包可执行文件...');
  try {
    const tempServerPath = path.join(OUTPUT_DIR, 'server.js');
    copyFileSync(path.join(DIST_LOCAL_DIR, 'server.js'), tempServerPath);

    execSync(
      `npx @yao-pkg/pkg "${tempServerPath}" --target node18-win-x64 --output "${path.join(OUTPUT_DIR, 'WriteBot.exe')}"`,
      { stdio: 'inherit', cwd: ROOT_DIR }
    );

    fs.unlinkSync(tempServerPath);
    console.log('  已生成 WriteBot.exe');
  } catch (error) {
    console.error('  打包可执行文件失败');
    process.exit(1);
  }

  // 创建用户说明
  const readmeContent = `# WriteBot 写作助手

## 使用方法

1. 启动 WriteBot.exe
2. 打开 Word
3. 在 Word 中配置受信任的加载项目录：
   文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的加载项目录
   添加此文件夹路径
4. 插入 → 我的加载项 → 共享文件夹 → WriteBot

## 注意事项

- 使用前需要先启动 WriteBot.exe
- 请勿移动或删除此文件夹
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
  console.log('  ├── WriteBot.exe        # 服务程序');
  console.log('  ├── manifest.xml        # 加载项清单');
  console.log('  ├── README.txt          # 使用说明');
  console.log('  ├── certs/              # SSL 证书');
  console.log('  └── assets/             # 静态资源');
  console.log('');
}

main();

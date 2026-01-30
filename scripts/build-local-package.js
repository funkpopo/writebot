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
const OUTPUT_DIR = path.join(ROOT_DIR, 'release', 'WriteBot');

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

  // 1. 运行 webpack 生产构建
  console.log('步骤 1/3: 运行 webpack 生产构建...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (error) {
    console.error('构建失败');
    process.exit(1);
  }

  // 2. 创建输出目录
  console.log('\n步骤 2/3: 准备输出目录...');
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 3. 复制文件
  console.log('\n步骤 3/3: 复制文件...');

  // 复制构建产物
  console.log('  复制构建产物...');
  copyDirSync(DIST_DIR, OUTPUT_DIR);

  // 创建用户说明
  const readmeContent = `# WriteBot 写作助手

## 使用方法

1. 解压到固定位置（如 D:\\WriteBot）
2. 打开 Word
3. 在 Word 中配置受信任的 Web 加载项目录：
   文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的 Web 加载项目录
   添加此文件夹路径
4. 插入 → 我的加载项 → 共享文件夹 → WriteBot

## 注意事项

- 无需启动任何额外脚本或程序
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
  console.log('  ├── manifest.xml        # 加载项清单');
  console.log('  ├── README.txt          # 使用说明');
  console.log('  └── assets/             # 静态资源');
  console.log('');
}

main();

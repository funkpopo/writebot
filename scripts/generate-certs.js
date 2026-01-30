/**
 * 生成开发用 SSL 证书
 * 使用 office-addin-dev-certs 工具生成
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = path.join(__dirname, '..', 'dist-local', 'certs');

function main() {
  console.log('生成 SSL 证书...\n');

  // 创建证书目录
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }

  try {
    // 使用 office-addin-dev-certs 生成证书
    execSync('npx office-addin-dev-certs install --days 365', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    // 获取证书路径（office-addin-dev-certs 默认存储位置）
    const homedir = require('os').homedir();
    const defaultCertPath = path.join(homedir, '.office-addin-dev-certs');

    // 复制证书到项目目录
    const certFiles = ['localhost.crt', 'localhost.key'];
    for (const file of certFiles) {
      const src = path.join(defaultCertPath, file);
      const dest = path.join(CERTS_DIR, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`已复制: ${file}`);
      }
    }

    console.log('\n证书已生成到 dist-local/certs 目录');
  } catch (error) {
    console.error('证书生成失败，使用 OpenSSL 生成...');
    generateWithOpenSSL();
  }
}

function generateWithOpenSSL() {
  try {
    execSync(
      `openssl req -x509 -nodes -days 365 -newkey rsa:2048 ` +
        `-keyout "${path.join(CERTS_DIR, 'localhost.key')}" ` +
        `-out "${path.join(CERTS_DIR, 'localhost.crt')}" ` +
        `-subj "/CN=localhost" ` +
        `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: 'inherit' }
    );
    console.log('\n证书已生成到 dist-local/certs 目录');
  } catch (error) {
    console.error('OpenSSL 生成证书失败');
    console.error('请确保已安装 OpenSSL 或 office-addin-dev-certs');
    process.exit(1);
  }
}

main();

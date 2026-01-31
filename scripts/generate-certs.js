/**
 * 生成开发用 SSL 证书
 * 证书名称: funkpopo-writebot
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = path.join(__dirname, '..', 'dist-local', 'certs');
const CERT_NAME = 'funkpopo-writebot';

function main() {
  console.log('生成 SSL 证书...\n');
  console.log(`证书名称: ${CERT_NAME}`);

  // 创建证书目录
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }

  // 使用 OpenSSL 生成自签名证书
  generateWithOpenSSL();
}

function generateWithOpenSSL() {
  const keyPath = path.join(CERTS_DIR, `${CERT_NAME}.key`);
  const crtPath = path.join(CERTS_DIR, `${CERT_NAME}.crt`);

  // 创建 OpenSSL 配置文件
  const opensslConfig = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${CERT_NAME}
O = WriteBot
OU = Development
L = Local
ST = Local
C = CN

[v3_req]
basicConstraints = CA:TRUE
keyUsage = digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = ${CERT_NAME}
IP.1 = 127.0.0.1
`;

  const configPath = path.join(CERTS_DIR, 'openssl.cnf');
  fs.writeFileSync(configPath, opensslConfig.trim(), 'utf8');

  try {
    // 生成私钥和证书
    execSync(
      `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 ` +
        `-keyout "${keyPath}" ` +
        `-out "${crtPath}" ` +
        `-config "${configPath}"`,
      { stdio: 'inherit' }
    );

    // 删除临时配置文件
    fs.unlinkSync(configPath);

    console.log('\n证书已生成:');
    console.log(`  私钥: ${keyPath}`);
    console.log(`  证书: ${crtPath}`);
    console.log('\n证书信息:');
    console.log(`  名称 (CN): ${CERT_NAME}`);
    console.log('  有效期: 10 年 (3650 天)');
    console.log('  支持域名: localhost, ' + CERT_NAME);
    console.log('  支持 IP: 127.0.0.1');
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    console.error('OpenSSL 生成证书失败');
    console.error('请确保已安装 OpenSSL');
    console.error('Windows 用户可以从 https://slproweb.com/products/Win32OpenSSL.html 下载安装');
    process.exit(1);
  }
}

main();

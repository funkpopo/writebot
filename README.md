# WriteBot - Word 智能写作助手

<p align="center">
  <strong>Microsoft Word AI 写作助手加载项</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.5-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Office-Word-orange.svg" alt="Office">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
</p>

---

## 功能特性

### AI 写作助手

| 功能 | 说明 |
|------|------|
| **智能需求** | Agent 模式，AI 自动理解需求并调用工具读取、修改文档 |
| **文本润色** | 优化文本表达，使内容更加流畅自然 |
| **语法检查** | 智能检测并修正语法错误 |
| **翻译** | 支持中英文互译 |
| **生成摘要** | 自动提取文本核心内容，生成精炼摘要 |
| **续写内容** | 基于上下文智能续写，支持多种风格（正式/轻松/专业/创意） |
| **生成内容** | 根据描述生成全新内容 |


![AI 写作助手演示](assets/gifs/智能需求.gif)

### 文本分析

实时统计文档或选中文本的详细信息：

- 总字符数 / 不含空格字符数
- 词数（支持中英文混合统计）
- 句子数
- 段落数

### 排版助手

专业的文档格式管理工具：

| 功能 | 说明 |
|------|------|
| **格式分析** | 自动检测文档格式问题，生成优化建议 |
| **变更清单** | 可视化管理待应用的格式变更 |
| **颜色标识治理** | 智能分析文本颜色使用，提供规范化建议 |
| **格式标记分析** | 检测下划线、斜体、删除线等格式的合理性 |
| **页眉页脚模板** | 快速配置页眉页脚，支持首页不同、奇偶页不同 |
| **中英混排规范** | 统一中英文字体、修正间距与标点 |


![排版助手演示](assets/gifs/辅助排版.gif)

### 多平台 AI 支持

支持主流 AI 服务提供商：

- **OpenAI**
- **Anthropic**
- **Google Gemini**

API 密钥仅保存在本地，保障数据安全。

---

## 快速开始

### 安装（使用 exe 安装包）

1. 以管理员身份运行 `WriteBotSetup.exe`
2. 默认安装到 `C:\Users\<用户名>\WriteBot`（强烈建议保持默认）
3. 如需自定义路径：运行 `WriteBotSetup.exe --target "D:\WriteBot"`
4. 安装器会自动安装证书与服务
5. 打开 Word 即可使用

> **提示**：后续更新同样只需运行最新的 `WriteBotSetup.exe`。如果首次安装使用了自定义路径，后续更新也应使用同一 `--target` 路径。

### 首次配置（一次性）

需要配置 Word 信任中心的受信任的 Web 加载项目录和网络共享：

<img width="289" height="257" alt="网络共享配置" src="https://github.com/user-attachments/assets/bbfe29a7-8470-4692-a746-ccf70e6825b2" />

Word 配置路径：**文件** → **选项** → **信任中心** → **信任中心设置** → **受信任的加载项目录**

<img width="839" height="438" alt="Word配置" src="https://github.com/user-attachments/assets/838651f0-a2df-4248-96ae-7da9e2bd7808" />

### 日常使用

1. 打开 Word
2. 点击 **加载项** → **WriteBot**

服务会在检测到 Word 启动后自动启动，Word 关闭后会等待下一次启动。

---

## 异常处理

<details>
<summary><strong>服务状态检查</strong></summary>

如果加载项无法正常工作，请先检查服务状态：

**PowerShell（管理员）：**
```powershell
# 检查服务状态
Get-Service -Name "WriteBotService"
# 启动服务
Start-Service -Name "WriteBotService"
```

**CMD（管理员）：**
```cmd
:: 检查服务状态
sc query WriteBotService
:: 启动服务
net start WriteBotService
```

查看服务日志：位于安装目录下的 `logs` 文件夹

</details>

<details>
<summary><strong>Office 加载项缓存清理</strong></summary>

如果加载项出现异常（如加载失败、显示旧版本等），可能需要清理 Office 的 Web 加载项缓存：

1. 完全关闭所有 Office 应用程序（Word、Excel、Outlook 等）
2. 删除以下目录中的内容：
   ```
   %LOCALAPPDATA%\Microsoft\Office\16.0\Wef
   ```

   **PowerShell：**
   ```powershell
   Remove-Item -Path "$env:LOCALAPPDATA\Microsoft\Office\16.0\Wef\*" -Recurse -Force
   ```

   **CMD：**
   ```cmd
   rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"
   ```

3. 重新打开 Word，加载项将重新初始化

</details>

<details>
<summary><strong>证书问题</strong></summary>

如果浏览器或 Office 提示证书不受信任：

1. 以管理员身份重新运行 `WriteBotSetup.exe`，安装器会自动重新安装证书
2. 或手动安装证书：双击安装目录下的 `cert.crt`，选择"安装证书" → "本地计算机" → "受信任的根证书颁发机构"

</details>

<details>
<summary><strong>端口冲突</strong></summary>

如果服务启动失败，可能是端口被占用：

检查端口占用情况（PowerShell 或 CMD 均可）：
```cmd
netstat -ano | findstr "53000"
```

如有冲突，结束占用端口的进程或修改配置

</details>

---

## 开发者指南

### 环境要求

- Node.js 18+
- Bun（推荐）或 npm

### 安装 Bun（Windows）

推荐使用官方脚本安装（需 PowerShell）：

```powershell
irm https://bun.sh/install.ps1 | iex
```

安装完成后，确认 `bun` 已加入 PATH：

```powershell
bun --version
```

如企业环境禁用脚本，请使用官方安装包（地址见 https://bun.sh）。

### 本地开发

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev-server

# 类型检查
bun run typecheck

# 代码检查
bun run lint
```

### 构建单文件安装器

```bash
bun install
bun run build:setup
```

生成文件：`release\WriteBotSetup.exe`

分发时只需要发送这个 exe。

---

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 | UI 框架 |
| TypeScript | 类型安全 |
| Fluent UI | 微软设计系统组件库 |
| Office.js | Office 加载项 API |
| Webpack | 构建工具 |
| Bun | 包管理与构建 |

---

## 许可证

MIT License

---

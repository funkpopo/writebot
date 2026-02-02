## 用户使用流程

### 单文件安装/更新（使用exe安装包方式）

1. 以管理员身份运行 `WriteBotSetup.exe`
2. 默认安装到 `C:\Users\<用户名>\WriteBot`（强烈建议保持默认）
3. 如需自定义路径：运行 `WriteBotSetup.exe --target "D:\WriteBot"`
4. 安装器会自动安装证书与服务
5. 打开 Word

提示：后续更新同样只需运行最新的 WriteBotSetup.exe。
提示：如果首次安装使用了自定义路径，后续更新也应使用同一 `--target` 路径。

### 首次配置（一次性）

1. 配置信任中心的受信任的 Web 加载项目录
2. 配置网络共享

<img width="289" height="257" alt="image" src="https://github.com/user-attachments/assets/bbfe29a7-8470-4692-a746-ccf70e6825b2" />

Word配置：
文件 - 选项

<img width="839" height="438" alt="image" src="https://github.com/user-attachments/assets/838651f0-a2df-4248-96ae-7da9e2bd7808" />

服务会在检测到 Word 启动后自动启动。
服务模式下：Word 关闭后会停止服务并继续等待下一次启动。

### 日常使用

1. 打开 Word
2. 加载项 → WriteBot

### 异常处理

#### 服务状态检查

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

#### Office 加载项缓存清理

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

#### 证书问题

如果浏览器或 Office 提示证书不受信任：

1. 以管理员身份重新运行 `WriteBotSetup.exe`，安装器会自动重新安装证书
2. 或手动安装证书：双击安装目录下的 `cert.crt`，选择"安装证书" → "本地计算机" → "受信任的根证书颁发机构"

#### 端口冲突

如果服务启动失败，可能是端口被占用：

检查端口占用情况（PowerShell 或 CMD 均可）：
```cmd
netstat -ano | findstr "53000"
```

如有冲突，结束占用端口的进程或修改配置

---

## 构建与分发（开发者）

### 安装 Bun（Windows）

推荐使用官方脚本安装（需 PowerShell）：

```powershell
irm https://bun.sh/install.ps1 | iex
```

安装完成后，确认 `bun` 已加入 PATH：

```powershell
bun --version
```

如企业环境禁用脚本，请使用官方安装包（地址见 `https://bun.sh`）。

### 使用 Bun 构建单文件安装器

```bash
bun install
bun run build:setup
```

生成文件：`release\WriteBotSetup.exe`  
分发时只需要发送这个 exe。

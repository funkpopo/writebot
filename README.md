## 用户使用流程

### 首次配置（一次性）

1. 解压到固定位置（如 `D:\WriteBot`）
2. 配置网络共享

<img width="289" height="257" alt="image" src="https://github.com/user-attachments/assets/bbfe29a7-8470-4692-a746-ccf70e6825b2" />

Word配置：
文件 - 选项

<img width="839" height="438" alt="image" src="https://github.com/user-attachments/assets/838651f0-a2df-4248-96ae-7da9e2bd7808" />

## 安装步骤位于压缩包内的README.txt

服务会在检测到 Word 启动后自动启动。

服务模式下：Word 关闭后会停止服务并继续等待下一次启动。

启动项模式下：Word 关闭后进程会自动退出。

自动启动（服务）：运行 `WriteBot.exe --install-service`（需管理员权限）

安装完成后会在当前会话后台启动等待进程，无需手动运行 `wscript.exe WriteBot.vbs --wait-for-word`或者双击exe前台运行。

如需取消自动启动：运行 `WriteBot.exe --uninstall-startup` 或管理员运行 `WriteBot.exe --uninstall-service`。

### 日常使用

1. 打开 Word
2. 加载项 → WriteBot

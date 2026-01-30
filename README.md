## 用户使用流程

### 首次配置（一次性）

1. 解压到固定位置（如 `D:\WriteBot`）
2. 配置网络共享

<img width="289" height="257" alt="image" src="https://github.com/user-attachments/assets/bbfe29a7-8470-4692-a746-ccf70e6825b2" />

Word配置：
文件 - 选项

<img width="839" height="438" alt="image" src="https://github.com/user-attachments/assets/838651f0-a2df-4248-96ae-7da9e2bd7808" />

3. 运行 `WriteBot.exe --install-startup`（仅一次，注册随 Word 启动的本地服务）
4. 在 Word 中配置受信任的 Web 加载项目录：
   - 文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的 Web 加载项目录
   - 添加 WriteBot 文件夹路径
5. 工具栏 → 加载项 → 共享文件夹 → WriteBot

服务会在检测到 Word 启动后自动启动，Word 关闭后自动退出。
安装完成后会在当前会话后台启动等待进程，无需手动运行 `wscript.exe WriteBot.vbs --wait-for-word`。
开机自启动项会直接运行 `WriteBot.exe --wait-for-word --silent`（进程名为 WriteBot.exe，后台静默）。
如需取消自动启动：运行 `WriteBot.exe --uninstall-startup`。

### 日常使用

1. 打开 Word
2. 加载项 → WriteBot

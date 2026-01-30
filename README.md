## 用户使用流程

### 首次配置（一次性）

1. 解压到固定位置（如 `D:\WriteBot`）
2. 运行 `WriteBot.exe --install-startup`（仅一次，注册随 Word 启动的本地服务）
3. 运行 `wscript.exe WriteBot.vbs --wait-for-word`
4. 在 Word 中配置受信任的 Web 加载项目录：
   - 文件 → 选项 → 信任中心 → 信任中心设置 → 受信任的 Web 加载项目录
   - 添加 WriteBot 文件夹路径
5. 工具栏 → 加载项 → 共享文件夹 → WriteBot

服务会在检测到 Word 启动后自动启动，Word 关闭后自动退出。
如需取消自动启动：运行 `WriteBot.exe --uninstall-startup`。

### 日常使用

1. 打开 Word
2. 加载项 → WriteBot
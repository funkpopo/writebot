## 用户使用流程

### 单文件安装/更新（唯一方式）

1. 以管理员身份运行 `WriteBotSetup.exe`
2. 默认安装到 `C:\Users\<用户名>\WriteBot`，可用 `--target "D:\WriteBot"` 自定义路径
3. 安装器会自动安装证书与服务
4. 打开 Word

提示：后续更新同样只需运行最新的 WriteBotSetup.exe。

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

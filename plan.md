# Word 写作助手加载项实现计划

## 一、项目概述

创建一个嵌入式 Office 加载项（Office Add-in），作为 Word 的写作助手，以任务窗格（Task Pane）形式集成在 Word 应用内部。

## 二、技术栈

- **前端框架**: React + TypeScript
- **Office API**: Office.js (Word JavaScript API)
- **构建工具**: Vite 或 Webpack
- **UI 组件**: Fluent UI React（微软官方组件库，与 Office 风格一致）
- **开发工具**: Yeoman Office Generator

## 三、项目结构

```
writebot/
├── manifest.xml          # 加载项清单文件（核心配置）
├── src/
│   ├── taskpane/
│   │   ├── taskpane.html # 任务窗格入口页面
│   │   ├── taskpane.tsx  # React 主组件
│   │   └── components/   # UI 组件
│   │       ├── App.tsx
│   │       ├── WritingAssistant.tsx
│   │       ├── TextAnalyzer.tsx
│   │       └── AIHelper.tsx
│   ├── commands/
│   │   └── commands.ts   # 功能区命令处理
│   └── utils/
│       ├── wordApi.ts    # Word API 封装
│       └── aiService.ts  # AI 服务接口
├── assets/
│   └── icons/            # 加载项图标
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## 四、核心功能规划

### 4.1 文档操作功能
- 获取选中文本 / 全文内容
- 插入/替换文本
- 格式化文本（加粗、斜体、标题等）
- 添加批注和修订

### 4.2 写作助手功能
- **文本润色**: 优化语句表达
- **语法检查**: 检测并修正语法错误
- **内容续写**: AI 辅助续写内容
- **摘要生成**: 生成文档摘要
- **翻译功能**: 多语言翻译
- **风格调整**: 正式/非正式语气转换

## 五、实现步骤

### 步骤 1: 环境准备
```bash
# 安装 Node.js (v18+)
# 安装 Yeoman 和 Office 生成器
npm install -g yo generator-office

# 创建项目
yo office --projectType taskpane --name "WriteBot" --host word --ts true
```

### 步骤 2: 配置 manifest.xml
manifest.xml 是加载项的核心配置文件，定义：
- 加载项 ID 和版本
- 显示名称和描述
- 任务窗格 URL
- 权限范围
- 功能区按钮

### 步骤 3: 开发任务窗格 UI
使用 React + Fluent UI 构建用户界面：
- 主面板布局
- 功能选项卡
- 输入/输出区域
- 操作按钮

### 步骤 4: 集成 Word API
```typescript
// 示例：获取选中文本
async function getSelectedText(): Promise<string> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    return selection.text;
  });
}

// 示例：替换选中文本
async function replaceSelectedText(newText: string): Promise<void> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertText(newText, Word.InsertLocation.replace);
    await context.sync();
  });
}
```

### 步骤 5: 集成 AI 服务
- 配置 AI API 接口（如 Claude API）
- 实现文本处理逻辑
- 处理请求/响应

### 步骤 6: 测试与调试
```bash
# 启动开发服务器并在 Word 中加载
npm start
```

## 六、加载步骤（开发环境）

### 方法 1: 使用 npm start（推荐）
```bash
cd writebot
npm start
```
此命令会自动：
1. 启动本地开发服务器（https://localhost:3000）
2. 在 Word 中侧载加载项

### 方法 2: 手动侧载

#### Windows 上的 Word
1. 打开 Word
2. 点击 **文件** > **选项** > **信任中心** > **信任中心设置**
3. 选择 **受信任的加载项目录**
4. 添加 manifest.xml 所在的文件夹路径
5. 重启 Word
6. 点击 **插入** > **我的加载项** > **共享文件夹**
7. 选择 WriteBot 加载项

#### 使用网络共享文件夹
1. 创建共享文件夹，放入 manifest.xml
2. 在 Word 信任中心添加该共享路径
3. 从"我的加载项"中加载

### 方法 3: 集中部署（生产环境）
- 通过 Microsoft 365 管理中心部署
- 发布到 AppSource（Office 应用商店）

## 七、开发注意事项

1. **HTTPS 要求**: 加载项必须通过 HTTPS 提供服务
2. **跨域问题**: 配置 CORS 或使用代理
3. **Office 版本兼容**: 检查 API 在目标 Office 版本中的支持情况
4. **性能优化**: 避免频繁调用 `context.sync()`
5. **错误处理**: 妥善处理 API 调用失败的情况

## 八、后续扩展

- 添加用户设置和偏好保存
- 实现离线功能
- 添加快捷键支持
- 集成更多 AI 模型

## 九、参考资源

- [Office 加载项文档](https://learn.microsoft.com/office/dev/add-ins/)
- [Word JavaScript API](https://learn.microsoft.com/javascript/api/word)
- [Fluent UI React](https://developer.microsoft.com/fluentui)
- [Office 加载项示例](https://github.com/OfficeDev/Office-Add-in-samples)

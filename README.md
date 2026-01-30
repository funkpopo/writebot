# WriteBot - Word 写作助手

一个嵌入式 Office 加载项，作为 Word 的智能写作助手。

## 功能特性

- **文本润色**: 优化语句表达
- **语法检查**: 检测并修正语法错误
- **翻译功能**: 中英文互译
- **文本分析**: 统计字数、句子数、段落数等
- **AI 续写**: 智能续写内容
- **摘要生成**: 自动生成文档摘要

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 生成开发证书

```bash
npx office-addin-dev-certs install
```

### 3. 启动开发服务器

```bash
npm run dev-server
```

### 4. 在 Word 中加载

```bash
npm start
```

## 项目结构

```
writebot/
├── manifest.xml          # 加载项清单（https://localhost:3000）
├── src/
│   ├── taskpane/
│   │   ├── taskpane.html # 任务窗格入口
│   │   ├── taskpane.tsx  # React 入口
│   │   └── components/   # UI 组件
│   ├── commands/
│   │   └── commands.ts   # 功能区命令
│   └── utils/
│       ├── wordApi.ts    # Word API 封装
│       └── aiService.ts  # AI 服务接口
├── assets/icons/         # 图标资源
└── webpack.config.js     # 构建配置
```

## 开发命令

- `npm run dev-server` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm run lint` - 代码检查
- `npm start` - 启动并在 Word 中加载
- `npm run validate` - 验证 manifest.xml

## 技术栈

- React 18
- TypeScript
- Fluent UI React
- Office.js (Word JavaScript API)
- Webpack

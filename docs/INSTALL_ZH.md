# Archivist Pro — 安装指南

本指南说明在开发环境中安装和运行 Archivist Pro 所需的步骤。

## 系统要求

| 要求 | 最低配置 |
|------------|---------|
| 操作系统 | Windows 10（64 位） |
| Node.js | 20+ |
| Rust | 1.77.2+ |
| Tauri CLI | 2.x |
| 内存 | 4 GB（AI 功能需要 8 GB+） |
| 磁盘 | 约 2 GB（含依赖项） |

## 1. 前提条件

### Node.js

下载并安装 [Node.js 20+](https://nodejs.org/)。验证安装：

```bash
node --version   # v20.x.x 或更高
npm --version    # 10.x.x 或更高
```

### Rust

通过 [rustup](https://rustup.rs/) 安装 Rust：

```bash
# 安装 rustup（Windows 安装程序或 shell）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 验证
rustc --version   # 1.77.2 或更高
cargo --version
```

### Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### Windows 构建要求

Tauri 在 Windows 上需要 C++ 构建工具。若未安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)：

1. 下载 Visual Studio Build Tools
2. 选择"使用 C++ 的桌面开发"工作负载
3. 完成安装

## 2. 项目设置

```bash
# 克隆仓库
git clone <repo-url>
cd Arsiv-H2

# 安装依赖
npm install
```

运行 `npm install` 时，`postinstall` 脚本会自动将 `sql-wasm.wasm` 复制到 `public/` 目录。该文件是 WASM SQLite 数据库所必需的。

## 3. 开发

### Web 模式（仅前端）

```bash
npm run dev
```

在浏览器中打开 `http://localhost:5173`。需要 Rust 后端的功能（缩略图、文件扫描等）通过模拟服务运行。

### Tauri 原生模式

```bash
npm run tauri dev
```

同时编译前端和 Rust 后端，并在原生窗口中打开。首次运行时 Rust 编译可能需要几分钟。

> **注意：** 首次运行时会出现**两个**初始界面：
> 1. **设置向导** — 系统检查、硬件检测、AI 配置和语言选择（4 步）。完成后不再显示。
> 2. **首次管理员设置** — 如果没有用户，登录界面会改为打开 `FirstRunSetup`；在此创建第一个管理员账户。没有硬编码的 admin/admin 密码。
>
> 忘记密码时：在登录界面的"忘记密码"流程中使用 `%APPDATA%\com.archivistpro.desktop\recovery.key`。

### 角色模式

应用程序可在两种角色模式下运行：

```bash
# 管理员模式（默认）— 所有功能均可用
npm run dev:admin

# 查看者模式 — 只读，访问受限
npm run dev:viewer
```

角色模式由 `VITE_APP_ROLE` 环境变量确定。Vite 模式文件（`.env.admin`、`.env.viewer`）设置该变量。

## 4. 环境变量

| 变量 | 值 | 说明 |
|----------|--------|-------------|
| `VITE_APP_ROLE` | `admin` \| `viewer` | 应用程序角色（默认：admin） |

环境变量可在 `.env` 文件或 Vite 模式文件（`.env.admin`、`.env.viewer`）中定义。

## 5. 生产构建

### Web 构建

```bash
npm run build
```

输出写入 `dist/` 目录。

### Tauri 安装包

```bash
npm run tauri build
```

Windows 安装程序（`.msi` 和 `.exe`）生成于 `src-tauri/target/release/bundle/` 下。

## 6. 可选：安装 Ollama（AI 功能）

Archivist Pro 使用本地 Ollama 服务器实现 AI 功能（DWG 自然语言搜索、查询扩展）。

1. 下载并安装 [Ollama](https://ollama.ai/)
2. 拉取模型：
   ```bash
   ollama pull llama3.2
   ```
3. 验证 Ollama 服务器正在运行：
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. 在应用中通过"设置 > AI 配置"配置 Ollama 连接

> **提示：** 首次运行向导会自动检测 Ollama。如果 Ollama 已安装并正在运行，向导会列出可用的视觉模型并建议使用"本地 AI"选项。

CLIP 视觉搜索和嵌入功能通过 ONNX Runtime WASM 在浏览器中运行，无需额外安装。

## 7. 运行测试

### 单元测试

```bash
# 运行所有测试（605 个测试，35 个文件）
npm run test

# 监听模式
npm run test -- --watch

# 单个文件
npm run test -- src/tests/database.test.ts
```

### Rust 测试

```bash
cd src-tauri
cargo test --features admin
```

### E2E 测试

```bash
npm run test:e2e
```

## 8. 故障排除

### `sql-wasm.wasm 未找到` 错误

`postinstall` 脚本可能未运行：

```bash
node -e "const fs=require('fs');fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','public/sql-wasm.wasm');"
```

### Rust 构建错误：`linker not found`

未安装 Visual Studio Build Tools。请参阅上方"Windows 构建要求"章节。

### `npm run tauri dev` 连接错误

可能是 Tauri 窗口在 Vite 开发服务器启动之前就打开了。请先在单独的终端中运行 `npm run dev`，然后再尝试 `npm run tauri dev`。

### Ollama 连接错误

确保 Ollama 服务器正在运行：

```bash
ollama serve    # 启动服务器
ollama list     # 列出已安装的模型
```

默认端口为 `11434`。如果使用不同端口，请在应用的 AI 设置中更新。

### WASM 内存错误（大型数据库）

在扫描大量文件的大型归档中，浏览器可能达到内存限制。以 Tauri 原生模式运行可缓解此问题。

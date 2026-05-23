# Archivist Pro — Installation Guide

This guide explains the steps required to install and run Archivist Pro in a development environment.

## System Requirements

| Requirement | Minimum |
|------------|---------|
| Operating System | Windows 10 (64-bit) |
| Node.js | 20+ |
| Rust | 1.77.2+ |
| Tauri CLI | 2.x |
| RAM | 4 GB (8 GB+ for AI features) |
| Disk | ~2 GB (including dependencies) |

## 1. Prerequisites

### Node.js

Download and install [Node.js 20+](https://nodejs.org/). Verify the installation:

```bash
node --version   # v20.x.x or higher
npm --version    # 10.x.x or higher
```

### Rust

Install Rust via [rustup](https://rustup.rs/):

```bash
# Install rustup (Windows installer or shell)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify
rustc --version   # 1.77.2 or higher
cargo --version
```

### Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### Windows Build Requirements

Tauri requires C++ build tools on Windows. If [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) is not installed:

1. Download Visual Studio Build Tools
2. Select the "Desktop development with C++" workload
3. Complete the installation

## 2. Project Setup

```bash
# Clone the repository
git clone <repo-url>
cd Arsiv-H2

# Install dependencies
npm install
```

When `npm install` runs, the `postinstall` script automatically copies `sql-wasm.wasm` to the `public/` directory. This file is required for the WASM SQLite database.

## 3. Development

### Web Mode (Frontend Only)

```bash
npm run dev
```

Opens at `http://localhost:5173` in the browser. Features requiring the Rust backend (thumbnails, file scanning, etc.) work with a mock service.

### Tauri Native Mode

```bash
npm run tauri dev
```

Compiles both the frontend and Rust backend and opens them in a native window. The first run may take several minutes for Rust compilation.

> **Note:** On first run, **two** initial screens appear:
> 1. **Setup Wizard** — System check, hardware detection, AI configuration, and language selection (4 steps). Shown only once after completion.
> 2. **First Admin Setup** — If no users exist, `FirstRunSetup` opens instead of the login screen; the first admin account is created here. There is no hardcoded admin/admin password.
>
> If you forget your password: use `%APPDATA%\com.archivistpro.desktop\recovery.key` in the "Forgot Password" flow on the login screen.

### Role Modes

The application can run in two role modes:

```bash
# Admin mode (default) — all features active
npm run dev:admin

# Viewer mode — read-only, restricted access
npm run dev:viewer
```

The role mode is determined by the `VITE_APP_ROLE` environment variable. Vite mode files (`.env.admin`, `.env.viewer`) set this variable.

## 4. Environment Variables

| Variable | Values | Description |
|----------|--------|-------------|
| `VITE_APP_ROLE` | `admin` \| `viewer` | Application role (default: admin) |

Environment variables can be defined in a `.env` file or in Vite mode files (`.env.admin`, `.env.viewer`).

## 5. Production Build

### Web Build

```bash
npm run build
```

Output is written to the `dist/` directory.

### Tauri Installer

```bash
npm run tauri build
```

Windows installer (`.msi` and `.exe`) is created under `src-tauri/target/release/bundle/`.

## 6. Optional: Installing Ollama (AI Features)

Archivist Pro uses a local Ollama server for AI features (DWG natural language search, query expansion).

1. Download and install [Ollama](https://ollama.ai/)
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ```
3. Verify the Ollama server is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. Configure the Ollama connection in the app under Settings > AI Configuration

> **Tip:** The first-run wizard automatically detects Ollama. If Ollama is installed and running, the wizard lists available vision models and suggests the "Local AI" option.

CLIP visual search and embedding features run in the browser via ONNX Runtime WASM — no additional installation required.

## 7. Running Tests

### Unit Tests

```bash
# Run all tests (605 tests, 35 files)
npm run test

# Watch mode
npm run test -- --watch

# Single file
npm run test -- src/tests/database.test.ts
```

### Rust Tests

```bash
cd src-tauri
cargo test --features admin
```

### E2E Tests

```bash
npm run test:e2e
```

## 8. Troubleshooting

### `sql-wasm.wasm not found` error

The `postinstall` script may not have run:

```bash
node -e "const fs=require('fs');fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','public/sql-wasm.wasm');"
```

### Rust build error: `linker not found`

Visual Studio Build Tools is not installed. See the "Windows Build Requirements" section above.

### `npm run tauri dev` connection error

The Tauri window may be opening before the Vite dev server has started. Try running `npm run dev` in a separate terminal first, then run `npm run tauri dev`.

### Ollama connection error

Make sure the Ollama server is running:

```bash
ollama serve    # Start the server
ollama list     # List installed models
```

The default port is `11434`. If you are using a different port, update it in the app's AI settings.

### WASM memory error (large databases)

On large archives with many scanned files, the browser may hit its memory limit. Running in Tauri native mode mitigates this issue.

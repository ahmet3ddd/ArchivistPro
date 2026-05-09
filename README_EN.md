# ArchivistPro

**Architectural file archive and intelligent search application**
DWG · MAX · IFC · RVT · SKP · PDF and 95+ format support

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.4.5-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

> **[Turkce README](README.md)**

---

## What is ArchivistPro?

A fully offline desktop archive management application for architecture offices. Built with **Tauri v2 (Rust) + React 19 (TypeScript) + SQLite (sql.js WASM)**.

All AI features (semantic search, visual search, chat) run **100% locally** — no cloud, no telemetry.

---

## Features

| Area | Description |
|------|-------------|
| **File Scanning** | 95+ formats, SHA-256 deduplication, recursive folder scanning |
| **Previews** | DWG, 3DS MAX, PSD, PDF, Office, video thumbnail generation |
| **Smart Search** | CLIP visual search (text-to-image), semantic text search, query expansion, DWG geometric shape search |
| **Metadata** | DWG binary parse, MAX CFB (layers/objects), RVT, IFC, SKP, EXIF, Office OOXML |
| **Archive Management** | Multiple archives (main + local + extra), `.archivistpro` export/import, LAN sharing server |
| **User Management** | RBAC (admin/viewer), PBKDF2-SHA256 authentication |
| **AI Chat (RAG)** | Offline Q&A over archive files (Ollama), multi-document synthesis, Markdown export |
| **AI Assistants** | Automatic tag suggestions, AI Setup Wizard, Ollama start/stop |
| **Project Tracking** | Client name, approval status, version tag, delivery date tracking |
| **File Relations** | DWG-PDF, Model-Render auto-detection, manual linking |
| **UX** | Context menus, undo/redo (for destructive operations) |
| **Languages** | 5 languages: Turkish, English, Chinese, Japanese, Arabic |

---

## Requirements

- **OS:** Windows 10/11 (64-bit)
- **Node.js:** 20+
- **Rust:** 1.77.2+
- **Ollama:** (optional, for AI features) — [ollama.com](https://ollama.com)

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (Tauri + Vite HMR)
npm run tauri dev

# Frontend only (no Tauri)
npm run dev

# Production build
npm run tauri build
```

### Feature Flags (Rust)

```bash
npm run build:admin    # Admin build (default, full features)
npm run build:viewer   # Viewer-only build (restricted)
```

---

## Architecture

```
Frontend (React 19 + TypeScript + Vite)
    |
    +-- Zustand store (global state)
    +-- sql.js WASM (SQLite in-memory + disk sync, 25 tables)
    +-- Transformers.js (MiniLM 384-dim + CLIP 512-dim embedding)
    +-- Tauri IPC --> Rust Backend (134 commands, 28 modules)
                        +-- thumbnail generation (image, DWG, MAX, PDF, Office...)
                        +-- file system operations
                        +-- Ollama proxy (SSRF protected)
                        +-- LAN HTTP server (tiny_http, port 9471)
                        +-- crash log writing
```

---

## AI Features

All AI operations are **fully local** — no cloud connection required.

| Feature | Description | Requirement |
|---------|-------------|-------------|
| **Semantic Text Search** | MiniLM multilingual 384-dim embedding | Bundled (no setup) |
| **Visual Search (CLIP)** | Find images from text queries, 512-dim | Bundled (no setup) |
| **AI Chat (RAG)** | Q&A over archive files, multi-doc synthesis | Ollama + model |
| **AI Tag Suggestions** | Auto-generate tags from file content | Ollama + model |
| **DWG Shape Search** | Geometric shape-based CAD search | Bundled |

Ollama is **optional**: scanning, search, and metadata features work without it.

---

## Supported Formats (selection)

| Category | Formats |
|----------|---------|
| **CAD/BIM** | DWG · DXF · DWF · IFC · RVT · RFA · NWD · NWC · 3DM |
| **3D** | MAX · MB · FBX · OBJ · SKP · BLEND · 3DS · C4D · STL |
| **Documents** | PDF · DOCX · XLSX · PPTX · DOC · XLS · PPT |
| **Images** | PSD · AI · EPS · SVG · PNG · JPG · TIFF · RAW |
| **Video** | MP4 · MOV · AVI · MKV · WMV |

---

## Security

- Authentication: PBKDF2-SHA256 (100,000 iterations, 16-byte salt)
- Path traversal: dual-layer protection (literal + canonicalize)
- SSRF protection: Ollama proxy allowlist
- XSS protection: escapeHtml + DOMPurify + React JSX
- RBAC: admin / viewer roles with Rust-side enforcement

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## Testing

```bash
npm test              # Unit tests
npm test -- --watch   # Watch mode
npm test -- --coverage # Coverage report
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) (c) 2026 ArchivistPro

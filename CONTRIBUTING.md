# Contributing to ArchivistPro

Thank you for your interest in contributing! This guide will help you get started.

> **Note:** As of v3.3.x this repository contains the **new-generation codebase**
> (Rust-owned data layer + native SQLite). The legacy 3.2.x source tree is
> preserved under the `legacy-h2-final` git tag.

## Getting Started

### Prerequisites

- **Windows 10/11** (64-bit)
- **Node.js** 20+
- **Rust** (stable toolchain)
- **WebView2 Runtime** (preinstalled on most Windows systems)
- **Ollama** (optional, for AI chat features) — [ollama.com](https://ollama.com)

### Setup

```bash
git clone https://github.com/ahmet3ddd/ArchivistPro.git
cd ArchivistPro
npm install
npm run tauri dev
```

The first Rust build compiles the whole workspace and takes a while; it is cached afterwards.

## Development

```bash
npm run dev           # Frontend only (port 5173)
npm run tauri dev     # Full app (Tauri + Vite HMR)
npx tsc --noEmit      # TypeScript type check
cargo check --workspace   # Rust check
```

### Project Structure

| Directory | Description |
|-----------|-------------|
| `src/` | React 19 + TypeScript frontend (feature-based modules, query-hook layer) |
| `crates/` | Rust workspace: data layer, ingest, extractors, embeddings, import |
| `crates/archivist-db/` | SQLite schema, versioned migrations, queries, FTS, vectors |
| `src-tauri/` | Tauri shell: commands, RBAC, job queue |
| `e2e/` | Playwright end-to-end tests |
| `docs/` | Documentation — see [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) |

## Testing

```bash
npm test                  # Vitest (frontend)
cargo test --workspace    # All Rust tests
cargo test -p archivist-db  # Data layer only (the most critical layer)
cargo clippy --workspace --all-targets -- -D warnings  # Lint (zero warnings expected)
npm run test:e2e          # Playwright E2E
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Write tests** for new functionality — data/migration changes always need tests
3. **Run the full test suite** before submitting: `npm test` and `cargo test --workspace`
4. **Run type checks**: `npx tsc --noEmit`
5. **Keep PRs focused** — one feature or fix per PR
6. **Write clear commit messages** describing the "why"

### Conventions

- **UI text** must use i18n: `t('key')` — update at least `tr` + `en` (5 languages total)
- **New Tauri commands**: add `#[tauri::command]` in Rust + register in `src-tauri/src/lib.rs`; real permission checks live in the Rust command (RBAC), frontend checks only hide UI
- **Schema changes**: add a **versioned, forward-only migration** in `crates/archivist-db` with tests
- **Components/modules over ~500 lines** get split (pure refactor, separate commit)

## Reporting Issues

- Use [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- Include OS version, app version (shown in the top bar and Settings → General), and steps to reproduce
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

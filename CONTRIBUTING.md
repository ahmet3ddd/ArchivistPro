# Contributing to ArchivistPro

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- **Windows 10/11** (64-bit)
- **Node.js** 20+
- **Rust** 1.77.2+
- **Ollama** (optional, for AI chat features) — [ollama.com](https://ollama.com)

### Setup

```bash
git clone https://github.com/ahmet3ddd/ArchivistPro.git
cd Arsiv-H2
npm install
npm run tauri dev
```

The first Rust build may take ~3 minutes (cached afterwards).

### Environment

Copy the example environment file:

```bash
cp .env.example .env
```

## Development

```bash
npm run dev           # Frontend only (port 5173)
npm run tauri dev     # Full app (Tauri + Vite HMR)
npx tsc --noEmit      # TypeScript type check
cargo check --manifest-path src-tauri/Cargo.toml  # Rust check
```

### Project Structure

| Directory | Description |
|-----------|-------------|
| `src/` | React 19 + TypeScript frontend |
| `src/components/` | UI components (~99) |
| `src/services/` | Business logic services (~53) |
| `src/store/` | Zustand global state |
| `src-tauri/src/` | Rust backend (~28 modules, 134 Tauri commands) |
| `docs/` | Documentation |

## Testing

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm test -- --coverage # Coverage report
npm run lint          # ESLint
```

Current stats: 2038 tests, coverage ~64% stmt / ~79% functions.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Write tests** for new functionality
3. **Run the full test suite** before submitting: `npm test`
4. **Run type checks**: `npx tsc --noEmit`
5. **Keep PRs focused** — one feature or fix per PR
6. **Write clear commit messages** describing the "why"

### Conventions

- **UI text** must use i18n: `t('key')` — update at least `tr.json` + `en.json`
- **New Tauri commands**: add `#[tauri::command]` in Rust + register in `lib.rs`
- **New DB tables**: add in `database.ts` → `_applySchema()`
- **Admin-only features**: use `require_admin()` (Rust) and `<ProtectedAction>` (React)

## Reporting Issues

- Use [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- Include OS version, app version, and steps to reproduce
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

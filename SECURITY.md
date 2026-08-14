# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ArchivistPro, please report it responsibly.

**Email:** Open a [GitHub Security Advisory](https://github.com/ahmet3ddd/ArchivistPro/security/advisories/new) (preferred) or create a private issue.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within **48 hours** and aim to release a fix within **7 days** for critical issues.

## Scope

The following are in scope:
- Authentication and authorization bypass
- SQL injection (sql.js / rusqlite)
- Path traversal in file operations
- XSS in rendered content
- SSRF via Ollama proxy
- LAN server security (port 9471)

The following are **out of scope**:
- Vulnerabilities in third-party dependencies (report upstream)
- Issues requiring physical access to the machine
- Social engineering

## Security Architecture

ArchivistPro is designed as an **offline-first desktop application**. Key security measures:

- **Authentication:** PBKDF2-SHA256 (100,000 iterations, 16-byte salt)
- **Path Traversal:** Dual-layer protection (literal check + canonicalize)
- **SSRF:** Ollama proxy with strict allowlist
- **XSS:** escapeHtml + DOMPurify + React JSX auto-escaping
- **RBAC:** Admin / Viewer roles with Rust-side enforcement
- **No Cloud:** All data stays local; no telemetry, no external calls (except optional Ollama)

For detailed security documentation, see:
- [docs/GUVENLIK.md](docs/GUVENLIK.md) (Turkish)
- [docs/VERI_GUVENLIGI.md](docs/VERI_GUVENLIGI.md) (Turkish)

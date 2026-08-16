# ArchivistPro — Installation Guide for System Administrators

> **Version:** 3.5.0 · **Updated:** 2026-08-16 · **Platform:** Windows 10/11 (64-bit)
>
> For a step-by-step walkthrough see the **[beginner's guide](INSTALL_BEGINNER_EN.md)**.

## 1. Summary

```powershell
# Per-user, unattended (recommended):
ArchivistPro_3.5.0_x64-setup.exe /S

# Machine-level (deliberate choice — read the table below):
msiexec /i ArchivistPro_3.5.0_x64_en-US.msi /qn
```

Core usage (scanning, FTS search, previews, duplicate finder) runs **fully
offline from a single exe**; AI components are optional (§7).

## 2. Package types — NSIS and MSI are not the same thing

| | **NSIS `setup.exe` (recommended)** | MSI |
|---|---|---|
| Install level | Per-user (no admin rights needed) | Machine (`Program Files`) |
| Location | `%LOCALAPPDATA%\ArchivistPro` | `C:\Program Files\ArchivistPro` |
| 3.3.x upgrades | **In place** | Installs as a separate product |
| Silent switch | `/S` | `/qn` |

> ⚠️ Installing both setup.exe and the MSI on one machine leaves **two
> independent copies** side by side. Pick one type and stay with it.

The packages are not code-signed; a SmartScreen warning on first run is expected
("More info → Run anyway"). For managed rollouts verify the SHA-256 hashes from
the release page.

## 3. Prerequisites

| Component | Note |
|---|---|
| **WebView2 Runtime** | The only hard requirement. Usually present on current Win10/11; setup.exe downloads it if missing. For offline machines pre-install the [standalone installer](https://go.microsoft.com/fwlink/?linkid=2124701). |
| **VC++ Redistributable x64** | Present on most machines. On a "VCRUNTIME140.dll not found" error install [vc_redist.x64.exe](https://aka.ms/vs/17/release/vc_redist.x64.exe). |

## 4. Locations

| What | Where |
|---|---|
| Application (NSIS) | `%LOCALAPPDATA%\ArchivistPro` |
| **Archive database** | `%APPDATA%\com.archivistpro.h3\` |
| AI models (ONNX) | `%LOCALAPPDATA%\com.archivistpro.h3\models` |

- Uninstalling does **not** delete data: the archive stays under `%APPDATA%`;
  a reinstall continues where it left off.
- Backups: in-app via **Settings → Backups** (automatic backups are also taken
  before critical operations). For file-level backup, copying
  `%APPDATA%\com.archivistpro.h3\` (with the app closed) is sufficient.

## 5. Multi-user and roles

- On first launch the **first administrator account** is created (password ≥ 6
  characters, stored strictly locally — there is no recovery email; if the only
  admin password is lost there is no recovery path).
- Additional accounts via **Settings → Users**; roles are enforced with real
  permission checks (including a view-only role). Write permissions are checked
  at the command level, not just hidden in the UI.
- Sessions **lock** after inactivity; the lock screen allows switching users.

## 6. Migrating from the legacy generation (3.2.2 and earlier)

3.3.x uses a **different application identity**: it is NOT an in-place upgrade
of 3.2.2 — it installs side by side and keeps separate data folders.

1. **Do not uninstall** the old version or delete its data (until the import is
   verified).
2. In the new version: **Settings → General → "Previous version found"** card →
   **"Import data from previous version"**.
3. The wizard lists discovered archives (the one labeled 'main' and largest is
   usually the real one). **"Dry run"** writes nothing and shows the exact
   outcome.
4. **Import**: an automatic backup is taken first; the operation is
   **idempotent** — interrupting or re-running it never touches existing records
   (they count as "already present").
   - Migrated: file records, AI analyses, tags, favorites, collections, folder
     roots (+ optionally trash records and temporary thumbnails).
   - Not migrated: user passwords (different hashing) and chat history.
5. After the import, **re-scan the roots** (content text/fingerprints/previews
   are produced by scanning; migrated AI analyses and tags are preserved).

## 7. AI components (optional) and offline deployment

Without AI, scanning/search/previews are fully functional. On AI machines:

1. **Search models (ONNX, fully offline):** import from a folder via
   **Settings → AI → AI Setup Wizard → Search models**. Expected three model
   directories:
   `paraphrase-multilingual-MiniLM-L12-v2` (text) ·
   `clip-vit-base-patch32` · `clip-ViT-B-32-multilingual-v1` (visual).
   They can be copied from an existing install:
   `%LOCALAPPDATA%\com.archivistpro.h3\models`.
2. **Chat + vision analysis:** install [Ollama](https://ollama.com).
   - Vision model with internet: `ollama pull qwen2.5vl:3b`
   - Offline: merge-copy another machine's `%USERPROFILE%\.ollama\models` into
     the target machine.
3. **Verification:** **Settings → AI → Setup check** measures GPU, Ollama,
   vision-model and search-model status per machine; then run a real test.
4. GPU note: an NVIDIA GPU significantly speeds up vision analysis; CPU works
   too (slowly). An **outdated NVIDIA driver** can break Ollama's GPU path —
   the fix is a driver update, not a hardware change.

## 8. DWG deep metadata (optional, recommended)

If **ODA File Converter** is installed, the app detects it automatically (no
configuration) and DWG layer/block extraction gets richer. Without it the
built-in pure-Rust DWG parser stays active (basic info still extracted).
Download from the ODA website (free, requires registration).

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| SmartScreen block | "More info → Run anyway"; verify SHA-256 in managed environments |
| `VCRUNTIME140.dll not found` | Install vc_redist.x64.exe (§3) |
| Blank/white window | WebView2 Runtime missing — install the standalone installer (§3) |
| Ollama GPU error (`unsupported PTX toolchain` etc.) | Update the NVIDIA driver |
| Two ArchivistPro copies visible | Both MSI and setup.exe installed — remove one (data lives in `%APPDATA%`, it is not deleted) |

## 10. Upgrade and uninstall

- **3.3.x → 3.3.y:** the new `setup.exe` upgrades in place (close the app first).
- **Uninstall:** via Settings → Apps; archive data is preserved under
  `%APPDATA%`. To remove data too, delete `%APPDATA%\com.archivistpro.h3\`
  manually.

---

- Release notes: [CHANGELOG](../CHANGELOG.md) · Issues:
  [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- Source code: https://github.com/ahmet3ddd/ArchivistPro

*Last update: 2026-08-16 (v3.5.0).*

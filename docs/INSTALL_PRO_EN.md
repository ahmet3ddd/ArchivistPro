# ArchivistPro — Installation Guide (Professional / System Admin)

> **Version:** 3.0.0 | **Date:** 2026-05-23 | **Platform:** Windows 10/11 (64-bit)
>
> This guide is for system administrators, IT professionals, and people
> who deploy to multiple workstations. Covers silent install, network
> deployment, environment variables, and file locations.
>
> For an end-user oriented guide, see
> **[Beginner Install Guide](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_BEGINNER_EN.md)**.

---

## 1. System Requirements

| Requirement | Minimum | Recommended | Constraint |
|---|---|---|---|
| OS | Windows 10 1809+ (64-bit) | Windows 11 22H2+ | x86/ARM not supported |
| CPU | x64 (SSE4.2) | 4+ cores, AVX2 | — |
| RAM | 4 GB | 8 GB+ (16 GB for AI) | sql.js DB loaded fully into RAM |
| Disk | 2 GB | 5 GB+ SSD | NVMe recommended (parallel scan) |
| WebView2 | Edge runtime embedded | — | `offlineInstaller` mode in MSI |
| GPU (optional) | — | WebGPU-capable | Embedding 5-10× faster |

### Dependencies

- **WebView2 Runtime** — bundled inside the MSI in `offlineInstaller`
  mode; no separate install needed
  (`tauri.conf.json` → `windows.webviewInstallMode`).
- **VC++ Redistributable** — DLLs needed by the Tauri runtime are
  bundled with the MSI.
- **Ollama** (optional) — required for AI Chat; from `https://ollama.com`
  or silent: `winget install Ollama.Ollama --silent`.
- **ODA File Converter** (optional) — for DWG advanced metadata;
  installable with one click from inside the app.

---

## 2. Silent Install

### With MSI

```cmd
:: Default install, log to file
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet /norestart /log install.log

:: Custom target location
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi INSTALLDIR="D:\Apps\ArchivistPro" /quiet

:: Per-machine install (all users)
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi ALLUSERS=1 /quiet

:: Suppress reboot for testing
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet REBOOT=ReallySuppress
```

### With NSIS (.exe)

```cmd
:: Silent install
ArchivistPro_3.0.0_x64-setup.exe /S

:: Custom target
ArchivistPro_3.0.0_x64-setup.exe /S /D=C:\Apps\ArchivistPro
```

> **Note:** For the NSIS version, the `/D=` parameter must be the
> **last** argument and **must not be quoted** (NSIS requirement).

### MSI Parameters

| Parameter | Meaning | Default |
|---|---|---|
| `/quiet` or `/qn` | Fully silent, no UI | — |
| `/passive` or `/qb` | Progress bar, no interaction | — |
| `/norestart` | Do not trigger reboot | — |
| `/log <path>` | Detailed log | — |
| `INSTALLDIR=<path>` | Installation target folder | `C:\Program Files\ArchivistPro` |
| `ALLUSERS=1` | Per-machine installation | per-user |

---

## 3. Deployment Methods

### 3.1. Group Policy (GPO)

For multi-machine deployment in Active Directory:

1. Copy the MSI to a network share
   (`\\fileserver\deploy\ArchivistPro\`).
2. **Group Policy Management** → relevant OU → **Computer Configuration
   → Policies → Software Settings → Software Installation** → New
   package.
3. Choose package type: **Assigned** (automatic install).
4. Enter the UNC path:
   `\\fileserver\deploy\ArchivistPro\ArchivistPro_3.0.0_x64_en-US.msi`.
5. Computers in the target OU install automatically after restart.

### 3.2. Intune / MEM (Microsoft Endpoint Manager)

1. Intune Console → **Apps → Windows → Add** → **Line-of-business
   app**.
2. Upload the MSI file.
3. Assignment: choose the required user group / device group.

### 3.3. PSExec / RemoteSigning

```powershell
# Single line, over network
$cred = Get-Credential
Invoke-Command -ComputerName PC01,PC02,PC03 -Credential $cred -ScriptBlock {
    Start-Process msiexec.exe -ArgumentList '/i \\fileserver\deploy\ArchivistPro_3.0.0.msi /quiet' -Wait
}
```

### 3.4. Chocolatey / Winget (Future)

> Chocolatey and Winget packages are not yet published. Planned for
> the v3.x cycle.

---

## 4. File Locations

### Installed (read-only)

| Location | Contents |
|---|---|
| `%ProgramFiles%\ArchivistPro\` | App binary + WebView2 + locales |
| `%ProgramFiles%\ArchivistPro\ArchivistPro.exe` | Main executable |
| `%ProgramFiles%\ArchivistPro\resources\` | Bundled AI models, icons |

### User Data (read/write — per user)

| Location | Contents |
|---|---|
| `%APPDATA%\com.archivistpro.desktop\` | Main data folder |
| `%APPDATA%\com.archivistpro.desktop\archivist.db` | Main DB (metadata, tags) |
| `%APPDATA%\com.archivistpro.desktop\archivist_vec.db` | Vector DB (v3.0.0+) |
| `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | Local archive |
| `%APPDATA%\com.archivistpro.desktop\recovery.key` | Password recovery key |
| `%APPDATA%\com.archivistpro.desktop\backups\` | Auto DB snapshots (last 5) |
| `%APPDATA%\com.archivistpro.desktop\backups-local\` | Local DB snapshots |
| `%APPDATA%\com.archivistpro.desktop\logs\` | System log files (7-day rotation) |
| `%LOCALAPPDATA%\com.archivistpro.desktop\` | Cache, session data (WebView2) |

### Registry

| Path | Contents |
|---|---|
| `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.archivistpro.desktop` | Uninstall info (MSI) |
| `HKCU\Software\ArchivistPro\` | (not used — all config in DB) |

---

## 5. Environment Variables

ArchivistPro behavior can be tuned via these environment variables
(most optional; defaults are tuned for production):

| Variable | Values | Default | Description |
|---|---|---|---|
| `ARCHIVIST_DB_JOURNAL` | `wal` / `delete` | `wal` | SQLite journal mode. Network share auto-falls back to DELETE. |
| `ARCHIVIST_V3_EPOCH` | `on` / `off` | `on` | V3 architecture toggle. localStorage flag — set only in-app. |
| `RUST_LOG` | `info` / `debug` / `trace` | (unset) | Rust-side log level. `debug` for deep analysis. |
| `ARCHIVIST_DATA_DIR` | Full path | `%APPDATA%\com.archivistpro.desktop` | Move data folder (test/portable mode). |

### Examples

```cmd
:: Disable WAL when working on a network share
setx ARCHIVIST_DB_JOURNAL delete

:: Verbose logging
setx RUST_LOG debug

:: Move data folder to D:
setx ARCHIVIST_DATA_DIR "D:\ArchivistData"
```

---

## 6. Network and Security

### 6.1. Open Ports

| Port | Direction | Use | Default |
|---|---|---|---|
| 9471 | Inbound (admin) / Outbound (viewer) | LAN mini HTTP server (archive sharing) | Closed (admin opens it) |
| 11434 | Outbound (localhost) | Ollama API (for AI Chat) | localhost only |

Firewall rule (only if LAN server will be used):

```cmd
netsh advfirewall firewall add rule name="ArchivistPro LAN" ^
  dir=in action=allow protocol=TCP localport=9471 remoteip=LocalSubnet
```

### 6.2. Antivirus Whitelist

Some enterprise AV products may flag ArchivistPro's file scanning
(opens many files in a short time). Suggested exceptions:

- **Folder:** `C:\Program Files\ArchivistPro\`
- **Process:** `ArchivistPro.exe`
- **Folder (data):** `%APPDATA%\com.archivistpro.desktop\`

### 6.3. CSP (Content Security Policy)

Strict in-app CSP, `default-src 'self'` based. Network calls allowed
only to:

- `http://localhost:11434` (Ollama API)
- `http://localhost:9471` (LAN server)
- `https://asset.localhost` (Tauri asset protocol)

No external CDN, tracking, or telemetry calls.

### 6.4. Tauri Capabilities

The `src-tauri/capabilities/*.json` files define permitted Rust
commands:

- `desktop.json` — desktop-specific commands
- `viewer.json` — subset accessible to the viewer role
- `admin.json` — admin-only commands

Role-isolated executables are produced at build time
(`--mode admin` / `--mode viewer`) — admin commands are physically
absent from the viewer binary.

---

## 7. V3 Migration (3.0.0 New)

When upgrading from v2.4.x to v3.0.0, the archive is automatically
migrated to the V3 schema.

### 7.1. Flow

1. Application starts.
2. `PRAGMA user_version` is read; if `< 3`, migration triggers.
3. Backup `archivist_premigrate_v3.db.bak` is created.
4. Staged migration: epoch 0 → 1 (embeddings) → 2 (text_chunks + FTS) →
   3 (asset_relations).
5. Each stage is verified by round-trip.
6. Finalize: Rust-side `DROP × 3 + VACUUM + user_version = 3` atomic.
7. `reloadDatabase` syncs the app frontend to the new state.

### 7.2. Manual Trigger (Admin)

The **Settings → Storage → V3 Schema Migration** panel can trigger
manually. If admin control is preferred, disable the automatic trigger
with `ARCHIVIST_V3_EPOCH=off`, then start manually from the panel.

### 7.3. Bulk Deployment — Migration Strategy

For admins managing many legacy installs centrally:

1. **Pilot group:** Test the manual migration on 1-2 machines first.
2. **Roll out:** If the pilot succeeds, the auto-migration default is
   safe (no user action needed; runs on first launch).
3. **Backup:** Before migration, a PowerShell script can mirror all
   user data folders to network storage:

```powershell
$users = Get-ChildItem "C:\Users" -Directory
foreach ($u in $users) {
    $src = "C:\Users\$($u.Name)\AppData\Roaming\com.archivistpro.desktop"
    if (Test-Path $src) {
        $dst = "\\backupserver\archivistpro-pre-v3\$($u.Name)\$(Get-Date -Format 'yyyyMMdd')"
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item $src $dst -Recurse -Force
    }
}
```

### 7.4. Rollback

If something is wrong after migration:

```cmd
:: Close the app, then
cd %APPDATA%\com.archivistpro.desktop
ren archivist.db archivist_v3_attempt.db
ren archivist_vec.db archivist_vec_attempt.db
ren archivist_premigrate_v3.db.bak archivist.db
:: Open the app — it returns to the old (epoch=0) state
```

---

## 8. Performance Tuning

### 8.1. Scan Worker Count

Set via `Settings → Storage → Multi-core Scanning`.

| Storage | Recommended Workers |
|---|---|
| HDD | 1-2 |
| SATA SSD | 3-4 |
| NVMe (≤8 cores) | 6-8 |
| NVMe (≥16 cores) | 10-16 |

The default is auto-detected from hardware on first launch.

### 8.2. AI (Embedding) — WebGPU vs WASM

On WebGPU-capable GPUs, embedding is 5-10× faster. Browser auto-selects;
manual override via `Settings → AI → Backend`.

### 8.3. Disk I/O

- Main DB and `vec.db` **must live on the same SSD** — splitting them
  across disks defeats the shared write lock.
- Real-time antivirus scanning of `archivist.db` and `archivist_vec.db`
  drops performance — add to AV exception list.

---

## 9. Monitoring and Troubleshooting

### 9.1. Log Locations

```
%APPDATA%\com.archivistpro.desktop\logs\
├── system.log          (current — Rust tracing)
├── system.log.1        (previous day)
├── ...
└── system.log.6        (7 days ago — then rotated)
```

In-app audit log:
**Settings → Logs → Audit Log Viewer**

### 9.2. Crash Reports

```
%APPDATA%\com.archivistpro.desktop\crashes\
└── crash_<timestamp>.txt
```

Admin-only access
(**Settings → Developer → Crash Reports**).

### 9.3. Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| MSI install "1603" | WebView2 runtime missing or broken | Install WebView2 manually from Microsoft, then retry MSI |
| "DB error" on first launch | Corrupt DB from old version | Restore from `recovery.key` backup or recreate DB |
| AI Chat "Ollama not found" | Ollama service down | Run `ollama serve` or click **Start** in AI Settings |
| Scan very slow | HDD + high worker count | Drop workers to 1-2 |
| `disk-write-failed` | Disk full or no permission | Check writes to `%APPDATA%` and free space |
| UNC archive lock errors | WAL unsafe on network | Force `ARCHIVIST_DB_JOURNAL=delete` |

---

## 10. Uninstall

### Single Machine

```cmd
:: If installed via MSI
wmic product where name="ArchivistPro" call uninstall /nointeractive

:: Or by GUID (msiexec)
msiexec /x {ARCHIVISTPRO-PRODUCT-GUID} /quiet /norestart
```

### User Data Cleanup

Uninstall **does not delete user data** — intentional to prevent data
loss. For a full wipe:

```cmd
rmdir /s /q "%APPDATA%\com.archivistpro.desktop"
rmdir /s /q "%LOCALAPPDATA%\com.archivistpro.desktop"
```

### Bulk Uninstall (via GPO)

1. Group Policy → mark the Software Installation package as **Remove**.
2. Target machines auto-uninstall after restart.

---

## 11. Version Management and Updates

### Automatic Updates

> The in-app auto-updater is **planned** with v3.0.0. Currently
> updates are manual.

### Manual Update

1. Download the new MSI from GitHub Releases.
2. Install the new MSI over the existing one — MSI supports in-place
   upgrade, user data is preserved.
3. On first launch, any new migration runs automatically.

---

## 12. License and Legal

- **License:** MIT (see `LICENSE` at the repo root)
- **Source code:** https://github.com/ahmet3ddd/Arsiv-H2
- **Liability:** Software is provided "as is" without warranty.
  Validate with a test group before production deployment.
- **Telemetry:** None. No usage data is collected; nothing is sent to
  any server.

---

## 13. Support and Feedback

- **GitHub Issues:** https://github.com/ahmet3ddd/Arsiv-H2/issues
- **In-app:** **Settings → Developer → "Send Feedback to Developer"**
  (crash dump auto-attached, optional).

---

*This guide is updated as the program evolves. Last update: 2026-05-23 (v3.0.0).*

# ArchivistPro — 安装指南 (专业 / 系统管理员)

> **版本:** 3.0.0 | **日期:** 2026-05-23 | **平台:** Windows 10/11 (64-bit)
>
> 本指南面向系统管理员、IT 专业人员和部署到多个工作站的人员。涵盖静默安装、网络部署、环境变量和文件位置。
>
> 面向最终用户的指南，请参阅 **[初学者安装指南](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_BEGINNER_ZH.md)**。

---

## 1. 系统要求

| 要求 | 最低 | 推荐 | 约束 |
|---|---|---|---|
| 操作系统 | Windows 10 1809+ (64-bit) | Windows 11 22H2+ | 不支持 x86/ARM |
| CPU | x64 (SSE4.2) | 4 核以上，AVX2 | — |
| 内存 | 4 GB | 8 GB+ (AI 需 16 GB) | sql.js 将 DB 完全加载到 RAM |
| 磁盘 | 2 GB | 5 GB+ SSD | 推荐 NVMe (并行扫描) |
| WebView2 | 嵌入 Edge runtime | — | MSI 中的 `offlineInstaller` 模式 |
| GPU (可选) | — | 支持 WebGPU | embedding 快 5-10 倍 |

### 依赖项

- **WebView2 Runtime** — 嵌入在 MSI 的 `offlineInstaller` 模式中；无需单独安装 (`tauri.conf.json` → `windows.webviewInstallMode`)
- **VC++ Redistributable** — Tauri runtime 所需的 DLL 与 MSI 一起捆绑
- **Ollama** (可选) — AI Chat 需要；从 `https://ollama.com` 或静默: `winget install Ollama.Ollama --silent`
- **ODA File Converter** (可选) — 用于 DWG 高级元数据；可从应用内一键安装

---

## 2. 静默安装

### 使用 MSI

```cmd
:: 默认安装，日志写入文件
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet /norestart /log install.log

:: 自定义目标位置
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi INSTALLDIR="D:\Apps\ArchivistPro" /quiet

:: 安装到所有用户 (每台机器)
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi ALLUSERS=1 /quiet

:: 测试时禁止重启
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet REBOOT=ReallySuppress
```

### 使用 NSIS (.exe)

```cmd
:: 静默安装
ArchivistPro_3.0.0_x64-setup.exe /S

:: 自定义目标
ArchivistPro_3.0.0_x64-setup.exe /S /D=C:\Apps\ArchivistPro
```

> **注:** 对于 NSIS 版本，`/D=` 参数必须是**最后**一个参数且**不能加引号** (NSIS 要求)。

### MSI 参数

| 参数 | 含义 | 默认 |
|---|---|---|
| `/quiet` 或 `/qn` | 完全静默，无 UI | — |
| `/passive` 或 `/qb` | 进度条，无交互 | — |
| `/norestart` | 不触发重启 | — |
| `/log <path>` | 详细日志 | — |
| `INSTALLDIR=<path>` | 安装目标文件夹 | `C:\Program Files\ArchivistPro` |
| `ALLUSERS=1` | 每台机器安装 | 每用户 |

---

## 3. 部署方法

### 3.1. Group Policy (GPO)

在 Active Directory 环境中部署多台机器:

1. 将 MSI 复制到网络共享 (`\\fileserver\deploy\ArchivistPro\`)
2. **Group Policy Management** → 相关 OU → **Computer Configuration → Policies → Software Settings → Software Installation** → 新包
3. 包类型: 选择 **Assigned** (自动安装)
4. 输入 UNC 路径: `\\fileserver\deploy\ArchivistPro\ArchivistPro_3.0.0_x64_en-US.msi`
5. 目标 OU 中的机器在重启后自动安装

### 3.2. Intune / MEM (Microsoft Endpoint Manager)

1. Intune Console → **Apps → Windows → Add** → **Line-of-business app**
2. 上传 MSI 文件
3. 分配: 选择所需的用户组 / 设备组

### 3.3. PSExec / RemoteSigning

```powershell
# 单行，通过网络
$cred = Get-Credential
Invoke-Command -ComputerName PC01,PC02,PC03 -Credential $cred -ScriptBlock {
    Start-Process msiexec.exe -ArgumentList '/i \\fileserver\deploy\ArchivistPro_3.0.0.msi /quiet' -Wait
}
```

### 3.4. Chocolatey / Winget (未来)

> Chocolatey 和 Winget 包尚未发布。计划在 v3.x 周期中添加。

---

## 4. 文件位置

### 已安装 (只读)

| 位置 | 内容 |
|---|---|
| `%ProgramFiles%\ArchivistPro\` | 应用二进制文件 + WebView2 + locales |
| `%ProgramFiles%\ArchivistPro\ArchivistPro.exe` | 主可执行文件 |
| `%ProgramFiles%\ArchivistPro\resources\` | 捆绑的 AI 模型、图标 |

### 用户数据 (读/写 — 每用户)

| 位置 | 内容 |
|---|---|
| `%APPDATA%\com.archivistpro.desktop\` | 主数据文件夹 |
| `%APPDATA%\com.archivistpro.desktop\archivist.db` | 主 DB (元数据、标签) |
| `%APPDATA%\com.archivistpro.desktop\archivist_vec.db` | 向量 DB (v3.0.0+) |
| `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | 本地档案 |
| `%APPDATA%\com.archivistpro.desktop\recovery.key` | 密码恢复密钥 |
| `%APPDATA%\com.archivistpro.desktop\backups\` | 自动 DB 快照 (最近 5 个) |
| `%APPDATA%\com.archivistpro.desktop\backups-local\` | 本地 DB 快照 |
| `%APPDATA%\com.archivistpro.desktop\logs\` | 系统日志文件 (7 天轮换) |
| `%LOCALAPPDATA%\com.archivistpro.desktop\` | 缓存、会话数据 (WebView2) |

### 注册表

| 路径 | 内容 |
|---|---|
| `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.archivistpro.desktop` | 卸载信息 (MSI) |
| `HKCU\Software\ArchivistPro\` | (未使用 — 所有配置都在 DB 中) |

---

## 5. 环境变量

可以通过这些环境变量调整 ArchivistPro 的行为 (大多数可选；默认值已为生产调整):

| 变量 | 值 | 默认 | 描述 |
|---|---|---|---|
| `ARCHIVIST_DB_JOURNAL` | `wal` / `delete` | `wal` | SQLite journal 模式。检测到网络共享时自动回退到 DELETE。 |
| `ARCHIVIST_V3_EPOCH` | `on` / `off` | `on` | V3 架构切换。localStorage 标志 — 仅在应用内设置。 |
| `RUST_LOG` | `info` / `debug` / `trace` | (未设置) | Rust 端日志级别。`debug` 用于深度分析。 |
| `ARCHIVIST_DATA_DIR` | 完整路径 | `%APPDATA%\com.archivistpro.desktop` | 移动数据文件夹 (测试/便携模式)。 |

### 示例

```cmd
:: 在网络共享上工作时禁用 WAL
setx ARCHIVIST_DB_JOURNAL delete

:: 详细日志
setx RUST_LOG debug

:: 将数据文件夹移至 D:
setx ARCHIVIST_DATA_DIR "D:\ArchivistData"
```

---

## 6. 网络和安全

### 6.1. 开放端口

| 端口 | 方向 | 用途 | 默认 |
|---|---|---|---|
| 9471 | 入 (管理员) / 出 (查看者) | LAN mini HTTP server (档案共享) | 关闭 (管理员打开) |
| 11434 | 出 (localhost) | Ollama API (用于 AI Chat) | 仅 localhost |

防火墙规则 (仅在使用 LAN server 时):

```cmd
netsh advfirewall firewall add rule name="ArchivistPro LAN" ^
  dir=in action=allow protocol=TCP localport=9471 remoteip=LocalSubnet
```

### 6.2. 杀毒软件白名单

某些企业 AV 产品可能会标记 ArchivistPro 的文件扫描 (短时间内打开许多文件)。建议的例外:

- **文件夹:** `C:\Program Files\ArchivistPro\`
- **进程:** `ArchivistPro.exe`
- **文件夹 (数据):** `%APPDATA%\com.archivistpro.desktop\`

### 6.3. CSP (Content Security Policy)

严格的应用内 CSP，基于 `default-src 'self'`。网络调用仅允许到:

- `http://localhost:11434` (Ollama API)
- `http://localhost:9471` (LAN server)
- `https://asset.localhost` (Tauri asset protocol)

无外部 CDN、跟踪或遥测调用。

### 6.4. Tauri Capabilities

`src-tauri/capabilities/*.json` 文件定义允许的 Rust 命令:

- `desktop.json` — 桌面专用命令
- `viewer.json` — viewer 角色可访问的子集
- `admin.json` — 管理员专用命令

在构建时生成角色隔离的可执行文件 (`--mode admin` / `--mode viewer`) — 管理员命令在 viewer 二进制文件中物理上不存在。

---

## 7. V3 迁移 (3.0.0 新功能)

从 v2.4.x 升级到 v3.0.0 时，档案会自动迁移到 V3 架构。

### 7.1. 流程

1. 应用程序启动
2. 读取 `PRAGMA user_version`；如果 `< 3`，触发迁移
3. 创建备份 `archivist_premigrate_v3.db.bak`
4. 分阶段迁移: epoch 0 → 1 (embeddings) → 2 (text_chunks + FTS) → 3 (asset_relations)
5. 每个阶段通过往返验证
6. 完成: Rust 端 `DROP × 3 + VACUUM + user_version = 3` 原子操作
7. `reloadDatabase` 将应用前端同步到新状态

### 7.2. 手动触发 (管理员)

**设置 → 存储 → V3 架构迁移**面板可以手动触发。如果首选管理员控制，请使用 `ARCHIVIST_V3_EPOCH=off` 禁用自动触发，然后从面板手动启动。

### 7.3. 批量部署 — 迁移策略

对于集中管理许多遗留安装的管理员:

1. **试点组:** 首先在 1-2 台机器上测试手动迁移
2. **推出:** 如果试点成功，自动迁移默认值是安全的 (无需用户操作；在首次启动时运行)
3. **备份:** 迁移前，PowerShell 脚本可以将所有用户数据文件夹镜像到网络存储:

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

### 7.4. 回滚

如果迁移后发现问题:

```cmd
:: 关闭应用程序，然后
cd %APPDATA%\com.archivistpro.desktop
ren archivist.db archivist_v3_attempt.db
ren archivist_vec.db archivist_vec_attempt.db
ren archivist_premigrate_v3.db.bak archivist.db
:: 打开应用程序 — 它返回到旧 (epoch=0) 状态
```

---

## 8. 性能调优

### 8.1. 扫描工作进程数

从`设置 → 存储 → 多核扫描`设置。

| 存储 | 推荐工作进程 |
|---|---|
| HDD | 1-2 |
| SATA SSD | 3-4 |
| NVMe (≤8 核) | 6-8 |
| NVMe (≥16 核) | 10-16 |

默认值在首次启动时从硬件自动检测。

### 8.2. AI (Embedding) — WebGPU vs WASM

在支持 WebGPU 的 GPU 上，embedding 快 5-10 倍。浏览器自动选择；手动覆盖通过`设置 → AI → 后端`。

### 8.3. 磁盘 I/O

- 主 DB 和 `vec.db` **必须在同一 SSD 上** — 将它们拆分到不同的磁盘会破坏共享写入锁
- `archivist.db` 和 `archivist_vec.db` 的实时杀毒扫描会降低性能 — 建议添加到 AV 例外列表

---

## 9. 监控和故障排除

### 9.1. 日志位置

```
%APPDATA%\com.archivistpro.desktop\logs\
├── system.log          (当前 — Rust tracing)
├── system.log.1        (前一天)
├── ...
└── system.log.6        (7 天前 — 然后轮换)
```

应用内审计日志: **设置 → 日志 → 审计日志查看器**

### 9.2. 崩溃报告

```
%APPDATA%\com.archivistpro.desktop\crashes\
└── crash_<timestamp>.txt
```

仅管理员可访问 (**设置 → 开发者 → 崩溃报告**)

### 9.3. 常见问题

| 症状 | 可能原因 | 修复 |
|---|---|---|
| MSI 安装 "1603" | WebView2 runtime 缺失或损坏 | 从 Microsoft 手动安装 WebView2，然后重试 MSI |
| 首次启动时 "DB error" | 来自旧版本的损坏 DB | 从 `recovery.key` 备份恢复或重新创建 DB |
| AI Chat "Ollama 未找到" | Ollama 服务关闭 | 运行 `ollama serve` 或在 AI 设置中单击**开始** |
| 扫描非常慢 | HDD + 高工作进程数 | 将工作进程减少到 1-2 |
| `disk-write-failed` | 磁盘已满或没有权限 | 检查对 `%APPDATA%` 的写入权限和可用空间 |
| UNC 档案锁定错误 | WAL 在网络上不安全 | 强制 `ARCHIVIST_DB_JOURNAL=delete` |

---

## 10. 卸载

### 单台机器

```cmd
:: 如果通过 MSI 安装
wmic product where name="ArchivistPro" call uninstall /nointeractive

:: 或通过 GUID (msiexec)
msiexec /x {ARCHIVISTPRO-PRODUCT-GUID} /quiet /norestart
```

### 用户数据清理

卸载**不会删除用户数据** — 故意防止数据丢失。完全擦除:

```cmd
rmdir /s /q "%APPDATA%\com.archivistpro.desktop"
rmdir /s /q "%LOCALAPPDATA%\com.archivistpro.desktop"
```

### 批量卸载 (通过 GPO)

1. Group Policy → 将 Software Installation 包标记为 **Remove**
2. 目标机器在重启后自动卸载

---

## 11. 版本管理和更新

### 自动更新

> 应用内自动更新程序**计划**与 v3.0.0 一起推出。目前更新是手动的。

### 手动更新

1. 从 GitHub Releases 下载新的 MSI
2. 在现有的 MSI 上安装新的 MSI — MSI 支持就地升级，保留用户数据
3. 在首次启动时，任何新的迁移都会自动运行

---

## 12. 许可和法律

- **许可证:** MIT (参阅仓库根目录中的 `LICENSE`)
- **源代码:** https://github.com/ahmet3ddd/Arsiv-H2
- **责任:** 软件按"原样"提供，没有任何保证。在生产部署之前与测试组验证
- **遥测:** 无。不收集使用数据；不向任何服务器发送任何内容

---

## 13. 支持和反馈

- **GitHub Issues:** https://github.com/ahmet3ddd/Arsiv-H2/issues
- **应用内:** **设置 → 开发者 → "向开发者发送反馈"** (崩溃转储自动附加，可选)

---

*本指南随程序发展持续更新。最后更新: 2026-05-23 (v3.0.0)。*

# ArchivistPro — 系统管理员安装指南

> **版本:** 3.5.0 · **更新日期:** 2026-08-16 · **平台:** Windows 10/11 (64 位)
>
> 分步讲解请见 **[新手指南](INSTALL_BEGINNER_ZH.md)**。

## 1. 摘要

```powershell
# 用户级、静默安装（推荐）:
ArchivistPro_3.5.0_x64-setup.exe /S

# 机器级（须明确选择 — 请先读下表）:
msiexec /i ArchivistPro_3.5.0_x64_en-US.msi /qn
```

核心功能（扫描、全文搜索、预览、查重）**单个 exe 完全离线**运行；
AI 组件为可选（§7）。

## 2. 两种安装包 — NSIS 与 MSI 不是一回事

| | **NSIS `setup.exe`（推荐）** | MSI |
|---|---|---|
| 安装级别 | 用户级（无需管理员权限） | 机器级（`Program Files`） |
| 位置 | `%LOCALAPPDATA%\ArchivistPro` | `C:\Program Files\ArchivistPro` |
| 3.3.x 升级 | **原位升级** | 作为独立产品安装 |
| 静默参数 | `/S` | `/qn` |

> ⚠️ 在同一台机器上同时安装两种包会留下**两个互相独立的副本**。
> 请选定一种并坚持使用。

安装包未做代码签名；首次运行的 SmartScreen 警告属预期（「更多信息 → 仍要
运行」）。批量部署时请用发布页的 SHA-256 值校验。

## 3. 先决条件

| 组件 | 说明 |
|---|---|
| **WebView2 Runtime** | 唯一的硬性要求。较新的 Win10/11 通常已有；缺失时 setup.exe 自动下载。离线机器请预装[独立安装包](https://go.microsoft.com/fwlink/?linkid=2124701)。 |
| **VC++ 运行库 x64** | 多数机器已有。出现「找不到 VCRUNTIME140.dll」时安装 [vc_redist.x64.exe](https://aka.ms/vs/17/release/vc_redist.x64.exe)。 |

## 4. 位置

| 内容 | 位置 |
|---|---|
| 应用程序（NSIS） | `%LOCALAPPDATA%\ArchivistPro` |
| **档案数据库** | `%APPDATA%\com.archivistpro.h3\` |
| AI 模型（ONNX） | `%LOCALAPPDATA%\com.archivistpro.h3\models` |

- 卸载**不会删除**数据: 档案保留在 `%APPDATA%` 下；重装后继续使用。
- 备份: 应用内 **设置 → 备份**（关键操作前也会自动备份）。文件级备份只需在
  应用关闭时复制 `%APPDATA%\com.archivistpro.h3\`。

## 5. 多用户与角色

- 首次启动创建**第一个管理员账户**（密码 ≥ 6 字符，仅本地存储 — 没有找回
  邮件；唯一管理员密码丢失即无法恢复）。
- 通过 **设置 → 用户** 添加账户；角色由真实权限校验强制执行（含只读角色），
  写权限在命令层校验而非仅在界面隐藏。
- 空闲后会话**锁定**；锁屏可切换用户。

## 6. 从旧一代 (3.2.2 及更早) 迁移

3.3.x 使用**不同的应用标识**: 不是 3.2.2 的原位升级 — 并列安装、数据目录
各自独立。

1. 在导入确认前**不要卸载**旧版本或删除其数据。
2. 新版本中: **设置 → 常规 → 「发现先前版本」** 卡片 → **「从先前版本导入数据」**。
3. 向导列出发现的档案（带「主」标签且最大的通常是真档案）。**「试运行」**
   不写入任何内容，仅显示准确结果。
4. **导入**: 先自动备份；操作**幂等** — 中断或重复运行都不会触碰已有记录
  （计为「已存在」）。
   - 迁移: 文件记录、AI 分析、标签、收藏、集合、文件夹根（+ 可选的回收站
     记录与临时预览）。
   - 不迁移: 用户密码（哈希方式不同）与聊天记录。
5. 导入后**重新扫描**各根目录（正文文本/指纹/预览由扫描生成；已迁移的 AI
   分析与标签保留）。

## 7. AI 组件（可选）与离线部署

不装 AI 时扫描/搜索/预览完整可用。需要 AI 的机器上:

1. **搜索模型（ONNX，完全离线）:** 通过 **设置 → AI → AI 设置向导 → 搜索
   模型** 从文件夹导入。预期的三个模型目录:
   `paraphrase-multilingual-MiniLM-L12-v2`（文本）·
   `clip-vit-base-patch32` · `clip-ViT-B-32-multilingual-v1`（视觉）。
   可从现有安装复制: `%LOCALAPPDATA%\com.archivistpro.h3\models`。
2. **聊天 + 图像分析:** 安装 [Ollama](https://ollama.com)。
   - 有网络: `ollama pull qwen2.5vl:3b`
   - 离线: 将另一台机器的 `%USERPROFILE%\.ollama\models` 合并复制到目标机器。
3. **验证:** **设置 → AI → 安装检查** 按机器测量 GPU、Ollama、视觉模型与
   搜索模型状态；随后做一次真实测试。
4. GPU 说明: NVIDIA GPU 可显著加速图像分析；纯 CPU 也可运行（较慢）。
   **过旧的 NVIDIA 驱动**可能破坏 Ollama 的 GPU 路径 — 解决办法是更新驱动，
   而非更换硬件。

## 8. DWG 深度元数据（可选，推荐）

安装 **ODA File Converter** 后应用会自动检测（无需配置），DWG 图层/块提取
更丰富。未安装时内置的纯 Rust DWG 解析器仍然工作（基础信息照常提取）。
从 ODA 官网下载（免费，需注册）。

## 9. 故障排查

| 症状 | 处理 |
|---|---|
| SmartScreen 拦截 | 「更多信息 → 仍要运行」；受管环境校验 SHA-256 |
| 找不到 `VCRUNTIME140.dll` | 安装 vc_redist.x64.exe（§3） |
| 空白窗口 | 缺 WebView2 Runtime — 安装独立包（§3） |
| Ollama GPU 报错（`unsupported PTX toolchain` 等） | 更新 NVIDIA 驱动 |
| 出现两个 ArchivistPro | MSI 和 setup.exe 都装了 — 卸载其一（数据在 `%APPDATA%`，不会被删） |

## 10. 升级与卸载

- **3.3.x → 3.3.y:** 运行新的 `setup.exe` 原位升级（先关闭应用）。
- **卸载:** 设置 → 应用；档案数据保留在 `%APPDATA%`。若连数据一并删除，
  请手动删除 `%APPDATA%\com.archivistpro.h3\`。

---

- 版本说明: [CHANGELOG](../CHANGELOG.md) · 问题反馈:
  [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- 源代码: https://github.com/ahmet3ddd/ArchivistPro

*最后更新: 2026-08-16 (v3.5.0)。*

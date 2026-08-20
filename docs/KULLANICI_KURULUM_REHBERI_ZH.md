# ArchivistPro — 安装指南

> **版本:** 3.7.0 · **更新日期:** 2026-08-20 · **平台:** Windows 10/11 (64 位)
>
> 其他语言: [Türkçe](KULLANICI_KURULUM_REHBERI.md) · [English](KULLANICI_KURULUM_REHBERI_EN.md) · [العربية](KULLANICI_KURULUM_REHBERI_AR.md) · [日本語](KULLANICI_KURULUM_REHBERI_JA.md)

本页为快速摘要。分步详细说明请见:
**[新手指南](INSTALL_BEGINNER_ZH.md)** ·
**[系统管理员指南](INSTALL_PRO_ZH.md)**

---

## 快速安装（5 步）

1. **下载:** 打开 [Releases 页面](https://github.com/ahmet3ddd/ArchivistPro/releases/latest)，
   下载 **`ArchivistPro_3.7.0_x64-setup.exe`**（推荐的安装程序；MSI 会在机器级
   安装一个*独立*副本 — 只有明确需要时才使用）。
2. **安装:** 运行下载的文件。如果出现 Windows SmartScreen 警告，点击
   **「更多信息 → 仍要运行」**（安装包未签名，该警告属正常现象）。
3. **首次启动:** 在「初始设置」界面创建第一个管理员 (admin) 账户，然后用它登录。
4. **建立档案库:** 在 **源文件夹 → 添加文件夹** 中指定项目文件夹，点击 **扫描**。
   您的文件不会被移动 — 程序只做索引（可识别 95 种以上格式，包括 DWG、MAX、
   IFC、RVT、SKP、PDF）。
5. **从旧版本迁移?** 如果已安装 ArchivistPro 3.2.2（旧一代），3.7.0 会**并列
   安装**。**请勿卸载**旧版本；通过 **设置 → 常规 → 「发现先前版本」** 卡片中的
   导入向导迁移数据。

**AI 功能（可选）:** 不启用 AI 时，搜索、扫描和预览均完整可用。若需要语义/
视觉搜索和聊天，请使用 **设置 → AI → AI 设置向导**（详见
[新手指南 §8](INSTALL_BEGINNER_ZH.md) 和 [管理员指南](INSTALL_PRO_ZH.md)）。

---

## 链接

- 版本说明: [CHANGELOG](../CHANGELOG.md)
- 报告问题: [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- 路线图: [ROADMAP](ROADMAP.md)

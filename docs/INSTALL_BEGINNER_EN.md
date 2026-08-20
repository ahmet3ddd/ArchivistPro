# ArchivistPro — Installation Guide for Beginners

> **Version:** 3.7.0 · **Updated:** 2026-08-20 · **Platform:** Windows 10/11 (64-bit)
>
> This guide is written step by step for people who don't install software often.
> For a shorter, technical summary see the **[system administrator's guide](INSTALL_PRO_EN.md)**.

## 1. What is ArchivistPro?

A **fully offline** desktop archive manager for architecture and design archives.
It scans your project folders and gives you search by file name and content,
previews, duplicate finding and (optionally) AI-assisted search.
**Your files stay where they are** — the app never moves, copies or uploads them.

## 2. Before you start — requirements

| Requirement | Status |
|---|---|
| Windows 10 or 11 (64-bit) | Required |
| WebView2 Runtime | Usually already present on up-to-date Windows; the installer fetches it if missing |
| Internet | Only for downloading; the app itself works offline |
| Administrator rights | **Not needed** — the app installs into your user account |

## 3. Download

1. Open this address in your browser:
   **https://github.com/ahmet3ddd/ArchivistPro/releases/latest**
2. Under **Assets**, download:
   - **`ArchivistPro_3.7.0_x64-setup.exe`** ← Recommended
   - `ArchivistPro_3.7.0_x64_en-US.msi` ← Alternative (installs a **separate**
     machine-level copy; use only if you know why you want it)
3. The file usually lands in your **Downloads** folder.

> 💡 To verify the download you can compare its SHA-256 hash with the table on
> the release page (optional).

## 4. Install

1. Double-click **`ArchivistPro_3.7.0_x64-setup.exe`**.
2. Windows **SmartScreen** may show a blue warning ("Windows protected your PC").
   This happens because the package is not code-signed and is expected:
   click **"More info"**, then **"Run anyway"**.
3. Follow the setup wizard (the defaults are fine).
4. Installation finishes in seconds and you can start the app.

> ℹ️ When the app opens you'll see the version number (**v3.7.0**) next to the
> title in the top-left corner — a quick way to confirm you installed the right
> version.

## 5. First launch

1. On first launch you'll see the **"Initial setup"** screen: *"Create the first
   administrator (admin) account."* Pick a username and a password (at least 6
   characters) and click **"Create account"**.
   > ⚠️ Write this password down — it is stored only on this computer; there is
   > **no** "forgot my password" email.
2. **Sign in** with the account you just created.
3. A short welcome tour appears. Take the 30-second tour with **Start** or click
   **"Skip tour"** — you can reopen it later from Settings ("Show guide").

## 6. Set up your archive: add a folder and scan

1. Open **Source Folders** from the left rail.
2. Click **"Add folder"** and choose the folder that holds your projects
   (e.g. `D:\Projects`).
3. The app asks **"Scan now?"** — click **Scan**.
   - If **"Auto-assign projects from folders"** is enabled in the scan options,
     first-level folder names under the root become project names (recommended).
4. Scan time depends on archive size (tens of thousands of files → minutes;
   ~100k files → on the order of half an hour). A scan report appears when done.
5. Subsequent scans are **much faster**: unchanged files are skipped.

What gets scanned? **All your files** are archived (except hidden and system
files, which the report lists as "skipped"). **95+ formats** — including DWG,
MAX, IFC, RVT, SKP, PDF, Office and image/video files — are specially
recognized: content text, previews and technical metadata are extracted.

## 7. Coming from the legacy version (3.2.2)?

ArchivistPro 3.2.2 and earlier is the **legacy generation**; 3.7.0 does not
replace it in place — it installs **side by side**. Your data is safe; migrate
like this:

1. ⚠️ **Do NOT uninstall** the old version or delete its data (until the import
   is done and verified).
2. In the new app open **Settings → General**; you'll see the **"Previous
   version found"** card.
3. Click **"Import data from previous version"**. The wizard lists the archive
   files it found — your real archive is usually the one labeled **'main'** and
   the largest.
4. First run **"Dry run (writes nothing)"**: it shows exactly what would happen.
5. Click **"Import"**. An automatic backup is taken first; if the process is
   interrupted, running it again is safe.
   - **Migrated:** file records, AI analyses, tags, favorites, collections, folders.
   - **Not migrated:** user passwords (recreate accounts in the new app) and
     chat history.
6. After the import, **re-scan your folders** — high-quality previews and content
   text are produced by scanning; migrated tags and AI analyses are preserved.

> ℹ️ The card does not disappear after the import (the source data is never
> deleted) — it now shows a **"Last import: …"** line. This does not mean the
> import didn't run.

## 8. AI features (optional)

The app is fully functional without AI: scanning, name/content search, previews
and the duplicate finder all work. Set up AI if you also want:

- **Semantic search** (free-form queries like "timber facade detail") and
  **Visual Search**
- **Chat** (ask questions about your archive) and **vision analysis** (AI tags
  your images)

Setup: **Settings → AI → AI Setup Wizard**

1. **Search models:** imported from a folder (fully offline).
2. **Chat & vision (optional):** requires the free [Ollama](https://ollama.com)
   app. Without Ollama, search still works; only chat and vision stay off.
3. Afterwards, **Settings → AI → Setup check** shows your GPU/Ollama/model
   status.

> 💡 An NVIDIA GPU speeds AI up but is not required. If you have one, keep its
> driver up to date.

## 9. Frequently asked questions

**Are my files copied or moved?**
No. The app only builds an index; your files stay in place. Removing a folder
from the list doesn't delete files either.

**Do I need internet?**
No. Only for downloading (and optionally installing Ollama); daily use is fully
offline. None of your data is sent anywhere.

**How do I update?**
Download and run the new version's `setup.exe` — it upgrades your 3.3.x install
in place; your data is preserved.

**If I uninstall, is my archive deleted?**
No. The archive database stays on disk; reinstalling picks up where you left off.

**I forgot my password — what now?**
Another admin account can reset it. If you are the only admin and the password
is lost, there is no recovery — keep your password somewhere safe.

## 10. Help

- In-app help: the **Help** button on the left rail (press **?** for shortcuts)
- Report an issue: **https://github.com/ahmet3ddd/ArchivistPro/issues**
  ("I didn't understand this screen" is a perfectly valid report)
- Release notes: [CHANGELOG](../CHANGELOG.md)

---

*This guide is updated together with the app. Last update: 2026-08-20 (v3.7.0).*

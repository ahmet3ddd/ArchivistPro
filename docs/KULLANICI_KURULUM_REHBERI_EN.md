# ArchivistPro — End User Setup Guide

**Version:** 2.2.1 | **Platform:** Windows 10/11 (64-bit)

---

## 1. System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| Operating System | Windows 10 (64-bit) | Windows 11 (64-bit) |
| RAM | 4 GB | 8 GB+ |
| Disk Space | 2 GB free | 5 GB+ |
| CPU | Any x64-compatible CPU | 4+ cores |

> Node.js, Rust, or any other developer tools are **not required** — a standard Windows installation is sufficient.

---

## 2. Download the Installer

- Go to GitHub Releases: `https://github.com/ahmet3ddd/Arsiv-H2/releases/latest`
- Download **`ArchivistPro_*_x64_en-US.msi`** (MSI, recommended) or **`ArchivistPro_*_x64-setup.exe`** (EXE).

> You do not need to download `.sig` files; these are used for automatic update verification only.

---

## 3. Run the Installer

1. Double-click the downloaded `.msi` or `.exe` file.
2. Click **Yes** when Windows asks "Do you want to allow this app to make changes to your device?"
3. Follow the wizard: **Next → Install → Finish**.
4. Once installed, ArchivistPro can be launched from the desktop shortcut or Start menu.

> **If you see a SmartScreen warning:** Click "More info" → "Run anyway." This warning appears because a code-signing certificate is not yet active; the application is safe.

---

## 4. First Launch — Setup Wizard (5 Steps)

When the application is opened for the first time, a **one-time** setup wizard runs (~5 minutes).

### Step 1 — Language & System Check
- Select your interface language: **Turkish** or **English**.
- The app automatically checks your hardware and Windows version.

### Step 2 — Hardware Detection
- CPU, RAM, and performance measurements determine the appropriate AI hardware tier.
- You can change the detected tier (Low / Medium / High) yourself.

### Step 3 — AI Setup *(optional)*
- If **Ollama** is running on your computer, it is automatically detected and local AI is enabled.
- If Ollama is not installed, you may skip this step; the application works fully without AI features.

### Step 4 — DWG Support *(optional)*
- If **ODA FileConverter** is installed, it is automatically detected and advanced DWG preview is enabled.
- If not installed, you can install it with one click through the wizard or skip this step.

### Step 5 — Summary & Ready
- A summary of your selected settings is shown; if everything looks correct, click **Start**.

---

## 5. First Login — Creating an Administrator Account

After the wizard, since the user database is empty, a screen to create the **first administrator account** appears.

1. Enter a **username**.
2. Set a **password** (minimum 6 characters).
3. Confirm the password and click **Create Account**.
4. Log in with the credentials you just created.

> If you forget your password, a recovery key is automatically saved to:
> `C:\Users\<Username>\AppData\Roaming\com.archivistpro.desktop\recovery.key`

---

## 6. First Use — Scanning a Folder

After logging in, you are ready to use the application:

1. Click the **Scan** button in the left panel.
2. Select the folder you want to archive (containing DWG, RVT, MAX, IFC, PDF, etc.).
3. When scanning completes, files are automatically indexed and previews are generated.

---

## 7. Optional: Installing Ollama (AI Features)

If you want to use AI-powered search and OCR features:

1. Download and install Ollama from `https://ollama.com`.
2. Open a command prompt and pull a vision model:
   ```
   ollama pull llava
   ```
3. Restart ArchivistPro while Ollama is running in the background; AI features activate automatically.

> Without Ollama, the application continues to work **fully functional**; only LLM-based search and OCR are disabled.

> **Note:** Visual similarity search (CLIP) requires no additional setup. On the first scan, the AI model (~87 MB) is automatically downloaded and loaded from cache on subsequent uses. This feature works independently of Ollama.

---

## 8. Optional: Installing ODA FileConverter (Advanced DWG)

If you want higher-quality previews and metadata from DWG files:

1. Download ODA FileConverter from `https://dl.opendesign.com`.
2. Run the downloaded installer and complete it.
3. Restart ArchivistPro; DWG support is automatically detected.

> This step is entirely optional; ArchivistPro also works with its built-in DWG reader.

---

## 9. Automatic Updates

- When a new version is released, the application notifies you.
- You can also manually check for updates from **Settings → Updates**.
- After the update is downloaded, simply restart the application.

---

## 10. Troubleshooting

| Issue | Solution |
|---|---|
| App won't open | Check if your antivirus is blocking ArchivistPro; add an exception if necessary. |
| SmartScreen warning | Click "More info" → "Run anyway." |
| No DWG preview | Check ODA FileConverter installation (Step 8). |
| AI features not working | Make sure Ollama is running in the background (`ollama serve`). |
| Forgot password | Use `%APPDATA%\com.archivistpro.desktop\recovery.key` at the login screen. |
| Scanning very slow | Close other heavy programs during scanning; more RAM improves performance. |

---

*For developer documentation, see `docs/DEVELOPER_GUIDE.md`.*

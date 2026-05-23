# ArchivistPro — Installation Guide (For Beginners)

> **Version:** 3.0.0 | **Date:** 2026-05-23 | **Platform:** Windows 10/11 (64-bit)
>
> This guide is for you if this is your first time installing a program
> on your computer or if you have limited installation experience. Each
> step is shown with a screenshot; no jargon, no assumed knowledge.
>
> For a more concise / technical summary, see
> **[Professional Install Guide](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_PRO_EN.md)**.

---

## 1. Preparation

### 1.1. Is your computer ready?

Before installing ArchivistPro, check whether your computer meets these
requirements. Most modern PCs comfortably exceed them.

| Requirement | Minimum | Recommended |
|---|---|---|
| Operating System | Windows 10 (64-bit) | Windows 11 (64-bit) |
| RAM (memory) | 4 GB | 8 GB or more |
| Free disk space | 2 GB | 5 GB or more |
| Processor (CPU) | x64 architecture (most Intel / AMD) | 4 cores or more |
| Display | 1366×768 pixels | 1920×1080 or higher |

> **How do I check my computer's specs?**
>
> 1. Press `Windows key + R` together.
> 2. In the small dialog, type `msinfo32` and click **OK**.
> 3. Under "System Summary" you will see the OS, processor, and RAM.

### 1.2. Administrator rights

To install the program you must be logged in to Windows as an
**administrator**. If you use a company computer and see "administrator
permission required", contact your IT department.

### 1.3. Internet connection

Internet is needed **only to download the installer**. Once installed,
ArchivistPro **runs offline** — your files are never sent outside your
computer.

---

## 2. Download the Installer

![GitHub Releases page](img/install/github-releases.png)

1. Open your web browser (Chrome, Edge, Firefox).
2. Go to:
   **https://github.com/ahmet3ddd/Arsiv-H2/releases/latest**
3. Under "**Assets**" you see the files. Download **one** of these:
   - **`ArchivistPro_3.0.0_x64_en-US.msi`** ← Recommended
   - `ArchivistPro_3.0.0_x64-setup.exe` ← Alternative

> **MSI vs EXE:** Both install the same program. MSI is more common and
> easier to manage on company computers. Either is fine.

> **If your browser warns you:** A message like "This file is rarely
> downloaded; are you sure?" may appear. Click **Keep** or **Allow** to
> continue.

---

## 3. Run the Installer

![Installer wizard](img/install/installer-wizard.png)

1. **Double-click** the file you downloaded (`ArchivistPro_3.0.0_x64_en-US.msi`).
   Usually it's in your **Downloads** folder.
2. Windows may ask: "*Do you want to allow this app to make changes to
   your device?*" → choose **Yes**.
3. In the installer window:
   - Click **Next**
   - Read and accept the license, then **Next**
   - Leave the install location at the default
     (`C:\Program Files\ArchivistPro\`) and click **Next**
   - Click **Install**
4. Wait a few seconds. When "Setup complete" appears, click **Finish**.

> **If you see a SmartScreen warning:** A blue screen titled "Windows
> protected your PC" may appear. This is because the application is in
> the code-signing process. Do this:
>
> 1. Click "**More info**".
> 2. Click "**Run anyway**".

After installation, an **ArchivistPro** shortcut appears on your
desktop. You can also open it from the Start menu.

---

## 4. First Launch — Setup Wizard

![Setup wizard step 1](img/install/wizard-step-1.png)

When you first open the program, a **5-step setup wizard** greets you.
It only shows up once. Roughly 3-5 minutes.

### Step 1 — Language & System Check

- Choose the interface language: **English** (you can change it any
  time from **Settings**).
- The program automatically checks your hardware. If there are no
  errors, click **Next**.

### Step 2 — Hardware Detection

![Hardware detection](img/install/wizard-step-2.png)

- The program inspects your processor and memory, and determines your
  performance level:
  - **Low** — for slower computers, with limited AI features
  - **Medium** — a good balance for daily use (recommended)
  - **High** — for fast computers, with all AI features
- Leaving the program's recommendation is usually correct. Click
  **Next**.

### Step 3 — AI Setup (Optional)

For the **AI Chat** feature, ArchivistPro needs AI support. You have
3 options here:

| Option | Advantage | Disadvantage |
|---|---|---|
| **Local AI (Ollama)** | Fully offline, private; data stays put | Need to install Ollama separately |
| **Cloud AI** | Fast, no install | Internet required, API key needed |
| **Skip** | Easiest | AI features will not work |

Tip: choose **Local AI**. The wizard sends you to
[ollama.com](https://ollama.com/download); download and install Ollama,
then return to ArchivistPro and click **"Check Again"**.

If you want to skip AI for now, choose **Skip**. You can enable it
later from **Settings > AI**.

### Step 4 — DWG Support (Optional)

If your archive contains DWG (AutoCAD drawing) files, you should
install a small helper called **ODA File Converter**. It lets
ArchivistPro understand the contents of DWG files (layers, blocks,
text).

- If ODA is detected, it's automatic → **Next**.
- If not, click "**Download & Install**", or skip this step.

### Step 5 — Summary & Ready

![Wizard final step](img/install/wizard-step-5.png)

A summary of your choices is shown. If everything looks correct, click
**Start**.

---

## 5. Create Your Admin Account

![Admin setup](img/install/admin-setup.png)

After the wizard you see the **Admin account creation** screen. **You
create this account** — there is no preset username/password in the
program.

1. **Username** — Choose a username (e.g., "ahmet" or "boss").
   3-32 characters.
2. **Password** — Choose a strong password. Don't forget this.
   - At least 6 characters (12+ recommended)
   - Mix of letters and numbers is good
3. **Confirm password** — Type the same password again.
4. Click **Create Account**.

> **If you forget your password:** The program automatically creates a
> "recovery key" file and stores it at:
> `C:\Users\<YourName>\AppData\Roaming\com.archivistpro.desktop\recovery.key`
>
> **Back up this file** to a safe place (copy to a USB drive, or email
> it to yourself). If you forget your password, you can reset it with
> this file.

---

## 6. Add Your First Files

When the program opens you see an empty screen. To add files to your
archive:

![Scan folder button](img/install/scan-folder-button.png)

1. In the left panel, click **"Scan & Index Folder"**.
2. Select the folder where your architectural files live (e.g.,
   `D:\Projects`).
3. Click **"Start Scan"**.
4. The scan starts automatically — a progress bar appears. Duration
   depends on the number of files (1000 files ≈ 5 minutes).

![Scan progress](img/install/scan-progress.png)

When the scan finishes, your files appear in the main list. You can
now search, tag, and sort them.

---

## 7. Frequently Asked Questions (FAQ)

### I upgraded from an older version to v3.0.0, what happens to my files?

On first launch your old archive is **automatically migrated to the
new V3 architecture**. It takes a few seconds. Your data is safe — a
backup file (`archivist_premigrate_v3.db.bak`) is kept automatically
for rollback.

### Can I use the program without internet?

Yes. Internet is not required after installation. If you chose Local
AI (Ollama), AI also works offline. If you chose Cloud AI, internet
is only needed for that feature.

### Can I move my files to another computer?

Yes. In **Settings > Network > Export / Report** you can export your
archive as a `.archivistpro` file. Take that file to the new computer
and use **"Import (.archivistpro)"** to load it.

### How does backup work?

The program automatically takes a backup before every scan (the last 5
are kept). You can take and restore manual backups from **Settings >
Storage**. With v3.0.0, backups include both `archivist.db` and
`archivist_vec.db` **together**.

### The installer failed, what do I do?

1. Right-click the downloaded file → **Properties** → find the
   "**Unblock**" checkbox if present → tick it → **OK**.
2. Try the installer again.
3. If it still fails, your antivirus may be blocking; add ArchivistPro
   to the exceptions list.
4. If the problem persists, file an issue at GitHub:
   https://github.com/ahmet3ddd/Arsiv-H2/issues

### How do I uninstall the program?

Open Windows **Settings > Apps > Installed apps**, find
"**ArchivistPro**" → **Uninstall**. Your data remains in this folder
(delete manually if you want to wipe it):
`C:\Users\<YourName>\AppData\Roaming\com.archivistpro.desktop\`

---

## 8. More Information

- **In-app:** Press **F1** or click the **? Help** icon at the bottom
  left. You will find 4 tabs: User Guide, Admin Guide (if you have
  rights), What Can I Do?, Release Notes.
- **Pro installation:** for silent install, network deployment,
  environment variables, etc., see
  [Professional Install Guide](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/INSTALL_PRO_EN.md).
- **Release notes:** [CHANGELOG.md](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/CHANGELOG.md) · [All release assets](https://github.com/ahmet3ddd/ArchivistPro/releases/tag/v3.0.0)

Happy archiving! 🎯

---

*This guide is updated as the program evolves. Last update: 2026-05-23 (v3.0.0).*

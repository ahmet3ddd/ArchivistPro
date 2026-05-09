# ArchivistPro Admin Guide

> Version 2.4.4 | 2026-05-05 — This guide is for Admin (full-privilege) users only.

---

## 1. User Roles and Privilege Hierarchy

ArchivistPro has a three-tier privilege hierarchy:

| Role | Who | In Brief |
|------|-----|----------|
| Founder Admin | The first person to install the program; the first admin account created | Can do everything + manages other admins |
| Admin | Admins added by the Founder | Manages the archive and viewer users |
| Viewer | Regular users | Read-only access to the archive; has a personal local archive |

### Permission Table

| Action | Founder | Admin | Viewer |
|--------|:-------:|:-----:|:------:|
| View archive | YES | YES | YES |
| Write to / scan archive | YES | YES | NO |
| Add / delete viewer | YES | YES | NO |
| Add new admin | YES | NO | NO |
| Delete admin / demote role | YES | NO | NO |
| Manage application settings | YES | YES | NO |
| View logs | YES | YES | NO |
| Founder's role / deletion | NO | NO | NO |

> **Who is the Founder?** It is the admin account created on the "First Setup" screen the very first time the program is opened.
> The role is assigned automatically; this account cannot be deleted or demoted.
> Even when the database is moved to a different computer, the protected account remains the first admin in that database.

### Example Scenario

Two admins (Ayse = founder, Mehmet = added later) work in the same office:
- Mehmet can add and delete viewer users (full privileges)
- Mehmet cannot delete Ayse or demote her role
- Mehmet cannot add a new admin — that decision belongs to Ayse
- Ayse can demote Mehmet's role to viewer if she wishes

---

## 1b. Legacy Section — Executable Files

| Role | Exe |
|------|-----|
| Admin | ArchivistPro.exe |
| Viewer | ArchivistPro-Viewer.exe |

---

## 2. Setup Wizard and Admin Account on First Launch

When the application is opened for the first time, you go through a two-stage setup process:

### 2a. Setup Wizard

The **Setup Wizard** appears automatically before the login screen. This wizard prepares the user for the system in 4 steps:

1. **Welcome & System Check**
   - WebAssembly (WASM) support is verified
   - Operating system version and estimated disk space are shown
   - **Language selection** is available (Turkish / English) — offered here because it precedes the login screen

2. **Hardware Detection**
   - CPU core count, RAM, and benchmark results are displayed
   - The system automatically recommends a Low / Medium / High performance mode
   - You can pick a different mode if you wish

3. **AI Setup**
   - The Ollama server is auto-detected (localhost:11434)
   - If Ollama is running, available vision models are listed
   - 3 options are offered:
     - **Local AI (Ollama)** — data stays local, GPU recommended
     - **Cloud AI (Gemini/Groq)** — internet and API key required
     - **Skip AI** — can be enabled later from Settings
   - The "Recheck" button re-queries the Ollama status

4. **Ready!**
   - The selected performance mode and AI mode are summarized
   - The "Start Archivist Pro" button advances to the next stage

### 2b. Creating the First Admin Account

After the wizard completes, **if no user has been created yet**, the **"First Setup"** screen opens instead of the login screen:

- Choose a username and password (username 3–32 characters, password max 128 characters)
- Click the "Create Admin Account" button
- You are signed in automatically once the account is created

> **Important:** There is no built-in default account such as `admin / admin`. You create the first admin account yourself.

### Returning Users

People who have used the application before (Wizard completed, at least 1 record in the user table) **do not see** the wizard or the first-setup screen again.

### Resetting the Wizard

If you want to see the wizard again for testing purposes, delete the `archivist_setup_wizard_done` and `archivist_perf_setup_done` keys via the browser developer tools (F12 > Application > Local Storage).

---

## 3. Password Recovery

If you forget your admin password, you can reset it using the `recovery.key` file generated automatically when the application first launches.

### Recovery Key File

- Location: `%APPDATA%\com.archivistpro.desktop\recovery.key`
- 48-character hex string, generated once on first launch
- Back up this file in a safe place (USB stick, encrypted cloud, etc.)

### Password Reset Steps

1. Click the **"Forgot Password"** link on the login screen
2. Paste the contents of the `recovery.key` file into the input box
3. Select the admin account whose password is to be reset
4. Set and confirm the new password
5. You are redirected to the login screen

> **Note:** The recovery key is not single-use; the same key works for every reset. If the key file is lost and all passwords are forgotten, you will need to back up the database file and reset the application.

---

## 4. Archive Management

### Fixed Archives
- **Main Archive (shared)** — managed by the admin, read-only for viewers
  - File: `archivist.db` (default: `AppDataDir/archivist.db`)
- **Local Archive (personal)** — per-user
  - File: `archivist_local.db`

### Multi-Archive (Phases 1–3)
ArchivistPro can manage N custom archives in parallel. Each archive is stored in a separate SQLite file with its own source folders, tags, and favorites.

**Creating a New Archive:**
- Go to Settings > Archives > click the "New Archive" button
- Enter a name, type (shared/personal), and an optional disk path
- The new archive is added to the selector list in the left panel

**Join/Merge:**
- Combines two archives into one
- Snapshots of both archives are taken before the operation
- Preview shows how many assets, conflicts, tags, and embeddings will merge
- Conflict strategy: skip / overwrite / rename
- Rollback: full revert if the operation fails

**Extract:**
- Creates a subset by applying filters to an archive
- Criteria: type, tag, category, date range, etc.
- Mode: copy (kept in source) or move (removed from source)
- Move mode includes a source snapshot for rollback safety

### Source Folder Management (Sidebar Panel)
The "Source Folders" section in the left panel shows the scanned root directories of each archive:

- **Adding:** Saved automatically when a scan is run (each scan = a separate row, exact path match)
- **Re-scan:** From the 3-dot menu — re-scans only that folder in scoped mode without touching the others
- **Rename:** Changes the displayed label only (path remains unchanged)
- **Remove:** Removes the folder from the list; the assets remain in the archive
- **Delete with Files:** Deletes the folder + all asset records under it

> **Note:** Counts are computed live (BAK and deleted files excluded).

### Scanning and Indexing
1. Click the "Scan Folder & Index" button in the left panel
2. Choose a mode:
   - **Add to List** (default) — new files are added
   - **Re-scan from Scratch** — *only the records under the selected folder* are deleted and re-scanned. Other source folders are not touched (scoped replace).
3. An automatic DB snapshot is taken before scanning (safety)
4. The last 5 snapshots are kept; the oldest is removed automatically
5. The **checkpoint** system runs during scanning — every N files (default 50) data is flushed to disk so that already-scanned files are not lost in the event of a crash or power outage
6. You can change the checkpoint frequency from **Settings > Storage** (every 1, 5, 10, 25, 50, 75, or 100 files)

### Scan Reports
After every scan, a list of files that were skipped or errored out is saved. You can access these reports via **Source Folders > 3-dot menu > "Scan Reports"**. Reports are also written as TXT to the application data folder.

### Folder Change Detection (Watch Folders)
If you enable **"Watch folders for changes"** in Settings:
- You get a notification when a file is added/modified/deleted in a scanned folder
- If you also enable **automatic re-scanning**, the affected folder is re-scanned automatically when changes are detected
- This feature applies only to source folders that are currently active

### DWG Metadata — ODA File Converter Integration
**ODA File Converter** is used to extract real metadata from DWG files (layers, blocks, text content, xrefs, drawing properties).

**Installation:**
- Auto-detection is active under Settings > AI > "ODA File Converter"
- If installed on the system, it is found automatically via Registry + PATH
- If not installed, a "Download & Install" button is offered (bundled installer or winget/web)

**Behavior:**
- During scanning, ODA is launched **invisibly** in the background for each DWG (PowerShell `Start-Process -WindowStyle Hidden` wrapper prevents windows from popping up or stealing focus)
- DWG → temp DXF conversion, then metadata is extracted by the DXF parser
- Results are written to the `dwgLayers`, `dwgBlockNames`, `dwgTextContents`, and `dwgXrefNames` fields
- **Shape data** — geometric shapes in the file (polylines, arcs, rectangles) are extracted and used in shape search
- **Embedded OLE objects** — Excel/Word/PDF files embedded inside DWGs are detected
- If ODA is not present, a raw binary scan fallback is used (silent, partial metadata)

**DWG Structural Similarity Search:**
When you right-click a DWG file and choose "Find Similar", a 5-dimensional **composite score** is used instead of CLIP visual comparison: layer structure, block structure, text content, shape data, and pHash. This method gives more reliable results for CAD files.

### File Reorganization (Refile)
1. Click the "Organize" button in the top bar
2. Choose an organization strategy:
   - By project
   - By category
   - By phase
   - By material
3. Review the preview
4. Click "Apply" to move the files

---

## 5. Log Management

### Audit Log
- Who did what — every user action is recorded
- Persistent — only an admin can clear it
- The clear action itself is also logged

### System Log
- Errors, warnings, performance metrics
- Kept for 7 days, with automatic rotation

### Viewing Logs
You can filter and inspect all records from the log panel.

---

## 6. Backup and Archive Sharing

### DB Snapshot

A snapshot is a full backup of your database. It is taken **automatically** before every scan/indexing operation. You can also create snapshots manually.

**Automatic behavior:**
- Taken silently before every scan
- The last 5 snapshots are kept; the oldest is removed automatically

**Manual snapshot (Settings > Storage):**
1. Open Settings → switch to the "Storage" tab
2. Click the **"Create Backup"** button — the snapshot is added to the list with its date and size
3. On each snapshot row:
   - **Restore** — replaces the current database with this snapshot (asks for confirmation)
   - **Delete** — permanently deletes only this snapshot

> **Note:** Viewer users cannot take snapshots in the main archive. They have full privileges over their own local archive.

### Archive Export/Import (.archivistpro)

You can export your entire archive as a single `.archivistpro` file or import an archive coming from another computer.

**Export:**
1. Go to Settings > Network tab
2. Click the "Export / Report" button
3. Choose the save location and filename
4. The archive is created in `.archivistpro` format (ZIP)

**Import:**
1. Go to Settings > Network tab
2. Click the "Import (.archivistpro)" button
3. Choose the file to import
4. A manifest preview appears (version, asset count, DB size)
5. Confirm — the existing database is automatically backed up with `.bak`

### LAN Sharing (Mini HTTP Server)

You can share the archive with other computers over your office LAN. No internet connection is required.

**Starting the Server:**
1. Go to Settings > Network > click the "Start Server" button
2. Note the information shown on screen:
   - **IP Address** (e.g. `192.168.1.106`)
   - **Port** (`9471`)
   - **Connection Code** (8 digits, e.g. `25930014`)
3. Share these details with viewer users verbally or in writing

**Security:**
- The connection code is generated randomly (CSPRNG) the first time the server starts and is **persisted** — restarting the application does not change the code
- You can rotate the code manually with the "Regenerate Code" button (the new code takes effect immediately, no server restart required)
- Access is impossible without the code (HTTP 403)
- After 5 failed attempts, the source IP is blocked for 5 minutes
- The server is reachable on the local network (LAN) only
- Data is not encrypted — use only on trusted office networks

**Stopping the Server:**
- Click the "Stop Server" button
- All connections are closed

> **Note:** You cannot switch to client mode (connect) while the server is running. Stop the server first.

---

## 7. 3ds Max Version Conversion

### Quick Mode (Stamp Replacement)
- Replaces the file's version stamp
- The original file is preserved; a new file is created next to it
- Fast, but may cause issues in some cases

### Native Mode (MAXScript)
- Re-saves the file using your installed 3ds Max
- More reliable, but requires Max to be installed
- Max runs in the background (headless)

### FBX / OBJ Export
You can convert MAX files to FBX or OBJ format. When a MAX file is selected, two export buttons appear in the detail panel:

| Mode | Description | Requirement |
|------|-------------|-------------|
| **Quick Mode** | Basic geometry conversion | None |
| **Native Mode** | Via 3ds Max native FBXEXP/ObjExp plugin | 3ds Max installed |

- In Native Mode, 3ds Max installations on your computer are auto-detected (Registry scan)
- The converted file is saved to the Downloads folder
- During the operation Max runs in the background (headless), with a 5-minute timeout

### Viewing MAX Metadata
Additional information is shown in the detail panel for MAX files:
- **Layers** — the layer structure of the file (colored labels)
- **Objects** — object names in the file (max 30 shown, with "+N more" note for the rest)
- This information is extracted from the CFB binary stream as UTF-16LE

---

## 8. AI Settings

### Local AI (Ollama)
1. Install [Ollama](https://ollama.ai)
2. Pull a model with `ollama pull llava`
3. Set CORS: `setx OLLAMA_ORIGINS "*"` (Windows)
4. Choose Ollama from AI Settings

### Cloud AI
- Google Gemini, OpenAI, and Groq are supported
- Enter your API key in AI Settings
- **Security:** API keys are kept session-based; they are never written to disk or localStorage

---

## 9. Database Security

- Delete operations are atomic (protected with transactions)
- Foreign key cascade is enabled — when an asset is deleted, its embeddings, tags, and favorites are cleaned up automatically
- A notification is shown if database saving fails
- Path traversal protection is applied when changing the database path

---

## 9b. Approval Workflow

In Dashboard view, admins have an **Approval Queue** panel. This panel lets you bulk-manage files in the "In Review" state.

### Dashboard Panel
- **4 status badges:** Draft, In Review, Approved, Rejected — each shows how many files are in that state
- **Pending list:** "In Review" files are listed (max 20, scrollable)
- **Bulk actions:** "Approve All" or "Reject All" buttons

### Rejection Reason
When you reject a file, you can enter the reason in the text field that opens (e.g. "Dimensions incorrect"). This information appears in the file's detail panel and in XMP sidecar exports. When the file is later approved, the rejection reason is cleared automatically.

### Approval History (Audit Trail)
Every approval status change is recorded in the `approval_log` table:
- Who changed it
- When
- From which state → to which state
- The rejection reason, if any

The **"Approval History"** panel in Dashboard view shows the most recent 10 actions in chronological order.

---

## 9c. XMP Metadata Export

You can export your files' metadata in the standard **XMP sidecar** format:
- Right-click the file → "Export XMP"
- An `.xmp` sidecar is created next to the file
- If it cannot be written there, it is saved to the application data folder
- Contents: file name, project, category, tags, approval status, client, version, and rejection reason if any

---

## 9d. Health Check (Fixity Check)

Verifies the integrity of files in your archive on a sample basis:
1. Go to "Health Check" in Settings
2. Click the "Start Scan" button
3. The system verifies file checksums
4. Modified or corrupted files are reported

**Legacy Format Detection:** The system also detects old Office binary formats (`.doc`, `.xls`, `.ppt`) and offers conversion to the modern OOXML format (`.docx`, `.xlsx`, `.pptx`).

---

## 9e. Retention and Configuration

You can configure the following durations from Settings:
- **Snapshot retention** — how long automatic snapshots are kept
- **Account lockout duration** — lockout period after failed login attempts
- **Session timeout** — automatic lock when the user is idle (5–120 minutes)

---

## 9f. AI Sensitivity Filter

A 3-layer protection system that prevents sensitive files in your archive (contracts, salary tables, personal data) from appearing as results in AI chat.

### Why Is It Needed?

AI chat can query every scanned file. When a viewer asks "is there a client contract?" or "find the salary table", AI will find and show such files if they exist. With this filter you can hide sensitive data from AI — files remain visible in the archive, only AI cannot access them.

### Layer 1 — Built-in Categories

Enable from the Settings > Security > **AI Sensitivity Filter** card. Four categories can be toggled on/off:

| Category | Detected Keywords |
|----------|-------------------|
| **Financial** | salary, invoice, quote, budget, payment, cost, progress payment, bill of quantities, income, expense, bank, IBAN |
| **Personal Info** | Turkish national ID number, ID register, phone, address, date of birth, driver's license, passport |
| **Legal** | contract, NDA, confidentiality, court, formal notice, power of attorney, notary, lawsuit |
| **Human Resources** | personnel file, leave, record, performance, discipline, hiring, interview |

These keywords are searched in file names, project names, and file content (chunk text). Any matching file is excluded from AI in its entirety.

### Layer 2 — Custom Keywords

You can add your own keywords from the same settings card. For example:
- Sensitive client name: `"Villa Kaya"`
- Confidential project code: `"internal"`, `"private"`

Adding or removing a keyword updates the filter instantly.

### Layer 3 — Manual File/Folder Hiding

- **Single file:** Right-click the file → **"Hide from AI"** (click again to undo)
- **Whole folder:** From the 3-dot menu in the Source Folders panel → **"Exclude from AI"**

### How It Works (Technical)

```
User asks AI a question
    ↓
RAG pipeline starts the search (FTS + semantic + metadata)
    ↓
Sensitivity filter kicks in:
  ✗ Files with rag_excluded = 1  → SKIP
  ✗ Files containing active category keywords → SKIP
  ✗ Files containing custom keywords → SKIP
    ↓
Remaining files are sent to the AI
```

> **Note:** The filter affects only AI chat. Regular search, filtering, the detail panel, and the duplicate finder are not affected.

---

## 10. Duplicate & Similar File Finder

This tool detects, compares, and (if necessary) deletes duplicate or similar files in your archive.

> **Access — Admin:** All features active (scan, view, **delete**).
> **Access — Viewer:** Can scan and view, but **deletion is restricted to admins**.

### 10.1 Accessing the Panel

Click the **⎇ (fork)** icon in the top bar — between the trash icon and the brain icon. Hovering shows "Find Duplicates".

### 10.2 Detection Modes

Four independent modes that can run together or separately:

| Mode | What It Detects | How It Works |
|------|-----------------|--------------|
| **Exact Duplicate** | Files with identical content (different names/paths possible) | File hash (SHA comparison) — instant |
| **Same Name** | Same file name in different folders | File-name match — instant |
| **Visual Similarity** | Visually similar images | pHash Hamming distance (64-bit) — ~100ms / 1000 images |
| **Structural Similarity** | Similar layer/material/content structure | Jaccard similarity — CAD, 3D, document only |

#### Supported file types (visual similarity)
`JPG · PNG · BMP · WEBP · TIFF · TGA · EXR · HDR · PSD`

#### Supported file types (structural similarity)
`DWG · DXF · IFC · MAX · SKP · PDF · DOC/DOCX · XLS/XLSX · PPT/PPTX · RVT`

#### Structural similarity detail (per file type, v2.1.2)

| Type | Compared Fields |
|------|-----------------|
| DWG / DXF | Layer names (1.0) + Block names (1.0) + Text content (0.8) + Xrefs (0.6) — weighted Jaccard |
| IFC | Floor count + Entity count (proximity match) + (optional) layer names |
| 3DS MAX | Material names (Jaccard) + Render engine match (+50) + Max version match (+35) |
| SketchUp | Component names + Layer names (Jaccard) + SketchUp version match (+35) |
| Revit | Floor names (Jaccard) + Project name (+50) + Area count proximity |
| PDF / DOCX / XLSX... | Title (+40) + Author (+30) + Page count (+30) |

#### General Criteria (cross-format pre-filter)
Optional extra conditions for the Structural Similarity and Same Name modes:

- **Same file size** — selectable tolerance: exact match, ±1 KB, or ±1%
- **Modification date close** — N day window
- **Same folder name** — parent folder basename match (case-insensitive)

These conditions are applied per pair through `passesGeneralCriteria()`; non-matching pairs are not even put through the similarity calculation (reduces false positives + speeds up scans).

#### Performance Filters
- **Minimum file size (KB)** — files below this size are pre-filtered out of the scan pool

### 10.3 Scope Selection

When the panel opens, choose which archive to scan. All available archives (Main Archive, Local Archive, and any custom archives you have added) are listed in tabs:

| Scope | Who Can Access | Delete Permission |
|-------|----------------|-------------------|
| **Main Archive (shared)** | Admin + Viewer | Admin only |
| **Local Archive (personal)** | Admin + Viewer | Admin + Viewer |
| **Custom Archives** | Depends on type (shared = only admin writes; personal = owner writes) | Depends on type |

> **Viewer note:** You can delete in personal-type archives. In shared archives, only an admin can delete.
> If an archive has not been loaded yet, its tab appears disabled — switch to that archive from the sidebar first.

### 10.4 Panel Interface

> The mock-up below depicts the actual rendered Turkish UI.

```
┌─────────────────────────────────────────────────────────────┐
│  ⎇  Kopya & Benzer Dosya Bulucu                   [?]  [✕]  │
├─────────────────────────────────────────────────────────────┤
│  [✓] Birebir Kopya   [✓] Aynı İsim                         │
│  [✓] Görsel Benzerlik  [✓] Yapısal Benzerlik               │
│                                                             │
│  Benzerlik Eşiği:  ◄─────────●─────►  75%                  │
│  (Görsel ve Yapısal modlar için geçerlidir)                 │
│                                              [ Tara ]       │
├─────────────────────────────────────────────────────────────┤
│  5 grup, 14 dosya — 7.32ms       [Liste] [Karşılaştır]      │
├─────────────────────────────────────────────────────────────┤
│  BİREBİR KOPYA — 1 grup                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ proje_A.dwg (3 kopya)   [İlkini Koru, Diğ. Sil]   │   │
│  │  [  ] /Ofis/A/proje_A.dwg  1.2 MB  2024-03   [⎇][🗑]│   │
│  │  [✓] /Yedek/proje_A.dwg   1.2 MB  2023-11   [⎇][🗑]│   │
│  │  [✓] /Eski/proje_A.dwg    1.2 MB  2023-08   [⎇][🗑]│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  GÖRSEL BENZER — 2 grup                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ render_v1.jpg  pHash farkı: 5/64 bit → %92        │   │
│  │  [  ] /Render/render_v1.jpg  2.4 MB  2024-03  [⎇][🗑]│  │
│  │  [  ] /Render/render_v2.jpg  2.4 MB  2024-03  [⎇][🗑]│  │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                         [ Seçilileri Sil (2) 🗑 ]           │
└─────────────────────────────────────────────────────────────┘
```

**Icons:**
- `[⎇]` — Add this file to the Compare panel
- `[🗑]` — Delete only this file (instant confirmation prompt)
- `[✓]` checkbox — Mark for bulk deletion

### 10.5 Similarity Threshold

The slider affects only the **Visual Similarity** and **Structural Similarity** modes.

```
Low threshold (50%)        High threshold (95%)
◄●─────────────────►       ◄─────────────●►
More results               Fewer, only very similar
(false-positive risk)      (precise matches)
```

Recommended starting value: **75%**. For DWG/CAD, 60–70% may work better; for images, 85–90% tends to give the best results.

### 10.6 Missing Hash / Metadata Warnings

After a scan, three separate warnings may appear:

> ⚠ Hash missing: 23 files — these cannot be included in the Exact Duplicate scan.
> ⚠ pHash missing on X files — they were skipped in the visual similarity scan.
> ⚠ Metadata missing on X files — they were skipped in the structural similarity scan.

Next to each warning:
- **Show files** — lists the affected files
- **Re-scan These** — re-scans only those files (via ScanModal `pendingRescanPaths`)
- **Skip** — dismiss the warning and continue with the current results

> **Tip:** If you want to fully refresh a single source folder, Sidebar > Source Folders > 3-dot menu > "Re-scan" is more practical. The modal opens automatically and re-scans only that folder in scoped mode.

### 10.7 List View — Steps

1. Click the **Scan** button — results are grouped under type headings
2. Click a group to expand/collapse it (▼ / ►)
3. Each group shows which files are similar and why
4. **Keep First, Delete Others** — keeps the newest file and marks the others with a checkbox
5. Use the checkboxes to pick the files you want to delete
6. **Delete Selected** — asks for confirmation before bulk deletion

> **Note:** Deleted files are permanently removed from the archive. Ctrl+Z does not restore them.

### 10.8 Comparison View

Inspect two files side by side:

> The mock-up below depicts the actual rendered Turkish UI.

```
┌────────────────────────┬────────────────────────┐
│     render_v1.jpg      │     render_v2.jpg       │
│  ┌──────────────────┐  │  ┌──────────────────┐   │
│  │   [ önizleme ]   │  │  │   [ önizleme ]   │   │
│  └──────────────────┘  │  └──────────────────┘   │
│                        │                         │
│  Boyut:   2.4 MB       │  Boyut:   2.4 MB        │
│  Boyutlar: 1920×1080   │  Boyutlar: 1920×1080    │
│  Tür:     JPG          │  Tür:     JPG            │
│  Konum:   /Render/v1   │  Konum:   /Render/v2    │
│  Tarih:   2024-03-01   │  Tarih:   2024-03-15    │
│                        │                         │
│  [ Solu Sil 🗑 ]       │  [ Sağı Sil 🗑 ]        │
├────────────────────────┴────────────────────────┤
│  pHash farkı: 5/64 bit  →  %92 benzerlik        │
└──────────────────────────────────────────────────┘
```

**Switching to comparison view:**
- In list view, click the `[⎇]` icon on any file
- Switch to the **[Compare]** button in the top bar
- The first clicked file lands in the left column; the second in the right

### 10.9 Deletion Flow

```
Tick checkboxes  ──►  "Delete Selected" ──►  Confirmation Dialog
                                                  │
                                  ┌───────────────┴──────────────┐
                                  │  Yes                    No   │
                                  ▼                              │
                       Files removed from archive       Operation cancelled
                       Groups updated
                       Notification shown
```

> **Admin tip:** On large archives, run **Exact Duplicate** mode first on its own — those are the safest deletion candidates. For visual/structural similarity results, verify in Comparison view before deleting.

### 10.10 Access Differences (Admin vs Viewer)

| Feature | Admin (Main) | Admin (Local) | Viewer (Main) | Viewer (Local) |
|---------|:------------:|:-------------:|:-------------:|:--------------:|
| Open the panel | YES | YES | YES | YES |
| Run a scan | YES | YES | YES | YES |
| View results | YES | YES | YES | YES |
| Comparison view | YES | YES | YES | YES |
| Delete a single file | YES | YES | NO | YES |
| Bulk delete | YES | YES | NO | YES |

---

## 11. File Relations Management

By creating relationships between files, you can organize project files contextually.

### Relationship Types

| Type | Meaning | Auto-detected |
|------|---------|:-------------:|
| **PDF Output** | The PDF version of a DWG/MAX | YES (same stem, different extension) |
| **Render** | Visualization of the design | YES (model + image match) |
| **Version** | A different version of the same file | YES (v1/v2/Rev-A pattern) |
| **Project Group** | Files belonging to the same project | Manual |

### Auto-detection
After scanning, automatic relationship detection runs:
- `plan.dwg` + `plan.pdf` → PDF Output (same stem, different extension)
- `salon.max` + `salon_render.jpg` → Render
- **Version clustering:** files such as `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg`, `plan_FINAL.dwg` are automatically linked with a "Version" relationship
  - Recognized patterns: `_v1`, `_Rev-A`, `_R01`, `_FINAL`, `_DRAFT`, `_old`, `_new`, `(Copy)`, `(1)/(2)`, trailing numbers
- Auto-detected links are marked with the `[Auto]` label

### Manual Linking
1. Open the "Linked Files" section in the detail panel
2. Click the "Add Link" button
3. Choose the relationship type
4. Search for and pick the file to link
5. To remove a link, click the X button on its row

### Bulk Detection from the Source Folders Menu
From the 3-dot menu of any folder under Source Folders in the left panel, choose "Scan Links" to re-detect all relationships in that folder.

---

## 12. Request System (Admin Work Coordination)

A request system is available for coordinating work between admins.

### Sending a Request
1. Compose a new message in the messaging panel
2. Choose **"Request"** as the type
3. The recipient field is hidden automatically — the request is sent to **all admins**
4. Write the subject and description, then send

### Managing Requests
Incoming requests appear in the message panel:
- **Take** — Take responsibility for the request
- **Release** — Drop responsibility (the request becomes open to everyone again)
- **Resolved** — Only the admin who took the request can see this button

The name of the admin who took the request is shown as a badge on the request row.

---

## 13. Trash and Recovery

Deleted files are not removed permanently right away; they are first moved to the trash (soft delete).

### Moving to Trash
- When a file is deleted, it is marked with `is_deleted = 1`
- All metadata, tags, relationships, and project status information are preserved

### Restore
- Click the trash icon in the top bar
- Select the file from the list and click "Restore"
- The file returns to the archive with all its information intact

### Permanent Deletion
- "Delete Permanently" in the trash removes the file from the database completely
- "Empty Trash" permanently deletes every file in the trash
- This action cannot be undone

> **Note:** During a re-scan, if the same file as one in the trash is found on disk, the file is automatically restored from the trash to the archive (user-defined fields are preserved).

---

## 14. Application Close Confirmation

When you try to close the window with the **X button** or **Alt+F4**, the application shows a confirmation dialog.

- **"Quit"** — closes the application (open operations are terminated)
- **"Cancel"** — keeps you in the application

This protection prevents long-running scans or downloads from being interrupted by accident.

---

## 15. Help System and Translation Status

- Help guides live under `public/docs/<lang>/user-guide.md` and `admin-guide.md`
- The full content is currently available **in Turkish only** (`tr/`)
- Interface translations: **5 languages 100%** (TR, EN, ZH, JA, AR — 1825 keys)
- Full coverage exists in 5 languages: TR (source), EN, ZH, JA, AR. ZH/JA/AR versions are AI-translated; a native-speaker review before production is recommended
- To add a new language: create the `public/docs/<lang>/` folder and place translated `user-guide.md`, `admin-guide.md`, and `scenarios.md` (Turkish source: `kullanim-senaryolari.md`) files inside — no code change required. If the help panel is opened in a language whose docs are missing, the **locale fallback chain** falls back to EN (and TR if EN is also missing)

---

*This guide is updated as the program evolves. Last update: 2026-05-05 (v2.4.4)*

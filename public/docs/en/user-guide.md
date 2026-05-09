# ArchivistPro User Guide

> Version 2.4.4 | 2026-05-05

## Welcome

ArchivistPro is a desktop application for intelligently archiving, searching, and managing your architectural files.

---

## 1. First Launch — Setup Wizard

When you open the application for the first time, the **Setup Wizard** greets you. It prepares your system in 4 steps:

1. **System Check** — Your computer's compatibility is tested and the display language is selected (Turkish and English are fully supported; Chinese/Japanese/Arabic interfaces are partially translated)
2. **Hardware Detection** — Your CPU and memory are analyzed. A suitable performance mode is recommended (Low / Medium / High)
3. **AI Setup** — Choose how AI features will work:
   - **Local AI (Ollama)** — All data stays on your computer
   - **Cloud AI** — Works over the internet (API key required)
   - **Skip** — Start without AI and enable it later from Settings
4. **Summary** — Your choices are displayed and setup completes

> **Note:** The wizard appears only once. After the wizard on the very first run, you will be prompted to create an admin account (no password is pre-defined — you set your own). Subsequent launches go directly to the login screen.

---

## 2. Main Screen

The main screen consists of three sections:

- **Left Panel (Sidebar):** Archive selector and favorites at the top, search box and visual search sensitivity in the middle, **Source Folders** and facet filters (category, project phase, material, etc.) at the bottom
- **Center Area:** File list (Explorer, Dashboard, or Technical view)
- **Right Panel (Detail):** Details of the selected file

### View Modes

| Mode | Description |
|------|-------------|
| Explorer | Shows files in a card-based grid view |
| Dashboard | Statistics and analysis charts |
| Technical | Detailed list in table format |

### Source Folders Panel

Directly below the semantic search section in the left panel is the **Source Folders** panel. Here:

- **Every root folder you scan is automatically listed** (by folder name, with the number of files in that folder)
- Click a folder to **apply it as a filter** — only files from that folder are shown
- Multiple folders can be selected (OR logic: A or B or C)
- Use "Clear Filters" to remove all filters
- Click the **▶ arrow** to the left of a folder name to expand the sub-folder tree — nested folder structure is shown; click any sub-folder to filter by it
- The **3-dot menu** next to each folder provides the following actions:
  - **Rename** — changes the displayed label of the folder
  - **Re-scan** — re-scans only that folder (leaves other sources untouched)
  - **Scan Reports** — list of files that were skipped or errored in previous scans
  - **Remove** — removes the folder from the list (files remain in the archive)
  - **Delete with Files** — removes the folder + all its asset records

> **Note:** Counts update live as files are deleted or new scans are run. BAK (backup) files are excluded from counts and are not shown in the main grid.

---

## 3. File Scanning and Indexing

1. Click the **"Scan & Index Folder"** button in the left panel
2. Select the folder you want to scan
3. Set the scan mode:
   - **Add to List (default):** New files are added to the existing scan
   - **Re-scan from Scratch (Replace):** *Only* the old records under the selected folder are deleted and re-scanned. **Other source folders are not touched.**
   - **Color extraction:** Analyzes the dominant colors of images (optional)
4. Click **"Start Scan"**

During scanning, the modal title shows **"Scan & Index Files"**.

- You can track the progress bar and speed
- **Pause/Resume** temporarily halts the scan
- **Cancel** terminates the scan entirely

> **For DWG files:** If ODA File Converter is installed, layers, blocks, text content, and xrefs are automatically extracted and shown in the detail panel. ODA runs invisibly in the background.

> **To refresh a single source folder,** open the 3-dot menu for that folder in the "Source Folders" panel and select **"Re-scan"** — the modal opens automatically and a scoped scan runs for that folder only.

### Data Safety (Checkpoint)

Your data is periodically saved to disk during scanning. Even in the event of a power outage or crash, already-scanned files are not lost. You can change the checkpoint frequency from **Settings > Storage** (default: every 50 files).

### Folder Change Detection (Watch)

If you enable **"Watch for folder changes"** in Settings, the application notifies you when files are added or modified in scanned folders. You can also enable automatic re-scanning.

### Multi-Core Scanning and Hardware Usage

ArchivistPro runs scanning operations in parallel across multiple CPU cores. During initial setup, the application auto-detects your storage type and selects an appropriate default worker count:

| Storage Type | Recommended Workers |
|---|---|
| HDD (mechanical) | 1 – 2 |
| SSD (SATA) | 3 – 4 |
| NVMe (≤ 8 logical cores) | 6 – 8 |
| NVMe (≥ 16 logical cores) | 10 – 16 |

You can change the worker count from **Settings > Storage**. On HDD drives, a high worker count does not improve performance; on the contrary, it may cause slowdowns due to disk head contention.

> **For AI features (semantic search, RAG):** The GPU is used instead of the CPU. These operations run through a separate Ollama service and do not slow down file scanning.

---

## 4. Search

### Text Search
Start typing in the search box. The system performs a three-layer search:
- **Keyword match:** File name, project name, metadata, client name, approval status
- **Semantic search:** Meaning-based matching with AI (requires at least 3 characters)
- **Architectural terms:** Terms are automatically expanded (e.g. "kitchen" → related concepts)
- **Fuzzy search:** Tolerates typos — misspellings still return correct results (4+ character words, max 30% error margin)

> **Tip:** You can search file codes including hyphens — short codes like "A1-c3" or "A1-" match directly.

### Boolean Search (Advanced)

You can use logical operators in the search box:

| Operator | Example | Meaning |
|----------|---------|---------|
| **AND** | `plan AND section` | Files containing both |
| **OR** | `kitchen OR bathroom` | Files containing at least one |
| **NOT** | `project NOT old` | Contains "project" but not "old" |
| **"quotes"** | `"floor plan"` | Contains this exact phrase (words adjacent and in order) |

> Operators must be written in **uppercase** (AND not and). They can be combined: `"floor plan" AND facade NOT draft`

### Advanced Search Menu

Click the **"Advanced Search"** button in the top bar to access additional search types:
- **Visual Search** — upload an image to find similar visuals
- **Shape Search** — search by geometric shapes in DWG/DXF files
- **Find Similar** — list files similar to the selected file
- **Duplicate Finder** — detect repeated files

### Visual Search
Upload an image via the image upload button in the left panel or through the Advanced Search menu. Similar visuals are found automatically.

### Sorting

You can sort results by different criteria:
- **Match score** (default) — search results from most to least relevant
- **Modified date** — newest or oldest first
- **File name** — alphabetical order
- **File size** — largest to smallest or vice versa

### Filters
Use the facets in the left panel to narrow results:
- **Category:** 2D Drawing, 3D Model, Document, Render, Photo, Texture, Video
- **Project Phase:** Concept, Schematic, Permit, Construction
- **Approval Status:** Draft, In Review, Approved, Rejected (assigned from the Project Status section)
- **Material Group:** Concrete, Glass, Metal, Wood, Stone, Ceramic, Composite
- **Color Theme:** Warm Tones, Cool Tones, Monochrome, Earth Tones, Pastel
- **Architectural Style:** Modern, Minimalist, Industrial, Brutalist, Neoclassical, Organic

### Date Range Filter

A **date range filter** is located below the facets in the left panel. Select start and end dates to narrow files by modification date. For example, use it to see only files changed in the last 3 months.

### Filter Presets

You can save frequently used filter combinations as **presets**:
1. Set the filters as desired (facet + tag + date + search term)
2. Click the **"Save"** button in the filter bar
3. Give the preset a name
4. Reload the same filters with a single click later

> Multiple options can be checked (OR logic). Filters are applied instantly — no re-scanning required.

---

## 5. File Details

Click a file to view its details in the right panel:
- Preview (thumbnail or native view)
- Color palette (Hex, RGB, HSL, RAL code)
- Metadata (size, date, layers, blocks)
- AI tags
- User tags
- Project status fields
- Linked files

### 5.1 Project Status

The detail panel contains a section where you can enter the file's project information:

| Field | Description | Limit |
|-------|-------------|-------|
| **Client** | Client or company name associated with the file | Max 150 characters |
| **Approval Status** | Select one of 4 status buttons | Draft / In Review / Approved / Rejected |
| **Version** | Version label (e.g. v1.0, Rev-A) | Max 20 characters |
| **Delivery Date** | Pick from calendar or type manually | ISO date format |

- Click any field to enter edit mode; save with Enter or by clicking outside
- When approaching the character limit, the counter turns orange (client: 140+, version: 18+)
- This data **is preserved even if the file is re-scanned** — the scanner does not touch these fields
- Client name and approval status **affect search results** and can be filtered in the sidebar

#### Rejection Reason
When you change a file's approval status to **"Rejected"**, a text field appears at the bottom. You can enter the reason for rejection (e.g. "Dimensions incorrect, revision required"). When the file is later approved, the rejection reason is automatically cleared.

#### Approval History
Every approval status change is recorded. An admin can view recent actions chronologically from the **"Approval History"** panel in Dashboard view (who, when, from which status to which, and the reason if any).

### 5.2 Linked Files (File Relations)

The "Linked Files" section in the detail panel shows a file's relationships with other files:

| Type | Meaning | Example |
|------|---------|---------|
| **PDF Output** | The PDF version of this file | plan.dwg ↔ plan.pdf |
| **Render** | Visualization of this design | salon.max ↔ salon_render.jpg |
| **Version** | A different version of the same file | plan_v1.dwg ↔ plan_v2.dwg |
| **Project Group** | Files belonging to the same project | Tower_A/*.* |

- **Auto-detection:** Files with the same name but different extensions in the same folder (e.g. plan.dwg + plan.pdf) are automatically linked after scanning
- **Automatic version clustering:** During scanning, files with similar names (e.g. `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg`, `plan_FINAL.dwg`) are automatically linked with a "Version" relationship. Recognized patterns: `_v1`, `_Rev-A`, `_R01`, `_FINAL`, `_DRAFT`, `_old`, `_new`, `(Copy)`, trailing numbers
- **Manual link:** Use the "Add Link" button to create a relationship between any two files
- **Navigation:** Click a linked file's name to navigate to its details
- Auto-detected links are marked with the `[Auto]` label

### 5.3 Format-Specific Information

#### 3ds MAX (.max) Files
- **Layers** — the layer structure of the file is shown as colored labels
- **Objects** — object names in the file are listed ("+N more" note is added for more than 30)
- **FBX / OBJ Export** — two conversion buttons appear in the detail panel:
  - **Quick Mode:** No 3ds Max required, basic geometry conversion
  - **Native Mode:** Full-quality conversion if 3ds Max is installed on your computer (auto-detected)

#### Revit (.rvt) Files
- Thumbnail preview is automatically extracted without 3ds Max (from the OLE stream embedded in the file)
- Project name, Revit version, and floor names are shown

#### DWG Files (with ODA)
- Layers, blocks, text content, xrefs
- Drawing type (floor plan, section, elevation, etc. — with AI)
- Scale and unit estimation
- **Shape data** — geometric shapes in the file (rectangles, circles, polylines, etc.) are extracted and used in shape search
- **Structural similarity** — right-clicking a DWG and selecting "Find Similar" ranks the most similar DWG files by comparing layer/block/text/shape structure (uses structural composite score instead of CLIP visual comparison — more reliable for CAD files)
- **Embedded OLE objects** — Excel, Word, or PDF files embedded inside a DWG are detected and shown in the detail panel

---

## 6. Tags

You can add your own tags to files:
1. Go to the tag section in the file detail panel
2. Create a new tag or select from existing ones
3. You can assign colors to tags
4. Bulk tagging: select multiple files and assign a tag to all at once

---

## 7. Favorites and Collections

- **Favorites:** Mark frequently used files for quick access (star icon in the detail panel)
- **Collections:** Organize files into thematic groups (e.g. "Facade Projects", "Render Archive")
  - You can assign colors to collections
  - A file can belong to multiple collections

---

## 8. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+K or Ctrl+F | Search |
| Ctrl+A | Select All |
| Delete | Delete Selected File (confirmation dialog shown) |
| Escape | Cancel / Close |
| F1 | Help |
| Right Click | Context menu (on an asset card) |

---

## 9. AI Features

### AI Status Indicator

On the right side of the TopBar there is a **brain icon** with a colored dot next to it:

| Dot Color | Meaning |
|-----------|---------|
| Green | AI ready — model loaded and running |
| Yellow | Missing model — AI setup is incomplete |
| Red | Ollama is off or no connection |

Hovering over the brain icon shows an **"Open AI Setup Wizard"** link. Click the icon to open the AI Settings modal.

---

### AI Setup Wizard

To set up AI features for the first time or troubleshoot:

1. Click **brain icon** in TopBar → AI Settings → **"AI Setup Wizard"** button
   *or* hover over the brain icon → click the **"Open AI Setup Wizard"** link

2. The wizard completes setup in **3 steps**:
   - **1. Ollama Check** — Checks whether Ollama is installed and running. If not installed, you can start it directly from the app with the "Start" button, or download it from [ollama.com](https://ollama.com).
   - **2. Download Model** — The required AI model (text and/or visual) is downloaded. Download progress can be tracked with a progress bar.
   - **3. Complete** — System is ready. AI Chat and automatic classification features become active.

---

### Start / Stop Ollama

You can manually manage the Ollama service from the AI Settings panel:

- **If Ollama is off** → a green **"Start"** button appears (power icon). Clicking it starts `ollama serve` in the background.
- **If Ollama is on** → a red **"Stop"** button appears. Clicking it stops the service.
- During a status change, the button shows "Starting..." / "Stopping...".

> **Note:** The Advanced Model Settings section is hidden when Ollama is off — this is normal.

---

### AI Chat (RAG)

Click the **"💬 AI"** button in the TopBar to open the AI Chat panel. You can ask natural language questions about your archive.

**Key features:**

- **Cited answers (Citation):** Every AI response shows which files were used. Click a source file name to navigate directly to that file's details.
- **Scope filter:** Narrow the search scope from the top of the chat window — choose between a specific project, a tag, or the entire archive.
- **Streaming responses:** AI answers stream live to the screen as they are generated; no waiting for long responses.

**Example questions:**
- "Are there any renders with wooden facades?"
- "List all floor plans approved in 2024"
- "Find PDFs in projects with client name 'Smith'"

---

### Slash Commands

Type special commands starting with `/` in the chat box to activate different search modes:

| Command | Shortcut | Function |
|---------|----------|----------|
| `/visual <text>` | `/v <text>` | CLIP model text → visual semantic search. E.g.: `/v modern wooden facade` |

> **Tip:** The `/visual` command interprets the content of images — unlike standard text search, it returns results based on visual similarity, not file names.

---

### Synthesis Mode

Use synthesis mode to run comparative analysis across multiple documents:

1. Click the **📎 (paperclip) button** in the chat window
2. Select the files you want to analyze (multiple can be selected)
3. Type your question — e.g. "Compare these two plans and list the differences"

AI evaluates the selected documents together and produces a synthesized response.

---

### Chat Export

To save or share your chat history:

- Click the **download (⬇) button** in the chat window's title bar
- The entire chat is saved to your computer in **Markdown (.md) format**
- Source file references and responses are exported formatted

---

### AI Tag Suggestion

While a file is open in the detail panel, click the **✨ (sparkle) button**. AI analyzes the file's content and suggests appropriate tags. You can add any suggestion with a single click.

---

### Auto-Classification

During scanning, the AI model automatically:
- Categorizes files (Render / Photo)
- Detects materials
- Identifies architectural style

### Vision AI (Optional)
Select a vision provider from Settings > AI Settings to enable:
- Drawing type detection (floor plan, section, elevation)
- Material and element analysis
- OCR (text recognition)

---

### AI Sensitivity Filter (Admin)

Some files in your archive may contain sensitive information (salary tables, contracts, personal data). If you don't want these files appearing as results in AI chat, use the **AI Sensitivity Filter**.

**Why is this needed?** AI chat searches all scanned files. If a user asks "is there a salary table?", and such a file exists in the archive, AI will find and show it. The filter hides such files from AI.

**3 ways to protect:**

1. **Ready-made categories** — Enable from Settings > Security > AI Sensitivity Filter:
   - **Financial**: salary, invoice, quote, budget, progress payment...
   - **Personal Info**: national ID, phone, address...
   - **Legal**: contract, NDA, power of attorney...
   - **Human Resources**: personnel file, leave, record, performance...

2. **Custom keywords** — Add your own keywords (e.g. sensitive client name, project code)

3. **Per file/folder** — Right-click a file → "Hide from AI" or from the source folder menu → "Exclude from AI"

> **Note:** Hidden files continue to appear in the archive — search, filtering, and detail panel work normally. Only AI chat cannot access these files.

---

## 9.1 Right-Click Menu

Right-click on file cards and empty areas for quick actions.

### Right-Click on an Asset Card

Right-clicking a file card shows these options:

| Option | Function |
|--------|----------|
| **Download** | Downloads the file to your computer |
| **Open** | Opens the file with the default application |
| **Delete** | Deletes the file from the archive (confirmation dialog shown) |
| **Re-scan** | Re-indexes only this file |
| **Tag** | Adds or removes tags from the file |
| **Add to Favorites** | Adds the file to the favorites list |
| **Hide from AI** | Excludes this file from AI chat (admin) |

### Right-Click on Empty Area

Right-clicking an empty area in the grid shows these options:

| Option | Function |
|--------|----------|
| **Scan Folder** | Opens folder selection to start a new scan |
| **Create New Tag** | Defines a new tag for the archive |

---

## 9.2 Undo / Redo

You can undo actions made by mistake.

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** | Undoes the last action |
| **Ctrl+Y** | Re-applies the undone action |

**Undoable actions:**
- File deletion
- Folder deletion
- Chat deletion
- Group deletion

> **Trash:** Deleted folders and files are kept in the Trash for **30 days**. You can restore them within this period. They are permanently deleted after 30 days.

---

## 9.3 XMP Metadata Export

You can export your files' metadata in the standard XMP sidecar format:

1. Right-click the file → select **"Export XMP"**
2. A sidecar file with the `.xmp` extension is created next to the file (e.g. `plan.dwg` → `plan.xmp`)
3. If the file cannot be written next to the original (unauthorized location, etc.), it is automatically saved to the application data folder

The XMP file contains: file name, project name, category, tags, approval status, client name, version label, and rejection reason if any.

> **What is it for?** Tools like Adobe Bridge and Lightroom can read XMP files. If you migrate to another DAM software, your metadata is portable.

---

## 9.4 Health Check (Fixity Check)

You can run a health scan to verify the integrity of files in your archive:

1. Go to the **"Health Check"** section in Settings
2. Click **"Start Scan"**
3. The system performs a sample-based checksum verification of your files
4. Any changed or corrupted files are reported

This feature is especially useful for detecting **bit-rot** (silent data corruption) in large archives.

---

## 9.5 Multi-Archive

ArchivistPro can manage multiple archives in parallel. Switch between archives from the "Archive" section at the top of the left panel.

### Fixed Archives
- **Main Archive (shared)** — the shared archive managed by the admin
- **Local Archive (personal)** — a personal archive accessible only to you

### Custom Archives
Additional archives created by the admin (e.g. "Office Central", "Tower Project") are shown in the same tab row. Each archive has its own:

- Source folder list
- Asset collection
- Tag and favorites pool
- Scan settings

kept separately. When you switch between archives, the Source Folders and counts in the left panel automatically update to reflect the new archive.

### Merge and Extract (Admin)
An admin can merge two archives (Join/Merge) or extract a filtered subset from an archive (Extract). An automatic snapshot is taken before these operations and can be reverted if needed.

---

## 10. Downloading an Archive over LAN

You can download the archive shared by the admin over your local network.

### Connecting
1. Go to Settings > Network tab
2. Enter the information provided by the admin:
   - **IP Address** (e.g. `192.168.1.106`)
   - **Connection Code** (8-digit code)
3. Click "Connect"

### Downloading
If the connection is successful:
- The server version and database size are shown
- Click "Download Archive"
- Once the download is complete, the archive loads automatically
- No page refresh is required

### Archive Import (From File)
You can also receive an archive without a LAN connection:
1. Go to Settings > Network > click **"Import (.archivistpro)"**
2. Select the `.archivistpro` file provided by the admin
3. Review the manifest preview
4. Confirm — the archive loads

> **Note:** Both LAN download and file import update your current archive. Your session is preserved — no need to log in again.

---

## 11. Security and Privacy

- All AI operations run **on your local computer** (default)
- Your files are never sent to any server
- Cloud AI (Gemini, OpenAI) is used **only if you enable it**
- API keys are kept session-based and not saved to disk
- Destructive operations (deletion, bulk move) require a confirmation dialog

### Forgot My Password

If you forget your password, use the **"Forgot Password"** link on the login screen. You will need to obtain the `recovery.key` file (or its contents) from your admin. You can then set a new password with this key.

---

## 12. Duplicate & Similar File Finder

This tool shows repeated or similar files in your archive.

> **As a viewer:** You can run scans and view results. File **deletion is restricted to admins** — delete buttons are not shown.

### Accessing the Panel

Click the **⎇** icon in the top bar (between the trash and brain icons). Hovering shows "Find Duplicates".

### Scope Selection

When the panel opens, select the archive you want to scan from the tabs (Main Archive, Local Archive, and all custom archives you have added are listed).

> If the local archive hasn't been loaded yet, the tab appears inactive. Switch to the local archive from the sidebar and come back.

> **For large archives** (2000+ files), a warning is shown before starting the scan — scan time may vary depending on selected modes. You can stop the scan instantly with the **Cancel** button during scanning.

### Detection Modes

| Mode | What It Finds |
|------|--------------|
| **Exact Duplicate** | Files with identical content (SHA-256 hash match — may have different names/folders) |
| **Same Name** | Files with the same name in different folders (can be narrowed with General Criteria — e.g. same name + same size) |
| **Visual Similarity** | Visually similar photo/render/image files (pHash) |
| **Structural Similarity** | CAD/3D/document files with similar layer, material, or content structure (Jaccard + composite score) |

### Similarity Threshold

Use the slider to set sensitivity for **Visual** and **Structural** similarity:

- **Low %** → More, loosely matched results (may have false positives)
- **High %** → Fewer, only very similar results

### Advanced Criteria Panel

Clicking "Advanced Criteria" opens a panel with **4 sections**:

#### 1. General Criteria (cross-format pre-filter)
Adds extra conditions to Same Name and Structural Similarity modes:

- **Same file size** — with tolerance: exact match, ±1 KB, or ±1%
- **Modification date close** — N day window (1–365)
- **Same folder name** — parent folder name match (case-insensitive)

> Example: "Same name + same size" is a very strong duplicate signal — significantly reduces false positives.

#### 2. Format-Specific Criteria
Selects which metadata fields are compared in structural similarity. Grouped by format:

- **DWG / DXF**: Layers · Blocks · Text content · Xrefs
- **IFC**: Floor count · Entity count
- **3DS MAX**: Material list · Render engine · Max version
- **SketchUp**: Components · Layers · SketchUp version
- **Revit**: Floor names · Project name
- **PDF / Office**: Title · Author · Page count

#### 3. Performance Filters
Narrows the scan pool to increase speed:

- **Minimum file size (KB)** — files below this size are excluded from scanning entirely

#### 4. Format Visibility Filter
Adjusts which file categories appear in scan results in real time (no re-scan required):

CAD · BIM/3D · Document · Visual · Video · Backup

> A "Re-scan required" warning appears at the bottom of the panel when General Criteria or Performance settings are changed.

### Viewing Results

**List view:**

```
▼ VISUAL SIMILAR — 1 group
  ┌─────────────────────────────────────────────────┐
  │ render_v1.jpg   pHash diff: 5/64 bits → 92%    │
  │  /Render/render_v1.jpg   2.4 MB   2024-03-01   │
  │  /Render/render_v2.jpg   2.4 MB   2024-03-15   │
  └─────────────────────────────────────────────────┘
```

Click a group to expand/collapse. Each file's path, size, and date are shown.

### Comparison View

To inspect two files side by side, click the `[⎇]` icon, then switch to the **[Compare]** button at the top:

```
┌───────────────────┬───────────────────┐
│   render_v1.jpg   │   render_v2.jpg   │
│  [ preview ]      │  [ preview ]      │
│  2.4 MB           │  2.4 MB           │
│  2024-03-01       │  2024-03-15       │
├───────────────────┴───────────────────┤
│  Similarity: 92% · pHash Δ: 5/64 bit │
└───────────────────────────────────────┘
```

If you want to delete files, ask your admin for assistance.

---

## 13. Application Close Confirmation

When you try to close the window with the **X button** or **Alt+F4**, the application shows a confirmation dialog.

- **"Quit"** — closes the application
- **"Cancel"** — keeps you in the application

This protection prevents accidental closure in the middle of a scan or download.

---

*This guide is updated as the program evolves. Last update: 2026-05-05 (v2.4.4)*

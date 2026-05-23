# ArchivistPro — What Can I Do?

> Version 3.0.0 | 2026-05-23
>
> This guide introduces ArchivistPro through real office scenarios. Each scenario reads in 1 minute.

---

## 1. "I need to find the facade detail of last year's villa project"

1. Type **villa facade** in the search box
2. Results are sorted automatically — file names, project names, and AI tags are searched
3. From the **Category** filter on the left, choose "2D Drawing" to see only drawings
4. Click a file → preview, layers, and details appear in the right panel

> **Tip:** If you can't recall the exact word, type an approximation — even a typo like "fcade" still finds it (fuzzy search).

---

## 2. "Let me gather all the renders I'll send to the client"

1. From the **Category** filter on the left, choose **Render**
2. Click the renders you want one by one (or press Ctrl+A to select them all)
3. Right-click → **Tag** → create a tag like "Client Presentation"
4. From now on, you can reach those files at any time by selecting "Client Presentation" in the **Tag Filter** on the left

---

## 3. "Did this DWG have an older version?"

1. Find the DWG file and click it
2. Look at the **Linked Files** section in the right panel
3. The system **automatically** groups files like `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg` and shows them here
4. Click the name of a linked file to switch to that version

> If it isn't auto-detected: right-click the file → **Find Similar** — lists structurally similar DWGs.

---

## 4. "What did we use in other projects with a material like this?"

1. Find a render or photo you like
2. Right-click → **Find Similar**, or in the top bar **Advanced Search → Visual Search**
3. Upload the image — the system returns files similar in color, texture, and composition

> It works for DWG files too: layer structure, block structure, and text content are compared.

---

## 5. "I only want to see files modified this month"

1. Open the **Date Filter** in the left panel
2. Set the start date to the 1st of this month
3. Results update automatically — only the latest changes are shown
4. Set **Sort by** to "Modified date" to bring the newest to the top

---

## 6. "I want to pull the office archive onto my computer"

1. Get the following information from your admin: **IP address** and **8-digit connection code**
2. Go to Settings → Network tab
3. Enter the IP and code → **Connect**
4. Click the "Download Archive" button — the entire archive is on your computer in a few minutes

> No internet needed. Being on the same office network (Wi-Fi or cable) is enough.

---

## 7. "Let me check whether the same file exists in multiple copies"

1. Open **Advanced Search → Duplicate Finder** in the top bar
2. Pick the **Exact Duplicate** mode and click **Scan**
3. Files with identical content are listed in groups
4. Inspect them side by side in Comparison view
5. Select unnecessary copies and delete them (admin privileges required)

---

## 8. "Let me check whether there are drawings to approve" (admin)

1. Switch to **Dashboard** view
2. View the files waiting "In Review" in the **Approval Queue** panel
3. Click a file to inspect it
4. **Approve** or **Reject** (write a rejection reason)
5. Every change is recorded in **Approval History**

---

## 9. "I want to ask my archive questions with AI"

1. Click the **AI** button in the top bar
2. Type a natural-language question:
   - *"Are there any drawings with a wooden facade detail?"*
   - *"Is there a file mentioning 'Hüvellezi'?"*
   - *"List the PDFs added in the last 3 months"*
   - *"What materials were used in kitchen projects?"*
   - *"Which DWG files show stairs?"*
3. AI scans your archive and answers with citations
4. Click a citation to jump straight to that file

> AI runs entirely on your computer. Your files are not sent to the internet.
>
> **v3.0.0 Tip:** Yes/no questions like "Is there an X?" / "Does Y
> exist?" are answered directly as a file list — no waiting for the LLM,
> instant results.

---

## 10. "I want to export a file's metadata"

1. Right-click the file → **Export XMP**
2. A sidecar with the `.xmp` extension is created next to the file
3. You can open this file with Adobe Bridge, Lightroom, or other DAM tools

---

## 11. "I just upgraded from an earlier version, what changed?"

1. On the **first launch** your archive is automatically migrated to the
   new architecture
2. It takes a few seconds; you see a brief notification
3. After migration, everything works as before — search, scan, AI chat,
   tags, collections
4. In your archive folder you will see two new files:
   - `archivist_vec.db` — vector data (embeddings, text chunks)
   - `archivist_premigrate_v3.db.bak` — backup of the previous version

> **Don't worry:** Your data is safe. The `.bak` file is a complete
> snapshot of your archive **before** the migration. After confirming
> everything works for a week, you can delete the `.bak` file.

> **For backups:** In the previous version you only copied
> `archivist.db`. Now copy **both files together** (`archivist.db` +
> `archivist_vec.db`). The built-in backup/snapshot system handles this
> automatically.

---

## 12. "I don't want sensitive files to come up in AI chat" (admin)

If your archive contains contracts, salary tables, or confidential client information:

1. Open **Settings → Security → AI Sensitivity Filter**
2. Activate the relevant category (Financial, Personal, Legal, HR)
3. Add custom keywords if needed (e.g. a client name)
4. For a single file: right-click the file → **"Hide from AI"**
5. For an entire folder: from the source folder menu → **"Exclude from AI"**

> Hidden files remain visible in the archive; only AI chat cannot reach them.

---

## Daily Shortcuts

| What do you want to do? | How? |
|--------------------------|------|
| Search for a file | Type in the search box |
| Search with multiple words | `plan AND section` or `"floor plan"` |
| Open a file | Double-click or right-click → Open |
| Tag a file | Right-click → Tag |
| Add to favorites | Star icon in the detail panel |
| Undo the last action | Ctrl+Z |
| Get help | F1 or the ? icon at the bottom left |

---

*Have a question? Ask your admin or press F1 in the application to open the help guide.*

*Last update: 2026-05-23 (v3.0.0).*

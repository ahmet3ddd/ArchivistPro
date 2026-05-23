# ArchivistPro — Derin Kod Analizi ve Durum Raporu

**Tarih:** 2026-04-11
**Sürüm:** 2.2.1 (commit `ba94275`)
**Branş:** main
**Önceki rapor:** `AUDIT_REPORT_2026-04-07.md` (9.3/10 güvenlik) · `MULTI_PERSPECTIVE_REVIEW_2026-04-10.md` (7.14/10 çok perspektif)
**Takip raporu:** `SECURITY_HARDENING_2026-04-11.md` — Bu raporda işaretlenen kritik + yüksek öncelikli güvenlik borçlarının aynı gün kapatıldığı sertleştirme çalışması

---

## 0. Yönetici Özeti

v2.2.1 **artık "erken beta" değil** — **gerçek bir olgun beta**. Son 5 gün içinde çoklu arşiv sistemi (Faz 1-3), imzalı updater pipeline'ı, tam offline AI paketi, 5 dil ve MIT LICENSE eklenmiş durumda. Testler tamamen yeşil, TypeScript ve Rust hatasız derleniyor.

> **Güncelleme (2026-04-11, aynı gün):** Bu raporda tespit edilen K-1..K-4 (kritik) ve Y-1..Y-4 (yüksek) güvenlik bulguları **tamamen kapatıldı** — yazma komutlarına `require_authenticated` guard, `create_archive_file` path allowlist, LAN 8-digit auth + rate limit + constant-time, `/dev-feedback` auth kapsamına alındı, `verifyPassword` constant-time, audit log tamper markerleri, `recovery.key` hex validation. Detay: `SECURITY_HARDENING_2026-04-11.md`. Mimari amaç temeli (full-disk tarama, LAN paylaşım, viewer mesajlaşma) korundu.

**Öne çıkan borçlar:**
1. Windows Authenticode/EV sertifikası (updater için minisign imzalama var, installer için Authenticode yok → SmartScreen uyarısı devam ediyor)
2. Test kapsamı: kod %25-27 büyüdü ama test kapsamı %60→%50 **düştü** (kritik servisler %16-28)
3. Docs drift: README/MEMORY/CLAUDE versiyon ve özellik listesi güncel değil
4. Arşivcilik kavramları (fixity, retention, taksonomi) hâlâ eksik

---

## 1. Ölçülen Rakamlar (Doğrulanmış)

| Metrik | Değer | Önceki (MEMORY.md) |
|---|---|---|
| Versiyon | **2.2.1** | 2.0.0-beta |
| Son commit | `ba94275 chore(release): v2.2.1` | — |
| Rust modülü | **21 dosya, 8.543 satır** | 19 dosya |
| Tauri komutu | **81** `#[tauri::command]` | 71+ |
| Frontend servisi | **35 dosya, 11.730 satır** | 33 dosya |
| React bileşeni | **41 dosya, 15.791 satır** | 36 dosya |
| Test dosyası | **36 dosya, 6.260 satır** | 28 dosya |
| Test sonucu | **617 / 617 geçti** (0 fail, 66.40s) | 560 test |
| Kod kapsamı | **Stmt %50.08 · Branch %42.34 · Func %62.86 · Lines %51.39** | ~%60 / %50 ⬇ |
| TypeScript (`tsc --noEmit`) | **0 hata** | — |
| Rust (`cargo check`) | **0 hata, 0 warning, 11.98s** | — |
| i18n dil sayısı | **5** (tr, en, zh, ja, ar) | 2 (tr+en) |
| i18n doluluk | tr/en: 1342 key · zh/ja/ar: 1103 key (~%82) | — |
| DB tablosu | **16** | 15 |
| A11y (aria/role) | **100 kullanım · 29 dosya** | 0 (2/10) |

---

## 2. Son Auditten Bu Yana Kapatılan/Eklenen

### Production Altyapısı

| Alan | Eski Durum (MEMORY 2026-04-05) | Yeni Durum |
|---|---|---|
| **Auto-update endpoint** | Placeholder | `github.com/ahmet3ddd/Arsiv-H2/releases/.../latest.json` (canlı) |
| **Updater pubkey** | Yok | Gerçek minisign pubkey aktif |
| **Release pipeline** | Draft workflow | `release.yml` — tag-tabanlı, TAURI_SIGNING_PRIVATE_KEY secret, ODA installer otomatik indirme, Transformers.js modelleri paketleme, `.msi.sig` + `latest.json` otomatik üretimi |
| **Code signing (updater)** | Yok | **Minisign .msi.sig imzalama aktif** (Authenticode değil) |
| **README.md** | Yok | **Var** (ama v2.0.0-beta drift ediyor) |
| **LICENSE** | Yok | **MIT** (Copyright 2026 ArchivistPro) |
| **Kurulum rehberleri** | Sadece TR | **5 dil** (TR/EN/ZH/JA/AR × KULLANICI + INSTALL) |
| **AI offline paketleme** | CDN bağımlı | **Tam offline**: Transformers.js modelleri + ort WASM paketleniyor (`scripts/download-models.sh`, `public/models/`, `public/ort/`) |
| **Embedding modeli** | Sadece CLIP (512-dim) | **paraphrase-multilingual-MiniLM-L12-v2** (384-dim, Türkçe dahil 50+ dil) metin için + CLIP görsel için |

### Yeni Büyük Özellikler

#### 1. Çoklu Arşiv Sistemi (Faz 1-3) — `src/services/archiveOps.ts` (1.123 satır)
- `withArchive(id, op)` context switcher, `ArchiveDef` (shared/personal)
- **Join/Merge**: `ConflictStrategy` (`keep_newer` / `keep_both` / `skip_existing`), paralel kilit (`JoinBusyError`), snapshot rollback (`JoinRollbackFailedError`)
- **Extract**: filtreli dışa çıkarma + move modu
- Yeni generic Rust komutları: `read_archive`, `write_archive`, `create_archive_file`, `delete_archive_file`, `list_extra_archives`, `get_archive_info`
- UI: `ArchiveMergeModal.tsx` (516 satır), `ArchiveExtractModal.tsx` (974 satır)

#### 2. Kaynak Klasör Yönetimi
- Yeni tablolar: `scanned_roots`, `root_groups`, `root_tags`
- `SourceFoldersPanel.tsx` (684 satır) — grup/renk/sıralama/favori kökler
- `rootTagService.ts` (137 satır) — hiyerarşik klasör etiketleri
- Grup bazlı filtreleme, kaynak klasör rescan + advanced criteria portal

#### 3. Kopya Bulucu (Duplicate Finder) — Tam Yeniden Yazım
- `duplicateDetection.ts` (792 satır) · `DuplicateFinderModal.tsx` (**1.274 satır**)
- **Content hash** (`contentHash` kolonu): birebir kopya için gerçek içerik SHA
- pHash benzerlik uyarıları + yapısal metadata karşılaştırma (DWG/RVT/PDF/Office/MAX/SKP)
- Format filtresi, karşılaştırma kriterleri, iki adımlı sezgisel seçim UX
- Metadata eksikliği uyarısı + hedefli yeniden tarama (`forcePaths` cache bypass)
- Yapısal tarama performans uyarısı, eksik metadata dosya listesi + "Yeniden Tara" butonu

#### 4. DB Recovery Sistemi
- `wasDbRecovered()` · Rust `read_database` corrupted flag (magic-byte kontrolü)
- Frontend `exec('SELECT 1')` sağlık kontrolü + atomic backup
- Setup sırasında bozuk DB'yi otomatik yedekleyip temiz başlatma

#### 5. ODA FileConverter Bundled Installer
- Yeni komutlar: `install_bundled_oda`, `check_bundled_oda`, `run_local_oda_installer`
- `release.yml` otomatik indirme (`ODAFileConverter_QT6_Win64dll_25.12.exe`)
- ODA pencere gizleme + modal entegrasyon

#### 6. Geliştirici Bayrağı (is_developer)
- `SessionDeveloperState` Rust state
- `tauri_set_session_developer` komutu
- `require_developer_or_admin()` guard
- Mesajlaşma panelinde dev etiketi, geliştirici-only işlemler

#### 7. Accent Color Sistemi ve Tema
- `themeService.ts` accent color
- Çöp kutusu iyileştirmeleri

#### 8. Metadata Çıkarım Komutları (Atıl olanlar devreye alındı)
- Tarama sırasında çalışan: `extract_max_metadata`, `extract_skp_metadata`, `extract_pdf_metadata`, `extract_office_metadata`, `extract_video_metadata`, `extract_text_metadata`, `extract_image_metadata`, `extract_rvt_metadata`, `extract_ifc_metadata`
- RVT yapısal karşılaştırma eklendi

#### 9. Tarih/Zaman İyileştirmeleri
- JPEG/PNG EXIF DateTimeOriginal → `asset.createdAt`
- DWG/PDF iç tarihleri OS tarihi yerine öncelikli
- Tarama süresi takibi ve kalıcı gösterim
- Son tarama bilgisi arşive göre ayrı tutuluyor

#### 10. UX İyileştirmeleri
- Canlı üst-tik filtreleri (yeniden tarama gerektirmez)
- Karşılaştırma modu (iki dosya seçimi, preview panelinde 6+ format)
- Arama geçmişi, DWG/DXF/SKP versiyon bilgisi çıkarımı
- DashboardView'dan proje safhaları/malzeme grupları kaldırıldı (sadeleştirme)
- TechnicalView sadeleştirme (malzeme/safha sütunları kaldırıldı)
- Mesajlar paneli UX, viewer gelen kutusu silme

---

## 3. Kod Sağlığı

### Tip/Derleme
- **TypeScript**: `tsc --noEmit` → 0 hata
- **Rust**: `cargo check` → 0 hata, 0 warning (11.98s)
- **Clippy**: `manual_strip` + `bool_comparison` uyarıları giderilmiş (commit `b985fb4`)

### Test (617/617 ✓)
```
Test Files  35 passed (35)
     Tests  617 passed (617)
  Duration  66.40s
```

### Kapsam (⚠ Düştü)
```
All files          Stmt 50.08% · Branch 42.34% · Func 62.86% · Lines 51.39%
```

**En zayıf kritik servisler:**

| Servis | Stmt | Satır | Not |
|---|---|---|---|
| `rootTagService.ts` | **%1.53** | 137 | Yeni, neredeyse test yok |
| `embeddings.ts` | **%16.35** | 348 | CLIP/MiniLM, ağır AI bağımlılığı |
| `fileScanner.ts` | **%16.92** | 1.811 | En kritik iş mantığı |
| `database.ts` | **%27.88** | 2.353 | En büyük ve en kritik dosya |
| `hardwareDetect.ts` | %37.14 | 123 | — |
| `useStore.ts` | %42.46 | — | Zustand store |

**Kapsamı yüksek olanlar:** `batchActions` (89), `dbSnapshot` (96), `exportService` (92), `helpSystem` (100), `textChunking` (100), `undoRedo` (100), `useFocusTrap` (87), `useHybridFilteredAssets` (100), `colorConvert` (98), `markdownRenderer` (95)

Kod %25-27 büyüdü ama test katmanı büyümeye yetişemedi → genel oran düştü. **Borç büyüyor.**

---

## 4. Güvenlik Durumu

### Korunan Güvenlik Tedbirleri
- **RBAC çift katmanlı**: Frontend `<ProtectedAction>` + Rust `require_admin()` / `require_developer_or_admin()`
- **Path traversal**: Çift katman (literal + canonicalize)
- **PBKDF2-SHA256**: 100K iter, 16B salt, auto-migration
- **XSS**: `escapeHtml` + DOMPurify + React JSX
- **CSP**: `default-src 'self'`, `wasm-unsafe-eval`, `style-src 'unsafe-inline'` (fonksiyonel ama enterprise-grade değil)
- **SSRF koruması**: Ollama proxy allowlist
- **Audit log**: 3 katman (DB + System + Debug)
- **Fs scope**: `$HOME`, `$APPDATA`, `**` (tüm diskten tarama için genişletilmiş — commit `313a0a9`)

### Açık Güvenlik Zayıflıkları
- **`clearAuditLogs()`** DB'den silinebilir — tamper-proof değil
- **LAN auth**: 6-digit code (brute-forceable), fallback `subsec_nanos()` tahmin edilebilir, rate limit yok, TLS yok
- **Code signing**: Authenticode/EV cert yok → Windows SmartScreen uyarısı
- **Session timeout, 2FA, account recovery**: Yok

---

## 5. Docs Drift (Aktif Sorunlar)

| Dosya | Diyor | Gerçek | Etki |
|---|---|---|---|
| `MEMORY.md` (auto) | v2.0.0-beta, 560 test, 28 dosya, TR+EN, CLIP primary, README yok, LICENSE yok | v2.2.1, 617 test, 36 dosya, 5 dil, MiniLM primary, README var, MIT | Claude'un kendi hafızası eski |
| `README.md` | v2.0.0-beta, "TR+EN" | v2.2.1, 5 dil | Yeni kullanıcı yanlış ilk izlenim |
| `CLAUDE.md` | "71+ komut", "2 dil" | 81 komut, 5 dil | AI asistan yanlış varsayımla başlar |
| `.claude/MEMORY.md` | v2.0.0-beta, 7.26/10 | v2.2.1, ~7.5/10 | Cross-machine hafıza eski |

---

## 6. Hâlâ Açık / Zayıf Alanlar

| Alan | Skor | Neden |
|---|---|---|
| **Test kapsamı** | 5/10 | %50 stmt, kritik servisler %16-28 |
| **Code signing (Authenticode/EV)** | 3/10 | Updater minisign var, installer Authenticode yok |
| **Lisanslama (seat/trial)** | 2/10 | Hâlâ yok (MIT = yazılım lisansı, kullanım lisansı değil) |
| **Erişilebilirlik (WCAG)** | 5/10 | 0'dan 100 aria'ya çıkmış ama hâlâ Level A değil |
| **Cross-platform** | 4/10 | Sadece Windows (MSI/NSIS) |
| **Fixity/retention** | 3/10 | Periyodik bit-rot kontrolü yok, retention metadata yok |
| **Controlled vocabulary** | 4/10 | Hiyerarşik taksonomi (ISAD/DACS) yok |
| **Merkezi telemetry** | 5/10 | Crash loglar yerel (FIFO 20), Sentry yok |
| **Vektör ölçeklenebilirlik** | 5/10 | FAISS/HNSW yok (50K+ asset'te memory sorunu) |
| **OCR** | 5/10 | Sadece Ollama LLM (Tesseract/PaddleOCR yok) |
| **database.ts modülerlik** | 6/10 | 2.353 satır tek dosya |
| **5 hardcoded TR string** | — | `ConfirmDialog:70`, `SidebarConfigModal:146`, `TopBar:42`, `RefileModal:332-334`, `data.ts:432` (`AUDIT_REPORT_2026-04-07` open items) |

---

## 7. Üçgenlenmiş Skor

| Kaynak | Skor | Kapsam |
|---|---|---|
| İç güvenlik denetimi (2026-04-07) | **9.3/10** | 44 bulgu / 7 tur / 0 açık kritik |
| Çok perspektifli değerlendirme (2026-04-10) | **7.14/10** | Arşivci 6.75 · Kullanıcı 7.69 · BT 6.98 |
| Bu rapor (2026-04-11) | **~7.5/10** | Yeni özellikler olgun, test kapsamı borç |

---

## 8. Sonraki Sürüm İçin Öncelikler

### Hızlı Kazanımlar (1-3 gün)
1. **Docs drift kapatma** — README (v2.2.1 + 5 dil), CLAUDE.md (81 komut), MEMORY.md (otomatik)
2. **5 hardcoded TR string** — i18n'e taşıma (2 saat)
3. **zh/ja/ar locale tamamlama** — 225 key eksik (LLM destekli)

### Orta Vadeli (1-3 hafta)
4. **`database.ts` bölme** — `schema.ts`, `assetRepo.ts`, `archiveRepo.ts`, `auditRepo.ts`
5. **Test kapsamı artırma** — `fileScanner.ts` ve `database.ts` için %50+ hedef
6. **Periyodik fixity check** — Haftalık SHA-256 yeniden doğrulama + `fixity_log` tablosu

### Stratejik (1-3 ay)
7. **Controlled vocabulary** — Hiyerarşik taksonomi ağacı (ISAD/DACS)
8. **Retention metadata** — `retention_until`, `retention_policy` + otomatik "süresi dolan" filtresi
9. **Mac/Linux build** — Tauri zaten destekliyor
10. **Authenticode/EV code signing** — SmartScreen uyarısını kaldırmak için

---

## 9. Teknik Notlar (Değişmeyen)

- **DWG R2004+** (AC1018+): sentinel(16) + 4-byte overall_size
- **MAX thumbnail**: OLE `\x05SummaryInformation`, property 0x11 (VT_CF), DIB
- **MAX versiyon**: `year = version_int + 1998` (V10/Max2008+)
- **sql.js WASM**: `CREATE TABLE IF NOT EXISTS` kolon eklemez — migration gerekir
- **`thumbnailUrl` öncelik**: Rust base64 > convertFileSrc > FallbackThumb
- **CLIP görsel**: 512-dim embedding, cosine similarity, threshold 0.25
- **MiniLM metin**: 384-dim, çok dilli, normalize edilmiş
- **pHash**: 32×32 DCT, 8×8 top-left, median threshold, 64-bit hash

---

**Doğrulama komutları:**
```bash
npx tsc --noEmit                                   # TypeScript tip kontrolü
cargo check --manifest-path src-tauri/Cargo.toml   # Rust derleme
npx vitest run                                     # 617 test
npx vitest run --coverage                          # Kapsam raporu
```

**Kontrol edilen dosyalar:** `package.json`, `Cargo.toml`, `tauri.conf.json`, `lib.rs`, `database.ts`, `archiveOps.ts`, `embeddings.ts`, `release.yml`, `capabilities/default.json`, `AUDIT_REPORT_2026-04-07.md`, `MULTI_PERSPECTIVE_REVIEW_2026-04-10.md`, `TODO.md`, `.claude/MEMORY.md`, `README.md`, `LICENSE`.

# ArchivistPro — Geliştirici Rehberi

<!-- AUTO-UPDATE-START — Bu bölüm scripts/update-docs.sh tarafından otomatik güncellenir -->
| Bilgi | Deger |
|-------|-------|
| **Versiyon** | 2.4.10 |
| **Son Guncelleme** | 2026-05-21 |
| **Son Commit** | 92ce74d |
| **Frontend** | 82735 satir TypeScript/TSX |
| **Backend** | 22885 satir Rust |
| **Bilesenler** | 99 React component |
| **Servisler** | 57 TypeScript servisi |
| **Hook'lar** | 25 React hook |
| **Rust Modulleri** | 36 modül |
| **Tauri Komutlari** | 168+ komut |
| **Diller** | 5 (tr, en, zh, ja, ar) |
| **Veritabani Tablolari** | 27 tablo |
<!-- AUTO-UPDATE-END -->

---

## Icindekiler

1. [Mimari Genel Bakis](#1-mimari-genel-bakis)
2. [Dizin Yapisi](#2-dizin-yapisi)
3. [Gelistirme Ortami Kurulumu](#3-gelistirme-ortami-kurulumu)
4. [Build Sistemi ve Modlar](#4-build-sistemi-ve-modlar)
5. [Veritabani Semasi](#5-veritabani-semasi)
6. [Rust Backend Referansi](#6-rust-backend-referansi)
7. [Frontend Servis Katmani](#7-frontend-servis-katmani)
8. [React Bilesen Katalogu](#8-react-bilesen-katalogu)
9. [Hook Referansi](#9-hook-referansi)
10. [State Yonetimi (Zustand)](#10-state-yonetimi-zustand)
11. [Izin ve Rol Sistemi](#11-izin-ve-rol-sistemi)
12. [Dosya Tarama Pipeline'i](#12-dosya-tarama-pipelinei)
13. [AI ve Semantik Arama](#13-ai-ve-semantik-arama)
14. [LAN Paylasim ve Sunucu](#14-lan-paylasim-ve-sunucu)
15. [Mesajlasma Sistemi](#15-mesajlasma-sistemi)
16. [Uluslararasilastirma (i18n)](#16-uluslararasilastirma-i18n)
17. [Hata Yonetimi ve Crash Raporlama](#17-hata-yonetimi-ve-crash-raporlama)
18. [Test Stratejisi](#18-test-stratejisi)
19. [Tauri Yapilandirmasi](#19-tauri-yapilandirmasi)
20. [Bagimlilklar](#20-bagimliliklar)
21. [Performans Notlari](#21-performans-notlari)
22. [Yeni Ozellik Ekleme Rehberi](#22-yeni-ozellik-ekleme-rehberi)
23. [Bilinen Kisitlamalar](#23-bilinen-kisitlamalar)
24. [Dosya Referans Indeksi](#24-dosya-referans-indeksi)

---

## 1. Mimari Genel Bakis

ArchivistPro, mimarlik ofisleri icin tasarlanmis bir **masaustu arsiv yonetim uygulamasidir**.
Tamamen offline calisir; LAN uzerinden paylasim destekler.

```
┌─────────────────────────────────────────────────────────┐
│                    KULLANICI ARAYUZU                     │
│  React 19 + TypeScript + TailwindCSS 4 + Zustand 5     │
│  56 Bilesen · 47 Servis · 17 Hook                       │
├─────────────────────────────────────────────────────────┤
│                     TAURI V2 KOPRUSU                    │
│  invoke() / listen() / emit()                           │
├─────────────────────────────────────────────────────────┤
│                      RUST BACKEND                       │
│  23 Modül · 105 Komut · tiny_http LAN sunucu             │
│  DWG/DXF/MAX/SKP/PSD/PDF/Office/Video parser            │
├─────────────────────────────────────────────────────────┤
│                     DEPOLAMA KATMANI                    │
│  SQLite (sql.js WASM) — cift arsiv: main + local        │
│  Tauri disk I/O (read_database / write_database)        │
└─────────────────────────────────────────────────────────┘
```

### Temel Tasarim Kararlari

| Karar | Neden |
|-------|-------|
| sql.js (WASM SQLite) | Tamamen offline, harici DB sunucu gerektirmez |
| Transformers.js | Yerel embedding, veri disari cikmaz (gizlilik) |
| Cift arsiv modeli | Admin kuratoryasi + kullanici kisisel calismasi |
| Rol tabanli derleme + runtime | Tek binary, feature flag ile esnek dagitim |
| Zustand | Basit tek store, Redux karmasikligi yok |
| tiny_http | Hafif LAN sunucu, harici bagimlilik minimizasyonu |
| Tauri v2 | Guvenlik odakli IPC, capability tabanli izin sistemi |

### Veri Akisi

```
Kullanici Eylemi (ornegin "Klasor Tara")
    │
    ▼
React Bilesen (ScanModal.tsx)
    │ onClick → useScanWorkflow hook
    ▼
Servis Katmani (fileScanner.ts)
    │ invoke('extract_dwg_metadata', {path})
    ▼
Tauri IPC Koprusu
    │ serde JSON serialize/deserialize
    ▼
Rust Handler (dwg_parse.rs → extract_dwg_metadata)
    │ Binary dosya okuma + parse
    ▼
Sonuc JSON → React → upsertAsset() → SQLite
    │
    ▼
Zustand Store guncelleme → UI yeniden render
```

---

## 2. Dizin Yapisi

```
ArchivistPro/
├── src/                          # React frontend (TypeScript)
│   ├── App.tsx                   # Kok bilesen, hook kompozisyonu
│   ├── main.tsx                  # Vite giris noktasi
│   ├── appVersion.ts             # APP_VERSION, APP_BUILD_DATE sabitleri
│   ├── types.ts                  # Asset, FacetKey, SearchResult tipleri
│   ├── data.ts                   # Mock veri, faset grupları, yardimci fonksiyonlar
│   ├── index.css                 # Global stiller + Tailwind
│   │
│   ├── components/               # 56 React bilesen (TSX); chat/ alt dizini 8 parcali ChatPanel
│   ├── services/                 # 47 is mantigi servisi (TS)
│   ├── hooks/                    # 17 ozel React hook (TS)
│   ├── store/                    # Zustand state yonetimi
│   │   └── useStore.ts           # Tek kaynak: AppState + actions
│   ├── permissions/              # RBAC sistemi
│   │   ├── roles.ts              # Rol ve izin tanimlari
│   │   ├── usePermission.ts      # useIsAdmin, useAppRole hook'lari
│   │   └── ProtectedAction.tsx   # Rol korunmali bilesen sargisi
│   ├── i18n/                     # Uluslararasilastirma
│   │   ├── index.ts              # i18next yapilandirmasi
│   │   └── locales/              # tr.json, en.json, zh.json, ja.json, ar.json
│   ├── config/
│   │   └── constants.ts          # Zamanlama sabitleri (timeout, interval)
│   ├── utils/                    # Yardimci fonksiyonlar
│   │   ├── invokeWithTimeout.ts  # Tauri invoke + timeout sarici
│   │   ├── colorConvert.ts       # sRGB↔LAB donusumu
│   │   └── searchScoring.ts      # Hibrit arama puanlama
│   └── tests/                    # Vitest birim testleri
│
├── src-tauri/                    # Rust backend
│   ├── src/                      # 19 Rust modulu
│   │   ├── lib.rs                # Komut kaydi, makrolar, SessionRoleState
│   │   ├── main.rs               # Tauri giris noktasi (6 satir)
│   │   ├── ollama_db.rs          # DB depolama, Ollama proxy, SSRF kontrolu
│   │   ├── lan_server.rs         # LAN HTTP sunucu (port 9471)
│   │   ├── dwg_parse.rs          # DWG binary parser (1044 satir)
│   │   ├── thumbnails.rs         # PSD/TGA/TIFF/DWG/MAX/SKP thumbnail
│   │   ├── image_analysis.rs     # EXIF, renk analizi, pHash
│   │   ├── max_version.rs        # 3ds Max surum + donusturme
│   │   ├── skp_version.rs        # SketchUp surum + metadata
│   │   ├── office_utils.rs       # MS Office CFB parse
│   │   ├── video_metadata.rs     # Video codec/frame bilgisi
│   │   ├── dxf_parse.rs          # DXF ASCII format parse
│   │   ├── pdf_metadata.rs       # PDF yapi ve metadata
│   │   ├── text_extract.rs       # Tam metin cikarma (indexleme icin)
│   │   ├── text_metadata.rs      # Dokumanmetin metadata
│   │   ├── archive_share.rs      # ZIP tabanli arsiv import/export
│   │   ├── crash_report.rs       # Panic yakalama + dosya kaydi
│   │   ├── refile_fs.rs          # Dosya sistemi islemleri (admin-only)
│   │   └── thumb_util.rs         # JPEG encode yardimci
│   ├── Cargo.toml                # Rust bagimliliklari
│   ├── tauri.conf.json           # Tauri yapilandirma
│   └── capabilities/
│       └── default.json          # Plugin izinleri
│
├── docs/                         # Dokumantasyon
│   ├── DEVELOPER_GUIDE.md        # Bu dosya
│   ├── TECHNICAL_REFERENCE.md    # Teknik referans
│   └── INSTALL.md                # Kurulum rehberi
│
├── e2e/                          # Playwright E2E testleri
├── scripts/                      # Otomasyon scriptleri
│   └── update-docs.sh            # Dokumanı oto-guncelleyen script
├── public/                       # Statik dosyalar (sql-wasm.wasm)
├── vite.config.ts                # Vite build yapilandirmasi
├── tsconfig.json                 # TypeScript kok yapilandirmasi
├── package.json                  # npm bagimliliklari
└── .git/hooks/pre-commit         # Oto-dokumasyon hook
```

---

## 3. Gelistirme Ortami Kurulumu

### On Kosullar

| Arac | Minimum Surum | Not |
|------|--------------|-----|
| Node.js | 20+ | npm dahil |
| Rust | 1.77.2+ | rustup ile |
| Tauri CLI | 2.x | `npm install` ile gelir |
| Visual Studio Build Tools | 2022 | Windows C++ derleyici |

### Ilk Kurulum

```bash
# 1. Repoyu klonla
git clone https://github.com/ahmet3ddd/Arsiv-H2.git
cd Arsiv-H2/ArchivistPro

# 2. Frontend bagimliliklari
npm install
# → postinstall: sql-wasm.wasm → public/ dizinine kopyalanir

# 3. Gelistirme sunucusu (frontend + Tauri)
npm run tauri dev
# veya sadece frontend:
npm run dev
```

### Gelistirme Modlari

```bash
npm run dev              # Varsayilan (admin modu)
npm run dev:admin        # Acik admin modu
npm run dev:viewer       # Viewer (salt-okunur) modu
```

### Build

```bash
npm run build            # Frontend build (dist/)
npm run build:admin      # Admin modu build
npm run build:viewer     # Viewer modu build
npm run tauri build       # Tam masaustu uygulama (.msi, .exe)
```

### Test

```bash
npm test                 # Vitest birim testleri
npm run test:e2e         # Playwright E2E
npm run lint             # ESLint
npx tsc --noEmit         # TypeScript tip kontrolu
cargo check --manifest-path src-tauri/Cargo.toml  # Rust derleme kontrolu
```

---

## 4. Build Sistemi ve Modlar

### Rol Tabanli Build

Uygulama iki rolde derlenebilir:

| Mod | Env Degiskeni | Cargo Feature | Fark |
|-----|--------------|---------------|------|
| **admin** | `VITE_APP_ROLE=admin` | `default = ["admin"]` | Tam yetki: tarama, dosya duzenleme, kullanici yonetimi |
| **viewer** | `VITE_APP_ROLE=viewer` | `viewer` | Ana arsiv salt-okunur, yerel arsiv tam erisim |

### Vite Yapilandirmasi

```typescript
// vite.config.ts
{
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ['sql.js'] },
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1000 },
  test: { globals: true, environment: 'jsdom' }
}
```

### TypeScript Yapilandirmasi

- **Target**: ES2022
- **Strict mode**: Acik
- **noUnusedLocals / noUnusedParameters**: Acik
- **JSX**: react-jsx (otomatik import)
- **moduleResolution**: bundler

### Cargo Ozellikleri

```toml
[features]
default = ["admin"]
admin = []
viewer = []
```

`lib.rs`'deki makro sistemi:
- `shared_handlers!()` — Her iki role ortak 80+ komut
- `all_handlers!()` — `#[cfg(feature = "admin")]` ile ek komutlar (refile, max convert)

---

## 5. Veritabani Semasi

ArchivistPro SQLite kullanir (sql.js WASM). Iki ayri veritabani vardir:

- **mainDb** — Ana arsiv (admin yonetir, viewer salt-okunur erisir)
- **localDb** — Yerel arsiv (her rol tam erisim)

### Tablo Referansi

#### assets (Ana Tablo)
```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  file_name TEXT, file_path TEXT, file_size INTEGER,
  file_type TEXT, category TEXT,
  created_at TEXT, modified_at TEXT,
  project_name TEXT, project_phase TEXT,
  material_group TEXT, color_theme TEXT,
  architectural_style TEXT, omniclass_code TEXT,
  is_indexed INTEGER DEFAULT 0,
  hash TEXT,                    -- SHA-256 icerik hash'i
  phash TEXT,                   -- Perceptual hash (gorsel benzerlik)
  metadata_json TEXT,           -- AssetMetadata JSON
  ai_tags_json TEXT,            -- AITag[] JSON
  color_palette_json TEXT,      -- ColorPalette[] JSON
  thumbnail_url TEXT,           -- Base64 veya asset:// URL
  raw_metadata TEXT,            -- Ham metadata JSON
  metadata_version INTEGER,     -- Yeniden parse icin sema versiyonu
  extracted_at TEXT             -- ISO tarih
);
```

#### embeddings (Vektor Depolama)
```sql
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  ref_id TEXT,                  -- chunk referansi
  vector_json TEXT,             -- Float32 dizi JSON [0.12, -0.34, ...]
  source TEXT,                  -- 'text', 'clip-image', 'chunk-0' vb.
  created_at TEXT
);
-- Indeksler: asset_id, source, ref_id
```

#### text_chunks (Metin Parçalari)
```sql
CREATE TABLE IF NOT EXISTS text_chunks (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  chunk_index INTEGER,
  page INTEGER,
  text TEXT,
  lang TEXT,
  created_at TEXT
);
-- Indeks: asset_id
```

#### user_messages (Mesajlasma)
```sql
CREATE TABLE IF NOT EXISTS user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT, sender_role TEXT,
  recipient TEXT,
  message_type TEXT,  -- 'suggestion' | 'private' | 'developer'
  priority TEXT,      -- 'normal' | 'important'
  subject TEXT, body TEXT,
  status TEXT,        -- 'unread' | 'read' | 'resolved'
  parent_id INTEGER REFERENCES user_messages(id),
  created_at TEXT
);
-- Indeksler: sender, status, parent_id, recipient
```

#### users (Kimlik Dogrulama)
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,           -- PBKDF2-SHA256 + salt
  display_name TEXT,
  role TEXT,                    -- 'admin' | 'viewer'
  avatar TEXT,
  is_blocked INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
```

#### app_settings (Anahtar-Deger Deposu)
```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Kullanim: dev_mode, dev_ip gibi calisma zamani ayarlari
```

#### Diger Tablolar

| Tablo | Amac |
|-------|------|
| `asset_summaries` | AI tarafindan uretilen ozet ve anahtar kelimeler |
| `projects` | Proje isimleri ve safhalari |
| `scan_log` | Tarama gecmisi kaydi |
| `audit_log` | Yonetici eylem izi (timestamp, action, target, result) |
| `tags` | Kullanici tanimli etiketler (ad, renk) |
| `asset_tags` | Asset ↔ Tag coka-cok iliskisi |
| `favorites` | Favori isaretleri |
| `collections` | Koleksiyonlar (ad, renk) |
| `collection_items` | Koleksiyon ↔ Asset coka-cok iliskisi |
| `asset_relations` | Dosya iliskileri (pdf_export, render_of, version_of, project_group); user\|auto kaynakli |

### Veritabani I/O Akisi

```
Frontend (sql.js WASM)
    │ initDatabase() → SQL sorgulari bellek icinde
    │
    ├── saveDatabase() → db.export() → Uint8Array
    │   │
    │   ▼ invoke('write_database', { data: base64 })
    │   Rust: ollama_db::write_database → disk yazma
    │
    └── reloadDatabase() → invoke('read_database')
        │
        ▼ Rust: ollama_db::read_database → disk okuma → base64
        Frontend: new SQL.Database(bytes)
```

### Yazma Erisim Kontrolu

```typescript
// database.ts
function canWriteToActiveArchive(): boolean {
  const archive = getActiveArchive();      // 'main' | 'local'
  const role = getRuntimeRole();           // 'admin' | 'viewer'
  if (archive === 'main' && role === 'viewer') return false;
  return true;
}
```

Istisnalar: `saveMessageDatabase()` ve `saveUserDatabase()` yazma kontrolunu atlar
(mesaj ve kullanici islemleri her zaman yapilabilir).

### V3 — vec.db Sidecar ve Epoch Routing

**Genel bakis.** v3-architecture, embedding/RAG verisini ana monolit SQLite'tan
ayri bir `*_vec.db` sidecar dosyasina tasiyan kademeli bir migrasyondur — amac
buyuk arsivlerde sql.js WASM heap'inin acilis-cokmesini onlemek (RAM yalitimi).
Kanonik durum/roadmap: `docs/v3/STATUS.md`.

**Epoch.** Ana DB'nin `PRAGMA user_version` degeri migrasyon asamasini tutar.
`getSchemaEpoch()` (database.ts) global `_schemaEpoch`'u doner; `initDatabase`/
`reloadDatabase` PRAGMA'dan okur.

| Epoch | Anlam | vec.db'ye tasinan tablo |
|-------|-------|--------------------------|
| 0 | Monolit (v2.4.10 davranisi) | — |
| 1 | embeddings tasindi | `embeddings` |
| 2 | + text_chunks tasindi | `text_chunks` (+ FTS5 `fts_chunks`) |
| 3 | + asset_relations tasindi | `asset_relations` |

`epoch >= N` olunca ilgili tablo sql.js'ten **DROP** edilir → o tabloya sql.js
sorgusu "no such table" atar. `_schemaEpoch` ancak basarili migrasyon+verify
ile ilerler. **V3 bayragi (`ARCHIVIST_V3_EPOCH`) 2026-05-22 itibariyla
default-ON (A6)** — flag'i set etmemis arsiv ilk acilista migre olur; opt-out
`localStorage.setItem('ARCHIVIST_V3_EPOCH','off')`.

**Okuma yolu (PRE-5, TAMAM).** Migrasyon sonrasi tum okuma noktalari epoch-aware:
her okuma fonksiyonunun bir `*Async` kardesi vardir — `epoch >= N`'de ilgili
`vec_db_*` Tauri komutuna, aksi halde sync sql.js'e duser.

**Yazma yolu (PRE-6, 4/5 faz TAMAM).** Migrasyon sonrasi yazma yollari da
epoch-aware:

| Faz | Kapsam |
|-----|--------|
| 6a | `detectAndSaveSameStemRelationsAsync` — scan-time oto-iliski; epoch>=3'te `asset_relations` vec.db'ye (`scan_write_batch`/writeBuffer) |
| 6b | `purgeNonIndexableChunks` — legacy cop body-chunk temizligi; epoch>=2'de victim secimi + silme vec.db |
| 6c | `ChatPanel` B2 auto-metadata-sync — eksik metadata chunk sorgusu + `indexAssetMetadata` re-index silme epoch-aware |
| 6d | `snapshotScannedRootWithAssets`/`restoreScannedRootWithAssets` — klasor-sil undo; V3 verisi vec.db export/import |
| 6e | `archiveOps` join/extract cross-archive merge — **incelendi, ayri oturum** (per-arsiv epoch tespiti gerekir; `_schemaEpoch` tek global) |

**Kural.** V3-eligible bir tabloya (embeddings/text_chunks/asset_relations)
sql.js uzerinden dokunan her yeni kod epoch-aware olmalidir: `epoch < N` sync
sql.js, `epoch >= N` ilgili `vec_db_*` komutu (ya da `scan_write_batch`).

**vec.db Tauri komutlari (`vec_db.rs`).** Okuma — `vec_db_chunk_embeddings*`,
`vec_db_embedding_stats`, `vec_db_embeddings_by_source`, `vec_db_chunks_by_*`,
`vec_db_chunk_count`, `vec_db_fts_search`, `vec_db_asset_relations`,
`vec_db_rag_index_counts`, `vec_db_chunk_stats` (PRE-5). Migrasyon —
`vec_db_migrate_*` / `vec_db_verify_*` / `vec_db_cascade_delete`. PRE-6 ile
eklenenler:

| Komut | Faz | Aciklama |
|-------|-----|---------|
| `vec_db_body_chunk_counts` | 6b | body-only (`chunk_index>=0`) asset-basina chunk + chunk-emb sayimlari |
| `vec_db_metadata_chunk_asset_ids` | 6c | metadata chunk'i (`chunk_index=-1`) olan asset id'leri |
| `vec_db_delete_metadata_chunks` | 6c | bir asset'in metadata chunk'larini vec.db'den sil (body chunk'a dokunmaz) |
| `vec_db_export_assets` | 6d | verilen asset'lerin embeddings/text_chunks/asset_relations satirlarini vec.db'den kayipsiz oku |
| `vec_db_import_assets` | 6d | `export_assets` ciktisini vec.db'ye geri-yaz (idempotent `apply_*`) |

> `scan_write_batch` (`scan_db.rs`, PRE-3a) yazma yolu da epoch-aware:
> `delete_chunks_for`/`embeddings`/`text_chunks`/`relations` payload alanlari
> epoch'a gore main DB ya da vec.db'ye route edilir.

---

## 6. Rust Backend Referansi

### Modul Haritasi

| Modul | Satir | Dosya | Gorev |
|-------|-------|-------|-------|
| **lib.rs** | 427 | Ana orkestrasyon | Komut kaydi, SessionRoleState, makro dispatch |
| **ollama_db.rs** | 999 | Veri katmani | DB okuma/yazma, Ollama HTTP proxy, start/stop_ollama, SSRF kontrolu |
| **dwg_parse.rs** | 1616 | Format parser | DWG binary parse (katmanlar, bloklar, metin, xref, OLE tespiti) |
| **lan_server.rs** | 495 | Ag | LAN HTTP sunucu (port 9471), auth, rate limit, /dev-feedback |
| **thumbnails.rs** | 979 | Gorsel | PSD/TGA/TIFF/DWG/MAX/SKP/PDF/Office/RVT onizleme |
| **max_version.rs** | 1096 | Format parser | 3ds Max surum algilama + donusturme (maxscript), CFB metadata |
| **text_extract.rs** | 637 | Metin | Tam metin cikarma (PDF, DOCX, TXT vb.) |
| **image_analysis.rs** | 626 | Gorsel analiz | EXIF, baskın renkler, pHash, boyut |
| **office_utils.rs** | 531 | Format parser | MS Office CFB, tarih, bak kaynak turu |
| **video_metadata.rs** | 414 | Format parser | Video codec, sure, cerceve bilgisi |
| **dxf_parse.rs** | 409 | Format parser | DXF ASCII format parse + sekil indeksleme (extract_dxf/dwg_shapes) |
| **oda_converter.rs** | — | Yardimci | ODA DWG→DXF donusturme onbellegi (convert_dwg_to_dxf_cached, clear_dxf_cache_cmd) |
| **skp_version.rs** | 359 | Format parser | SketchUp surum + metadata |
| **ifc_metadata.rs** | 365 | Format parser | IFC dosya metadata (schema, storeys, building) |
| **rvt_metadata.rs** | 218 | Format parser | Revit metadata + thumbnail cikarma |
| **archive_share.rs** | 241 | Paylasim | ZIP tabanli arsiv import/export |
| **crash_report.rs** | 208 | Hata | Panic yakalama, dosya kaydi |
| **trash.rs** | — | Cop kutusu | Dosya cop dizini islemleri (manifest read/write, move/restore/empty) |
| **pdf_metadata.rs** | 200 | Format parser | PDF yapi ve metadata |
| **refile_fs.rs** | 166 | Dosya sistemi | show_in_folder, open_file, refile_organize |
| **text_metadata.rs** | 131 | Format parser | Dokumanmetin metadata |
| **thumb_util.rs** | 19 | Yardimci | JPEG encode |
| **main.rs** | 6 | Giris noktasi | `app_lib::run()` cagrisi |

### Tauri Komut Referansi (Tamamı)

#### Dosya Analiz ve Metadata
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `get_file_metadata` | lib.rs | Dosya olusturma/degistirme tarihi |
| `extract_dwg_metadata` | dwg_parse.rs | DWG derin metadata (katmanlar, bloklar, metin, xref, ozellikler) |
| `get_dwg_creation_date` | dwg_parse.rs | DWG olusturma tarihi |
| `extract_dxf_metadata` | dxf_parse.rs | DXF metadata |
| `get_max_version` | max_version.rs | 3ds Max dosya surumu |
| `extract_max_metadata` | max_version.rs | 3ds Max derin metadata |
| `get_skp_version` | skp_version.rs | SketchUp dosya surumu |
| `extract_skp_metadata` | skp_version.rs | SketchUp derin metadata |
| `get_office_dates` | office_utils.rs | Office dosya tarihleri |
| `extract_office_metadata` | office_utils.rs | Office derin metadata |
| `detect_bak_source_type` | office_utils.rs | .bak dosya kaynak turu algilama |
| `extract_pdf_metadata` | pdf_metadata.rs | PDF metadata |
| `extract_video_metadata` | video_metadata.rs | Video metadata |
| `extract_text_metadata` | text_metadata.rs | Metin dosya metadata |
| `extract_image_metadata` | image_analysis.rs | Gorsel metadata (EXIF + renkler + boyut) |
| `extract_text_for_indexing` | text_extract.rs | Tam metin cikarma |

#### Thumbnail Uretimi
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `generate_thumbnail` | thumbnails.rs | Genel thumbnail (JPEG/PNG/BMP/TIFF/TGA) |
| `get_psd_thumbnail` | thumbnails.rs | PSD gomulu onizleme |
| `get_dwg_thumbnail` | thumbnails.rs | DWG gomulu onizleme |
| `get_max_thumbnail` | thumbnails.rs | 3ds Max gomulu onizleme |
| `get_skp_thumbnail` | thumbnails.rs | SketchUp gomulu onizleme |
| `get_office_thumbnail` | thumbnails.rs | Office gomulu onizleme |
| `get_pdf_thumbnail` | thumbnails.rs | PDF ilk sayfa onizleme |
| `get_text_thumbnail` | thumbnails.rs | Metin dosya onizleme |
| `get_doc_icon_thumbnail` | thumbnails.rs | Dokumanikonu |
| `get_eps_thumbnail` | thumbnails.rs | EPS onizleme |

#### Gorsel Analiz
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `get_image_dimensions` | image_analysis.rs | Gorsel boyut |
| `get_image_exif` | image_analysis.rs | EXIF veri cikarma |
| `get_dominant_colors` | image_analysis.rs | Baskin renk paleti |
| `compute_image_phash` | image_analysis.rs | Perceptual hash (dosyadan) |
| `compute_image_phash_from_bytes` | image_analysis.rs | Perceptual hash (byte'lardan) |
| `hamming_distance` | image_analysis.rs | Iki pHash arasi Hamming mesafesi |

#### Veritabani ve Depolama
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `read_database` | ollama_db.rs | Ana DB oku (base64) |
| `write_database` | ollama_db.rs | Ana DB yaz |
| `read_local_database` | ollama_db.rs | Yerel DB oku |
| `write_local_database` | ollama_db.rs | Yerel DB yaz |
| `set_database_path` | ollama_db.rs | Ana DB konum degistir |
| `set_local_database_path` | ollama_db.rs | Yerel DB konum degistir |
| `get_database_info` | ollama_db.rs | Ana DB yol + boyut |
| `get_local_database_info` | ollama_db.rs | Yerel DB yol + boyut |
| `read_recovery_key` | ollama_db.rs | Kurtarma anahtari oku |
| `write_recovery_key` | ollama_db.rs | Kurtarma anahtari yaz |

#### AI Entegrasyonu
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `ollama_proxy` | ollama_db.rs | Ollama HTTP proxy (SSRF korumasiz degil) |
| `ollama_ping` | ollama_db.rs | Ollama erisim kontrolu |
| `start_ollama` | ollama_db.rs | `ollama serve` sureci baslatir (detached) |
| `stop_ollama` | ollama_db.rs | Ollama surecini durdurur (taskkill) |

#### LAN Sunucu
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `lan_start_server` | lan_server.rs | LAN sunucu baslat (admin-only). Kayitli auth kodu varsa onu kullanir, yoksa uretip config'e kaydeder |
| `lan_stop_server` | lan_server.rs | LAN sunucu durdur |
| `lan_get_server_status` | lan_server.rs | Sunucu durumu sorgula |
| `lan_regenerate_auth_code` | lan_server.rs | Auth kodunu yeniler ve config'e kaydeder. Sunucu calisiyorsa otomatik restart yapar |
| `get_local_ip` | lib.rs | Yerel LAN IP'yi al |

#### Arsiv Paylasim
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `export_archive` | archive_share.rs | .archivistpro ZIP disari aktar |
| `peek_archive_manifest` | archive_share.rs | Arsiv icerik bilgisini oku |
| `import_archive` | archive_share.rs | .archivistpro ZIP iceri aktar |

#### Dosya Sistemi
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `show_in_folder` | refile_fs.rs | Dosyayi Gezgin'de goster |
| `open_file_native` | refile_fs.rs | Dosyayi varsayilan programla ac |
| `refile_organize` | refile_fs.rs | Dosya yeniden duzenleme (admin-only) |

#### ODA FileConverter
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `set_oda_converter_path` | dwg_parse.rs | ODA yolunu ayarla |
| `get_oda_converter_path_cmd` | dwg_parse.rs | Kayitli ODA yolunu al |
| `detect_oda_converter` | dwg_parse.rs | ODA'yi otomatik algila |
| `install_oda_converter` | dwg_parse.rs | ODA kur (bundled → winget → yerel) |
| `install_bundled_oda` | dwg_parse.rs | Paketli ODA'yi kur |
| `check_bundled_oda` | dwg_parse.rs | Paketli ODA var mi kontrol |
| `run_local_oda_installer` | dwg_parse.rs | Yerel secilen ODA yukleci calistir |

#### Geometrik Sekil Indeksleme
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `extract_dxf_shapes` | dxf_parse.rs | DXF dosyasindan geometrik sekilleri cikar (DxfShape listesi) |
| `extract_dwg_shapes` | dxf_parse.rs | DWG dosyasindan geometrik sekilleri cikar (ODA uzerinden DXF'e cevirip parse eder) |
| `clear_dxf_cache_cmd` | oda_converter.rs | DWG→DXF donusturme onbellegini temizler |

#### 3ds Max (Admin-Only)
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `convert_max_version` | max_version.rs | Max surum donusturme |
| `detect_max_installations` | max_version.rs | Yuklu Max surumlerini algila |
| `is_max_running` | max_version.rs | Max calisıyor mu kontrol |
| `convert_max_real` | max_version.rs | Gercek Max donusturme (maxscript) |

#### Crash Raporlama
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `write_crash_report` | crash_report.rs | Crash raporu yaz |
| `list_crash_reports` | crash_report.rs | Crash raporlarini listele |
| `delete_crash_report` | crash_report.rs | Tek rapor sil |
| `clear_crash_reports` | crash_report.rs | Tum raporlari temizle |

#### Oturum
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `tauri_set_session_role` | lib.rs | Oturum rolu ayarla (login sonrasi) |
| `write_system_log` | lib.rs | Frontend logunu Rust tracing'e yonlendir |

#### Cop Kutusu (Trash)
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `get_trash_dir` | trash.rs | appDataDir/.archivistpro-trash yolunu doner — frontend acilista cagirir |
| `read_trash_manifest` | trash.rs | _manifest.json oku |
| `write_trash_manifest` | trash.rs | _manifest.json yaz |
| `trash_move_file` | trash.rs | Dosyayi cop dizinine tasi (rename → fallback copy+delete) |
| `trash_restore_file` | trash.rs | Cop dizininden orijinal konuma geri yukle |
| `trash_empty` | trash.rs | Cop dizinindeki tum dosyalari kalici sil (manifest haric) |

#### Build Feature Flag
| Komut | Modul | Aciklama |
|-------|-------|---------|
| `get_build_features` | lib.rs | `{ admin: bool }` doner — viewer build'inde admin=false. Frontend `hasAdminFeatures()` ile UI gate'ler |

### Rol Tabanli Komut Erisimi

```rust
// lib.rs
pub fn require_admin(state: &State<SessionRoleState>) -> Result<(), String> {
    let guard = state.0.lock()...;
    match guard.as_deref() {
        Some("admin") => Ok(()),
        Some(r) => Err(format!("Bu islem admin yetkisi gerektirir (mevcut: {})", r)),
        None => Err("Oturum acilmamis".to_string()),
    }
}
```

Admin-only komutlar: `lan_start_server`, `lan_regenerate_auth_code`, `refile_organize`, `convert_max_*`, `detect_max_installations`

---

## 7. Frontend Servis Katmani

### Servislerin Sorumluluklari

| Servis | Satir | Gorev | Anahtar Fonksiyonlar |
|--------|-------|-------|---------------------|
| **database.ts** | 1240 | SQLite CRUD + arsiv yonetimi | `initDatabase`, `upsertAsset`, `getAllAssets`, `saveDatabase`, `getSetting`, `setSetting` |
| **fileScanner.ts** | 1561 | Dosya tarama orkestrasyonu | `scanDirectory`, `ScanController` (pause/resume/cancel) |
| **vision.ts** | 722 | AI gorsel analiz | `analyzeWithGemini`, `analyzeWithOllama`, `classifyImageType` |
| **duplicateDetection.ts** | 432 | Kopya bulma algoritmalari | `runDuplicateScan` (hash, isim, gorsel, yapisal) |
| **messageService.ts** | 406 | Mesajlasma | `sendMessage`, `getMessagesForUser`, `getUnreadCount`, `markAsResolved` |
| **userService.ts** | 375 | Kullanici yonetimi | `createUser`, `getUserByCredentials`, `hashPassword` (PBKDF2) |
| **logger.ts** | 357 | Istemci tarafli loglama | `debugLog`, `auditLog`, `getLogEntries` |
| **tagService.ts** | 318 | Etiket CRUD | `createTag`, `addTagToAsset`, `getAssetTags` |
| **database.ts** (ek) | — | Proje durumu + iliskiler | `updateAssetFields` (upsert'ten bagimsiz), `addAssetRelation`, `removeAssetRelation`, `getRelationsForAsset` / `getRelationsForAssetAsync`, `detectAndSaveSameStemRelations` / `detectAndSaveSameStemRelationsAsync` (V3 epoch-aware — bkz §5 V3 subsection) |
| **embeddings.ts** | 318 | Vektor uretimi | `generateEmbedding`, `generateImageEmbeddings`, `searchByVector` |
| **taskRunner.ts** | 288 | Arka plan gorev kuyrugu | `TaskRunner` class, ilerleme raporlama |
| **exportService.ts** | 226 | Toplu disari aktarma | `exportAssets`, `exportToCSV` |
| **queryExpansion.ts** | 222 | Sorgu genisletme | `expandQuery`, `getSynonyms`, `expandWithAI` |
| **notificationCenter.ts** | 197 | Toast bildirim | `notifySuccess`, `notifyError`, `notifyWarning` |
| **batchActions.ts** | 193 | Toplu islemler | `batchTag`, `batchDelete`, `batchExport` |
| **archiveShare.ts** | — | ZIP arsiv | `exportArchive`, `importArchive`, `peekArchive` |
| **archiveOps.ts** | 1300+ | Arsivler arasi join/extract | `joinArchives`, `previewJoin`, `previewJoinDetailed`, `extractAssets`, `previewExtract`, `previewExtractDetailed` |
| **filterPresets.ts** | — | Extract filtre preset'leri (localStorage) | `getAllPresets`, `savePreset`, `deletePreset` |
| **buildFeatures.ts** | — | Build-time feature flag (admin/viewer) runtime erisimi | `loadBuildFeatures`, `hasAdminFeatures` |
| **imageHash.ts** | — | Perceptual hash | `computePhash`, `hammingDistance` |
| **favorites.ts** | — | Favori | `addFavorite`, `removeFavorite`, `getAllFavoriteIds` |
| **trash.ts** | — | Cop kutusu (soft delete `.archivistpro-trash/` klasoru) | `setTrashDir`, `moveToTrash`, `restoreFromTrash`, `emptyTrash`, `listTrash`. App acilisinda `get_trash_dir` Tauri komutu cagrilip `setTrashDir` ile init edilir |
| **undoRedo.ts** | — | Geri al/Yinele | `pushCommand`, `undo`, `redo` |
| **themeService.ts** | — | Tema | `getTheme`, `toggleTheme` |
| **searchHistory.ts** | — | Arama gecmisi | `addToSearchHistory`, `getSearchHistory` |
| **textChunking.ts** | — | Metin parcalama | `chunkTextForEmbedding` |
| **hardwareDetect.ts** | — | Donanim profili | `detectHardwareProfile` |
| **systemCheck.ts** | — | Sistem sagligi | `checkSystemHealth`, `hasSeenSetupWizard` |
| **helpSystem.ts** | — | Yardim | `getHelpTopics`, `searchHelp` |
| **keyboardShortcuts.ts** | — | Klavye kisayollari | `registerShortcut`, `getShortcuts` |
| **developerFeedback.ts** | — | Gelistirici mesaj | `sendFeedbackOverLan`, `isDevModeConfigured` |
| **crashReporter.ts** | — | Crash rapor | `sendCrashReport` |
| **recoveryService.ts** | — | DB kurtarma | `recoverFromSnapshot` |
| **dbSnapshot.ts** | — | DB snapshot | `createSnapshot(archiveType?)`, `listSnapshots(archiveType?)`, `restoreSnapshot(fileName, archiveType?)`, `deleteSnapshot(fileName, archiveType?)` |
| **lanService.ts** | — | LAN kesif | `discoverPeers` |
| **ocr.ts** | — | OCR | `ocrImageToText` |
| **tauriMock.ts** | — | Tauri mock | Tauri disinda calisma icin |
| **ollamaService.ts** | — | Birlesik Ollama servisi | `pingOllama`, `pullModel`, `startOllama`, `stopOllama`, `listModels`, model secimi |
| **chatExport.ts** | — | Sohbet Markdown export | `exportSessionToMarkdown`, `downloadMarkdown` |
| **ragService.ts** | 901+ | RAG retrieve + sentez | Kapsam filtreleme (proje/etiket/klasor/asset), token istatistikleri, dinamik num_ctx, faz callback'leri, LLM reranker, query rewrite |
| **undoCommands.ts** | 373 | Ince taneli undo komutlari | Kaynak klasor sil, asset sil, grup sil, sohbet sil — Command Pattern + snapshot |
| **visualSearch.ts** | 117 | CLIP gorsel arama | Metin sorgusunu CLIP ile gorsel aramasina donusturme |
| **chatStorage.ts** | — | Sohbet oturumu CRUD | chat_sessions / messages tablolari, CASCADE silme |
| **dwgShapeIndex.ts** | — | DWG sekil indeksleme | Geometrik sekil verisi alma ve kaydetme |
| **ragIndexStatus.ts** | — | RAG indeks durumu | Indeksleme ilerleme ve durum takibi |
| **textChunker.ts** | — | Metin parcalama (gelismis) | `textChunks` kayit, chunk-level arama |
| **rootTagService.ts** | — | Kaynak klasor etiketleri | root_tags tablosu CRUD |
| **errorMapper.ts** | — | Hata mesaj haritalama | Backend hata kodlarini kullanici mesajlarina cevir |

---

## 8. React Bilesen Katalogu

### Ana Yapi Bilesenleri

| Bilesen | Satir | Gorev |
|---------|-------|-------|
| **App.tsx** | 309 | Kok bilesen, hook kompozisyonu, modal wiring |
| **MainViewContainer.tsx** | — | Explorer/Dashboard/Technical gorunum yonlendirme |
| **LoginScreen.tsx** | — | Giris ekrani, rol secimi |
| **FirstRunSetup.tsx** | — | Ilk admin hesabi olusturma |
| **SetupWizard.tsx** | 993 | Rehberli ilk kurulum |

### Gorunum Bilesenleri

| Bilesen | Satir | Gorev |
|---------|-------|-------|
| **ExplorerView.tsx** | — | VirtuosoGrid ile sanal kaydirmali asset izgara |
| **DashboardView.tsx** | — | Istatistik, zaman cizgisi, kategoriler |
| **TechnicalView.tsx** | — | Debug: embeddinglar, chunk'lar, hash'ler |
| **AssetCard.tsx** | — | Tek asset kart bileseni |
| **DetailPanel.tsx** | 1005 | Asset onizleme, metadata, renkler, chunk'lar |

### Modal Bilesenleri

| Bilesen | Satir | Gorev |
|---------|-------|-------|
| **ScanModal.tsx** | 524 | Klasor/dosya secimi, tarama ilerlemesi |
| **SettingsModal.tsx** | 906 | Ayarlar paneli (4 sekme: genel, depolama, ag, hakkinda) |
| **AISettingsModal.tsx** | 468 | AI model yapilandirmasi (Gemini/Ollama) |
| **RefileModal.tsx** | 519 | Dosya duzenleme (admin-only) |
| **DuplicateFinderModal.tsx** | 668 | Kopya ve benzer dosya bulma |
| **TrashModal.tsx** | — | Cop kutusu kurtarma |
| **ArchiveMergeModal.tsx** | 600+ | Iki arsivi birlestirme (Join) — config/preview/run/done adimlari, "Detayli liste" opt-in disposition gorunumu |
| **ArchiveExtractModal.tsx** | 1080+ | Filtreli asset cikarma (Extract) — preset bar, cross-archive tag filtresi, "Detayli liste" opt-in |
| **FeedbackModal.tsx** | 842 | Mesajlasma + gelistirici geri bildirim |
| **UserManagementModal.tsx** | 386 | Admin kullanici CRUD |
| **UserProfileModal.tsx** | 359 | Profil ve sifre degistirme |
| **LogViewerModal.tsx** | 393 | Sistem log goruntuleyici (admin) |
| **CrashLogViewer.tsx** | — | Crash rapor goruntuleme |
| **SidebarConfigModal.tsx** | — | Faset yapilandirma (goster/gizle/sirala) |
| **PerformanceSetupModal.tsx** | — | Donanim profil kurulumu |
| **HelpPanel.tsx** | — | Baglamsal yardim sistemi |
| **TagManagerModal.tsx** | — | Etiket yonetim paneli (listele/sil/yeniden adlandir/birlestir/renk) |

### UI Bilesenleri

| Bilesen | Gorev |
|---------|-------|
| **TopBar.tsx** | Arama cubugu, gorunum degistirme, kullanici menusu |
| **Sidebar.tsx** | Faset filtreleri, favoriler, koleksiyonlar, etiket filtresi paneli |
| **StatusBar.tsx** | Tarama ilerlemesi, indeksleme durumu, depolama |
| **Toast.tsx** | Toast bildirim render |
| **ConfirmDialog.tsx** | Onay diyalogu |
| **StorageWarningBanner.tsx** | Depolama uyarisi |
| **UpdateNotification.tsx** | Guncelleme bildirimi |
| **LanSharingPanel.tsx** | LAN arsiv paylasim paneli |
| **ErrorBoundary.tsx** | React hata siniri |
| **ModalErrorBoundary.tsx** | Modal icin hata siniri |
| **ModalPortal.tsx** | Modal render portali |
| **AssetTagsPanel.tsx** | Asset etiket yonetimi |
| **AssetRelationsPanel.tsx** | Dosya iliskisi goster/ekle/kaldir; otomatik rozet |
| **ForgotPassword.tsx** | Sifre sifirlama |
| **AISetupWizard.tsx** | 3 adimli AI kurulum sihirbazi (Ollama → Modeller → Tamamlandi) |
| **AIStatusBadge.tsx** | TopBar'da renk kodlu AI durum noktasi + hover tooltip |
| **AssetContextMenu.tsx** | AssetCard sag-tik baglam menusu |
| **BlankContextMenu.tsx** | Bos alan sag-tik baglam menusu |
| **VisualSearchModal.tsx** | CLIP gorsel arama modal |
| **RagIndexModal.tsx** | RAG indeksleme ilerleme ve durum modali |
| **BatchTagModal.tsx** | Toplu etiketleme modal |
| **BatchToolbar.tsx** | Coklu secim araclari cubugu |
| **SourceFoldersPanel.tsx** | Taranmis kaynak klasor yonetimi (grup/renk/favori) |
| **ChatPanel.tsx** | RAG sohbet kok bileseni (543 satir) |
| **AdminActivityPanel.tsx** | Admin aktivite ozet paneli (DashboardView) |
| **SessionWarningToast.tsx** | Oturum zaman asimi gorsel uyari bildirimi |
| **OnboardingTour.tsx** | Ilk kullanici icin 7 adimli spotlight rehber |
| **FilterPresetSelector.tsx** | Filtre kombinasyonlarini kaydet/yukle/sil |
| **EmbeddingProgress.tsx** | Asset-level AI indeksleme ilerleme cubugu |
| **LockScreen.tsx** | Oturum zaman asimi ekran kilidi |

### ChatPanel Alt Bilesenleri (src/components/chat/)

ChatPanel.tsx v2.2.3'te 1196 satirdan 543 satira indirildi; mantik 8 alt bilesene bolundu:

| Bilesen | Gorev |
|---------|-------|
| **chat/ChatSessionSidebar.tsx** | Sohbet oturumu listesi ve secim |
| **chat/ChatHeader.tsx** | Oturum basligi, Markdown export (Download butonu), kapat |
| **chat/ChatMessageList.tsx** | Mesaj listesi, citation chip'leri, kod bloglari |
| **chat/ChatInput.tsx** | Mesaj girisi, slash komutlar, gonder |
| **chat/ChatSynthesisBar.tsx** | Cok-belge sentez modu cubugu |
| **chat/ChatHelpOverlay.tsx** | Ozellik rehberi overlay ('? Yardim' butonu) |
| **chat/chatStyles.ts** | Paylasilan CSS sabitleri |
| **chat/index.ts** | Barrel export |

---

## 9. Hook Referansi

| Hook | Dondugu | Gorev |
|------|---------|-------|
| **useAppInitialization** | `{ undoRedoState, recoveryReady, isFirstRun, showHelp, ... }` | DB init, undo/redo, kurtarma, ilk calistirma |
| **useDatabaseAssets** | `{ allAssets, dbReady, dbError }` | DB'den asset listesi, guncelleme dinleme |
| **useScanWorkflow** | `{ scanProgress, handleStartScan, handlePauseScan, handleCancelScan }` | Tarama orkestrasyonu |
| **useEmbeddingSearch** | `{ embeddingStatus, isSearching, isVisualVectorQuery }` | Vektor arama durumu + model yukleme |
| **useImageSearch** | `{ handleImageSearch }` | Gorsel benzerlik arama |
| **useHybridFilteredAssets** | `{ filteredAssets, selectedAsset, matchSources, searchScoreMap }` | Anahtar kelime + semantik filtreleme |
| **usePerformanceSetup** | `{ profile, setupComplete }` | Donanim algilama + optimizasyon |
| **useStorageWarning** | (yan etki) | Depolama kota izleme |
| **useUpdateChecker** | `{ updateAvailable, updateInfo }` | Periyodik guncelleme kontrolu |
| **useStorePersistence** | (yan etki) | Store → localStorage serializasyon |
| **useAssetDeletion** | `{ deleteAsset, permanentlyDelete }` | Undo destekli silme |
| **useDevFeedbackReceiver** | (yan etki) | 'dev-feedback-received' Tauri olayi dinle → DB kaydet → OS bildirimi |
| **useFocusTrap** | `(ref) => void` | Modal klavye odak yakalaması |
| **useOllamaStatus** | `{ status, isRunning, isChecking }` | Periyodik Ollama saglik kontrolu (30sn arayla ping), panel kapaninca cleanup |
| **useAssetContextMenu** | `{ menuState, openMenu, closeMenu }` | AssetCard ve bos alan sag-tik baglam menusu durumu |
| **useExitConfirmation** | (yan etki) | Uygulama kapanmadan once onay diyalogu |
| **useSessionTimeout** | (yan etki) | Tarayici oturumu zaman asimi izleme |
| **useBackupScheduler** | (yan etki) | Zamanlanmis DB snapshot (1/4/8/24 saat) |

---

## 10. State Yonetimi (Zustand)

### Store Yapisi

```typescript
// src/store/useStore.ts — Tek store, tum uygulama durumu
interface AppState {
  // Gorunum
  viewMode: ViewMode;                    // 'explorer' | 'dashboard' | 'technical'
  cardSize: number;                      // 220px varsayilan

  // Asset ve Arama
  scannedAssets: Asset[];
  searchQuery: string;
  semanticResults: SemanticResult[] | null;
  activeFilters: Record<FacetKey, string[]>;
  selectedAssetId: string | null;
  selectedAssetIds: string[];
  searchSensitivity: number;             // 0-100, varsayilan 70

  // AI Yapilandirmasi
  aiConfig: {
    mode: 'cloud' | 'local';
    apiProvider: 'ollama' | 'gemini';
    apiKey: string;                       // localStorage'a kaydedilMEZ
    apiUrl: string;                       // varsayilan: http://localhost:11434/v1/chat/completions
    ollamaModel: string;                  // varsayilan: 'llava'
  };

  // Kimlik
  currentUser: string | null;
  currentRole: 'admin' | 'viewer' | null;
  currentUserId: number | null;
  isLoggedIn: boolean;
  isBlockedFromMain: boolean;

  // Arsiv
  activeArchive: 'main' | 'local';

  // UI Durumu
  isScanModalOpen: boolean;
  isAiConfigOpen: boolean;
  isRefileModalOpen: boolean;
  isFeedbackModalOpen: boolean;
  isUserProfileOpen: boolean;
  isUserManagementOpen: boolean;
  unreadMessageCount: number;
  showOnlyFavorites: boolean;
  storageWarning: boolean;

  // Bildirimler
  toasts: ToastItem[];                   // Maks 5
  confirmDialog: ConfirmDialogData | null;
}
```

### localStorage Kaliciligi

| Anahtar | Deger | Not |
|---------|-------|-----|
| `archivist_facet_config` | FacetConfig[] | Faset gorunurluk/siralama |
| `archivist_ai_config` | AIConfig | apiKey HARIC |
| `archivist_search_sensitivity` | number | Arama hassasiyeti |
| `cardSize` | number | Kart boyutu |
| `archivist_language` | string | Dil kodu (tr, en, ...) |
| `oda_converter_path` | string | ODA yolu |

---

## 11. Izin ve Rol Sistemi

### Rol Matrisi

| Izin | Admin | Viewer |
|------|-------|--------|
| Ana arsiv okuma | ✓ | ✓ |
| Ana arsiv yazma | ✓ | ✗ |
| Ana arsiv silme | ✓ | ✗ |
| Dosya tarama | ✓ | ✗ |
| Dosya duzenleme (refile) | ✓ | ✗ |
| Yerel arsiv — tum islemler | ✓ | ✓ |
| AI kullanimi | ✓ | ✓ |
| Kullanici yonetimi | ✓ | ✗ |
| Ayar yonetimi | ✓ | ✗ |
| Log goruntuleme | ✓ | ✗ |

### Uygulama Katmanlari

```
1. Derleme zamani (Cargo features)
   └── admin: tum komutlar  |  viewer: sinirli set

2. Calisma zamani — Rust taraf
   └── require_admin(state) → SessionRoleState kontrolu

3. Calisma zamani — Frontend
   └── setRuntimeRole() → useIsAdmin(), useAppRole()

4. Bilesen tabanli
   └── <ProtectedAction permission="archive.write">
         {children}  // Yetkisizse gizlenir
       </ProtectedAction>

5. Veritabani tabanli
   └── canWriteToActiveArchive() → viewer + main = false
```

---

## 12. Dosya Tarama Pipeline'i

```
Kullanici secimi (klasor veya dosyalar)
    │
    ▼ useScanWorkflow → fileScanner.scanDirectory()
    │
    ├── 1. Dosya numaralandırma (readdirSync benzeri)
    │   └── Uzanti filtreleme (80+ format)
    │
    ├── 2. Her dosya icin paralel pipeline:
    │   │
    │   ├── Temel metadata (boyut, tarihler)
    │   │   └── invoke('get_file_metadata')
    │   │
    │   ├── Format-ozel metadata
    │   │   ├── DWG → invoke('extract_dwg_metadata')
    │   │   ├── MAX → invoke('extract_max_metadata')
    │   │   ├── SKP → invoke('extract_skp_metadata')
    │   │   ├── PDF → invoke('extract_pdf_metadata')
    │   │   ├── Office → invoke('extract_office_metadata')
    │   │   ├── Video → invoke('extract_video_metadata')
    │   │   ├── Gorsel → invoke('extract_image_metadata')
    │   │   └── Metin → invoke('extract_text_metadata')
    │   │
    │   ├── Thumbnail uretimi
    │   │   └── invoke('generate_thumbnail') veya format-ozel
    │   │
    │   ├── Metin cikarma (indexleme icin)
    │   │   └── invoke('extract_text_for_indexing')
    │   │
    │   ├── Embedding uretimi (WASM — yerel)
    │   │   ├── Metin → MiniLM-L6 (384 boyut)
    │   │   └── Gorsel → CLIP (512 boyut, istege bagli)
    │   │
    │   └── Vision AI analizi (yapilandirilmissa)
    │       ├── Ollama (yerel LLM)
    │       └── Gemini Vision API
    │
    └── 3. upsertAsset() → SQLite → saveDatabase()
        └── Zustand store guncelleme → UI yenileme
```

### ScanController

```typescript
class ScanController {
  pause(): void;     // Taramayi duraklat
  resume(): void;    // Taramayi devam ettir
  cancel(): void;    // Taramayi iptal et
  isPaused: boolean;
  isCancelled: boolean;
}
```

---

## 13. AI ve Semantik Arama

### Embedding Modelleri

| Model | Boyut | Kullanim | Yukleme |
|-------|-------|---------|---------|
| MiniLM-L6-v2 | 384 | Metin embedding | @xenova/transformers (WASM) |
| CLIP | 512 | Gorsel embedding | @xenova/transformers (istege bagli) |

### Hibrit Arama Akisi

```
Kullanici sorgusu: "beton cephe render"
    │
    ├── 1. Sorgu Genisletme (queryExpansion.ts)
    │   └── Esanlamli: "beton", "concrete", "cephe", "facade"
    │
    ├── 2. Tam Metin Arama (SQL LIKE)
    │   └── assets.file_name, assets.metadata_json LIKE '%beton%'
    │
    ├── 3. Vektor Arama (embeddings.ts)
    │   ├── Sorgu → MiniLM embedding → [0.12, -0.34, ...]
    │   └── Kosinus benzerlik (tum embeddinglara karsi)
    │
    └── 4. Birlestirme + Sıralama (searchScoring.ts)
        └── Agirlikli skor: anahtar kelime + semantik + metadata eslesmesi
```

### Sol Panel Arama vs AI Sohbet (RAG) — Fark

Bu iki ozellik birbirini tamamlar, birbirinin yerini almaz:

| | Sol Panel Arama | AI Sohbet (RAG) |
|---|---|---|
| **Girdi** | Kisa anahtar kelime | Dogal dilde soru |
| **Cikti** | Dosya kartlari (asset listesi) | Paragraf cevap + kaynak referanslari |
| **LLM gerekli mi** | Hayir | Evet (Ollama) |
| **Arama birimi** | Asset (dosya basina 1 vektor) | Chunk (dosya basina 5-50 parca) |
| **Derinlik** | Dosya adi + metadata | Dosya icerigi (PDF metni, DOC icindeki yazi) |
| **Sentez** | Yok — sadece siralar | Var — birden fazla kaynaktan bilgi birlestirip tutarli cevap uretir |
| **Hiz** | ~50ms | 5-20sn |
| **Ollama olmadan** | Calisir | Calismaz |

Detay icin: [`docs/RAG_PLAN.md`](RAG_PLAN.md) § "Sol Panel Arama vs AI Sohbet"

### AI Sohbet (RAG) Mimarisi

```
ragService.ts — Ana orkestrasyon
    ├── Hybrid retrieval: semantik (MiniLM) + anahtar kelime (word-boundary FTS)
    ├── Kapsam filtreleme: proje / etiket / klasor / secili asset'ler
    ├── Hallucination gate: minimum skor + keyword sağduyu
    ├── LLM-based reranker (Faz 3): CSV CSV sonuc + fallback
    ├── Query rewrite: kisa sorguyu LLM ile zenginlestir (timeout korunmali)
    ├── Dinamik num_ctx: 4096-16384 arasi, prompt boyutuna gore
    ├── Token sayaci: eval_count + prompt_eval_count → DB'ye yaziliyor
    ├── Faz callback'leri: "Kaynaklar aranıyor..." → "Yanıt olusturuluyor..."
    └── Sentez modu: 10 belgeden sentez + uyari
```

ChatPanel alt bilesenler icin bkz. §8 "ChatPanel Alt Bilesenleri".
Sohbet Markdown export: `chatExport.ts` → ChatHeader'da Download butonu.

### CLIP Gorsel Arama

`visualSearch.ts` — Metin sorguyu CLIP text encoder ile goruntu embedding uzayinda arar.
`/gorsel` slash komutu sohbet icine entegre. Buyuk gorseller onceden 1024px'e kucultulur.

### Vision Entegrasyon Noktalari

```
Ollama (yerel LLM)
    ├── Gorsel analiz: goruntu → aciklama + etiketler
    ├── OCR: goruntu → metin cikarma
    └── Sorgu genisletme: arama terimi → esanlamlilar

Gemini Vision API (bulut, istege bagli)
    └── Gorsel analiz: goruntu → siniflandirma + etiketler
```

---

## 14. LAN Paylasim ve Sunucu

### Mimari

```
Admin Makinesi (Sunucu)                  Kullanici Makinesi (Istemci)
┌────────────────────┐                ┌────────────────────┐
│ ArchivistPro       │                │ ArchivistPro       │
│ (admin modu)       │  HTTP/9471     │ (viewer modu)      │
│                    │◄───────────────│                    │
│ tiny_http sunucu   │  8 haneli      │ tauriFetch()       │
│ port 9471          │  auth kodu     │                    │
└────────────────────┘                └────────────────────┘
```

### Endpoint'ler

| Yol | Metot | Auth | Aciklama |
|-----|-------|------|---------|
| `/ping` | GET | Hayir | Sunucu erisilebilirlik kontrolu |
| `/dev-feedback` | POST | Hayir | Gelistirici geri bildirimi al |
| `/manifest` | GET | Evet | Arsiv manifest bilgisi (boyut, surum) |
| `/download` | GET | Evet | DB dosyasini binary stream olarak indir |

### Auth Mekanizmasi

- 8 haneli kriptografik rastgele kod (`getrandom`), config'e kalici kaydedilir
- Sunucu her baslatildiginda ayni kod kullanilir (istemciler yeniden girmek zorunda kalmaz)
- Admin istediginde kodu yenileyebilir (`lan_regenerate_auth_code`)
- `X-Auth-Code` HTTP basligiyla gonderilir
- CORS basliklarla tum originlerden erisim (LAN icin)
- `/ping` ve `/dev-feedback` auth gerektirmez

### Gelistirici Modu

```
Admin → Ayarlar → Ag → "Bu cihazi gelistirici olarak ayarla"
    │
    ├── get_local_ip() → UDP trick ile LAN IP algilama
    ├── app_settings: dev_mode='true', dev_ip='192.168.x.x'
    ├── LAN sunucu otomatik baslatilir
    │
    ▼ Kullanici geri bildirim gonderdiginde:
    │
    ├── sendFeedbackOverLan() → POST /dev-feedback
    ├── Rust: app.emit('dev-feedback-received', payload)
    ├── useDevFeedbackReceiver hook → DB'ye kaydet
    └── OS bildirimi goster
```

---

## 15. Mesajlasma Sistemi

### Mesaj Tipleri

| Tip | Aciklama | Gonderici → Alici |
|-----|---------|-------------------|
| `suggestion` | Iyilestirme onerisi | Herkes → Admin |
| `private` | Ozel mesaj | Herkes → Herkes |
| `developer` | Gelistirici geri bildirimi | Herkes → Gelistirici (LAN) |

### Oncelik ve Durum

- **Oncelik**: `normal`, `important`
- **Durum**: `unread` → `read` → `resolved`
- **Yanit**: `parent_id` ile thread yapisi

### Bildirimler

```
Mesaj gonderildiginde:
    ├── DB'ye kayit (user_messages)
    ├── Duzenli yoklama (10sn) → unread sayac guncelleme
    └── Pencere odakta degilse → OS toast bildirimi
```

---

## 16. Uluslararasilastirma (i18n)

### Desteklenen Diller

| Dil | Kod | Boyut | RTL |
|-----|-----|-------|-----|
| Turkce | `tr` | ~50KB | Hayir |
| Ingilizce | `en` | ~44KB | Hayir |
| Cince | `zh` | ~39KB | Hayir |
| Japonca | `ja` | ~46KB | Hayir |
| Arapca | `ar` | ~51KB | Evet |

### Yapilandirma

```typescript
// src/i18n/index.ts
i18next.init({
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
  resources: { tr, en, zh, ja, ar }
});
```

### Namespace Yapisi (ornek)

```
login.error.fieldsRequired
settings.section.developerMode
feedback.developer.sentLan
scanWorkflow.selectFolder
duplicateFinder.checkVisual
notification.newMessage
```

### Yeni Anahtar Ekleme

1. `src/i18n/locales/tr.json`'a Turkce anahtar ekle
2. `src/i18n/locales/en.json`'a Ingilizce karsilik ekle
3. Diger dilleri guncelle (zh, ja, ar) — veya fallback calisir
4. Bilesendle: `const { t } = useTranslation(); t('yeni.anahtar')`

---

## 17. Hata Yonetimi ve Crash Raporlama

### Frontend Hatalari

```
React Hata Siniri (ErrorBoundary.tsx)
    └── Render hatasini yakalar → yedek UI gosterir

try/catch → debugLog(module, message, error)
    ├── Konsol log
    ├── Tauri: invoke('write_system_log', {level, module, message})
    └── auditLog(action, target, detail) → audit_log tablosu

notifyError(message) → Toast bildirimi
```

### Rust Panikleri

```
std::panic::set_hook → crash_report::write_crash_report_sync
    ├── crash_logs/ dizinine JSON dosya yazar
    ├── Icerik: tarih, modul, mesaj, konum, backtrace
    └── CrashLogViewer.tsx ile admin goruntuler
```

### Kurtarma

```
recoveryService.ts
    ├── DB baslangicta yuklenemiyor → kurtarma modu
    ├── Yedek snapshot varsa → geri yukle
    └── Tamamen bozuk → bos DB ile baslat
```

---

## 18. Test Stratejisi

### Birim Testler (Vitest)

```bash
npm test                   # Tum testler
npm test -- --watch        # Izleme modu
```

**Konum**: `src/tests/*.test.ts`

**Test sayisi**: 751 test, 39 dosya (tumu geccecek sekilde)

**Kapsam**:
- Servis testleri: database, userService, tagService, trash, dbSnapshot, chatStorage, ragKeywordGate
- Hook testleri: useAppInitialization, useDatabaseAssets, useScanWorkflow, useEmbeddingSearch, useImageSearch
- Yardimci testleri: colorConvert, searchScoring

**Kapsam metrikleri** (son olcum 2026-04-12, guncellenmeli): Stmt %50 / Branch %42 / Func %62 / Lines %51

### E2E Testler (Playwright)

```bash
npm run test:e2e           # Headless
npm run test:e2e:ui        # UI modunda
```

**Konum**: `e2e/*.spec.ts`

**Kapsam**: login, tarama, asset detay, arama/filtre, ayarlar

### Tip Kontrolu

```bash
npx tsc --noEmit           # Frontend TypeScript
cargo check --manifest-path src-tauri/Cargo.toml  # Rust
```

---

## 19. Tauri Yapilandirmasi

### Capability Izinleri

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "dialog:allow-open", "dialog:allow-save", "dialog:allow-message",
    "shell:allow-open",
    "fs:allow-read-dir", "fs:allow-stat", "fs:allow-exists",
    { "identifier": "fs:scope", "allow": [
      { "path": "$HOME/**" },
      { "path": "$APPDATA/**" }
    ]},
    "updater:default",
    "notification:default",
    "http:default"
  ]
}
```

### CSP (Content Security Policy)

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: https://asset.localhost data: blob:;
connect-src 'self' http://localhost:11434 http://127.0.0.1:11434
                    http://localhost:9471 http://127.0.0.1:9471;
worker-src 'self' blob:;
```

### Otomatik Guncelleme

```json
// tauri.conf.json → plugins.updater
{
  "endpoints": ["https://github.com/ahmet3ddd/Arsiv-H2/releases/latest/download/latest.json"],
  "pubkey": "dW50cnVzdGVkI..."
}
```

---

## 20. Bagimliliklar

### Rust (Cargo.toml)

| Kutuphane | Surum | Kullanim |
|-----------|-------|---------|
| tauri | 2.10.3 | Uygulama cercevesi |
| serde / serde_json | 1.0 | JSON serializasyon |
| image | 0.24 | Goruntu islemleri (JPEG, PNG, TIFF, TGA, BMP) |
| kamadak-exif | 0.5 | EXIF metadata |
| chrono | 0.4.44 | Tarih/saat |
| base64 | 0.22 | Base64 kodlama |
| cfb | 0.14 | MS Office Compound File Binary |
| zip | 2.0 | ZIP arsiv islemleri |
| ureq | 2.0 | HTTP istemci (Ollama proxy) |
| quick-xml | 0.39.2 | XML parse (DXF) |
| pdf-extract | 0.10 | PDF metin cikarma |
| winreg | 0.55 | Windows Registry (3ds Max) |
| tiny_http | 0.12 | LAN HTTP sunucu |
| getrandom | 0.2 | Kriptografik rastgele |
| opener | 0.7 | Dosya acma |
| url | 2.0 | URL parse (SSRF kontrolu) |
| log | 0.4 | Loglama |

### Tauri Pluginleri

| Plugin | Surum | Kullanim |
|--------|-------|---------|
| tauri-plugin-dialog | 2.2 | Dosya/klasor diyaloglari |
| tauri-plugin-fs | 2.2 | Dosya sistemi islemleri |
| tauri-plugin-shell | 2.2 | Kabuk komutlari |
| tauri-plugin-http | 2.0 | HTTP istekleri (LAN updater fetch dahil) |
| tauri-plugin-notification | 2.0 | OS bildirimleri |
| tauri-plugin-log | 2.0 | Uygulama loglama |

### Frontend (package.json)

| Paket | Surum | Kullanim |
|-------|-------|---------|
| react / react-dom | 19.2.0 | UI cercevesi |
| zustand | 5.0.11 | State yonetimi |
| i18next / react-i18next | 26.0.3 / 17.0.2 | Coklu dil |
| @xenova/transformers | 2.17.2 | WASM ML embeddinglari |
| sql.js | 1.14.1 | WASM SQLite |
| react-virtuoso | 4.18.4 | Sanal kaydirma |
| lucide-react | 0.577.0 | Ikon seti |
| dompurify | 3.3.3 | XSS temizleme |
| react-router-dom | 7.13.1 | Sayfa yonlendirme |

---

## 21. Performans Notlari

### Buyuk Veri Setleri

- **VirtuosoGrid**: 100.000+ asset icin sanal kaydirma
- **Vektor arama**: O(n) cosine similarity — 10K embedding icin <200ms
- **Toplu tarama**: ScanController ile duraklatma/iptal
- **Chunk boyutu**: Metin parcalari 512 token sinirinda
- **Thumbnail onbellek**: Base64 veya asset:// ile disk'ten servis

### Bellek Optimizasyonu

- sql.js veritabani bellekte tutulur; buyuk arsivler icin disk I/O
- Embeddinglar lazily yuklenir (ihtiyac halinde)
- Thumbnail'lar base64 → DB'de saklanir (ayri dosya yok)

### Pratik Limitler

| Olcum | Gozlemlenen Limit | Not |
|---|---|---|
| Asset sayisi | ~50.000 (yumusak) | UI akiskan, bellek ~400 MB |
| Text chunk sayisi | ~200.000 | Embedding aramasi O(n) yavaslar |
| Embedding arama | <200ms (10K chunk) | 100K+ icin belirgin yavaslik |
| DB dosya boyutu | ~2 GB (pratik) | sql.js tum DB'yi bellege yukler |
| Snapshot dosyasi | DB boyutuyla esit | Her snapshot ayri bir kopya |

**Onemli:** sql.js mimarisi geregi tum veritabani bellegee yukluyor. 50.000+ asset veya cok sayida metin icerigi olan kurulumlar icin daha yuksek RAM onerilebilir (min 8 GB sistem RAM).

### Zamanlama Sabitleri

```typescript
// src/config/constants.ts
TOAST_DISMISS_MS: 4_000
AI_REQUEST_TIMEOUT_MS: 15_000
MESSAGE_POLL_INTERVAL_MS: 10_000
DB_INIT_TIMEOUT_MS: 30_000
EMBEDDING_SEARCH_DEBOUNCE_MS: 400
LAN_DOWNLOAD_TIMEOUT_MS: 120_000
UPDATE_CHECK_INTERVAL_MS: 3_600_000  // 1 saat
```

---

## 22. Yeni Ozellik Ekleme Rehberi

### Tipik Akis

```
1. Plan yap (karmasik ozellik icin)
2. i18n anahtarlarini ekle (tr.json + en.json)
3. Gerekiyorsa Rust komutu ekle:
   a. src-tauri/src/yeni_modul.rs olustur
   b. lib.rs'e mod + use ekle
   c. shared_handlers! veya all_handlers! makrosuna ekle
4. Gerekiyorsa veritabani tablosu ekle:
   a. database.ts → _applySchema() icinde CREATE TABLE
5. Servis dosyasi olustur: src/services/yeniServis.ts
6. Hook olustur (gerekiyorsa): src/hooks/useYeniOzellik.ts
7. Bilesen olustur: src/components/YeniModal.tsx
8. App.tsx'e entegre et (state + modal wiring)
9. Test yaz: src/tests/yeniServis.test.ts
10. Tauri izinleri guncelle (gerekiyorsa):
    capabilities/default.json
```

### Checklist

- [ ] TypeScript hatasiz: `npx tsc --noEmit`
- [ ] Rust derlemesi basarili: `cargo check`
- [ ] i18n: en az tr.json + en.json guncellendi
- [ ] Viewer rolunde bozulma yok
- [ ] Admin-only ise: require_admin + ProtectedAction
- [ ] Test yazildi ve geciyor

### Yeni Tauri Komutu Ekleme

```rust
// 1. Fonksiyon tanimla
#[tauri::command]
pub fn yeni_komut(param: String) -> Result<String, String> {
    // ...
    Ok("basarili".into())
}

// 2. lib.rs'e ekle
// shared_handlers! icine (her iki rol):
yeni_modul::yeni_komut,
// VEYA all_handlers! icine (sadece admin):
yeni_modul::yeni_komut,
```

```typescript
// 3. Frontend'den cagir
const { invoke } = await import('@tauri-apps/api/core');
const result = await invoke<string>('yeni_komut', { param: 'deger' });
```

### Yeni Veritabani Tablosu Ekleme

```typescript
// database.ts → _applySchema() icinde:
target.run(`CREATE TABLE IF NOT EXISTS yeni_tablo (
  id TEXT PRIMARY KEY,
  deger TEXT,
  olusturma TEXT DEFAULT (datetime('now'))
)`);
```

---

## 22b. Son Eklenen Ozellikler (v2.2.3+)

### Dosya Zenginlestirme — Proje Durumu + Dosya Iliskileri

**Proje Durumu Alanlari** (kullanici tanimli, yeniden taramada korunur):
- `clientName` — Musteri adi (max 150 karakter)
- `approvalStatus` — Onay durumu: draft / review / approved / rejected
- `versionLabel` — Surum etiketi (max 20 karakter)
- `deadline` — Teslim tarihi (ISO format)
- Bu alanlar `updateAssetFields()` ile ayri UPDATE sorgusuyla guncellenir; `upsertAsset()` bunlara dokunmaz
- `approvalStatus` sidebar'da facet filtresi olarak da gorunur

**Dosya Iliskileri** (`asset_relations` tablosu):
- Tur: `pdf_export`, `render_of`, `version_of`, `project_group`
- Ayni-stem otomatik tespit: `detectAndSaveSameStemRelations()` DWG+PDF, Model+Render vb.
  (V3 epoch>=3'te `detectAndSaveSameStemRelationsAsync` ile vec.db'ye yazilir — bkz §5 V3 subsection)
- Manuel baglanti ekleme/kaldirma UI: `AssetRelationsPanel.tsx`

### MAX Dosya Destegi Genisletmesi
- **Layer/obje okuma**: CFB icerisinden UTF-16LE chunk tarama (0x0960 node, 0x1016 layer)
- **FBX/OBJ export**: `export_max_to_format()` — MAXScript headless (admin-only, 3ds Max gerektirir)
- **metadata.maxLayers** ve **metadata.maxObjects** alanlari aramaya dahil

### RVT Thumbnail
- `get_rvt_thumbnail()` — CFB/OLE2 SummaryInformation veya JPEG/PNG magic byte tarama
- Ayni strateji ile MAX thumbnail calisiyor

### Arama Iyilestirmeleri
- Proje durumu alanlari (clientName, approvalStatus, versionLabel, deadline) arama metnine dahil
- Min 3 karakter ipucu: arama kutusunda 1-2 karakter yazildiginda uyari gosterilir
- `upsertAsset()` artik `INSERT INTO ... ON CONFLICT(id) DO UPDATE SET` kullaniyor; kullanici tanimli alanlar yeniden taramada korunuyor

### AI Sohbet ve RAG (v2.2.3+ — 2026-04-17 sonrasi)

**Faz 1-3 Tamamlandi:**
- chat_sessions / messages DB tablolari, kalici sohbet gecmisi
- Hybrid retrieval: semantik + word-boundary keyword gate
- Hallucination gate + snippet cumle siniri
- LLM-based reranker (CSV parser ile)
- Query rewriting (LLM ile sorgu zenginlestirme)
- Kapsam filtreleme: proje, etiket, klasor veya secili asset'ler
- Metadata chunk indeksleme: dosya adi, proje, etiket, DWG katmanlari aranabilir
- CLIP text→image arama + `/gorsel` slash komutu
- Sohbet Markdown export (ChatHeader Download butonu)
- Dinamik num_ctx (4096-16384) + token sayaci
- Sentez modu (10 belge) + faz gostergesi ("Kaynaklar aranıyor..." vb.)
- FTS5 lazy loading, OCR fallback, etiket onerileri
- ChatPanel 8 alt bilesene bolundu (chat/ dizini)

**Faz 4 (Geometrik DWG) — Kismi:**
- 4.1: `extract_dxf_shapes` / `extract_dwg_shapes` Tauri komutlari (`oda_converter.rs` onbellek)
- 4.2: `dwgShapeIndex.ts` servis — sekil verisi kaydetme/alma
- 4.4: `clear_dxf_cache_cmd` — ODA donusturme onbellegi temizleme

### Unified AI Setup (v2.2.3+ — 2026-04-19)

- `AISetupWizard.tsx` — 3 adimli sihirbaz (Ollama kur → Modeller → Tamamlandi)
- `AIStatusBadge.tsx` — TopBar'da Ollama/chat model/gorsel model durumu tooltip ile
- `ollamaService.ts` — Birlesik Ollama servisi (ping, pull, start, stop, model listele)
- `start_ollama` / `stop_ollama` Tauri komutlari (ollama_db.rs) — process yonetimi
- `useOllamaStatus` hook — 30sn periyodik saglik kontrolu, cleanup

### Context Menu ve UX (v2.2.3 — 2026-04-17)

- `AssetContextMenu.tsx` + `BlankContextMenu.tsx` — sag-tik baglam menusu
- `useAssetContextMenu` hook — menu durumu yonetimi
- Native context menu engellendi: `App.tsx` → `onContextMenu={(e) => e.preventDefault()}`
- Undo/redo destructive ops: kaynak klasor + asset + grup + sohbet silme Ctrl+Z ile geri alinabilir (`undoCommands.ts` + snapshot/restore)
- Tek dosya yeniden tarama
- TechnicalView virtualization + searchText cache

## 22c. Son Eklenen Ozellikler (v2.3.0 — v2.4.1)

### Veri Guvenligi Refactor (v2.3.0 — 2026-04-29)
- `ScanWriteBuffer` sinifi: tarama verisini rusqlite ile diske flush (sql.js RAM'den bagimsiz)
- `scan_db.rs` — `scan_write_batch` Tauri komutu, transaction icinde batch INSERT
- Checkpoint sistemi: her N dosyada (varsayilan 50) otomatik flush
- `saveDatabaseDeferred()` + `flushDeferredSave()` — kapanista veri kaybi onleme

### Pipeline Tarama (Asama 1 — v2.4.0)
- `processSingleEntry` → `prepareEntry` + `processEntry` ayristirma
- `p-limit` ile concurrency=3 pipeline staging (6-8x throughput artisi)
- Model warmup + rusqlite write path warmup — ilk dosya cold-start giderme
- `scan_prepare_workers` ayari (UI + otomatik oneri)

### Arama Sistemi (Faz 4.4 — v2.4.1)
- **Boolean arama**: `tokenizeBoolQuery` → `parseBoolExpr` → `evalBoolExpr` (AND/OR/NOT + tirnak frase)
- **Fuzzy arama**: Levenshtein distance, `fuzzyWordMatch()`, max %30 hata toleransi, 4+ karakter
- **Tarih araligi filtresi**: `DateRangeFilter` bileseni, `modifiedAt` bazli
- **DWG yapisal benzerlik**: 5 boyutlu composite scoring — `search_shapes_by_similarity` + `search_shapes_by_features` Rust komutlari
- **Seklil arama backend**: Convex hull (Andrew's monotone chain), Gaussian vertex similarity, compactness, solidity, rectangularity
- **Siralama**: modifiedAt + secondary sort + klasor boost (+0.12)
- **Filtre preset genisletme**: etiket + arama + tarih araligi preset'e dahil
- **Kisa kod destegi**: tire/nokta iceren kodlar (A1-c3) tokenizer oncesi substring olarak aranir

### Onay Kuyrugu ve DAM Ozellikleri (v2.4.0)
- `approval_log` tablosu: asset_id, from_status, to_status, reason, changed_by, changed_at
- `rejection_reason` kolonu (assets tablosu) + DetailPanel textarea
- DashboardView: Onay Kuyrugu paneli (bekleyen listesi, toplu onay/red)
- Otomatik versiyon kumeleme: `versionDetection.ts` — 10 pattern (_v1, _Rev-A, _FINAL, _DRAFT vb.)
- XMP sidecar metadata export: `archpro:RejectionReason` alani dahil

### Sistem Guvenligi ve Izleme (v2.4.0)
- Watch folders Phase 2: Ayarlar toggle + opt-in auto-rescan
- Fixity check: orneklem bazli bit-rot tespiti (`health_check_assets`)
- Eski format tespiti: Office binary → OOXML onerisi
- DPAPI ile LAN auth-code sifreleme
- fs:scope deny — hassas dizinler engellendi
- Login rate-limit + audit log retention
- Tarama raporlari: atlanan/hata dosyalar APP_DATA'ya TXT olarak
- F5/Ctrl+R webview reload engelleme

### UI/UX Iyilestirmeleri (v2.4.0+)
- Ayarlar kart tabanli UI yeniden tasarim
- Guncelleme sunucusu About'a tasindi
- TopBar: 4 arama butonu → tek "Gelismis Arama" dropdown
- Alt-klasor agaci — sidebar'da ic ice klasor navigasyonu
- Dashboard: boyut dagilimi + aylik buyume widget'lari
- Kopya bulucu: aninda iptal + O(n²) bucket filter optimizasyonu + buyuk arsiv uyarisi
- "Gelistiriciye Bildir" butonu — hata bildirimlerinde
- Retention/lockout/snapshot sureleri konfigurable

---

## 23. Bilinen Kisitlamalar

| Kisitlama | Aciklama |
|-----------|---------|
| Tek pencere | Coklu pencere destegi yok |
| SQLite boyut siniri | sql.js bellekte tutuyor; >500MB arsivler yavaslatabilir |
| Windows-only | Simdilik sadece Windows destegi (Tauri cross-platform ama test edilmedi) |
| Embedding aramasi O(n) | Binlerce embedding icin yeterli; milyonlar icin ANN gerekir |
| Ollama bagimli AI | Vision/OCR icin calisir durumda Ollama gerekir |
| LAN-only paylasim | Internet uzerinden paylasim yok |
| 2 rol | Sadece admin ve viewer; ozel roller yok |

---

## 24. Dosya Referans Indeksi

### Rust Modulleri (src-tauri/src/)

| Dosya | Satirlar | Birincil Sorumluluk |
|-------|----------|-------------------|
| dwg_parse.rs | 1616 | DWG binary parser, ODA entegrasyonu, OLE tespiti |
| max_version.rs | 1096 | 3ds Max surum, CFB metadata, layer/obje okuma, FBX/OBJ export |
| thumbnails.rs | 979 | 11 format icin thumbnail (MAX, RVT, PSD, PDF vb.) |
| ollama_db.rs | 999 | DB I/O, Ollama proxy, start/stop_ollama, SSRF guvenlik |
| text_extract.rs | 637 | Tam metin cikarma (PDF, Office, TXT vb.) |
| image_analysis.rs | 626 | EXIF, renk, pHash, boyut |
| office_utils.rs | 531 | MS Office CFB parse |
| lan_server.rs | 495 | HTTP sunucu, auth, rate limit, /dev-feedback |
| lib.rs | 427 | Komut kaydi (105 komut), makro dispatch, SessionRoleState |
| video_metadata.rs | 414 | Video codec/frame bilgisi |
| dxf_parse.rs | 409 | DXF ASCII parser + sekil indeksleme (extract_dxf/dwg_shapes) |
| ifc_metadata.rs | 365 | IFC dosya metadata (schema, storeys, building) |
| skp_version.rs | 359 | SketchUp surum + metadata |
| oda_converter.rs | — | ODA DWG→DXF donusturme onbellegi (convert_dwg_to_dxf_cached, clear_dxf_cache_cmd) |
| archive_share.rs | 241 | ZIP import/export |
| rvt_metadata.rs | 218 | Revit metadata + thumbnail cikarma |
| crash_report.rs | 208 | Panic yakalama |
| trash.rs | — | Cop kutusu: manifest okuma/yazma, dosya tasi/geri yukle/temizle |
| pdf_metadata.rs | 200 | PDF metadata |
| refile_fs.rs | 166 | Dosya sistemi islemleri |
| text_metadata.rs | 131 | Metin metadata |
| thumb_util.rs | 19 | JPEG encode yardimci |
| main.rs | 6 | Giris noktasi |

### Frontend Servisleri (src/services/)

| Dosya | Satirlar | Birincil Sorumluluk |
|-------|----------|-------------------|
| database.ts | 3062 | SQLite CRUD, cift arsiv, 24 tablo semasi |
| fileScanner.ts | 1990 | Dosya tarama orkestrasyonu (95+ format) |
| archiveOps.ts | 1261 | Join/Extract + rollback, coklu arsiv |
| ragService.ts | 901+ | RAG retrieve + hybrid + reranker + query rewrite + kapsam filtresi |
| duplicateDetection.ts | 792 | Kopya bulma algoritmalari |
| vision.ts | 722 | AI gorsel analiz |
| undoCommands.ts | 373 | Ince taneli undo komutlari (Command Pattern + snapshot) |
| messageService.ts | 406 | Mesajlasma sistemi |
| userService.ts | 375 | Kullanici yonetimi, PBKDF2 |
| embeddings.ts | 451 | Vektor uretimi (WASM MiniLM + CLIP) |
| logger.ts | 357 | Loglama alt sistemi |
| tagService.ts | 318 | Etiket CRUD |
| taskRunner.ts | 288 | Arka plan gorevler |
| exportService.ts | 226 | Toplu disari aktarma |
| queryExpansion.ts | 222 | Sorgu genisletme |
| notificationCenter.ts | 197 | Toast bildirimler |
| batchActions.ts | 193 | Toplu islemler |
| ollamaService.ts | — | Birlesik Ollama servisi (ping/pull/start/stop/model listele) |
| chatExport.ts | — | Sohbet Markdown export |
| visualSearch.ts | 117 | CLIP metin→gorsel arama |
| chatStorage.ts | — | chat_sessions/messages CRUD, CASCADE silme |
| undoRedo.ts | — | Geri al/Yinele altyapisi (Command stack, 50 depth) |

### React Bilesenleri (src/components/)

| Dosya | Satirlar | Birincil Sorumluluk |
|-------|----------|-------------------|
| DetailPanel.tsx | 1512 | Asset detay ve onizleme |
| DuplicateFinderModal.tsx | 1275 | Kopya bulucu |
| ArchiveExtractModal.tsx | 1080+ | Filtreli asset cikarma |
| SetupWizard.tsx | 993 | Ilk kurulum sihirbazi |
| ChatPanel.tsx | 543 | RAG sohbet kok bileseni (8 alt bilesene bolundu) |
| SettingsModal.tsx | 906 | Ayarlar (4 sekme) |
| FeedbackModal.tsx | 842 | Mesajlasma + gelistirici |
| ArchiveMergeModal.tsx | 600+ | Iki arsivi birlestirme |
| Sidebar.tsx | 526 | Filtreler, favoriler, etiket paneli |
| ScanModal.tsx | 524 | Tarama arayuzu |
| RefileModal.tsx | 519 | Dosya duzenleme |
| SourceFoldersPanel.tsx | 716 | Kaynak klasor yonetimi (grup/renk/favori) |
| AISettingsModal.tsx | 468 | AI yapilandirma + Kurulum Sihirbazi butonu |
| LanSharingPanel.tsx | 415 | LAN paylasim |
| LogViewerModal.tsx | 393 | Log goruntuleme |
| UserManagementModal.tsx | 386 | Kullanici yonetimi |
| UserProfileModal.tsx | 359 | Profil duzenleme |
| StatusBar.tsx | 335 | Durum cubugu |
| AISetupWizard.tsx | ~310 | 3 adimli AI kurulum sihirbazi |
| BlankContextMenu.tsx | 234 | Bos alan sag-tik menuu |
| AssetContextMenu.tsx | 217 | AssetCard sag-tik menuu |
| VisualSearchModal.tsx | 179 | CLIP gorsel arama modal |
| AIStatusBadge.tsx | ~130 | TopBar AI durum gostergesi |

---

*Bu dokuman `scripts/update-docs.sh` tarafindan her commit'te otomatik guncellenir.*
*Son elle guncelleme: 2026-05-21 · Surum: 2.4.10*

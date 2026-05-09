# ArchivistPro — AI Asistan Icin Proje Baglami

## Proje Nedir
Mimarlik ofisleri icin tamamen offline masaustu arsiv yonetim uygulamasi.
Tauri v2 (Rust) + React 19 (TypeScript) + SQLite (sql.js WASM).
80+ dosya formati destegi (DWG, MAX, SKP, PSD, PDF, Office, Video vb.).
AI semantik arama (yerel embedding), LAN paylasim, cift arsiv (main + local).

## Hizli Komutlar
```bash
npm run dev           # Frontend dev server (port 5173)
npm run tauri dev     # Tam Tauri gelistirme modu
npx tsc --noEmit      # TypeScript tip kontrolu
cargo check --manifest-path src-tauri/Cargo.toml  # Rust derleme kontrolu
npm test              # Vitest birim testleri
npm run lint          # ESLint
```

## Mimari Ozet (v2.4.4 — son olcum 2026-05-05)
- **Frontend**: src/ — 99 bilesen, 53 servis, 25 hook, Zustand store (~77.000+ satir)
- **Backend**: src-tauri/src/ — 28 Rust modulu, **134 Tauri komutu** (~15.000 satir)
- **DB**: sql.js WASM SQLite + rusqlite (tarama), 25 tablo, **coklu arsiv** (main + local + ek arsivler via withArchive)
- **State**: Zustand tek store (src/store/useStore.ts)
- **i18n**: 5 dil (tr, en, zh, ja, ar), i18next — 5/5 dil %100 (1825+ anahtar)
- **AI**: MiniLM metin (multilingual 384-dim) + CLIP gorsel (512-dim), **tam offline paketli**
- **Roller**: admin | viewer | developer flag (is_developer) — RBAC cift katmanli
- **Test**: 2038 test, 0 fail — coverage stmt %64 / branch %53 / funcs %79

## Onemli Konvansiyonlar
- **Dil**: Kullanici gorunurlugundeki metinler i18n uzerinden (t('anahtar'))
- **Yeni komut**: Rust'ta #[tauri::command] + lib.rs makrolarına ekle
- **Yeni tablo**: database.ts → _applySchema() icinde CREATE TABLE IF NOT EXISTS
- **Admin-only**: Rust'ta require_admin(), frontend'te <ProtectedAction>
- **i18n**: Her yeni metin icin en az tr.json + en.json guncelle
- **DB yazma**: Viewer ana arsive yazamaz; saveDatabase() kontrol eder
- **Commit hook**: scripts/update-docs.sh DEVELOPER_GUIDE.md'yi oto-gunceller

## Dosya Yapisi (Anahtar)
```
src/services/database.ts    — SQLite CRUD, sema, arsiv yonetimi
src/services/fileScanner.ts — Tarama orkestrasyonu
src/store/useStore.ts       — Zustand state
src/types.ts                — Asset, FacetKey, SearchResult tipleri
src/appVersion.ts           — APP_VERSION, APP_BUILD_DATE
src-tauri/src/lib.rs        — Komut kaydi, SessionRoleState
src-tauri/src/ollama_db.rs  — DB I/O, Ollama proxy
src-tauri/src/lan_server.rs — LAN sunucu (port 9471)
src-tauri/tauri.conf.json   — Tauri yapilandirma
docs/DEVELOPER_GUIDE.md     — Kapsamli gelistirici rehberi
```

## Detayli Dokumantasyon
- **Kritik:** Her oturumda once [.claude/MEMORY.md](.claude/MEMORY.md) oku — guncel versiyon, olgunluk skoru, yeni ozellikler, bilinen sorunlar ve aktif docs-drift notlari orada. Bu dosya 3 bilgisayar arasinda `git pull` ile senkron.
- **Tam teknik referans**: [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)
- **Teknik borc/ertelenen**: [docs/TODO.md](docs/TODO.md)
- **Arsivlenmis audit/review**: docs/archive/ — tarihsel snapshot'lar (2026-04-07..11)

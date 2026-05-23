# ArchivistPro

**Mimari dosya arşivi ve akıllı arama uygulaması**
DWG · MAX · IFC · RVT · SKP · PDF ve 95+ format desteği

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.4.5-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

> **[English README](README_EN.md)**

---

## Özellikler

| Alan | Açıklama |
|------|----------|
| **Dosya Tarama** | 95+ format, SHA-256 dedup, özyinelemeli klasör tarama |
| **Önizleme** | DWG, 3DS MAX, PSD, PDF, Office, video thumbnail üretimi |
| **Akıllı Arama** | CLIP görsel arama (metin→görüntü), semantik metin arama, sorgu genişletme, DWG geometrik şekil arama |
| **Metadata** | DWG binary parse, MAX CFB (layer/obje), RVT, IFC, SKP, EXIF, Office OOXML |
| **Arşiv Yönetimi** | Çoklu arşiv (main + local + ek), `.archivistpro` export/import, LAN paylaşım sunucusu |
| **Kullanıcı Yönetimi** | RBAC (admin/viewer), PBKDF2-SHA256 kimlik doğrulama |
| **AI Sohbet (RAG)** | Arşivdeki dosyalar üzerine offline Q&A (Ollama), çok-belge sentezi, Markdown export |
| **AI Yardımcıları** | Otomatik etiket önerileri, AI Setup Wizard, Ollama başlat/durdur |
| **Proje Durumu** | Müşteri adı, onay durumu, versiyon etiketi, teslim tarihi takibi |
| **Dosya İlişkileri** | DWG↔PDF, Model↔Render otomatik tespit, manuel bağlantı |
| **UX** | Bağlam menüleri, geri al/yinele (yıkıcı işlemler için) |
| **Dil Desteği** | 5 dil: Türkçe, İngilizce, Çince, Japonca, Arapça |

---

## Gereksinimler

- **İşletim Sistemi:** Windows 10/11 (64-bit)
- **Node.js:** 20+
- **Rust:** 1.77.2+
- **Ollama:** (opsiyonel, AI özellikleri için) — [ollama.com](https://ollama.com)

---

## Kurulum ve Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır (Tauri + Vite HMR)
npm run tauri dev

# Sadece frontend (Tauri olmadan)
npm run dev

# Production build
npm run tauri build
```

### Özellik Bayrakları (Rust feature flags)

```bash
# Admin özellikli build (varsayılan)
npm run build:admin

# Viewer-only build
npm run build:viewer
```

---

## Proje Yapısı

```
Arsiv-H2/
├── src/                        # React/TypeScript frontend
│   ├── components/             # UI bileşenleri
│   ├── hooks/                  # React custom hooks
│   ├── services/               # İş mantığı servisleri
│   ├── store/                  # Zustand global state
│   ├── i18n/locales/           # 5 dil çeviri dosyaları (TR, EN, ZH, JA, AR)
│   └── config/                 # Uygulama sabitleri
├── src-tauri/                  # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── lib.rs              # Giriş noktası, command kaydı
│   │   ├── thumbnails.rs       # 9+ format thumbnail üretimi
│   │   ├── ollama_db.rs        # DB I/O + Ollama proxy
│   │   ├── crash_report.rs     # Yerel hata raporlama
│   │   └── ...                 # Metadata parser modülleri
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/
│   ├── ci.yml                  # Lint + test + build
│   └── release.yml             # Tag-triggered release
└── docs/
    ├── INSTALL.md
    └── TECHNICAL_REFERENCE.md
```

---

## Mimari

```
Frontend (React 19 + TypeScript + Vite)
    │
    ├─ Zustand store (global state)
    ├─ sql.js WASM (SQLite in-memory + disk sync, 24 tablo)
    ├─ Transformers.js (MiniLM 384-dim + CLIP 512-dim embedding)
    └─ Tauri IPC ──► Rust Backend (105 komut, 23 modül)
                        ├─ thumbnail üretimi (image, DWG, MAX, PDF, Office…)
                        ├─ dosya sistemi işlemleri
                        ├─ Ollama proxy (SSRF korumalı)
                        ├─ LAN HTTP sunucusu (tiny_http, port 9471)
                        └─ crash log yazımı
```

**Ölçümler (v2.2.3+, 2026-04-19):** 56 bileşen · 47 servis · 105 Tauri komutu · 751 test · ~62.500 satır

---

## AI Özellikleri

Tüm AI işlemleri **tamamen yereldir** — bulut bağlantısı gerekmez.

| Özellik | Açıklama | Gereksinim |
|---------|----------|------------|
| **Semantik Metin Arama** | MiniLM çok dilli 384-dim embedding | Paketli (kurulum yok) |
| **Görsel Arama (CLIP)** | Metin sorgusundan görüntü bulma, 512-dim | Paketli (kurulum yok) |
| **AI Sohbet (RAG)** | Arşiv dosyaları üzerine Q&A, çok-belge sentezi | Ollama + model |
| **AI Etiket Önerileri** | Dosya içeriğinden otomatik etiket üretimi | Ollama + model |
| **DWG Şekil Arama** | Geometrik şekil tabanlı CAD arama (Faz 4) | Paketli |
| **Sohbet Export** | Konuşma geçmişini Markdown olarak dışa aktar | — |

Ollama **opsiyoneldir**: tarama, arama ve metadata özellikleri Ollama olmadan da çalışır.
AI sohbet için Ollama kurulumu yapılmadan da uygulama **AI Setup Wizard** ile kurulumu adım adım yönlendirir.

---

## Desteklenen Formatlar (seçme)

| Kategori | Formatlar |
|----------|-----------|
| **CAD/BIM** | DWG · DXF · DWF · IFC · RVT · RFA · NWD · NWC · 3DM |
| **3D** | MAX · MB · FBX · OBJ · SKP · BLEND · 3DS · C4D · STL |
| **Belge** | PDF · DOCX · XLSX · PPTX · DOC · XLS · PPT |
| **Görüntü** | PSD · AI · EPS · SVG · PNG · JPG · TIFF · RAW |
| **Video** | MP4 · MOV · AVI · MKV · WMV |

---

## Güvenlik

- Kimlik doğrulama: PBKDF2-SHA256 (100.000 iterasyon, 16 byte salt)
- Path traversal koruması: çift katman (literal + canonicalize)
- SSRF koruması: Ollama proxy allowlist
- XSS koruması: escapeHtml + DOMPurify + React JSX
- RBAC: admin / viewer rolleri

Detaylar için → [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md)

---

## Test

```bash
# Birim testler
npm test

# Watch modu
npm test -- --watch

# Kapsam raporu
npm test -- --coverage
```

---

## Release

Yeni sürüm yayınlamak için:

1. Sürüm numaralarını 4 dosyada senkronize et:
   - `src/appVersion.ts`
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. İlk seferinde signing key üret:
   ```bash
   npx tauri signer generate -w ~/.tauri/archivistpro.key
   # Public key → tauri.conf.json plugins.updater.pubkey
   # Private key → GitHub Secret: TAURI_SIGNING_PRIVATE_KEY
   ```

3. Tag oluştur → CI otomatik build + draft release:
   ```bash
   git tag v2.2.3
   git push origin v2.2.3
   ```

CI pipeline → `.github/workflows/release.yml`

---

## Lisans

[MIT](LICENSE) © 2026 ArchivistPro

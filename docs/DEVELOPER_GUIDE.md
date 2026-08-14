# ArchivistPro — Geliştirici Rehberi

> Bu rehber **yeni nesil kod tabanını** (3.3.x hattı) anlatır. Eski neslin
> (3.2.x) rehberi tarihsel kayıt olarak [`archive/DEVELOPER_GUIDE_H2.md`](archive/DEVELOPER_GUIDE_H2.md)
> altında durur; eski kaynak ağacının son hali `legacy-h2-final` git tag'indedir.

## Mimari (tek cümle)

**Rust veriyi sahiplenir; native SQLite tek doğruluk kaynağıdır; arayüz (renderer)
veritabanını asla bellekte tutmaz, yalnız sayfalı sorgu API'siyle okur.**
Ayrıntı: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Teknolojiler

| Katman | Teknoloji |
|---|---|
| Kabuk | Tauri v2 |
| Backend | Rust — çok crate'li Cargo workspace |
| Veri | native SQLite (rusqlite) + FTS5 + sqlite-vec |
| Embedding | Rust ONNX Runtime (`ort`) — tarayıcıda değil |
| Frontend | React 19 + TypeScript + Tailwind, Zustand (slice'lı) |
| LLM/RAG | Ollama (opsiyonel, harici) |

## Depo yapısı

| Dizin | İçerik |
|---|---|
| `crates/archivist-db` | Veri katmanı: şema, versiyonlu migration'lar, sorgular, FTS, vektör |
| `crates/archivist-ingest` | Tarama/indeksleme hattı (hash, MIME, artımsal atlama) |
| `crates/archivist-extract*` | Metin / görsel / CAD (DWG, IFC, SKP…) metadata çıkarımı |
| `crates/archivist-embed` | Embedding modelleri (ONNX) |
| `crates/archivist-thumbnail` | Önizleme üretimi |
| `crates/archivist-h2import` | Eski nesil (3.2.x) arşivinden içe aktarma |
| `crates/archivist-server` | Yerel ağ erişim katmanı |
| `src-tauri/` | Tauri kabuğu: komutlar, RBAC, iş kuyruğu |
| `src/` | React frontend: feature-based modüller, sorgu-hook katmanı, i18n (5 dil) |
| `e2e/` | Playwright uçtan uca testleri |

## Kurulum ve geliştirme

Önkoşullar: Windows 10/11 (64-bit), Node.js 20+, Rust (stable), WebView2 Runtime.

```bash
git clone https://github.com/ahmet3ddd/ArchivistPro.git
cd ArchivistPro
npm install
npm run tauri dev     # tam uygulama (ilk Rust derlemesi uzun sürer)
npm run dev           # yalnız frontend (Vite, port 5173)
```

## Test ve doğrulama

```bash
npm test                                        # Vitest (frontend)
npx tsc --noEmit                                # TypeScript tip kontrolü
cargo test --workspace                          # tüm Rust testleri
cargo test -p archivist-db                      # yalnız veri katmanı (en kritik)
cargo clippy --workspace --all-targets -- -D warnings   # lint: 0 uyarı beklenir
npm run test:e2e                                # Playwright E2E
```

## Konvansiyonlar

- **Kullanıcıya görünen her metin i18n'den geçer** (`t('anahtar')`); en az `tr` + `en` güncellenir (toplam 5 dil).
- **Migration'lar versiyonlu ve ileri yönlüdür**; her migration test ister (`crates/archivist-db/tests/`).
- **Gerçek yetki denetimi Rust komutundadır** (RBAC); frontend'deki izin yalnız arayüz gizler.
- ~500 satırı geçen bileşen/modül bölünür (saf refactor, ayrı commit).
- Aynı sürüm numarasıyla farklı içerik asla paketlenmez; sürüm `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` üçlüsünde birlikte artar.

## Katkı

Süreç ve PR kuralları için: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)

# ARCHITECTURE — Hedef Mimari (kuzey yildizi)

> H3'un varmak istedigi yer. Gerekce: `00_RATIONALE_ALTERNATIF_RAPOR.md`.
> Bu dosya "ne insa edecegiz"in tek kaynagidir; karar degisirse burasi guncellenir.

## Tek cumle
**Rust veriyi sahiplenir. Renderer ince bir goruntu katmanidir.**

## Katman diyagrami
```
┌──────────────────────────────────────────────────────────────┐
│  RENDERER — React 19 + TS + Tailwind + Zustand(slice)        │
│  • DB'yi ASLA bellekte tutmaz                                 │
│  • Veri erisimi: typed query-hook (sayfalama + cache)        │
│  • Sanallastirilmis grid/list/detay                          │
├──────────────────────────────────────────────────────────────┤
│  TAURI IPC — tipli komut/sorgu kontrati                      │
├──────────────────────────────────────────────────────────────┤
│  RUST WORKSPACE (cok-crate) — FIILI (2026-07-16 dogrulandi)  │
│   archivist-db · archivist-extract{,-text,-image,-cad} ·     │
│   archivist-embed · archivist-thumbnail · archivist-ingest · │
│   archivist-server   [+ src-tauri `archivist` = kabuk/binary]│
│   ── isler: scan · embed · thumb · tag (bkz ilke #4 notu) ── │
├──────────────────────────────────────────────────────────────┤
│  DEPOLAMA — native SQLite                                    │
│   assets/tags/relations · FTS5 · vektor(sqlite-vec|index.db) │
│   WAL (yerel) / DELETE (UNC-ag)                              │
└──────────────────────────────────────────────────────────────┘
```

## Teknoloji + neden
| Katman | Secim | Neden |
|---|---|---|
| Kabuk | Tauri v2 | Offline masaustu: kucuk binary, Rust backend, capability guvenligi. |
| Backend | Rust **workspace** | Tek crate → 6.23 GB rlib → rustc 4 GB metadata siniri → build coker. Workspace yapisal cozer + paralel derleme + modul siniri. |
| Veri | native SQLite (rusqlite/sqlx) | Heap siniri yok, **tek dogruluk kaynagi**, transactional. Renderer'da sql.js YOK. Epoch destani DOGMAZ. |
| Keyword | FTS5, 1. gunden | "yok halusinasyonu" sinifini bastan engeller. |
| Vektor | sqlite-vec (DB-ici) **[catallı]** | Custom HNSW reload-panigi/flaky sinifini yok eder. Catal: ayri index.db de savunulabilir (bkz STATUS). |
| Frontend | React 19 + TS | Olgun; store **slice'li**, veri **sorgu-hook**'la. |
| Embedding | Rust `ort`/`candle` | Tarayici-embedding CSP/UI-thread/fp32 cilesini kapatir. |
| LLM/RAG | Ollama (opsiyonel) | Dogru sinir: yoksa arama+gorsel+dedup yine calisir. |
| State | Zustand (slice) | auth/archive/modal/filter/task ayri; tek-bag YOK. |

## Cekirdek ilkeler (degismez)
1. **Tek motor sahipligi:** DB'yi yalniz Rust acar/yazar. (H2 bozulmasi sql.js↔rusqlite **iki motor** carpismasiydi.)
2. **Renderer ince:** sadece o anki sayfayi tutar (~200 satir), tum DB'yi DEGIL.
3. **Migration 1. gunden:** versiyonlu, ileri-yonlu, test'li framework.
4. **Isler UI'dan ayri:** scan/embed/thumb/tag → kalici, resumable kuyruk.
   ⚠️ **KISMEN karsilandi — bkz §Bilinen sapmalar (1).**
5. **Dosya boyu ≤ ~500 satir;** asan bolunur.
6. **Gercek yetki Rust'ta;** frontend izni yalniz UI.

## Bilinen sapmalar (fiili kod ↔ bu belge) — 2026-07-16 denetimi
> Bu bolum **kararlari onaylamaz**, gercegi kaydeder. Her madde ya kapatilir ya da
> bilincli sapma olarak RATIONALE'ye tasinir. Sessiz sapma YOK.

1. **Ilke #4 — kalici kuyruk YOK, "turetilmis-durum" deseni var.** `archivist-jobs` crate'i ve
   `jobs` tablosu hic kurulmadi. Bekleyen is DB'den TURETILIR:
   `assets_without_vectors(after_id, BATCH)` + imlec + `index_skips` (basarisiz-atlama, sonsuz
   dongu yok); idempotent + test'li. ⇒ **"resumable" ✅** ve kuyruk-kaymasi/bayat-is sinifini hic
   dogurmaz (tartismali olarak kuyruktan IYI). **Ama "UI'dan ayri" ❌:** isler renderer'dan
   tetiklenen uzun-omurlu Tauri komutlaridir → uygulama kapanirsa is durur; oturumlar arasi
   OTO-devam yok (elle tetikle → artimsal atlama hizli bitirir). **Karar-kapisi:** kabul + belgeyi
   guncelle, MI gercek kuyruk kur?
2. **Uzun yazma isleri uygulama omrune bagli; okuma baglantisi ayrildi.**
   `AppState` artik yazma icin `db`, sorgular icin ayri salt-okunur `read_db` baglantisi tasir;
   renderer okumalari uzun ingest'in yazma mutex'ini paylasmaz. `cancel_ingest` DB'ye dokunmadan
   kilitsiz atomik bayrakla calisir ve LAN sorgulari da kendi okuma baglantilarini acar. Boylece
   onceki "tarama boyunca butun okumalar donar" sapmasi yerel WAL kullaniminda kapatilmistir.
   Kalan sinir: ingest/embed gibi isler hala uzun omurlu Tauri komutlaridir; uygulama kapaninca
   durur ve sonraki oturumda otomatik baslamaz. Ayrica UNC/ag paylasimindaki DELETE journal modu
   icin eszamanli okuma-yazma davranisi ayri olculmelidir.
3. **Ilke #5 (≤~500 satir) — 14 uretim + 4 test dosyasi asiyor** (yeniden olculdu **2026-07-25**;
   488 kaynak dosya. Onceki kayit "6 uretim" diyordu — bayatlamisti). En buyuk uretim:
   `FacetSidebar.tsx` 726 · `src-tauri/src/lib.rs` 698 · `lan_commands.rs` 692 · `query/mod.rs` 641 ·
   `ChatView.tsx` 638 · `query/list.rs` 622 · `useUiStore.ts` 604 · `image.rs` 582 ·
   `remote_archive.rs` 579 · `oda.rs` 572 · `scanned_roots.rs` 546 · `image_commands.rs` 536 ·
   `merge.rs` 527 · `archivist-server/src/lib.rs` 507. H2'ye kiyasla (1000+ satir dosyalar) kucuk
   sapma; kaynak dosyalarin **%2.9'u** — ama oran BUYUYOR. Firsat buldukca saf-refactor ile bolunur
   (ayri commit). ⚠️ Bu satir her olcumde tazelenir; tahminle yazilmaz.

## Eklenecekler (H2'de retrofit, burada 1. gunden)
- Kalici/ resumable is kuyrugu · "Doctor"/onarim+butunluk paneli · ingest-ani
  fixity+dedup · plugin extractor (riskli DWG → out-of-process sidecar) ·
  hibrit aramayi tek fusion pipeline + "neden bu sonuc" aciklamasi.

## Korunanlar (H2 dogru yapmisti)
Tauri v2 · offline-first · yerel embedding · opsiyonel Ollama · cift-arsiv
**kavrami** · 5-dil i18n (RTL dahil) · audit/crash · WAL/UNC ayrimi.

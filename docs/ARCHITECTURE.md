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
   **2026-08-17:** ayrim ARTIK TAM — geride kalan RAG salt-okuma yollari (`asset_chunks`,
   `rag_index_status`, kapsam cozumu, hassasiyet sorgusu, chunk retrieval, liste-niyeti
   aramasi, CLIP gorsel fallback) da `read_db`'ye tasindi; onceki hal "Gezgin akiyor ama
   sohbet donuk" tutarsizligini uretiyordu. Manuel `run_rag_indexing` de arka-plan indexer
   ile ayni **asset-basina** kilit granularitesine gecti (once iki kilidi kosu boyunca
   tutuyordu).
   Kalan sinir: ingest/embed gibi isler hala uzun omurlu Tauri komutlaridir; uygulama kapaninca
   durur ve sonraki oturumda otomatik baslamaz. Ayrica UNC/ag paylasimindaki DELETE journal modu
   icin eszamanli okuma-yazma davranisi ayri olculmelidir.
3. **Ilke #5 (≤~500 satir) — 33 uretim + 9 test dosyasi asiyor** (yeniden olculdu
   **2026-08-17**; 555 kaynak dosya → **%7.6**). Onceki kayit "14 uretim + 4 test / %2.9"
   diyordu ve 2026-07-25 tarihliydi — bayatlamisti. En buyuk uretim dosyalari:
   `vision_commands.rs` **1618** · `FacetSidebar.tsx` 918 · `image.rs` 885 · `vision.rs` 831 ·
   `ChatView.tsx` 822 · `ollama.rs` 817 · `rag.rs` 794 · `lib.rs` 758 · `lan_commands.rs` 750 ·
   `commands/ingest.rs` 750 · `query/mod.rs` 742 · `useUiStore.ts` 734 (kalan 21 dosya 500–719).
   Oran **iki katindan fazla buyudu**; H2'ye kiyasla hala kucuk sapma ama trend yanlis yonde.
   Firsat buldukca saf-refactor ile bolunur (ayri commit).
   ⚠️ Bu satir her olcumde tazelenir; tahminle yazilmaz.

   **Not — rlib/metadata riski YOK (2026-08-17'de olculdu).** `src-tauri` 22.194 satirla
   workspace'in en buyuk crate'i (`archivist-db` 15.400) ve bu, H2'nin 6,23 GB rlib cokusunu
   cagristiriyor. Olcum bunu **curutuyor**: workspace'in kendi crate'lerinin `.rmeta` dosyalari
   1–2 MB (H2'yi cokerten ~4 GB metadata tavaninin bindebiri); en buyuk `.rmeta` 87 MB ve o da
   harici `windows` crate'ine ait. `libarchivist_lib.rlib` 423 MB'dir ama bu debug kod objesidir,
   metadata degil. ⇒ Cok-crate karari H2'nin YAPISAL hatasini gercekten cozmus. Dosya bolme
   gerekcesi yalniz okunabilirliktir, build sinir riski DEGIL.

## Eklenecekler (H2'de retrofit, burada 1. gunden)
> Durum **2026-08-17'de kodla dogrulandi** (bkz `docs/reviews/2026-08-17-karsi-denetim-*`).
> Bu bolum uzun sure tamamlanmis yetenekleri "gelecek is" gibi listeledi — sapma kapatildi.

- ✅ **"Doctor"/onarim+butunluk paneli** — `src-tauri/src/commands/health.rs`
  (`db_health`, `repair_db`) + `src/features/settings/HealthDoctorCard.tsx`.
- ✅ **Ingest-ani fixity+dedup** — `archivist-ingest/src/hash.rs`, `staleness.rs` ·
  `archivist-db/src/dedup.rs` · `src-tauri/src/dedup_commands.rs` · `FixitySection.tsx`.
- ✅ **Hibrit aramayi tek fusion pipeline** — `archivist-db/src/rag.rs` (RRF, `RRF_K = 60`)
  + keyword-gate.
- ✅ **"Neden bu sonuc" aciklamasi** — `archivist-db/src/query/list.rs` `match_sources`
  (alan-atfi, testli) + `src/features/assets/detail/MatchSourcesSection.tsx`.
- ⬜ **Kalici/resumable is kuyrugu** — GERCEKTEN acik, ama bilincli: `jobs` tablosu
  kurulmadi; yerine "turetilmis-durum" deseni var (bkz §Bilinen sapmalar 1). ROADMAP'te
  "Sirada" olarak duruyor.
- ⬜ **Plugin extractor (riskli DWG → out-of-process sidecar)** — GERCEKTEN acik.
  ⚠️ ODA File Converter harici bir surectir ama o bir **donusturucudur**, sidecar degil:
  ODA yokken kosan Rust raw-scan parser'i hala SUREC ICINDEDIR (`catch_unwind` + timeout
  siniriyla izole). Sidecar yeniden acilacaksa yeni olcum/tehdit modeli gerekir.

## Korunanlar (H2 dogru yapmisti)
Tauri v2 · offline-first · yerel embedding · opsiyonel Ollama · cift-arsiv
**kavrami** · 5-dil i18n (RTL dahil) · audit/crash · WAL/UNC ayrimi.

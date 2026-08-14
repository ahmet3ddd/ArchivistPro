# v3-architecture — Yüksek-Risk Faz De-Risk Stratejileri

> Üretim: 2026-05-15 (v3-architecture dalı, Sprint 0 sırasında). Plan: `.claude/plans/temporal-enchanting-beaver.md`.
> Bu doküman Sprint 1/2/3 başlamadan ÖNCE okunmalı ve hazırlık kontrol listeleri tamamlanmalı.

---

## 0. Çapraz-Kesen KRİTİK Bulgu (Gate 0) — sıralamayı zorunlu kılar

V3-3 analizi, plandaki sıralamayı **zorunlu** kılan bir tehlike ortaya çıkardı:

Ana DB'ye **iki yazma yolu** çarpışıyor:
1. **Blob-overwrite** — `write_database`/`write_local_database`/`write_archive` (`ollama_db.rs:662/736/940`): frontend sql.js `db.export()` tüm DB'yi bayt olarak gönderir; `write_and_sync` (`ollama_db.rs:146`) dosyayı sil+rename ile tamamen değiştirir.
2. **Targeted rusqlite** — `scan_db.rs` (`write_scan_batch_to_db:905`, `audit_log_apply_changes:1217`, `write_chat_mirror:1367` +7): aynı dosyaya noktasal yazar.

Global `DB_WRITE_LOCK` (`ollama_db.rs:136`) bu ikisini serileştiren TEK mekanizma. **WAL açılırsa**: targeted yol commit'i `-wal`'de bırakır, ardından blob-overwrite ana `.db`'yi rename'ler ama stale `-wal`/`-shm` yetim kalır → bir sonraki açılışta stale WAL replay → **deterministik sessiz veri bozulması** (sqlite.org/howtocorrupt teyitli).

**GATE 0 (zorunlu):** Ana DB'de WAL, ancak V3-2 (Sprint 1) blob-overwrite yolunu ağır tablolardan ayırdıktan SONRA açılabilir. Plan sırası (V3-6 → V3-2 → V3-1 → V3-3) bunu zaten sağlıyor — strateji bunu kapılarla sağlamlaştırır.

---

## 1. V3-2 (Sprint 1) — sql.js → rusqlite-only kademeli taşıma

**Temel risk teşhisi:** Tehlike "tablo taşımak" değil, **sql.js dump'ının taşınan tabloları ezdiği iki-kaynaklı pencere**.

**INVARIANT (sıfır-veri-kaybı):**
- `verify` geçmeden sql.js'ten `DROP` YOK.
- `DROP TABLE` + `PRAGMA user_version=N` **tek atomik sql.js write**'ında (`write_and_sync` tmp→rename).
- `*_vec.db` kanonik; ANN türetilmiş.
- copy → verify → DROP sırası asla bozulmaz (FAIL → DROP yapılmamış → sql.js sağlam → fallback).

**Anahtar mekanizmalar:**
- `PRAGMA user_version` epoch: 0=v2.4.9 monolit, 1=embeddings taşındı, 2=text_chunks, 3=asset_relations.
- `INSERT OR IGNORE` + `migration_progress` tablosu → idempotent, power-loss resume.
- `_migrationInProgress` bayrağı (`_scanWriteLock:1150` deseni) → migrasyon aktifken sql.js dump yazılmaz.
- Premigrate zorunlu atomik yedek (`archive_share.rs:189-200` `db.bak` deseni); yedek başarısız → migrasyon başlamaz.
- 3-katman doğrulama: COUNT eşitliği + içerik-hash + embedding blob round-trip (dim*4 assert, float ε<1e-6).
- Çoklu-arşiv: her invoke zorunlu `archiveAt` (shapes_db imza modeli); `<stem>_vec.db` (`resolve_shapes_db_path:66-79` deseni).
- Sıra gerekçesi: embeddings ilk (en büyük heap kazancı, en dar tüketici `getAllChunkEmbeddings:2228`→`getRagCachedEmbeddings:104`, Sprint 2 doğrudan üstüne oturur).

**En kritik tehlikeler:** T1 iki-kaynak ezilmesi (DROP'u şemadan çıkar + epoch ile atomik), T4 export/import `_vec.db` paketlenmez (`archive_share.rs` + manifest `schemaEpoch`), T9 cross-DB FK yok (asset DELETE → vec.db cascade invoke + orphan temizlik).

**Sprint 1 öncesi:** Sprint 0 tam; sentetik dataset (boş/1K/100K/1.13M/bozuk/kısmi-migre); gerçek v2.4.9 DB kopyası; baseline heap ölçümü (hedef <2GB); epoch/invariant/yedek/fallback-flag tasarımı kilitli.

---

## 2. V3-1 (Sprint 2) — O(n) cosine → HNSW ANN

**INVARIANT-1 (Kanoniklik):** Vektörlerin tek doğruluk kaynağı her zaman `embeddings.vector_blob` (V3-2 sonrası rusqlite). ANN index = deterministik türev; yanlış/bozuk/eski → sil → rebuild → sıfır kayıp. "Geri dönüşsüz format" riski → "yeniden hesaplanabilir cache invalidation"a iner.

**Crate önerisi: `hnsw_rs` ≥0.3.4** (commit'li). Gerekçe: gerçek inkremental `insert` (instant-distance build-once eler), `datamap` mmap (heap tezimizle birebir), `insert_parallel` (rebuild gate), SIFT1M recall ~0.99, MIT/Apache-2.0. `VectorIndex` trait arkasına soyutlanır (swap maliyetsiz).

**Anahtar mekanizmalar:**
- `src-tauri/src/vector_index.rs` yeni modül (`shapes_db.rs` deseni); `_ann/` dizini + `index_meta.json` sidecar (schema_version, crate, crate_version, embedding_dim, model_id, distance, vector_count, source_fingerprint).
- Otomatik-rebuild tetikleri: meta yok / şema-versiyon / crate-major / dim / model_id uyuşmazlığı / load Err / count sapması >%1.
- Atomik: `_ann.tmp/` → başarıda rename; iptal = AtomicBool; rebuild sırasında brute-force fallback aktif.
- Brute-force fallback **silinmez** (`embeddings.ts:679`, `ragService.ts:746-758` durur): vector_count<~10K, index yok/bozuk, search Err, dim-mismatch.
- Recall gate: recall@10 ≥ 0.98, recall@1 ≥ 0.97 (ground-truth = mevcut `cosineSimilarity:662`); CI regresyon testi.
- İnkremental: tarama checkpoint'inde `add`; HNSW hard-delete yok → soft tombstone + %20 eşik periyodik compaction-rebuild; `source_fingerprint` ile stale tespit.
- `ragService.retrieve:708` kontratı DEĞİŞMEZ; sadece Stage 3 (`:743-758`) dallanır; RRF/FTS5/metadata dokunulmaz.

**Sprint 2 öncesi:** Sprint 1 tam (rebuild kaynağı rusqlite embeddings); izole scratch'te `cargo add hnsw_rs@0.3` + `cargo check` Rust 1.77.2/MSVC yeşil (T8); `examples/ann_bench` harness ile 1M'de recall+latency+RAM gate "onaylı"; trait/meta şeması dondu; recall CI testi eklendi.

---

## 3. V3-3 (Sprint 3) — Per-archive kilit + WAL + (pool ertelendi)

**Risk dağılımı eşit değil:** per-archive in-process kilit = düşük risk, bağımsız teslim edilebilir; WAL geçişi = tek başına ölümcül (Gate 0); connection pool yazma için **gereksiz** (SQLite single-writer), ertelenir.

**Anahtar mekanizmalar:**
- `DB_WRITE_LOCK` global Mutex → `HashMap<PathBuf, Arc<Mutex<()>>>` path-anahtarlı registry. **Anahtar `std::fs::canonicalize`** olmalı (yoksa aynı dosya farklı string → iki mutex → veri yarışı; `set_database_path:785` deseni). Registry mutex'i I/O sırasında ASLA tutulmaz.
- İç içe lock analizi: aynı arşivde re-entrant YOK (temiz). Kilit sırası standardı: A(in-proc Arc)→B(fs2 file lock)→C(pool). Çok-arşiv = canonical-string toplam-sıralama (döngüsel bekleme imkânsız).
- WAL: `shapes_db.rs:108-118` güvenli desen ama izole DB olduğu için ana DB'ye doğrudan kanıt DEĞİL. Ağ/UNC path → proaktif tespit → WAL kapalı, DELETE'e düş (`-shm` mmap SMB'de çalışmaz). `synchronous=FULL` başla. Backup/export öncesi `wal_checkpoint(TRUNCATE)`.
- Pool: yazma için YOK (mevcut open+RAII yeterli, daha güvenli). Read pool ertelendi; eklenirse `max_lifetime(None)+idle_timeout(None)` (r2d2 -wal temizleme tuzağı).
- `busy_timeout=5000` + idempotent PRAGMA bloğu → ortak `prepare_write_conn(path)` helper (scan_db'deki 10 tekrar tek kaynağa).

**Kademeli geçiş:** Aşama 1 per-archive kilit (WAL'siz, geri-alınabilir, throughput kazancı) → Aşama 2 `ARCHIVIST_DB_JOURNAL=wal|delete` flag (default `delete`, Gate 0 + tüm test + 2-process duman testi geçene dek) → Aşama 3 read pool (kapsam dışı).

**Kritik testler:** Test 4 = blob-overwrite vs targeted yarış, 1000 iter sonra `integrity_check`==ok + yetim `-wal`/`-shm` yok (Gate 0 regresyon kanıtı: naif WAL'de FAIL etmeli, çözümle PASS). Ayrıca canonical-path collation, iki-arşiv paralelizm, 2-process, power-loss/checkpoint.

**Sprint 3 öncesi:** Sprint 0+1 tam; Gate 0(a) doğrulandı (blob-overwrite ağır tablolara dokunmuyor); `journal_mode=DELETE` çağrı envanteri; canonical-path stratejisi 3 resolve fonksiyonunu kapsıyor; `archive_share.rs:182` import = scan ile aynı Arc; flag default=delete.

---

## Özet
Üç fazın da gerçek riski tek bir kanonik-kaynak + atomik-geçiş invariant'ına indirgenebilir. Plan sırası (V3-6→V3-2→V3-1→V3-3) Gate 0 nedeniyle yalnızca tercih değil, **zorunluluk**. Her sprint, kendi "öncesi hazırlık kontrol listesi" tamamlanmadan başlamaz.

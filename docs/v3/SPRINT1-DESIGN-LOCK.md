# Sprint 1 (V3-2) — Tasarım Kilidi (Design Lock)

> Branch: `feat/v3-2-vec-db`. Önkoşul: Sprint 0 ✅ (commit e9fa01e). Strateji: `docs/v3/DE-RISK-STRATEGIES.md` §1.
> Bu doküman, kod yazılmadan ÖNCE dondurulması gereken kararları içerir. Onaylanmadan Sprint 1 kodu başlamaz.

## 0. Kapsam
sql.js (V8 heap) monolitinden ayrı rusqlite `*_vec.db` dosyasına taşınacak 3 ağır tablo (FK'leri `assets`'e `ON DELETE CASCADE`):

| Tablo | Şema (v2.4.9, `database.ts`) | Neden ağır |
|---|---|---|
| `embeddings` | `id TEXT PK, asset_id TEXT NOT NULL, ref_id TEXT, vector_json TEXT, vector_blob BLOB, source TEXT NOT NULL, created_at TEXT` (`:480-490`) | `vector_blob` Float32×384 = baytça en büyük; 1.13M satır → 7-9GB pik |
| `text_chunks` | `id TEXT PK, asset_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL, lang TEXT, created_at TEXT` (`:493-503`) | `text` alanı büyük |
| `asset_relations` | `id TEXT PK, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, created_by TEXT` (`:669-679`) | FK-yoğun; kullanıcı verisi |

## 1. KİLİT KARAR: vec.db dosya-adı şeması
`shapes_db.rs:resolve_shapes_db_path` deseni **birebir**:

| Arşiv | Ana DB | vec.db |
|---|---|---|
| main | `archivist.db` | `archivist_vec.db` |
| local | `archivist_local.db` | `archivist_local_vec.db` |
| custom `<id>` | `archive_<id>.db` | `archive_<id>_vec.db` |

Yeni Rust modülü: `src-tauri/src/vec_db.rs`. `resolve_vec_db_path(app, archive_at)` — `resolve_shapes_db_path` (`shapes_db.rs:66-79`) imza/desen kopyası. WAL **AÇILMAZ** (ayrı dosya ama Gate 0 kapsamı dışı tutmak için DELETE; V3-3'e bırak). `synchronous=NORMAL`, `temp_store=MEMORY` (shapes_db deseni).

## 2. KİLİT KARAR: `PRAGMA user_version` epoch haritası
sql.js ANA DB'sinde tutulur (vec.db'de değil). Tek-yön, **asla düşürülmez** (yalnız admin rollback komutu hariç):

| epoch | Anlam |
|---|---|
| 0 | v2.4.9 ve öncesi — monolit (pragma hiç set edilmemiş) |
| 1 | `embeddings` vec.db'ye taşındı + sql.js'ten DROP |
| 2 | `text_chunks` taşındı |
| 3 | `asset_relations` taşındı |

`initDatabase` (`database.ts:207`), `_applyMigrations` (`:712`) ÖNCESİ epoch okur; `while currentEpoch < TARGET` eksik epoch'ları sırayla uygular. Sıra gerekçesi (strateji §5): embeddings ilk (en büyük heap kazancı, en dar tüketici `getAllChunkEmbeddings:2228`→`getRagCachedEmbeddings:104`, Sprint 2 ANN doğrudan üstüne oturur), text_chunks ikinci (embeddings.ref_id bağı), asset_relations son (FK-yoğun, orphan-temizlik gerektirir).

## 3. KİLİT KARAR: `migration_progress` tablosu (vec.db içinde)
Power-loss resume için. Şema:
```sql
CREATE TABLE IF NOT EXISTS migration_progress (
  table_name   TEXT PRIMARY KEY,   -- 'embeddings' | 'text_chunks' | 'asset_relations'
  last_rowid    INTEGER NOT NULL DEFAULT 0,  -- kopyalanan son kaynak rowid
  total_expected INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT,
  completed_at  TEXT                -- NULL = devam ediyor / kesilmiş
);
```
Kopyalama batch=5000, `INSERT OR IGNORE` (PK = `id`/`id`) → idempotent; resume `last_rowid`'den.

## 4. KİLİT KARAR: Atomik invariant (yazılı kabul)
1. `verify` (§5) GEÇMEDEN sql.js'ten `DROP TABLE` YOK.
2. `DROP TABLE <t>` + `PRAGMA user_version = N` **tek atomik sql.js write**'ında (`db.export()` → `ollama_db::write_db_at` tmp→rename). Yarı-durum diskte imkânsız.
3. `*_vec.db` kanonik; ANN (Sprint 2) türetilmiş.
4. Sıra sabit: **copy → verify → DROP+epoch (atomik) → sql.js flush**. FAIL → DROP yapılmamış → sql.js sağlam → fallback.
5. Taşınan tablolar `_applySchema`'dan **çıkarılır**; `_applyMigrations`'a "epoch≥N ise `DROP TABLE IF EXISTS`" idempotent adımı eklenir (T1 — iki-kaynak ezilmesi).

## 5. KİLİT KARAR: Doğrulama eşikleri (DROP öncesi zorunlu, hepsi geçmeli)
1. **COUNT eşitliği**: `SELECT COUNT(*)` sql.js == vec.db. Eşit değilse FAIL.
2. **İçerik-hash**: `ORDER BY id` kanonik serializasyon → rolling hash, iki tarafta eşit.
3. **Blob round-trip** (yalnız embeddings): örneklem N=256 satır (ilk/orta/son) → `vector_blob` byte-uzunluk `== dim*4` assert + `blobToVector` float-eşitlik `|a-b| < 1e-6`.
FAIL → DROP yok, epoch artmaz, vec.db silinir, epoch=0 fallback, kullanıcıya "yükseltme ertelendi, veri güvende".

## 6. KİLİT KARAR: Güvenlik ağı
- **Premigrate yedek (ZORUNLU)**: migrasyon başında sql.js DB → `archivist_premigrate_v3.db.bak` + fsync (`archive_share.rs:189-200` `db.bak` deseni). Yedek başarısız → migrasyon **başlamaz**. Shadow-read doğrulama süresi (1 sürüm) geçene dek silinmez.
- **Fallback feature flag**: `getAllChunkEmbeddings` (`database.ts:2228`) + `getRagCachedEmbeddings` (`ragService.ts:104`) çift-yollu: `epoch>=1` → vec.db invoke; `epoch==0` → mevcut sql.js yol (değişmez).
- **Admin-only rollback komutu**: `vec_db_rollback` — vec.db sil + sql.js'i premigrate `.bak`'tan restore + epoch=0.
- **Export/import** (`archive_share.rs:48-127, 150+`): zip'e `*_vec.db` entry ekle (`local.db` deseni `:102-109`); manifest'e `schemaEpoch` alanı; **eski .archivistpro (epoch yok) import → import sonrası otomatik upgrade tetikle** (T4).

## 7. KİLİT KARAR: Çakışma guard'ları
- `_migrationInProgress` global bayrak (`_scanWriteLock:1150` deseni): aktifken sql.js dump diske yazılmaz, embedding/chunk yazan yollar (`saveEmbedding` vb.) kuyruğa/bloke. Migrasyon yalnız scan **kapalıyken** başlar (`isScanWriteLocked()` guard); aktifken yeni scan reddedilir (T3).
- **Asset DELETE cascade**: sql.js `assets` DELETE yolunda, taşınmış tablolar için vec.db cascade-temizlik invoke'u (`vec_db_cascade_delete(asset_ids, archive_at)`) — cross-DB FK yok (T9). Periyodik orphan-temizlik komutu.
- **Kilit sırası**: vec.db ayrı dosya → ayrı `acquire_db_write_lock`; sıra sabit (önce sql.js ana DB lock, sonra vec.db lock) — deadlock önleme (strateji T6).
- Her vec.db invoke'u **zorunlu `archiveAt`** parametresi (shapes_db imza modeli); frontend `getActiveArchive()`'den doldurur (T5 — çoklu-arşiv yanlış vec.db).

## 8. Sprint 1 "Done" çıkış kapısı
- Test matrisi (strateji §4) her hücre otomatik testle yeşil (boş/1K/100K/1.13M/bozuk/kısmi-migre × taşıma/arşiv-geçişi/export-import/viewer-local/power-loss).
- 1.13M dataset: arşiv açılış V8 heap < 2GB (S1-PREP-C baseline'a karşı kanıt).
- `cargo test --features admin` + `clippy -D warnings` (yeni kod) + `npx tsc --noEmit` + `npm test` (≥2103) 0 fail.
- Gerçek v2.4.9 DB: upgrade + audit hash-chain yeniden-hesap eşit + premigrate yedek mevcut.
- Power-loss simülasyonu (kill ×3 farklı aşama) → resume → veri %100 eşit.

## 9. Kararlar (KİLİTLENDİ — uzman tercihi, kullanıcı "en profesyonel ile devam" direktifi)
- ✅ **Tek `*_vec.db`, 3 tablo.** Gerekçe: `shapes_db.rs` tek-dosya deseniyle tutarlı; export/import tek entry; çoklu-arşiv path çözümü tek fonksiyon. Tablo-başına dosya gereksiz karmaşıklık + 3× lock yüzeyi.
- ✅ **vec.db yalnız `vector_blob` tutar; `vector_json` taşınmaz.** Taşımadan önce `_migrateEmbeddingsJsonToBlob` (`database.ts:408`) tüm legacy JSON'ı blob'a çevirmiş olmalı (migrasyonun ilk adımı, epoch=1 öncesi zorunlu ön-koşul-doğrulama: `SELECT COUNT(*) FROM embeddings WHERE vector_blob IS NULL` == 0). Aksi halde epoch=1 başlamaz.
- ✅ **İçerik-hash = SHA-256.** Mevcut `sha2` dep (Cargo.toml:50), audit hash-chain ile algoritma tutarlılığı, çakışma riski FNV'den ihmal edilebilir düzeyde düşük. Performans: 1.13M satır × ~400 byte streaming SHA ≈ kabul edilebilir (yalnız migrasyon-anı, tek sefer).

# Gate #1 — Gerçek v2.4.9 DB Anonimleştirme Prosedürü

> Amaç: kullanıcının **gerçek üretim `archivist.db`**'sinden, içeriği temizlenmiş
> ama **yapısal olarak birebir sadık** bir kopya üretmek. Sentetik `make_v249_db`
> yalnız 3 basit tablo kurar; gerçek DB'de ~25 tablo + uygulanmış şema
> migration'ları + audit hash-chain + gerçek kenar durumlar (NULL'lar, dev
> metadata JSON, çok kaynaklı embedding, FTS) var. Gate #1 = bu sadık girdiyle
> v3 migrasyonunun (epoch 0→1→2→3 + vec.db ayrımı) ve frontend cutover'ın
> gerçek-veri geriye-uyumluluğunu kanıtlamak.

## 0. İlke
- **Sapma yok:** Bu V3 (frontend cutover ön-koşulu) işidir; ayrı sistem değil.
- **Tek geliştirici / offline:** Anonim kopya da git'e GİRMEZ; yalnız lokal
  test artefaktı. `.gitignore`'a `*_anon.db` eklenir.
- **Push politikası:** Bu doküman dahil hiçbir şey kullanıcı istemeden push'lanmaz.

## 1. Korunacak (yapısal sadakat — DOKUNMA)
Migrasyon kod yolu bunlara bakar; değişirse test geçersiz olur:

- `PRAGMA user_version` (epoch tespiti) — **aynen**.
- Tüm tablo/şema, index, `sqlite_master` — **aynen** (şema migration izleri dahil).
- Tüm `id` / `asset_id` / `source_id` / FK değerleri — **aynen** (opak;
  PII değil; değiştirmek FK bütünlüğünü gereksiz riske atar).
- `embeddings.vector_blob` / `vector_json` / `source` / boyut (384/512) —
  **aynen** (recall + format testi gerçek vektör ister; okunur içerik değil).
- Satır SAYILARI (assets/embeddings/text_chunks/asset_relations) — **aynen**
  (heap/perf ve 1.13M reproduksiyonu satır sayısına bağlı).
- `created_at`/`timestamp` zaman damgaları — aynen (sıra/chain için).

## 2. Temizlenecek (PII / müşteri-gizli içerik → yer-tutucu)
Aynı uzunluk sınıfında deterministik yer-tutucuyla değiştir (NULL olanlar
NULL kalsın — NOT NULL kısıtı + kod-yolu davranışı korunur):

| Tablo | Kolon(lar) |
|---|---|
| `assets` | `file_name`, `file_path`, `project_name`, `project_phase`, `raw_metadata`, `metadata_json`, `ai_tags_json`, `color_palette_json`, `thumbnail_url`, `rag_status_reason` |
| `text_chunks` | `text` (gerçek PDF/OCR içeriği — en hassas) |
| `asset_summaries` | `summary`, `keywords_json` |
| `projects` | `name` |
| `tags` / `root_groups` / `collections` | `name` |
| `asset_relations` | `notes` |
| `chat_sessions` / `chat_messages` / `user_messages` | başlık + içerik gövdesi |
| `users` | `username`, `display_name`, `password_hash` (→ sabit bcrypt test hash), `avatar` |
| `audit_log` | `target`, `detail` (→ sonra chain YENİDEN hesap, bkz §4) |
| `scanned_roots` / `scan_log` | gerçek disk yolları |
| `app_settings` | hassas değerler: LAN auth-code, mutlak yollar (anahtarlar kalır) |

> `file_path`'i `C:\arsiv\a-<id>.<ext>` gibi üret — uzantıyı orijinalden
> koru (kategori/uzantı bağımlı kod-yolları aynı davransın).

## 3. Yöntem (sıra önemli)
```
1. Uygulamayı KAPAT (DB kilitli olmasın).
2. cp archivist.db archivist_anon.db          # asla orijinal üzerinde çalışma
3. sqlite3 archivist_anon.db "PRAGMA integrity_check;"   # kaynak sağlam mı
4. Anonimleştirme scriptini archivist_anon.db üzerinde çalıştır (§4)
5. Doğrulama (§5)
6. v3 migrasyon + app-açılış testi (§6)
```

## 4. Script — `scripts/anonymize-db.py` (HAZIR, test edildi)
Python 3 + stdlib (`sqlite3`/`hashlib`/`json`) — ek paket yok. Çalıştır:
```
python scripts/anonymize-db.py --src test-data/archivist_anon_src.db \
                               --out test-data/archivist_anon.db
```
Defansif (yalnız var olan tablo/kolon), NULL korur, `id`/FK/embedding/
`user_version` dokunulmaz, deterministik yer-tutucu, uzantı korunur.

**GÜVENLİK — VACUUM zorunlu (varsayılan AÇIK):** SQLite `UPDATE` eski değeri
serbest sayfalarda bırakır → VACUUM olmadan temizlenen PII ham dosyadan
kurtarılabilir (self-test'te `lan_auth_code` değeri sızdı, VACUUM ile gitti).
Script `PRAGMA secure_delete=ON` + sonda `VACUUM` yapar. `--no-vacuum` =
güvenlik riski, kullanma.

Tek tablo-tablo `UPDATE`; deterministik yer-tutucu (`id` seed'li) → tekrar
çalıştırılabilir. **Kritik adım = audit_log chain'i yeniden hesaplama.**

Audit `row_hash` algoritması (kaynak: `src/services/logger.ts:199-211`):
`row_hash = sha256Hex( buildAuditHashInput(timestamp, role, action, target,
detail, result, prev_hash) )`, satırlar `id ASC`, ilk satır `prev_hash=""`.
**`buildAuditHashInput`'ın birleştirme sırası/ayracı script'e BİREBİR
kopyalanmalı** (logger.ts'den oku — tahmin etme). Aksi halde uygulamanın
`logger.ts:508+` zincir-doğrulaması "tamper" der → Gate #1 yanlış sebeple FAIL.

İki yol:
- **(A) Tercih:** `target`/`detail`'i temizle, sonra script TÜM zinciri
  `id ASC` gezip `buildAuditHashInput` ile `prev_hash`+`row_hash` yeniden
  yazsın (uygulamanın hesaplayacağıyla aynı). Zincir geçerli kalır.
- (B) Alternatif: `target`/`detail`'i temizleyip `row_hash`/`prev_hash`'i
  NULL bırak → uygulama açılışta kendi backfill'ini çalıştırır
  (`database.ts:957-1004`). Bu da geçerli bir test (backfill yolunu da sınar).

Embedding'lere DOKUNMA. `users.password_hash` → bilinen tek bir bcrypt
hash'i (örn. `admin`/`admin`) ile değiştir ki login akışı test edilebilsin.

## 5. Doğrulama (anonimleştirme migrasyonu BOZMADI mı)
- `PRAGMA integrity_check;` → `ok`
- `PRAGMA user_version;` → orijinalle **aynı**
- `PRAGMA foreign_key_check;` → boş
- Her tablo `SELECT COUNT(*)` → orijinalle **aynı**
- Audit zinciri: uygulamanın `verifyAuditChain` mantığıyla (logger.ts:508+)
  → 0 kırık satır (yol A) **veya** tüm row_hash NULL (yol B, backfill bekler)
- PII sızıntı taraması: `strings archivist_anon.db | grep -i <gerçek müşteri/proje adı>` → 0 eşleşme
- (Opsiyonel) Boyut: tam kopya = heap/perf sadık; hızlı fonksiyonel için
  `assets`'ten örnekleyip FK-kapanışıyla alt-küme çıkar (ayrı "_anon_small.db").

## 6. Gate #1 asıl testi (anonim db hazır olunca)
1. `archivist_anon.db`'yi temiz bir test profiline koy, uygulamayı aç →
   şema migration + audit backfill hatasız, UI sorguları çalışıyor.
2. v3 migrasyonu sırayla: `vec_db_migrate_embeddings` → `vec_db_verify_embeddings`
   → text_chunks → asset_relations; her `verify` **eşit** (COUNT + içerik-hash).
3. Premigrate yedek (`*_premigrate_v3.db.bak`) alındı; rollback çalışıyor.
4. ANN: gerçek embedding'lerle `recall@10` ölçümü (sentetik LCG'de geçersizdi
   — `baseline-heap.md` §7); kabul eşiği gerçek-veride doğrulanır.
5. (V3-3) `ARCHIVIST_DB_JOURNAL=wal` + 2-process duman testi bu db ile.
6. Hepsi yeşilse → frontend cutover (Faz 3 / Seçenek 3) başlatılabilir.

## 7. Kullanıcıdan istenen (tek aksiyon)
> Çalışan kurulumdaki **gerçek `archivist.db`'nin bir kopyası** (orijinale
> dokunmadan). Geri kalan her şey (scriptleme, doğrulama, migrasyon testi)
> bu prosedürle yapılır; gerçek içerik makineden çıkmaz, git'e girmez.

Konum: `app_data_dir/archivist.db` (veya Ayarlar→DB yolu neredeyse orası).
```
# Kullanıcının çalıştıracağı tek komut (uygulama kapalıyken):
copy "<archivist.db yolu>" "C:\Arsiv-H2\ArchivistPro\test-data\archivist_anon_src.db"
```
(`test-data/` `.gitignore`'da olmalı — eklenecek.)

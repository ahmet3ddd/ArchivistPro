# Sprint 1 Prep Kit — Dataset Üreteci + Heap Baseline Prosedürü

> Tamamlayıcı: `docs/v3/SPRINT1-DESIGN-LOCK.md`. Bu doküman test altyapısı + ölçüm prosedürünü kilitler.
> NOT: Üretici **kod** Sprint 1 başında yazılır (tüketicisi — vec_db testleri — o zaman var olur; şimdi yazmak spekülatif/dead-code olur). Burada birebir spec'i dondurulur.

## A. Sentetik Dataset Üreteci (S1-PREP-B) — spec

**Amaç:** Test matrisini (DE-RISK §4) besleyen, v2.4.9-format sql.js SQLite dosyaları üretmek.

**Konum (Sprint 1'de):** `src-tauri/src/vec_db.rs` içinde `#[cfg(test)] mod fixtures` — vec_db testleri tek tüketici. rusqlite ile yazılır (sql.js dosya formatı = standart SQLite; rusqlite ile üretilen dosya sql.js ile birebir okunur).

**API (dondurulmuş):**
```
fn make_v249_db(path: &Path, profile: DbProfile) -> Result<(), String>
enum DbProfile {
  Empty,                       // 0 satır, sadece şema + user_version=0
  Small  { assets: 50 },       // ~1K embeddings/chunks
  Large  { assets: 5_000 },    // ~100K embeddings
  Huge   { assets: 56_000 },   // ~1.13M embeddings (worst-case; opsiyonel #[ignore], CI'de değil)
  Corrupt,                     // geçerli SQLite ama bozuk header (read_db_at corrupt yolu)
  PartialMigrated,             // epoch=0 ama vec.db kısmen dolu (resume senaryosu)
}
```

**Şema (v2.4.9 — `database.ts` birebir, DESIGN-LOCK §0):** `assets`, `embeddings` (`vector_blob` = 384×f32 LE rastgele, deterministik seed), `text_chunks` (Lorem ~500 char), `asset_relations` (her asset ~2 ilişki). `PRAGMA user_version` = 0. FK `ON DELETE CASCADE` korunur.

**Kurallar:**
- Deterministik seed (tekrarlanabilir testler) — `StdRng::seed_from_u64`.
- `Huge` profili `#[ignore]` (manuel/nightly; CI'de koşmaz — süre/disk).
- Embedding dağılımı kümeli (gerçek embedding taklidi; ANN benchmark'ı haksız zorlamaz — Sprint 2 ile paylaşılır).
- `Corrupt` = geçerli şemalı DB üret, sonra ilk 16 baytı boz (header).
- `PartialMigrated` = `Large` üret + ayrı vec.db'ye embeddings'in %40'ını + `migration_progress`'e `last_rowid` yaz, epoch=0 bırak.

**Bağımlılık:** Sprint 1'de `rand` test dev-dependency gerekebilir (deterministik seed). Cargo.toml `[dev-dependencies]` → `rand = "0.8"` (tempfile yanına).

## B. Baseline V8 Heap Ölçüm Prosedürü (S1-PREP-C)

**Amaç:** Sprint 1 sonrası "<2GB heap" hedefine (DESIGN-LOCK §8) karşılaştırma referansı. Bu **mevcut v2.4.9 davranışının** ölçümü — Sprint 1 kodu yazılmadan, `main`/`v3-architecture` baseline'ında alınır.

**Otomatik değil — manuel prosedür:**
1. `make_v249_db` ile `Large` (100K) ve `Huge` (1.13M) profilli iki `archivist.db` üret; `%APPDATA%\com.archivistpro.desktop\archivist.db`'ye kopyala.
2. `npm run tauri dev` (release değil — dev WebView2 DevTools açık).
3. WebView2 DevTools → Memory / Performance Monitor → **JS heap size** izle.
4. Senaryolar, her biri için heap piki kaydet:
   - a. Soğuk açılış → ana arşiv yüklenir (`initDatabase` → `read_database_binary` → `new SQL.Database`).
   - b. Semantik arama tetikle (`ragService.retrieve` → `getRagCachedEmbeddings` tüm vektörler RAM'e).
   - c. Yerel↔ana arşiv geçişi (`withArchive`) — bilinen 7-9GB pik senaryosu.
5. Tabloya yaz: `docs/v3/baseline-heap.md` — {profil, senaryo, heap piki MB, tarih, commit}.

**Beklenen (DE-RISK teşhisi doğrulaması):** 1.13M `Huge` + senaryo (c) → 7-9GB pik / "Aw Snap" olası. Bu, Sprint 1'in çözdüğü problemi sayısal kanıtlar.

**Kabul:** Baseline ölçüm `docs/v3/baseline-heap.md`'ye işlendiğinde S1-PREP-C kapanır. Sprint 1 sonrası aynı prosedür tekrarlanır; hedef senaryo (c) < 2GB.

## Sprint 1 başlamadan kalan kapılar (DE-RISK §1 + DESIGN-LOCK)
- [ ] DESIGN-LOCK §9 açık soruları karara bağlandı (tek vec.db / vector_json / hash algo).
- [ ] Gerçek anonimleştirilmiş v2.4.9 üretim DB kopyası elde (gerçek-veri geriye-uyumluluk testi) — **kullanıcıdan istenecek; sentetik yetmez**.
- [ ] `docs/v3/baseline-heap.md` ölçümle dolduruldu.
- [ ] Üretici API'si (yukarıda) onaylandı; `rand` dev-dep kararı verildi.

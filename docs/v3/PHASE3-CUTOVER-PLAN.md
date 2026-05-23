# Faz 3 — Frontend Cutover Yürütme Planı (sıralı, geri-alınabilir)

> Ön-koşul: **Gate #1 TAMAMEN GEÇTİ (2026-05-19)** — §5 anonimleştir + §6
> migrate/verify + recall@10=0.981 gerçek anonim db'de. Backend (vec_db
> migrate/verify/cascade/safety + ANN) Gate#1-doğrulanmış.
>
> Bu plan **uygulama DEĞİL, sıra+güvenlik sözleşmesidir.** Her adım tek
> başına geri-alınabilir; tümü **kapalı bayrak** arkasında ⇒ etkinleştirilene
> dek SIFIR davranış değişikliği (kullanıcının "görmeyi sonraya bırak"
> isteğine uyumlu — dark ship). Kullanıcı açık onayı olmadan bayrak
> default-AÇIK yapılmaz.

## Değişmez güvenlik sözleşmesi (DESIGN-LOCK §1 — sapma YOK)
1. `verify` GEÇMEDEN sql.js'ten `DROP` **YOK**.
2. `DROP TABLE` + `PRAGMA user_version=N` **tek atomik** sql.js write'ında
   (`write_and_sync` tmp→rename — `write_db_at`).
3. copy → verify → DROP sırası asla bozulmaz (FAIL → DROP yapılmadı →
   sql.js sağlam → otomatik fallback).
4. Her epoch öncesi `*_premigrate_v3.db.bak` (rollback `vec_db/safety.rs`).
5. `*_vec.db` kanonik; ANN türetilmiş (silinse yeniden kurulur).

## Kill-switch (geri-alınabilirliğin temeli)
- Tek bayrak: `ARCHIVIST_V3_EPOCH` (localStorage + opsiyonel env), **default
  `off`**. `off` → bugünkü sql.js yolu, hiç dokunulmamış gibi.
- `_migrationInProgress` guard: migrasyon sürerken ikinci tetik/`F5` reload
  guard (mevcut F5 guard deseni `1a6fb09` reuse).
- Her aşama bağımsız commit + bayrak alt-kademesi (epoch1 → epoch2 → epoch3)
  → kısmi etkinleştirme + tek epoch geri alma mümkün.

## Sıra (her adım: değişiklik · güvenlik · test · rollback)

**A1 — Epoch durumu okuma (yazma YOK).** `database.ts`: `_applyMigrations`
ÖNCESİ `PRAGMA user_version` → `schemaEpoch` belleğe. Hiçbir yazma yok,
salt-okunur. Test: sentetik + Gate#1 anon db açılır, epoch doğru okunur.
Rollback: kod no-op (okuma).

**A2 — Çift-yol OKUMA (bayrak `off` → eski yol).** `getAllChunkEmbeddings`
/ `getRagCachedEmbeddings` / ragService Stage 3 (`:743-758`):
`epoch>=hedef && flag` ? `invoke(vec_db_chunk_embeddings/...)` : sql.js.
Bayrak off → davranış BİREBİR eski. Test: flag on/off iki yolun aynı
sonucu (Gate#1 anon db ile A/B). Rollback: bayrak off.

**A3 — Migrasyon akışı (tek atomik, opt-in tetik).** Kullanıcı/otomatik
tetik (bayrak): premigrate-bak → `vec_db_migrate_embeddings` →
`vec_db_verify_embeddings` → **verify true ise** atomik sql.js
`DROP embeddings; PRAGMA user_version=1` (`write_db_at`) → epoch2,3 aynı
desen (text_chunks, asset_relations). verify FAIL → DROP YOK, bak'tan
restore, bayrak off, kullanıcıya rapor. Test: Gate#1 `gate1_real_db_migration`
zaten epoch1/2/3 migrate+verify+idempotent kanıtladı; buraya
DROP+user_version atomikliği + FAIL→rollback testi eklenir.

**A4 — Asset DELETE cascade.** Asset silme yolu epoch>=1 iken
`vec_db_cascade_delete` çağırır (vec.db tutarlılığı). Test: safety.rs
cascade testleri + entegrasyon. Rollback: bayrak off → sql.js delete.

**A5 — Manifest schemaEpoch + T4 auto-upgrade.** Arşiv paylaşım manifesti
`schemaEpoch` taşır; import eski epoch ise otomatik yükseltme (A3 akışı
reuse). Test: archive_share import + epoch upgrade. Rollback: epoch alanı
yoksa epoch0 varsay (geri-uyumlu).

**A6 — Bayrak default AÇIK (yalnız KULLANICI ONAYIYLA).** A1-A5 yeşil +
kullanıcının kopya-arşivde doğrulaması sonrası `ARCHIVIST_V3_EPOCH`
default `on`. Bu **tek geri-dönüşü kullanıcıyı etkileyen** adım → ayrı
açık onay. Rollback: default'u `off`'a al + (gerekirse) bak'tan restore.

## Doğrulama kapıları (her adım sonrası)
- `npx tsc --noEmit` + `npm test` (frontend) yeşil.
- `cargo test --features admin` 203/203 (backend regresyonsuz).
- Gate#1 harness'leri (anon gerçek db) yeşil: `gate1_real_db_migration`,
  `gate1_real_recall`, `verify_passes_with_mixed_dim_embeddings`.
- 2-process duman testi (`wal_smoke_2proc`) yeşil.

## Bu plan ne DEĞİL
- WAL-default flip değil (ayrı, kullanıcı-onaylı; iki gate açık).
- "Görünür demo" değil (kullanıcı görmeyi sonraya bıraktı; A1-A5 dark).
- Backend yeniden-yazımı değil (vec_db/ANN Gate#1-doğrulanmış, dokunulmaz).

## Sonraki somut iş
A1 (salt-okunur epoch okuma) — sıfır-risk, davranış değişmez, bayrak
gerektirmez. Backend tarafı hazır; bu frontend `database.ts` dokunuşu
**kullanıcı onayı/önceliklendirmesi** bekl[er] (Faz 3 = ürün davranışı).

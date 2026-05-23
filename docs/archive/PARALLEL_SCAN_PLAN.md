# Paralel Tarama Yol Haritası

> **Durum:** Aşama 1 ✓ tamamlandı (2026-04-30). Pipeline staging concurrency=3 + back-pressure 8 aktif. Kullanıcı manuel onayı: "aynı sürede yaklaşık 2-3 misli daha fazla dosya taranıyor" — hedef %30+ açık ara aşıldı.
> **Sıradaki:** Commit 4 (kullanıcı tarafından concurrency ayarı) — donanıma göre 1-8 arası seçilebilir olacak. Ardından Aşama 2 (Rust rayon batch) değerlendirilecek.
> **Hedef:** `fileScanner.ts` strict-serial scan loop'unu çoklu çekirdeğe taşımak.

## İlerleme

| Commit | Açıklama | Durum |
|---|---|---|
| `6a0a95c` | docs: bu yol haritası | ✓ |
| `1f3e8ec` | refactor(scan): processSingleEntry inner function — Aşama 1 Commit 1 | ✓ |
| `3cf3751` | perf: indexAssetMetadata skipSave (her dosyada saveDatabase tetikliyordu) | ✓ (yan kazanç) |
| `88e7e69` | perf: 4 saveDatabase → 1 banner consolidation (Commit 2 baseline'ını temizledi) | ✓ (yan kazanç) |
| `d5e48b4` | chore: iptal sonrası audit + dwg warning sustur | ✓ (yan kazanç) |
| `5260703` | refactor(scan): processSingleEntry → prepareEntry + processEntry — Commit 2a | ✓ |
| `a964858` | perf(scan): pipeline staging concurrency=3 — Commit 2b | ✓ |
| `4bead56` | fix(scan): iptal'de orphan asset tutarsızlığını gider (yan keşif) | ✓ |
| **Sıradaki** | **Commit 4:** scan_prepare_workers ayar UI (1-8 slider) | ⏳ |
| Aşama 2 | Rust rayon batch — Aşama 1 yeterli görülürse skip edilebilir | — |

## Aşama 1 Sonuç Özeti

Kullanıcı manuel testleri (2026-04-30):

| Worker | Dosya / Süre | Profil | Kazanç |
|---|---|---|---|
| 1 (eski serial) | tahmini ~18-24 dk | 32 ağır dosya (DWG/MAX/SKP/PSD) | baseline |
| 3 (default) | "aynı sürede 2-3 misli dosya" | karışık klasör | ~2-3x |
| 8 (kullanıcı override) | 32 dosya / 3 dk 1 sn | aynı 32 ağır dosya | **~6-8x** |

- Hedef "%30+ hız artışı" çok fazlasıyla aşıldı.
- Regresyon yok: ScanWriteBuffer flush log'ları normal sıklıkta, progress sıralı, iptal anında durdurma çalışıyor.
- Yan keşif: iptal'de `addScannedRoot`/`saveDatabaseAsync` atlanması orphan asset bug'ı yaratıyordu — `4bead56` ile düzeltildi.

**Karar:** Aşama 1 başarılı bitti. **Aşama 2 (Rust rayon batch) iptal — gereksiz**: 6-8x kazançtan sonra ek %50-100 beklenen iyileşmenin geri dönüşü düşük (donanım limitlerine yakın). Aşama 3 (ONNX multi-thread) hâlâ teorik olarak değerlendirilebilir ama ilgili iyileştirmenin değeri çok düşük (CSP/COOP/COEP retest karmaşıklığı yüksek, embed bottleneck artık dominant değil) → şimdilik raf.

## Aşama 2 — Rust rayon batch ❌ İPTAL

Aşama 1'in beklenenin üzerinde kazanç sağlaması üzerine bu aşama askıya alındı. İhtiyaç doğarsa (örn. milyon-dosya ölçek) yeniden değerlendirilir; o zamana kadar bu bölüm referans için duruyor.

## Mevcut Durum (Tespit — 2026-04-30)

- `src/services/fileScanner.ts:1156` → `for (const entry of fileEntries)` strict serial.
- Her dosya için sırayla 6 await: hash → metadata extract → text embedding → doc-chunk embedding (batch=32 ama sıralı) → CLIP → buffer flush.
- Rust komutları `tauri::async_runtime::spawn_blocking` ile her biri kendi thread'inde — **altyapı paralele hazır**, frontend `await` ile boşa harcıyor.
- ONNX Runtime Web (`@xenova/transformers`): `numThreads` ayarsız, SharedArrayBuffer yok, COOP/COEP header'ları yok → embedding tek WASM thread.
- Git history / MEMORY / TODO: paralel scan girişiminin **izi yok**. Tek paralelizm referansı `2d6ccb3` commit (DB kayıtta `Array.from()` Web Worker — scan'le ilgisiz).

## Üç Aşama

| Aşama | Yöntem | Beklenen Kazanç | Süre | Risk |
|---|---|---|---|---|
| **1** Pipeline Staging | `p-limit` concurrency=3-4, hash+metadata paralel başlat, embedding singleton kalır | %30-50 | ~1 gün | Düşük |
| **2** Rust rayon batch | Tek `scan_extract_batch(paths)` Tauri komutu, `par_iter`, IPC overhead ↓ | ~2x | 2-3 gün | Orta |
| **3** ONNX multi-thread | `wasm.numThreads=4` + SharedArrayBuffer + COOP/COEP | ek %50 | ~1 hafta | Yüksek |

**Yapma:**
- 2 ayrı embedding pipeline instance (RAM 46+300MB iki katına)
- HDD'de concurrency>2 (seek thrash, yavaşlatır)
- SQLite'a paralel yazma (mevcut buffer modeli zaten doğru)

**Karar yöntemi:** Her aşamadan sonra ölç → kazanç gerçek mi → bir sonrakine geç. Aşama 3 en sona.

---

## Aşama 1 — Pipeline Staging (detaylı plan)

### Mimari

İki katmanlı paralelizm:

- **Katman A (concurrency=3-4):** Hash, cache check, Rust metadata extraction, dosya I/O. Rust thread havuzunda zaten paralele uygun.
- **Katman B (concurrency=1, sıralı):** Embedding (text + chunk + CLIP). Singleton ONNX pipeline; aynı anda iki çağrı race condition.

### Akış

1. **Prepare worker pool** (concurrency=3-4) `fileEntries`'i tüketir; her dosyanın hash + cache check + Rust metadata extraction'ını yapar; sonucu hazır-kuyruğuna koyar.
2. **Embed worker** (tek), hazır-kuyruğundan dosyayı çeker, embedding hesaplar, writeBuffer'a yazar, progress callback tetikler.
3. **Hazır-kuyruğu** max boyutu = 8-10 (back-pressure: prepare worker'lar kuyruk dolunca duraklar — RAM patlamaz).

```
Dosya N:   [hash][meta][embed][doc-chunk][clip][buffer]
Dosya N+1: ............[hash][meta][embed]....
Dosya N+2: ......................[hash][meta]
```

### Kritik Teknik Noktalar

| # | Konu | Çözüm |
|---|---|---|
| 1 | `p-limit` dependency yok | Eklenecek (küçük, 3 satır wrapper) |
| 2 | `scanYield(controller)` çağrıları | Her worker kendi yield'ini yapar — doğal halledilir |
| 3 | `controller.checkPoint()` iptal/duraklat | Tüm worker'lar aynı controller'ı paylaşır; iptalde in-flight tamamlanır, yeni başlamaz |
| 4 | `writeBuffer` thread-safety | Tek embed worker yazar; sql.js zaten single-threaded JS — atomik |
| 5 | `folderMaterialMap` race | Prepare'de sadece read; yazma embed worker'ında (tek thread) |
| 6 | Progress callback sırası | `progress.processed` tek embed worker'da artırılır → sıra korunur |
| 7 | SSD/HDD adaptif concurrency | Aşama 1.5'a ertelendi; Aşama 1'de hard-coded `=3` |

### Ölçüm Noktaları (başarı tanımı)

Bunlar olmadan "hızlandı" denemez:

- **Baseline:** Mevcut serial loop, 500 dosyalık standart klasör → toplam süre, peak RAM, CPU kullanımı (Task Manager).
- **After:** Aynı klasör, önbellek temiz, concurrency=3 → aynı 3 metrik.
- **Hedef:**
  - Süre **%30+** düşmeli.
  - Peak RAM **<%20** artmalı.
  - CPU kullanımı tek-çekirdek %15-25'ten çok-çekirdek %40-60'a çıkmalı.
- **Regresyon kontrolü:** `[ScanWriteBuffer] flush ok` log'ları aynı sıklıkta gelmeli; `progress.processed` doğru ilerlemeli; iptal düğmesi 2 sn içinde durmalı.

### Risk Azaltma

| Risk | Azaltma |
|---|---|
| Embedding modeli race condition | Embedding her zaman concurrency=1; prepare ile embed ayrı havuz |
| RAM patlama (prepare 1000 dosya hazırlarsa) | Hazır-kuyruğu max=8-10, back-pressure |
| HDD'de yavaşlama | Aşama 1.5'ta concurrency ayar UI; varsayılan 3 |
| iptal/duraklat bozulması | Tek `controller`, in-flight worker'lar tamamlanır; checkPoint her döngüde |
| `folderMaterialMap` race | Prepare'de sadece read; yazma embed worker'ında |
| Test coverage | Mevcut testler serial varsayıyor — paralel için yeni test gerek |

### Commit Haritası

| # | Commit | Ne yapar | Süre | Durum |
|---|---|---|---|---|
| 1 | `refactor(scan): processSingleEntry inner function` (`1f3e8ec`) | Eski for-loop body'sini inner async function'a taşıdı; tek try/catch'e cancel handling. Davranış aynı. | ~30 dk | ✓ |
| **2a** | `refactor(scan): processSingleEntry → prepareEntry + processEntry` | PHASE A-F (hash/cache/metadata/thumbnail/AI) `prepareEntry`'e; PHASE G (DB write/embedding/chunk) `processEntry`'e. Hala serial. | ~2 saat | ⏳ |
| **2b** | `perf(scan): pipeline staging concurrency=3` | `p-limit(3)` prepare havuzu + tek embed worker + max 8 inflight back-pressure. Race noktaları kapatıldı. | ~2 saat | ⏳ |
| 3 | `docs(perf): Aşama 1 ölçüm sonuçları` | Baseline + after, bu dosyaya sonuç bölümü | ~1 saat | — |
| 4 (ops.) | `feat(settings): scan_prepare_workers (1-8)` | UI ayar + `setSettingPersistent` | ~2 saat | — |

### Sub-commit 2a Detayı — processSingleEntry Bölme

**Bölme noktaları:**
- `prepareEntry(entry) → PrepResult`:
  - `{ kind: 'cached', asset }` (hash + cache match)
  - `{ kind: 'new', asset, fileType, category }` (build + metadata + thumbnail + content/pHash + AI)
  - `{ kind: 'skip' }` (catch sonrası, error logged)
- `processEntry(prep, entry) → void`:
  - cached: `ensureDocumentChunksIndexed` + BAK fix + materialMap WRITE + bookkeeping
  - new: materialMap WRITE + `upsertAsset` + `writeBuffer.addAsset` + embeddings + `indexAssetMetadata` + bookkeeping

### Sub-commit 2b Detayı — p-limit Pipeline

**İskelet:**
```ts
const prepareLimit = pLimit(3);
const inflight: Promise<PrepResult>[] = [];

for (const entry of fileEntries) {
    if (controller) await controller.checkPoint();
    inflight.push(prepareLimit(() => prepareEntry(entry)));
    if (inflight.length >= 8) {
        const prep = await inflight.shift()!;
        await processEntry(prep, ?entry?);  // entry'i prep'le birlikte sakla
        // bookkeeping (progress.processed++, flush check, onProgress)
    }
}
while (inflight.length > 0) {
    const prep = await inflight.shift()!;
    await processEntry(prep, ?entry?);
    // bookkeeping
}
```

**Race noktaları (önemli):**
- `folderMaterialMap`: prepare'de **sadece read**, write processEntry'e (tek thread)
- `progress.processed/skipped/typeCounts`: tek embed worker artırır
- `assets.push`, `writeBuffer.add*`: tek embed worker
- `controller.checkPoint()`: outer loop'ta her iterasyon başında — iptal'de inflight prepare'ler GC'lenir (await edilmez)

**İptal davranışı:** inflight prepare promise'leri await edilmediği için JS'te GC'lenir. Rust komutları arka planda devam eder (CPU israfı) ama sonuçları kullanılmaz. Kabul edilebilir trade-off.

### Dokunulacak Dosyalar (Tahmini)

- `src/services/fileScanner.ts` — scan loop refactor (1156-2200 satır)
- `package.json` — `p-limit` dependency
- (Sonra) `src/store/useStore.ts` + Settings UI — concurrency ayarı

---

## Aşama 2 — Rust rayon batch (referans, iptal edildi)

> 2026-04-30: Aşama 1 6-8x kazanç sağladığı için bu aşama askıya alındı. Referans amaçlı bilgi:

- Yeni `scan_extract_batch(paths: Vec<String>) -> Vec<ExtractResult>` Tauri komutu.
- Rust içinde `rayon::par_iter` + `min(num_cpus, 8)` worker.
- Her dosya için hash + tüm metadata extraction tek batch'te döner; IPC roundtrip N → 1.
- Frontend tarafında prepare worker'lar yerine "her N dosyayı batch yap" yaklaşımı.

## Aşama 3 — ONNX multi-thread (en son)

Detayı Aşama 2 ölçümü sonrası. Üst seviye:

- `tauri.conf.json` security headers: COOP=`same-origin`, COEP=`require-corp`.
- ONNX Runtime config: `wasm.numThreads = 4` (veya `Math.min(navigator.hardwareConcurrency, 4)`).
- SharedArrayBuffer kullanımı için cross-origin isolation testi.
- CSP, asset loading, convertFileSrc gibi mevcut Tauri özellikleri yeniden test.

---

## İlgili Referanslar

- `src/services/fileScanner.ts:1156` — mevcut serial loop başlangıcı
- `src-tauri/src/scan_db.rs` — inkremental disk yazma (rusqlite, 2026-04-29)
- `.claude/MEMORY.md` — son oturum notları + 14-kategori DAM değerlendirmesi

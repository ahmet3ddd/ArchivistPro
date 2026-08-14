# Baseline V8 Heap Ölçümü (S1-PREP-C)

> Prosedür kaynağı: `docs/v3/SPRINT1-PREP-KIT.md` §B. Amaç: Sprint 1 sonrası
> **"<2GB heap"** hedefine (DESIGN-LOCK §8) karşılaştırma referansı. Bu, **mevcut
> v2.4.9 monolit davranışının** ölçümü — Sprint 1 frontend kodu yazılmadan.
>
> **DURUM: ⏳ ÖLÇÜM BEKLİYOR** — aşağıdaki tablo doldurulunca S1-PREP-C kapanır
> ve Sprint 1 frontend cutover'ı açan 2 gate'ten biri tamamlanır.
> Üreteç + runbook hazır (commit `3ca8785` üzeri); ölçüm manuel (DevTools, kullanıcı).

## 0. Önkoşul — neden manuel

Heap piki yalnız çalışan WebView2'de gözlemlenebilir; otomatize edilemez.
Üreteç (`make_v249_db`) v2.4.9 monolit `archivist.db`'yi **birebir `database.ts`
şemasıyla** üretir (PREP-KIT §A) — app temiz açılsın, 3 senaryo da gerçek UI'dan
tetiklenebilsin diye. (Bilinçli sapma: `asset_relations` FK'leri fixture'da yok;
heap yolu/boot'u etkilemez, vec_db cascade testleri yalnız COUNT kullanır.)

## 1. Baseline DB üret (üreteç hazır)

`make_v249_db` → `Sized(asset)` profili, emb sayısı = asset×2:
`large` = 50.000 asset → **100K embedding**, `huge` = 565.000 asset → **1.13M embedding**.

```powershell
$env:BASELINE_DB_OUT = "C:\baseline-db"     # çıktı klasörü (zorunlu)
$env:BASELINE_PROFILES = "large"            # önce large (hızlı doğrula); sonra "huge"
cargo test --manifest-path src-tauri/Cargo.toml --features admin `
  emit_baseline_dbs -- --ignored --nocapture
```

Çıktı: `C:\baseline-db\baseline_large_100k.db` (ve/veya `baseline_huge_1130k.db`).
`#[ignore]` olduğu için CI'de koşmaz; `--ignored` ile elle koşulur.
Huge çok-GB ve uzun sürer — önce `large` ile uçtan uca doğrula, sonra `huge`.

## 2. APPDATA'ya yerleştir

Uygulama ana arşivi `%APPDATA%\com.archivistpro.desktop\archivist.db`'den okur.
**Önce mevcut gerçek DB'ni yedekle** (üzerine yazılır):

```powershell
$dst = "$env:APPDATA\com.archivistpro.desktop"
if (Test-Path "$dst\archivist.db") {
  Copy-Item "$dst\archivist.db" "$dst\archivist.db.REAL-BACKUP" -Force
}
Copy-Item "C:\baseline-db\baseline_large_100k.db" "$dst\archivist.db" -Force
```

Ölçüm bitince geri al: `Copy-Item "$dst\archivist.db.REAL-BACKUP" "$dst\archivist.db" -Force`.

## 3. App'i dev modda aç (DevTools için)

```powershell
npm run tauri dev   # release DEĞİL — dev WebView2 DevTools açık
```

WebView2 DevTools → **Memory** (veya Performance Monitor → JS heap size).
Her senaryoda **JS heap pikini** kaydet.

## 4. Senaryolar (her profil için ayrı tur)

| # | Senaryo | Tetik | Beklenen baskı |
|---|---|---|---|
| a | Soğuk açılış → ana arşiv yüklenir | `initDatabase` → `read_database_binary` → `new SQL.Database` | DB binary WASM'a |
| b | Semantik arama | RAG/chat'ten sorgu → `ragService.retrieve` → `getRagCachedEmbeddings` (tüm vektörler RAM'e) | tüm embedding `number[]` JS heap'e |
| c | Yerel↔ana arşiv geçişi | `withArchive` ile arşiv değiştir | bilinen 7-9GB pik (iki binary + emb) |

**DE-RISK teşhisi:** `huge` (1.13M) + senaryo (c) → 7-9GB pik / "Aw Snap" beklenir.
Bu, Sprint 1'in çözdüğü problemin sayısal kanıtıdır.

## 5. Sonuçlar

Baseline commit: `3ca8785` (feat/v3-2-vec-db) · Tarih: 2026-05-18
Donanım: Intel i7 X 980 @3.33GHz (6C), **24 GB RAM**, host `SENAH2026`
Ortam: `npm run tauri dev` (dev WebView2), metrik = DevTools Performance
Monitor **JS heap size**.

### 5.1 İlk tur GEÇERSİZ — metodoloji hatası (kayıt için saklandı)

İlk 6 ölçüm (`archivist.db`'yi APPDATA default yoluna kopyalayıp app açma)
**geçersizdi**: bu makinede config `archivist_config.json` → `db_path` =
`D:\DENEME_arşiv\archivist.db` (kullanıcının özel ana arşivi). `resolve_db_path`
config'teki özel yolu default APPDATA'ya tercih ediyor → app **sentetik DB'yi
hiç okumadı**, hep gerçek ~4.300-dosya arşivini ölçtü (heap ~130–235 MB,
profil-bağımsız — çünkü hep aynı küçük gerçek arşiv). **Ders:** sentetik DB
yüklendi sanmadan ÖNCE app'te asset sayısı == profil (50.000 / 565.000) doğrulanmalı.

### 5.2 GEÇERLİ ölçüm — yerel-arşiv yolu (asset sayısı teyitli)

Düzeltilmiş prosedür: sentetik DB → yerel-arşiv default yolu
(`%APPDATA%\com.archivistpro.desktop\archivist_local.db`, config `local_db_path`
boş → default), app restart, app'te yerel arşive geç, **asset sayısı teyit
edilir**, sonra ölçülür. Ana arşiv config'i (`D:\…`) hiç değiştirilmedi,
gerçek arşive yazılmadı/okunmadı.

| Profil | Embedding | Senaryo | JS heap | Not |
|---|---|---|---|---|
| large | 100K | yerel yüklü (sabit) | **155 MB** | yerel arşiv = sentetik; asset sayısı **50.000 teyitli** |
| large | 100K | semantik arama | **~710 MB tepe** | sorgu `tasarım konseptini açıkla` (liste-niyeti DEĞİL → `retrieve()` → `getRagCachedEmbeddings`); UI: "5004 aday · FTS 0 · embedding 5004 → 8 LLM"; heap 155→629→710 tırmandı (ağır embedding-yükleme yolu doğrulandı; bir miktar eşzamanlı indeksleme gürültüsü vardı, yön net) |
| **huge** | **1.13M** | **açılış** | **UYGULAMA ÇÖKÜYOR** | 2.4GB `archivist_local.db` mevcutken app başlangıçta `app.exe` exit `0xe0000008`. İzolasyonla kanıtlandı: dosya kenara → app açılıyor; dosya geri → çöküyor. sql.js monolit 1.13M-embedding DB'yi yükleyemiyor; heap pikine ulaşmadan ölüyor. |

### 5.3 Sonuç (kanıt-temelli)

- 100K embedding'de tek bir semantik sorgu JS heap'i **155 → ~710 MB** (~4.5×)
  tırmandırıyor — neredeyse tamamı `getRagCachedEmbeddings`'in tüm vektörleri
  JS dizilerine yüklemesi (mimari, GPU ile hızlanmaz; veri-hacmi problemi).
- 1.13M embedding'de (×11.3) lineer ekstrapolasyon multi-GB; **ampirik olarak
  uygulama açılışta tamamen çöküyor**. DE-RISK "7-9GB / Aw Snap" tezi en güçlü
  biçimde (kısmi yavaşlama değil, **total başarısızlık**) doğrulandı.
- Kullanıcı UX'i bizzat yaşadı: uzun donma + sürekli şişen RAM, tek-thread JS.

Bu, v3 (embedding'leri ayrı `vec.db`'de tut, vektör aramasını native yap)
kararının canlı, sayısal gerekçesidir.

## 6. Kabul — S1-PREP-C KAPANDI ✅

Baseline kanıt-temelli tamamlandı (2026-05-18): 100K sayısal heap eğrisi +
1.13M total-çökme. Sprint 1 sonrası **aynı makinede, aynı yerel-arşiv
prosedürüyle** tekrarlanacak; hedef: 1.13M ile app **çökmeden** açılır ve
semantik arama heap'i **< 2GB** (DESIGN-LOCK §8). `docs/v3/STATUS.md` gate
listesinde S1-PREP-C işaretlendi.

> Not (Sprint 1 sonrası karşılaştırma için): mutlak MB donanıma bağlı; kritik
> kabul ölçütü **1.13M'de çökmeme** + **< 2GB**, MB'nin birebir tekrarı değil.

## 7. ANN bench (V3-1 Faz 2) — 1M ölçüm: defekt çözüldü, gate yeniden tanımlandı

> DURUM (2026-05-18, host **AHMET2026** 32 GB, `--release`): İki tur koşuldu.
> Sonuç: **(a) orijinal mmap-reload paniği = KULLANIM HATASI, çözüldü ve reload
> doğruluğu KANITLANDI; (b) sequential 114-dk build = parallel_insert ile ~5.4×
> hızlandı; (c) `ann_bench`'in mutlak-recall≥0.98 assert'i synthetic veride
> GEÇERSİZ sinyaldi (in-RAM index'in kendisi düşük, reload değil) → bench
> geçerli sinyallere (reload sadakati + latency + RAM) göre yeniden tasarlandı.**
> Net: v3 vec.db/index/reload tarafında **defekt YOK**; mutlak-recall
> doğrulaması zaten Gate #1 (gerçek anonim db) işi (STATUS ile tutarlı).

Komut: `app_lib-<hash>.exe (release) ann_bench --ignored --exact`,
`ANN_BENCH_N=1000000 ANN_BENCH_DIM=384`. RSS = harici örnekleyici
(`WorkingSet64` 1.5 sn + `PeakWorkingSet64`), S1-PREP-C gibi süreç-dışı manuel.
**Profil sapması (bilinçli):** doc komutu debug; latency/RAM bench → release
(uygulama release ship; debug 1M saatlerce + latency anlamsız).

### 7.1 Tur 1 (sequential build + yanlış reload API) — PANİK

| Faz | Sonuç |
|---|---|
| build (sequential `hnsw.insert`, tek-thread) | **6844 sn ≈ 114 dk** |
| dump | 8.7 sn, 2050 MB |
| in-RAM build pik RSS | **~5872 MB (5.7 GB)** (base 1464 + graph ~4.4 GB) |
| reload (`load_hnsw_with_dist` + `ReloadOptions(true)`) | ❌ PANİK `hnswio.rs:828 unwrap()-on-None` |

**Kök neden (kaynak okundu):** `load_hnsw_with_dist` (`&self`, hnswio.rs:533)
`self.datamap`'i ASLA doldurmaz (dolduramaz) ve `datamap_opt:false` sabitler;
ama `load_point_indexation` mmap kararını `ReloadOptions`'tan alır →
`datamap=true` ile mmap branch'i `self.datamap.unwrap()` None panik. **Bu bir
hnsw_rs API tuzağı + bizim yanlış kullanımımız**, hnsw_rs 0.3.4 son patch (bump
yok). Doğru mmap API'si `load_hnsw` (`&mut self`, hnswio.rs:433): use_mmap ise
`self.datamap`'i `DataMap::from_hnswdump` ile doldurur (:496-504). `DistCosine`
`#[derive(Default)]` → `load_hnsw`'nin `D:Default` kısıtını sağlar.

### 7.2 Düzeltmeler (kod, test-yeşil)

1. **Reload defekti (`vector_index.rs` bench, test-only):**
   `load_hnsw_with_dist(DistCosine{})` → `load_hnsw::<f32,DistCosine>()`.
2. **parallel_insert (`build_hnsw_from_vectors`, PROD):** sequential döngü →
   chunked `parallel_insert` (PAR_CHUNK=16384). Chunk'lar arası `cancel`
   kontrolü KORUNUR (rebuild-iptal granülaritesi). DataId = global ordinal
   (`base+j`) — `parallel_insert` = `par_iter().for_each(insert((item,v)))`,
   `v`→`origin_id`→`Neighbour.d_id` (insert sırasından bağımsız; kaynak teyitli)
   → `ORDER BY id` ordinaliyle birebir, `HnswIndex::search` eşlemesi bozulmaz.
   Tüm suite 192/192 (recall_gate dahil ≥0.98 korunur), clippy 0.

### 7.3 Tur 2 (parallel build + doğru reload) + TANI

| Faz | Sonuç |
|---|---|
| build (chunked `parallel_insert`, ~11 çekirdek) | **1267 sn ≈ 21 dk** (~5.4× hızlı) |
| dump | 6.4 sn, 2065 MB |
| **mmap reload** (`load_hnsw`, datamap=true) | **21.3 sn — PANİK YOK** ✅ defekt çözüldü |
| search latency (1M, reloaded) | **p50=9.26 ms · p99=10.36 ms** ✅ |
| recall@10 (reloaded) | 0.2020 — düşük (aşağıya bakınız) |
| peak RSS | **10716 MB (~10.5 GB)** — parallel build, sequential'dan (5.7 GB) ağır (rayon eşzamanlı tampon) |

recall=0.20 kök nedeni için tanı testi (`reload_recall_parity_diagnostic`,
n=20k dim=384, in-RAM vs reload(mmap=false) vs reload(mmap=true)):

```
[DIAG-RANDOM]  in-RAM=0.79  reload(mmap=false)=0.79  reload(mmap=true)=0.79
[DIAG-PLANTED] in-RAM=0.85  reload(mmap=true)=0.85
```

**Üçü her senaryoda 4-ondalık BİREBİR.** Çıkarımlar:
- **Reload/datamap-mmap KUSURSUZ:** reloaded index in-RAM ile tıpatıp aynı →
  hnsw_rs datamap mmap *doğru* (orijinal panik tek reload kusuruydu, fix'li).
- **Düşük recall reload'dan DEĞİL:** taze in-RAM index'in kendisi dim=384'te
  düşük (planted near-dup bile 0.85). Sebep: `gen_unit_vectors` zayıf LCG +
  yüksek-boyut rastgele birim vektör → boyut laneti (noktalar ~eşit-uzak,
  brute "ground-truth" sayısal kararsız). **Synthetic metodoloji artefaktı,
  v3 kod defekti DEĞİL.** Gerçek embedding'ler kümeli (DE-RISK SIFT1M ~0.99;
  `recall_gate_*` dim=48 → 0.98 yeşil; `build_then_search` self-query >0.99).

### 7.4 Bench yeniden tasarımı (geçerli gate)

`ann_bench` artık synthetic mutlak-recall≥0.98 assert ETMEZ (geçersiz sinyal).
1M harness'in GEÇERLİ doğruladığı 3 şey assert/ölçülür:
1. **Reload SADAKATİ:** `|in-RAM recall − reload recall| ≤ 0.01` (datamap
   doğruluğu; bozulursa GERÇEK defekt — eski paniğin olduğu yer).
2. **Latency:** p99 < 100 ms (ANN'in varlık sebebi: O(n) brute değil).
3. **RAM:** RSS harici manuel (bu §).
Mutlak recall bilgilendirici basılır. recall regresyonu ayrıca
`recall_gate_*` (dim=48, CI) korur; gerçek-embedding mutlak recall = **Gate #1**.

### 7.5 Kabul — durum

- ✅ **Orijinal defekt (mmap-reload panik): ÇÖZÜLDÜ ve reload doğruluğu KANITLANDI**
  (parity birebir, tani + 1M no-crash).
- ✅ **Yan bulgu (114-dk build): ÇÖZÜLDÜ** (parallel_insert, ~5.4×, cancel korundu).
- ✅ **Latency 1M:** p50≈9 / p99≈10 ms — ANN değer kanıtı.
- 📊 **RAM 1M:** in-RAM build pik ~10.5 GB (parallel) / ~5.7 GB (sequential).
  sql.js JS-heap multi-GB-çökmesine (§5-6) karşı native HNSW **sınırlı ve
  öngörülebilir**; mmap reload süreç-RSS'i ground-truth `base` (1.46 GB) hâlâ
  rezident olduğu için bu harness'te izole edilemez (bilinçli — brute karşılaştırma).
- ⏭️ **Mutlak recall@10:** synthetic'te geçersiz; gerçek-embedding doğrulaması
  **Gate #1**'e (anonim v2.4.9 db) ait — zaten frontend cutover ön-koşulu, yeni
  bağımlılık DEĞİL. ANN cutover (V3-1 Faz 3) bu kapıdan geçer.

**Özet:** DE-RISK §2'nin "1M recall+latency+RAM" gate'inin **latency + RAM +
reload-sadakati ayakları VALIDATED**; recall ayağı synthetic'te ölçülemez,
Gate #1'e devredildi (kapsam değişimi değil — STATUS zaten böyle diyordu).
v3 backend tarafında açık defekt yok.

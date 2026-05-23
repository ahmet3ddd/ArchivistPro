# Sürüm Notları (Changelog)

Bu dosya tüm sürüm değişikliklerini özetler. Format
[Keep a Changelog](https://keepachangelog.com/) standardına uyar; sürüm
numaralandırması [Semantic Versioning](https://semver.org/) kurallarına göre
ilerler.

Türler:

- **Eklenenler** — Yeni özellikler
- **Değişenler** — Mevcut özelliklerde davranış değişiklikleri
- **İyileştirilenler** — Performans / kalite / kullanılabilirlik iyileştirmeleri
- **Düzeltilenler** — Hata düzeltmeleri
- **Kaldırılanlar** — Çıkarılan özellikler
- **Güvenlik** — Güvenlik düzeltmeleri

---

## [3.0.0] — 2026-05-23 — V3 Mimari

ArchivistPro v3, mimari arşivleri yönetme yaklaşımında köklü bir altyapı
yenilemesi getirir. Kullanıcı için günlük deneyim aynı kalır; ancak veri
saklama, AI sohbet doğruluğu ve büyük arşivlerle çalışma performansı kayda
değer biçimde iyileşir.

### ⚠️ Önemli — Geriye Uyumluluk

- Mevcut arşivler **ilk açılışta otomatik** olarak V3 şemasına taşınır.
  Migrasyondan önce `archivist_premigrate_v3.db.bak` adıyla yedek üretilir —
  geri dönüş güvenlidir.
- Manuel kontrol isteyen yöneticiler **Ayarlar → Depolama → V3 Şema
  Migrasyonu** panelinden tetikleyebilir (otomatik tetik isteğe bağlı
  kapatılabilir: `localStorage ARCHIVIST_V3_EPOCH='off'`).
- Eski sürümlere dönüş `.bak` dosyasından geri yüklemeyle mümkündür.

### Eklenenler

- **V3 Şema Mimari** — Vektör verileri (embeddings, text chunks, asset
  relations, FTS5 keyword index) ayrı `archivist_vec.db` dosyasına taşındı.
  Sonuç: ana `archivist.db` yaklaşık **3-4× küçülür**; gerçek örnekte
  181 MB → 52 MB ölçümlendi.
- **Settings → V3 Şema Migrasyonu paneli** (admin-only) — manuel tetik
  butonu, migrasyon ilerlemesi, hata teşhisi.
- **HNSW ANN Vektör Dizini** — büyük embedding kümelerinde (1M+ ölçek)
  semantik arama latency'si milisaniyelerde (p50≈9 ms, p99≈10 ms ölçüldü).
- **Per-arşiv yazma kilidi** — birden fazla arşivle eşzamanlı çalışırken
  veri güvenliği. Eski "tek global kilit" deseni kaldırıldı.
- **Cross-archive merge** (Join/Extract) artık embedding ve text chunk
  verilerini de korur — sadece asset metadata değil.
- **Klasör silme geri-al** snapshot artık V3 verisini de kapsar
  (embeddings, text chunks, ilişkiler hep birlikte geri yüklenir).
- **Türkçe AI Sohbet "var mı / geçer mi / olur mu" yakalama** — soru-eki
  doğru tanınır, liste yanıtı doğrudan dosya listesiyle döner.

### Değişenler

- **WAL Journal default açık** — yerel disk için varsayılan SQLite journal
  modu WAL (yazma performansı artar). Ağ paylaşımı (UNC / `\\sunucu\...`)
  otomatik tespit edilir ve DELETE moduna düşülür (paylaşımlı dosya
  sisteminde WAL güvensiz). Opt-out: `ARCHIVIST_DB_JOURNAL=delete`.
- **Migration finalize Rust tarafında** — büyük monolit arşivlerde
  (180+ MB) ortaya çıkan `RangeError: Invalid array length` (Tauri IPC
  payload sınırı) sorunu çözüldü. Migration artık Rust'ta atomik:
  rusqlite ile DROP + VACUUM + `user_version=3` tek seferde.
- **AI Sohbet okuma yolları epoch-aware** — embedding/text-chunk/keyword/
  ilişki okumaları migrasyondan sonra vec.db'ye yönlenir (PRE-5).
- **AI Sohbet yazma yolları epoch-aware** — tarama, snapshot, metadata
  oto-sync, cross-archive merge migrasyondan sonra vec.db'ye yazar (PRE-6).

### İyileştirilenler

- **Migration mekanik tamamlanma** — gerçek 185 MB monolit arşivde başarılı
  test (3. canlı denemede commit `5cc6417` ile).
- **Recall metriği** — vektör arama doğruluğu mesafe-tabanlı recall ile
  ölçülür (ANN-benchmark standardı). Gerçek arşivde recall@10 ≥ 0.98.
- **Stale WAL temizliği** — `write_database` blob-overwrite sonrası
  yetim `-wal` / `-shm` dosyaları otomatik silinir (Gate 0 ağı).
- **Backup/export öncesi `wal_checkpoint(TRUNCATE)`** — snapshot ve
  arşiv ihracında tutarlılık garantilenir.

### Düzeltilenler

- **AI Sohbet "X var mı" → "Hayır" hatası** — `detectListIntent` Türkçe
  soru-eki "mı/mi/mu/mü"yü önceki kelimeden ayırıyor, marker listesi
  yalnız birleşik `varmi` tutuyordu. Fix `92681e9`: hem ham hem soru-eki
  birleştirilmiş tokenları markerlara karşı kontrol et.
- **A6 migration disk-write fail sahte-başarı** — `runV3EpochMigration`
  disk yazımı başarısız olsa bile epoch ilerletip "ok" döndürebiliyordu;
  artık save dönüşü kontrol edilir, başarısız ise migration durdurulur
  (commit `76d2acf`).
- **Tauri'de `window.confirm` yasak** — paneldeki onay diyaloğu
  `showConfirmDialog` ile değiştirildi (commit `42ae798`).
- **HNSW reload `load_hnsw_with_dist` ile çöküyordu** — `load_hnsw`
  (`&mut self`, datamap mmap doldurur) ile değiştirildi. 1M reload
  artık paniksiz, in-RAM ile birebir doğruluk (commit `0e0335d`).
- **`verify_embeddings` karışık-boyut bug** — hard-coded `384*4` blob
  sağlaması, 512-dim CLIP'i sahte-FAIL ediyordu; boyuttan bağımsız
  round-trip kontrolüne geçildi.

### Güvenlik

- Anonimleştirici `scanned_roots.label` PII açığı kapatıldı (commit
  `e71b59b`) — test verisi üretiminde hassas etiketler temizlenir.

---

## [2.4.10] — 2026-05-17

### Eklenenler

- **AI Sohbet — "X hangi belgede" list-intent içerik araması** —
  `directFileListAnswer` artık dosya adı/etiket/metadata YANINDA belge
  metnini de tarar (FTS5 + tr_norm fallback). "Şenay hangi dosyada"
  gibi sorularda asset metadata'da olmasa bile chunk içeriğinde geçtiği
  belge bulunur.

### Düzeltilenler

- **AI Sohbet keyword fallback Türkçe karakterleri kaçırıyordu** —
  Türkçe-aware normalize (İ→i, I→ı, vb.) tüm karşılaştırma noktalarına
  uygulandı (commit `4d010a8`).
- **Sızan prompt iskeleti** — LLM cevabında kalan "KAYNAKLAR:" / "SORU:"
  gibi şablon satırları post-process ile temizlenir (commit `deb51d3`).
- **Keyword-gate birebir tüm-token eşleşmesi topK'ya garanti dahil** —
  yüksek embedding skoruna sahip ama keyword eşleşmesi olmayan chunk'lar
  kesin eşleşmeyi gölgeleyemez.
- **pre-2.4.8 ölü `dwg_shapes` tablosu migration ile temizlensin** —
  %99'a varan DB bloat'ı düzeltildi (commit `b1445ed`).

---

## [2.4.9] — 2026-05-16

### Eklenenler

- **fp32 modelleri harici/kullanıcı-sağlamalı import** — varsayılan q8
  modeller paketle gelir; isteyen kullanıcı (örn. doğruluk için) fp32
  modelleri ayrı indirip yerleştirebilir.

### Düzeltilenler

- **transformers v4.2.0 offline regresyonları** — fp32/WebGPU + q8 yollarının
  tümü offline çalışır (commit `e343f76`).
- **CLIP warmup CSP** — `data:` URL yerine Blob; WebGPU tarama stall'ı
  giderildi (commit `999d319`).
- **Offline BENİ_OKU dinamik sürüm** + ODA/fp32 dokümantasyonu.

---

## [2.4.8] — 2026-05-15

### Değişenler

- **`dwg_shapes` ayrı DB dosyasına taşındı** — WAL mode + batch persist
  ile DWG shape verisinin ana DB'den izole edilmesi (commit `a39d20e`).
  V3 mimarinin temelini hazırlayan refactor.

### Düzeltilenler

- **SetupWizard 'admin/admin' yanıltıcı ipucu kaldırıldı** — kullanıcıyı
  yanlış yönlendiren placeholder metni temizlendi.

### Eklenenler

- **WebGPU embedding desteği** — transformers.js v4 upgrade ile
  kullanılabilir donanımda CPU yerine GPU'da embedding üretimi.

---

## [2.4.7] — 2026-05-13

### Düzeltilenler

- **Arşiv switch crash** — IPC binary migration ile çoklu arşiv geçişinde
  oluşan crash giderildi (commit `75aa611`).

### Eklenenler

- **mirror-release workflow** — Arsiv-H2 release'leri otomatik olarak
  ArchivistPro aynalama deposuna kopyalanır.

---

## [2.4.6] — 2026-05-12

### Düzeltilenler

- **Spinner animasyonları** — `.animate-spin` sınıfı tanımlandı, Loader2
  bileşenlerine uygulandı (commit `c059949`).

### İyileştirilenler

- **A-SAVE-FREEZE performans** — collections / tags / root_groups için
  tablo-özel rusqlite mirror; "DB kaydediliyor" donma giderildi
  (commit `adc1094`).

---

## [2.4.5] — 2026-05-10

### Eklenenler

- **DWG thumbnail limiti 100 → 500 MB** — büyük DWG dosyalarının önizleme
  üretimi (commit `276f7f2`).
- **Tarama sırasında process priority Below Normal** — tarama arka planda
  daha az yer kaplar, UI akıcılığı korunur.

### Düzeltilenler

- **MAX dosya boyut limitleri** 200MB→2GB, 10MB→50MB.
- **SetupWizard Ollama kontrolü** `pingOllama`'ya taşındı — HTTP plugin
  scope sorunu giderildi.

---

## [2.4.4] — 2026-04-30

### Açık Kaynak Hazırlık

- Lisans (MIT), dokümantasyon yapısı, `.gitignore` temizliği.
- 33 Rust clippy uyarısı düzeltildi (CI yeşil).

---

## Önceki Sürümler

v2.4.4 öncesi sürümlerin notları için git tag geçmişine bakın:

```bash
git tag --list 'v*' --sort=-v:refname
git show v2.4.3  # belirli sürüm
```

Önceki ana sürüm sınırları:

- **v2.4.x:** açık kaynak hazırlık, AI sohbet RAG iyileştirmeleri,
  thumbnail/format desteği genişlemeleri
- **v2.3.x:** Çoklu arşiv (main + local) altyapısı, AI hassasiyet filtresi
- **v2.2.x:** İlk AI sohbet (RAG) sürümü, embedding tabanlı arama
- **v2.1.x:** Tarama performansı, LAN paylaşım
- **v2.0.x:** Tauri v2 migration, React 19 upgrade
- **v1.x:** İlk Electron tabanlı sürümler (artık desteklenmiyor)

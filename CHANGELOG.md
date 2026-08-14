# Changelog

Tüm önemli değişiklikler bu dosyada belgelenir — **sürüm geçmişinin tek
kaynağı budur.** Format [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/)
tabanlıdır; sürüm numaralandırması [Semantic Versioning](https://semver.org/)
kurallarına göre ilerler.

## [3.3.3] — 2026-08-13 — Yeni Nesil Kod Tabanı (H3)

Bu sürüm, uygulamanın yeniden yazılmış **yeni nesil kod tabanının** ilk halka
açık sürümüdür (3.3.0–3.3.3 hattının toplamı). 3.2.2 ve öncesinden farklı bir
uygulama kimliği kullanır: eski sürümün **yerinde yükseltmesi değildir** —
yan yana kurulur; eski arşiv, yeni sürümde **Ayarlar → İçe Aktarma**
sihirbazıyla taşınır (kaynak veriye dokunmaz, güvenle tekrarlanabilir).

### Değişen (Changed)
- Veri katmanı tarayıcı içi sql.js'ten **native SQLite'a (Rust)** taşındı;
  arşiv artık tarayıcı belleğinde değil, diskte tek doğruluk kaynağında tutulur.
- AI/embedding hesaplamaları tarayıcıdan **Rust ONNX Runtime'a** taşındı.
- Büyük arşiv desteği: on binlerce dosyalık gerçek arşivlerle doğrulandı;
  mimari yüz binler ve üzeri ölçek hedefiyle tasarlandı.

### Eklenen (Added)
- Eski nesil (3.2.x) arşivinden **içe aktarma sihirbazı**; son aktarımın
  özeti (tarih, kaç yeni / kaç mevcut kayıt) kartta gösterilir (3.3.1).
- Sürüm göstergesi: üst çubukta ve Ayarlar → Genel'de uygulama sürümü.

### Düzeltilen (Fixed)
- "Önceki sürüm bulundu" kartının, uygulamanın kendi kurulumunu eski sürüm
  sanması düzeltildi (3.3.2).
- Ek (ikincil) arşivlerde sohbetlerin kaydedilmemesi düzeltildi; sohbet
  kaydetme hatası artık sessizce yutulmaz, kullanıcıya bildirilir (3.3.3).

## [3.2.2] — 2026-07-01 — Klasörler & Arama İnce Ayarları

Klasör yönetimi ve arama sonuçlarını iyileştiren bir yama. Veri ve iş akışı
değişmez; mevcut arşivler olduğu gibi açılır.

### Düzeltilenler

- **Klasörler sekmesi — sağ-tık menüsü ve sıralama.** Sağ-tık (bağlam) menüsü
  artık bulunulan sayfaya özel seçenekler gösteriyor; klasör sıralaması gerçekten
  uygulanıyor (önceden bazı durumlarda etkisizdi).
- **Klasörler sekmesinde ilgisiz filtreler gizlendi.** Yalnız dosya (asset)
  düzeyinde anlamlı olan filtreler Klasörler görünümünde artık görünmüyor —
  arayüz sadeleşti.
- **AI Sohbet — "X hangi dosyada?" liste yanıtları.** Bu tür liste sorularında
  dosyalar artık alaka düzeyine (BM25) göre sıralanıyor; en olası eşleşme en üstte.
- **Görsel arama — Osmanlı/geleneksel mimari terimleri.** "Şadırvan" gibi
  dini/geleneksel terimler görsel (CLIP) aramasında doğru İngilizce karşılığına
  (ablution fountain) çevrilerek daha isabetli sonuç veriyor.

## [3.2.1] — 2026-06-26 — Yardım Aramada Gezinme

Yardım panelindeki arama deneyimini iyileştiren bir yama. Veri ve iş akışı değişmez.

### İyileştirilenler

- **Yardım aramasında sonuçlar arası gezinme.** Arama birden fazla sonuç bulduğunda
  arama çubuğunda **"X/Y" sayaç + ↑/↓ butonları** çıkar; **Enter** sonrakine,
  **Shift+Enter** öncekine gider (sona gelince başa sarar). Aktif eşleşme belirgin
  vurgulanır ve görünüme kaydırılır.

### Düzeltilenler

- **Yardım arama vurgusu artık tüm sekmelerde çalışıyor.** Önceden yalnızca Kullanıcı
  Kılavuzu ve Teknik Referans'ta vurgulanıyordu; **Sürüm Notları** ve **Senaryolar**
  sekmelerinde aranan terim içerikte görünmesine rağmen vurgulanmıyordu — düzeltildi.

## [3.2.0] — 2026-06-26 — OCR, Harita & Kategori Arşivleri

Son dağıtılan sürümden (3.0.4) bu yana biriken yeni özellikleri getiren minor
sürüm. Veri ve iş akışı geriye uyumlu; mevcut arşivler olduğu gibi açılır.

### Eklenenler

- **OCR — Offline metin tanıma (yeni).** Taranmış belge ve görsellerdeki metin
  artık gerçek OCR ile çıkarılıp hem tam-metin hem semantik aramada bulunur.
  Tamamen offline çalışan **Tesseract** motoru (internet/Ollama gerekmez); isteğe
  bağlı Ollama vision-LLM de seçilebilir. Varsayılan kapalı — Ayarlar > AI & Vision
  > OCR'dan açılır. Çok-sayfalı taranmış PDF'ler sayfa sayfa OCR'lanır. "Mevcut
  dosyaları OCR'la" düğmesiyle önceden taranmış kütüphane tek tıkla taranır.
- **Harita görünümü — EXIF GPS (yeni).** GPS'li fotoğraflar offline bir dünya
  haritasında işaretçi/kümeleme ile gösterilir; ülke + en yakın şehir bilgisi,
  fare ile zoom/pan, haritadan Kaşif'e drill. Tamamen offline (tile sunucusu yok).
- **Kategori arşivleri (3.1.0).** İçeriği proje/yıl/müşteriye göre ayrı arşivlere
  bölme; yalnız aktif arşivi belleğe yükleyerek büyük kütüphanelerde açılış
  belleğini kontrol altında tutma. Oluştur / yeniden adlandır / çöp kutusu / geri
  yükle + gruplar arası taşıma.

### İyileştirilenler

- **Yerel arşivde semantik & içerik arama** — yerel (kişisel) arşivler de artık
  epoch-aware vec.db ile semantik/RAG aramayı tam destekler.
- **Açılışta semantik arama otomatik aktif** (login sonrası arka plan ısınma).

### Düzeltilenler

- Harita sekmesi, koordinatlı/koordinatsız her durumda taban haritayı gösterir.
- Harita görünümünde sağ-tık artık alakasız bağlam menüsünü açmıyor.
- OCR indeks yolu üç çağrı yerinde birleştirildi (chunk_ocr tutarlılığı + sağlayıcı-aware).

## [3.0.1] — 2026-06-04 — Başlangıç Performansı & UX

Açılış donmasını gideren bir yama sürümü. Veri ve iş akışı değişmez; yalnızca
uygulamanın açılış deneyimi ile klasör yönetimi iyileşir.

### İyileştirilenler

- **Açılış donması giderildi** — Giriş ekranı artık anında gelir, donmaz.
  Önceden embedding AI modeli (semantik arama için) açılışta yüklenip ana iş
  parçacığını ~8 saniye bloklayarak giriş ekranını dondururdu. Model artık
  yalnızca **ilk semantik aramada** yüklenir; hiç arama yapılmayan oturum bu
  maliyeti hiç ödemez. (commit bac382d)
- **Büyük arşivlerde akıcı giriş** — Ağır arşiv veritabanının (sql.js)
  yüklenmesi giriş sonrasına ertelendi; giriş ekranı dosya/varlık sayısından
  bağımsız akıcı kalır.
- **Arşiv yükleme ekranı** — Giriş sonrası büyük arşiv yüklenirken animasyonlu,
  geçen süre + (önceki yüklemeden ölçülen) tahmini kalan süreyi gösteren bir
  bekleme ekranı eklendi.

### Eklenenler

- **Klasörler sekmesi — kart sağ-tık menüsü** — Klasör kartına sağ-tıklayınca
  "Aç" ve "Çöp'e Taşı" (klasörü ve içindeki dosyaları geri-alınabilir biçimde
  Çöp Kutusu'na taşıma) seçenekleri. Mevcut görünüm/sıralama menüsü korunur.
  (commit f7c06cc)

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

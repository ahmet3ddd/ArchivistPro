# "Şekil" Butonu — Ekran Kaydı ile DWG Bulma Senaryosu Fizibilite İncelemesi

**Tarih:** 2026-05-01
**Soru:** Üst bardaki "Şekil" butonu ile açılan bölüme bir DWG projesinin bir kısmının **ekran kaydını** verip o DWG dosyasını buldurmak mümkün mü? Bu bölüm bu işlevi yerine getirmek için yeterli mi?
**Kapsam:** Yalnızca inceleme — kod değişikliği yapılmadı.

---

## 1. Net Cevap

**Hayır, mevcut hâliyle bu bölüm bu işlevi yerine getirmez.** Üç bağımsız sebep her biri tek başına yeterli engel:

1. Modal **yalnızca statik raster görsel** kabul eder (PNG/JPG/BMP/TIFF). Video/ekran kaydı dosyaları (MP4, WEBM, MOV, AVI, animasyonlu GIF) reddedilir veya decode edilemez.
2. Ekran kaydı tipik olarak **birden çok şekil** ve UI elemanı içerir; pipeline ise tek bir **dominant kapalı kontur** çıkarır — yani ekran kenarı / pencere çerçevesi gibi yanlış nesneye odaklanır.
3. Eşleşme algoritması yalnızca **4 düşük-boyutlu özellik** kullanır (vertex sayısı, düzgünlük, en-boy oranı, kapalılık). Spesifik bir DWG'yi tek tek ayırt edecek hassasiyette değil — "benzer şekilli olası dosyalar" listesi döndürür.

Aşağıda bu üç engel kanıtlarla açıklanıyor.

---

## 2. "Şekil" Butonunun Bugün Yaptığı Şey

**Açılan bileşen:** `src/components/ShapeSearchModal.tsx`
**Üst bar bağlaması:** i18n anahtarı `toolbar.shapeSearch.text = "Şekil"` (bkz. `src/i18n/locales/tr.json:170`)
**Backend:** `src-tauri/src/shape_match.rs` (görsel → kontur), `src-tauri/src/dxf_parse.rs` (DWG/DXF → shape)

Modal iki sekme sunuyor:

### Sekme 1 — "Görsel Yükle"
- Kullanıcı bir görseli drag&drop veya dosya seçici ile yükler.
- Pipeline (Rust, `shape_match.rs:292-360`):
  1. **Yükle:** `image::load_from_memory(...)` ile decode (`shape_match.rs:373`).
  2. **Gri tonlama** + **Otsu threshold** ile binarize.
  3. **Moore neighborhood border tracing** — sadece *en büyük* kapalı kontur seçilir (`trace_largest_contour`, `shape_match.rs:58-126`).
  4. **RDP (Ramer-Douglas-Peucker) sadeleştirme** ile vertex sayısı düşürülür.
  5. Çıktı: `vertex_count`, `regularity`, `aspect_ratio`, `area`, `perimeter`, bbox boyutları.
- Sonra `searchShapesBySimilarity()` (`src/services/dwgShapeIndex.ts:221-276`) `dwg_shapes` tablosunda benzer şekilleri arar.

### Sekme 2 — "Özellik Ara"
- Kullanıcı doğrudan parametre girer (kenar sayısı ± tolerans, min düzgünlük, en-boy oranı, layer kategorisi: HAVUZ/DUVAR/KAPI/PENCERE/KOLON/KIRIS/MERDIVEN/DOSEME/CATI/DIGER).
- `searchShapesByFeatures()` SQL filtre ile sonuç döndürür (`dwgShapeIndex.ts:281-332`).

### Skor formülü
```
score = 0.40 * vertexSim + 0.30 * regularitySim + 0.20 * aspectRatioSim + 0.10
```
(`dwgShapeIndex.ts:257`) — yalnızca 4 özellik üzerinden ağırlıklı benzerlik.

### Önkoşul
DWG/DXF dosyaları **önceden taranmış ve `dwg_shapes` tablosuna indekslenmiş** olmalı. DWG için ayrıca **ODA File Converter** kurulu olmalı (yoksa `extract_dwg_shapes` Err döner — `dwgShapeIndex.ts:149`).

---

## 3. Engel #1 — Video / Ekran Kaydı Girdisi Desteklenmiyor

### Frontend filtresi
`ShapeSearchModal.tsx:205` satırında dosya input'u şu accept değerini kullanır:

```html
accept="image/png,image/jpeg,image/bmp,image/tiff"
```

MP4 / WEBM / MOV / AVI / animasyonlu GIF bu filtreden geçmez. Drag&drop yolu (`handleDrop`, `ShapeSearchModal.tsx:126-130`) accept kontrolü yapmaz, ama bir video sürüklenirse pipeline bir sonraki adımda kırılır:

### Backend decode
`shape_match.rs:373`:

```rust
let img = image::load_from_memory(&image_data)
    .map_err(|e| format!("Görsel decode edilemedi: {e}"))?;
```

`image` crate yalnızca **statik görsel formatlarını** decode eder (PNG, JPG, BMP, TIFF, WebP-still, GIF-first-frame). MP4/MOV/WEBM gibi video container'larını çözemez ve hata döner.

### Frame extraction yok
Codebase'de `ffmpeg`, `gstreamer`, `mp4parse`, `videoframes` benzeri hiçbir bağımlılık yok. Yani bir ekran kaydından kare (frame) çıkartıp modal'a aktaracak hiçbir yol mevcut değil.

**Sonuç:** Kullanıcının elindeki .mp4 / .webm dosyası bu modala doğrudan **veremez**.

---

## 4. Engel #2 — Pipeline Sadece Tek "En Büyük Kontur"u Çıkarır

`trace_largest_contour` fonksiyonu (`shape_match.rs:58-126`) tüm görseli tarar ve **yalnızca en uzun kapalı konturu** döndürür. Bu mimari kararın sonuçları:

| Senaryo | Sonuç |
|---|---|
| El çizimi tek kroki (örn. sekizgen havuz) | ✅ Doğru kontur seçilir |
| AutoCAD ekran kaydı / ekran görüntüsü | ❌ Genellikle **AutoCAD pencere çerçevesi**, **viewport kenarı** veya **ekran kenarı** en büyük kontur olur |
| Çizim üzerinde imleç / palet / şerit menü | ❌ Otsu thresholding bu UI elemanlarının da kenarlarını yakalar; gürültü artar |
| Ekran kaydında zaman içinde değişen kareler | ❌ Pipeline tek kare üzerinde çalışır; zamanı yok sayar |

Yani kullanıcı bir ekran kaydı sağlasa **ve** bunu bir frame'e dönüştürse bile, pipeline'ın sıkıca yakalayacağı tek şekil büyük olasılıkla aradığı oda/havuz/blok değil; CAD pencere çerçevesi olur.

---

## 5. Engel #3 — Eşleşme Hassasiyeti Yetersiz

Skor sadece 4 normalize edilmiş özellik üzerinden hesaplanır:

- **vertex_count** (kenar sayısı)
- **regularity** (kenar uzunluk + iç açı varyansı)
- **aspect_ratio** (bbox en/boy)
- **is_closed** (sabit +0.10 bonus)

Bu özellik kümesinde olmayan bilgiler:

- Mutlak ölçü (1 m havuz vs 100 m havuz aynı skoru alır — `regularity` ölçek-invariant, `aspect_ratio` da)
- Konum / koordinat
- Layer adı (sorguda kullanıcı "HAVUZ" kategorisi seçmedikçe pencerelenmez — görsel zaten layer bilmez)
- Şekil ailesi içinde topology / komşuluk
- Renk, çizgi tipi, blok adı, attribute

Kullanıcı senaryosunda DWG arşivinde aynı tipte birden fazla proje varsa (ör. yüzlerce konut projesi → onlarcası 8-gen havuz içerir), modal "size en yakın 30 şekil" listesi döner. **Belirli tek bir DWG'yi kesin tespit edemez** — kullanıcının yine listeden seçmesi gerekir.

---

## 6. Engel #4 — Ekran Kaydı vs DWG Vector Arşivi Asimetrisi

DWG için `dwg_shapes` tablosundaki kayıtlar **vector geometriden** üretilir: layer adlı, kapalı/açık bilgisi temiz, vertex'leri kesin (`extract_dwg_shapes` ODA File Converter ile DXF'e çevirip parse eder, `dxf_parse.rs:858`).

Ekran kaydı ise:

- **Raster** (anti-aliased pixel)
- **Render edilmiş** (zoom seviyesi, AutoCAD görsel ayarları, layer renk/lineweight'leri devrede)
- **Çevre UI** içerir (toolbar, palette, status bar)
- **Sıkıştırma artefaktları** (H.264/VP9 ekran kaydı kompresyonu kontur kenarlarını bozar)

Bu iki modal arasında semantik bir köprü kurmak için CLIP gibi öğrenilmiş gömme (embedding) gerekir; ancak modal'ın algoritması saf geometrik özellik karşılaştırması — hiçbir öğrenmiş bileşeni yok.

---

## 7. Tasarım Niyeti vs Kullanıcı Senaryosu

`tr.json:2385`'teki uyarı mesajı tasarım amacını net ortaya koyuyor:

> "Daha doğru sonuç için katman/blok adı ile metin araması ya da geometrik şekil sorgusu (ör. **'8 gen havuz'**, **'5x10 m dikdörtgen oda'**) kullanın."

Yani modal şu kullanım için tasarlandı:

- Mimar bir oda / havuz / blok şeklini **kafasında** ya da **kâğıda kabaca** çizer
- Bu krokiyi tarar / fotoğraflar
- "Bana arşivde 8-gen havuzlu projeleri getir" tarzı bir filtre uygular

Kullanıcının senaryosu (ekran kaydından DWG bulma) **bu tasarım niyetinin dışında**. Tasarım tek-kontur, ölçek-invariant, manuel-kategori odaklı; senaryo ise multi-frame, zaman-temelli, çoklu-içerikli.

---

## 8. Mevcut Sistemde Aslında "Daha Yakın" Olan Alternatifler

Kullanıcı kod yazmadan, sistemde **şu anda var olan** araçlarla şu yollar denenebilir:

1. **Ekran kaydından kare yakala** (Snipping Tool / `Win+Shift+S`) → DWG ekranındaki belirgin tek bir oda/şekli kırp → "Şekil" modal'ına PNG olarak ver. Bu mevcut sınırlar içinde **çalışan** yol — ama hâlâ ölçek-invariant ve tek-kontur kısıtları geçerli, kesinlikle "tek doğru DWG"yi vermez, *aday liste* verir.
2. **Görsel benzerlik araması** (CLIP tabanlı `VisualSearchModal`) — yine PNG/JPG bekler, ama embedding tabanlı; teknik çizim için bile uyarısı var (`tr.json:2382-2386`).
3. **Metin araması** — DWG dosya adı / klasör yolu / layer veya blok adı ile arama. RAG sistemi (memory'de FAZ 1+2+3 tamamlanmış) "havuzlu konut" gibi semantik sorgu kabul eder.
4. **Özellik Ara sekmesi** — kullanıcı ekran kaydındaki şekli **gözle inceleyip** "8 kenarlı, 0.5+ düzgünlük, kategori HAVUZ" şeklinde manuel filtre uygulayabilir. Bu, modal'ın tasarımına en uygun kullanımdır.

---

## 9. Bu Senaryoyu Gerçekten Çalıştırmak İçin Ne Gerekir (Yüksek Düzeyde)

> Bu bölüm "yapılması gereken" değil, "neden mevcut yetersiz" sorusunun olumsuz tarafını tamamlıyor.

| Eksik bileşen | Açıklama | Tahmini efor |
|---|---|---|
| Video frame sampler | ffmpeg ya da Rust `mp4`/`gstreamer` ile her N saniyede 1 kare çıkarma | Orta — yeni Rust modülü + ffmpeg paketi |
| Frame içinden çoklu şekil çıkarma | Tek-kontur yerine **tüm kapalı konturlar** ve aralarında en bilgilendirici olanlar | Orta — `trace_largest_contour` yeniden yazılır |
| UI/CAD chrome maskeleme | Ekran kaydında AutoCAD pencere kenarı, paleti, status bar maskelemesi | Yüksek — CAD-versiyon-bağımlı sınır tespiti |
| Çoklu-frame agregasyonu | Aynı şeklin birden fazla frame'de görünmesi → güçlü skor | Orta |
| Zengin özellik vektörü | Geometrik feature + öğrenilmiş embedding (örn. CLIP görsel + skeleton/topology) | Yüksek — model entegrasyonu |
| Mutlak ölçü filtresi | Aspect ratio yetmez; ölçü etiketi / annotation parse edilmesi | Yüksek |

---

## 10. Özet Tablo

| Kriter | Mevcut Durum | Senaryo Gereksinimi | Karşılanıyor mu? |
|---|---|---|---|
| Girdi formatı | PNG/JPG/BMP/TIFF | MP4/WEBM/MOV ekran kaydı | ❌ |
| Frame extraction | Yok | Gerekli | ❌ |
| Şekil sayısı (görselden) | 1 (en büyük kontur) | Birden fazla şekil + UI gürültüsü | ❌ |
| Özellik vektörü | 4 boyutlu (vc, reg, ar, closed) | Yüksek-boyutlu / öğrenilmiş | ❌ |
| Mutlak ölçü desteği | Yok | DWG ile eşleşme için yararlı | ❌ |
| DWG önindeksleme | Var (taramada otomatik, ODA gerekli) | Önkoşul olarak bilmek lazım | ⚠️ Sadece tarama yapılmışsa |
| "Tek doğru DWG"yi tespit | Hayır — top-K aday listesi | Tek dosyaya kilitlenmek | ❌ |

**Genel sonuç:** Bu bölüm güzel bir geometrik benzerlik tarayıcısı (krokiden / tek görselden); fakat **ekran kaydından tek bir DWG dosyasını bulma** problemi için ne girdi tarafı ne algoritma tarafı yeterli. Yakın iş için en pratik geçici yol Bölüm 8'deki yaklaşım (ekran kaydından kare al, oda kırp, modal'a ver, **aday liste** olarak değerlendir).

---

*Rapor üretildi — kod değişikliği yok. İncelenen ana dosyalar: `src/components/ShapeSearchModal.tsx`, `src/services/dwgShapeIndex.ts`, `src-tauri/src/shape_match.rs`, `src-tauri/src/dxf_parse.rs:840-870`.*

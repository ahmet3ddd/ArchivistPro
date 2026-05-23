# "Şekil" Butonu — DWG Ekran Snapshot'ı (PrintScreen) ile DWG Bulma Senaryosu

**Tarih:** 2026-05-01
**Soru:** Üst bardaki "Şekil" butonu ile, AutoCAD ekranındaki bir DWG'nin bir bölümünün **statik snapshot'ını (PrintScreen / Snipping Tool ile alınmış PNG)** verip o DWG dosyasını arşivden buldurmak mümkün mü?
**Kapsam:** Yalnızca inceleme — kod değişikliği yapılmadı. (Önceki `SHAPE_SEARCH_VIDEO_INCELEMESI_2026-05-01.md` raporu video senaryosu içindi; bu ayrı bir senaryodur.)

---

## 1. Net Cevap

**Kısmen — koşula bağlı çalışır, ama "tek doğru DWG'yi otomatik getirir" garantisi vermez.**

| Durum | Cevap |
|---|---|
| Modal snapshot'ı kabul eder mi? | ✅ Evet — PNG/JPG/BMP/TIFF format zaten destekli |
| Snapshot işlenip eşleşme yapılır mı? | ✅ Evet — pipeline çalışır, sonuç döndürür |
| Spesifik tek bir DWG dosyası getirilir mi? | ⚠️ Hayır — top-K **aday liste** verir, kullanıcının seçmesi gerekir |
| Yararlı sonuç gelir mi? | 🔶 **Snapshot'ın nasıl kırpıldığına bağlı** — koşullu evet |

Yani senaryo **çalışır** ama "ekrandan kabaca bir alan kırpıp doğrudan dosyayı bulma" beklentisi karşılanmaz.

---

## 2. Snapshot Verince Ne Olur (Pipeline)

`ShapeSearchModal.tsx` → "Görsel Yükle" sekmesi → `extract_shape_from_image_bytes` (`shape_match.rs:372`):

1. **Decode:** `image::load_from_memory` PNG/JPG/BMP/TIFF'i decode eder. ✅
2. **Gri tonlama** + **Otsu threshold** ile binarize.
3. **Border tracing:** Görselde **en büyük kapalı konturu** bulur (`trace_largest_contour`, `shape_match.rs:58-126`). ⚠️ Burası kritik
4. **RDP simplification** ile vertex sayısını düşürür.
5. **Özellik çıkarımı:** vertex_count, regularity, aspect_ratio, area, perimeter.
6. **`searchShapesBySimilarity`** (`dwgShapeIndex.ts:221`): `dwg_shapes` tablosundan benzer şekilleri seçer, top 40 döner.

Sonuç: **40 aday DWG/DXF dosyası**, skor sırası ile dizilmiş kart grid'i.

---

## 3. Hangi Snapshot İşe Yarar, Hangisi Yaramaz

Bu en kritik bölüm. Snapshot'ın *içeriği* sonucu belirler:

| Snapshot içeriği | Beklenen davranış | Yararlı mı? |
|---|---|---|
| Tek bir kapalı oda, **etrafına AutoCAD UI / cursor / başka oda yok** | En büyük kontur = bu oda. Doğru özellik çıkarılır. | ✅ İyi — aday liste anlamlı |
| Tek bir havuz/blok, sıkıca kırpılmış, beyaz arka plan | En büyük kontur = havuz. Düzgünlük + vertex doğru. | ✅ Çok iyi — modal tam bunun için tasarlandı |
| Bina **tüm dış silueti** (zoom-out, sadece konturu) | Eğer DWG'de dış kontur kapalı polyline ise eşleşebilir | 🔶 Olası — DWG'de dış kontur **LINE**'larla çiziliyse `dwg_shapes` tablosunda yok (aşağıda açıklanıyor) |
| Birden fazla oda + duvarlar + mobilya | En büyük kontur büyük olasılıkla **bina dış konturu** olur, iç oda atlanır | 🔶 Şanslıysanız çalışır |
| AutoCAD pencere çerçevesi + paletler dahil ekran | En büyük kontur = AutoCAD penceresi. Tüm sonuçlar yanıltıcı. | ❌ Yararsız |
| Çok zoom-in, sadece duvar parçaları (kapalı şekil yok) | "En az 3 nokta gerekli" hatası veya "bbox=duvar parçası" → çöp özellik | ❌ Yararsız |
| Hatching/tarama dolu alan | Otsu threshold karışır, tarama çizgileri kontur olarak okunabilir | ❌ Yararsız |

**Net pratik kural:** Snapshot **tek, kapalı, izole bir geometrik şekli** içermeli — UI yok, başka odalar yok, hatching yok. Yani Snipping Tool ile sıkı bir kırpma şart.

---

## 4. Hâlâ Geçerli Olan 5 Engel

Video engeli (decode) düştü, ama altta yatan algoritmik kısıtlar değişmedi:

### 4.1. Sadece "EN BÜYÜK KAPALI" Kontur Alınır
`trace_largest_contour` (`shape_match.rs:119-122`) iç döngüsünde:

```rust
if contour.len() > best_contour.len() {
    best_contour = contour;
}
```

Görselde 10 kapalı şekil olsa, **9'u atılır**. Snapshot'taki spesifik bir oda değil, en büyüğü. Snapshot'ta hedef şekil = en büyük şekil olacak şekilde kırpılmalı.

### 4.2. Skor Sadece 4 Özellik Üzerinden — "Tek Doğru DWG" Verilemez
`dwgShapeIndex.ts:257`:

```
score = 0.40 * vertexSim + 0.30 * regularitySim + 0.20 * aspectRatioSim + 0.10
```

Arşivde 100 farklı projedeki **her 4-gen oda** vc=4, reg≈0.9, ar≈1.5 değerlerine yakın → hepsi yüksek skor alır. Snapshot'ınızdaki spesifik oda kesin tespit edilemez; **benzer odalı projeler listesi** gelir.

### 4.3. `dwg_shapes` Tablosu Sadece KAPALI Şekilleri Tutar
`dwgShapeIndex.ts:230` ve `:285` arama sorgularında:

```sql
WHERE is_closed = 1 AND vertex_count >= 3
```

DWG'lerde duvar genelde **LINE** (açık çizgi) ile çizilir, kapalı POLYLINE değil. Mimari bina dış konturu da çoğunlukla LINE'lardan oluşur. Bu durumda:

- DWG'nizdeki bina dış konturu kapalı LWPOLYLINE ise → tabloda var → snapshot eşleşebilir
- LINE'larla çiziliyse → tabloda yok → snapshot eşleşmez (sadece pencere/kapı/havuz gibi gerçek kapalı poligonlar eşleşir)

Pratikte bu, snapshot'ı havuz/oda gibi açıkça kapalı bir öğeye odaklamayı zorunlu kılıyor.

### 4.4. Ölçek-Invariant
`aspect_ratio` ve `regularity` ölçek-invariant; `area` ve `perimeter` tabloda var ama skor formülünde kullanılmıyor. Yani:

- 5 m × 3 m oda
- 50 m × 30 m salon

İkisi de vc=4, reg=0.9, ar=1.67 → **aynı skor**. Snapshot'tan ölçek bilgisi gelmez (raster pixel'i mm cinsinden bilmiyoruz).

### 4.5. DWG Ön-İndeksleme Önkoşulu
`dwg_shapes` tablosu **tarama sırasında otomatik dolar** (`fileScanner.ts` → `extract_dwg_shapes` / `extract_dxf_shapes`). Önkoşullar:

- DWG / DXF dosyaları **arşivde taranmış** olmalı (`scan` çalışmış olmalı)
- DWG için **ODA File Converter** kurulu olmalı (yoksa DWG'lerde shape index boş kalır)
- Arşivinizde DXF varsa onlar doğrudan parse edilir, ODA gerekmez

DWG'leriniz tarandıktan sonra `dwg_shapes` tablosunun dolu olduğunu Geliştirici Konsolu'ndan veya `clearAllDwgShapes` modalından doğrulayabilirsiniz.

---

## 5. Snapshot Nasıl Alınmalı (Pratik Rehber)

Modal'dan en yararlı sonucu almak için snapshot şu kuralları izlemeli:

| Yapılması | Yapılmaması |
|---|---|
| Snipping Tool / `Win+Shift+S` ile **tek bir kapalı şekli** kırp | Tüm AutoCAD penceresini ekran görüntüsüne dahil etme |
| Hedef şekil **görselin en büyük kapalı alanı** olsun | Birden fazla oda dahil etme — büyük olanı baskın çıkar |
| AutoCAD'de **arka planı beyaz** yap (model space, sade) | Siyah arka plan + renkli layer çizgileri Otsu'yu zorlar |
| **Hatching/taramayı kapat** (`HIDE` ya da layer kapatma) | Hatching çizgileri kontur olarak okunur, gürültü yapar |
| **Layer renklerini siyah/0 yap** (`CECOLOR=BYBLOCK` veya `LAYER`) | Çok renkli çizim threshold'u dengesizleştirir |
| Kotalar / yazıları gizle | Yazı çevresi konturu en büyük kontur olarak çıkabilir |
| Düz ortografik bakış (Top view) | Perspective view'da kontur deforme olur |
| Sıkı kırp — şeklin dışında 5-10 px'ten fazla beyaz boşluk olmasın | Geniş boşluk performansı düşürür ve kontur kararlılığını etkilemez ama gerek yok |

**Tipik iyi snapshot:** AutoCAD model space → "tek havuz" zoom → `LAYISO` ile sadece HAVUZ layer'ı bırak → `Win+Shift+S` ile havuzu kırp → modal'a sürükle.

---

## 6. Beklenen Sonuç Senaryoları (Üç Örnek)

### Senaryo A — "Sıkı kırpılmış 8-gen havuz snapshot'ı"
- Modal snapshot'ı işler → vertex_count=8, regularity≈0.92, aspect_ratio≈1.0
- `searchShapesBySimilarity` HAVUZ kategorisindeki 8-gen havuzları skor sırasıyla döndürür
- Arşivde 8-gen havuzu olan **tüm** projeler aday listede
- Kullanıcı liste içinde dosya adından / klasör yolundan / önizleme thumb'ından doğru DWG'yi gözle seçer
- ✅ **Çalışır** — tasarım hedefi bu

### Senaryo B — "Bina iç planı snapshot'ı (3-4 oda görünür)"
- Pipeline en büyük konturu seçer = büyük olasılıkla **bina dış konturu**
- Eğer dış kontur DWG'de kapalı polyline ise → eşleşme olabilir, ama dış kontur "dikdörtgen mimari plan" benzersiz değil → onlarca aday
- Eğer dış kontur LINE'larla çizilmişse → en büyük kontur **iç odalardan biri** olur, hangisi olduğu belirsiz
- 🔶 **Şanslıysanız çalışır**, çoğu zaman aday liste anlamsız geniş

### Senaryo C — "AutoCAD ekran görüntüsü (pencere çerçevesi dahil)"
- En büyük kontur = AutoCAD pencere çerçevesi (bir dikdörtgen)
- vc=4, reg≈0.95, ar=ekran_eni/ekran_boyu
- `searchShapesBySimilarity` → arşivdeki tüm 4-gen kapalı şekiller, skor sırası neredeyse rastgele
- ❌ **İşe yaramaz** — kullanıcı "neden hep alakasız sonuçlar?" diye sorar

---

## 7. "Tek Doğru DWG'yi Getir" Tasarım Hedefi miydi?

Hayır. `tr.json:2389` modalın başlığı:

> **"Geometrik Şekil Arama"**

Tasarım niyeti: "Bu **şekle benzer geometriler** içeren DWG'leri **listele**". `searchShapesBySimilarity` zaten `topK = 40` ile çalışıyor (`ShapeSearchModal.tsx:108`). Tek dosyayı kilitleme yoktu, asla planlanmadı.

Bu yüzden senaryonuz "**snapshot'ı verince doğrudan o DWG açılsın**" ise modal **bu işi yapmaz**, çünkü:

- Algoritma top-K döner
- Top-1 bile birçok DWG arasında dar bir farkla seçilir (4 boyutlu skor)
- Kullanıcı aksiyonu (gözle seç → tıkla → asset'e git) gerekiyor — bu zaten modalın UX'i

---

## 8. Mevcut Sistemin Diğer Arama Yolları (Hızlı Tarama)

Snapshot ile DWG bulma senaryosu için "Şekil" butonunu **bırakıp** sistemin geri kalanına bakıldığında:

1. **VisualSearchModal "Görsel Ara — Metinden"** (`src/components/VisualSearchModal.tsx`)
   - **Yanıltıcı isim:** Sadece **metin sorgusu** alır (input type=text); görsel/snapshot girdisi **yok**.
   - CLIP text → image yapar — sorgu Türkçe ise Ollama ile İngilizceye çevrilir, sonra `searchImagesByText` (`visualSearch.ts:78`).
   - Bu modal snapshot senaryosu için **kullanılamaz**.
2. **Klasik metin araması** (Sidebar üst arama kutusu)
   - DWG dosya adı, klasör, layer adı, blok adı, RAG semantic sorgu.
   - Snapshot girdisi yok — kullanıcı "havuzlu konut" tarzı sorgu yazar.
3. **Chat panel `/görsel <metin>` slash** (`ChatInput.tsx:24`)
   - Yine **metin** girdisi, CLIP text → image yapar.
   - Snapshot girdisi yok.
4. **DuplicateFinderModal**
   - Asset listesindeki dosyalar arasında birbirine benzer olanları bulur — **dış görsel girdisi kabul etmez**.
   - Senaryoya uymuyor.
5. **"Şekil" modalının 2. sekmesi (Özellik Ara)**
   - Snapshot'a gözle bakıp manuel parametre girme — yine kapalı şekil + 4 özellik.
6. **Sidebar üst arama kutusunda "Görsel Arama" ikonu** ⭐
   - Aşağıda detaylı.

---

## 9. Özet Tablo ("Şekil" Modalı Snapshot Senaryosu)

| Kriter | Snapshot ile Durum |
|---|---|
| Modal snapshot'ı kabul ediyor mu? | ✅ Evet |
| Pipeline çalışır mı? | ✅ Evet |
| Tek-kontur kuralı snapshot'ta sorun mu? | ⚠️ Snapshot'ın kırpma kalitesine bağlı |
| `dwg_shapes` tablosu LINE'ları içeriyor mu? | ❌ Hayır — sadece kapalı şekiller (`is_closed=1`) |
| Skor formülü tek dosyayı izole edebilir mi? | ❌ Hayır — 4 boyutlu, `aday liste` üretir |
| Ölçek-invariant mı? | ⚠️ Evet — 5m vs 50m oda aynı skor |
| Ön-indeksleme önkoşulu? | ⚠️ DWG taranmış olmalı, ODA File Converter kurulu olmalı |
| Pratik kullanım | ✅ Tek kapalı şekli (havuz/oda/blok) sıkı kırp → aday liste değerlendir |
| "Snapshot ver, DWG açılsın" tek-tıklı senaryo | ❌ Tasarımda yok, algoritmada da garanti edilemez |

**Şekil Modalı için özet:** Snapshot **modal'a verilebilir, çalışır, sonuç döner**. Ama dikkatli kırpma kullanıcıda, hedef şekil kapalı olmalı, sonuç tek dosya değil aday liste, DWG bina dış kontur LINE'larla çizilmişse eşleşmez. Bu kısıtlar kabul edilebilirse modal senaryoyu **kısmen** karşılıyor. **Ancak sistemde aynı senaryo için tasarlanmış daha güçlü bir özellik var** (Bölüm 10).

---

## 10. Snapshot Senaryosu için Programdaki Doğru Arama Özelliği — Sidebar "Görsel Arama" İkonu (ImagePlus) ⭐

Snapshot ile DWG bulma için sistemin gerçek aracı **bu**, "Şekil" butonu değil.

### 10.1. Yer ve Açılış
- **Konum:** Sidebar (sol panel) üst arama kutusunun yanında küçük "ImagePlus" ikonu.
- **Kod:** `src/components/Sidebar.tsx:552-575` — gizli bir `<input type="file" accept="image/*">` ve trigger butonu.
- **Tooltip:** `t('sidebar.tooltip.imageSearch')` ("görsel ile arama" benzeri).

### 10.2. Pipeline (`src/hooks/useImageSearch.ts:88-353`)

1. Kullanıcı snapshot dosyasını seçer.
2. `generateImageEmbeddingsMulti(file)` ile snapshot'tan **5 crop CLIP image embedding** üretilir (`embeddings.ts:420-446` — `image_global`, `image_center`, 4 köşe).
3. `getEmbeddingsBySourcePrefix('image_')` ile arşivdeki **tüm asset'lerin** (DWG dahil) CLIP image embedding'leri çekilir (`useImageSearch.ts:122`).
4. Snapshot vektörleri ile asset vektörleri arasında **aynı kaynak (source) eşleşmeli cosine similarity** — her asset için en iyi crop skoru tutulur (`useImageSearch.ts:128-147`).
5. Top 100 CLIP adayının **pHash hamming distance** hesaplanır (`computeImagePhashFromFile` + `getAssetPhashMap`, `useImageSearch.ts:165-179`).
6. **Birleşik skor** (`useImageSearch.ts:182`):
   ```
   final = 0.60 * CLIP_norm + 0.30 * pHash_norm + 0.10 * cropBoost
   ```
7. **Identity bypass:** `hd ≤ 4` ise final skor 0.995'e zorlanır (`useImageSearch.ts:183`) — birebir aynı görsel kesin yakalanır.
8. Top 50 sonuç `semanticResults`'a yazılır → asset grid'i sonuçlarla doluşur.

### 10.3. DWG Neden Bu Akışta Yer Alıyor

DWG'lerin CLIP image embedding tablosunda kaydı olması iki şarta bağlı:

1. **AutoCAD'in DWG dosyasına gömdüğü thumbnail** — `src-tauri/src/thumbnails.rs:213-420` `get_dwg_thumbnail` komutu, R2000+ DWG formatındaki gömülü BMP/PNG önizlemeyi çıkarır (brute-force fallback dahil).
2. **Tarama sırasında embedding üretimi** — `fileScanner.ts:2307` `generateImageEmbeddingsMulti(asset.thumbnailUrl)` ile thumbnail CLIP'e verilir; `fileScanner.ts:1977` ile pHash hesaplanır.

Yani **arşiv tarandığında DWG'lerin de `image_*` embedding satırları ve `phash` değerleri var** — snapshot ile aynı vektör uzayında karşılaştırılabiliyorlar. **`dwg_shapes` tablosundan bağımsız bir altyapı.**

### 10.4. "Şekil" vs "Sidebar Görsel Arama" — Aynı Senaryo, Farklı Sonuç

| Boyut | "Şekil" Modalı | Sidebar Görsel Arama |
|---|---|---|
| Sinyal kaynağı | Tek kontur, 4 geometrik özellik | CLIP image-to-image (öğrenilmiş 512-dim) + pHash + 5 crop |
| Snapshot içeriği | Tek izole kapalı şekil olmalı | Plan/oda/render/proje görseli — kompozisyon serbest |
| Arka plan / UI gürültüsü | Kontur'u bozar | CLIP semantic — bir miktar tolerans |
| Ölçek hassasiyeti | Invariant (1m vs 100m aynı) | CLIP zaten invariant; ama görsel-bağlamla daraltır |
| Identity (birebir snapshot) | Hayır | ✅ pHash `hd ≤ 4` bypass ile evet |
| DWG ön-koşul | ODA File Converter + DXF parse + `dwg_shapes` dolu | Sadece DWG gömülü thumbnail (ODA'sız) |
| LINE'larla çizilmiş bina | ❌ tabloda yok | ✅ Thumbnail görsel olarak içeriyor |
| "Tek doğru DWG" tespit | Top-K aday | Top-K aday — ama identity match daha mümkün |

Sidebar görsel arama; **CLIP + pHash birleşimi** sayesinde hem semantic hem identity tarafından sinyal toplar. "Şekil" modalı yalnızca geometrik bir alt-küme.

### 10.5. Sidebar Görsel Arama İçin Önkoşullar

| Önkoşul | Detay | Yokluk durumu |
|---|---|---|
| AI hazır | `embeddingStatus.isReady === true` | "imageSearch.enableAiFirst" uyarısı |
| CLIP vision açık | `aiConfig.enableClipVision === true` | Ollama/keyword fallback'e düşer (`useImageSearch.ts:217+`) |
| Provider yapılandırıldı | Ollama URL veya API key | "noOllamaUrl" / "noApiKey" uyarısı |
| Arşiv taranmış | `embeddings` tablosunda `image_*` satırlar | "noClipMap" uyarısı |
| DWG'de gömülü thumbnail | AutoCAD R2000+ kaydı, dosya ≤ 100MB | DWG embedding tablosunda yok → eşleşmez |

### 10.6. Sınırlar (Sidebar Görsel Arama için)

- **DWG thumbnail = AutoCAD'in son kayıt anındaki görünüm.** Kullanıcı snapshot'ı farklı zoom/pan/layer'da çektiyse CLIP düşük skor döndürebilir.
- **AutoCAD UI dahil snapshot** → CLIP arka planı da öğrenir, gürültü yapar; sıkı kırpma yine yararlı (ama "Şekil"e göre çok daha tolere edilebilir).
- **Dosya ≥ 100MB DWG → thumbnail atlanmıştır** (`thumbnails.rs:234`); bu DWG'ler hiçbir embedding aramasında çıkmaz.
- **pHash identity bypass** (hd ≤ 4) genelde devreye girmez — DWG thumbnail'i ile snapshot pixel-perfect aynı olmaz; ama yine de gerçek sinyal CLIP'ten gelir.
- Sonuç yine **top-K aday liste**; "tek doğru DWG'yi otomatik aç" yine yok. Ama liste **çok daha küçük ve isabetli** olur.

---

## 11. Birleşik Sonuç (Tüm Arama Yollarına Karşı Snapshot Senaryosu)

| Arama Yolu | Girdi | Algoritma | Snapshot→DWG için |
|---|---|---|---|
| Üst bar **"Şekil"** modalı | Görsel | Tek kontur + 4 geometrik özellik | 🔶 Sınırlı; sıkı kırpılmış tek kapalı şekil için |
| **VisualSearchModal "Görsel Ara"** | **Sadece metin** | CLIP text→image | ❌ Snapshot kabul etmez |
| **Sidebar görsel arama ikonu** ⭐ | Görsel | CLIP image-to-image (5 crop) + pHash + cropBoost | ✅ **En uygun yol** |
| Klasik metin araması | Metin | Keyword + RAG | 🔶 Snapshot'tan dönüştürmek lazım |
| Chat `/görsel <metin>` | Metin | CLIP text→image | ❌ Snapshot girdisi yok |
| DuplicateFinderModal | Asset listesi | pHash + structural | ❌ Dış girdi kabul etmez |
| Şekil modalının "Özellik Ara" sekmesi | Manuel parametreler | SQL filtresi | 🔶 Snapshot'a gözle bakıp parametre giriliyor |

**Net karar:** Senaryo için doğru özellik **Sidebar arama kutusunun yanındaki "ImagePlus" görsel arama ikonu**. Üst bardaki "Şekil" butonu da çalışır ama:

- Sadece tek izole kapalı şekiller için
- ODA File Converter + tarama-zamanı DXF parse önkoşullu
- Sinyal düşük-boyutlu

Sidebar görsel arama:

- Hem CLIP semantic hem pHash identity sinyali
- DWG için ODA gerektirmez (AutoCAD gömülü thumbnail yeter)
- LINE-only DWG'ler bile thumbnail varsa eşleşmeye girer
- 5 crop sayesinde kompozisyon farklılığı tolere edilir

İki özellik birbirinin yerini tutmaz; **ikisi farklı sorulara cevap verir** ("şu geometrik şekle benzer şekiller hangileri" vs "bu görüntüye benzer dosyalar hangileri"). Ekran snapshot'ı senaryosu **görsel benzerlik** sorusudur, geometrik benzerlik değil — bu yüzden Sidebar yolu doğru cevap.

---

*Rapor güncellendi — kod değişikliği yok. İncelenen ek dosyalar: `src/components/Sidebar.tsx:552-575`, `src/hooks/useImageSearch.ts`, `src/services/visualSearch.ts`, `src/services/embeddings.ts:60-65,420-446`, `src-tauri/src/thumbnails.rs:213-420`, `src/components/VisualSearchModal.tsx`, `src/components/DuplicateFinderModal.tsx`. İlgili önceki rapor (video senaryosu): `docs/SHAPE_SEARCH_VIDEO_INCELEMESI_2026-05-01.md`.*

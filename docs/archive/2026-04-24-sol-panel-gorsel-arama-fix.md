# Sol panel — görsel arama fix'leri (2026-04-24)

Bu doc, sol panel görsel arama akışında bulunan ve çözülen 3 sorunu belgeler.
**Amaç**: aynı sorun tekrar çıkarsa (regression) kök neden ve çözüm yerleri hızlı bulunsun.

---

## Sorun 1 — Görsel arama bitince arama kutusuna kelimeler yazılıyor

### Belirti
Kullanıcı sol paneldeki görsel arama butonu ile bir görseli arattığında,
arama bittikten hemen sonra arama kutusuna kelimeler (örn. "basketbol, saha, mimari")
yazılıyordu ve **visual sonuçlar bozuluyordu** (çünkü metin semantic araması
devreye girip visual sonuçların üstüne yazıyordu).

### Kök neden
`searchQuery` hem kullanıcı metin girişi hem de **"visual vector mode" sentinel
marker'ı** olarak çift görev yapıyordu. CLIP başarılı olduğunda
`setSearchQuery("🔍 Görsel Sonuçlar (CLIP + pHash)")`, CLIP yoksa/başarısızsa
**fallback keyword path**'i `setSearchQuery(cleanKeywords)` çağırıyordu.

Fallback'te keywords arama kutusuna düştüğü an `useEmbeddingSearch` effect'i
tetikleniyor, text semantic araması başlıyor, `semanticResults` visual
verilerle ilgisi olmayan metin eşleşmeleriyle **eziliyordu**.

### Çözüm
- **Yeni store bayrağı**: `imageSearchActive: boolean` — visual sonuçlar
  ekrandayken true kalır. `searchQuery` artık sentinel görevi görmüyor.
- Her iki yol da (CLIP + fallback) artık:
  1. `searchQuery = ''` (arama kutusunu kirletme)
  2. `imageSearchActive = true`
  3. `semanticResults` doldurulmuş olarak kalır
- **Fallback path** artık keywords'leri arama kutusuna yazmak yerine,
  `buildFullSearchableText` + `computeKeywordScore` ile **allAssets'a karşı
  skorlama yapıp** direkt `semanticResults`'a yazıyor. Kullanıcı bunu
  visual sonuç olarak görüyor.
- **Kritik guard**: `useEmbeddingSearch` effect'inde `isImageSearching ||
  isVisualVectorQuery` kontrolü ÖN'e alındı. Eskiden boş searchQuery
  `setSemanticResults(null)` çağırıyordu — bu bizim visual sonuçlarımızı
  silerdi. Artık guard önce çalışıyor, visual mod aktifken semanticResults'a
  dokunulmuyor.
- **Auto-clear effect** (App.tsx): kullanıcı arama kutusuna metin yazarsa
  `imageSearchActive=false` otomatik olarak iner → metin araması devralır.

---

## Sorun 2 — Hassasiyet slider'ı kayboluyor

### Belirti
Görsel arama bittiği anda sağ/sol paneldeki hassasiyet slider'ı kayboluyordu.
Kullanıcı sonuçları filtrelemek için slider'ı oynatamıyordu.

### Kök neden
`showSensitivityControl` prop'u `Boolean(enableClipVision || isImageSearching)`
olarak hesaplanıyordu. `isImageSearching` arama tamamlanınca `false`'a dönüyor,
slider kayboluyordu.

### Çözüm
`showSensitivityControl = Boolean(enableClipVision || isImageSearching ||
imageSearchActive)` — yeni bayrak ile sonuçlar ekrandayken slider kalıcı.

---

## Sorun 3 — "Tainted canvas" hatası

### Belirti
```
Görsel Embedding hatası: saha2.jpg — Tüm kırpımlar başarısız —
image_global: Failed to execute 'toBlob' on 'HTMLCanvasElement':
Tainted canvases may not be exported.
```

### Kök neden
`loadImageToCanvas` akışı:
1. `URL.createObjectURL(file)` → `blob:` URL
2. `new Image()` + `.src = blobUrl` → yükle
3. `ctx.drawImage(img, ...)` → canvas

Normalde `blob:` URL'ler same-origin sayılır ve canvas'ı tainted yapmaz.
Ama Tauri WebView2'de bazen (muhtemelen CSP / custom protocol handler
etkileşimi) canvas tainted olarak işaretleniyor. Sonraki `canvas.toBlob()`
çağrısı `SecurityError` fırlatıyor.

### Çözüm
`loadImageToCanvas` artık önce **`createImageBitmap(blob)`** deniyor — bu
browser primitive'i Blob'u doğrudan decode eder, `<img>` + blob URL aşamasını
atlar, tainting oluşmaz. Başarısız olursa eski `<img>` path'i fallback
olarak kalıyor, `crossOrigin='anonymous'` defansif olarak set ediliyor.

---

## Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/store/useStore.ts` | `imageSearchActive` bayrağı + setter |
| `src/hooks/useImageSearch.ts` | Fallback keyword → semanticResults; searchQuery temiz; allAssets param; cancelImageSearch state temizliği |
| `src/hooks/useEmbeddingSearch.ts` | Visual-mode guard öne alındı; `imageSearchActive` OR'landı |
| `src/App.tsx` | allAssets pass; auto-clear effect (searchQuery dolarsa imageSearchActive=false); showSensitivityControl yeni bayrağı içeriyor |
| `src/services/embeddings.ts` | `createImageBitmap` öncelikli loader + fallback |
| `src/i18n/locales/*.json` | `imageSearch.noMatches` eklendi (5 dil) |

---

## Regression'a karşı görev listesi

Tekrar bozulursa bakılacak noktalar (en sık kırılma sırasıyla):

1. **Slider kayboluyor mu?** → `App.tsx:407` `showSensitivityControl` — 3 koşul OR
   (`enableClipVision || isImageSearching || imageSearchActive`). Son koşul
   düşürülmesin.

2. **Keywords arama kutusunda mı?** → `useImageSearch.ts` içinde hiçbir yerde
   `setSearchQuery(cleanKeywords)` veya `setSearchQuery(<i18n label>)` olmamalı.
   Sadece `setSearchQuery('')` çağrıları olmalı.

3. **Visual sonuçlar aniden siliniyor mu?** → `useEmbeddingSearch.ts:63-70`
   effect başındaki `if (isImageSearching || isVisualVectorQuery) return;`
   guard'ı **bütün setSemanticResults(null) çağrılarından ÖNCE** olmalı.

4. **Metin yazınca görsel mod inmez mi?** → `App.tsx` auto-clear effect
   (`ui.searchQuery.trim().length > 0` → `setImageSearchActive(false)`).

5. **X / ESC ile temizlenmiyor mu?** → `useImageSearch.ts` içinde
   `cancelImageSearch` setImageSearchActive(false) + setSemanticResults(null)
   + setSearchQuery('') üçünü birden yapmalı.

6. **Tainted canvas hatası geri geldi mi?** → `embeddings.ts` içinde
   `loadImageToCanvas` — önce `createImageBitmap` deneniyor olmalı.

---

## Test senaryoları (regresyon testi)

1. Sol panel → görsel arama butonu → saha2.jpg seç
   - ✅ Arama kutusu BOŞ kalmalı
   - ✅ Hassasiyet slider GÖRÜNÜR olmalı
   - ✅ Benzer görseller listelenmeli

2. Slider'ı oynat
   - ✅ Sonuç sayısı değişmeli (threshold etkisi)

3. X butonu bas
   - ✅ Görsel chip gitmeli, tüm assetler görünmeli, slider gitmeli (CLIP
     kapalıysa)

4. Arama kutusuna "mutfak" yaz
   - ✅ Görsel sonuçlar otomatik kaybolmalı, metin araması devralmalı

5. ESC tuşu
   - ✅ `clearAllSearch` tetiklenmeli, tüm arama state sıfırlanmalı

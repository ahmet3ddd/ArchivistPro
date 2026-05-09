# Arama Sistemi Teknik Referansı

> **Amac:** Bu belge, ArchivistPro sol panel arama sisteminin tam teknik blueprinti'dir.
> Baska bir gelistirici (veya AI asistan) bu belgeyi okuyarak **ayni kalitede** bir arama sistemi
> uretebilmelidir. Her karar, formul ve esik degeri aciklanmistir.
>
> **Son guncelleme:** 2026-04-25 · **Referans versiyon:** v2.3.0
> **Ilgili dosyalar:** asagida her baslikta listelenmistir.

---

## Icerik

1. [Mimari Genel Bakis](#1-mimari-genel-bakis)
2. [Metin Arama Pipeline](#2-metin-arama-pipeline)
3. [Gorsel Arama Pipeline](#3-gorsel-arama-pipeline)
4. [Sekil (Shape) Arama](#4-sekil-shape-arama)
5. [Hibrit Skorlama Formulleri](#5-hibrit-skorlama-formulleri)
6. [Query Expansion (Sorgu Genisletme)](#6-query-expansion-sorgu-genisletme)
7. [Arama Gecmisi & Kayitli Aramalar](#7-arama-gecmisi--kayitli-aramalar)
8. [Cache Stratejisi & Performans](#8-cache-stratejisi--performans)
9. [UI/UX Kaliplari](#9-uiux-kaliplari)
10. [Hata Yonetimi & Edge Case'ler](#10-hata-yonetimi--edge-caseler)
11. [Dosya Haritasi](#11-dosya-haritasi)
12. [Yeniden Uretim Kontrol Listesi](#12-yeniden-uretim-kontrol-listesi)

---

## 1. Mimari Genel Bakis

### Veri Akis Diyagrami

```
Kullanici Giris
    |
    +-- [Metin Arama] -----> Sidebar input
    |                          |
    |                          +-- setSearchQuery(q) --> Store
    |                          |
    |                          +-- useEmbeddingSearch (400ms debounce)
    |                          |     |
    |                          |     +-- expandQuery(q) --> genisletilmis sorgu
    |                          |     +-- generateEmbedding(expanded) --> 384-dim vektor
    |                          |     +-- getCachedEmbeddings() --> tum chunk vektorleri
    |                          |     +-- cosineSimilarity() her chunk icin
    |                          |     +-- threshold filtre (sensitivity-based)
    |                          |     +-- per-asset best score
    |                          |     +-- keyword fallback (LIKE arama, skor=0.62)
    |                          |     +-- setSemanticResults(top-50)
    |                          |
    |                          +-- useHybridFilteredAssets (useMemo, aninda)
    |                                |
    |                                +-- filterAssetsHybrid()
    |                                |     +-- Root folder filtre (prefix match)
    |                                |     +-- Tag filtre (OR mantigi)
    |                                |     +-- Facet filtre (AND mantigi)
    |                                |     +-- Keyword skor (turkishLower, word boundary)
    |                                |     +-- Semantic skor (semanticResults'tan)
    |                                |     +-- Hibrit final skor (olasilik OR)
    |                                |     +-- Siralama: finalScore desc
    |                                |
    |                                +-- buildSearchScoreMap()
    |                                +-- collectMatchSources()
    |
    +-- [Gorsel Arama] -----> Sidebar image button
    |                          |
    |                          +-- useImageSearch
    |                                |
    |                                +-- CLIP path (enableClipVision=true):
    |                                |     +-- toDecodableSrc(file) (TIF/TGA donusumu)
    |                                |     +-- generateImageEmbeddingsMulti(file) --> 5 crop, 512-dim
    |                                |     +-- getEmbeddingsBySourcePrefix('image_')
    |                                |     +-- cosineSimilarity() per crop x per DB vektor
    |                                |     +-- pHash reranking
    |                                |     +-- Score fusion: CLIP 60% + pHash 30% + cropBoost 10%
    |                                |     +-- setSemanticResults(top-50)
    |                                |
    |                                +-- Ollama fallback (CLIP yok):
    |                                      +-- analyzeImage(file, aiConfig)
    |                                      +-- keywords --> Turkce dict ceviri
    |                                      +-- setSearchQuery(keywords)
    |
    +-- [Sekil Arama] ------> ShapeSearchModal
                               |
                               +-- Image tab: drag&drop --> Rust kontur cikarma
                               +-- Criteria tab: vertex/regularity/layer filtre
```

### Katmanli Arama Mimarisi

Sistem **4 bagimsiz arama kanali** kullanir ve bunlari **RRF (Reciprocal Rank Fusion)** veya
**olasilik OR** ile birlestirir:

| Kanal | Kaynak | Boyut | Hiz | Dosya |
|---|---|---|---|---|
| **Keyword** | Asset metadata (filename, tags, DWG props, vb.) | N/A | <1ms | `searchScoring.ts` |
| **Semantic** | MiniLM-L12-v2 chunk embeddings | 384-dim | ~50-200ms | `useEmbeddingSearch.ts` |
| **FTS5 Keyword** | SQLite FTS5 text chunks | N/A | <1ms | `ragService.ts` |
| **CLIP Visual** | CLIP vit-base-patch32 image embeddings | 512-dim | ~100-500ms | `useImageSearch.ts` |

---

## 2. Metin Arama Pipeline

### 2.1 Arama Inputu

**Dosya:** `src/components/Sidebar.tsx` (satir 419-547)

```typescript
// Temel ozellikler:
// - Placeholder: embeddingReady'ye gore dinamik (semantik / metin)
// - Min 3 karakter ipucu (uyari gosterir ama aramaya engel degil)
// - Enter: arama gecmisine kaydet
// - Escape: sorguyu sifirla
// - Debounce: Sidebar'da yok (aninda setSearchQuery), debounce hook'ta
```

**Tasarim karari:** Input aninda `setSearchQuery()` cagiriyor. Keyword filtreleme `useMemo` ile
senkron calistigindan aninda sonuc veriyor. Semantic sonuclar 400ms debounce ile geliyor ve
listeyi refine ediyor. Bu **progressive enhancement** yaklasimidir — kullanici hemen keyword
sonuclarini gorur, semantic sonuclar arkasindan gelir.

### 2.2 Searchable Text Olusturma

**Dosya:** `src/utils/searchScoring.ts` — `buildFullSearchableText()`

Her asset icin aramayla karsilastirilacak **tek bir metin** uretilir. Bu metnin icerigi:

```
Genel:      fileName, projectName, category, materialGroup, colorTheme,
            architecturalStyle, omniclassCode, fileType, projectPhase
AI:         aiTags[].label
Katmanlar:  metadata.layers, metadata.roomNames, metadata.materialList
DWG:        dwgLayers, dwgBlockNames, dwgTextContents, dwgXrefNames,
            dwgProperties.{title,subject,keywords,author},
            dwgEstimatedScale, dwgUnitType, dwgDrawingType, dwgDescription,
            dwgElements, dwgSpaces, dwgKeywords, dwgDomainTerms
RVT:        rvtVersion, rvtProjectName, rvtFormat, rvtStoreyNames
IFC:        ifcSchema, ifcOriginatingSystem, ifcProjectName,
            ifcBuildingName, ifcStoreyNames
MAX:        maxLayers, maxObjects
3DS MAX:    metadata.maxVersion, metadata.skpVersion
Render:     renderEngine, renderSoftware, cameraInfo
Kullanici:  userTags[].name, clientName, approvalStatus, versionLabel, deadline
```

**Islem:** Tum degerler `filter(Boolean).join(' ')` ile birlestirildikten sonra `turkishLower()`
ile kucuk harfe cevrilir.

**Cache:** `WeakMap<Asset, string>` — ayni Asset nesnesi icin tekrar hesaplama olmaz.
GC-friendly: Asset garbage collect edilince cache entry de gider.

### 2.3 Turkce-Guvenli Lowercase

**Dosya:** `src/utils/searchScoring.ts` — `turkishLower()`

WebView2'de `toLocaleLowerCase('tr')` platform bagimli olabilir. Manuel donusum:

```typescript
const TR_UPPER = 'IISGUOC';   // I, I, S, G, U, O, C (Turkce ozel)
const TR_LOWER = 'iisguoc';   // i, i, s, g, u, o, c
// Her karakter tek tek kontrol, idx bulunursa karsiligini yaz
```

**KRITIK:** Bu fonksiyon **tum** metin karsilastirmalarinda kullanilir — hem searchable text
hem query hem de expansion sonuclari.

### 2.4 Keyword Skorlama

**Dosya:** `src/utils/searchScoring.ts` — `computeKeywordScore()`

```
Girdi: searchText (lowercase), query (orijinal)
Cikti: [0, 1] arasi skor

Adimlar:
1. Query'yi turkishLower() ile kucult
2. Bosluk/noktalama ile split, 2 karakterden kisa kelimeleri at
3. Tekrarlari kaldir (Set)
4. Her kelime icin:
   a. searchText.includes(word) → matchCount++
   b. Word boundary regex testi → exactBonus += 0.2
5. maxExpectedMatches = min(queryWords.length, 3)
6. baseScore = matchCount / maxExpectedMatches
7. return min(1, baseScore + exactBonus)
```

**Word boundary regex:**
```
Pattern: (^|[\s,;._\-/])KELIME([\s,;._\-/]|$)
Ornek: "cam" kelimesi "camilerin" icinde eslesmez, "cam kapı" icinde eslesir
```

**Regex cache:** `Map<string, RegExp>` — max 500 giris, doldugunda toptan temizlenir.

### 2.5 Semantic Arama (Embedding)

**Dosya:** `src/hooks/useEmbeddingSearch.ts`

```
Tetiklenme: searchQuery degistiginde (useEffect)
Onkosul: embeddingStatus.isReady === true, query bos degil, gorsel sorgu degil
Debounce: TIMINGS.EMBEDDING_SEARCH_DEBOUNCE_MS (400ms)

Adimlar:
1. expandQuery(searchQuery) — domain sozlugu ile genislet
2. generateEmbedding(expanded) — MiniLM 384-dim vektor
3. getCachedEmbeddings() — DB'den text + OCR chunk embedding'leri (cache'li)
4. Her chunk icin cosineSimilarity(queryVec, chunkVec)
5. score < threshold → atla
6. Per-asset best: ayni asset'in en yuksek skorlu chunk'i
7. Keyword fallback: searchTextChunksByKeyword(searchQuery)
   — LIKE arama, skor = 0.62 (sabit)
   — Sadece semantic'in kapsamadigi asset'lere eklenir
8. Sonuclari skora gore sirala, top-50 al
9. setSemanticResults(results)
```

**Model:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- 384 boyut, 50+ dil destegi (Turkce dahil)
- Offline paketlenmis (`/models/` dizini)

### 2.6 Hibrit Filtreleme & Siralama

**Dosya:** `src/utils/searchScoring.ts` — `filterAssetsHybrid()`

```
Girdi: allAssets, activeFilters, searchQuery, semanticResults,
       isImageSearching, searchSensitivity, isVisualVectorQuery,
       activeRootFilters, activeTagFilters

Filtre sirasi (sirali, her adim listeyi daraltir):
1. Root folder filtre: a.filePath.startsWith(rootPath) (prefix match)
2. Tag filtre: OR mantigi — asset en az 1 secili tag tasiyor mu
3. Facet filtre: AND mantigi — her facet key icin secilenlerden biri
4. Gorsel sorgu ise: CLIP skorlariyla filtrele (ayri threshold)
5. Metin sorgusu ise:
   a. Her asset icin buildFullSearchableText()
   b. computeKeywordScore(searchText, expandedQuery)
   c. semanticResults'tan semantic skor
   d. computeHybridFinalScore(kwScore, semScore, threshold)
   e. Filtre: kwScore > 0 VEYA semScore >= threshold
   f. Siralama: finalScore azalan
```

---

## 3. Gorsel Arama Pipeline

### 3.1 CLIP Arama Yolu

**Dosya:** `src/hooks/useImageSearch.ts`

```
Onkosul: aiConfig.enableClipVision === true

1. toDecodableSrc(file):
   - TIF/TIFF/TGA dosyalari → Rust thumbnail komutu → JPEG base64
   - Diger formatlar → olduGu gibi File nesnesi

2. generateImageEmbeddingsMulti(file):
   - 5 crop bolge: global, center, top-left, top-right, bottom-left
   - Her biri 512-dim CLIP image embedding
   - Model: Xenova/clip-vit-base-patch32

3. DB'den gorsel embedding'leri:
   - Oncelik: getEmbeddingsBySourcePrefix('image_') (multi-crop index)
   - Fallback: getAllEmbeddings('image') (eski tek-gorsel index)
   - Eski index uyarisi: legacyIndexNoticeShownRef ile bir kez goster

4. Eslesme hesabi:
   - Her query crop X her DB crop → cosineSimilarity
   - Per-asset best score + hitCount (kac crop eslesti)

5. pHash reranking:
   - computeImagePhashFromFile(file) → query pHash
   - getAssetPhashMap() → DB'deki tum asset pHash'leri
   - Hamming distance hesapla

6. Score fusion formulu:
   clipNorm = max(0, min(1, (clipScore + 1) / 2))     // [-1,1] → [0,1]
   cropBoost = min(0.08, max(0, hitCount - 1) * 0.02)  // Coklu crop bonusu
   phashScore = max(0, 1 - hammingDistance / 64)        // [0,1]

   finalScore = clipNorm * 0.60
              + phashScore * 0.30
              + min(1, cropBoost / 0.08) * 0.10

   // pHash exact match ozel durumu: HD <= 4 ise skor en az 0.995
   if (hammingDistance <= 4) finalScore = max(finalScore, 0.995)

7. Top-50 sonuc → setSemanticResults()
```

### 3.2 Ollama/Keyword Fallback Yolu

CLIP verisi yoksa veya CLIP devre disi ise:

```
1. analyzeImage(file, aiConfig) → vision model (llava vb.)
   - Ollama timeout: 600sn, API timeout: 60sn
   - 3sn interval ile progress guncelleme

2. Sonuc: { description, keywords[] }

3. Keywords → Turkce ceviri (statik sozluk):
   basketball → basketbol, court → saha, wood → ahsap,
   wall → duvar, interior → ic mekan, pool → havuz, vb.
   (76 anahtar kelime cifti)

4. Temiz keywords birlestirilir → setSearchQuery(keywords)
   → Normal metin arama pipeline tetiklenir
```

### 3.3 Gorsel vs Metin Sorgu Ayrimi

```typescript
// isVisualVectorQueryString():
// "🔍 Gorsel Sonuclar" ile baslayan veya
// "🔍 Gorsel Vektor Sonuclari (CLIP)" olan sorgular
// → CLIP vektör sonuclariyla filtrelenir, metin semantigi ezilmez
```

---

## 4. Sekil (Shape) Arama

**Dosya:** `src/components/ShapeSearchModal.tsx`

### 4.1 Image Tab
```
1. Kullanici gorsel yukler (drag & drop veya dosya sec)
2. Rust komutu: extract_shape_from_image_bytes(imageData)
   → Kontur cikarma, sekil vektoru
3. searchShapesBySimilarity(shape, topK=40)
   → DWG dosyalarindaki sekillere kiyasla
4. Asset basina en yuksek skor (deduplication)
5. Sonuclar: asset grid + sekil bilgisi (duzgunluk, en-boy orani)
```

### 4.2 Criteria Tab
```
Filtreler:
- Vertex sayisi: ± tolerance
- Min regularity: 0.5
- Layer category: TUMU / HAVUZ / DUVAR / KAPI / ...

Sadece DWG dosyalarinda calisir.
```

---

## 5. Hibrit Skorlama Formulleri

**Dosya:** `src/utils/searchScoring.ts`

### 5.1 Sensitivity-Based Thresholds

```
semanticMatchThreshold(sensitivity):
  return 0.15 + (sensitivity / 100) * 0.30
  // sensitivity=0   → threshold=0.15 (cok esnek, her sey gecer)
  // sensitivity=50  → threshold=0.30 (dengeli)
  // sensitivity=100 → threshold=0.45 (siki, sadece guclu eslesmeler)

visualSearchThreshold(sensitivity):
  return 0.35 + (sensitivity / 100) * 0.50
  // sensitivity=0   → threshold=0.35
  // sensitivity=50  → threshold=0.60
  // sensitivity=100 → threshold=0.85
```

### 5.2 Hibrit Final Skor

```
computeHybridFinalScore(kwScore, semScore, threshold):

  // 1. Semantic skoru normalize et (threshold'un altindakileri sifirla)
  denom = 1 - threshold
  if (semScore > threshold AND denom > 0.001):
    adjustedSemScore = min(1, (semScore - (threshold - 0.05)) / denom)
  else:
    adjustedSemScore = 0

  // 2. Olasilik OR operatoru ile birlestir
  finalScore = min(1, kwScore + adjustedSemScore - kwScore * adjustedSemScore)

  // Bu formul: P(A ∪ B) = P(A) + P(B) - P(A ∩ B)
  // Iki bagimsiz sinyal var: keyword eslesmesi ve semantik benzerlik
  // Ikisi de yuksekse skor neredeyse 1'e yaklasir
  // Biri 0 ise digeri baskinda kalir
```

**Neden bu formul?**
- Basit toplama: 1'i asabilir, anlamsiz
- Max(a, b): zayif sinyal kayboluyor
- Olasilik OR: her iki sinyali adil birlestiriyor, [0,1] araliginda kaliyor

### 5.3 Keyword Fallback Skoru

Embedding aramasinda semantic'in kaciramadigi exact keyword eslesmelerini yakalamak icin:

```
KEYWORD_SCORE = 0.62 (sabit)
// Sadece semantic'in kapsamadigi asset'lere eklenir
// searchTextChunksByKeyword() → DB'de LIKE ile arama
```

### 5.4 Score Badge Gosterimi

**Dosya:** `src/components/AssetCard.tsx`

```typescript
// Skor 0-1 arasindan yuzdeye cevrilir:
t('assetCard.badge.similarity', { score: (searchScore * 100).toFixed(0) })
// Gosterim: "%85 benzerlik" gibi
// Pozisyon: Kartin sag ust kosesi, accent renk badge
```

---

## 6. Query Expansion (Sorgu Genisletme)

**Dosya:** `src/services/queryExpansion.ts`

### 6.1 Mimari Domain Sozlugu

~100 terim, 6 kategori:

| Kategori | Ornekler |
|---|---|
| Geleneksel susleme | mukarnas → stalactite vault; revzen → vitray, stained glass |
| Mimari elemanlar | kubbe → dome, cupola; kemer → arch, portal, vault |
| Yapi turleri | turbe → mausoleum, tomb; hamam → bathhouse, turkish bath |
| Mekanlar | avlu → courtyard, atrium; eyvan → iwan, vaulted hall |
| Cizim turleri | vaziyet → site plan; kesit → section, cross section |
| Malzeme & yapim | cini → iznik tile, faience; mermer → marble cladding |
| Genel mekan | salon → living room; mutfak → kitchen; banyo → bathroom |

### 6.2 Genisletme Algoritmasi

```
expandQuery(query):
  1. turkishLower(query)
  2. Sozlukteki her terim icin:
     - Alt cizgileri bosluGa cevir (compound key'ler)
     - lower.includes(term) ise → tum synonymleri ekle
  3. Tekrarlari kaldir (Set)
  4. Orijinal terimler + max 20 genisletme terimi
  5. return birlesik metin
```

### 6.3 Match Sources (Esleme Kaynaklari)

```
findMatchSources(asset, query):
  3 grup halinde hangi alanlarda eslesme oldugunu bulur:

  'file' grubu:  DWG katman, blok, metin, dosya basligi, anahtar kelime
  'ai' grubu:    Alan terimi, eleman, mekan, anahtar kelime, cizim turu, AI aciklama
  'meta' grubu:  Dosya adi, proje adi, mekan adi

  Her grup icin: eslesen degerler listelenir (max 5, 70 karakter limit)
  Kullanici detay panelinde "neden bu sonuc geldi" sorusunun cevabini gorur.
```

---

## 7. Arama Gecmisi & Kayitli Aramalar

**Dosya:** `src/services/searchHistory.ts`

### 7.1 Arama Gecmisi (Otomatik)

```
Depolama: localStorage ('archivist_search_history')
Max giris: 50
Veri yapisi: { query, timestamp, resultCount? }

Davranislar:
- addToSearchHistory: duplicate varsa en uste tasir, eskisini sil
- removeFromSearchHistory: tek giris silme
- clearSearchHistory: tum gecmisi temizle
- searchInHistory: prefix match ile autocomplete (top 10)
```

### 7.2 Kayitli Aramalar (Manuel)

```
Depolama: localStorage ('archivist_saved_searches')
Veri yapisi: { id, name, query, filters?, createdAt }

Davranislar:
- saveSearch: isim + sorgu + filtreler (opsiyonel)
- deleteSavedSearch: ID ile silme
- renameSavedSearch: yeniden adlandirma
```

### 7.3 UI Akisi

```
Sidebar arama kutusu:
1. Focus → gecmis dropdown goster (8 son arama)
2. Bos query + gecmis var → dropdown acilir
3. Gecmis ogesi tiklandi → onSearchChange(h.query)
4. X butonu → tek giris silme
5. "Tumunu Temizle" → clearSearchHistory()
6. Blur → 200ms gecikmeyle kapat (tiklama yakalamak icin)
```

---

## 8. Cache Stratejisi & Performans

### 8.1 Embedding Cache

**Dosya:** `src/hooks/useEmbeddingSearch.ts`

```typescript
let _embeddingCache: [...textEmbs, ...ocrEmbs] | null = null;
let _cacheVersion = 0;

// Invalidation: tarama tamamlandiginda veya arsiv degistiginde
// Race condition koruması: sorgular arasinda _cacheVersion degistiyse
// cache'i atla, stale veri kullanma
```

### 8.2 Search Text Cache

**Dosya:** `src/utils/searchScoring.ts`

```typescript
const _searchTextCache = new WeakMap<Asset, string>();
// GC-friendly: Asset nesnesi garbage collect edilince cache de gider
// Ayni Asset referansi icin turkishLower + join islemini bir kez yap
```

### 8.3 Regex Cache

**Dosya:** `src/utils/searchScoring.ts`

```typescript
const _regexCache = new Map<string, RegExp>();
// Max 500 giris — doldugunda toptan temizle
// Word boundary regex derleme maliyetini sifirla
```

### 8.4 RAG Embedding Cache

**Dosya:** `src/services/ragService.ts`

```typescript
let _ragEmbeddingCache = null;      // Tum chunk embedding'leri
let _ragAssetSearchIndex = null;    // Asset → searchableText map
let _ragCacheVersion = 0;

// Invalidation: invalidateRagEmbeddingCache() caGrildiginda
// Version guard ile race condition onlenir
```

### 8.5 Performans Zamanlama

```
Keyword arama:       < 1ms (WeakMap cache + regex cache)
Semantic embedding:  ~50-200ms (model inference)
CLIP embedding:      ~100-500ms (5 crop)
pHash hesaplama:     ~20-50ms (per image)
Debounce:            400ms (semantic arama tetiklenmesi icin)
Gecmis dropdown:     200ms (blur gecikme — tiklama yakalamak icin)
```

---

## 9. UI/UX Kaliplari

### 9.1 Arama Input Bileseni

**Dosya:** `src/components/Sidebar.tsx` (satir 419-547)

```
Yapi:
+----------------------------------------------------------+
| [🔍] [______arama metni______] [X] [📷]  [✨]           |
+----------------------------------------------------------+
  |        |                      |     |      |
  |        |                      |     |      +-- Arama goStergesi (spin)
  |        |                      |     +-- Gorsel arama butonu
  |        |                      +-- Temizle butonu (searchQuery varsa)
  |        +-- Input alani (dinamik placeholder)
  +-- Arama ikonu (sabit)

Alt bilesenler:
- Min 3 karakter ipucu (searchQuery 1-2 karakter)
- Arama gecmisi dropdown (focus + bos query)
- Secili gorsel chip (gorsel arama sonrasi)
```

### 9.2 Durum Banner'lari

5 durum, asagidaki oncelik sirasinda (sadece biri gosterilir):

| Oncelik | Durum | Renk | Aksiyon |
|---|---|---|---|
| 1 | `embeddingLoading` | Mor (#6366f1) | Progress bar + %sayisi |
| 2 | `embeddingError` | Kirmizi (#f87171) | Hata mesaji + Retry butonu |
| 3 | `embeddingReady && count===0` | Sari (#fbbf24) | "Index yok" + Rescan butonu |
| 4 | `!embeddingReady && query.length>0` | Gri | "Hazir degil" + Ayarlar linki |
| 5 | Normal | - | Banner yok |

### 9.3 AI Durum Gostergesi

```
Embedding hazir:  [🧠] "Semantik arama aktif (N chunk)"  — yesil
Embedding yukleniyor: [🧠] "Yukleniyor..."              — mor
Embedding kapalı: [🧠] "Metin tabanli arama"            — gri

Semantik aktif + sorgu var: [✨ AI] badge — sag taraf, accent renk
```

### 9.4 Embedding Coverage Bar

```
[Kapsam]                    [320 / 850]
[████████████░░░░░░░░░░░░░░░░░░░] %37.6

- height: 4px
- Tamamlandi ise: yesil
- Devam ediyorsa: accent renk
- aria: role="progressbar" aria-valuenow/min/max
```

### 9.5 Sensitivity Slider

```
[Arama hassasiyeti]
[Aciklama metni]
[──────────●──────] %50

- range input: 0-100
- Threshold'lari dinamik olarak kontrol eder
- localStorage'da kalici
- Gosterim: kosula bagli (showSensitivityControl)
```

### 9.6 Sonuc Kartlari

**Dosya:** `src/components/AssetCard.tsx`, `src/components/ExplorerView.tsx`

```
Her kart icin:
- searchScoreMap[asset.id] → score badge (sag ust kose)
- "%85 benzerlik" formati
- tag-accent CSS sinifi
- font-size: 0.65rem

Sonuc sirasi: finalScore desc (en yakin sonuc en basta)

Bos sonuc durumu:
- Arsiv bos: "Henuz dosya taranmamis" + tarama butonu
- Sonuc yok: "Aramanizla eslesen sonuc bulunamadi"
```

### 9.7 Match Sources (Detay Paneli)

Kullanici bir sonuc kartini sectikten sonra detay panelinde:

```
"Bu sonucun neden geldigini" 3 grupla goster:

📄 Dosya icerigi:
   - Katman adinda: "HAVUZ_KAPI", "CAM_CEPHE"
   - Blok adinda: "DOOR_SLIDING"

🤖 AI tespiti:
   - Eleman olarak tespit edildi: "havuz", "cam"
   - Cizim turu: "kat plani"

📋 Metadata:
   - Dosya adinda: "Proje A Zemin Kat"
   - Proje adinda: "Kultur Merkezi"
```

---

## 10. Hata Yonetimi & Edge Case'ler

### 10.1 Hata Senaryolari

| Senaryo | Davranis | Dosya |
|---|---|---|
| Embedding model yuklenemedi | Banner: hata + Retry butonu | Sidebar.tsx |
| Semantic arama hatasi | `notifyError()` + `debugLog()` + sonuclari sifirla | useEmbeddingSearch.ts |
| Query cok kisa (<3 kar) | Uyari mesaji goster, aramaya engel olma | Sidebar.tsx |
| Embedding 0 chunk | Sari banner + "Rescan" butonu | Sidebar.tsx |
| CLIP verisi yok (DB bos) | Ollama/keyword fallback'e dus | useImageSearch.ts |
| TIF/TGA dosya | Rust thumbnail donusumu, basarisiz olursa dosyayi olduGu gibi kullan | useImageSearch.ts |
| Ollama timeout (600sn) | `notifyError()` + sorguyu sifirla | useImageSearch.ts |
| API timeout (60sn) | `notifyError()` + sorguyu sifirla | useImageSearch.ts |
| Bos AI yanit | `notifyError("Bos yanit")` + sorguyu sifirla | useImageSearch.ts |
| Gorsel arama iptal | interval temizle, isImageSearching=false | useImageSearch.ts |
| pHash hesaplanamadi | catch → hd=64 (en kotu skor) | useImageSearch.ts |
| Cache race condition | `_cacheVersion` guard ile stale veri onlenir | useEmbeddingSearch.ts |

### 10.2 Edge Case Kararlari

| Durum | Karar | Neden |
|---|---|---|
| 2 karakterlik sorgu | Arama calisir ama keyword skoru genelde 0 | Filtre yonetimine engel olma |
| Eski CLIP index (tek gorsel) | Fallback + bir kez uyari goster | Geriye uyumluluk |
| Keyword + semantic ikisi de 0 | Asset atlanir | Gereksiz sonuc onle |
| pHash exact match (HD<=4) | Score min 0.995 | Birebir ayni gorsel en uste |
| Regex cache 500'u asti | Toptan temizle | Bellek tasmasini onle |
| WeakMap GC | Otomatik | Asset referans kaybolunca cache gider |

---

## 11. Dosya Haritasi

### Bilesenler (UI)

| Dosya | Satirlar | Rol |
|---|---|---|
| `src/components/Sidebar.tsx` | ~1098 | Ana sol panel + arama input + filtreler |
| `src/components/ExplorerView.tsx` | ~185 | Sonuc grid gorunumu |
| `src/components/AssetCard.tsx` | ~250 | Tekil sonuc karti + skor badge |
| `src/components/VisualSearchModal.tsx` | ~350 | Metin→gorsel CLIP arama modali |
| `src/components/ShapeSearchModal.tsx` | ~400 | Teknik cizim sekil arama modali |
| `src/components/SourceFoldersPanel.tsx` | ~716 | Kaynak klasor paneli |
| `src/components/FilterPresetSelector.tsx` | ~120 | Filtre preset kaydet/yukle |

### Hook'lar (Mantik)

| Dosya | Satirlar | Rol |
|---|---|---|
| `src/hooks/useEmbeddingSearch.ts` | ~125 | Semantic arama orkestrasyon |
| `src/hooks/useImageSearch.ts` | ~318 | Gorsel arama (CLIP + Ollama fallback) |
| `src/hooks/useHybridFilteredAssets.ts` | ~107 | Hibrit filtreleme + siralama |

### Servisler (Veri)

| Dosya | Satirlar | Rol |
|---|---|---|
| `src/utils/searchScoring.ts` | ~310 | Skorlama, threshold, filtreleme |
| `src/services/queryExpansion.ts` | ~225 | Domain sozluk + genisletme + match sources |
| `src/services/searchHistory.ts` | ~127 | Gecmis + kayitli aramalar |
| `src/services/embeddings.ts` | ~451 | MiniLM + CLIP model yukleme + embedding |
| `src/services/ragService.ts` | ~1508 | RAG retrieve + hybrid + rerank |
| `src/services/visualSearch.ts` | ~117 | CLIP text→image + Turkce ceviri |
| `src/services/imageHash.ts` | - | pHash hesaplama + Hamming mesafesi |

### Store

| Dosya | Ilgili State'ler |
|---|---|
| `src/store/useStore.ts` | searchQuery, semanticResults, activeFilters, activeRootFilters, activeTagFilters, isImageSearching, searchSensitivity, showOnlyFavorites, filterPresets, isVisualSearchOpen, isShapeSearchOpen |

### Sabitler

| Dosya | Ilgili Degerler |
|---|---|
| `src/config/constants.ts` | EMBEDDING_SEARCH_DEBOUNCE_MS: 400, SEARCH_HISTORY_DELAY_MS: 200 |

---

## 12. Yeniden Uretim Kontrol Listesi

Bu sistemi sifirdan yeniden uretmek isteyen biri icin adim adim kontrol listesi:

### Adim 1: Temel Altyapi
- [ ] Turkce-guvenli lowercase fonksiyonu (manuel I→i donusum)
- [ ] Zustand store'da arama state'leri (searchQuery, semanticResults, activeFilters, sensitivity)
- [ ] localStorage'da arama gecmisi servisi (max 50, duplicate handling)

### Adim 2: Keyword Arama
- [ ] buildFullSearchableText() — tum asset alanlarini birlestir
- [ ] WeakMap cache ile tekrar hesaplamayi onle
- [ ] computeKeywordScore() — word split + boundary regex + exact bonus
- [ ] Regex cache (max 500)
- [ ] useMemo ile aninda filtreleme (debounce yok)

### Adim 3: Semantic Arama
- [ ] MiniLM embedding modeli (multilingual, 384-dim, offline paket)
- [ ] Embedding cache (module-level degisken, version guard)
- [ ] cosineSimilarity fonksiyonu
- [ ] Debounce (400ms)
- [ ] Keyword fallback (LIKE arama, sabit skor 0.62)
- [ ] Per-asset best score (ayni asset'in en iyi chunk'i)

### Adim 4: Hibrit Skorlama
- [ ] semanticMatchThreshold() — sensitivity tabanlı dinamik threshold
- [ ] computeHybridFinalScore() — olasilik OR formulu
- [ ] filterAssetsHybrid() — filtreler + skorlama + siralama
- [ ] buildSearchScoreMap() — kart badge'leri icin skor haritasi

### Adim 5: Query Expansion
- [ ] Domain-spesifik sinonim sozlugu (~100 terim)
- [ ] expandQuery() — orijinal + max 20 genisletme terimi
- [ ] findMatchSources() — 3 gruplu esleme kaynaklari

### Adim 6: Gorsel Arama
- [ ] CLIP model (512-dim, text+image encoding, offline paket)
- [ ] Multi-crop strateji (5 bolge: global, center, corners)
- [ ] pHash hesaplama + Hamming distance
- [ ] Score fusion: CLIP 60% + pHash 30% + cropBoost 10%
- [ ] Exact match override: HD<=4 → skor min 0.995
- [ ] Ollama/keyword fallback yolu
- [ ] EN→TR statik sozluk cevirisi

### Adim 7: UI/UX
- [ ] Dinamik placeholder (semantic hazir / metin modu)
- [ ] 5 durum banner'i (loading, error, no-index, not-ready, normal)
- [ ] Arama gecmisi dropdown (focus + bos query)
- [ ] Secili gorsel chip (preview + progress + clear)
- [ ] Sensitivity slider (0-100, localStorage kalici)
- [ ] AI durum gostergesi (brain icon + badge)
- [ ] Embedding coverage progress bar
- [ ] Score badge (AssetCard sag ust, yuzde formati)
- [ ] Match sources (detay paneli, 3 grup)
- [ ] Keyboard: Enter=gecmise kaydet, Escape=temizle
- [ ] ARIA etiketleri tum etkilesimli elemanlarda

### Adim 8: Hata Yonetimi
- [ ] Model yuklenemedi → Retry banner
- [ ] Arama hatasi → notifyError + debugLog + sonuclari sifirla
- [ ] Timeout → hata bildirimi + sorgu sifirla
- [ ] Cache race condition → version guard
- [ ] TIF/TGA → Rust donusum fallback
- [ ] pHash hesaplanamadi → catch, HD=64

### Adim 9: Performans
- [ ] WeakMap cache (searchable text)
- [ ] Map cache (regex, max 500)
- [ ] Module-level embedding cache (version guard)
- [ ] Debounce sadece semantic'te (keyword aninda)
- [ ] Progressive enhancement: keyword aninda, semantic 400ms sonra

---

> **Not:** Bu belge "nasil calisir" degil "nasil yeniden uretilir" perspektifinden yazilmistir.
> Her formul, esik degeri ve tasarim karari aciklanmistir. Baska bir gelistirici bu belgeyi
> takip ederek ayni veya daha iyi bir arama sistemi kurabilmelidir.

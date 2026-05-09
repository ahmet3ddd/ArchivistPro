# ArchivistPro — Arama / Bulma / Eşleşme Sistemleri Audit Raporu

**Tarih:** 2026-05-02 | **Uzman Rolü:** DAM & Arşiv Yönetimi

---

## 1. METİN ARAMA (Keyword Search)

**Vaad:** *"Arama yap..." / "Doğal/Görsel ara..."* — Kullanıcı metin girer, arşivdeki dosyalar aranır.

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **UI** | `Sidebar.tsx` arama kutusu | Min 3 karakter, debounce, son aramalar, temizle |
| **Skor** | `computeKeywordScore()` | Kelime sınırı eşleşmesi +0.2 bonus, substring match |
| **Hedef** | `buildFullSearchableText()` | 50+ alan: dosya adı, proje, kategori, AI etiketleri, DWG katmanları/blokları/metinleri, RVT/IFC/MAX metadata, client adı, onay durumu |
| **Türkçe** | `turkishLower()` | Manuel İ→i, Ş→ş, Ğ→ğ dönüşümü |

**Puan: 8.5/10**

| Artı | Eksi |
|------|------|
| 50+ alan üzerinden zengin arama | Fuzzy matching yok (yazım hatası toleransı sıfır) |
| Türkçe-güvenli case folding | Stemming yok ("planlar" → "plan" eşleşmez) |
| Kelime sınırı bonus puanlaması | Frase/tırnak araması desteklenmiyor |
| Hızlı WeakMap cache mekanizması | Puan normalizasyonu max 3 kelimeye kadar — uzun sorgular dezavantajlı |

---

## 2. SEMANTİK ARAMA (AI Embedding Search)

**Vaad:** *"Semantik arama aktif" / "AI arama motoru"* — Anlam bazlı eşleştirme, yazılanın birebir geçmediği ama anlamca yakın dosyaları bulma.

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **Model** | MiniLM-L12-v2 multilingual | 384-dim, ~46MB, tamamen offline |
| **Hook** | `useEmbeddingSearch.ts` | Cosine similarity tüm chunk embedding'lere karşı |
| **Eşik** | Dinamik: 0.15–0.45 | `searchSensitivity` slider (0-100) ile kontrol |
| **Fallback** | Keyword LIKE araması | Embedding eşleşmezse 0.62 sabit skorla keyword fallback |
| **Sorgu genişletme** | `queryExpansion.ts` | 100+ mimari terim sözlüğü (mukarnas, kemer, kubbe, revzen…) |

**Puan: 8/10**

| Artı | Eksi |
|------|------|
| Gerçek multilingual transformer, tamamen offline | Tüm embedding'ler RAM'e yükleniyor — >100K chunk'ta darboğaz |
| Mimari alan sözlüğü ile sorgu genişletme | Sözlük statik, kullanıcı genişletemiyor |
| Ayarlanabilir hassasiyet slider'ı | Boyut uyumsuzluğunda sessizce atlıyor |
| Keyword fallback garantisi | Embedding indekslenmemiş dosyalar tamamen semantik aramanın dışında |

---

## 3. HİBRİT PUANLAMA (Keyword + Semantic Fusion)

**Vaad:** *"Akıllı Arama — Anahtar kelime veya anlam tabanlı arama"* — İki sinyali birleştirip en iyi sonuçları üste çıkarma.

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **Birleştirme** | `computeHybridFinalScore()` | `min(1, kw + sem - kw*sem)` — bağımsız olasılık birleşimi |
| **Orkestratör** | `useHybridFilteredAssets.ts` | Tüm filtreler + arama + sıralama tek merkezden |
| **Eşleşme kaynağı** | `findMatchSources()` | "DWG Dosyasında" / "AI Tespiti" / "Metadata" olarak gösterilir |

**Puan: 9/10**

| Artı | Eksi |
|------|------|
| Matematiksel olarak sağlam birleşim formülü | Root folder boost (0.02) aramayla birleşince etkisiz |
| Match source gösterimi (hangi alanda eşleşti) | Kullanıcıya "neden bu sonuç üstte" açıklaması yeterli değil |
| Tek orkestratör mimarisi temiz ve tutarlı | — |

---

## 4. GÖRSEL ARAMA — CLIP (Text-to-Image)

**Vaad:** *"Görsel Arama (CLIP) — 'şu desene benzer çizimler' gibi metinle resim ara"*

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **Model** | CLIP text encoder | Metin → 512-dim vektör |
| **Crop'lar** | 5 bölge | global, center, top_left, top_right, bottom_center |
| **Skor** | Cosine similarity + pHash reranking | CLIP %60, pHash %30, crop boost %10 |
| **Çeviri** | Ollama TR→EN | Türkçe sorguyu otomatik İngilizceye çevir |

**Puan: 7/10**

| Artı | Eksi |
|------|------|
| 5-crop stratejisi detay yakalamada güçlü | Ollama bağımlılığı: GPU yoksa çeviri çalışmaz → CLIP sadece İngilizce |
| pHash reranking yanlış-pozitifi azaltıyor | DWG/CAD dosyalarında ayırt edicilik çok düşük |
| Tamamen offline | Sadece thumbnail'i olan dosyalar aranabilir |
| Eşik ayarlanabilir (0.35–0.85) | — |

---

## 5. GÖRSEL ARAMA — Resimle Ara (Image-to-Image)

**Vaad:** *"Görsel ile Ara"* — Bir resim yükleyip benzerleri bulma.

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **CLIP modu** | Resim → CLIP embedding → cosine similarity | 5-crop + pHash reranking |
| **Fallback** | Vision LLM → keywords → text search | Ollama/API ile resmi analiz et |
| **Timeout** | 60s (API), 600s (Ollama) | |

**Puan: 7.5/10**

| Artı | Eksi |
|------|------|
| Çift katmanlı (CLIP + LLM fallback) | LLM fallback çok yavaş (600s'e kadar) |
| pHash ile Hamming distance ek doğrulama | Fallback sonuçları çok kaba (keyword match) |
| Stale request guard ile iptal desteği | TIF/TGA canvas limitleri |

---

## 6. ŞEKİL ARAMA (Shape Search — DWG)

**Vaad:** *"DWG çizimlerinde geometrik şekil arama"*

| Katman | Uygulama | Detay |
|--------|----------|-------|
| **Çıkarım** | `extract_dxf_shapes()` / `extract_dwg_shapes()` | LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE |
| **Özellikler** | area, perimeter, aspect_ratio, regularity, bbox, centroid | Her şekil için 8 geometrik öznitelik |
| **Depolama** | `dwg_shapes` tablosu | asset_id, layer_name, entity_type, vertex_count… |
| **Eşleştirme** | Frontend'de mesafe hesabı | Rust'ta sadece çıkarım, scoring JS tarafında |
| **Resimden şekil** | `extract_shape_from_image()` | Otsu + Moore contour + RDP simplification |

**Puan: 6.5/10**

| Artı | Eksi |
|------|------|
| Gerçek geometrik öznitelik çıkarımı | Eşleştirme/scoring backend'de yok |
| DWG→DXF otomatik dönüşüm (ODA) | ODA yoksa DWG şekil araması devre dışı |
| Resimden şekil çıkarımı da var | Kapalı + ≥3 vertex filtresi çok agresif |
| 8 boyutlu öznitelik vektörü | Normalizasyon/ağırlıklandırma frontend'de |

---

## 7. KOPYA/BENZER BULMA (Duplicate Finder)

**Vaad:** *"Kopya & Benzer Dosya Bulucu"* — 4 modda kopya ve benzer dosya tespiti.

| Alt Mod | Algoritma | Puan |
|---------|-----------|------|
| **7a. Birebir Kopya** | SHA-256 hash | **9.5/10** |
| **7b. Aynı İsim** | fileName string match + boyut/tarih kriterleri | **8/10** |
| **7c. Görsel Benzerlik** | pHash Hamming distance | **7/10** |
| **7d. Yapısal Benzerlik** | Metadata Jaccard (DWG/MAX/SKP/RVT/IFC/Office) | **8.5/10** |

**Genel Puan: 8/10**

---

## 8. FASET FİLTRELEME (Faceted Navigation)

**Vaad:** 6 faset: Varlık Türü, Proje Safhası, Malzeme Grubu, Renk Teması, Mimari Stil, Onay Durumu

**Puan: 8.5/10**

| Artı | Eksi |
|------|------|
| Canlı sayaçlar | Tarih aralığı, boyut aralığı faseti yok |
| Kullanıcı özelleştirme | Faset değerleri AI atanmamışsa dosya dışarıda |
| Preset kaydet/yükle | Hiyerarşik faset yok |

---

## 9. ETİKET FİLTRELEME

**Puan: 8/10** — OR mantığı, AI + kullanıcı etiketleri. Eksik: hiyerarşi, AND/OR seçimi, synonym birleştirme.

## 10. KAYNAK KLASÖR FİLTRELEME

**Puan: 7.5/10** — Arama aktifken fiilen devre dışı (0.02 boost). Klasör ağacı drill-down sınırlı.

## 11. AI SOHBET / RAG

**Puan: 8.5/10** — 6 aşamalı pipeline (FTS5+embedding+RRF). GPU zorunlu. FTS5 ASCII tokenizer Türkçe'de zayıf.

## 12. SIRALAMA

**Puan: 7.5/10** — 5 kriter (ad/tarih/tür/boyut/AI skor). Eksik: modifiedAt, çoklu sıralama, çözünürlük.

## 13. FİLTRE PRESET

**Puan: 7/10** — localStorage (makineye özel). Etiket/arama dahil değil. İçe/dışa aktarım yok.

## 14. ARAMA GEÇMİŞİ

**Puan: 7.5/10** — Son 50 arama, autocomplete. İstatistik yok.

## 15. BENZERİNİ BUL

**Puan: 7.5/10** — 4 kademe. Kalıcı küme oluşturma yok.

---

## AĞIRLIKLI GENEL PUAN: 7.8 / 10

## KRİTİK BOŞLUKLAR (DAM standardına göre)

1. **Fuzzy / typo-tolerant arama yok** — Levenshtein, n-gram
2. **Tarih aralığı faseti yok** — "2024 Q3 dosyaları"
3. **Gelişmiş boolean arama yok** — AND/OR/NOT operatörleri
4. **DWG/CAD için CLIP güvenilirliği düşük** — Ana hedef kitle mimari ofis
5. **Shape search scoring backend'e taşınmalı** — >10K şekilde frontend darboğaz

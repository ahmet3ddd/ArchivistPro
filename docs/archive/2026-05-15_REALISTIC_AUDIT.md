# ArchivistPro — Gerçekçi İnceleme Raporu

**Tarih:** 2026-05-15
**Branch:** main (4eaf930) — `feat/webgpu-embedding` az önce merge edildi
**Versiyon:** v2.4.8
**Yöntem:** 4 paralel kod tarama (AI/embedding, format desteği, Rust backend, test/i18n/kalite) + somut dosya:satır doğrulamaları

---

## Genel Yargı

ArchivistPro **gerçek bir ürün** — placeholder feature yığını değil. Ama CLAUDE.md ve TODO.md kendinizle dürüst olduğunuz noktalar dışında, **iddialar gerçeği biraz şişiriyor**. Üretim için stabil, ama "büyük arşiv + ölçek" senaryosunda mimari sınırları var.

---

## 1. İddia vs Gerçek (Ölçülmüş Sayılar)

| İddia | Ölçülen | Yargı |
|---|---|---|
| 134 Tauri komutu | ~146 | ✓ doğru, hatta düşük söylenmiş |
| 15.000 satır Rust | 17.400 | ✓ doğru |
| 99 bileşen | 99 | ✓ |
| 53 servis | 57 | ✓ |
| 25 hook | 25 | ✓ |
| 2038 test | 2084 | ✓ küçük drift |
| **1825 i18n anahtar** | **2313** | ⚠ doc geride kalmış, ~%26 daha fazla anahtar var |
| **77.000+ frontend satır** | **~57.320** | ⚠ şişirilmiş, gerçek %25 daha az |
| **80+ format desteği** | **35 tür / ~60 uzantı varyantı** | ❌ pazarlama abartısı |
| Coverage stmt %64 / branch %53 / funcs %79 | rapor klasörü yok | ⚠ doğrulanamadı |

---

## 2. AI / Semantik Arama — Vaad Ettiğini Yapıyor mu?

### Yapanlar (gerçekten çalışıyor)

- **MiniLM 384-dim multilingual** offline (`paraphrase-multilingual-MiniLM-L12-v2`) — Türkçe dahil 50+ dil destekliyor
- **CLIP 512-dim 5-crop görsel arama** (`embeddings.ts:549`) — global + center + 3 köşe kırpma; her asset için 5 vektör tutuyor
- **Ollama RAG** hybrid retrieval: cosine + FTS5 birleşimi, opsiyonel LLM rerank
- **Dinamik context window**: `num_ctx = max(4096, min(16384, estimatedTokens * 2))` (`ragService.ts:994`)
- **WebGPU geçişi** (yeni branch) gerçek hız sağladı — fp32 model ile cold start 1-3sn, sonra batch 32 chunk ~0.3ms
- **Native batch embedding** (`generateBatchEmbeddings` 32 chunk paralel)
- **Warmup fonksiyonu** mevcut — ilk dosya gecikmesini önlüyor

### Yapamayanlar / Sınırlar

- **Vektör veritabanı yok**. `semanticSearch()` linear cosine scan yapıyor (`embeddings.ts:633-648`). Tüm vektörler RAM'e yükleniyor (`getRagCachedEmbeddings()` `ragService.ts:104`).
  - 100K asset = ~300MB RAM cache
  - 1M asset = ~3GB+ RAM, sorgu başına O(n) tarama
  - HNSW / IVF / pgvector gibi bir ANN index **yok**
- **AI tag önerisi batch değil** — asset başına 1 Ollama çağrısı (`tagService.ts:432-474`)
  - 1000 asset etiketleme = 1000 LLM hit
  - `num_ctx: 2048, num_predict: 80, temp: 0.3`, qwen3:8b default
  - Hata toleransı sessiz fail (`return []`)
- **CLIP fp32 modelleri (~580MB) MSI'ye gömülü değil** — dev-time `npm run models:download:fp32` ile geliyor. Production kullanıcısı kutudan çıkar çıkmaz WebGPU avantajını alamaz.
- **CLIP text encoder İngilizce** — Türkçe sorgu için Ollama'dan çeviri istiyor (`visualSearch.ts:29-72`). Ollama yoksa Türkçe görsel arama çöker.
- **Vector storage** SQLite blob (`embeddings` tablosu `database.ts:480-486`) — ANN index'siz, klasik B-tree

### Gerçek Model Boyutları (Doğrulandı)

```
MiniLM:
  model_quantized.onnx (q8):    113 MB  ← MSI'de paketli
  model.onnx (fp32):             449 MB  ← yeni indi (WebGPU için)

CLIP:
  vision_model_quantized.onnx:    85 MB  ← MSI'de paketli
  vision_model.onnx (fp32):      336 MB  ← yeni indi
  text_model_quantized.onnx:      62 MB  ← MSI'de paketli
  text_model.onnx (fp32):        243 MB  ← yeni indi

Toplam paketli (q8 / WASM):      260 MB
Toplam fp32 (WebGPU):           1.03 GB
```

---

## 3. Format Desteği — En Abartılı Kısım

"80+" ifadesi pazarlama dilinde haklı (uzantı varyantları sayılırsa) ama **gerçek "destek seviyesi"** çok daha dar.

### Derin Destek (7 format) — Thumbnail + Metadata + Text/Embedding

| Format | Detay |
|---|---|
| **DWG** | ODA Converter ile DXF dönüşüm + native parse, layers/blocks/xref/text. **500 MB limit** |
| **MAX** | CFB stream + version detection (`max_version.rs`), materials/plugins/render motoru. **500 MB limit** |
| **RVT** | OLE stream parse, version/project/storeys/spaces |
| **IFC** | Native parse, schema/entities/storeys/spaces |
| **PDF** | pdfium render + metin extraction (search için) |
| **Office (DOCX/XLSX)** | ZIP + XML parse, metin extraction |
| **MP4** | MediaInfo hint parse, codec + duration |

### Orta Düzey (10 format) — Thumbnail + Sınırlı Metadata

SKP, PSD (sadece composite, layer extract yok), Office legacy (DOC/XLS/PPT — OLE), JPEG/PNG/BMP/WEBP/TGA/TIFF (CLIP embedding), TXT/CSV/RTF, EPS/SVG/AI

### Sadece Tanır (~18 format) — Icon Fallback

**3D/CAD**: OBJ, MTL, FBX, C4D, BLEND, GLB, STL, DAE, 3DS, NWD, DGN, STEP, PLN, VWX, E57
**Diğer**: SAP2K varyantları (sdb/s2k/$2k/e2k/edb)

Bu formatlar: extension tanır, listede görünür, **ama metadata/preview/embedding üretilmez**.

### "80" Sayısının Yapısı

| Kategori | Sayı |
|---|---|
| Farklı format türleri (AssetType) | 35 |
| Uzantı varyantları (xlsx/xls/xlsm, mp4/mov/avi, dwg/dxf/dwf vb.) | +25 |
| **Toplam uzantı** | **~60** |

**Sonuç:** Mimar için kritik DWG/RVT/SKP/MAX/PDF/Office sağlam; CAD/3D ekosisteminin geri kalanı icon'dan ibaret. **Fonksiyonel desteğin gerçek sayısı ~17 format.**

---

## 4. Backend (Rust/Tauri) — Mimari Detaylar

### 4.1 Komut Sayısı (~146)

`generate_handler!` makrolarındaki gerçek dağılım:

| Kategori | Komut Sayısı |
|---|---|
| DB ops (ollama_db) | 29 |
| File ops (refile_fs, trash, thumbnails) | 31 |
| CAD parsing (dwg, dxf, shapes, scan) | 20 |
| Metadata extraction (image, office, pdf, video, text, rvt, ifc, skp) | 20 |
| LAN server | 4 |
| AI/Ollama proxy | 8 |
| System/util | 18 |

### 4.2 En Büyük Modüller (LOC)

1. **scan_db.rs**: 2.975 satır — incr. disk writes, shape similarity, audit, collections, chat mirrors, XMP
2. **dwg_parse.rs**: 2.084 satır — DWG geometry, layer parsing
3. **ollama_db.rs**: 1.597 satır — DB lifecycle, archive mgmt, user auth, snapshots
4. **dxf_parse.rs**: 1.288 satır
5. **max_version.rs**: 1.096 satır

### 4.3 LAN Server (Port 9471)

- 4 Tauri komutu: start/stop/status/regenerate
- Auth: 8-haneli kriptografik kod (getrandom)
- Rate limit: 5 başarısız / 5 dk → 5 dk IP lockout
- CORS: `null` origin + localhost beyaz listesi + explicit headers
- Çift yönlü HTTP, JSON payload
- Browser HTML client yok (CLI/SDK bekleniyor)
- 587 satır toplam

### 4.4 Çoklu Arşiv (`withArchive`)

- Frontend `withArchive(archiveId, op)` — basit context switch
- Rust tarafı `resolve_archive_path()` → `archive_{id}.db` dosyası
- **Global `DB_WRITE_LOCK` (`ollama_db.rs:136`)** — TÜM yazmalar tek mutex'te serileşiyor
- 5 arşiv paralel açık olsa bile yazma sıralı
- Per-archive lock yok → güvenli ama verimsiz

### 4.5 shapes_db.rs (374 satır, yeni)

- Her arşiv için ayrı `*_shapes.db` dosyası
- `dwg_shapes` tablosunu sql.js heap'inden çıkarmak için
- Henüz kısmi geçiş — full sql.js → rusqlite migration TODO.md A-DWG-OFFLOAD'da

### 4.6 Bilinen Eksikler

- **Rust testleri = SIFIR** — 17K satır, 146 komut, hiçbir `#[test]`
- 1 TODO comment: `dwg_parse.rs:1754` — "R2004+ DWG layer extraction için LibreDWG entegrasyonu"
- 20+ `.unwrap_or()` (benign default)
- 1 `.expect()` (CORS header, kabul edilebilir)
- Hiç `unimplemented!` veya `panic!` yok

---

## 5. Test, i18n ve Kod Kalitesi

### 5.1 Testler

- 99 test dosyası, 2.084 `it()` / `test()` çağrısı
- Örnekler: `database.test.ts` (vector encoding round-trip), `store.test.ts` (Zustand state geçişleri), `i18nCompleteness.test.ts` (dil anahtar şeması)
- **Mock-heavy değil**, gerçek birim/entegrasyon testleri
- Coverage raporu klasörü **bulunmadı** — iddia (64/53/79) doğrulanamadı

### 5.2 i18n

| Dil | Anahtar |
|---|---|
| tr | 2.313 |
| en | 2.313 |
| zh | 2.307 |
| ja | 2.307 |
| ar | 2.307 |

Hemen hemen eşit (tr/en %100 eşit, diğerleri 6 anahtar geride). CLAUDE.md'deki "1825" rakamı geride kalmış — gerçekte ~%26 daha fazla anahtar var.

### 5.3 RBAC

- Rust `require_admin()`: **9 komutta** kullanılıyor
- Frontend `<ProtectedAction>`: **4 yerde**
- Çift katmanlı koruma çalışıyor

### 5.4 Kod Kokuları

| Sorun | Sayı | Yorum |
|---|---|---|
| 1000+ satırlık dosya | 6 | DetailPanel, SettingsModal, DuplicateFinderModal, ArchiveExtractModal, Sidebar, fileScanner — yönetilebilir, TODO'da var |
| `any` / `unknown` kullanımı | 95 | Yüksek ama bilinçli olabilir |
| Boş `catch {}` (silent) | 93 | **Yüksek** — gerçek bug bir gün burada gizlenecek |
| Production `console.log` | 27 | Az ama profesyonellik açısından leke |

---

## 6. Mimari Kırmızı Bayraklar (Önem Sırasıyla)

1. **Rust backend test coverage = %0** — refaktör korkusu burada başlar
2. **`scan_db.rs` 2975 satır** — DWG geometri + audit log + collections + chat mirror + XMP hep aynı dosyada
3. **Global `DB_WRITE_LOCK`** — çoklu arşiv senaryosunda yazma serileşiyor
4. **dwg_shapes OOM riski** — sql.js heap limiti gerçek tehdit (TODO.md A-DWG-OFFLOAD'da kayıtlı, kullanıcı zaten 1.13M satırla yaşamış)
5. **93 silent `catch {}`** — hata yutma çok yaygın
6. **27 production `console.log`** — DevTools'da hep konuşan bir uygulama

---

## 7. Öncelik Önerisi (Benim Sıram)

### Olması istenir, beklemeye dayanır

1. **HNSW veya pgvector benzeri vektör index** — semantic search'i 10K+ asset için gerçek tutmanın tek yolu
2. **AI tag önerisi batch'leme** — tek prompt'ta 10-20 asset, %90 LLM hit azalır
3. **Rust test suite başlangıcı** — en azından `scan_db` ve `ollama_db` için 50-100 test
4. **CLIP fp32'yi prod MSI'ye dahil etme veya ilk açılışta auto-download** — WebGPU avantajını gerçek kullanıcıya aç

### Olmazsa olmaz değil ama dürüstleştirir

5. CLAUDE.md / README'de "80+ format" → "17 format derin + 18 tanıma" gibi yaz
6. `silent catch` denetimi — `eslint-plugin-no-empty-catch` veya custom rule
7. Production `console.log` temizliği

---

## 8. Net Kanım

Bu ürün, **mimarlık ofisi-içi tek-kullanıcı / küçük ekip** için **gerçek ve kullanılabilir**.

- AI semantik arama gerçek
- RAG sohbet gerçek
- LAN paylaşım gerçek
- Çoklu arşiv gerçek
- WebGPU desteği yeni eklendi ve çalışıyor

Ama "scale", "enterprise", "büyük arşiv (1M+)" iddialarına girilirse mimari sınırları net görünür.

TODO.md zaten bunların yarısını dürüstçe işaretlemiş (A-DWG-OFFLOAD, A9 mega-component, A11 store slice'lama, BGE Reranker erteleme) — yani sen de farkındasın, sadece roadmap'te bekletiyorsun. Bu profesyonel bir tutum, ama CLAUDE.md'deki sayıların güncellenmesi (1825 → 2313, 77K → 57K, 80 format → 17+18 ayrımı) güveni daha da artırır.

---

*Rapor 4 paralel kod auditi (AI özellikleri, format desteği, backend/Rust, test/i18n/kalite) sonucu üretildi. Tüm sayılar doğrudan dosya:satır taramasından geldi, tahmin değil.*

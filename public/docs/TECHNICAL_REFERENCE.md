# ArchivistPro — Teknik Referans Dokümanı

> Son güncelleme: 2026-05-23 (rev.12) | Sürüm: 3.0.0

Bu doküman ArchivistPro'nun teknik mimarisini, desteklenen formatları, metadata çıkarma yeteneklerini ve altyapı detaylarını açıklar. Proje geliştikçe güncellenmelidir.

> **v3.0.0 Değişiklik Özeti:** Vektör verisi (embedding, text chunk, asset relation, FTS5 keyword index) ayrı `archivist_vec.db` dosyasına taşındı (Section **4.5 V3 Vektör Veritabanı**'na bakın). HNSW ANN vektör indeksi eklendi (Section **9.2**). WAL journal default açık, UNC ağ tespiti ile DELETE moda otomatik düşüş. Per-arşiv yazma kilidi. Tam değişiklik listesi: `docs/CHANGELOG.md`.

---

## 1. Mimari Genel Bakış

```
┌────────────────────────────────────────────────────────────────┐
│                        ArchivistPro                             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐    ┌────────────────────┐    │
│  │  React 19   │◄►│  Zustand 5  │◄──►│  sql.js WASM       │    │
│  │  TypeScript │  │  Store       │    │  ↳ archivist.db   │    │
│  │  Tailwind 4 │  └─────────────┘    │     (metadata)     │    │
│  └──────┬──────┘                     └────────────────────┘    │
│         │ Tauri invoke / IPC                                   │
│  ┌──────▼──────┐                                               │
│  │  Tauri v2    │    ┌──────────────┐    ┌─────────────────┐  │
│  │  Rust Core   │◄──►│  Dosya       │    │  rusqlite       │  │
│  │  ~146 komut  │    │  Sistemi     │    │  ↳ archivist_   │  │
│  │              │    │              │    │     vec.db      │  │
│  │              │    │              │    │  (v3 vektör)    │  │
│  └──────────────┘    └──────────────┘    └─────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**v3.0.0 mimari değişikliği:** Vektör verisi (embeddings, text_chunks,
asset_relations, FTS5 keyword index) artık ayrı `archivist_vec.db`
dosyasındadır. Ana `archivist.db` yalnız metadata/etiket/ayar tutar.
Detay için Section 4.5'e bakın.

### Teknoloji Yığını

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Frontend | React + TypeScript | 19.2 + 5.9 |
| Build | Vite | 7.3 |
| Stil | Tailwind CSS | 4.2 |
| State | Zustand | 5.0 |
| Desktop | Tauri | 2.10.3 |
| Rust | Edition 2021 | 1.77.2+ |
| Veritabanı | SQLite (sql.js WASM) | 1.14 |
| AI/ML | Xenova Transformers (WASM) | 2.17 |
| HTTP Sunucu | tiny_http | 0.12 |
| Test | Vitest | 4.0 |

### Build Modları

| Mod | Komut | Açıklama |
|-----|-------|----------|
| Admin (dev) | `npm run dev:admin` | Tam yetkili geliştirme |
| Viewer (dev) | `npm run dev:viewer` | Kısıtlı yetkili geliştirme |
| Admin (build) | `npm run build:admin` | Tam yetkili üretim |
| Viewer (build) | `npm run build:viewer` | Kısıtlı yetkili üretim |

---

## 2. Rol Bazlı Erişim Kontrolü (RBAC)

Build-time ayrımı ile iki ayrı exe üretilir. Viewer'da admin kodu fiziksel olarak bulunmaz.

### Yetki Matrisi

| Yetki | Admin | Viewer |
|-------|:-----:|:------:|
| `archive.read` — Ana arşiv okuma/arama | ✅ | ✅ |
| `archive.write` — Ana arşive yazma | ✅ | ❌ |
| `archive.delete` — Ana arşivden silme | ✅ | ❌ |
| `archive.scan` — Klasör tarama/indeksleme | ✅ | ❌ |
| `archive.refile` — Dosya reorganizasyonu | ✅ | ❌ |
| `local.read` — Yerel dosya okuma | ✅ | ✅ |
| `local.write` — Yerel dosya yazma | ✅ | ✅ |
| `local.delete` — Yerel dosya silme | ✅ | ✅ |
| `local.zip` — Paketleme | ✅ | ✅ |
| `local_archive.create` — Yerel arşiv oluşturma | ✅ | ✅ |
| `local_archive.manage` — Yerel arşiv yönetimi | ✅ | ✅ |
| `local_archive.share` — Yerel arşiv paylaşımı | ✅ | ✅ |
| `ai.use` — AI özellikleri | ✅ | ✅ |
| `users.manage` — Kullanıcı yönetimi | ✅ | ❌ |
| `settings.manage` — Sistem ayarları | ✅ | ❌ |
| `logs.view` — Log görüntüleme | ✅ | ❌ |

### Çift Veritabanı Yapısı

- `main_archive.db` — Admin oluşturur/yönetir, Viewer salt-okunur erişir
- `local_archive.db` — Her kullanıcının kendi arşivi, tam yetkili

---

## 3. Desteklenen Dosya Formatları ve Metadata Çıkarma

> **Not:** ArchivistPro ~70 dosya uzantısını tanır ve arşive ekler. Ancak tüm formatlar
> aynı derinlikte işlenmez. Aşağıdaki tablo destek seviyelerini özetler:
>
> | Seviye | Açıklama | Format Sayısı | Örnekler |
> |--------|----------|:---:|---------|
> | **Derin** | Format-spesifik binary/text parse, zengin metadata | ~12 | DWG, MAX, SKP, PSD, IFC, RVT, DOCX, XLSX, PPTX, PDF |
> | **Orta** | OLE/ZIP parse ile kısmi metadata veya thumbnail | ~8 | DOC, XLS, PPT, DXF, EPS, ODS, TGA, TIFF |
> | **Temel** | Sadece dosya adı, boyut, tarih, SHA-256 hash, AI tag | ~50 | BLEND, FBX, OBJ, 3DM, C4D, DGN, DWF, NWD, PLN, STL, GLB vb. |
>
> "Temel" seviyedeki formatlar arşive eklenir, aranabilir ve etiketlenebilir —
> ancak format-spesifik metadata çıkarma (versiyon, katman, entity vb.) henüz yapılmaz.
> Bu formatlar öncelik sırasına göre "Derin" seviyeye yükseltilmektedir.

### 3.1 CAD / 2D Çizim

#### DWG (AutoCAD)
**Komut:** `extract_dwg_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Katman isimleri | Binary parse | AcDb layer table'dan |
| Blok isimleri | Binary parse | AcDb block reference'lardan |
| Metin içerikleri | Binary parse | TEXT/MTEXT entity'lerden |
| Xref referansları | Binary parse | Harici dosya bağlantıları |
| Çizim özellikleri | OLE property | Title, subject, author, keywords, comments |
| Tahmini ölçek | Hesaplama | Koordinat aralığından |
| Birim tipi | Binary parse | Metre, feet, inch vb. |
| Oluşturma tarihi | Julian date | DWG header'dan |

#### DXF
**Komut:** `extract_dxf_metadata` — DWG ile aynı metadata alanları (katman, blok, metin, xref, ölçek, birim). Metin tabanlı parse.

#### DWF / DGN
Şu an temel dosya bilgileri (dosya adı, boyut, tarih). İleride parse ile zenginleştirilecek.

#### IFC (Industry Foundation Classes)
**Komut:** `extract_ifc_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Schema versiyonu | FILE_SCHEMA header | IFC2X3, IFC4, IFC4X3 |
| Proje adı | IFCPROJECT entity | 3. argüman (Name) |
| Bina adı | IFCBUILDING entity | 3. argüman (Name) |
| Kaynak sistem | FILE_NAME header | Revit, ArchiCAD vb. |
| Kat sayısı | IFCBUILDINGSTOREY | Entity sayımı |
| Kat isimleri | IFCBUILDINGSTOREY | Name argümanları |
| Mekan sayısı | IFCSPACE | Entity sayımı |
| Toplam entity | DATA bölümü | Tüm #NNN= satırları |
| Entity dağılımı | DATA bölümü | Top 20 tip × adet |

### 3.2 3D Model

#### MAX (3ds Max)
**Komut:** `extract_max_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Versiyon | CFB stream | V10 (2008) – V27 (2025) |
| Stream sayısı/isimleri | CFB walk | Dosya iç yapısı |
| Storage isimleri | CFB walk | Klasör yapısı |
| Plugin isimleri | String tarama | .dlr, .dlo, .dlm, .gup uzantıları |
| Malzeme isimleri | String tarama | material, mtl, shader, vray, corona |
| Obje isimleri | String tarama | Sahne elemanları |
| Render motoru | String tarama | V-Ray, Corona, Arnold, Mental Ray, Scanline |
| Dosya boyutu | Filesystem | Byte cinsinden |

#### SKP (SketchUp)
**Komut:** `extract_skp_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Versiyon | ZIP JSON / Binary | SketchUp 3–2024 |
| Bileşen isimleri | ZIP JSON | document.json / entities |
| Katman isimleri | ZIP JSON | layers dizisi |
| Malzeme isimleri | ZIP JSON | materials dizisi |
| Coğrafi konum | ZIP JSON | document.json geo_location |
| Açıklama | ZIP JSON | document.json description |
| Sahne birimi | ZIP JSON | document.json unit |

#### MTL (Wavefront Material)
Saf metin formatı — OBJ dosyalarının malzeme tanımlarını içerir.
- **Önizleme:** Metin thumbnail (ilk 5 satır SVG render, `get_text_thumbnail`)
- **İkon:** Yeşil tonlu DOC ikonu (`get_doc_icon_thumbnail` — `#60a070`)
- **Metadata:** `extract_text_metadata` ile satır/kelime/karakter sayısı

#### RVT / RFA (Revit)
**Komut:** `extract_rvt_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Revit versiyonu | BasicFileInfo stream | "Revit Build" satırından yıl |
| Build numarası | BasicFileInfo stream | Tam build string |
| Proje adı | BasicFileInfo stream | "Project Name" key |
| Worksharing durumu | BasicFileInfo stream | Enabled / Not Enabled |
| Central model yolu | BasicFileInfo stream | Workshared dosyalarda |
| Format | BasicFileInfo stream | Kayıt formatı yılı |
| Stream sayısı | CFB walk | OLE dosya yapısı |
| Storage isimleri | CFB walk | OLE klasör yapısı |

**Not:** RVT dosyaları OLE/CFB (Compound File Binary) formatıdır. BasicFileInfo stream'i UTF-16LE satırlar halinde key-value çiftleri içerir.

#### Diğer 3D (3DM, BLEND, C4D, OBJ, FBX, GLB, STL, NWD, PLN, VWX, E57)
Şu an temel dosya bilgileri (dosya adı, boyut, tarih, SHA-256 hash). Öncelik sırasına göre zenginleştirilecek.

### 3.3 Görsel / Render

#### EPS (Encapsulated PostScript)
Vektör grafik formatı. Birçok EPS dosyası binary header'da gömülü TIFF önizleme içerir.
- **Komut:** `get_eps_thumbnail`
- **Yöntem:** EPS binary header parse (magic `0xC5D0D3C6`, offset 20-27 TIFF pointer)
- **TIFF varsa:** image crate ile decode → 200x200 JPEG → base64 thumbnail
- **TIFF yoksa:** Mor tonlu DOC ikonu (`get_doc_icon_thumbnail` — `#b050d0`)
- **Sınırlama:** Yalnızca binary header'lı EPS dosyalarında çalışır; salt PostScript (ASCII) dosyalarda fallback ikon gösterilir

#### JPEG, PNG, BMP, WEBP, TIFF, TGA, EXR, HDR
**Komut:** `extract_image_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Boyutlar (px) | Image crate | Genişlik x yükseklik |
| Format | Uzantı | jpeg, png, bmp, vb. |
| Alpha kanalı | Format tespiti | png, webp, tga, tiff, exr |
| Yazılım | EXIF Software | Render tespiti için kullanılır |
| Kamera marka/model | EXIF Make/Model | Fotoğraf makinesi |
| Çekim tarihi | EXIF DateTimeOriginal | |
| Renk profili | EXIF ColorSpace | sRGB, AdobeRGB, vb. |
| ISO hızı | EXIF ISO | |
| Odak uzaklığı | EXIF FocalLength | mm cinsinden |
| Pozlama süresi | EXIF ExposureTime | |
| GPS koordinatları | EXIF GPS | Enlem/boylam (ondalık derece) |
| Render tespiti | Yazılım analizi | V-Ray, Corona, Arnold, Blender, KeyShot, Lumion, Enscape, Octane, Redshift, Unreal |
| Dominant renkler | Bucket quantization | 32-level kuantizasyon (K-means değil), top-N frekans |
| Perceptual hash | pHash algoritması | Görsel benzerlik karşılaştırma |

### 3.4 Döküman

#### PDF
**Komut:** `extract_pdf_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Sayfa sayısı | /Type /Page sayımı | |
| Title | Info dict | |
| Author | Info dict | |
| Creator | Info dict | Oluşturan uygulama |
| Producer | Info dict | PDF üreten kütüphane |
| Metin uzunluğu | pdf-extract | Karakter sayısı |
| Metin var mı | pdf-extract | Taranmış vs metin tabanlı |

#### DOC / XLS / PPT (OLE/CFB Formatı)
**Komut:** `extract_office_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Title | SummaryInformation | OLE property (PID 0x02) |
| Subject | SummaryInformation | OLE property (PID 0x03) |
| Author | SummaryInformation | OLE property (PID 0x04) |
| Keywords | SummaryInformation | OLE property (PID 0x05) |
| Sayfa sayısı | SummaryInformation | OLE property (PID 0x0E) |
| Kelime sayısı | SummaryInformation | OLE property (PID 0x0F) |
| Oluşturma/değiştirme tarihi | SummaryInformation | FILETIME → ISO 8601 |

#### DOCX / XLSX / PPTX (OOXML/ZIP Formatı)
**Komut:** `extract_office_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Title | docProps/core.xml | dc:title |
| Author | docProps/core.xml | dc:creator |
| Subject | docProps/core.xml | dc:subject |
| Keywords | docProps/core.xml | cp:keywords |
| Son değiştiren | docProps/core.xml | cp:lastModifiedBy |
| Tarihler | docProps/core.xml | dcterms:created/modified |
| Sayfa sayısı | docProps/app.xml | Pages |
| Kelime sayısı | docProps/app.xml | Words |
| Slayt sayısı | docProps/app.xml | Slides |
| Sheet isimleri | xl/workbook.xml | XLSX: sheet name listesi |

#### TXT / CSV / RTF
**Komut:** `extract_text_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Satır sayısı | Sayım | |
| Kelime sayısı | Whitespace split | |
| Karakter sayısı | Byte/char count | |
| Encoding | BOM + heuristic | UTF-8, UTF-16 LE/BE, Latin-1/Win-1254 |
| BOM var mı | İlk 3 byte | |
| Önizleme | İlk 5 satır | Max 200 karakter/satır |
| CSV sütun sayısı | İlk satır parse | Delimiter: virgül, noktalı virgül, tab |
| CSV satır sayısı | Sayım | Header hariç |
| RTF dil kodu | \\deflang | LCID → dil adı (TR, EN, DE, FR, RU, ZH, JA, AR) |

### 3.5 Video

#### MP4 / MOV / AVI / MKV / WMV
**Komut:** `extract_video_metadata`
| Metadata | Kaynak | Detay |
|----------|--------|-------|
| Süre | mvhd atom | duration / timescale |
| Genişlik/yükseklik | tkhd veya stsd atom | Piksel cinsinden |
| Codec | stsd atom | fourcc (avc1, hev1, mp4a, vb.) |
| Dosya tipi markası | ftyp atom | isom, mp41, qt, vb. |
| Dosya boyutu | Filesystem | Byte cinsinden |
| Format tespiti | Magic bytes | MP4, AVI (RIFF), MKV (EBML), FLV |

### 3.6 Yedek Dosyalar

#### BAK
**Komut:** `detect_bak_source_type`
| Tespiti Yapılan | Yöntem |
|----------------|--------|
| DWG | "AC" + versiyon header |
| PSD | "8BPS" magic |
| MAX/RVT | OLE/CFB stream analizi |
| DOCX/XLSX/PPTX | ZIP entry analizi |
| PDF | "%PDF" magic |
| BLEND | "BLENDER" magic |
| SKP | "SketchUp" magic |
| TXT | ASCII heuristic |

---

## 4. Veritabanı Şeması

### assets
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | TEXT PK | Benzersiz asset ID |
| file_name | TEXT | Dosya adı |
| file_path | TEXT | Tam dosya yolu |
| file_size | INTEGER | Byte cinsinden |
| file_type | TEXT | DWG, MAX, PDF, vb. |
| category | TEXT | 2D Çizim, 3D Model, Döküman, Render, Fotoğraf, Doku, Video |
| created_at | TEXT | Oluşturma tarihi (ISO) |
| modified_at | TEXT | Değiştirme tarihi (ISO) |
| project_name | TEXT | Proje adı |
| project_phase | TEXT | Konsept, Avan, Ruhsat, Uygulama |
| material_group | TEXT | Beton, Cam, Metal, Ahşap, Taş, Seramik, Kompozit |
| color_theme | TEXT | Sıcak/Soğuk/Monokrom/Toprak/Pastel |
| architectural_style | TEXT | Modern, Minimalist, Endüstriyel, vb. |
| omniclass_code | TEXT | OmniClass kodu |
| is_indexed | INTEGER | 0/1 |
| hash | TEXT | Dosya hash |
| phash | TEXT | Perceptual hash (görsel benzerlik) |
| metadata_json | TEXT | Yapılandırılmış metadata (mevcut) |
| ai_tags_json | TEXT | AI etiketleri |
| color_palette_json | TEXT | Renk paleti |
| thumbnail_url | TEXT | Base64 thumbnail |
| raw_metadata | TEXT | **Yeni** — Ham metadata JSON (tüm çıkarılan veri) |
| metadata_version | INTEGER | **Yeni** — Parser şema versiyonu (default 1) |
| extracted_at | TEXT | **Yeni** — Çıkarma zamanı (ISO) |

### embeddings (v3.0.0+: `archivist_vec.db`)
Vektör depolama (384d text MiniLM, 512d vision CLIP). v3'te bu tablo
ayrı `archivist_vec.db` dosyasındadır; ana DB'den `vec_db_*` Tauri
komutları üzerinden okunur/yazılır. Bkz. Section 4.5.

### text_chunks (v3.0.0+: `archivist_vec.db`)
Paragraf bazlı metin parçaları (PDF/DOCX gövde, DWG text içeriği, AI
metadata özetleri). v3'te bu tablo ayrı `archivist_vec.db` dosyasındadır.

### asset_relations (v3.0.0+: `archivist_vec.db`)
Asset'ler arası ilişki kayıtları (PDF Çıktısı / Render / Versiyon /
Proje Grubu). Otomatik tespit (`detectAndSaveSameStemRelations`) ve
manuel ekleme ile dolar. v3'te ayrı `archivist_vec.db` dosyasındadır.

### fts_chunks (v3.0.0+: `archivist_vec.db`)
SQLite FTS5 virtual table — text_chunks içeriğinin Türkçe-normalize edilmiş
keyword indeksi. Hızlı substring/token-prefix arama için
(`ftsSearchChunksAsync`). v3'te `archivist_vec.db` içindedir.

### tags
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| name | TEXT UNIQUE | Etiket adı |
| color | TEXT | Hex renk kodu (varsayılan: #6366f1) |
| created_at | TEXT | Oluşturma tarihi |

### asset_tags
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| asset_id | TEXT | FK → assets.id (ON DELETE CASCADE) |
| tag_id | INTEGER | FK → tags.id (ON DELETE CASCADE) |
| created_at | TEXT | Atama tarihi |

### favorites
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| asset_id | TEXT PK | FK → assets.id (ON DELETE CASCADE) |
| created_at | TEXT | Ekleme tarihi |

### collections
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Koleksiyon adı |
| color | TEXT | Hex renk kodu (varsayılan: #a855f7) |
| created_at | TEXT | Oluşturma tarihi |

### collection_items
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| collection_id | INTEGER | FK → collections.id (ON DELETE CASCADE) |
| asset_id | TEXT | FK → assets.id (ON DELETE CASCADE) |
| created_at | TEXT | Ekleme tarihi |

### audit_log
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| timestamp | TEXT | ISO 8601 |
| role | TEXT | admin / viewer |
| action | TEXT | SCAN_START, FILE_DELETE, vb. |
| target | TEXT | Dosya yolu veya asset ID |
| detail | TEXT | JSON ek bilgi |
| result | TEXT | SUCCESS / FAIL / CANCELLED |

### users
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | Kullanıcı adı |
| password_hash | TEXT | Şifre hash'i |
| display_name | TEXT | Görünen ad |
| role | TEXT | admin / viewer (varsayılan: viewer) |
| avatar | TEXT | Profil fotoğrafı (base64) |
| is_blocked | INTEGER | 0/1 — engellenmiş kullanıcı |
| created_at | TEXT | Oluşturma tarihi |
| updated_at | TEXT | Son güncelleme tarihi |

### user_messages
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| sender | TEXT | Gönderen kullanıcı adı |
| sender_role | TEXT | admin / viewer |
| recipient | TEXT | Alıcı (null = broadcast) |
| message_type | TEXT | suggestion / private |
| priority | TEXT | normal / important |
| subject | TEXT | Mesaj başlığı |
| body | TEXT | Mesaj içeriği |
| status | TEXT | unread / read / resolved |
| parent_id | INTEGER | FK → user_messages.id (yanıt zinciri) |
| created_at | TEXT | Gönderim tarihi |

**Mesajlaşma kuralları:** Günlük limit 20 mesaj/kullanıcı. Viewer→Admin ve Admin→Viewer çift yönlü. Yanıt zinciri `parent_id` ile.

### approval_log
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| asset_id | TEXT | FK → assets.id |
| from_status | TEXT | Önceki onay durumu |
| to_status | TEXT | Yeni onay durumu |
| reason | TEXT | Red sebebi (varsa) |
| changed_by | TEXT | Değişikliği yapan kullanıcı |
| changed_at | TEXT | Değişiklik tarihi (ISO) |

### dwg_shapes
| Sütun | Tip | Açıklama |
|-------|-----|----------|
| id | INTEGER PK | Auto-increment |
| asset_id | TEXT | FK → assets.id |
| shape_type | TEXT | CIRCLE, LWPOLYLINE, ARC, vb. |
| vertex_count | INTEGER | Köşe noktası sayısı |
| is_closed | INTEGER | 0/1 — kapalı şekil mi |
| bbox_x/y/w/h | REAL | Bounding box |
| vertices_json | TEXT | Köşe noktaları JSON |

### Veritabanı Güvenlik Notları
- `PRAGMA foreign_keys = ON` her init'te çalıştırılır (sql.js'te varsayılan kapalı)
- Silme işlemleri `BEGIN TRANSACTION` / `COMMIT` ile atomik yapılır
- `saveDatabase()` hata durumunda kullanıcıya bildirim (NotificationCenter) gönderir
- `saveDatabase()` eşzamanlı çağrılarda `_savePending` guard ile çift yazma önlenir
- API anahtarları localStorage'a yazılmaz (persist sırasında filtrelenir)
- DB init 30 saniye timeout ile korunur
- Tag batch sorgu: `getTagsForAssets()` ile N+1 sorgu önleme (500'lük chunk)
- **v3.0.0:** Per-arşiv yazma kilidi (`DB_WRITE_LOCK` canonical-path keyli registry, `ollama_db.rs`)
- **v3.0.0:** WAL journal default açık, UNC ağ tespiti otomatik DELETE moda düşer
- **v3.0.0:** Migration disk-write fail'da akış DUR, in-memory state diskle yeniden hizalanır (sahte-başarı önleme)

---

## 4.5 V3 Vektör Veritabanı (`archivist_vec.db`)

v3.0.0 ile birlikte aşağıdaki tablolar `archivist.db`'den ayrılarak
ayrı bir SQLite dosyasında tutulmaktadır:

- `embeddings` — vektör blob'ları (384d MiniLM / 512d CLIP)
- `text_chunks` — belge gövde metni ve metadata özet chunk'ları
- `asset_relations` — asset'ler arası ilişki kayıtları
- `fts_chunks` — FTS5 keyword index (Türkçe ASCII-normalize)
- `migration_progress` — migration ilerleme kayıtları (epoch durumu)
- `index_meta` — HNSW ANN indeks metadata

### Şema Versiyonlama — Epoch

`archivist.db` üzerinde `PRAGMA user_version` ile takip edilir. v3'e
geçişte epoch aşamalı olarak ilerler:

| Epoch | Anlamı | Hangi Tablolar vec.db'de? |
|-------|--------|---------------------------|
| 0 | v2 monolit (eski) | Hiçbiri — hepsi `archivist.db`'de |
| 1 | embeddings taşındı | embeddings |
| 2 | text_chunks taşındı | embeddings + text_chunks + fts_chunks |
| 3 | asset_relations taşındı | hepsi (V3 hedef) |

### Migration Akışı

`runV3EpochMigration` frontend orchestrator + Rust finalize:

1. `vec_db_premigrate_backup` — `archivist.db` → `*_premigrate_v3.db.bak`
2. `vec_db_migrate_embeddings` (epoch 0 → 1)
3. `vec_db_verify_embeddings` — round-trip kontrol
4. `vec_db_migrate_text_chunks` (epoch 1 → 2) + FTS rebuild
5. `vec_db_verify_text_chunks`
6. `vec_db_migrate_asset_relations` (epoch 2 → 3)
7. `vec_db_verify_asset_relations`
8. `vec_db_finalize_main_migration` — rusqlite ile DROP×3 + VACUUM +
   `PRAGMA user_version = 3` atomik
9. `reloadDatabase` — frontend in-memory state'i diskten yeniden okur

> Tüm aşamalar **idempotent** — herhangi bir adımda hata olursa
> migration durdurulur, `.bak`'ten rollback mümkün, mevcut V3 verisi
> kaybedilmez.

### Tauri Komutları (vec_db ailesi)

| Kategori | Komut Örnekleri |
|----------|-----------------|
| Migration | `vec_db_migrate_embeddings`, `vec_db_migrate_text_chunks`, `vec_db_migrate_asset_relations`, `vec_db_finalize_main_migration` |
| Verify | `vec_db_verify_embeddings`, `vec_db_verify_text_chunks`, `vec_db_verify_asset_relations` |
| Backup | `vec_db_premigrate_backup` |
| Okuma | `vec_db_chunk_embeddings`, `vec_db_chunks_by_ids`, `vec_db_chunks_by_asset`, `vec_db_fts_search`, `vec_db_asset_relations`, `vec_db_chunk_stats` |
| Yazma | `scan_write_batch` (epoch'a göre vec.db'ye yönlenir), `vec_db_cascade_delete`, `vec_db_export_assets`, `vec_db_import_assets`, `vec_db_delete_metadata_chunks` |
| İndeks | `vector_index_rebuild` (HNSW ANN), `vec_db_progress` |
| Güvenlik | `vec_db_purge_orphans`, `vec_db_rollback` |

### Per-Arşiv Yazma Kilidi

Birden fazla arşivle eşzamanlı çalışma için yazma yolları artık dosya
bazlı kilit kullanır (`DB_WRITE_LOCK: HashMap<PathBuf, Arc<Mutex<()>>>`).
Kanonik yol anahtarıdır:

- Vec.db ops için anahtar = `vdb` (varolan vec.db dosyası)
- Ana DB yazma için anahtar = `main`
- HNSW indeks build için anahtar = `vec_db` (datamap dosyası)
- Rollback için anahtar = `main`
- Arşiv import için anahtar = `db_path`

---

## 5. Arama Sistemi

### Üç Katmanlı Hibrit Arama

1. **Keyword** — Kelime eşleşmesi (boundary detection, exact match bonus +0.2, fuzzy Levenshtein)
2. **Semantik** — Embedding cosine similarity (MiniLM 384d, threshold 0.12–0.45)
3. **Görsel** — CLIP embedding benzerliği (512d, sensitivity slider)

### Boolean Arama Operatörleri
`AND`, `OR`, `NOT` operatörleri ve `"tırnak"` ile frase arama desteklenir. Parser: `tokenizeBoolQuery` → `parseBoolExpr` → `evalBoolExpr`. Operatörler büyük harfle yazılmalıdır.

### Fuzzy (Bulanık) Arama
Levenshtein distance tabanlı. 4+ karakterli kelimelerde max %30 hata toleransı. `fuzzyWordMatch()` fonksiyonu sliding window ile en yakın eşleşmeyi bulur.

### Kısa Kod Desteği
Tire/nokta içeren kısa dosya kodları (A1-c3, P2.dwg) tokenizer'dan önce doğrudan substring olarak aranır. Min kelime uzunluğu: 2 karakter (mimari kodlar için).

### DWG Yapısal Benzerlik
CAD dosyaları için CLIP yerine 5 boyutlu composite scoring: katman yapısı, blok yapısı, metin içeriği, şekil verileri, pHash. `search_shapes_by_similarity` ve `search_shapes_by_features` Rust komutları ile backend scoring.

### Tarih Aralığı Filtresi
`modifiedAt` bazlı tarih filtresi. `DateRangeFilter` bileşeni ile başlangıç/bitiş tarihi seçimi.

### Sıralama
- Eşleşme skoru (varsayılan), değiştirilme tarihi, dosya adı, dosya boyutu
- Secondary sort: aynı skordaki sonuçlarda dosya adına göre ikincil sıralama
- Seçili klasör boost: arama aktifken seçili klasördeki sonuçlara +0.12 sıralama avantajı

### Filtre Preset'leri
Filtre kombinasyonlarını (facet + etiket + tarih + arama terimi) preset olarak kaydedip tek tıkla geri yükleyebilme.

### Türkçe Mimari Terimler Sözlüğü
40+ eşanlamlı grup (kural tabanlı, LLM değil). Örnek: "mukarnas" → "stalaktit", "honeycomb vault", "geometric carving"

### Arama Hassasiyeti (0–100)
- 0% = Gevşek eşleşme (semantic threshold 0.15)
- 100% = Katı eşleşme (semantic threshold 0.45)

---

## 6. Loglama Sistemi

| Katman | Depolama | İçerik | Saklama |
|--------|----------|--------|---------|
| Audit Log | SQLite tablosu | Kullanıcı aksiyonları | Kalıcı (admin silebilir, silme de loglanır) |
| System Log | Dosya (Rust tracing) | Hata, uyarı, performans | 7 gün rotasyon |
| Debug Log | Konsol + dosya | Geliştirici detayları | Dev modda aktif |

**Arama terimleri loglanmaz** (gizlilik kararı).

---

## 7. TaskRunner

Uzun süren işlemler için merkezi yönetici.

- **Tek task** — bir seferde sadece bir uzun işlem
- **Durum akışı:** PENDING → RUNNING ⇄ PAUSED → COMPLETED | CANCELLED | FAILED
- **Otomatik hesaplama:** Elapsed time, progress %, ETA, hız (öğe/s)
- **Task geçmişi:** Kalıcı, kullanıcı silene kadar
- **UI:** Alt bar'da aktif task + bildirim merkezinde geçmiş
- **NotificationCenter entegrasyonu:** Task tamamlandığında `notifyTaskComplete()`, hata aldığında `notifyTaskFailed()` otomatik çağrılır

---

## 8. Undo/Redo

Command Pattern ile her kullanıcı aksiyonu geri alınabilir.

- **Stack limiti:** Son 50 işlem
- **Dosya silme:** Soft delete — `.archivistpro-trash/` klasörüne taşınır
- **DB Snapshot:** Tarama/indeksleme öncesi otomatik yedek, arşiv başına son 5 tutulur. Ana arşiv (`backups/`) admin-only; yerel arşiv (`backups-local/`) tüm kullanıcılar tarafından yönetilebilir
- **Undo edilemez:** Tarama, çöp kutusu boşaltma, export (öncesinde uyarı)
- **Klavye:** Ctrl+Z (undo), Ctrl+Y (redo)

---

## 9. AI / ML Entegrasyonu

### 9.1 Tarayıcı İçi Modeller (Gizlilik — veri dışarı çıkmaz)

| Model | Boyut (q8) | Kullanım |
|-------|-----------|----------|
| Xenova/paraphrase-multilingual-MiniLM-L12-v2 | ~46MB | Metin embedding (384d, 50+ dil) |
| Xenova/clip-vit-base-patch32 | ~300MB | Görsel embedding (512d) |

Modeller q8 quantized varsayılan paketle gelir. Yüksek doğruluk isteyen
kullanıcı fp32 sürümleri `npm run models:download:fp32` ile harici indirip
`public/models/` altına yerleştirebilir (MSI'da fp32 paketlenmez — boyut).

### 9.2 HNSW ANN Vektör İndeksi (v3.0.0+)

Büyük embedding kümelerinde (1M+ ölçek) brute-force cosine yerine
HNSW (Hierarchical Navigable Small World) yaklaşık-en-yakın-komşu
indeksi kullanılır.

| Parametre | Değer | Not |
|-----------|-------|-----|
| Crate | `hnsw_rs` 0.3 | Rust |
| Distance | Dot product (normalize edilmiş cosine) | |
| `M` | 16 | Bağlantı sayısı |
| `ef_construction` | 200 | Build kalitesi |
| `ef_search` | 200 | Sorgu hassasiyeti |
| Persistans | datamap mmap dosyası | `archivist_vec.db.idx.*` |
| Build trigger | `vector_index_rebuild` Tauri komutu | Asenkron |

**Performans (1M × 384d, release build, gerçek anonim arşiv):**
- Build: ~21 dakika (parallel_insert chunked)
- Reload: ~21 saniye (datamap mmap)
- Latency: p50 ≈ 9 ms, p99 ≈ 10 ms
- Recall@10 (mesafe-tabanlı, ANN-benchmark): 0.9810

### 9.3 Opsiyonel Harici AI

| Sağlayıcı | Kullanım | Timeout |
|-----------|----------|---------|
| Ollama (lokal) | LLaVA/Moondream vision analizi, RAG chat (Llama3/Qwen2.5/Mistral) | 90-120s |
| Google Gemini | Cloud vision analizi | 45s (fetchWithTimeout) |
| OpenAI GPT-4V | Cloud vision analizi | 60s (fetchWithTimeout) |
| Groq | Hızlı inference alternatifi | 60s (fetchWithTimeout) |

### 9.4 RAG (Retrieval-Augmented Generation) Pipeline

1. **Intent detection** — `detectGreeting`, `detectListIntent`
   (Türkçe soru-eki "mı/mi/mu" yapıştırma dahil, v3.0.0)
2. **List intent bypass** — yes/no soruları doğrudan
   `directFileListAnswer` ile yanıtlanır (LLM çağrısı yok)
3. **Query enrichment** — `enrichQuery` (eş anlamlı + İng karşılık)
4. **Retrieve** — FTS5 + embedding cosine union, top-K=20 aday
5. **LLM rerank** (opsiyonel) — Ollama chat ile yeniden sıralama, top-8
6. **Prompt assembly** — `buildPrompt` Türkçe kaynak-zorlamalı
7. **Generate** — Ollama `ollama_proxy` streaming

---

## 10. Proje Yapısı

```
src/
├── permissions/          Rol bazlı erişim kontrolü
│   ├── roles.ts          Yetki tanımları
│   ├── usePermission.ts  React hook'ları
│   └── ProtectedAction.tsx  UI wrapper
├── components/  (30)     React bileşenleri
│   ├── StatusBar.tsx     Alt bar: task ilerleme + bildirim merkezi
│   ├── AssetCard.tsx     Grid kart bileşeni
│   ├── AssetTagsPanel.tsx Etiket/favori paneli (DetailPanel alt bileşeni)
│   ├── ConfirmDialog.tsx Tehlikeli işlemler için onay diyaloğu
│   ├── DetailPanel.tsx   Dosya detay paneli
│   ├── ErrorBoundary.tsx React hata sınırlayıcı (uygulama geneli)
│   ├── ModalErrorBoundary.tsx Modal-özel hata sınırlayıcı
│   ├── ExplorerView.tsx  Grid kart görünümü
│   ├── FeedbackModal.tsx Kullanıcı geri bildirim/mesaj
│   ├── LoginScreen.tsx   Giriş ekranı (RBAC, ForgotPassword entegre)
│   ├── FirstRunSetup.tsx İlk çalışma admin hesap oluşturma ekranı
│   ├── ForgotPassword.tsx Şifre kurtarma (recovery.key doğrulama → yeni şifre)
│   ├── MainViewContainer.tsx Ana görünüm konteyner
│   ├── ModalPortal.tsx   Modal portal yönetimi
│   ├── SetupWizard.tsx     İlk çalışma kurulum sihirbazı (4 adım)
│   ├── PerformanceSetupModal.tsx Donanım profili ayarları
│   ├── SettingsModal.tsx Genel ayarlar
│   ├── SidebarConfigModal.tsx Sidebar facet yapılandırma
│   ├── Sidebar.tsx       Filtreler, arama, facet'ler
│   ├── Toast.tsx         Ephemeral bildirim bileşeni
│   ├── TopBar.tsx        Görünüm, refile, AI, help, export butonları
│   ├── UserManagementModal.tsx Kullanıcı CRUD (admin)
│   ├── UserProfileModal.tsx Profil düzenleme
│   ├── LanSharingPanel.tsx LAN paylaşım paneli (sunucu/istemci)
│   └── ...               (+ ScanModal, RefileModal, HelpPanel, LogViewerModal, TrashModal, DashboardView, TechnicalView, StorageWarningBanner, AISettingsModal)
├── hooks/       (11)     Custom hook'lar
│   ├── useAppInitialization.ts  Uygulama başlatma
│   ├── useScanWorkflow.ts       Tarama akışı
│   ├── useImageSearch.ts        Görsel arama
│   ├── useEmbeddingSearch.ts    Semantik arama
│   ├── useHybridFilteredAssets.ts Hibrit filtreleme
│   ├── useDatabaseAssets.ts     DB asset yükleme
│   ├── useAssetDeletion.ts      Asset silme
│   ├── useStorageWarning.ts     Depolama uyarısı
│   ├── useStorePersistence.ts   Store kalıcılık
│   ├── usePerformanceSetup.ts   Donanım profili
│   ├── useFocusTrap.ts          Erişilebilirlik focus trap
│   ├── useOllamaStatus.ts      Periyodik Ollama sağlık kontrolü
│   ├── useAssetContextMenu.ts  AssetCard sağ-tık bağlam menüsü
│   ├── useExitConfirmation.ts  Uygulama kapanmadan önce onay
│   ├── useSessionTimeout.ts    Oturum zaman aşımı izleme
│   ├── useBackupScheduler.ts   Zamanlanmış DB snapshot
│   ├── useDevFeedbackReceiver.ts LAN dev feedback alıcı
│   └── useUpdateChecker.ts     Otomatik güncelleme kontrolü
├── services/    (47)     İş mantığı
│   ├── database.ts       SQLite CRUD + çift DB + transaction
│   ├── userService.ts    Auth, RBAC, kullanıcı CRUD
│   ├── messageService.ts Çift yönlü mesajlaşma (viewer↔admin)
│   ├── logger.ts         3 katmanlı loglama
│   ├── taskRunner.ts     Uzun işlem yönetimi
│   ├── notificationCenter.ts Bildirim merkezi (autoDismiss, max 100, TaskRunner entegre)
│   ├── undoRedo.ts       Command Pattern
│   ├── trash.ts          Soft delete çöp kutusu
│   ├── dbSnapshot.ts     DB yedekleme
│   ├── tagService.ts     Etiket CRUD + asset ilişkisi
│   ├── favorites.ts      Favoriler + koleksiyonlar
│   ├── batchActions.ts   Toplu işlemler
│   ├── searchHistory.ts  Arama geçmişi + kayıtlı aramalar
│   ├── keyboardShortcuts.ts Klavye kısayolları
│   ├── helpSystem.ts     Context-aware yardım
│   ├── exportService.ts  CSV/JSON export + rapor
│   ├── archiveShare.ts   Arşiv export/import (.archivistpro)
│   ├── lanService.ts     LAN istemci servisi (ping, manifest, download)
│   ├── fileScanner.ts    Dosya tarama
│   ├── embeddings.ts     ML model yönetimi
│   ├── vision.ts         AI vision analizi
│   ├── imageHash.ts      Perceptual hash + Hamming distance
│   ├── ocr.ts            Ollama LLM tabanlı OCR (llava/moondream)
│   ├── textChunking.ts   Metin parçalama (embedding için)
│   ├── tauriMock.ts      Web geliştirme mock katmanı
│   ├── hardwareDetect.ts Donanım profilleme
│   ├── systemCheck.ts    Sistem kontrol (WASM, OS, disk, wizard flag)
│   ├── recoveryService.ts Şifre kurtarma (recovery.key oluştur/oku/yaz)
│   ├── themeService.ts   Açık/koyu tema desteği
│   ├── queryExpansion.ts Türkçe mimari terim genişletme
│   ├── archiveOps.ts    Arşiv birleştirme/çıkarma (Join/Extract)
│   ├── chatExport.ts    Sohbet Markdown dışa aktarma
│   ├── chatStorage.ts   Sohbet oturum/mesaj depolama
│   ├── ragService.ts    RAG pipeline (retrieve + hybrid + rerank)
│   ├── undoCommands.ts  Undo-aware komut wrapper'ları
│   ├── undoRedo.ts      Command Pattern undo/redo yığını
│   ├── visualSearch.ts  CLIP text→image görsel arama
│   ├── ollamaService.ts Ollama API istemcisi + model tespiti
│   ├── duplicateDetection.ts Yinelenen dosya tespiti (pHash)
│   ├── rootTagService.ts Kaynak klasör etiket ilişkisi
│   ├── filterPresets.ts Filtre preset yönetimi
│   ├── ragIndexStatus.ts RAG indeksleme durum takibi
│   ├── dwgShapeIndex.ts DWG şekil indeksleme
│   ├── buildFeatures.ts Derleme zamanı özellik bayrakları
│   ├── crashReporter.ts Crash rapor toplama
│   ├── developerFeedback.ts Geliştirici geri bildirim
│   ├── errorMapper.ts   Hata kodu eşleme
│   └── colorConvert.ts  RAL/NCS renk dönüştürme
├── store/                Zustand state (20+ dilim, useShallow optimizasyonlu)
├── utils/       (5)      Yardımcı fonksiyonlar
│   ├── colorConvert.ts   Renk dönüştürme (RAL/NCS)
│   ├── fetchWithTimeout.ts AbortController tabanlı fetch timeout wrapper
│   ├── invokeWithTimeout.ts Tauri invoke timeout wrapper
│   ├── markdownRenderer.ts Markdown render (DOMPurify sanitize)
│   └── searchScoring.ts  Arama puanlama
└── tests/       (49)     Vitest test dosyaları

src-tauri/src/
├── main.rs               Tauri bootstrap (6 satır)
├── lib.rs                Komut registry + Tauri setup (200 satır)
├── thumbnails.rs         Thumbnail oluşturma (821 satır)
├── max_version.rs        MAX versiyon + metadata + dönüştürme (746 satır)
├── office_utils.rs       Office metadata + BAK tespiti (526 satır)
├── dwg_parse.rs          DWG binary parse (446 satır)
├── video_metadata.rs     Video/MP4 atom parse (409 satır)
├── skp_version.rs        SKP versiyon + metadata (358 satır)
├── text_extract.rs       DWG/PDF metin çıkarma (356 satır)
├── image_analysis.rs     EXIF + renk + pHash + metadata (320 satır)
├── ollama_db.rs          Ollama proxy + DB I/O + path validation + local DB + recovery key (326 satır)
├── pdf_metadata.rs       PDF metadata (167 satır)
├── text_metadata.rs      TXT/CSV/RTF metadata (131 satır)
├── refile_fs.rs          Dosya reorganizasyonu + path traversal koruması (102 satır)
├── archive_share.rs      Arşiv export/import (.archivistpro ZIP formatı) (120 satır)
├── lan_server.rs         LAN mini HTTP sunucu (tiny_http, port 9471) (312 satır)
├── thumb_util.rs         Thumbnail yardımcıları (19 satır)
├── shape_match.rs        Kontur tabanlı şekil çıkarma/eşleştirme
├── oda_converter.rs      ODA FileConverter entegrasyonu
├── crash_report.rs       Crash rapor dosya işleme
├── dxf_parse.rs          DXF dosya parse
├── ifc_metadata.rs       IFC (BIM) metadata çıkarma
├── rvt_metadata.rs       Revit metadata + thumbnail çıkarma
└── trash.rs              Çöp kutusu (soft delete) Rust tarafı
```

---

## 11. Rust Tauri Komutları

### Shared (Her iki rol)
`get_file_metadata`, `get_max_version`, `extract_max_metadata`, `get_skp_version`, `extract_skp_metadata`, `generate_thumbnail`, `get_psd_thumbnail`, `get_dwg_thumbnail`, `get_max_thumbnail`, `get_office_thumbnail`, `get_pdf_thumbnail`, `get_text_thumbnail`, `get_doc_icon_thumbnail`, `get_eps_thumbnail`, `get_office_dates`, `get_dwg_creation_date`, `detect_bak_source_type`, `get_image_dimensions`, `get_image_exif`, `get_dominant_colors`, `compute_image_phash`, `compute_image_phash_from_bytes`, `hamming_distance`, `extract_dwg_metadata`, `extract_pdf_metadata`, `extract_video_metadata`, `extract_office_metadata`, `extract_text_metadata`, `extract_image_metadata`, `show_in_folder`, `open_file_native`, `ollama_proxy`, `ollama_ping`, `read_database`, `write_database`, `read_local_database`, `write_local_database`, `set_database_path`, `set_local_database_path`, `get_database_info`, `get_local_database_info`, `extract_text_for_indexing`, `write_system_log`, `export_archive`, `peek_archive_manifest`, `import_archive`, `lan_start_server`, `lan_stop_server`, `lan_get_server_status`, `read_recovery_key`, `write_recovery_key`

### Admin Only
`convert_max_version`, `detect_max_installations`, `is_max_running`, `convert_max_real`, `refile_organize`

---

## 12. Güvenlik ve Kod Kalitesi (Audit Faz 1-5)

### 12.1 XSS Koruması
- Markdown renderer DOMPurify ile sanitize edilir (`markdownRenderer.ts`) — whitelist tabanlı tag/attr filtresi
- Tüm kullanıcı girdisi HTML escape'den geçer
- `dangerouslySetInnerHTML` çıktısı DOMPurify'dan geçirilir

### 12.2 RBAC Permission Guard
- `roles.ts` — Build-time yetki matrisi, runtime doğrulama
- Modal'lar ve aksiyonlar `usePermission` hook ile korunur

### 12.3 Hata Sınırlayıcılar
- `ErrorBoundary.tsx` — Uygulama geneli React error boundary
- `ModalErrorBoundary.tsx` — Modal-özel error boundary (modal çökmesi uygulamayı etkilemez)

### 12.4 Rust Buffer Safety
- Tüm buffer okuma işlemleri `MAX_STREAM_SIZE` (50MB) ile sınırlandırılır
- `image_analysis.rs`, `pdf_metadata.rs`, `thumbnails.rs`, `video_metadata.rs` — bounds check eklendi
- `office_utils.rs` — XLSX sheet name parsing `content.get()` ile safe slicing (panic önleme)
- `max_version.rs` — Stream read hataları `log::warn!` ile loglanır, dosya boyut sınırı 500MB
- `skp_version.rs` — `chunks_exact(2)` ile UTF-16LE misalignment koruması

### 12.5 Concurrent Access & Memory
- `database.ts` — Eşzamanlı DB erişiminde `_savePending` guard (çift yazma önleme)
- `fileScanner.ts` — Tarama duraklatıldığında GC-friendly bellek yönetimi
- `favorites.ts` — Dedup koruması (çift ekleme önleme), `deleteCollection` transaction korumalı
- `tagService.ts` — `mergeTags` ve `setTagsForAsset` transaction korumalı

### 12.6 i18n Tamamlama
- Tüm hardcoded Türkçe stringler `t()` çağrılarına taşındı
- Tarih formatları `i18n.language` bazlı dinamik locale kullanır
- Yeni anahtarlar: `common.error.prefix`, `refile.backupFiles`, `logViewer.action.messageDelete`

### 12.7 Performans İyileştirmeleri
- **N+1 Query Düzeltmesi:** `getTagsForAssets()` batch fonksiyonu — 1000 asset = 2 SQL sorgusu (eskiden 1000)
- 500'lük chunk'larla `SQLITE_MAX_VARIABLE_NUMBER` limiti korunur

### 12.8 Timeout Koruması
- `fetchWithTimeout.ts` — AbortController tabanlı fetch timeout wrapper
- Gemini API: 45s timeout
- OpenAI/Groq API: 60s timeout
- Ollama: mevcut `invokeWithTimeout` 90s korunur

### 12.9 Plugin Versiyon Pinleme
- `tauri-plugin-dialog` → `^2.7.0`, `tauri-plugin-fs` → `^2.5.0`, `tauri-plugin-shell` → `"2.2"` minor pin
- Breaking change riskine karşı unpinned `"2"` ifadesi kaldırıldı

### 12.10 Test Kapsaması (98 dosya, 2038 test)

> **Not (2026-05-03):** 2038 test mevcut, **kapsam: stmt %64 / branch %53 / func %79**.
> Kritik business logic (auth, DB CRUD, RAG pipeline, undo/redo, tag, chat export, görsel arama) test edilmektedir.
> React bileşen testleri henüz yok — servis katmanı önceliklidir.

**Framework:** Vitest 4.0, jsdom environment, sql.js in-memory DB, @testing-library/react

**Servis testleri:**
- `databaseCrud.test.ts` — DB CRUD, migration, transaction testleri
- `fileScanner.test.ts` — Dosya tarama, metadata çıkarma, kategorizasyon
- `messageService.test.ts` — Mesajlaşma CRUD, limitleri
- `userService.test.ts` — Auth, RBAC, PBKDF2 hash, kullanıcı CRUD
- `tagService.test.ts` — Tag CRUD, asset-tag ilişki, merge, search (gerçek DB)
- `favorites.test.ts` — Favori ve koleksiyon CRUD, cascade delete
- `logger.test.ts` — Audit log CRUD, clearAuditLogs, performans ölçümü
- `searchHistory.test.ts` — Arama geçmişi, kayıtlı aramalar, localStorage
- `exportService.test.ts` — CSV/JSON export, rapor üretimi, escape
- `notificationCenter.test.ts` — Bildirim CRUD, listener, autoDismiss timer
- `themeService.test.ts` — Dark/light tema, localStorage, DOM attribute
- `helpSystem.test.ts` — Context-aware help, dil değişikliği, kılavuz yolu

**Mantık/algoritma testleri:**
- `embeddings.test.ts` — Cosine similarity, vektör arama
- `queryExpansion.test.ts` — Sorgu genişletme, eş anlamlılar
- `searchScoring.test.ts` — Arama puanlama
- `textChunking.test.ts` — Metin parçalama
- `colorConvert.test.ts` — Renk format dönüşümü
- `markdownRenderer.test.ts` — Markdown→HTML dönüşümü

**Altyapı testleri:**
- `store.test.ts` — Zustand store (52 test)
- `undoRedo.test.ts` — Command Pattern undo/redo
- `batchActions.test.ts` — Toplu işlemler
- `taskRunner.test.ts` — Task pause/resume/cancel/ETA
- `invokeWithTimeout.test.ts` — Tauri komut zaman aşımı
- `hardwareDetect.test.ts` — Donanım algılama
- `database.test.ts` — Vektör encode/decode
- `appVersion.test.ts` — Versiyon yardımcıları
- `utils.test.ts` — Format ve ikon yardımcıları
- `trash.test.ts` — Çöp kutusu: taşı/geri yükle/boşalt (Tauri invoke mock)
- `dbSnapshot.test.ts` — DB snapshot oluştur/listele/geri yükle/sil/prune
- `useFocusTrap.test.ts` — Erişilebilirlik focus trap hook
- `useStorePersistence.test.ts` — localStorage senkronizasyonu (apiKey hariç tutulur)
- `useStorageWarning.test.ts` — Depolama uyarı event'leri ve cleanup
- `usePerformanceSetup.test.ts` — Donanım profil algılama ve performans setup akışı
- `useHybridFilteredAssets.test.ts` — Hibrit filtreleme, selectedAsset, indexingStatus

**Test helper:** `sqlJsTestDb.ts` — Gerçek sql.js in-memory test DB fabrikası

### 12.11 Kritik Güvenlik Düzeltmeleri (2026-04-04)

7 kritik/orta risk güvenlik açığı kapatıldı:

| # | Açık | Risk | Düzeltme |
|---|------|------|----------|
| 1 | CSP `connect-src` wildcard (`http://*:9471`) | HIGH | `localhost:9471` + `127.0.0.1:9471` ile sınırlandırıldı |
| 2 | Asset protocol scope (`$APPDATA/**`) | MEDIUM | `$APPDATA/com.archivistpro.desktop/**` olarak daraltıldı |
| 3 | LAN auth code tahmin edilebilir (nanosaniye seed) | HIGH | `getrandom` CSPRNG ile değiştirildi, fallback olarak eski yöntem korundu |
| 4 | MAXScript command injection (dosya yolları) | HIGH | `validate_maxscript_path()` — çift tırnak, null byte, satır sonu, kontrol karakteri kontrolü |
| 5 | DB path traversal (`canonicalize` fallback) | MEDIUM | Dosya yoksa parent dizin canonicalize → file_name join ile güvenli yol çözümleme |
| 6 | Şifre hash (düz SHA-256) | HIGH | PBKDF2-SHA256, 100K iterasyon, 16-byte random salt. Format: `saltHex:hashHex`. Eski hash otomatik migrate |
| 7 | `fs:scope` tam erişim (`**`) | MEDIUM | `$HOME/**` + `$APPDATA/**` ile sınırlandırıldı (sistem dosyaları erişim dışı) |

**Şifre hash migration stratejisi:**
- Yeni kullanıcılar → PBKDF2-SHA256 hash
- Mevcut kullanıcılar → İlk başarılı login'de otomatik migrate (eski SHA-256 doğrulanır → PBKDF2 hash yazılır)
- Zorunlu şifre sıfırlama yok, geriye dönük uyumlu

**fs:scope kararı:**
- `$HOME/**` — Windows'ta `C:\Users\{kullanıcı}\` altını kapsar (Documents, Desktop, Downloads vb.)
- `$APPDATA/**` — Uygulama veritabanı ve cache için gerekli
- Harici sürücüler (D:\, E:\): Tauri v2 dialog picker geçici izin verir
- Sistem dosyaları (`C:\Windows`, `C:\Program Files`, diğer kullanıcı profilleri) erişim dışı

---

## 13. Uygulanan Özellikler (V2)

- ✅ Etiket (tag) sistemi — kullanıcı custom tag'ler, renk, merge, search
- ✅ Toplu işlem (batch) — çoklu seçim + toplu tag/silme/metadata güncelleme
- ✅ Favoriler & koleksiyonlar — DB tabloları, CRUD
- ✅ Arama geçmişi & kayıtlı aramalar — localStorage, autocomplete
- ✅ Klavye kısayolları sistemi — merkezi registry, Ctrl+Z/Y/K/A, Delete, Escape, F1
- ✅ Bildirim merkezi — TaskRunner entegre, autoDismiss timer, max 100 limit, okundu/okunmadı, tümünü temizle
- ✅ Help sistemi — TR kılavuz (user + admin), context-aware ?, çoklu dil altyapısı
- ✅ Export/rapor — CSV/JSON dışa aktarma, metin rapor
- ✅ MTL (Wavefront Material) metin önizleme + ikon
- ✅ EPS gömülü TIFF preview çıkarma (binary header parse)
- ✅ LAN paylaşım (Faz1) — .archivistpro export/import (Rust backend)
- ✅ LAN paylaşım (Faz2) — Mini HTTP sunucu (tiny_http, port 9471, 8 haneli kalıcı auth kodu)
- ✅ Kullanıcı yönetimi — DB tabanlı auth, RBAC (admin/viewer rolleri), login ekranı, profil paneli
- ✅ Mesajlaşma sistemi — çift yönlü (viewer↔admin), öneri/özel mesaj, yanıt zinciri, günlük 20 mesaj limiti
- ✅ Yerel arşiv konum değiştirme — set_local_database_path, viewer depolama erişimi
- ✅ İkili bildirim mimarisi — Toast (ephemeral, max 5) + NotificationCenter (kalıcı, max 100), error/warning otomatik NotificationCenter'a yönlendirilir
- ✅ Çoklu dil (i18n) — TR/EN, tüm UI stringleri çevrilebilir, dinamik locale
- ✅ Güvenlik audit (Faz 1-5) — XSS koruması, RBAC guard, buffer safety, error boundary, test kapsaması, N+1 query fix, API timeout, Rust error logging
- ✅ Kritik güvenlik düzeltmeleri — CSP daraltma, CSPRNG auth, MAXScript injection koruması, PBKDF2 hash, path traversal fix, fs:scope kısıtlama
- ✅ Ek güvenlik düzeltmeleri — DOMPurify XSS sanitize, MAX dosya boyut sınırı, transaction koruması (tag/collection)
- ✅ Error Boundary tamamlama — 7 modal/panel bileşen ModalErrorBoundary ile sarmalandı
- ✅ Input validation — Username 3-32 karakter, password max 128 karakter sınırı (createUser + updateUser)
- ✅ i18n tamamlama — TopBar "Audit Log" hardcoded string lokalize edildi
- ✅ UTF-8 güvenliği — office_utils.rs XLSX sheet name parsing'de is_char_boundary kontrolü
- ✅ Kurulum Sihirbazı (Setup Wizard) — İlk çalışmada 4 adımlı rehber (sistem kontrol, donanım tespiti, AI kurulum, özet)
- ✅ İlk Çalışma Admin Kurulumu — Kullanıcı tablosu boşsa `FirstRunSetup` ekranı; `ensureDefaultAdmin()` kaldırıldı, hardcoded admin/admin parolası yok
- ✅ Şifre Kurtarma — `recovery.key` (48 hex karakter, AppData'da) → `ForgotPassword` bileşeni: key doğrulama → admin seç → yeni parola
- ✅ ODA FileConverter Dinamik Algılama — `C:\Program Files\ODA\` ve `\ODA\*` alt dizin taraması + Windows Uninstall registry scan (InstallLocation + DisplayIcon)
- ✅ Çoklu Seçim Set→Array — `selectedAssetIds` Zustand state'i `Set<string>` → `string[]` (serializable, devtools uyumlu)
- ✅ Unified AI Setup Wizard — 3 adımlı rehberli AI kurulumu (AISetupWizard + AIStatusBadge)
- ✅ Ollama başlat/durdur — AI Ayarları'ndan doğrudan Ollama kontrolü
- ✅ ChatPanel refactor — 1196→543 satır, 8 alt bileşene bölündü
- ✅ Sohbet Markdown export — chatExport.ts + ChatHeader indirme butonu
- ✅ RAG Faz 3 — LLM reranker + query rewriting + streaming backpressure
- ✅ CLIP görsel arama — text→image + /görsel slash komutu + sohbet entegrasyonu
- ✅ Shape Search — kontur tabanlı DWG şekil eşleştirme (shape_match.rs + ShapeSearchModal)
- ✅ OnboardingTour — ilk kullanıcı için 7 adımlı spotlight rehber
- ✅ FilterPresetSelector — filtre kombinasyonlarını kaydet/yükle/sil
- ✅ EmbeddingProgress — asset-level AI indeksleme ilerleme çubuğu
- ✅ TagManagerModal — etiket silme/düzenleme/birleştirme/renk UI
- ✅ Session timeout + LockScreen — konfigüre edilebilir (5-120dk), SessionWarningToast
- ✅ AdminActivityPanel — son 7 gün admin aktivite özet paneli (DashboardView)
- ✅ Broadcast sistemi — tüm kullanıcılara duyuru gönderme
- ✅ BackupScheduler — otomatik yedekleme (1/4/8/24 saat)
- ✅ UserBatchImport — CSV toplu kullanıcı import
- ✅ PrintReportView — arşiv raporu yazdırma görünümü + @media print CSS
- ✅ VersionTimeline — dosya versiyon zaman çizelgesi
- ✅ DropZone — sürükle-bırak dosya ekleme
- ✅ Concurrent DB safety (P0) — atomic write + fs2 inter-process lock
- ✅ LAN Sharing Phase 2 (P0) — download progress + SHA-256 integrity
- ✅ i18n 5/5 dil %100 — TR/EN/ZH/JA/AR (1825 anahtar)
- ✅ DWG OLE tespiti — gömülü Excel/Word/PDF objeleri
- ✅ Context menü — AssetContextMenu + BlankContextMenu
- ✅ Undo/Redo destructive ops — klasör/asset/grup/sohbet sil Ctrl+Z ile geri alınabilir
- ✅ Pipeline tarama (Aşama 1) — p-limit concurrency, 6-8x throughput artışı
- ✅ Rusqlite inkremental yazma — tarama verisi checkpoint'lerle diske, çökme güvenli
- ✅ Deferred save — saveDatabaseDeferred + kapanışta flushDeferredSave
- ✅ Boolean arama — AND/OR/NOT operatörleri + tırnak frase desteği
- ✅ Fuzzy arama — Levenshtein distance, %30 hata toleransı
- ✅ Tarih aralığı filtresi — modifiedAt bazlı DateRangeFilter
- ✅ DWG yapısal benzerlik — 5 boyutlu composite scoring (CLIP alternatifi)
- ✅ Şekil arama backend scoring — Rust convex hull + Gaussian vertex similarity
- ✅ Onay kuyruğu — Dashboard paneli, toplu onay/red, red sebebi, audit trail
- ✅ XMP sidecar export — standart metadata dışa aktarma
- ✅ Otomatik versiyon kümeleme — 10 pattern (_v1, _Rev-A, _FINAL, _DRAFT vb.)
- ✅ Watch folders (Faz 2) — klasör değişiklik tespiti + opt-in auto-rescan
- ✅ Fixity check — örneklem bazlı bit-rot tespiti
- ✅ Eski format tespiti — Office binary → OOXML önerisi
- ✅ DPAPI LAN auth-code şifreleme — Windows credential store
- ✅ fs:scope deny — hassas dizinler engellendi
- ✅ Login rate-limit — başarısız giriş sonrası hesap kilitleme
- ✅ Tarama raporları — atlanan/hata dosyaların TXT raporu
- ✅ Alt-klasör ağacı — sidebar'da iç içe klasör navigasyonu
- ✅ Kopya bulucu optimizasyonu — O(n²) bucket filter + fingerprint + early termination
- ✅ Ayarlar kart tabanlı UI — yeniden tasarım
- ✅ Retention/lockout/snapshot süreleri konfigürable
- ✅ "Geliştiriciye Bildir" butonu — hata bildirimlerinde
- ✅ F5/Ctrl+R engelleme — webview reload oturum kaybı önleme

## 14. LAN Paylaşım Mimarisi

### Faz 1 — Dosya Tabanlı Export/Import

**Format:** `.archivistpro` (ZIP konteyneri)
- `manifest.json` — Versiyon, uygulama versiyonu, tarih, açıklama, asset sayısı, DB boyutu
- `archive.db` — Ana SQLite veritabanı kopyası

| Komut | İşlev |
|-------|-------|
| `export_archive` | DB'yi ZIP'e paketler, manifest oluşturur |
| `peek_archive_manifest` | ZIP'ten manifest okur (import öncesi önizleme) |
| `import_archive` | ZIP'ten DB çıkarır, mevcut DB'yi `.bak` ile yedekler |

### Faz 2 — LAN Mini HTTP Sunucu

Tamamen offline, ofis içi LAN paylaşımı. İnternet bağlantısı gerektirmez.

```
Admin PC (sunucu)                    Viewer PC (istemci)
┌─────────────────┐  LAN (HTTP)      ┌─────────────────┐
│ lan_server.rs   │ ◄──────────────► │ lanService.ts   │
│ :9471           │                  │ (fetch API)     │
│                 │                  │                 │
│ GET /ping       │ ← bağlantı test │                 │
│ GET /manifest   │ ← arşiv bilgisi │                 │
│ GET /download   │ ← DB indir      │                 │
└─────────────────┘                  └─────────────────┘
```

| Bileşen | Detay |
|---------|-------|
| **HTTP Kütüphanesi** | tiny_http 0.12 (sıfır bağımlılık, senkron API) |
| **Port** | 9471 (sabit) |
| **Güvenlik** | 8 haneli CSPRNG auth kodu (`getrandom`), config'e kalıcı kaydedilir, admin yenileyebilir, `X-Auth-Code` header |
| **CORS** | `Access-Control-Allow-Origin: *` (LAN webview erişimi) |
| **Thread modeli** | Ayrı thread, `Mutex<Option<ServerHandle>>` ile yönetim |
| **IP tespiti** | UDP socket trick (`UdpSocket::connect("192.168.1.1:80")`) |
| **Timeout** | İstemci 15s (ping/manifest), 120s (download) |

**Endpoint'ler:**

| Endpoint | Auth | Yanıt |
|----------|------|-------|
| `GET /ping` | Hayır | `{"status":"ok","appVersion":"2.0.0"}` |
| `GET /manifest` | Evet | `{"version":1,"appVersion":"...","dbSizeBytes":...,"createdAt":"..."}` |
| `GET /download` | Evet | Binary DB stream (`application/octet-stream`) |
| `OPTIONS *` | Hayır | CORS preflight (204) |

**UI (LanSharingPanel.tsx):**
- 3 modlu panel: `idle` → `server` / `client`
- Admin: Sunucu başlat → IP/port/auth kodu göster → Kodu yenile (RefreshCw ikonu) → Durdur
- Viewer: Direkt istemci modu → IP + auth kodu gir → Bağlan → Manifest önizle → İndir

---

## 15. Kurulum Sihirbazı (Setup Wizard)

İlk çalıştırmada kullanıcıyı otomatik sistem taraması ve adım adım kurulum rehberine yönlendirir.

### Akış

```
App açılır → DB init → [Wizard ilk çalışma ise] → LoginScreen → Ana Uygulama
```

Eski kullanıcılar (`archivist_perf_setup_done` veya `archivist_setup_wizard_done` localStorage'da var) wizard'ı görmez.

### Adımlar (4 adım)

| Adım | Başlık | İçerik |
|------|--------|--------|
| 0 | Hoş Geldin + Sistem Kontrolü | WASM desteği, Windows versiyonu, disk alanı tahmini, dil seçimi (TR/EN) |
| 1 | Donanım Tespiti | CPU çekirdek, RAM, benchmark. Low/Mid/High tier seçimi (önerilen vurgulanır) |
| 2 | AI Kurulumu | Ollama otomatik tespit (localhost:11434/api/tags, 5s timeout). 3 seçenek: Yerel AI / Bulut AI / Atla |
| 3 | Hazır! | Özet (seçilen tier + AI modu + sistem durumu), varsayılan giriş bilgileri (admin/admin) |

### Bileşenler

| Dosya | İşlev |
|-------|-------|
| `src/services/systemCheck.ts` | `hasSeenSetupWizard()`, `markSetupWizardSeen()`, `checkWasmSupport()`, `getWindowsVersion()`, `estimateDiskSpace()` |
| `src/components/SetupWizard.tsx` | 4 adımlı wizard UI — StepWelcome, StepHardware, StepAI, StepReady alt bileşenleri |

### Entegrasyon

- `App.tsx` — Wizard guard: `db.dbReady && !wizardDone` ise `<SetupWizard>` gösterilir
- `usePerformanceSetup.ts` — `hasSeenSetupWizard()` kontrolü eklendi (wizard görüldüyse PerformanceSetupModal atlanır)
- Wizard tamamlandığında `markSetupWizardSeen()` + `markPerformanceSetupSeen()` çağrılır
- Tier seçimi store'a `setAiConfig()` ile yazılır

### Ollama Tespit Mantığı

- `fetch('http://localhost:11434/api/tags')` — 5s timeout
- Yanıt başarılı → `models` dizisinden vision modeller filtrelenir (llava, moondream, llama3.2, minicpm, bakllava)
- Yanıt başarısız → "Çalışmıyor veya kurulu değil" durumu
- "Tekrar Kontrol Et" butonu ile tekrar sorgulanabilir

---

## 16. Planlanan Özellikler (İleride)

- Dosya karşılaştırma (diff)
- Mac/Linux desteği
- Lisanslama sistemi (seat/trial)
- ~~FAISS/HNSW vektör indeksi~~ **v3.0.0 ile tamamlandı** (Section 9.2)
- LAN TLS şifreleme
- Authenticode code signing
- `purge_orphans` UI tetik — vec.db'de yetim kalan chunk'ların temizliği
- Per-arşiv epoch (şu an global `_schemaEpoch` yalnız main arşivini yansıtır)
- Cross-archive `asset_relations` kopyası (Join/Extract'ta)

---

*Bu doküman ArchivistPro geliştirme sürecinde güncellenmektedir. Son güncelleme: 2026-05-23 (v3.0.0).*

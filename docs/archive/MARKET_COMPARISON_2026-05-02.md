# ArchivistPro vs Piyasa Liderleri — Kullanıcı İlişkisi Karşılaştırması (Güncel)

> **Analiz tarihi:** 2 Mayıs 2026 · **Versiyon:** 2.4.1 · **Kaynak:** Güncel kod tabanı + son 50 commit

## Referans Platformlar

| Segment | Kimler |
|---|---|
| AEC-spesifik DAM | **OpenAsset**, **Newforma** |
| BIM Doküman Yönetimi | **Autodesk Vault**, **BIM 360 Docs / ACC**, **Trimble Connect** |
| Genel DAM | **Bynder**, **Canto**, **Adobe Bridge**, **Eagle** |

---

## 1. İLK TEMAS VE GÜVEN İNŞASI

### Piyasa Liderleri
- Satış ekibi → demo → pilot → dedicated CSM (Customer Success Manager)
- İlk 30 gün: Onboarding specialist, veri göçü desteği, eğitim webinar'ları
- Güven sinyalleri: SOC 2, GDPR badge, uptime SLA, müşteri logoları
- **Kullanıcı hissi**: "Arkamda bir organizasyon var"

### ArchivistPro (Güncel)
- **3 adımlı Setup Wizard**: Dil seçimi → sistem kontrol (WASM, disk) → gereksinim listesi (Ollama, ODA) + özet
- **AI Setup Wizard**: Model adı göstermeden "Metin modeli: Hazır ✓" şeklinde soyutlanmış — teknik olmayan kullanıcı için tasarlanmış
- **7 adımlı OnboardingTour**: Spotlight efekti ile tarama → arama → görünüm modları → AI chat → ayarlar turu, klavye navigasyonu (ok tuşları, Enter, Escape)
- **Güven sinyali**: Offline-first mimarinin kendisi bir güven sinyali (veri asla dışarı çıkmıyor), ama bu kullanıcıya yeterince anlatılmıyor
- **Kullanıcı hissi**: "Adım adım kurdum, çalışıyor" — ama ilk kurulumda Ollama/ODA gibi dış bağımlılıklar korkutucu olabilir

**Verdikt**: ArchivistPro'nun onboarding'i teknik derinlikte rakiplerden iyi (çoğu SaaS DAM'da wizard bu kadar detaylı değil). Ama "neden bu programa güvenmeliyim" sorusuna — landing page, referans, sertifika gibi — cevap eksik. Bu bir yazılım mühendisliği değil pazarlama meselesi.

---

## 2. GÜNLÜK KULLANIM DENEYİMİ

### Arama ve Keşif

| Yetenek | OpenAsset | Bynder | Adobe Bridge | **ArchivistPro** |
|---|---|---|---|---|
| Metin arama | ✓ | ✓ | ✓ | ✓ |
| Faceted filtre | ✓ | ✓ | Sınırlı | ✓ (proje, faz, malzeme, stil, renk, tip) |
| Kayıtlı arama | ✓ Smart Albums | ✓ | ✓ Smart Collections | ✓ FilterPresetSelector |
| AI semantik arama | Eklenti | Ek ücret | Yok | **✓ Offline MiniLM (384-dim, 50+ dil)** |
| Görsel benzerlik | Yok | Ek ücret | Yok | **✓ Offline CLIP (text→image + image→image)** |
| DWG/MAX/RVT metadata | Yok | Yok | Yok | **✓ Binary parsing (katman, obje, OLE, versiyon)** |
| Arama geçmişi | ✓ | ✓ | ✓ | ✓ Dropdown + temizle |

**ArchivistPro'nun farkı**: AEC format derinliği + tam offline AI araması. Bir mimarlık ofisinde "cam cepheli bina çizimleri" yazdığında, semantik olarak ilgili DWG/PDF/render dosyalarını bulan tek araç bu. Rakipler ya AEC formatlarını tanımıyor (Bynder, Bridge) ya da AI aramayı bulut+ek ücret olarak sunuyor.

### Geri Bildirim Döngüsü

| Yetenek | Rakipler (genel) | **ArchivistPro** |
|---|---|---|
| İşlem sonrası toast | ✓ | ✓ (4 tip: success, error, warning, info + aria-live) |
| Undo/Redo | Sınırlı | **✓ Command Pattern, 50 stack** (klasör sil, asset sil, grup sil, sohbet sil) |
| Sağ-tık bağlam menüsü | ✓ | ✓ (AssetCard + boş alan, viewport clamp, portal render) |
| Klavye kısayolları | ✓ | ✓ (Ctrl+Z/Y, Ctrl+K, Delete, Escape + Help panelinde liste) |
| İlerleme göstergesi | ✓ | ✓ (Tarama, embedding, fixity check — hepsi iptal edilebilir) |

**Verdikt**: Günlük kullanım konforu rakiplerle aynı seviyede. Undo/redo derinliği (destructive ops dahil) çoğu DAM'dan üstün.

---

## 3. VERSİYON YÖNETİMİ VE İŞ AKIŞI

### Autodesk Vault / BIM 360
- Check-in/check-out kilitlemesi
- Görsel versiyon ağacı (v1 → v2 → REV-A → APPROVED)
- Lifecycle states: WIP → Review → Approved → Released
- Revizyon karşılaştırması (side-by-side diff)

### OpenAsset
- Upload yeni versiyon → eski korunur → karşılaştırma
- Approval workflow: Submit → Review → Approve/Reject

### ArchivistPro (Güncel — v2.4.1)
- **Otomatik versiyon kümeleme** (`versionDetection.ts`): 10 pattern tanıma:
  - `_v1`, `-v02`, `_V3` → numerik versiyon
  - `_Rev-A`, `_RevB` → revizyon harfleri (A=1, B=2, AA=27 sıralamalı)
  - `_R01`, `_R02` → revizyon numaraları
  - `_FINAL`, `_SON` → final işaretçileri
  - `_DRAFT`, `_TASLAK` → taslak işaretçileri
  - `_eski`, `_old`, `_yeni`, `_new` → eski/yeni
  - `(1)`, `(2)`, `(Copy)`, `(Kopya)` → Windows kopya desenleri
  - Sondaki sayılar: `plan2`, `plan3`
- Aynı klasör + aynı baseName + aynı tip → `version_of` ilişkisi otomatik
- Asset kartlarında **versionLabel chip'i** görünür
- **Onay Kuyruğu** (Dashboard): 4 durum (draft / review / approved / rejected)
  - Review bekleyenler listesi (max 20, scrollable)
  - Toplu "Tümünü Onayla" / "Tümünü Reddet"
  - DetailPanel'den tekil durum değişikliği + toast bildirimi

**Verdikt**: v2.4.1 ile pattern-based otomatik kümeleme var ve mimarlık iş akışına özgü (REV-A, SON, TASLAK). **Ama**: Check-in/check-out kilidi yok, görsel diff/karşılaştırma yok, lifecycle state geçiş kuralları (ör. "DRAFT'tan doğrudan APPROVED'a geçilemez") yok. Vault/BIM 360'a göre henüz basit; OpenAsset seviyesine yaklaşıyor.

---

## 4. İŞBİRLİĞİ VE PAYLAŞIM

### BIM 360 / Procore / Trimble Connect
- Bulut tabanlı, gerçek zamanlı eş erişim
- Dosya üstüne pin + markup + yorum
- @mention → e-posta + in-app bildirim
- Eş zamanlı düzenleme koruması

### ArchivistPro (Güncel)

| Yetenek | Durum | Detay |
|---|---|---|
| **LAN paylaşım** | ✓ Mature | Admin sunucu açar → viewer bağlanır → arşiv indirir. SHA-256 bütünlük doğrulaması. DPAPI ile auth-code şifreli. |
| **Mesajlaşma** | ✓ Mature | 5 mesaj tipi (suggestion, private, request, broadcast, developer). Threaded yanıtlar. |
| **Talep/Claim** | ✓ Mature | Viewer talep gönderir → admin havuzu → "Üstlen" / "Bırak" → çözüldü olarak kapat |
| **Broadcast** | ✓ Functional | Admin → tüm kullanıcılara duyuru (öncelik: normal/önemli) |
| **Rol hiyerarşisi** | ✓ Mature | Kurucu → Admin → Viewer, ProtectedAction ile granüler UI kontrolü |
| **Gerçek zamanlı** | ✗ | Async threaded mesajlaşma, gerçek zamanlı chat değil |
| **Dosya üstü yorum** | ✗ | Markup/annotation yok |
| **Dış paylaşım linki** | ✗ | Müşteriye/müteahhide doğrudan link yok |

**Verdikt**: ArchivistPro "birlikte erişme + asenkron iletişim" sunuyor. LAN paylaşım + mesajlaşma + talep sistemi bir mimarlık ofisinin iç koordinasyonu için yeterli. Ama "müşteriye 5 render gönder" veya "müteahhide çizimi yorumla" gibi dışa dönük senaryolarda programdan çıkmak gerekiyor. Rakipler bu noktada çok önde.

---

## 5. HATA ANINDA İLİŞKİ

### Piyasa Liderleri
- In-app chat support (Intercom/Zendesk)
- Veri kaybında dedicated recovery ekibi
- Status page + e-posta bildirim + ETA

### ArchivistPro (Güncel)

| Katman | Ne Yapıyor |
|---|---|
| **ErrorBoundary** | React hata yakalar → kullanıcı dostu mesaj + "Yeniden Yükle" / "Devam Et" butonları |
| **errorMapper** | Tauri teknik hatalarını lokalize eder ("Permission denied" → "Erişim engellendi") |
| **Crash reporter** | Crash raporu diske yazar (hata tipi, stack trace, OS bilgisi, bellek kullanımı) |
| **Notification center** | 4 tip bildirim (info/success/warning/error), badge sayacı, max 100/oturum |
| **Veri güvenliği** | Checkpoint (1-100 dosyada bir) + rusqlite inkremental yazma + atomic write + fsync + pre-restore yedek |
| **Audit log** | Her işlem kaydedilir + tamper marker'ları (silme bile iz bırakır) |
| **Snapshot** | Her tarama/import öncesi otomatik yedek + konfigüre edilebilir tutma süresi (3-30) |

**Verdikt**: Veri korumasında ArchivistPro sektörde en paranoyak seviyede. 3060 dosya kaybı olayından sonra yapılan rusqlite inkremental yazma + checkpoint + pre-restore yedek zinciri, Vault/BIM 360'ın bile sunmadığı bir dayanıklılık katmanı. **Ama** kullanıcı hata aldığında "bunu kime bildireyim?" sorusuna cevap yok — in-app "Sorun Bildir" butonu crash raporu oluştursa da bunu gönderecek bir kanal yok.

---

## 6. KULLANICININ KENDİNİ İFADE ETMESİ VE ARŞİVİNİ SUNMASI

### Bynder / Canto
- Koleksiyon/lightbox → sürükle bırak → paylaşım linki
- Brand portal: dış paydaşlara vitrin
- Detaylı raporlama + analytics dashboard

### ArchivistPro (Güncel)

| Yetenek | Durum |
|---|---|
| **Dashboard** | 8 widget: toplam istatistikler, kategori dağılımı, format dağılımı, mimari stiller, boyut dağılımı, aylık büyüme, onay kuyruğu, admin aktivite |
| **Koleksiyon** | Favoriler + gruplar (renk kodlu) + etiketler + filtre preset'leri |
| **Export** | CSV (12 alan) + JSON + TXT rapor + XMP sidecar (Adobe standardı) + baskı raporu |
| **Çöp kutusu** | Dosya + klasör ayrı tab, badge'de ayrı sayılar, soft-delete + restore |
| **Arşiv sağlığı** | 5 kontrol: eski dosya, eksik dosya, versiyon güncelleme, legacy format, fixity (bit-rot) |

**XMP Sidecar (yeni)**: Dublin Core + XMP Basic + IPTC + ArchivistPro namespace — proje, faz, malzeme, onay durumu, versiyon etiketi, müşteri adı, deadline hepsini taşıyor. Yazma korumalı klasörlerde APP_DATA'ya fallback. Bu, arşiv metadata'sını Adobe ekosistemiyle taşınabilir yapıyor.

**Verdikt**: Dashboard ve raporlama rakiplerle aynı seviyede. XMP export sayesinde metadata taşınabilirliği var — Bridge/Lightroom ile interoperability mümkün. Ama "bu koleksiyonu dışarıya sun" butonu hâlâ yok.

---

## 7. UZUN VADELİ İLİŞKİ VE BÜYÜME

### Piyasa Liderleri
- Bulut elastikiyet: 10K → 1M dosya sorunsuz
- API + entegrasyon ekosistemi (Slack, Figma, Adobe CC, BIM)
- Sessiz otomatik güncelleme
- Eğitim: webinar, sertifika, topluluk forumu

### ArchivistPro (Güncel)

| Alan | Durum |
|---|---|
| **Performans** | Pipeline staging (p-limit), 16 paralel işçi, 6-8x throughput artışı, model+rusqlite warmup |
| **Watch folders** | Klasör değişiklik tespiti + opt-in auto-rescan (60sn sessizlik sonrası) |
| **Ölçeklenme** | DXF/DWG shape extract optimizasyonu (30K→500 satır), rusqlite tüm scan tabloları, final saveDatabase kaldırıldı |
| **Güncelleme** | Minisign imzalı MSI auto-update |
| **Konfigürasyon** | 15+ ayar (checkpoint, işçi sayısı, watch, timeout, rate-limit, retention, snapshot sayısı) |
| **Ekosistem** | Yok — AutoCAD/Revit'ten "arşive kaydet" butonu yok |

**Verdikt**: Performans artık zayıf alan değil — 6-8x pipeline staging + ayarlanabilir işçi sayısı ciddi bir mühendislik başarısı. Watch folder ile "tara ve unut" iş akışı mümkün. Ama **ekosistem entegrasyonu** en büyük açık: Mimarlık ofisinde gün boyu AutoCAD/Revit açık, ama dosyayı arşive kaydetmek için ArchivistPro'ya geçmek gerekiyor. Vault'un gücü tam da burada — CAD içinden doğrudan check-in.

---

## SONUÇ TABLOSU

| Karşılaştırma Ekseni | OpenAsset | Vault/ACC | Bynder | Bridge | **ArchivistPro** |
|---|---|---|---|---|---|
| AEC format derinliği | Orta | İyi | Zayıf | Zayıf | **En iyi** |
| AI arama (offline) | Yok | Yok | Bulut ($) | Yok | **En iyi** |
| Veri egemenliği | Bulut | Bulut | Bulut | Yerel | **En iyi** (tam offline) |
| Maliyet | $30-50/kişi/ay | $500+/ay | $300+/ay | $55/ay | **$0** |
| Veri güvenliği/dayanıklılık | Bulut SLA | Bulut SLA | Bulut SLA | Yok | **En iyi** (paranoyak seviye) |
| Çok dilli | EN | EN+birkaç | EN+birkaç | EN | **5 dil %100** |
| Versiyon yönetimi | İyi | **En iyi** | Orta | Zayıf | Orta (pattern kümeleme) |
| Onay iş akışı | İyi | **En iyi** | Orta | Yok | Temel (4 durum) |
| Gerçek zamanlı işbirliği | Orta | **İyi** | Orta | Yok | Yok (async mesajlaşma) |
| Dış paydaş paylaşımı | İyi | İyi | **En iyi** | Zayıf | Yok |
| Ekosistem entegrasyonu | İyi | **En iyi** | İyi | İyi | Yok |
| Ölçeklenme | Bulut | Bulut | Bulut | Orta | Orta (tek makine) |
| Watch folder | Yok | ✓ | Yok | Sınırlı | **✓ (auto-rescan)** |
| Fixity/bit-rot tespiti | Yok | Yok | Yok | Yok | **✓ (sample-based)** |
| XMP interoperability | ✓ | Sınırlı | ✓ | **En iyi** | ✓ (export, import yok) |

---

## BİR CÜMLEDE

**ArchivistPro, "veri benim elimde kalacak" diyen mimarlık ofisleri için piyasadaki en derin AEC format desteğine, en güçlü offline AI'a ve en paranoyak veri güvenliğine sahip araç — rakiplerin bulut bağımlılığı, aylık faturası ve format sığlığı karşısında gerçek bir alternatif; açığı gerçek zamanlı işbirliği ve ekosistem entegrasyonunda.**

---

## EN YÜKSEK GETİRİLİ 3 HAMLE

Versiyon, iş akışı ve performans artık kapatılmış. Geriye kalan en kritik açıklar:

1. **Dış paydaş paylaşım linki** — LAN sunucusu üstüne "bu koleksiyonun geçici linkini oluştur" (altyapı hazır, sadece UX katmanı). Müşteriye/müteahhide 5 render göndermek için programdan çıkmak zorunda kalmak, günlük iş akışında en çok sürtünen nokta.

2. **CAD entegrasyon eklentisi** — AutoCAD/Revit için basit bir "Arşive Kaydet" butonu (Tauri'nin REST API'si veya LAN sunucusu üstüne). Vault'un gücünün %80'ini tek bir butonla yakalamak mümkün.

3. **In-app "Sorun Bildir"** — Crash raporu + sistem bilgisi + son 10 işlem logunu paketleyip diske kaydet veya e-posta taslağı oluştur. Kullanıcının yalnız hissetmemesi için en düşük maliyetli hamle.

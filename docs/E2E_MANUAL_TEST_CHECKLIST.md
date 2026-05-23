# ArchivistPro — E2E Manuel Test Checklist

> **Tarih:** 2026-04-25
> **Versiyon:** 2.3.2
> **Amaç:** Uygulamayı gerçekten açıp her özelliği sistematik elle test etmek.

---

## Nasıl Kullanılır

```
[x] = Geçti    [-] = Başarısız    [~] = Kısmen    [ ] = Henüz test edilmedi    [S] = Atlandı
```

Her test için: Adımları uygula → Beklenen sonucu kontrol et → Kutucuğu işaretle.
Başarısız olanlara not yaz.

---

# KISIM A: DONANIM BAĞIMSIZ TESTLER

> **Her makinede yapılabilir.** GPU, Ollama, 3ds Max, ikinci cihaz veya büyük arşiv gerektirmez.
> Küçük bir test klasörü (~20 dosya: birkaç DWG, PDF, JPG, DOCX yeterli) ile çalışılabilir.

---

## A1: UYGULAMA BAŞLATMA & GİRİŞ (17 test)

### A1.1 İlk Açılış
- [x] **E2E-001** — Uygulamayı çift tıklayarak aç → Splash/loading sonrası login ekranı görünür
- [x] **E2E-002** — Login ekranında versiyon numarası doğru gösterilir (2.3.0). versiyon 2.3.2 görünüyor. 
- [x] **E2E-003** — Login ekranında kullanıcı adı ve şifre alanları mevcut

### A1.2 Admin Girişi
- [x] **E2E-004** — admin / admin ile giriş yap → Ana ekran açılır, tüm menüler erişilebilir
- [-] **E2E-005** — Giriş sonrası üst çubukta kullanıcı adı veya rol göstergesi görünür. Üst çubukta değil, alt sağda yazıyor.
- [x] **E2E-006** — Tarama butonu aktif (admin yetkisi)

### A1.3 Viewer Girişi
- [x] **E2E-007** — Viewer kullanıcı ile giriş yap → Ana ekran açılır
- [x] **E2E-008** — Tarama butonu devre dışı veya gizli (viewer yetkisi)
- [x] **E2E-009** — Kullanıcı yönetimi menüsü erişilemez
- [x] **E2E-010** — Ayarlar → DB yolu değiştirme devre dışı

### A1.4 Hatalı Giriş
- [x] **E2E-011** — Yanlış şifre ile giriş → "Hatalı kimlik" hatası gösterilir
- [x] **E2E-012** — Boş alanlarla giriş → "Alanlar gerekli" hatası gösterilir
- [x] **E2E-013** — 5+ hatalı deneme → Uygulama çökmez, stabil kalır

### A1.5 Oturum
- [x] **E2E-014** — Çıkış yap → Login ekranına döner. 
- [x] **E2E-015** — Farklı kullanıcı ile tekrar giriş → Yeni kullanıcının state'i yüklenir
- [x] **E2E-016** — Oturum timeout ayarla (5dk) → Boşta bırak → Kilit ekranı görünür. ✅ Düzeltildi (2026-04-26): warningFiredRef flag ile uyarı sonrası aktivite timer'ı sıfırlamıyor.
- [x] **E2E-017** — Kilit ekranında doğru şifreyi gir → Uygulama kaldığı yerden devam eder. 

---

## A2: DOSYA TARAMA — Küçük Ölçek (14 test)

### A2.1 Temel Tarama
- [x] **E2E-018** — Tarama modalını aç → Klasör seçici görünür
- [x] **E2E-019** — Küçük klasör seç (~20 dosya) → Taramayı başlat → Progress gösterilir
- [x] **E2E-020** — Tarama tamamlanır → "X dosya tarandı" raporu, hata yok
- [x] **E2E-021** — Explorer görünümünde taranan dosyalar kart olarak gösterilir

### A2.2 Format Tespiti (elinizdeki dosyalarla)
- [x] **E2E-022** — DWG dosyası → Versiyon tespit edilir (ör. "AutoCAD 2018")
- [x] **E2E-023** — DWG dosyası → Metadata: layer listesi, block isimleri çıkarılır
- [x] **E2E-028** — PDF dosyası → Sayfa sayısı, yazar, başlık çıkarılır
- [x] **E2E-029** — DOCX/XLSX/PPTX → Yazar, tarih bilgileri çıkarılır
- [x] **E2E-030** — JPG/PNG → Boyutlar, EXIF (kamera/render tespiti) çıkarılır

### A2.3 Thumbnail Oluşturma
- [x] **E2E-033** — DWG dosyası → Thumbnail kartında önizleme görünür
- [x] **E2E-034** — PDF dosyası → İlk sayfa thumbnail görünür. ✅ Düzeltildi (2026-04-26): Tüm dosya taranıyor + min boyut 40px'e düşürüldü.
- [x] **E2E-037** — Bozuk/kırık dosya → Varsayılan ikon gösterilir, çökme yok

### A2.4 Tarama Modları
- [x] **E2E-038** — Merge modu: Mevcut veri + yeni dosyalar birleşir
- [x] **E2E-039** — Aynı klasörü tekrar tara → Mevcut dosyalar güncellenir, duplikat oluşmaz

---

## A3: METİN ARAMA & FACET FİLTRE (12 test)

### A3.1 Metin Arama
- [x] **E2E-043** — Arama kutusuna dosya adı yaz → Eşleşen dosyalar anında filtrelenir
- [x] **E2E-044** — Türkçe karakter ile ara ("çizim", "şömine") → Doğru sonuçlar
- [x] **E2E-045** — Arama kutusunu temizle → Tüm dosyalar tekrar gösterilir
- [x] **E2E-046** — Sonuç bulunamayan arama → "Sonuç yok" mesajı, hata yok

### A3.2 Facet Filtreleri
- [x] **E2E-056** — Kategori filtresi: "2D Çizim" seç → Sadece çizimler gösterilir
- [x] **E2E-057** — Çoklu filtre: Kategori + Aşama seç → Kesişim sonuçları (AND)
- [x] **E2E-058** — Filtre temizle → Tüm dosyalar geri gelir
- [x] **E2E-059** — Filtre preset kaydet → Kayıtlı preset tekrar yüklenebilir
- [x] **E2E-060** — Aktif filtre chip'leri üst çubukta görünür, X ile kaldırılabilir

### A3.3 Arama + Filtre Kombinasyonu
- [x] **E2E-061** — Klasör seç (sol panel) → Arama yap → Tüm klasörlerdeki sonuçlar görünür (bypass)
- [x] **E2E-062** — Arama yokken klasör seç → Sadece o klasördeki dosyalar (drill-down)
- [x] **E2E-049** — Hassasiyet slider'ı değiştir → Sonuç sayısı değişir

---

## A4: DETAY PANELİ & METADATA (10 test)

- [x] **E2E-063** — Bir dosyaya tıkla → Sağ detay paneli açılır 
- [x] **E2E-064** — Dosya adı, yol, boyut, tarih bilgileri doğru gösterilir
- [x] **E2E-065** — DWG dosyası → Layer listesi, block isimleri detayda görünür
- [-] **E2E-066** — Görsel dosya → Boyutlar, EXIF bilgileri gösterilir. EXIF bilgileri gösterilmiyor. (ama fotğraf değil, render imajı)
- [x] **E2E-067** — "Explorer'da göster" butonu → Dosya gezgini açılır, dosya seçili
- [x] **E2E-068** — "Dosyayı aç" butonu → Varsayılan uygulama ile dosya açılır
- [x] **E2E-069** — Client adı, onay durumu, versiyon etiketi düzenle → Kaydedilir
- [x] **E2E-070** — Detay panelini kapat → Tekrar aç → Değişiklikler korunmuş
- [x] **E2E-071** — Görsel dosyada dominant renkler gösterilir
- [x] **E2E-072** — RAL kod eşlemeleri (varsa) görünür

---

## A5: ETİKETLER & FAVORİLER (9 test)

- [x] **E2E-073** — Yeni tag oluştur (ad + renk) → Listede görünür
- [x] **E2E-074** — Bir dosyaya tag ata → Detay panelinde tag görünür
- [x] **E2E-075** — Tag'i kaldır → Bağlantı silinir
- [x] **E2E-076** — Tag'i düzenle (ad değiştir) → Tüm atanmış dosyalarda güncellenir
- [x] **E2E-077** — Tag'i sil → Tüm dosyalardan kaldırılır
- [x] **E2E-078** — Birden fazla dosya seç → Toplu tag ekle → Hepsine atanır. ✅ Düzeltildi (2026-04-26): BatchTagModal'a getTagsForAsset() + setScannedAssets() eklendi.
- [x] **E2E-079** — Dosyayı favoriye ekle → Yıldız ikonu görünür
- [x] **E2E-080** — "Sadece favoriler" filtresi → Yalnızca yıldızlı dosyalar
- [x] **E2E-081** — Favoriyi kaldır → Yıldız kaybolur
----  Etiket yönetim tablosundan yaptığım eylemler preview kartlardaki etiketlere ve sol panelde göstrilen etiketlere yansımıyor.
---

## A6: SİLME & ÇÖP KUTUSU (5 test)

- [x] **E2E-082** — Dosyayı sil → Onay dialogu → Evet → Dosya listeden kaybolur
- [x] **E2E-083** — Çöp kutusunu aç → Silinen dosya görünür
- [x] **E2E-084** — Çöpten geri yükle → Dosya tekrar listede
- [x] **E2E-085** — Çöp kutusunu boşalt → Uyarı → Onay → Kalıcı silme
- [x] **E2E-086** — Ctrl+Z ile silmeyi geri al → Dosya geri gelir

---

## A7: UNDO/REDO (4 test)

- [x] **E2E-087** — Tag ekle → Ctrl+Z → Tag kaldırılır
- [x] **E2E-088** — Ctrl+Y → Tag tekrar eklenir
- [x] **E2E-089** — Dosya sil → Ctrl+Z → Dosya geri gelir
- [x] **E2E-090** — Undo butonu yanında işlem etiketi görünür

---

## A8: ARŞİV YÖNETİMİ (13 test)

### A8.1 Çoklu Arşiv
- [x] **E2E-091** — Ana arşiv varsayılan olarak yüklü
- [x] **E2E-092** — Local arşive geç → Farklı dosya listesi
- [x] **E2E-093** — Ana arşive geri dön → Orijinal dosyalar
- [x] **E2E-094** — Yeni custom arşiv oluştur (admin) → Listede görünür
- [x] **E2E-095** — Custom arşivi sil → Listeden kaldırılır

### A8.2 Kaynak Klasörler
- [x] **E2E-096** — Yeni kaynak klasör ekle → Sidebar'da görünür
- [x] **E2E-097** — Klasör etiketini değiştir → Yeni isim görünür
- [x] **E2E-098** — Klasör kaldır (asset'leri koru) → Klasör gider, dosyalar kalır
- [x] **E2E-099** — Klasör grupları oluştur → Sidebar'da gruplanmış görünüm

### A8.3 Export/Import
- [x] **E2E-100** — Arşivi .archivistpro olarak dışa aktar → Dosya oluşturulur
- [x] **E2E-101** — .archivistpro dosyasını içe aktar → Manifest preview → Import başarılı. ✅ Düzeltildi (2026-04-26): Doğrudan invoke + gerçek hata mesajı UI'da gösteriliyor.

### A8.4 Arşiv Sağlık Kontrolü
- [x] **E2E-102** — Health check çalıştır → Stale/missing dosyalar raporlanır
- [-] **E2E-103** — Eksik dosya varsa sarı uyarı badge görünür. eksik olmadığı için görülmedi.

---

## A9: KULLANICI YÖNETİMİ (6 test)

- [x] **E2E-104** — Yeni kullanıcı oluştur → Listede görünür
- [x] **E2E-105** — Kullanıcının rolünü değiştir → Hemen etkili
- [x] **E2E-106** — Kullanıcıyı sil → Listeden kaldırılır, giriş yapamaz
- [x] **E2E-107** — Son admin'i viewer yapmayı dene → Reddedilir
- [-] **E2E-108** — Developer flag ekle/kaldır → Ek menüler görünür/gizlenir. Bu panelde Developer flag ekle/kaldır yok. (bu başka bir yerde sanıyorum)
- [x] **E2E-109** — CSV toplu kullanıcı import → Kullanıcılar oluşturulur

---

## A10: DUPLİKAT TESPİT (6 test)

- [x] **E2E-121** — Duplikat bulucu modalını aç → Kriter seçimi
- [x] **E2E-122** — Hash ile arama → Tam eşleşen dosya grupları
- [x] **E2E-123** — İsim ile arama → Aynı adlı dosya grupları
- [x] **E2E-124** — Görsel benzerlik (pHash) → Benzer görseller gruplandı
- [x] **E2E-125** — Duplikat'ı yan yana karşılaştır → Metadata farkları görünür
- [x] **E2E-126** — Duplikat'ı sil → Çöp kutusuna taşınır

---

## A11: GÖRÜNTÜLEME MODLARI (6 test)

- [x] **E2E-139** — Explorer (grid) → Dosyalar kart grid olarak
- [x] **E2E-140** — Dashboard → İstatistikler, grafikler, dağılım
- [x] **E2E-141** — Technical (tablo) → Sıralanabilir sütunlar, büyük liste scroll
- [x] **E2E-142** — Folders → Kaynak klasörler kart olarak
- [x] **E2E-143** — Kart boyutu slider → Kartlar boyut değiştirir
- [x] **E2E-144** — Mod geçişlerinde arama/filtre korunur

---

## A12: AYARLAR (4 test)

- [x] **E2E-145** — Tema değiştir (dark ↔ light) → UI anında değişir
- [x] **E2E-146** — Dil değiştir (TR → EN → TR) → Tüm metinler değişir
- [x] **E2E-147** — 5 dil test et (tr, en, zh, ja, ar) → Hepsi yüklenir, eksik yok. ✅ Düzeltildi (2026-04-26): zh 22 + ja/ar 27 eksik anahtar eklendi → 5/5 dil %100 (1714 anahtar).
- [x] **E2E-148** — Arapça (ar) seçildiğinde RTL layout doğru

---

## A13: YEDEKLEME & KURTARMA (4 test)

- [x] **E2E-149** — DB snapshot al → Dosya oluşturulur, listede görünür
- [x] **E2E-150** — Snapshot listesi → En yeniden eskiye sıralı
- [x] **E2E-151** — Snapshot'tan geri yükle → DB eski haline döner
- [x] **E2E-152** — Snapshot sil → Dosya kaldırılır

---

## A14: BİLDİRİM & UYARI (5 test)

- [x] **E2E-153** — İşlem tamamlandığında toast bildirimi (yeşil/mavi)
- [x] **E2E-154** — Hata durumunda kırmızı toast
- [x] **E2E-155** — 5+ toast aynı anda → En fazla 5 görünür
- [x] **E2E-156** — Onay dialogu (silme öncesi) → Evet/Hayır çalışır
- [x] **E2E-157** — Depolama az uyarısı → Banner görünür

---

## A15: KLAVYE KISAYOLLARI (4 test)

- [x] **E2E-158** — Ctrl+Z → Undo çalışır
- [x] **E2E-159** — Ctrl+Y → Redo çalışır
- [x] **E2E-160** — Ctrl+F → Arama kutusuna odaklanır
- [x] **E2E-161** — Del → Seçili dosyayı silme onayı

---

## A16: TEMEL HATA DAYANIKLILIĞI (4 test)

- [x] **E2E-162** — Mevcut olmayan dosya yolunda tarama → Hata mesajı, çökme yok
- [x] **E2E-165** — Bozuk dosya thumbnail → Varsayılan ikon, çökme yok
- [x] **E2E-166** — Uygulama penceresi küçültme/büyütme → Layout doğru uyum sağlar
- [x] **E2E-167** — Uygulamayı X ile kapat → Graceful kapanış, DB flush

---

## A17: GÜNCELLEME & YARDIM (3 test)

- [-] **E2E-172** — Güncelleme kontrolü → Yeni sürüm varsa bildirim. internete çıkış yasağı olduğu için bu kontrolü belirli bir klasörün için kontrol ederek yapmalı.
- [x] **E2E-173** — Yardım panelini aç → Özellik doku, kısayollar gösterilir
- [x] **E2E-174** — Onboarding turu (ilk açılışta) → Adım adım tur çalışır

---

### KISIM A — Sonuç Tablosu

| Bölüm | Toplam | Geçti | Başarısız | Atlandı |
|-------|--------|-------|-----------|---------|
| A1. Başlatma & Giriş | 17 | | | |
| A2. Dosya Tarama (küçük) | 14 | | | |
| A3. Metin Arama & Filtre | 12 | | | |
| A4. Detay Paneli | 10 | | | |
| A5. Etiketler & Favoriler | 9 | | | |
| A6. Silme & Çöp Kutusu | 5 | | | |
| A7. Undo/Redo | 4 | | | |
| A8. Arşiv Yönetimi | 13 | | | |
| A9. Kullanıcı Yönetimi | 6 | | | |
| A10. Duplikat Tespit | 6 | | | |
| A11. Görüntüleme Modları | 6 | | | |
| A12. Ayarlar | 4 | | | |
| A13. Yedekleme & Kurtarma | 4 | | | |
| A14. Bildirim & Uyarı | 5 | | | |
| A15. Klavye Kısayolları | 4 | | | |
| A16. Hata Dayanıklılığı | 4 | | | |
| A17. Güncelleme & Yardım | 3 | | | |
| **KISIM A TOPLAM** | **126** | | | |

**Gerekli test dosyaları (Kısım A):**
- Birkaç DWG (farklı versiyonlar), 1-2 PDF, 1-2 DOCX, birkaç JPG
- 1 bozuk/kırık dosya (hata testi için)
- 2 aynı içerikli dosya (duplikat testi için)
- Toplam ~20 dosyalık bir test klasörü yeterli

---

---

# KISIM B: DONANIM BAĞIMLI TESTLER

> **Güçlü makinede yapılmalı.** GPU, Ollama, büyük arşiv, 3ds Max, LAN ikinci cihaz gerektirir.
> Bu testleri zayıf donanımda yapmak yanıltıcı sonuç verir.

---

## B1: BÜYÜK ÖLÇEK TARAMA (4 test)

> **Gerekli:** 500+ dosya içeren klasör, iyi CPU/RAM

- [ ] **E2E-041** — 500+ dosya içeren klasör tara → Tamamlanır, bellek sorunu yok
- [ ] **E2E-042** — Tarama sırasında UI donmaz (progress bar güncellenir)
- [ ] **E2E-040** — Tarama sırasında pause → resume → Kaldığı yerden devam eder
- [ ] **E2E-163** — Çok büyük dosya (>1GB) tarama → Bellek taşması yok

---

## B2: AĞIR FORMAT TARAMA (7 test)

> **Gerekli:** Örnek MAX, SKP, RVT, IFC, MP4, PSD dosyaları

- [ ] **E2E-024** — 3ds Max dosyası → Max versiyonu tespit edilir (ör. "2021 (V23)")
- [ ] **E2E-025** — SketchUp dosyası → SKP versiyonu tespit edilir
- [ ] **E2E-026** — Revit dosyası → RVT metadata (versiyon, proje adı) çıkarılır
- [ ] **E2E-027** — IFC dosyası → Schema, entity sayısı, kat bilgisi çıkarılır
- [ ] **E2E-031** — MP4/AVI → Süre, codec, çözünürlük çıkarılır
- [ ] **E2E-032** — PSD dosyası → Composite image thumbnail oluşturulur
- [ ] **E2E-035** — Office dosyası → Belge thumbnail görünür
- [ ] **E2E-036** — PSD dosyası → Composite thumbnail görünür

---

## B3: AI SEMANTİK ARAMA (3 test)

> **Gerekli:** Yeterli RAM (8GB+), CPU/GPU

- [ ] **E2E-047** — Sidebar'da embedding modelini yükle → Progress, "ready" durumu
- [ ] **E2E-048** — Doğal dilde ara ("modern bina cephesi") → Anlam bazlı sonuçlar
- [ ] **E2E-054** — Bir şekil resmi yükle → Benzer DWG şekilleri bulunur

---

## B4: GÖRSEL ARAMA — CLIP (5 test)

> **Gerekli:** GPU (NVIDIA önerilir), 8GB+ RAM, Ollama

- [ ] **E2E-050** — CLIP modelini yükle → ~300MB yüklenir, progress gösterilir
- [ ] **E2E-051** — Bir resim yükle → Benzer görseller sıralanır
- [ ] **E2E-052** — Metin ile görsel ara ("kırmızı tuğla") → CLIP sonuçları
- [ ] **E2E-053** — Görsel arama sonuçları Explorer'da görünür
- [ ] **E2E-055** — Şekil kategorisi filtresi (HAVUZ, KOLON vb.) → Sonuçlar daraltılır

---

## B5: AI CHAT & RAG (11 test)

> **Gerekli:** Ollama çalışıyor + GPU + indirilen model

### B5.1 Indexleme
- [ ] **E2E-110** — RAG index modalını aç → Missing/indexed sayıları görünür
- [ ] **E2E-111** — Birkaç PDF/DOCX dosyayı indexle → Progress, başarı raporu
- [ ] **E2E-112** — Video dosyayı indexlemeye çalış → Skip, hata yok

### B5.2 Chat
- [ ] **E2E-113** — Yeni chat oturumu başlat → Boş sohbet ekranı
- [ ] **E2E-114** — İndexlenmiş doküman hakkında soru sor → Yanıt gelir (stream)
- [ ] **E2E-115** — Yanıtta kaynak citation'lar gösterilir
- [ ] **E2E-116** — Chat oturumunu kapat → tekrar aç → Mesajlar korunmuş
- [ ] **E2E-117** — Chat oturumunu sil → Kalıcı olarak kaldırılır
- [ ] **E2E-118** — Chat'i Markdown olarak dışa aktar → .md dosyası indirilir

### B5.3 Ollama
- [ ] **E2E-119** — Ollama ping → Bağlantı durumu gösterilir
- [ ] **E2E-120** — GPU tespiti → Doğru sonuç (varsa NVIDIA bilgisi)

---

## B6: LAN PAYLAŞIM (6 test)

> **Gerekli:** Aynı ağda ikinci cihaz (veya VM)

- [ ] **E2E-127** — Admin olarak LAN sunucusunu başlat → Port ve auth code gösterilir
- [ ] **E2E-128** — Aynı ağdaki başka cihazdan IP + auth code ile bağlan
- [ ] **E2E-129** — Remote manifest indir → Dosya listesi görünür
- [ ] **E2E-130** — Remote arşivi indir → Dosyalar indirilir, bütünlük doğrulanır
- [ ] **E2E-131** — Yanlış auth code → Bağlantı reddedilir
- [ ] **E2E-132** — Sunucuyu durdur → Port serbest kalır

---

## B7: 3DS MAX DÖNÜŞTÜRME (4 test)

> **Gerekli:** 3ds Max yüklü (en az 1 sürüm)

- [ ] **E2E-133** — Max versiyon stamp değiştir → Dosya başlığı güncellenir
- [ ] **E2E-134** — Yüklü Max sürümlerini bul → Registry'deki sürümler listelenir
- [ ] **E2E-135** — Max çalışıyor mu kontrol → Doğru sonuç
- [ ] **E2E-136** — FBX/OBJ export → Geçerli dosya oluşturulur

---

## B8: CAD ARAÇLARI (2 test)

> **Gerekli:** ODA File Converter yüklü

- [ ] **E2E-137** — ODA Converter otomatik tespit → Yol bulunur (yüklü ise)
- [ ] **E2E-138** — DXF cache temizle → Cache silinir, disk alanı serbest

---

## B9: PERFORMANS (4 test)

> **Gerekli:** 2000+ dosya arşivi, güçlü CPU/RAM

- [ ] **E2E-168** — 2000+ dosya grid'de akıcı scroll (virtualization)
- [ ] **E2E-169** — Arama yazarken anlık filtreleme (<300ms)
- [ ] **E2E-170** — Mod geçişi hızlı (<500ms)
- [ ] **E2E-171** — Uygulama açılış süresi kabul edilebilir (<5s)

---

## B10: AĞIR HATA DAYANIKLILIĞI (2 test)

> **Gerekli:** Büyük dosya (>1GB), LAN bağlantısı

- [ ] **E2E-163** — Çok büyük dosya (>1GB) tarama → Bellek taşması yok
- [ ] **E2E-164** — Ağ kesintisinde LAN işlemi → Timeout hatası, çökme yok

---

### KISIM B — Sonuç Tablosu

| Bölüm | Toplam | Geçti | Başarısız | Atlandı | Gerekli |
|-------|--------|-------|-----------|---------|---------|
| B1. Büyük Ölçek Tarama | 4 | | | | 500+ dosya, iyi RAM |
| B2. Ağır Format Tarama | 7 | | | | MAX, SKP, RVT, IFC, PSD |
| B3. AI Semantik Arama | 3 | | | | 8GB+ RAM |
| B4. Görsel Arama (CLIP) | 5 | | | | GPU, Ollama |
| B5. AI Chat & RAG | 11 | | | | Ollama + model |
| B6. LAN Paylaşım | 6 | | | | İkinci cihaz |
| B7. 3ds Max Dönüştürme | 4 | | | | Max yüklü |
| B8. CAD Araçları | 2 | | | | ODA Converter |
| B9. Performans | 4 | | | | 2000+ dosya |
| B10. Ağır Hata Dayanıklılığı | 2 | | | | 1GB+ dosya, LAN |
| **KISIM B TOPLAM** | **48** | | | | |

---

## GENEL TOPLAM

| Kısım | Test Sayısı | Açıklama |
|-------|------------|----------|
| **A — Donanım Bağımsız** | **126** | Her makinede, küçük test klasörüyle |
| **B — Donanım Bağımlı** | **48** | Güçlü makine, GPU, özel yazılım |
| **TOPLAM** | **174** | |

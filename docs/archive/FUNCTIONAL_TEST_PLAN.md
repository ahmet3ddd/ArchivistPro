# ArchivistPro — Kapsamlı Fonksiyonel Test Planı

> **Tarih:** 2026-04-25
> **Versiyon:** 2.3.0
> **Amaç:** Programın tüm işlevlerini tek tek doğrulamak — hem çalışıyor mu, hem doğru çalışıyor mu.
> **Mevcut durum:** 1910 test, stmt %58, branch %47. Bu plan eksik kalan %42'yi hedefler.

---

## Nasıl Kullanılır

| Sütun | Açıklama |
|-------|----------|
| **ID** | Test kimliği (kategori-numara) |
| **Test** | Ne test ediliyor |
| **Adımlar** | Yapılacak işlem |
| **Beklenen Sonuç** | Doğru davranış ne olmalı |
| **Öncelik** | 🔴 Kritik · 🟡 Yüksek · 🟢 Normal |
| **Durum** | ✅ Test var · ⚠️ Kısmen · ❌ Test yok |

---

## 1. KİMLİK DOĞRULAMA & OTURUM

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| AUTH-01 | Admin girişi | Admin kullanıcı adı ve şifre ile giriş yap | Giriş başarılı, admin paneli erişilebilir, session role = "admin" | 🔴 | ⚠️ |
| AUTH-02 | Viewer girişi | Viewer kullanıcı adı ve şifre ile giriş yap | Giriş başarılı, yazma işlemleri engelli, sadece local archive yazılabilir | 🔴 | ⚠️ |
| AUTH-03 | Yanlış şifre | Geçersiz şifre ile giriş dene | "Hatalı kullanıcı adı veya şifre" hatası, giriş reddedilir | 🔴 | ❌ |
| AUTH-04 | Boş alanlar | Kullanıcı adı veya şifre boş bırakılarak giriş dene | Form submit edilemez veya hata mesajı gösterilir | 🟡 | ❌ |
| AUTH-05 | Şifre sıfırlama | "Şifremi unuttum" → recovery key ile sıfırla | Yeni şifre belirlenir, eski şifre artık çalışmaz | 🔴 | ❌ |
| AUTH-06 | Oturum timeout | Ayarlarda timeout süresi belirle → uygulamayı boşta bırak | Süre dolduğunda kilit ekranı görünür, tekrar giriş gerekir | 🟡 | ❌ |
| AUTH-07 | Kullanıcı değiştirme | Oturum açıkken çıkış yap → farklı kullanıcı ile gir | Önceki kullanıcının state'i temizlenir, yeni kullanıcı yüklenir | 🟡 | ❌ |
| AUTH-08 | Kilit ekranı | Timeout sonrası kilit ekranında doğru şifreyi gir | Uygulama unlock olur, state korunmuş olarak devam eder | 🟡 | ❌ |
| AUTH-09 | Recovery key yazma | İlk kurulumda recovery key oluştur | Key bir kez yazılır, tekrar yazma reddedilir (single-write) | 🔴 | ❌ |
| AUTH-10 | PBKDF2 hash doğrulaması | Aynı şifre ile iki kez hash oluştur | Aynı salt+password → aynı hash, farklı salt → farklı hash | 🔴 | ✅ |

---

## 2. KULLANICI YÖNETİMİ (Admin)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| USER-01 | Kullanıcı oluşturma | Admin panelinden yeni kullanıcı ekle (ad, şifre, rol) | Kullanıcı DB'ye kaydedilir, listede görünür | 🔴 | ✅ |
| USER-02 | Kullanıcı silme | Admin panelinden mevcut kullanıcıyı sil | Kullanıcı DB'den kaldırılır, artık giriş yapamaz | 🔴 | ⚠️ |
| USER-03 | Rol değiştirme | Viewer → Admin veya Admin → Viewer yap | Rol güncellenir, yetkileri hemen değişir | 🔴 | ⚠️ |
| USER-04 | Son admin koruması | Tek kalan admin'in rolünü viewer'a düşürmeye çalış | İşlem reddedilir, "Son admin silinemez/düşürülemez" uyarısı | 🔴 | ❌ |
| USER-05 | CSV toplu import | Birden fazla kullanıcıyı CSV ile içe aktar | Tüm kullanıcılar oluşturulur, hatalılar raporlanır | 🟡 | ❌ |
| USER-06 | Developer flag | Kullanıcıya developer bayrağı ekle/kaldır | Developer menüleri görünür/gizlenir | 🟢 | ❌ |
| USER-07 | Kendi şifresini değiştirme | Profil modalından mevcut şifreyi girip yenisini belirle | Şifre güncellenir, yeni şifre ile giriş yapılabilir | 🟡 | ❌ |

---

## 3. YETKİ SİSTEMİ (RBAC)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| RBAC-01 | Viewer ana arşive yazamaz | Viewer olarak ana arşive asset ekle/düzenle | İşlem engellenir, hata mesajı | 🔴 | ✅ |
| RBAC-02 | Viewer local arşive yazabilir | Viewer olarak local arşive asset ekle | İşlem başarılı | 🔴 | ✅ |
| RBAC-03 | Admin her arşive yazabilir | Admin olarak main + local + custom arşivlere yaz | Tüm yazma işlemleri başarılı | 🔴 | ✅ |
| RBAC-04 | Viewer tarama yapamaz | Viewer olarak dosya taraması başlat | Tarama butonu disabled veya işlem reddedilir | 🔴 | ⚠️ |
| RBAC-05 | Viewer kullanıcı yönetemez | Viewer olarak kullanıcı ekleme/silme dene | İlgili menü/buton gizli veya erişilemez | 🔴 | ⚠️ |
| RBAC-06 | Viewer LAN sunucu başlatamaz | Viewer olarak LAN server start dene | İşlem reddedilir | 🟡 | ❌ |
| RBAC-07 | Viewer DB yolu değiştiremez | Viewer olarak veritabanı konumu değiştir | İşlem reddedilir | 🔴 | ❌ |
| RBAC-08 | Viewer snapshot geri yükleyemez | Viewer olarak ana DB snapshot restore dene | İşlem reddedilir | 🔴 | ❌ |
| RBAC-09 | Admin refile yapabilir | Admin olarak dosya yeniden organize et | Dosyalar hedef klasöre taşınır | 🟡 | ❌ |
| RBAC-10 | Viewer refile yapamaz | Viewer olarak refile dene | İşlem reddedilir | 🟡 | ❌ |
| RBAC-11 | ProtectedAction bileşeni | Viewer iken ProtectedAction içindeki butonlar | Disabled veya gizli görünür | 🔴 | ❌ |

---

## 4. DOSYA TARAMA & İÇE AKTARMA

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SCAN-01 | Klasör tarama başlat | Bir klasör seç → taramayı başlat | Dosyalar tespit edilir, progress gösterilir, DB'ye yazılır | 🔴 | ⚠️ |
| SCAN-02 | Merge modu | Mevcut verinin üzerine yeni tarama (merge) | Yeni dosyalar eklenir, mevcutlar güncellenir, silinmiş olanlar kalmaz | 🔴 | ❌ |
| SCAN-03 | Replace under path modu | Belirli klasör altını yeniden tara | Sadece o klasör altındaki kayıtlar güncellenir | 🟡 | ❌ |
| SCAN-04 | Full reset modu | Tüm DB'yi sıfırlayıp yeniden tara | Tüm eski kayıtlar silinir, sadece yeni tarama sonuçları kalır | 🔴 | ❌ |
| SCAN-05 | DWG dosya tespiti | DWG dosyası içeren klasör tara | DWG dosyası algılanır, versiyon tespit edilir, metadata çıkarılır | 🔴 | ❌ |
| SCAN-06 | MAX dosya tespiti | 3ds Max dosyası içeren klasör tara | MAX versiyonu tespit edilir, plugin/material listesi çıkarılır | 🔴 | ❌ |
| SCAN-07 | SKP dosya tespiti | SketchUp dosyası tara | SKP versiyonu tespit edilir, thumbnail oluşturulur | 🟡 | ❌ |
| SCAN-08 | RVT dosya tespiti | Revit dosyası tara | RVT metadata (versiyon, worksharing, proje bilgisi) çıkarılır | 🟡 | ❌ |
| SCAN-09 | IFC dosya tespiti | IFC dosyası tara | Schema, entity sayısı, kat bilgisi çıkarılır | 🟡 | ❌ |
| SCAN-10 | PDF metadata | PDF dosyası tara | Sayfa sayısı, yazar, başlık, tarih çıkarılır | 🟡 | ❌ |
| SCAN-11 | Office metadata | DOCX/XLSX/PPTX tara | Yazar, tarih, dosya bilgileri çıkarılır | 🟡 | ❌ |
| SCAN-12 | Görsel metadata | PNG/JPG dosya tara | Boyutlar, EXIF, render/fotoğraf tespiti yapılır | 🟡 | ❌ |
| SCAN-13 | Video metadata | MP4/AVI dosya tara | Süre, codec, çözünürlük çıkarılır | 🟢 | ❌ |
| SCAN-14 | BAK dosya tespiti | .bak dosyası tara | Kaynak tipi tespit edilir (DWG-bak, MAX-bak vb.) | 🟡 | ❌ |
| SCAN-15 | Boş klasör tarama | İçinde dosya olmayan klasör tara | Tarama tamamlanır, 0 dosya rapor edilir, hata olmaz | 🟢 | ❌ |
| SCAN-16 | Tarama duraklatma/devam | Tarama sırasında pause → resume | Tarama kaldığı yerden devam eder | 🟡 | ❌ |
| SCAN-17 | Büyük ölçek tarama | 2000+ dosya içeren klasör tara | Bellek taşması olmadan tamamlanır, tüm dosyalar kaydedilir | 🔴 | ✅ |
| SCAN-18 | Metin çıkarma (indexing) | PDF/DOCX dosyasından metin çıkar | Aranabilir metin DB'ye kaydedilir | 🟡 | ❌ |

---

## 5. THUMBNAIL OLUŞTURMA

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| THUMB-01 | PSD thumbnail | PSD dosyası için thumbnail iste | Composite image çıkarılır, geçerli JPEG döner | 🟡 | ❌ |
| THUMB-02 | DWG thumbnail | DWG dosyası için thumbnail iste | Çizim önizlemesi oluşturulur | 🟡 | ❌ |
| THUMB-03 | SKP thumbnail | SKP dosyası için thumbnail iste | SketchUp önizlemesi çıkarılır | 🟡 | ❌ |
| THUMB-04 | MAX thumbnail | 3ds Max dosyası için thumbnail iste | Max sahne önizlemesi oluşturulur | 🟡 | ❌ |
| THUMB-05 | Office thumbnail | DOCX/PPTX için thumbnail iste | Belge önizlemesi oluşturulur | 🟢 | ❌ |
| THUMB-06 | RVT thumbnail | Revit dosyası için thumbnail iste | Revit önizlemesi çıkarılır | 🟢 | ❌ |
| THUMB-07 | PDF thumbnail | PDF dosyası için thumbnail iste | İlk sayfa önizlemesi oluşturulur | 🟢 | ❌ |
| THUMB-08 | TGA/TIFF thumbnail | TGA veya TIFF dosyası için thumbnail | JPEG formatında geçerli thumbnail döner | 🟢 | ❌ |
| THUMB-09 | EPS thumbnail | EPS dosyası için thumbnail iste | EPS önizlemesi oluşturulur | 🟢 | ❌ |
| THUMB-10 | Bozuk dosya thumbnail | Bozuk/kırık dosya için thumbnail iste | Hata döner, uygulama çökmez, varsayılan ikon gösterilir | 🔴 | ❌ |

---

## 6. ARAMA SİSTEMİ

### 6.1 Metin Arama

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SRCH-01 | Basit dosya adı arama | Arama kutusuna dosya adı yaz | Eşleşen dosyalar listelenir, highlight ile | 🔴 | ⚠️ |
| SRCH-02 | Türkçe karakter arama | "çizim", "şehir", "İstanbul" gibi aramalar | Türkçe karakterler doğru normalize edilir, sonuçlar bulunur | 🔴 | ✅ |
| SRCH-03 | Boş arama | Arama kutusunu temizle | Tüm dosyalar tekrar gösterilir, filtre sıfırlanır | 🟡 | ❌ |
| SRCH-04 | Sonuçsuz arama | Hiçbir dosyayla eşleşmeyen terim ara | "Sonuç bulunamadı" mesajı, boş liste, hata yok | 🟡 | ❌ |
| SRCH-05 | Arama geçmişi | 3-4 arama yap → geçmişi kontrol et | Son aramalar sıralı olarak listelenir | 🟢 | ✅ |
| SRCH-06 | Arama + klasör filtresi | Bir klasör seç → arama yap | Sadece seçili klasör altındaki eşleşmeler döner | 🔴 | ✅ |
| SRCH-07 | Query expansion | "duvar" ara | "wall", "duvar" ve eşanlamlılar da aranır | 🟡 | ✅ |

### 6.2 Semantik/AI Arama

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SRCH-10 | Embedding model yükleme | Sidebar'da embedding modelini yükle | MiniLM yüklenir, status "ready" olur, progress gösterilir | 🔴 | ❌ |
| SRCH-11 | Semantik metin arama | "modern bina cephesi" gibi doğal dilde ara | Anlam bazlı eşleşen dosyalar sıralanır (cosine similarity) | 🔴 | ⚠️ |
| SRCH-12 | Embedding yok iken arama | Model yüklenmeden semantik arama dene | Klasik metin arama fallback'i devreye girer veya uyarı | 🟡 | ❌ |
| SRCH-13 | Arama hassasiyet ayarı | Sensitivity slider'ı değiştir → aynı aramayı tekrarla | Düşük hassasiyet = daha fazla sonuç, yüksek = daha az ama isabetli | 🟢 | ❌ |

### 6.3 Görsel Arama (CLIP)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SRCH-20 | Görsel dosya ile arama | Bir resim yükle → benzer görselleri bul | Görsel benzerlik sırasıyla sonuçlar listelenir | 🔴 | ❌ |
| SRCH-21 | Metin ile görsel arama | "kırmızı tuğla duvar" yaz → CLIP ile ara | Metin açıklamasına uyan görseller bulunur | 🔴 | ❌ |
| SRCH-22 | CLIP model yükleme | CLIP modelini ilk kez yükle | ~300MB model indirilir/yüklenir, progress gösterilir | 🟡 | ❌ |
| SRCH-23 | Görsel arama + Explorer | Görsel arama sonuçlarına tıkla | Sonuçlar Explorer'da doğru gösterilir | 🔴 | ✅ |

### 6.4 Şekil Arama

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SRCH-30 | Şekil ile DWG arama | Bir şekil resmi yükle → benzer DWG'leri bul | Vertex sayısı ve geometri benzerliği ile sonuçlar | 🟡 | ⚠️ |
| SRCH-31 | Şekil kategorisi filtresi | Kategori seç (HAVUZ, KOLON vb.) → ara | Sadece o kategorideki şekiller döner | 🟢 | ❌ |
| SRCH-32 | Düzgünlük eşiği | Regularity threshold ayarla → ara | Threshold altındaki düzensiz şekiller filtrelenir | 🟢 | ❌ |

### 6.5 Facet Filtreleri

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SRCH-40 | Kategori filtresi | "2D Çizim" kategorisini seç | Sadece 2D çizim dosyaları gösterilir | 🔴 | ⚠️ |
| SRCH-41 | Proje aşaması filtresi | "Uygulama" aşamasını seç | Sadece uygulama aşaması dosyaları gösterilir | 🟡 | ❌ |
| SRCH-42 | Malzeme filtresi | "Beton" malzeme grubunu seç | Beton ilişkili dosyalar filtrelenir | 🟡 | ❌ |
| SRCH-43 | Çoklu filtre | Kategori + Aşama + Malzeme birlikte seç | Kesişim sonuçları gösterilir (AND mantığı) | 🔴 | ❌ |
| SRCH-44 | Filtre temizleme | Tüm filtreleri kaldır | Tüm dosyalar tekrar gösterilir | 🟡 | ❌ |
| SRCH-45 | Filtre preset kaydet | Mevcut filtre kombinasyonunu kaydet | Preset kaydedilir, tekrar yüklenebilir | 🟢 | ✅ |
| SRCH-46 | Filtre preset yükle | Kayıtlı preset'i seç | Filtreler otomatik uygulanır | 🟢 | ✅ |
| SRCH-47 | Onay durumu filtresi | "approved" onay durumunu seç | Sadece onaylanmış dosyalar gösterilir | 🟢 | ❌ |

---

## 7. ARŞİV YÖNETİMİ

### 7.1 Çoklu Arşiv

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ARC-01 | Ana arşiv erişimi | Uygulama açılışında ana arşivi yükle | Ana arşiv varsayılan olarak aktif, tüm asset'ler listelenir | 🔴 | ✅ |
| ARC-02 | Local arşiv erişimi | Local arşive geç | Kişisel arşiv yüklenir, farklı asset'ler gösterilir | 🔴 | ✅ |
| ARC-03 | Custom arşiv oluştur | Admin olarak yeni shared arşiv oluştur | Yeni DB dosyası oluşturulur, arşiv listesinde görünür | 🔴 | ❌ |
| ARC-04 | Arşiv silme | Admin olarak custom arşivi sil | Arşiv konfigürasyonu ve DB dosyası kaldırılır | 🔴 | ❌ |
| ARC-05 | Arşiv geçişi | Main → Local → Custom arşivler arası geçiş yap | Her geçişte doğru arşivin asset'leri yüklenir, state temiz | 🔴 | ❌ |
| ARC-06 | Arşiv listesi | Tüm tanımlı arşivleri listele | ID, ad, tür, renk bilgileri doğru gösterilir | 🟡 | ❌ |

### 7.2 Arşiv Operasyonları

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ARC-10 | Arşiv çıkarma (extract) | Bir alt kümeyi yeni arşive çıkar (klasör filtresi ile) | Seçili asset'ler yeni arşive kopyalanır, orijinaller korunur | 🟡 | ❌ |
| ARC-11 | Arşiv birleştirme (merge) | İki arşivi birleştir | Çakışma stratejisine göre birleştirilir, veri kaybı olmaz | 🟡 | ❌ |
| ARC-12 | Arşiv sağlık kontrolü | Health check çalıştır | Stale/missing/outdated dosyalar raporlanır | 🟡 | ❌ |
| ARC-13 | Delta tarama | Sadece eksik metadata'ları tara | Yalnızca eksik extractor'ler çalışır, mevcut veri korunur | 🟢 | ❌ |
| ARC-14 | Export (.archivistpro) | Arşivi .archivistpro olarak dışa aktar | ZIP dosyası oluşturulur (manifest + DB), indirilebilir | 🟡 | ❌ |
| ARC-15 | Import (.archivistpro) | .archivistpro dosyasını içe aktar | Manifest okunur, DB'ler birleştirilir, asset'ler eklenir | 🟡 | ❌ |
| ARC-16 | Peek manifest | İçe aktarmadan önce manifest'i oku | Arşiv bilgileri (ad, boyut, asset sayısı) gösterilir | 🟢 | ❌ |

### 7.3 Kaynak Klasörler

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ARC-20 | Kaynak klasör ekle | Yeni tarama kökü (scanned root) ekle | Klasör kaydedilir, sidebar'da görünür | 🔴 | ✅ |
| ARC-21 | Klasör etiketini değiştir | Kaynak klasör ismini yeniden adlandır | Yeni isim görünür, asset yolları değişmez | 🟡 | ✅ |
| ARC-22 | Klasör kaldır (asset'leri koru) | Kaynak klasörü kaldır, asset'leri tut | Klasör listeden silinir, asset'ler DB'de kalır | 🟡 | ✅ |
| ARC-23 | Klasör sil (asset'lerle birlikte) | Kaynak klasörü asset'lerle birlikte sil | Hem klasör hem altındaki tüm asset'ler silinir | 🔴 | ⚠️ |
| ARC-24 | Klasör grupları | Klasörleri gruplara ayır (renk/isim) | Gruplar oluşturulur, sidebar'da gruplanmış görünür | 🟢 | ❌ |
| ARC-25 | Klasör favorisi | Bir klasörü favori olarak işaretle | Favori klasörler üstte/öne çıkar | 🟢 | ✅ |

---

## 8. VERİTABANI & YEDEKLEME

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| DB-01 | DB okuma | Ana veritabanını oku | Geçerli SQLite binary döner, tüm tablolar erişilebilir | 🔴 | ✅ |
| DB-02 | DB yazma (atomic) | Veritabanını kaydet | Atomik yazma (fsync), bozulma riski yok | 🔴 | ✅ |
| DB-03 | DB bozulma tespiti | Bozuk DB dosyası ile uygulama aç | Bozulma tespit edilir, recovery flow başlar | 🔴 | ❌ |
| DB-04 | DB yolu değiştir | Admin olarak veritabanı konumunu değiştir | Yeni konumda DB oluşturulur veya mevcut yüklenir | 🟡 | ❌ |
| DB-05 | Snapshot oluştur | Veritabanı yedeği al | Snapshot dosyası oluşturulur, listede görünür | 🔴 | ✅ |
| DB-06 | Snapshot listele | Tüm snapshot'ları listele | En yeniden eskiye sıralı liste, tarih bilgisi ile | 🟡 | ✅ |
| DB-07 | Snapshot geri yükle | Bir snapshot'tan DB'yi geri yükle | DB eski haline döner, mevcut veri snapshot ile değişir | 🔴 | ❌ |
| DB-08 | Snapshot sil | Tek bir snapshot'ı sil | Dosya silinir, listeden kaldırılır | 🟢 | ✅ |
| DB-09 | 24 tablo şema kontrolü | DB'yi sıfırdan oluştur → tablo sayısını kontrol et | 24 tablo var, her birinin sütunları doğru | 🔴 | ✅ |
| DB-10 | DB bilgisi | get_database_info çağır | Aktif DB yolu ve dosya boyutu doğru döner | 🟢 | ❌ |

---

## 9. ASSET CRUD İŞLEMLERİ

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ASSET-01 | Asset oluşturma | Tarama ile yeni asset ekle | ID, ad, yol, format, tarih doğru kaydedilir | 🔴 | ✅ |
| ASSET-02 | Asset güncelleme | Mevcut asset'in metadata'sını düzenle (client, version, deadline) | Değişiklikler DB'ye kaydedilir, UI güncellenir | 🔴 | ✅ |
| ASSET-03 | Asset soft delete | Asset'i çöp kutusuna taşı | is_deleted=1, deleted_at dolduruluyor, listeden kaybolur | 🔴 | ✅ |
| ASSET-04 | Asset geri yükleme | Çöp kutusundan asset'i geri getir | is_deleted=0, deleted_at temizlenir, listede tekrar görünür | 🔴 | ✅ |
| ASSET-05 | Asset kalıcı silme | Çöp kutusundan kalıcı olarak sil | DB'den tamamen kaldırılır, geri alınamaz | 🔴 | ✅ |
| ASSET-06 | Çöp kutusunu boşalt | Tüm çöpteki asset'leri kalıcı sil | Tüm is_deleted=1 kayıtları silinir | 🟡 | ✅ |
| ASSET-07 | Favoriye ekle/çıkar | Asset'i favorilere ekle → çıkar | Favori flag doğru toggle eder | 🟡 | ✅ |
| ASSET-08 | Sadece favorileri göster | "Sadece favoriler" filtresini aç | Yalnızca favori asset'ler listelenir | 🟡 | ❌ |
| ASSET-09 | Dosya varlık kontrolü | check_files_exist ile disk kontrolü | Mevcut dosyalar true, silinmişler false döner | 🟡 | ❌ |
| ASSET-10 | Dosyayı explorer'da göster | show_in_folder çağır | Sistem dosya gezgini açılır, dosya seçili | 🟢 | ❌ |
| ASSET-11 | Dosyayı yerel uygulamada aç | open_file_native çağır | Varsayılan uygulama ile dosya açılır | 🟢 | ❌ |

---

## 10. ETİKETLEME (TAG)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| TAG-01 | Tag oluşturma | Yeni tag ekle (ad, renk) | Tag DB'ye kaydedilir | 🟡 | ✅ |
| TAG-02 | Tag düzenleme | Mevcut tag adını/rengini değiştir | Güncellenir, tüm atanmış asset'lerde yansır | 🟡 | ✅ |
| TAG-03 | Tag silme | Tag'i sil | Tag kaldırılır, asset bağlantıları temizlenir | 🟡 | ✅ |
| TAG-04 | Asset'e tag atama | Bir asset'e tag ekle | Bağlantı oluşturulur, DetailPanel'de görünür | 🟡 | ✅ |
| TAG-05 | Toplu tag atama | Birden fazla asset seç → tag ekle | Tüm seçili asset'lere tag atanır | 🟡 | ✅ |
| TAG-06 | Boşluklu tag | "  test tag  " gibi boşluklu tag oluştur | Trim uygulanır, "test tag" olarak kaydedilir | 🟢 | ✅ |
| TAG-07 | Duplicate tag engeli | Aynı isimde iki tag oluşturmaya çalış | İkincisi reddedilir veya uyarı verilir | 🟡 | ✅ |
| TAG-08 | Root tag'ler | Kaynak klasörlere özel tag'ler | CRUD çalışır, null DB durumunda hata vermez | 🟢 | ✅ |

---

## 11. İLİŞKİ (RELATION) YÖNETİMİ

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| REL-01 | İlişki oluşturma | İki asset arasında "pdf_export" ilişkisi kur | İlişki DB'ye kaydedilir, her iki tarafta görünür | 🟡 | ✅ |
| REL-02 | İlişki tipleri | Her tipi dene: pdf_export, render_of, version_of, project_group | Tüm tipler oluşturulabilir ve doğru etiketlenir | 🟡 | ⚠️ |
| REL-03 | İlişki silme | Mevcut ilişkiyi kaldır | İlişki DB'den silinir, her iki taraftan kaybolur | 🟡 | ✅ |
| REL-04 | İlişkili asset'leri görüntüleme | DetailPanel'de related assets bölümünü kontrol et | Bağlı asset'ler tip etiketiyle listelenir | 🟡 | ❌ |

---

## 12. UNDO/REDO

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| UNDO-01 | Silme geri alma | Asset sil → Ctrl+Z | Asset geri gelir, DB'de is_deleted=0 | 🔴 | ✅ |
| UNDO-02 | Tag atama geri alma | Tag ekle → Ctrl+Z | Tag bağlantısı kaldırılır | 🟡 | ✅ |
| UNDO-03 | Redo | Undo yaptıktan sonra Ctrl+Y | İşlem tekrar uygulanır | 🟡 | ✅ |
| UNDO-04 | Undo stack limiti | 50+ işlem yap → en eskisini undo dene | Stack limiti aşılmaz, en eski işlemler temizlenir | 🟢 | ✅ |
| UNDO-05 | Scanned root undo | Kaynak klasör sil → undo | Klasör geri gelir, asset'ler korunur | 🟡 | ✅ |

---

## 13. GÖRÜNTÜLEME MODLARI

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| VIEW-01 | Explorer (grid) görünümü | Explorer moduna geç | Asset'ler kart grid olarak gösterilir, thumbnail'lar yüklü | 🔴 | ❌ |
| VIEW-02 | Dashboard görünümü | Dashboard moduna geç | İstatistikler, grafikler, dağılımlar gösterilir | 🟡 | ❌ |
| VIEW-03 | Technical (tablo) görünümü | Technical moduna geç | Sıralanabilir tablo, sütunlar doğru, virtualization çalışıyor | 🟡 | ❌ |
| VIEW-04 | Folders görünümü | Folders moduna geç | Kaynak klasörler kart olarak gösterilir | 🟡 | ❌ |
| VIEW-05 | Kart boyutu ayarlama | Slider ile kart boyutunu değiştir (100-400px) | Kartlar boyut değiştirir, layout yeniden hesaplanır | 🟢 | ❌ |
| VIEW-06 | Mod geçişi state koruma | Explorer'da arama yap → Dashboard'a geç → Explorer'a dön | Arama sonuçları korunur | 🟡 | ❌ |

---

## 14. AI & CHAT SİSTEMİ

### 14.1 RAG Indexleme

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| AI-01 | Tekil asset indexle | Bir PDF/DOCX asset'i indexle | Metin çıkarılır, chunk'lara ayrılır, embedding vektörleri kaydedilir | 🟡 | ❌ |
| AI-02 | Toplu indexleme | 50 asset'i toplu indexle | Progress gösterilir, başarılı/atlanan/başarısız sayıları raporlanır | 🟡 | ❌ |
| AI-03 | İndexlenemez dosya | Video veya binary dosya indexlemeye çalış | Skip listesine eklenir, hata vermez | 🟢 | ✅ |
| AI-04 | Index durumu raporu | RAG index modalını aç | Missing/indexed/skipped asset sayıları gösterilir | 🟢 | ❌ |
| AI-05 | OCR ile indexleme | Görsel dosyayı OCR ile indexle | Görseldeki metin çıkarılır, chunk olarak kaydedilir | 🟡 | ❌ |

### 14.2 AI Chat

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| AI-10 | Yeni chat oturumu | Yeni sohbet başlat | Oturum oluşturulur, boş mesaj listesi | 🟡 | ✅ |
| AI-11 | Soru sor | İndexlenmiş dokumanla ilgili soru sor | LLM yanıtı stream olarak gelir, kaynak citation'lar gösterilir | 🔴 | ⚠️ |
| AI-12 | Chat geçmişi | Oturumu kapat → tekrar aç | Önceki mesajlar korunmuş, okunabilir | 🟡 | ✅ |
| AI-13 | Oturum silme | Chat oturumunu sil | Tüm mesajlar kalıcı olarak kaldırılır | 🟡 | ✅ |
| AI-14 | Oturum yeniden adlandırma | Chat başlığını değiştir | Yeni başlık sidebar'da güncellenir | 🟢 | ✅ |
| AI-15 | Sentez modu | Birden fazla belge üzerinde sentez soru sor | Çapraz belge analizi yapılır, sentez yanıt döner | 🟡 | ⚠️ |
| AI-16 | Chat export | Oturumu Markdown olarak dışa aktar | Geçerli .md dosyası indirilir, tüm mesajlar dahil | 🟢 | ✅ |
| AI-17 | Scope filtresi | Chat scope'u "belirli proje" ile sınırla | Sadece o projenin asset'leri üzerinden yanıt verilir | 🟡 | ❌ |

### 14.3 Ollama Entegrasyonu

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| AI-20 | Ollama ping | Ollama servisine bağlantı test et | "connected" veya "not available" doğru döner | 🟡 | ✅ |
| AI-21 | Ollama başlat/durdur | Servisi başlat → durdur | Servis sırasıyla çalışır ve durur | 🟡 | ❌ |
| AI-22 | Model indirme | Ollama model pull | Model indirilir, progress stream gösterilir | 🟡 | ❌ |
| AI-23 | GPU tespiti | detect_gpu çağır | NVIDIA GPU varsa true, yoksa false | 🟢 | ❌ |
| AI-24 | CORS ayarı | OLLAMA_ORIGINS ayarla | Registry'ye yazılır, kontrol doğru döner | 🟢 | ❌ |
| AI-25 | AI ayarları | Chat/vision model seç, URL/key ayarla | Ayarlar kaydedilir, sonraki oturumlarda korunur | 🟡 | ❌ |

---

## 15. DUPLIKAT TESPİT

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| DUP-01 | Tam hash eşleşme | Aynı içerikli iki dosyayı tara | SHA-256 eşleşmesi tespit edilir, grup olarak gösterilir | 🔴 | ⚠️ |
| DUP-02 | Aynı isim tespiti | Farklı klasörlerde aynı adlı dosyalar | İsim eşleşmesi tespit edilir | 🟡 | ⚠️ |
| DUP-03 | Görsel benzerlik (pHash) | Benzer ama farklı görseller | Hamming distance hesaplanır, eşik altındakiler gruplanır | 🟡 | ⚠️ |
| DUP-04 | Yapısal benzerlik (Jaccard) | Benzer metadata'lı DWG/MAX dosyaları | Jaccard skoru hesaplanır, yüksek benzerlikler raporlanır | 🟡 | ⚠️ |
| DUP-05 | Boyut toleransı | ±1KB toleransla duplicate ara | Sadece tolerans içindeki dosyalar eşleşir | 🟢 | ❌ |
| DUP-06 | Duplikat silme | Tespit edilen duplikat'ı sil | Dosya çöp kutusuna taşınır, diğer kopyalar korunur | 🟡 | ❌ |
| DUP-07 | Karşılaştırma görünümü | İki duplikat'ı yan yana karşılaştır | Metadata farkları gösterilir | 🟢 | ❌ |

---

## 16. ÇÖP KUTUSU (TRASH)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| TRASH-01 | Dosyayı çöpe taşı | Bir dosyayı çöp kutusuna gönder | Dosya trash dizinine taşınır, manifest güncellenir | 🔴 | ✅ |
| TRASH-02 | Çöpten geri yükle | Çöpteki dosyayı geri al | Dosya orijinal konumuna taşınır | 🔴 | ❌ |
| TRASH-03 | Çöpü boşalt | Tüm çöpü temizle | Tüm dosyalar kalıcı silinir, manifest boşalır | 🟡 | ❌ |
| TRASH-04 | Çöp dizini | Trash dizin yolunu al | Geçerli yol döner, dizin mevcut | 🟢 | ✅ |
| TRASH-05 | Manifest okuma/yazma | Trash manifest'i oku → değişiklik yap → yaz | Manifest tutarlı kalır, JSON geçerli | 🟡 | ❌ |

---

## 17. LAN PAYLAŞIM

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| LAN-01 | Sunucu başlat | Admin olarak LAN sunucusunu başlat | Port 9471'de HTTP sunucu çalışır, auth code oluşturulur | 🟡 | ❌ |
| LAN-02 | Sunucu durdur | Çalışan sunucuyu durdur | Sunucu kapanır, port serbest kalır | 🟡 | ❌ |
| LAN-03 | Sunucu durumu | Server status sorgula | Running/stopped, port, auth code, IP doğru döner | 🟡 | ✅ |
| LAN-04 | Auth code yenile | Yeni 8 haneli auth code oluştur | Eski kod artık çalışmaz, yeni kod aktif | 🟡 | ❌ |
| LAN-05 | Remote bağlantı | Client olarak IP + auth code ile bağlan | Manifest indirilir, remote arşiv erişilebilir | 🟡 | ❌ |
| LAN-06 | Remote arşiv indir | Uzak arşivi indir | Dosyalar indirilir, bütünlük doğrulanır | 🟡 | ❌ |
| LAN-07 | Yerel IP tespiti | get_local_ip çağır | Doğru yerel IP adresi döner | 🟢 | ❌ |
| LAN-08 | Yanlış auth code | Hatalı auth code ile bağlanmaya çalış | Bağlantı reddedilir, hata mesajı | 🟡 | ❌ |

---

## 18. 3DS MAX DÖNÜŞTÜRME

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| MAX-01 | Max versiyon stamp değiştir | Max dosyanın versiyon damgasını değiştir | Dosya başlığı güncellenir, dosya bozulmaz | 🟡 | ❌ |
| MAX-02 | Yüklü Max sürümlerini bul | Sistem taraması yap | Registry'deki tüm Max sürümleri listelenir | 🟡 | ❌ |
| MAX-03 | Max çalışıyor mu kontrol | is_max_running çağır | Çalışıyorsa true, çalışmıyorsa false | 🟢 | ❌ |
| MAX-04 | Gerçek dönüştürme (MAXScript) | Max dosyasını farklı sürüme dönüştür | MAXScript headless çalışır, yeni sürüm dosyası oluşur | 🟡 | ❌ |
| MAX-05 | FBX/OBJ export | Max sahnesini FBX veya OBJ'ye aktar | Geçerli FBX/OBJ dosyası oluşturulur | 🟡 | ❌ |

---

## 19. CAD ARAÇLARI (ODA Converter)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ODA-01 | ODA yolu ayarla | ODAFileConverter yolunu belirle | Yol kaydedilir, sonraki çağrılarda kullanılır | 🟢 | ❌ |
| ODA-02 | ODA otomatik tespit | detect_oda_converter çağır | Yüklü ise yol döner, değilse null | 🟢 | ❌ |
| ODA-03 | Bundled ODA kontrol | Paketlenmiş ODA'yı kontrol et | Varsa true, yoksa false | 🟢 | ❌ |
| ODA-04 | DXF cache temizle | DXF dönüştürme cache'ini temizle | Cache silinir, disk alanı serbest kalır | 🟢 | ❌ |

---

## 20. RENK & GÖRSEL ANALİZ

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| COLOR-01 | Dominant renk çıkarma | Bir görsel için get_dominant_colors çağır | Renk listesi (HEX) ve yüzde dağılımı döner | 🟡 | ❌ |
| COLOR-02 | RAL kod eşleme | Çıkarılan renkleri RAL koduna eşle | En yakın RAL kodu ve adı döner | 🟢 | ❌ |
| COLOR-03 | Görsel boyut | get_image_dimensions çağır | Genişlik ve yükseklik piksel olarak döner | 🟢 | ❌ |
| COLOR-04 | EXIF veri çıkarma | JPEG dosyasından EXIF al | Kamera, lens, ISO, tarih, GPS bilgileri (varsa) döner | 🟢 | ❌ |
| COLOR-05 | Render/fotoğraf ayrımı | EXIF ile render vs gerçek fotoğraf ayırt et | Render yapımcısı (VRay, Corona vb.) veya kamera modeli tespit edilir | 🟢 | ❌ |
| COLOR-06 | pHash hesaplama | Görselin perceptual hash'ini hesapla | 64-bit hash string döner | 🟡 | ⚠️ |
| COLOR-07 | Hamming distance | İki pHash arasındaki mesafeyi hesapla | 0 = aynı, yüksek = farklı; doğru sayısal değer | 🟡 | ✅ |

---

## 21. DOSYA ORGANİZASYON (REFILE)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| REFILE-01 | Projeye göre düzenle | Asset'leri proje adına göre yeniden organize et | Dosyalar proje klasörlerine taşınır, DB yolları güncellenir | 🟡 | ❌ |
| REFILE-02 | Kategoriye göre düzenle | Kategori bazlı organizasyon (01-Cizimler, 02-Modeller vb.) | Alt klasörlere ayrılır, dosya uzantısına göre doğru kategori | 🟡 | ❌ |
| REFILE-03 | Path traversal koruması | Hedef yolda "../" veya mutlak yol manipülasyonu dene | İşlem reddedilir, güvenlik hatası | 🔴 | ❌ |
| REFILE-04 | Toplu refile | Birden fazla dosyayı aynı anda yeniden düzenle | Tüm dosyalar taşınır, progress gösterilir | 🟡 | ❌ |

---

## 22. AYARLAR

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| SET-01 | Tema değiştirme | Dark ↔ Light tema geçişi | UI teması anında değişir, tercih kaydedilir | 🟡 | ✅ |
| SET-02 | Dil değiştirme | Türkçe → İngilizce → Türkçe | Tüm UI metinleri değişir, 1707 anahtar eksiksiz | 🟡 | ❌ |
| SET-03 | 5 dil kontrolü | Her dil (tr, en, zh, ja, ar) seç | Tüm diller yüklenir, eksik anahtar yok | 🟡 | ❌ |
| SET-04 | Oturum timeout ayarı | Timeout süresini değiştir (0 = kapalı, 5 = 5 dk) | Ayar kaydedilir, SessionTimeoutManager'a yansır | 🟢 | ❌ |
| SET-05 | Depolama uyarısı | Disk doluluk oranı yüksek iken kontrol et | StorageWarningBanner görünür | 🟡 | ✅ |
| SET-06 | Build features | get_build_features çağır | Admin flag ve yapılandırma bilgisi doğru döner | 🟢 | ✅ |

---

## 23. BİLDİRİM & UYARI

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| NOTIF-01 | Toast gösterimi | Info/success/warning/error toast tetikle | Doğru tür ve mesajla gösterilir, 5s sonra kaybolur | 🟡 | ✅ |
| NOTIF-02 | Maksimum toast | 6+ toast aynı anda tetikle | Maksimum 5 görünür, eskiler kaybolur | 🟢 | ✅ |
| NOTIF-03 | Onay dialogu | Silme gibi kritik işlem öncesi onay iste | ConfirmDialog görünür, "Evet" ile devam, "Hayır" ile iptal | 🟡 | ✅ |
| NOTIF-04 | Input dialogu | Metin girişi isteyen dialog göster | InputDialog görünür, OK ile değer döner, Cancel ile null | 🟡 | ✅ |

---

## 24. HATA YÖNETİMİ & KURTARMA

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| ERR-01 | ErrorBoundary | Bir bileşende runtime hatası simüle et | ErrorBoundary yakalar, hata ekranı gösterilir, uygulama çökmez | 🔴 | ✅ |
| ERR-02 | Crash raporu yazma | Frontend crash raporu oluştur | JSON dosyası kaydedilir, crash listesinde görünür | 🟡 | ⚠️ |
| ERR-03 | Crash raporlarını listele | list_crash_reports çağır | En yeniden eskiye sıralı liste | 🟢 | ⚠️ |
| ERR-04 | Crash raporu sil | Tek bir raporu sil | Dosya silinir, listeden kaldırılır | 🟢 | ⚠️ |
| ERR-05 | Tüm raporları temizle | clear_crash_reports çağır | Tüm raporlar silinir | 🟢 | ❌ |
| ERR-06 | Modal hata sınırı | Modal içinde hata oluşsun | ModalErrorBoundary yakalar, diğer modaller etkilenmez | 🟡 | ❌ |
| ERR-07 | DB recovery akışı | Bozuk DB ile uygulama başlat | Otomatik kurtarma denenr, snapshot varsa restore seçeneği sunulur | 🔴 | ❌ |

---

## 25. PERFORMANS & SİSTEM

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| PERF-01 | Disk alanı kontrolü | check_disk_space çağır | Kullanılabilir ve toplam alan doğru döner | 🟢 | ❌ |
| PERF-02 | Dosya metadata tarihi | get_file_metadata çağır | Oluşturma ve düzenleme tarihleri doğru döner | 🟢 | ❌ |
| PERF-03 | Staleness kontrolü | check_paths_staleness çağır | Değişen dosyalar doğru tespit edilir | 🟡 | ❌ |
| PERF-04 | Donanım tespiti | Hardware tier detect et | low/mid/high tier doğru tespit edilir | 🟢 | ✅ |
| PERF-05 | Uygulama çıkışı | app_quit çağır | Uygulama graceful kapanır, DB flush edilir | 🟡 | ❌ |
| PERF-06 | Büyük liste performansı | 2000+ asset'i grid'de göster | Virtualization ile akıcı scroll, bellek taşması yok | 🔴 | ✅ |

---

## 26. TOPLU İŞLEMLER (BATCH)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| BATCH-01 | Tekli seçim | Bir asset'e tıkla | Asset seçilir, BatchToolbar görünür | 🟡 | ❌ |
| BATCH-02 | Çoklu seçim | Ctrl+click ile birden fazla asset seç | Tüm seçimler aktif, sayı gösterilir | 🟡 | ❌ |
| BATCH-03 | Tümünü seç | "Tümünü seç" butonuna tıkla | Tüm görünür asset'ler seçilir, >50 ise uyarı | 🟡 | ✅ |
| BATCH-04 | Seçimi temizle | "Seçimi temizle" butonuna tıkla | Tüm seçimler kaldırılır | 🟡 | ✅ |
| BATCH-05 | Toplu silme | Seçili asset'leri toplu sil | Tüm seçililer çöp kutusuna taşınır | 🟡 | ❌ |
| BATCH-06 | Toplu tag ekleme | Seçili asset'lere tag ekle | Tag tüm seçililere atanır | 🟡 | ✅ |

---

## 27. KLAVYE KISAYOLLARI

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| KEY-01 | Ctrl+Z undo | İşlem yap → Ctrl+Z | Son işlem geri alınır | 🟡 | ✅ |
| KEY-02 | Ctrl+Y redo | Undo sonrası Ctrl+Y | İşlem yeniden uygulanır | 🟡 | ✅ |
| KEY-03 | Ctrl+F arama odağı | Ctrl+F bas | Arama kutusu odaklanır | 🟡 | ❌ |
| KEY-04 | Del silme | Asset seçili iken Del bas | Silme onayı istenir | 🟡 | ❌ |
| KEY-05 | Kısayol kaydı | Kısayol sistemi başlatılır | Tüm kayıtlı kısayollar çalışır | 🟢 | ✅ |

---

## 28. LOGLAMA & DENETİM

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| LOG-01 | Sistem logu yazma | write_system_log ile log yaz | Rust tracing sistemine log kaydedilir | 🟢 | ❌ |
| LOG-02 | Audit log | Kritik işlem (silme, login) yap | Audit log kaydı oluşturulur, hash chain bütün | 🔴 | ✅ |
| LOG-03 | Audit hash chain | Zincirleme hash doğrulaması yap | Tüm kayıtların hash'leri öncekiyle tutarlı | 🔴 | ✅ |
| LOG-04 | Log viewer | Log viewer modalını aç | Loglar filtrelenebilir, aranabilir | 🟢 | ❌ |
| LOG-05 | Admin aktivite paneli | Admin olarak aktivite geçmişini görüntüle | Login/logout olayları zaman çizelgesinde gösterilir | 🟡 | ❌ |

---

## 29. GÜNCELLEME & KURULUM

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| UPD-01 | Güncelleme kontrolü | Uygulama açılışında güncelleme kontrol et | Yeni sürüm varsa bildirim gösterilir | 🟢 | ❌ |
| UPD-02 | Onboarding tour | İlk kez açılışta tur başlat | Adım adım özellik turu gösterilir | 🟢 | ❌ |
| UPD-03 | Setup wizard | İlk kurulumda yapılandırma sihirbazı | Donanım, dil, tema ayarları yapılır | 🟡 | ❌ |
| UPD-04 | Performans setup | Hardware tier'a göre öneri sun | Otomatik cache boyutu ve quality ayarları | 🟡 | ✅ |

---

## 30. i18n (ÇOK DİLLİLİK)

| ID | Test | Adımlar | Beklenen Sonuç | Öncelik | Durum |
|----|------|---------|----------------|---------|-------|
| I18N-01 | Türkçe tam kapsam | tr.json'daki tüm anahtarları kontrol et | 1707 anahtar eksiksiz | 🟡 | ❌ |
| I18N-02 | İngilizce tam kapsam | en.json'daki tüm anahtarları kontrol et | 1707 anahtar eksiksiz, Türkçe kalmış metin yok | 🟡 | ❌ |
| I18N-03 | Çince tam kapsam | zh.json kontrolü | 1707 anahtar eksiksiz | 🟢 | ❌ |
| I18N-04 | Japonca tam kapsam | ja.json kontrolü | 1707 anahtar eksiksiz | 🟢 | ❌ |
| I18N-05 | Arapça tam kapsam | ar.json kontrolü + RTL düzeni | 1707 anahtar eksiksiz, RTL layout doğru | 🟢 | ❌ |
| I18N-06 | Eksik anahtar fallback | Olmayan bir anahtar çağır | Fallback dili (tr) kullanılır, hata vermez | 🟡 | ❌ |

---

## ÖZET

### Sayısal Genel Bakış

| Metrik | Değer |
|--------|-------|
| **Toplam test** | 247 |
| **🔴 Kritik** | 52 |
| **🟡 Yüksek** | 112 |
| **🟢 Normal** | 83 |
| **✅ Test var** | 74 (%30) |
| **⚠️ Kısmen test edilmiş** | 28 (%11) |
| **❌ Test yok** | 145 (%59) |

### Öncelik Sıralaması — İlk Yazılması Gereken Testler

1. **AUTH + RBAC** (21 test) — Güvenlik temeli, kimlik doğrulama ve yetki kontrolü
2. **DB + Recovery** (10 test) — Veri bütünlüğü, bozulma tespiti, kurtarma
3. **SCAN + Metadata** (18 test) — Temel iş akışı, dosya tespiti ve veri çıkarma
4. **Arama sistemi** (20 test) — Kullanıcının en çok kullandığı özellik
5. **Arşiv yönetimi** (17 test) — Çoklu arşiv, export/import, sağlık kontrolü
6. **AI pipeline** (17 test) — RAG, chat, embedding — yükselen kullanım
7. **Diğer** (144 test) — UI, LAN, refile, batch, ayarlar

### Kapsam Karşılaştırması

| Alan | Mevcut Durum | Hedef |
|------|-------------|-------|
| Statement coverage | %58 | %80+ |
| Branch coverage | %47 | %70+ |
| Function coverage | %71 | %90+ |
| Component test coverage | 16/92 (%17) | 40/92+ (%43+) |
| Hook test coverage | 6/21 (%29) | 15/21+ (%71+) |
| Service test coverage | %54 | %75+ |

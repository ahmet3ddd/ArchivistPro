# ArchivistPro Yönetici Kılavuzu

> Versiyon 2.4.4 | 2026-05-05 — Bu kılavuz sadece Admin (tam yetkili) kullanıcılar içindir.

---

## 1. Kullanıcı Rolleri ve Yetki Hiyerarşisi

ArchivistPro'da üç seviyeli bir yetki hiyerarşisi vardır:

| Rol | Kimdir | Kısaca |
|-----|--------|--------|
| Kurucu Yönetici | Programı ilk kuran, ilk oluşturulan admin hesabı | Her şeyi yapabilir + diğer yöneticileri yönetir |
| Yönetici (Admin) | Kurucu tarafından eklenen yöneticiler | Arşivi ve viewer kullanıcıları yönetir |
| Kullanıcı (Viewer) | Normal kullanıcılar | Arşiv salt-okunur, kendi yerel arşivi |

### Yetki Tablosu

| Eylem | Kurucu | Yönetici | Kullanıcı |
|-------|:------:|:--------:|:---------:|
| Arşiv görüntüleme | EVET | EVET | EVET |
| Arşiv yazma / tarama | EVET | EVET | HAYIR |
| Viewer ekle / sil | EVET | EVET | HAYIR |
| Yeni yönetici (admin) ekle | EVET | HAYIR | HAYIR |
| Yöneticiyi sil / rolünü düşür | EVET | HAYIR | HAYIR |
| Uygulama ayarlarını yönet | EVET | EVET | HAYIR |
| Log görüntüleme | EVET | EVET | HAYIR |
| Kurucunun rolü / silinmesi | HAYIR | HAYIR | HAYIR |

> **Kurucu kimdir?** Programın ilk açılışında "İlk Kurulum" ekranında oluşturulan admin hesabıdır.
> Otomatik olarak atanır ve bu hesap silinemez, rolü düşürülemez.
> Farklı bilgisayara taşıma durumunda da korunan hesap aynı DB'deki ilk admin olarak kalır.

### Örnek Senaryo

İki yönetici (Ayşe = kurucu, Mehmet = sonradan eklendi) aynı ofiste çalışıyor:
- Mehmet viewer kullanıcıları ekleyip silebilir (tam yetkili)
- Mehmet Ayşe'yi silemez veya rolünü düşüremez
- Mehmet yeni admin ekleyemez — bu karar Ayşe'ye aittir
- Ayşe, Mehmet'in rolünü isterse viewer'a düşürebilir

---

## 1b. Eski Bölüm — Çalıştırılabilir Dosyalar

| Rol | Exe |
|-----|-----|
| Admin | ArchivistPro.exe |
| Viewer | ArchivistPro-Viewer.exe |

---

## 2. İlk Çalışma Sihirbazı (Setup Wizard) ve Admin Hesabı

Uygulama ilk kez açıldığında iki aşamalı kurulum süreci yaşanır:

### 2a. Kurulum Sihirbazı

Login ekranından önce otomatik olarak **Kurulum Sihirbazı** görünür. Bu sihirbaz 4 adımda kullanıcıyı sisteme hazırlar:

1. **Hoş Geldin & Sistem Kontrolü**
   - WebAssembly (WASM) desteği kontrol edilir
   - İşletim sistemi versiyonu ve tahmini disk alanı gösterilir
   - **Dil seçimi** yapılabilir (Türkçe / English) — login ekranından önce olduğu için burada sunulur

2. **Donanım Tespiti**
   - CPU çekirdek sayısı, RAM ve benchmark sonuçları gösterilir
   - Sistem otomatik olarak Düşük / Orta / Yüksek performans modunu önerir
   - İstenirse farklı bir mod seçilebilir

3. **AI Kurulumu**
   - Ollama sunucusu otomatik kontrol edilir (localhost:11434)
   - Ollama çalışıyorsa mevcut vision modeller listelenir
   - 3 seçenek sunulur:
     - **Yerel AI (Ollama)** — veriler yerel kalır, GPU önerilir
     - **Bulut AI (Gemini/Groq)** — internet ve API anahtarı gerekir
     - **AI'ı Atla** — daha sonra Ayarlar'dan açılabilir
   - "Tekrar Kontrol Et" butonu ile Ollama durumu yeniden sorgulanabilir

4. **Hazır!**
   - Seçilen performans modu ve AI modu özetlenir
   - "Archivist Pro'yu Başlat" butonu ile bir sonraki adıma geçilir

### 2b. İlk Admin Hesabı Oluşturma

Sihirbaz tamamlandıktan sonra, **daha önce hiç kullanıcı oluşturulmamışsa** login ekranı yerine **"İlk Kurulum"** ekranı açılır:

- Kullanıcı adı ve parola belirleyin (kullanıcı adı 3–32 karakter, parola maks 128 karakter)
- "Admin Hesabı Oluştur" butonuna tıklayın
- Hesap oluşturulunca otomatik olarak giriş yapılır

> **Önemli:** Sistemde varsayılan `admin / admin` gibi hazır bir hesap yoktur. İlk admin hesabını siz oluşturursunuz.

### Eski Kullanıcılar

Daha önce uygulamayı kullanmış kişiler (Wizard tamamlanmış, kullanıcı tablosunda en az 1 kayıt var) sihirbaz ve ilk kurulum ekranını **tekrar görmez**.

### Sihirbazı Sıfırlama

Test amacıyla sihirbazı tekrar görmek isterseniz, tarayıcı geliştirici araçlarından (F12 > Application > Local Storage) `archivist_setup_wizard_done` ve `archivist_perf_setup_done` anahtarlarını silin.

---

## 3. Şifre Kurtarma

Eğer admin parolasını unutursanız, uygulama açılışında otomatik oluşturulan `recovery.key` dosyasını kullanarak parolayı sıfırlayabilirsiniz.

### Recovery Key Dosyası

- Konum: `%APPDATA%\com.archivistpro.desktop\recovery.key`
- 48 karakterlik hex string, uygulama ilk açıldığında bir kez oluşturulur
- Bu dosyayı güvenli bir yere yedekleyin (USB, şifreli bulut vb.)

### Parola Sıfırlama Adımları

1. Giriş ekranında **"Şifremi Unuttum"** bağlantısına tıklayın
2. `recovery.key` dosyasının içeriğini giriş kutusuna yapıştırın
3. Parola sıfırlanacak admin hesabını seçin
4. Yeni parolayı belirleyin ve onaylayın
5. Giriş ekranına yönlendirilirsiniz

> **Not:** Recovery key tek kullanımlık değildir; her sıfırlamada aynı key geçerlidir. Key dosyası kaybolursa ve tüm parolalar unutulursa, veritabanı dosyasını yedekleyip uygulamayı sıfırlamak gerekir.

---

## 4. Arşiv Yönetimi

### Sabit Arşivler
- **Ana Arşiv (shared)** — admin yönetir, viewer salt-okunur
  - Dosya: `archivist.db` (varsayılan: `AppDataDir/archivist.db`)
- **Yerel Arşiv (personal)** — kullanıcı bazlı
  - Dosya: `archivist_local.db`

### Çoklu Arşiv (Faz 1–3)
ArchivistPro N adet özel arşivi paralel yönetebilir. Her arşiv ayrı SQLite dosyasında tutulur ve kendi kaynak klasörleri, etiketleri ve favorileri vardır.

**Yeni Arşiv Oluşturma:**
- Ayarlar > Arşivler > "Yeni Arşiv" butonuna tıklayın
- İsim, tip (shared/personal) ve opsiyonel disk yolu girin
- Yeni arşiv sol paneldeki seçici listesine eklenir

**Birleştirme (Join/Merge):**
- İki arşivi tek arşivde birleştirir
- İşlem öncesi her iki arşivin snapshot'ı alınır
- Önizleme: kaç asset, çakışma, etiket, embedding birleşecek
- Çakışma stratejisi: skip / overwrite / rename
- Rollback: başarısız olursa tam geri alma

**Çıkarma (Extract):**
- Bir arşivden filtre uygulayarak alt küme oluşturur
- Kriterler: tür, etiket, kategori, tarih aralığı vb.
- Mod: copy (kaynakta kalır) veya move (kaynaktan silinir)
- Move modunda kaynak snapshot ile rollback güvencesi var

### Kaynak Klasör Yönetimi (Sidebar Paneli)
Sol paneldeki "Kaynak Klasörler" bölümü her arşivin taranmış kök dizinlerini gösterir:

- **Ekleme:** Tarama yapıldığında otomatik kaydedilir (her tarama = ayrı satır, tam path eşleşmesi)
- **Yeniden Tara:** 3 nokta menüsünden — sadece o klasörü scoped olarak yeniden tarar, diğer klasörlere dokunmaz
- **Yeniden Adlandır:** Görsel etiketi değiştirir (path değişmez)
- **Kaldır:** Klasörü listeden çıkarır, asset'ler arşivde kalır
- **Dosyalarla Birlikte Sil:** Klasör + altındaki tüm asset kayıtları silinir

> **Not:** Sayılar canlı hesaplanır (BAK ve silinmiş dosyalar hariç).

### Tarama ve İndeksleme
1. Sol paneldeki "Klasör Tara & İndeksle" butonuna tıklayın
2. Mod seçin:
   - **Listeye Ekle** (varsayılan) — yeni dosyalar eklenir
   - **Sıfırdan Tara** — *yalnızca seçilen klasör* altındaki kayıtlar silinip yeniden taranır. Diğer kaynak klasörler dokunulmaz (scoped replace).
3. Tarama öncesi otomatik DB snapshot alınır (güvenlik)
4. Son 5 snapshot tutulur, en eskisi otomatik silinir
5. Tarama sırasında **checkpoint** sistemi devrede — her N dosyada (varsayılan 50) veri diske yazılır, çökme/elektrik kesintisinde bile taranan dosyalar kaybolmaz
6. Checkpoint sıklığını **Ayarlar > Depolama** sekmesinden değiştirebilirsiniz (1, 5, 10, 25, 50, 75 veya 100 dosyada bir)

### Tarama Raporları
Her tarama sonrasında atlanan veya hata veren dosyaların listesi kaydedilir. Bu raporlara **Kaynak Klasörler > 3 nokta menü > "Tarama Raporları"** ile erişebilirsiniz. Raporlar uygulama veri klasörüne TXT olarak da kaydedilir.

### Klasör Değişiklik Tespiti (Watch Folders)
Ayarlar'dan **"Klasör değişikliklerini izle"** seçeneğini açarsanız:
- Taranmış klasörlerde dosya eklendiğinde/değiştiğinde/silindiğinde bildirim alırsınız
- **Otomatik yeniden tarama** seçeneğini de açarsanız, değişiklik tespit edildiğinde ilgili klasör otomatik yeniden taranır
- Bu özellik sadece açık olan kaynak klasörler için geçerlidir

### DWG Metadata — ODA File Converter Entegrasyonu
DWG dosyalarından gerçek metadata (katmanlar, bloklar, metin içeriği, xref'ler, çizim özellikleri) çıkarmak için **ODA File Converter** kullanılır.

**Kurulum:**
- Ayarlar > AI > "ODA File Converter" bölümünde otomatik algılama aktif
- Sistemde kuruluysa Registry + PATH'ten otomatik bulunur
- Kurulu değilse "İndir ve Kur" butonu (bundled installer veya winget/web)

**Davranış:**
- Tarama sırasında her DWG için ODA arka planda **görünmez** çalıştırılır (PowerShell `Start-Process -WindowStyle Hidden` wrapper sayesinde pencere açılmaz, odak çalmaz)
- DWG → temp DXF dönüştürülür, DXF parser ile metadata çıkarılır
- Sonuçlar `dwgLayers`, `dwgBlockNames`, `dwgTextContents`, `dwgXrefNames` alanlarına yazılır
- **Şekil verileri** — dosyadaki geometrik şekiller (polyline, arc, dikdörtgen) çıkarılır ve şekil aramasında kullanılır
- **Gömülü OLE objeleri** — DWG içine gömülü Excel/Word/PDF dosyaları tespit edilir
- ODA yoksa raw binary scan fallback'e düşülür (sessiz, eksik metadata)

**DWG Yapısal Benzerlik Arama:**
Bir DWG dosyasına sağ tıklayıp "Benzerini Bul" seçtiğinizde, CLIP görsel karşılaştırması yerine 5 boyutlu **composite skor** kullanılır: katman yapısı, blok yapısı, metin içeriği, şekil verileri ve pHash. Bu yöntem CAD dosyaları için daha güvenilir sonuç verir.

### Dosya Reorganizasyonu (Refile)
1. Üst bardaki "Organize Et" butonuna tıklayın
2. Organizasyon stratejisi seçin:
   - Projeye göre
   - Kategoriye göre
   - Faza göre
   - Malzemeye göre
3. Önizlemeyi kontrol edin
4. "Uygula" butonuyla dosyaları taşıyın

---

## 5. Log Yönetimi

### Audit Log
- Kim ne yaptı — tüm kullanıcı aksiyonları kaydedilir
- Kalıcıdır — sadece admin silebilir
- Silme işlemi de loglanır

### System Log
- Hatalar, uyarılar, performans metrikleri
- 7 gün tutulur, otomatik rotasyon

### Log Görüntüleme
Log panelinden tüm kayıtları filtreleyerek inceleyebilirsiniz.

---

## 6. Yedekleme ve Arşiv Paylaşımı

### DB Snapshot

Snapshot, veritabanınızın tam yedeğidir. Her tarama/indeksleme işleminden önce **otomatik olarak** alınır. Bunun yanı sıra elle de alınabilir.

**Otomatik davranış:**
- Her tarama başlamadan önce sessizce alınır
- Son 5 snapshot tutulur, en eskisi otomatik silinir

**Manuel snapshot (Ayarlar > Depolama):**
1. Ayarlar'ı açın → "Depolama" sekmesine geçin
2. **"Yedek Al"** butonuna tıklayın — snapshot tarih ve boyutuyla listeye eklenir
3. Her snapshot satırında:
   - **Geri Yükle** — o anki veritabanını bu snapshot ile değiştirir (onay ister)
   - **Sil** — sadece bu snapshot'ı kalıcı olarak siler

> **Not:** Viewer kullanıcıları ana arşivde snapshot alamaz. Yerel arşivleri için tam yetkilidir.

### Arşiv Export/Import (.archivistpro)

Tüm arşivi tek bir `.archivistpro` dosyası olarak dışa aktarabilir veya başka bilgisayardan gelen arşivi içe aktarabilirsiniz.

**Dışa Aktarma (Export):**
1. Ayarlar > Ağ sekmesine gidin
2. "Dışa Aktar / Rapor" butonuna tıklayın
3. Kayıt konumunu ve dosya adını seçin
4. Arşiv `.archivistpro` formatında (ZIP) oluşturulur

**İçe Aktarma (Import):**
1. Ayarlar > Ağ sekmesine gidin
2. "Import (.archivistpro)" butonuna tıklayın
3. İçe aktarılacak dosyayı seçin
4. Manifest önizlemesi görünür (versiyon, asset sayısı, DB boyutu)
5. Onaylayın — mevcut veritabanı otomatik olarak `.bak` ile yedeklenir

### LAN Paylaşımı (Mini HTTP Sunucu)

Ofis içi LAN üzerinden arşivi diğer bilgisayarlarla paylaşabilirsiniz. İnternet bağlantısı gerekmez.

**Sunucu Başlatma:**
1. Ayarlar > Ağ > "Sunucuyu Başlat" butonuna tıklayın
2. Ekranda gösterilen bilgileri not edin:
   - **IP Adresi** (ör. `192.168.1.106`)
   - **Port** (`9471`)
   - **Bağlantı Kodu** (8 haneli, ör. `25930014`)
3. Bu bilgileri Viewer kullanıcılarıyla sözlü/yazılı paylaşın

**Güvenlik:**
- Bağlantı kodu ilk sunucu başlatmada rastgele üretilir (CSPRNG) ve **kalıcı olarak kaydedilir** — uygulamayı yeniden başlatırsanız kod değişmez
- "Kodu Yenile" butonuna tıklayarak kodu elle yenileyebilirsiniz (yeni kod anında aktif olur, sunucu restart gerekmez)
- Kod olmadan erişim mümkün değildir (403 hatası)
- 5 başarısız denemeden sonra kaynak IP 5 dakika engellenir
- Sunucu yalnızca yerel ağda (LAN) erişilebilir
- Veriler şifrelenmez — yalnızca güvenilir ofis ağlarında kullanın

**Sunucu Durdurma:**
- "Sunucuyu Durdur" butonuna tıklayın
- Tüm bağlantılar kesilir

> **Not:** Sunucu çalışırken istemci moduna (bağlan) geçemezsiniz. Önce sunucuyu durdurun.

---

## 7. 3ds Max Sürüm Dönüştürme

### Hızlı Mod (Damga Değiştirme)
- Dosyanın versiyon damgasını değiştirir
- Orijinal dosya korunur, yanına yeni dosya oluşturulur
- Hızlı ama bazı durumlarda sorun çıkabilir

### Gerçek Mod (MAXScript)
- Kurulu 3ds Max'ı kullanarak dosyayı yeniden kaydeder
- Daha güvenilir ama Max'ın kurulu olması gerekir
- Max arka planda (headless) çalışır

### FBX / OBJ Export
MAX dosyalarını FBX veya OBJ formatına dönüştürebilirsiniz. Detay panelinde MAX dosyası seçiliyken iki export butonu görünür:

| Mod | Açıklama | Gereksinim |
|-----|----------|------------|
| **Hızlı Mod** | Temel geometri dönüşümü | Yok |
| **Gerçek Mod** | 3ds Max native FBXEXP/ObjExp plugin ile | 3ds Max kurulu |

- Gerçek Mod'da bilgisayarınızdaki 3ds Max kurulumları otomatik algılanır (Registry taraması)
- Dönüştürülen dosya İndirmeler klasörüne kaydedilir
- İşlem sırasında Max arka planda (headless) çalışır, 5 dakika zaman aşımı uygulanır

### MAX Metadata Görüntüleme
Detay panelinde MAX dosyaları için ek bilgiler gösterilir:
- **Katmanlar** — dosyanın katman yapısı (renkli etiketler)
- **Objeler** — dosyadaki nesne isimleri (max 30 gösterilir, fazlası "+N daha" notu)
- Bu bilgiler CFB binary stream'den UTF-16LE olarak çıkarılır

---

## 8. AI Ayarları

### Yerel AI (Ollama)
1. [Ollama](https://ollama.ai) kurun
2. `ollama pull llava` ile model indirin
3. CORS ayarı: `setx OLLAMA_ORIGINS "*"` (Windows)
4. AI Ayarları'ndan Ollama'yı seçin

### Cloud AI
- Google Gemini, OpenAI, Groq desteklenir
- API anahtarınızı AI Ayarları'na girin
- **Güvenlik:** API anahtarları oturum bazlı tutulur, diske/localStorage'a yazılmaz

---

## 9. Veritabanı Güvenliği

- Silme işlemleri atomik (transaction ile korunur)
- Foreign key cascade aktif — asset silindiğinde embedding, tag, favori otomatik temizlenir
- Veritabanı kaydetme hatası durumunda bildirim gösterilir
- Veritabanı yolu değiştirilirken path traversal koruması uygulanır

---

## 9b. Onay Kuyruğu (Approval Workflow)

Dashboard görünümünde yöneticiler için **Onay Kuyruğu** paneli bulunur. Bu panel, "İncelemede" durumundaki dosyaları toplu yönetmenizi sağlar.

### Dashboard Paneli
- **4 durum badge'i:** Taslak, İncelemede, Onaylandı, Reddedildi — her birinin kaç dosyada olduğu gösterilir
- **Bekleyen listesi:** "İncelemede" dosyalar sıralanır (max 20, kaydırılabilir)
- **Toplu işlem:** "Tümünü Onayla" veya "Tümünü Reddet" butonları

### Red Sebebi
Bir dosyayı reddettiğinizde açılan metin alanına sebebi yazabilirsiniz (ör. "Ölçekler hatalı"). Bu bilgi dosyanın detay panelinde ve XMP sidecar export'unda görünür. Dosya daha sonra onaylandığında red sebebi otomatik temizlenir.

### Onay Geçmişi (Audit Trail)
Her onay durumu değişikliği `approval_log` tablosuna kaydedilir:
- Kim değiştirdi
- Ne zaman
- Hangi durumdan → hangi duruma
- Varsa red sebebi

Dashboard'da **"Onay Geçmişi"** panelinde son 10 işlem kronolojik olarak gösterilir.

---

## 9c. XMP Metadata Export

Dosyalarınızın metadata bilgilerini standart **XMP sidecar** formatında dışa aktarabilirsiniz:
- Dosyaya sağ tıklayın → "XMP Dışa Aktar"
- Dosyanın yanına `.xmp` uzantılı sidecar oluşturulur
- Yazılamazsa uygulama veri klasörüne kaydedilir
- İçerik: dosya adı, proje, kategori, etiketler, onay durumu, müşteri, versiyon ve varsa red sebebi

---

## 9d. Sağlık Kontrolü (Fixity Check)

Arşivinizdeki dosyaların bütünlüğünü örneklem bazlı kontrol eder:
1. Ayarlar'dan "Sağlık Kontrolü"ne gidin
2. "Taramayı Başlat" butonuna tıklayın
3. Sistem dosyaların checksum'larını doğrular
4. Değişmiş veya bozulmuş dosyalar rapor edilir

**Eski Format Tespiti:** Sistem ayrıca eski Office binary formatlarını (`.doc`, `.xls`, `.ppt`) tespit ederek modern OOXML formatına (`.docx`, `.xlsx`, `.pptx`) dönüştürme önerisi sunar.

---

## 9e. Retention ve Konfigürasyon

Ayarlar'dan şu süreleri yapılandırabilirsiniz:
- **Snapshot retention** — otomatik snapshot'ların saklanma süresi
- **Hesap kilitleme süresi** — başarısız giriş sonrası kilitleme süresi
- **Oturum zaman aşımı** — kullanıcı hareketsiz kaldığında otomatik kilitleme (5-120 dakika)

---

## 9f. AI Hassasiyet Filtresi

Arşivinizdeki hassas dosyaların (sözleşmeler, maaş tabloları, kişisel veriler) AI sohbette sonuç olarak çıkmasını engelleyen 3 katmanlı koruma sistemi.

### Neden Gerekli?

AI sohbet tüm taranan dosyaları sorgulayabilir. Bir viewer kullanıcı "müşteri sözleşmesi var mı?" veya "maaş tablosunu bul" dediğinde, arşivde böyle bir dosya varsa AI onu bulup gösterir. Bu filtre ile hassas verileri AI'dan gizleyebilirsiniz — dosyalar arşivde görünmeye devam eder, sadece AI erişemez.

### Katman 1 — Hazır Kategoriler

Ayarlar > Güvenlik > **AI Hassasiyet Filtresi** kartından etkinleştirin. 4 kategori açılıp kapatılabilir:

| Kategori | Algılanan Kelimeler |
|----------|---------------------|
| **Finansal** | maaş, fatura, teklif, bütçe, ödeme, maliyet, hakediş, keşif, gelir, gider, banka, IBAN |
| **Kişisel Bilgi** | TC kimlik, nüfus, telefon, adres, doğum, ehliyet, pasaport |
| **Hukuki** | sözleşme, NDA, gizlilik, mahkeme, ihtarname, vekaletname, noter, dava |
| **İnsan Kaynakları** | özlük, izin, sicil, performans, disiplin, işe alım, mülakat |

Bu kelimeler dosya adı, proje adı ve dosya içeriğinde (chunk text) taranır. Eşleşen dosyanın tamamı AI'dan hariç tutulur.

### Katman 2 — Özel Anahtar Kelimeler

Aynı ayar kartından kendi kelimelerinizi ekleyebilirsiniz. Örneğin:
- Hassas müşteri adı: `"Villa Kaya"`
- Gizli proje kodu: `"internal"`, `"gizli"`

Kelime eklediğinizde veya kaldırdığınızda filtre anında güncellenir.

### Katman 3 — Manuel Dosya/Klasör Gizleme

- **Tek dosya:** Dosyaya sağ tık → **"AI'dan Gizle"** (tekrar tıklayarak geri alabilirsiniz)
- **Tüm klasör:** Kaynak Klasörler panelinde 3 nokta menüden → **"AI'dan Hariç Tut"**

### Nasıl Çalışır (Teknik)

```
Kullanıcı AI'a soru sorar
    ↓
RAG pipeline arama başlatır (FTS + semantik + metadata)
    ↓
Hassasiyet filtresi devreye girer:
  ✗ rag_excluded = 1 olan dosyalar → ATLA
  ✗ Aktif kategori kelimelerini içeren dosyalar → ATLA
  ✗ Özel anahtar kelimeleri içeren dosyalar → ATLA
    ↓
Kalan dosyalar AI'a gönderilir
```

> **Not:** Filtre yalnızca AI sohbeti etkiler. Normal arama, filtreleme, detay paneli ve kopya bulucu filtreden etkilenmez.

---

## 10. Kopya & Benzer Dosya Bulucu

Bu araç arşivinizdeki tekrar eden veya birbirine benzeyen dosyaları tespit eder, karşılaştırır ve gerekirse siler.

> **Erişim — Admin:** Tüm özellikler aktif (tarama, görüntüleme, **silme**).
> **Erişim — Viewer:** Tarama ve görüntüleme yapabilir, ancak **silme işlemi sadece admin'e açıktır**.

### 10.1 Panele Erişim

Üst bardaki **⎇ (fork/dal)** ikonuna tıklayın — çöp kutusu ikonu ile beyin ikonu arasında yer alır. Üzerine gelince "Kopya Bul" yazısı çıkar.

### 10.2 Tespit Modları

Dört bağımsız mod birlikte veya ayrı ayrı çalışabilir:

| Mod | Ne Tespit Eder? | Nasıl Çalışır? |
|-----|----------------|----------------|
| **Birebir Kopya** | Aynı içerikli dosyalar (farklı isim/konum olabilir) | Dosya hash'i (SHA karşılaştırma) — anlık |
| **Aynı İsim** | Farklı klasörde aynı dosya adı | Dosya adı eşleştirme — anlık |
| **Görsel Benzerlik** | Görsel açıdan benzer görseller | pHash Hamming distance (64-bit) — ~100ms/1000 görsel |
| **Yapısal Benzerlik** | Benzer katman/malzeme/içerik yapısı | Jaccard similarity — sadece CAD, 3D, döküman |

#### Desteklenen dosya türleri (görsel benzerlik)
`JPG · PNG · BMP · WEBP · TIFF · TGA · EXR · HDR · PSD`

#### Desteklenen dosya türleri (yapısal benzerlik)
`DWG · DXF · IFC · MAX · SKP · PDF · DOC/DOCX · XLS/XLSX · PPT/PPTX · RVT`

#### Yapısal benzerlik detayı (dosya türüne göre, v2.1.2)

| Tür | Karşılaştırılan Alanlar |
|-----|------------------------|
| DWG / DXF | Katman isimleri (1.0) + Blok isimleri (1.0) + Metin içeriği (0.8) + Xref'ler (0.6) — ağırlıklı Jaccard |
| IFC | Kat sayısı + Entity sayısı (yakınlık eşleşmesi) + (varsa) katman isimleri |
| 3DS MAX | Malzeme isimleri (Jaccard) + Render motoru eşleşmesi (+50) + Max sürümü eşleşmesi (+35) |
| SketchUp | Bileşen isimleri + Katman isimleri (Jaccard) + SketchUp sürümü eşleşmesi (+35) |
| Revit | Kat adları (Jaccard) + Proje adı (+50) + Alan sayısı yakınlığı |
| PDF / DOCX / XLSX... | Başlık (+40) + Yazar (+30) + Sayfa sayısı (+30) |

#### Genel Kriterler (cross-format ön-filtre)
Yapısal Benzerlik ve Aynı İsim modlarına opsiyonel ek koşullar:

- **Aynı dosya boyutu** — tolerans seçilebilir: tam eşleşme, ±1 KB, ±%1
- **Değişiklik tarihi yakın** — N gün penceresi
- **Aynı klasör adı** — parent klasör basename eşleşmesi (case-insensitive)

Bu koşullar `passesGeneralCriteria()` üzerinden çift bazında uygulanır, eşleşmeyen çiftler benzerlik hesabına bile alınmaz (false positive azaltır + hızlandırır).

#### Performans Filtreleri
- **Minimum dosya boyutu (KB)** — bu boyutun altındaki dosyalar tarama havuzundan ön-filtreyle çıkarılır

### 10.3 Kapsam Seçimi

Panel açıldığında hangi arşivi tarayacağınızı seçin. Mevcut tüm arşivler (Ana Arşiv, Yerel Arşiv ve eklediğiniz özel arşivler) sekmelerde listelenir:

| Kapsam | Kimler Erişebilir | Silme Yetkisi |
|--------|-------------------|---------------|
| **Ana Arşiv (shared)** | Admin + Viewer | Yalnızca Admin |
| **Yerel Arşiv (personal)** | Admin + Viewer | Admin + Viewer |
| **Özel Arşivler** | Tip'e göre değişir (shared = sadece admin yazar, personal = sahibi yazar) | Tip'e göre |

> **Viewer Notu:** Personal tipindeki arşivlerde silebilirsiniz. Shared arşivlerde sadece admin silebilir.
> Bir arşiv henüz yüklenmemişse sekme devre dışı görünür — önce Sidebar'dan o arşive geçin.

### 10.4 Panel Arayüzü

```
┌─────────────────────────────────────────────────────────────┐
│  ⎇  Kopya & Benzer Dosya Bulucu                   [?]  [✕]  │
├─────────────────────────────────────────────────────────────┤
│  [✓] Birebir Kopya   [✓] Aynı İsim                         │
│  [✓] Görsel Benzerlik  [✓] Yapısal Benzerlik               │
│                                                             │
│  Benzerlik Eşiği:  ◄─────────●─────►  75%                  │
│  (Görsel ve Yapısal modlar için geçerlidir)                 │
│                                              [ Tara ]       │
├─────────────────────────────────────────────────────────────┤
│  5 grup, 14 dosya — 7.32ms       [Liste] [Karşılaştır]      │
├─────────────────────────────────────────────────────────────┤
│  BİREBİR KOPYA — 1 grup                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ proje_A.dwg (3 kopya)   [İlkini Koru, Diğ. Sil]   │   │
│  │  [  ] /Ofis/A/proje_A.dwg  1.2 MB  2024-03   [⎇][🗑]│   │
│  │  [✓] /Yedek/proje_A.dwg   1.2 MB  2023-11   [⎇][🗑]│   │
│  │  [✓] /Eski/proje_A.dwg    1.2 MB  2023-08   [⎇][🗑]│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  GÖRSEL BENZER — 2 grup                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ render_v1.jpg  pHash farkı: 5/64 bit → %92        │   │
│  │  [  ] /Render/render_v1.jpg  2.4 MB  2024-03  [⎇][🗑]│  │
│  │  [  ] /Render/render_v2.jpg  2.4 MB  2024-03  [⎇][🗑]│  │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                         [ Seçilileri Sil (2) 🗑 ]           │
└─────────────────────────────────────────────────────────────┘
```

**Simgeler:**
- `[⎇]` — Bu dosyayı Karşılaştırma paneline ekle
- `[🗑]` — Yalnızca bu dosyayı sil (anlık onay ister)
- `[✓]` checkbox — Toplu silme için işaretle

### 10.5 Benzerlik Eşiği Ayarı

Kaydırıcı yalnızca **Görsel Benzerlik** ve **Yapısal Benzerlik** modlarını etkiler.

```
Düşük eşik (%50)         Yüksek eşik (%95)
◄●─────────────────►     ◄─────────────●►
Daha fazla sonuç          Daha az, kesin sonuç
(yanlış pozitif riski)    (yalnızca çok benzer)
```

Önerilen başlangıç değeri: **%75**. DWG/CAD için %60–70, görsel için %85–90 daha iyi sonuç verebilir.

### 10.6 Hash / Metadata Eksik Uyarıları

Tarama sonucunda üç ayrı uyarı görülebilir:

> ⚠ Hash eksik: 23 dosya — bunlar Birebir Kopya taramasına dahil edilemez.
> ⚠ X dosyada pHash eksik — Görsel benzerlik taramasında atlandılar.
> ⚠ X dosyada metadata eksik — Yapısal benzerlik taramasında atlandılar.

Her uyarının yanında:
- **Dosyaları Göster** — eksik dosyaları listeler
- **Bunları Tara** — sadece bu dosyaları yeniden tarar (ScanModal pendingRescanPaths üzerinden)
- **Atla** — uyarıyı kapat, mevcut sonuçlarla devam et

> **İpucu:** Tek bir kaynak klasörü tamamen tazelemek istiyorsanız Sidebar > Kaynak Klasörler > 3 nokta > "Yeniden Tara" daha pratiktir. Modal otomatik açılır, sadece o klasörü scoped olarak yeniden tarar.

### 10.7 Liste Görünümü — Adımlar

1. **Tara** butonuna tıklayın — sonuçlar tip başlıklarına göre gruplar
2. Gruba tıklayarak açın/kapatın (▼ / ►)
3. Her grupta hangi dosyanın benzediği ve neden benzediği görünür
4. **İlkini Koru, Diğerlerini Sil** — en yeni dosyayı korur, diğerlerini checkbox ile işaretler
5. Checkbox ile istediğiniz dosyaları seçin
6. **Seçilileri Sil** — toplu silme için onay ister

> **Not:** Silinen dosyalar arşivden kalıcı olarak çıkarılır. Ctrl+Z ile geri alınamaz.

### 10.8 Karşılaştırma Görünümü

İki dosyayı yan yana inceleyin:

```
┌────────────────────────┬────────────────────────┐
│     render_v1.jpg      │     render_v2.jpg       │
│  ┌──────────────────┐  │  ┌──────────────────┐   │
│  │   [ önizleme ]   │  │  │   [ önizleme ]   │   │
│  └──────────────────┘  │  └──────────────────┘   │
│                        │                         │
│  Boyut:   2.4 MB       │  Boyut:   2.4 MB        │
│  Boyutlar: 1920×1080   │  Boyutlar: 1920×1080    │
│  Tür:     JPG          │  Tür:     JPG            │
│  Konum:   /Render/v1   │  Konum:   /Render/v2    │
│  Tarih:   2024-03-01   │  Tarih:   2024-03-15    │
│                        │                         │
│  [ Solu Sil 🗑 ]       │  [ Sağı Sil 🗑 ]        │
├────────────────────────┴────────────────────────┤
│  pHash farkı: 5/64 bit  →  %92 benzerlik        │
└──────────────────────────────────────────────────┘
```

**Karşılaştırma görünümüne geçiş:**
- Liste görünümünde herhangi bir dosyanın `[⎇]` ikonuna tıklayın
- Üst barda **[Karşılaştır]** butonuna geçin
- İlk tıklanan dosya sol, ikinci tıklanan sağ kolona yerleşir

### 10.9 Silme Akışı

```
Checkbox seç  ──►  "Seçilileri Sil" ──►  Onay Diyaloğu
                                              │
                              ┌───────────────┴──────────────┐
                              │  Evet                  Hayır  │
                              ▼                               │
                   Dosyalar arşivden silinir       İşlem iptal
                   Gruplar güncellenir
                   Bildirim gösterilir
```

> **Admin İpucu:** Büyük arşivlerde önce **Birebir Kopya** modunu tek başına çalıştırın, bunlar en güvenli silme adaylarıdır. Görsel/Yapısal benzerlik sonuçlarını silmeden önce Karşılaştırma görünümünde doğrulayın.

### 10.10 Erişim Farklılıkları (Admin vs Viewer)

| Özellik | Admin (Ana) | Admin (Yerel) | Viewer (Ana) | Viewer (Yerel) |
|---------|:-----------:|:-------------:|:------------:|:--------------:|
| Paneli açma | ✅ | ✅ | ✅ | ✅ |
| Tarama yapma | ✅ | ✅ | ✅ | ✅ |
| Sonuçları görüntüleme | ✅ | ✅ | ✅ | ✅ |
| Karşılaştırma görünümü | ✅ | ✅ | ✅ | ✅ |
| Tekil dosya silme | ✅ | ✅ | ❌ | ✅ |
| Toplu silme | ✅ | ✅ | ❌ | ✅ |

---

## 11. Dosya İlişkileri Yönetimi

Dosyalar arasında ilişki kurarak proje dosyalarınızı bağlamsal olarak organize edebilirsiniz.

### İlişki Türleri

| Tür | Anlamı | Otomatik Tespit |
|-----|--------|:---------------:|
| **PDF Çıktısı** | DWG/MAX'ın PDF versiyonu | ✅ (aynı stem, farklı uzantı) |
| **Render** | Tasarımın görselleştirmesi | ✅ (model + görsel eşleşmesi) |
| **Versiyon** | Aynı dosyanın farklı sürümü | ✅ (v1/v2/Rev-A pattern) |
| **Proje Grubu** | Aynı projeye ait dosyalar | Manuel |

### Otomatik Tespit
Tarama sonrasında otomatik ilişki tespiti çalışır:
- `plan.dwg` + `plan.pdf` → PDF Çıktısı (aynı stem, farklı uzantı)
- `salon.max` + `salon_render.jpg` → Render
- **Versiyon kümeleme:** `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg`, `plan_FINAL.dwg` gibi dosyalar otomatik olarak "Versiyon" ilişkisiyle bağlanır
  - Tanınan kalıplar: `_v1`, `_Rev-A`, `_R01`, `_FINAL`, `_DRAFT`, `_eski`, `_yeni`, `(Kopya)`, `(1)/(2)`, sondaki sayılar
- Otomatik bağlantılarda `[Otomatik]` etiketi gösterilir

### Manuel Bağlantı
1. Detay panelinde "Bağlantılı Dosyalar" bölümünü açın
2. "Bağlantı Ekle" butonuna tıklayın
3. İlişki türünü seçin
4. Bağlanacak dosyayı arayın ve seçin
5. Bağlantıyı kaldırmak için satırdaki X butonuna tıklayın

### Kaynak Klasör Menüsünden Toplu Tespit
Sol paneldeki Kaynak Klasörler bölümünde herhangi bir klasörün 3 nokta menüsünden "Bağlantıları Tara" seçerek o klasördeki tüm ilişkileri yeniden tespit ettirebilirsiniz.

---

## 12. Talep Sistemi (Admin İş Koordinasyonu)

Adminler arası iş koordinasyonu için talep (request) sistemi mevcuttur.

### Talep Gönderme
1. Mesajlaşma panelinde yeni mesaj oluşturun
2. Tür olarak **"Talep"** seçin
3. Alıcı otomatik gizlenir — talep **tüm adminlere** gider
4. Konu ve açıklama yazıp gönderin

### Talepleri Yönetme
Gelen talepler mesaj panelinde görüntülenir:
- **Üstlen** — Talebi kendi sorumluluğunuza alın
- **Bırak** — Sorumluluktan çıkın (talep tekrar herkese açılır)
- **Çözüldü** — Sadece üstlenen admin bu butonu görebilir

Üstlenen adminin adı talep satırında badge olarak gösterilir.

---

## 13. Çöp Kutusu ve Kurtarma

Silinen dosyalar kalıcı olarak silinmez, önce çöp kutusuna taşınır (soft delete).

### Çöp Kutusuna Taşıma
- Dosya silindiğinde `is_deleted = 1` olarak işaretlenir
- Tüm metadata, etiketler, ilişkiler ve proje durumu bilgileri korunur

### Geri Yükleme
- Üst bardaki çöp kutusu ikonuna tıklayın
- Listeden dosyayı seçip "Geri Yükle" butonuna tıklayın
- Dosya tüm bilgileriyle birlikte arşive geri döner

### Kalıcı Silme
- Çöp kutusunda "Kalıcı Sil" ile dosya veritabanından tamamen kaldırılır
- "Çöpü Boşalt" ile tüm çöpteki dosyalar kalıcı silinir
- Bu işlem geri alınamaz

> **Not:** Yeniden tarama sırasında çöp kutusundaki bir dosyanın aynısı disk üzerinde bulunursa, dosya otomatik olarak çöpten çıkarılıp arşive geri alınır (kullanıcı tanımlı alanlar korunur).

---

## 14. Uygulama Kapatma Onayı

Pencereyi **X butonu** veya **Alt+F4** ile kapatmaya çalıştığınızda uygulama bir onay diyaloğu gösterir.

- **"Çık"** — uygulamayı kapatır (açık işlemler sonlandırılır)
- **"İptal"** — uygulamada kalırsınız

Bu koruma uzun süren tarama veya indirme işlemlerinin yanlışlıkla kesilmesini önler.

---

## 15. Yardım Sistemi ve Çeviri Durumu

- Yardım kılavuzları `public/docs/<dil>/user-guide.md` ve `admin-guide.md` yapısındadır
- Şu an tam içerik **yalnızca Türkçe** mevcuttur (`tr/`)
- Arayüz çevirileri: **5 dil %100** (TR, EN, ZH, JA, AR — 1825 anahtar)
- 5 dilde tam kapsam mevcuttur: TR (kaynak), EN, ZH, JA, AR. ZH/JA/AR sürümleri AI çevirisidir; ana dili konuşan biri tarafından üretim öncesi gözden geçirilmesi önerilir
- Yeni dil eklemek için: `public/docs/<lang>/` klasörünü oluşturup `user-guide.md`, `admin-guide.md` ve `scenarios.md` (TR için `kullanim-senaryolari.md`) dosyalarını çevirip yerleştirin — ek kod değişikliği gerekmez. Eksik dilde help paneli açılırsa **locale fallback chain** ile EN'e (yoksa TR'ye) düşülür

---

*Bu kılavuz program geliştikçe güncellenmektedir. Son güncelleme: 2026-05-05 (v2.4.4)*

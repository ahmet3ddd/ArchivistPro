# ArchivistPro Kullanım Kılavuzu

> Versiyon 2.4.4 | 2026-05-05

## Hoş Geldiniz

ArchivistPro, mimari dosyalarınızı akıllı bir şekilde arşivlemenizi, aramanızı ve yönetmenizi sağlayan masaüstü uygulamasıdır.

---

## 1. İlk Çalışma — Kurulum Sihirbazı

Uygulamayı ilk kez açtığınızda **Kurulum Sihirbazı** sizi karşılar. Bu rehber 4 adımda sisteminizi hazırlar:

1. **Sistem Kontrolü** — Bilgisayarınızın uyumluluğu test edilir ve dil seçimi yapılır (Türkçe ve İngilizce tam destekli; Çince/Japonca/Arapça arayüzü kısmen çevrilidir)
2. **Donanım Tespiti** — İşlemciniz ve belleğiniz analiz edilir. Size uygun performans modu önerilir (Düşük/Orta/Yüksek)
3. **AI Kurulumu** — Yapay zeka özelliklerinin nasıl çalışacağını seçersiniz:
   - **Yerel AI (Ollama)** — Tüm veriler bilgisayarınızda kalır
   - **Bulut AI** — İnternet üzerinden çalışır (API anahtarı gerekir)
   - **Atla** — AI olmadan kullanmaya başlayın, daha sonra Ayarlar'dan açabilirsiniz
4. **Özet** — Seçimleriniz gösterilir ve kurulum tamamlanır

> **Not:** Sihirbaz sadece bir kez gösterilir. İlk çalıştırmada sihirbazın ardından admin hesabı oluşturma ekranı gelir (önceden tanımlı bir şifre yoktur — kendiniz belirlersiniz). Tekrar açılışlarda doğrudan giriş ekranına yönlendirilirsiniz.

---

## 2. Ana Ekran

Ana ekran üç bölümden oluşur:

- **Sol Panel (Sidebar):** Üstte arşiv seçici ve favoriler, ortada arama kutusu ve görsel arama hassasiyeti, alt kısımda **Kaynak Klasörler** ve facet filtreleri (kategori, proje fazı, malzeme, vb.)
- **Orta Alan:** Dosya listesi (Explorer, Dashboard veya Teknik görünüm)
- **Sağ Panel (Detay):** Seçilen dosyanın detay bilgileri

### Görünüm Modları

| Mod | Açıklama |
|-----|----------|
| Explorer (Kaşif) | Dosyaları kart formatında grid görünümde gösterir |
| Dashboard | İstatistikler ve analiz grafikleri |
| Teknik | Tablo formatında detaylı liste |

### Kaynak Klasörler Paneli

Sol panelde semantik arama bölümünün hemen altında **Kaynak Klasörler** bölümü yer alır. Burada:

- **Taradığınız her kök klasör otomatik olarak listelenir** (klasörün adıyla, yanında o klasördeki dosya sayısı)
- Bir klasöre tıklayarak **filtre olarak uygulayabilirsiniz** — sadece o klasörden gelen dosyalar görünür
- Birden fazla klasör seçilebilir (OR mantığı: A veya B veya C)
- "Filtreleri Temizle" ile tüm filtreleri kaldırabilirsiniz
- Klasör adının solundaki **▶ okuna** tıklayarak alt-klasör ağacını açabilirsiniz — iç içe klasör yapısı görünür, herhangi bir alt-klasöre tıklayarak sadece oradaki dosyaları filtreleyebilirsiniz
- Her klasörün yanındaki **3 nokta menüsünden** şu işlemler yapılabilir:
  - **Yeniden Adlandır** — klasörün gösterilen etiketini değiştirir
  - **Yeniden Tara** — sadece o klasörü yeniden tarar (diğer kaynaklara dokunmaz)
  - **Tarama Raporları** — önceki taramalarda atlanan veya hata veren dosyaların listesi
  - **Kaldır** — klasörü listeden çıkarır (dosyalar arşivde kalır)
  - **Dosyalarla Birlikte Sil** — klasör + altındaki tüm asset kayıtları silinir

> **Not:** Sayılar dosya silindikçe veya yeni tarama yapıldıkça canlı güncellenir. BAK (yedek) dosyaları sayıma dahil değildir, ana grid'de de gösterilmez.

---

## 3. Dosya Tarama ve İndeksleme

1. Sol paneldeki **"Klasör Tara & İndeksle"** butonuna tıklayın
2. Taramak istediğiniz klasörü seçin
3. Tarama modunu ayarlayın:
   - **Listeye Ekle (varsayılan):** Yeni dosyalar mevcut taramaya eklenir
   - **Sıfırdan Tara (Değiştir):** *Sadece seçilen klasörün altındaki* eski kayıtlar silinir, yeniden taranır. **Diğer kaynak klasörler dokunulmaz.**
   - **Renk çıkarma:** Görsellerin dominant renklerini analiz eder (opsiyonel)
4. **"Taramayı Başlat"** butonuna tıklayın

Tarama sırasında modal başlığı **"Dosya Tara & İndeksle"** olarak görünür.

- İlerleme çubuğu ve hız bilgisini takip edebilirsiniz
- **Duraklat/Devam** ile taramayı geçici olarak durdurabilirsiniz
- **İptal** ile taramayı tamamen sonlandırabilirsiniz

> **DWG dosyaları için:** ODA File Converter kuruluysa katmanlar, bloklar, metin içeriği ve xref'ler otomatik çıkarılır ve detay panelinde görünür. ODA arka planda görünmez şekilde çalışır.

> **Tek bir kaynak klasörü tazelemek için** sol paneldeki "Kaynak Klasörler" bölümünden ilgili klasörün 3 nokta menüsünü açıp **"Yeniden Tara"** seçin — modal otomatik açılır, sadece o klasör için scoped tarama çalışır.

### Veri Güvenliği (Checkpoint)

Tarama sırasında verileriniz periyodik olarak diske kaydedilir. Elektrik kesintisi veya çökme durumunda bile taranan dosyalar kaybolmaz. Checkpoint sıklığını **Ayarlar > Depolama** sekmesinden değiştirebilirsiniz (varsayılan: her 50 dosyada bir).

### Klasör Değişiklik Tespiti (Watch)

Ayarlar'dan **"Klasör değişikliklerini izle"** seçeneğini açarsanız, taranmış klasörlerde dosya eklendiğinde veya değiştiğinde uygulama sizi bilgilendirir. İsterseniz otomatik yeniden tarama da etkinleştirebilirsiniz.

### Çok Çekirdekli Tarama ve Donanım Kullanımı

ArchivistPro tarama işlemlerini paralel olarak birden fazla CPU çekirdeğinde yürütür. İlk kurulumda uygulama depolama türünüzü otomatik algılar ve uygun varsayılan çalışan sayısını seçer:

| Depolama Türü | Önerilen Çalışan Sayısı |
|---|---|
| HDD (mekanik disk) | 1 – 2 |
| SSD (SATA) | 3 – 4 |
| NVMe (≤ 8 mantıksal çekirdek) | 6 – 8 |
| NVMe (≥ 16 mantıksal çekirdek) | 10 – 16 |

Çalışan sayısını **Ayarlar > Depolama** sekmesinden değiştirebilirsiniz. HDD disklerde yüksek çalışan sayısı performansı artırmaz; aksine disk kafası çekişmesi nedeniyle yavaşlamaya yol açabilir.

> **AI özellikleri (semantik arama, RAG) için:** CPU yerine GPU'dan yararlanılır. Bu işlemler ayrı bir Ollama servisi üzerinden çalışır ve dosya taramasını yavaşlatmaz.

---

## 4. Arama

### Metin Araması
Arama kutusuna yazmaya başlayın. Sistem üç katmanlı arama yapar:
- **Kelime eşleşmesi:** Dosya adı, proje adı, metadata, müşteri adı, onay durumu
- **Semantik arama:** AI ile anlam bazlı eşleşme (en az 3 karakter gerektirir)
- **Türkçe terimler:** Mimari terimler otomatik genişletilir (ör. "mutfak" → "kitchen", "ankastre")
- **Fuzzy (bulanık) arama:** Yazım hatalarını tolere eder — "mutffak" veya "kesitt" yazarsanız yine doğru sonuçları bulur (4+ karakterli kelimelerde, max %30 hata payı)

> **İpucu:** Dosya kodlarını tire dahil arayabilirsiniz — "A1-c3" veya "A1-" gibi kısa kodlar doğrudan eşleşir.

### Boolean Arama (Gelişmiş)

Arama kutusunda mantıksal operatörler kullanabilirsiniz:

| Operatör | Örnek | Anlamı |
|----------|-------|--------|
| **AND** | `plan AND kesit` | Her ikisini de içeren dosyalar |
| **OR** | `mutfak OR banyo` | En az birini içeren dosyalar |
| **NOT** | `proje NOT eski` | "proje" içeren ama "eski" içermeyen |
| **"tırnak"** | `"kat planı"` | Tam bu ifadeyi içeren (kelimeler bitişik ve sıralı) |

> Operatörler **büyük harfle** yazılmalıdır (and değil AND). Karıştırılabilir: `"kat planı" AND cephe NOT taslak`

### Gelişmiş Arama Menüsü

Üst çubuktaki **"Gelişmiş Arama"** butonundan ek arama türlerine erişebilirsiniz:
- **Görsel Arama** — bir resim yükleyerek benzer görselleri bulun
- **Şekil Arama** — DWG/DXF dosyalarındaki geometrik şekillere göre arama
- **Benzerini Bul** — seçili dosyaya benzer dosyaları listeleyin
- **Kopya Bulucu** — tekrar eden dosyaları tespit edin

### Görsel Arama
Sol paneldeki resim yükleme butonuyla veya Gelişmiş Arama menüsünden bir görsel yükleyin. Benzer görseller otomatik bulunur.

### Sıralama

Sonuçları farklı kriterlere göre sıralayabilirsiniz:
- **Eşleşme skoru** (varsayılan) — arama sonuçları en alakalıdan en aza
- **Değiştirilme tarihi** — en yeni veya en eski önce
- **Dosya adı** — alfabetik sıralama
- **Dosya boyutu** — büyükten küçüğe veya tersine

### Filtreler
Sol paneldeki facet'leri kullanarak sonuçları daraltın:
- **Kategori:** 2D Çizim, 3D Model, Döküman, Render, Fotoğraf, Doku, Video
- **Proje Fazı:** Konsept, Avan, Ruhsat, Uygulama
- **Onay Durumu:** Taslak, İncelemede, Onaylandı, Reddedildi (Proje Durumu bölümünden atanır)
- **Malzeme Grubu:** Beton, Cam, Metal, Ahşap, Taş, Seramik, Kompozit
- **Renk Teması:** Sıcak Tonlar, Soğuk Tonlar, Monokrom, Toprak Tonları, Pastel
- **Mimari Stil:** Modern, Minimalist, Endüstriyel, Brütalist, Neoklasik, Organik

### Tarih Aralığı Filtresi

Sol panelde facet'lerin altında **tarih aralığı filtresi** bulunur. Başlangıç ve bitiş tarihi seçerek dosyaları değiştirilme tarihine göre daraltabilirsiniz. Örneğin yalnızca son 3 ayda değişen dosyaları görmek için kullanın.

### Filtre Preset'leri

Sık kullandığınız filtre kombinasyonlarını **preset** olarak kaydedebilirsiniz:
1. Filtreleri istediğiniz gibi ayarlayın (facet + etiket + tarih + arama terimi)
2. Filtre çubuğundaki **"Kaydet"** butonuna tıklayın
3. Preset'e bir isim verin
4. Daha sonra tek tıkla aynı filtreleri geri yükleyin

> Birden fazla seçenek işaretlenebilir (OR mantığı). Filtreler anlık uygulanır, yeniden tarama gerekmez.

---

## 5. Dosya Detayları

Bir dosyaya tıklayarak sağ panelde detaylarını görün:
- Önizleme (thumbnail veya doğal görüntü)
- Renk paleti (Hex, RGB, HSL, RAL kodu)
- Metadata (boyut, tarih, katmanlar, bloklar)
- AI etiketleri
- Kullanıcı etiketleri
- Proje durumu alanları
- Bağlantılı dosyalar

### 5.1 Proje Durumu

Detay panelinde dosyanın proje bilgilerini girebildiğiniz bir bölüm bulunur:

| Alan | Açıklama | Sınır |
|------|----------|-------|
| **Müşteri** | Dosyayla ilişkili müşteri veya firma adı | Max 150 karakter |
| **Onay Durumu** | 4 durum butonundan birini seçin | Taslak / İncelemede / Onaylandı / Reddedildi |
| **Versiyon** | Sürüm etiketi (ör. v1.0, Rev-A) | Max 20 karakter |
| **Teslim Tarihi** | Takvimden tarih seçin veya elle girin | ISO tarih formatı |

- Her alana tıklayarak düzenleme moduna geçin, Enter veya dışarı tıklayarak kaydedin
- Karakter sınırına yaklaştığınızda sayaç turuncu renge döner (müşteri: 140+, versiyon: 18+)
- Bu veriler **dosya yeniden taransa bile korunur** — tarayıcı bu alanlara dokunmaz
- Müşteri adı ve onay durumu **arama sonuçlarını etkiler** ve sidebar'da filtrelenebilir

#### Red Sebebi
Bir dosyanın onay durumunu **"Reddedildi"** olarak değiştirdiğinizde alt kısımda bir metin alanı açılır. Buraya red sebebini yazabilirsiniz (ör. "Ölçekler hatalı, revize edilmeli"). Dosya daha sonra onaylandığında red sebebi otomatik temizlenir.

#### Onay Geçmişi
Her onay durumu değişikliği kayıt altına alınır. Yönetici, Dashboard görünümünde **"Onay Geçmişi"** panelinden son işlemleri kronolojik olarak görebilir (kim, ne zaman, hangi durumdan hangi duruma, varsa sebebi).

### 5.2 Bağlantılı Dosyalar (Dosya İlişkileri)

Detay panelinde "Bağlantılı Dosyalar" bölümü, dosyanın diğer dosyalarla ilişkisini gösterir:

| Tür | Anlamı | Örnek |
|-----|--------|-------|
| **PDF Çıktısı** | Bu dosyanın PDF versiyonu | plan.dwg ↔ plan.pdf |
| **Render** | Bu tasarımın görselleştirmesi | salon.max ↔ salon_render.jpg |
| **Versiyon** | Aynı dosyanın farklı sürümü | plan_v1.dwg ↔ plan_v2.dwg |
| **Proje Grubu** | Aynı projeye ait dosyalar | Kule_A/*.* |

- **Otomatik tespit:** Aynı klasörde aynı isme sahip farklı uzantılı dosyalar (ör. plan.dwg + plan.pdf) tarama sonrasında otomatik bağlanır
- **Otomatik versiyon kümeleme:** Tarama sırasında benzer isimlere sahip dosyalar (ör. `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg`, `plan_FINAL.dwg`) otomatik olarak "Versiyon" ilişkisiyle bağlanır. Tanınan kalıplar: `_v1`, `_Rev-A`, `_R01`, `_FINAL`, `_DRAFT`, `_eski`, `_yeni`, `(Kopya)`, sondaki sayılar
- **Manuel bağlantı:** "Bağlantı Ekle" butonuyla herhangi iki dosya arasında ilişki kurabilirsiniz
- **Gezinme:** Bağlantılı dosyanın adına tıklayarak o dosyanın detayına geçebilirsiniz
- Otomatik tespit edilen bağlantılarda `[Otomatik]` etiketi görünür

### 5.3 Format Özel Bilgileri

#### 3ds MAX (.max) Dosyaları
- **Katmanlar** — dosyanın katman yapısı renkli etiketler olarak gösterilir
- **Objeler** — dosyadaki nesne isimleri listelenir (30'dan fazlaysa "+N daha" notu eklenir)
- **FBX / OBJ Export** — detay panelinde iki dönüştürme butonu görünür:
  - **Hızlı Mod:** 3ds Max gerekmez, temel geometri dönüşümü
  - **Gerçek Mod:** Bilgisayarınızda 3ds Max kuruluysa native kalitede dönüştürme (otomatik algılanır)

#### Revit (.rvt) Dosyaları
- Thumbnail önizleme 3ds Max olmadan otomatik çıkarılır (dosyaya gömülü OLE stream'den)
- Proje adı, Revit sürümü, kat adları gösterilir

#### DWG Dosyaları (ODA ile)
- Katmanlar, bloklar, metin içeriği, xref'ler
- Çizim tipi (kat planı, kesit, cephe vb. — AI ile)
- Ölçek ve birim tahmini
- **Şekil verileri** — dosyadaki geometrik şekiller (dikdörtgen, daire, polyline vb.) çıkarılır ve şekil aramasında kullanılır
- **Yapısal benzerlik** — bir DWG'ye sağ tıklayıp "Benzerini Bul" seçtiğinizde, katman/blok/metin/şekil yapısını kıyaslayarak en benzer DWG dosyalarını sıralar (CLIP görsel karşılaştırması yerine yapısal composite skor kullanılır — CAD dosyaları için daha güvenilir)
- **Gömülü OLE objeleri** — DWG içine gömülü Excel, Word veya PDF dosyaları tespit edilir ve detay panelinde gösterilir

---

## 6. Etiketler

Dosyalarınıza kendi etiketlerinizi ekleyebilirsiniz:
1. Dosya detay panelinde etiket bölümüne gidin
2. Yeni etiket oluşturun veya mevcut etiketten seçin
3. Etiketlere renk atayabilirsiniz
4. Toplu etiketleme: Birden fazla dosya seçip aynı anda etiket atayın

---

## 7. Favoriler ve Koleksiyonlar

- **Favoriler:** Sık kullandığınız dosyaları hızlı erişim için işaretleyin (detay panelindeki yıldız ikonu)
- **Koleksiyonlar:** Dosyaları tematik gruplar halinde düzenleyin (ör. "Cephe Projeleri", "Render Arşivi")
  - Koleksiyonlara renk atayabilirsiniz
  - Bir dosya birden fazla koleksiyonda olabilir

---

## 8. Klavye Kısayolları

| Kısayol | İşlem |
|---------|-------|
| Ctrl+Z | Geri Al |
| Ctrl+Y | Yinele |
| Ctrl+K veya Ctrl+F | Arama |
| Ctrl+A | Tümünü Seç |
| Delete | Seçili Dosyayı Sil (onay diyaloğu gösterilir) |
| Escape | İptal / Kapat |
| F1 | Yardım |
| Sağ Tık | Bağlam menüsü (asset kart üzerinde) |

---

## 9. AI Özellikleri

### AI Durum Göstergesi

TopBar'ın sağında bir **beyin ikonu** ve yanında renkli bir nokta bulunur:

| Nokta Rengi | Anlamı |
|-------------|--------|
| Yeşil | AI hazır — model yüklü ve çalışıyor |
| Sarı | Eksik model — AI kurulumu tamamlanmamış |
| Kırmızı | Ollama kapalı veya bağlantı yok |

Beyin ikonunun üzerine gelince **"AI Kurulum Sihirbazını Aç"** bağlantısı çıkar. Simgeye tıklayarak AI Ayarları modalını açabilirsiniz.

---

### AI Kurulum Sihirbazı

AI özelliklerini ilk kez kurmak veya sorun gidermek için şu adımları izleyin:

1. TopBar'daki **beyin ikonu** → AI Ayarları → **"AI Kurulum Sihirbazı"** butonuna tıklayın
   *veya* beyin ikonunun üzerine gelin → **"AI Kurulum Sihirbazını Aç"** bağlantısına tıklayın

2. Sihirbaz **3 adımda** kurulumu tamamlar:
   - **1. Ollama Kontrol** — Ollama'nın kurulu ve çalışır durumda olup olmadığı kontrol edilir. Kurulu değilse "Başlat" butonuyla doğrudan uygulamadan başlatabilir ya da [ollama.com](https://ollama.com) adresinden indirebilirsiniz.
   - **2. Model İndir** — Gerekli AI modeli (metin ve/veya görsel) indirilir. İndirme ilerleme çubuğuyla takip edilebilir.
   - **3. Tamamlandı** — Sistem hazır. AI Sohbet ve otomatik sınıflandırma özellikleri aktif hale gelir.

---

### Ollama Başlat / Durdur

AI Ayarları panelinden Ollama servisini manuel olarak yönetebilirsiniz:

- **Ollama kapalıysa** → yeşil **"Başlat"** butonu görünür (güç ikonu). Tıkladığınızda `ollama serve` arka planda başlar.
- **Ollama açıksa** → kırmızı **"Durdur"** butonu görünür. Tıkladığınızda servis durdurulur.
- Durum değişimi sırasında buton "Başlatılıyor..." / "Durduruluyor..." olarak gösterilir.

> **Not:** Ollama kapalıyken Gelişmiş Model Ayarları bölümü gizlenir — bu normaldir.

---

### AI Sohbet (RAG)

TopBar'daki **"💬 AI"** butonuna tıklayarak AI Sohbet panelini açın. Arşivinize doğal dilde soru sorabilirsiniz.

**Temel özellikler:**

- **Kaynaklı yanıtlar (Citation):** AI'ın verdiği her yanıtta hangi dosyalardan yararlandığı gösterilir. Kaynak dosya adına tıklayarak doğrudan o dosyanın detayına gidebilirsiniz.
- **Scope filtresi:** Sohbet penceresinin üstünden arama kapsamını daraltın — belirli bir proje, etiket veya tüm arşiv arasında seçim yapın.
- **Streaming yanıtlar:** AI cevabı oluşturulurken canlı olarak ekrana yansır, uzun yanıtlar için beklemenize gerek yoktur.

**Örnek sorular:**
- "Ahşap cephe detayı olan render var mı?"
- "2024 yılında onaylanan tüm kat planlarını listele"
- "Müşteri adı 'Kaya' olan projelerdeki PDF'leri bul"

---

### Slash Komutları

Sohbet kutusuna `/` ile başlayan özel komutlar yazarak farklı arama modlarını etkinleştirin:

| Komut | Kısaltma | İşlev |
|-------|----------|-------|
| `/görsel <metin>` | `/g <metin>` | CLIP modeli ile metin → görsel semantik arama. Örn: `/g modern ahşap cephe` |

> **İpucu:** `/görsel` komutu standart metin aramasından farklı olarak görselin içeriğini yorumlar — dosya adından bağımsız olarak görsel benzerliğe göre sonuç döner.

---

### Sentez Modu

Birden fazla belgeyi karşılaştırmalı analiz ettirmek için sentez modunu kullanın:

1. Sohbet penceresinde **📎 (ataç) butonuna** tıklayın
2. Analiz etmek istediğiniz dosyaları seçin (birden fazla seçilebilir)
3. Sorunuzu yazın — ör. "Bu iki planı karşılaştır ve farklılıkları listele"

AI, seçili belgelerin içeriğini birlikte değerlendirerek sentezlenmiş bir yanıt üretir.

---

### Sohbet Dışa Aktarma

Sohbet geçmişini saklamak veya paylaşmak için dışa aktarın:

- Sohbet penceresinin başlık çubuğundaki **indirme (⬇) butonuna** tıklayın
- Tüm sohbet **Markdown (.md) formatında** bilgisayarınıza kaydedilir
- Kaynak dosya referansları ve yanıtlar formatlanmış olarak dışa aktarılır

---

### AI Etiket Önerisi

Detay panelinde bir dosya açıkken **✨ (yıldız) butonuna** tıklayın. AI, dosyanın içeriğini analiz ederek uygun etiket önerileri sunar. Beğendiğiniz önerileri tek tıkla ekleyebilirsiniz.

---

### Otomatik Sınıflandırma

Tarama sırasında AI modeli dosyalarınızı otomatik olarak:
- Kategorize eder (Render / Fotoğraf)
- Malzeme tespiti yapar
- Mimari stil belirler

### Vision AI (Opsiyonel)
Ayarlar > AI Ayarları'ndan bir vision sağlayıcı seçerek:
- Çizim tipi tespiti (kat planı, kesit, cephe)
- Malzeme ve eleman analizi
- OCR (metin tanıma)

---

### AI Hassasiyet Filtresi (Yönetici)

Arşivinizdeki bazı dosyalar hassas bilgiler içerebilir (maaş tabloları, sözleşmeler, kişisel veriler). Bu dosyaların AI sohbette sonuç olarak çıkmasını istemiyorsanız **AI Hassasiyet Filtresi**'ni kullanabilirsiniz.

**Neden gerekli?** AI sohbet tüm taranan dosyalarda arama yapar. Bir kullanıcı "maaş tablosu var mı?" diye sorduğunda, arşivde böyle bir dosya varsa AI onu bulup gösterir. Filtre bu tür dosyaları AI'dan gizler.

**3 yöntemle koruma:**

1. **Hazır kategoriler** — Ayarlar > Güvenlik > AI Hassasiyet Filtresi'nden açın:
   - **Finansal**: maaş, fatura, teklif, bütçe, hakediş...
   - **Kişisel Bilgi**: TC kimlik, telefon, adres...
   - **Hukuki**: sözleşme, NDA, vekaletname...
   - **İnsan Kaynakları**: özlük, izin, sicil, performans...

2. **Özel kelimeler** — Kendi kelimelerinizi ekleyin (ör. hassas müşteri adı, proje kodu)

3. **Dosya/klasör bazlı** — Dosyaya sağ tık → "AI'dan Gizle" veya kaynak klasör menüsünden "AI'dan Hariç Tut"

> **Not:** Gizlenen dosyalar arşivde görünmeye devam eder — arama, filtreleme ve detay paneli normal çalışır. Sadece AI sohbet bu dosyalara erişemez.

---

## 9.1 Sağ Tık Menüsü

Dosya kartlarına ve boş alanlara sağ tıklayarak hızlı işlemler yapabilirsiniz.

### Asset Kartına Sağ Tık

Bir dosya kartının üzerine sağ tıklayınca şu seçenekler çıkar:

| Seçenek | İşlev |
|---------|-------|
| **İndir** | Dosyayı bilgisayarınıza indirir |
| **Aç** | Dosyayı varsayılan programla açar |
| **Sil** | Dosyayı arşivden siler (onay diyaloğu gösterilir) |
| **Yeniden Tara** | Yalnızca bu dosyayı yeniden indeksler |
| **Etiketle** | Dosyaya etiket ekler veya kaldırır |
| **Favorilere Ekle** | Dosyayı favoriler listesine ekler |
| **AI'dan Gizle** | Bu dosyayı AI sohbetten hariç tutar (yönetici) |

### Boş Alana Sağ Tık

Grid'in boş bir alanına sağ tıklayınca şu seçenekler çıkar:

| Seçenek | İşlev |
|---------|-------|
| **Klasör Tara** | Yeni bir klasör seçerek tarama başlatır |
| **Yeni Etiket Oluştur** | Arşiv için yeni bir etiket tanımlar |

---

## 9.2 Geri Al / Yinele

Yanlışlıkla yaptığınız işlemleri geri alabilirsiniz.

| Kısayol | İşlev |
|---------|-------|
| **Ctrl+Z** | Son işlemi geri alır |
| **Ctrl+Y** | Geri alınan işlemi yeniden uygular |

**Geri alınabilen işlemler:**
- Dosya silme
- Klasör silme
- Sohbet silme
- Grup silme

> **Çöp Kutusu:** Silinen klasörler ve dosyalar **30 gün** boyunca Çöp Kutusu'nda saklanır. Bu süre içinde geri yükleyebilirsiniz. 30 gün sonunda kalıcı olarak silinir.

---

## 9.3 XMP Metadata Export

Dosyalarınızın metadata bilgilerini standart XMP sidecar formatında dışa aktarabilirsiniz:

1. Dosyaya sağ tıklayın → **"XMP Dışa Aktar"** seçin
2. Dosyanın yanına `.xmp` uzantılı bir sidecar dosyası oluşturulur (ör. `plan.dwg` → `plan.xmp`)
3. Dosyanın yanına yazılamazsa (yetkisiz konum vb.) otomatik olarak uygulama veri klasörüne kaydedilir

XMP dosyası şu bilgileri içerir: dosya adı, proje adı, kategori, etiketler, onay durumu, müşteri adı, versiyon etiketi ve varsa red sebebi.

> **Ne işe yarar?** Adobe Bridge, Lightroom gibi araçlar XMP dosyalarını okuyabilir. Başka bir DAM yazılımına geçiş yaparsanız metadata'nız taşınabilir.

---

## 9.4 Sağlık Kontrolü (Fixity Check)

Arşivinizdeki dosyaların bütünlüğünü kontrol etmek için sağlık taraması yapabilirsiniz:

1. Ayarlar'dan **"Sağlık Kontrolü"** bölümüne gidin
2. **"Taramayı Başlat"** butonuna tıklayın
3. Sistem, dosyaların örneklem bazlı checksum kontrolünü yapar
4. Değişmiş veya bozulmuş dosyalar varsa rapor edilir

Bu özellik özellikle büyük arşivlerde **bit-rot** (sessiz veri bozulması) tespiti için faydalıdır.

---

## 9.5 Çoklu Arşiv

ArchivistPro birden fazla arşivi paralel yönetebilir. Sol panelin en üstündeki "Arşiv" bölümünden arşivler arasında geçiş yapabilirsiniz.

### Sabit Arşivler
- **Ana Arşiv (shared)** — yöneticinin yönettiği ortak arşiv
- **Yerel Arşiv (personal)** — sadece sizin erişiminize açık kişisel arşiv

### Özel Arşivler
Yöneticinin oluşturduğu ek arşivleri (örnek: "Ofis Merkez", "Proje Kule") aynı sekme satırında görebilirsiniz. Her arşivin kendi:

- Kaynak klasör listesi
- Asset koleksiyonu
- Etiket ve favori havuzu
- Tarama ayarları

ayrı tutulur. Arşivler arası geçiş yaptığınızda sol paneldeki Kaynak Klasörler ve sayılar otomatik olarak yeni arşive göre güncellenir.

### Birleştirme ve Çıkarma (Yönetici)
Yönetici iki arşivi birleştirebilir (Join/Merge) veya bir arşivden filtreli alt küme çıkarabilir (Extract). Bu işlemlerden önce otomatik snapshot alınır, gerektiğinde geri alınabilir.

---

## 10. LAN'dan Arşiv İndirme

Yöneticinin paylaştığı arşivi LAN üzerinden indirebilirsiniz.

### Bağlanma
1. Ayarlar > Ağ sekmesine gidin
2. Yöneticiden aldığınız bilgileri girin:
   - **IP Adresi** (ör. `192.168.1.106`)
   - **Bağlantı Kodu** (8 haneli kod)
3. "Bağlan" butonuna tıklayın

### İndirme
Bağlantı başarılıysa:
- Sunucu versiyonu ve veritabanı boyutu gösterilir
- "Arşivi İndir" butonuna tıklayın
- İndirme tamamlanınca arşiv otomatik yüklenir
- Sayfayı yenilemenize gerek yoktur

### Arşiv Import (Dosyadan)
LAN bağlantısı olmadan da arşiv alabilirsiniz:
1. Ayarlar > Ağ > "Import (.archivistpro)" butonuna tıklayın
2. Yöneticinin size verdiği `.archivistpro` dosyasını seçin
3. Manifest önizlemesini kontrol edin
4. Onaylayın — arşiv yüklenir

> **Not:** Hem LAN indirme hem dosya import işlemi mevcut arşivinizi günceller. Oturumunuz korunur, tekrar giriş yapmanıza gerek yoktur.

---

## 11. Güvenlik ve Gizlilik

- Tüm AI işlemleri **yerel bilgisayarınızda** çalışır (varsayılan)
- Dosyalarınız hiçbir sunucuya gönderilmez
- Cloud AI (Gemini, OpenAI) **sadece siz etkinleştirirseniz** kullanılır
- API anahtarları oturum bazlı tutulur, diske kaydedilmez
- Tehlikeli işlemler (silme, toplu taşıma) onay diyaloğu gerektirir

### Şifremi Unuttum

Parolanızı unutursanız giriş ekranındaki **"Şifremi Unuttum"** bağlantısını kullanın. Yöneticinizden `recovery.key` dosyasını (veya içeriğini) almanız gerekir. Bu anahtar ile yeni parola belirleyebilirsiniz.

---

## 12. Kopya & Benzer Dosya Bulucu

Bu araç arşivdeki tekrar eden veya birbirine benzeyen dosyaları gösterir.

> **Viewer olarak:** Tarama yapabilir ve sonuçları görebilirsiniz. Dosya **silme işlemi yalnızca yöneticiye açıktır** — silme butonları görünmez.

### Panele Erişim

Üst bardaki **⎇** ikonuna tıklayın (çöp kutusu ile beyin ikonları arasında). Üzerine gelince "Kopya Bul" yazar.

### Kapsam Seçimi

Panel açılınca taramak istediğiniz arşivi sekmelerden seçin (Ana Arşiv, Yerel Arşiv ve eklediğiniz tüm özel arşivler listelenir).

> Yerel arşiv henüz yüklenmemişse sekme pasif görünür. Sidebar'dan yerel arşive geçip geri dönün.

> **Büyük arşivlerde** (2000+ dosya) tarama başlatmadan önce uyarı gösterilir — seçili modlara göre tarama süresi uzayabilir. Tarama sırasında **İptal** butonuyla işlemi anında durdurabilirsiniz.

### Tespit Modları

| Mod | Ne Bulur? |
|-----|-----------|
| **Birebir Kopya** | Aynı içerikli dosyalar (SHA-256 hash eşleşmesi — farklı isim/klasör olabilir) |
| **Aynı İsim** | Farklı klasörde aynı adlı dosyalar (Genel Kriterler ile daraltılabilir — örn. aynı isim + aynı boyut) |
| **Görsel Benzerlik** | Görsel olarak benzer fotoğraf/render/görsel dosyalar (pHash) |
| **Yapısal Benzerlik** | Benzer katman, malzeme veya içerik yapısına sahip CAD/3D/döküman dosyaları (Jaccard + composite skor) |

### Benzerlik Eşiği

Kaydırıcı ile **Görsel** ve **Yapısal** benzerlik için hassasiyeti ayarlayın:

- **Düşük %** → Daha fazla, gevşek eşleşme (yanlış pozitif olabilir)
- **Yüksek %** → Daha az, yalnızca çok benzer sonuçlar

### Gelişmiş Kriterler Paneli

"Gelişmiş Kriterler" butonuna tıklayınca açılan panel **4 bölümden** oluşur:

#### 1. Genel Kriterler (cross-format ön-filtre)
Aynı İsim ve Yapısal Benzerlik modlarına ek koşullar ekler:

- **Aynı dosya boyutu** — toleransla: tam eşleşme, ±1 KB veya ±%1
- **Değişiklik tarihi yakın** — N gün penceresi (1–365)
- **Aynı klasör adı** — parent klasör adı eşleşmesi (case-insensitive)

> Örnek: "Aynı isim + aynı boyut" çok güçlü bir kopya sinyalidir — false positive'leri ciddi azaltır.

#### 2. Format-Spesifik Kriterler
Yapısal benzerlikte hangi metadata alanlarının karşılaştırılacağını seçer. Format başına gruplanmıştır:

- **DWG / DXF**: Katmanlar · Bloklar · Metin içeriği · Xref'ler
- **IFC**: Kat sayısı · Entity sayısı
- **3DS MAX**: Malzeme listesi · Render motoru · Max sürümü
- **SketchUp**: Bileşenler · Katmanlar · SketchUp sürümü
- **Revit**: Kat adları · Proje adı
- **PDF / Office**: Başlık · Yazar · Sayfa sayısı

#### 3. Performans Filtreleri
Tarama havuzunu daraltır, hızı artırır:

- **Minimum dosya boyutu (KB)** — bu boyutun altındaki dosyalar taramaya hiç dahil edilmez

#### 4. Format Görünürlük Filtresi
Tarama sonuçlarında hangi dosya kategorilerinin görüneceğini canlı olarak ayarlar (yeniden tarama gerektirmez):

CAD · BIM/3D · Döküman · Görsel · Video · Yedek

> Genel Kriterler veya Performans değiştirildiğinde panelin altında "Yeniden tarayın" uyarısı görünür.

### Sonuçları Görme

**Liste görünümü:**

```
▼ GÖRSEL BENZER — 1 grup
  ┌─────────────────────────────────────────────────┐
  │ render_v1.jpg   pHash farkı: 5/64 bit → %92    │
  │  /Render/render_v1.jpg   2.4 MB   2024-03-01   │
  │  /Render/render_v2.jpg   2.4 MB   2024-03-15   │
  └─────────────────────────────────────────────────┘
```

Gruba tıklayarak açın/kapatın. Her dosyanın yolu, boyutu ve tarihi görünür.

### Karşılaştırma Görünümü

İki dosyayı yan yana incelemek için `[⎇]` ikonuna tıklayın, ardından üstteki **[Karşılaştır]** butonuna geçin:

```
┌───────────────────┬───────────────────┐
│   render_v1.jpg   │   render_v2.jpg   │
│  [ önizleme ]     │  [ önizleme ]     │
│  2.4 MB           │  2.4 MB           │
│  2024-03-01       │  2024-03-15       │
├───────────────────┴───────────────────┤
│  Benzerlik: %92 · pHash Δ: 5/64 bit  │
└───────────────────────────────────────┘
```

Silme yapmak istiyorsanız yöneticinizden destek isteyin.

---

## 13. Uygulama Kapatma Onayı

Pencereyi **X butonu** veya **Alt+F4** ile kapatmaya çalıştığınızda uygulama bir onay diyaloğu gösterir.

- **"Çık"** — uygulamayı kapatır
- **"İptal"** — uygulamada kalırsınız

Bu koruma tarama veya indirme işleminin ortasında yanlışlıkla kapanmayı önler.

---

*Bu kılavuz program geliştikçe güncellenmektedir. Son güncelleme: 2026-05-05 (v2.4.4)*

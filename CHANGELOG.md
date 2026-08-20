# Changelog

Tüm önemli değişiklikler bu dosyada belgelenir — **sürüm geçmişinin tek
kaynağı budur.** Format [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/)
tabanlıdır; sürüm numaralandırması [Semantic Versioning](https://semver.org/)
kurallarına göre ilerler.

## [3.7.0] — 2026-08-20 — Renkler Aranabilir, Sağ Tık Uygulamaya Ait

Görsellerin renkleri artık okunabilir, kopyalanabilir ve **aranabilir**; sağ tık
her ekranda uygulamanın kendi menüsünü açıyor; AI görsel analizi sürerken yapılan
toplu işlemler analizi artık durdurmuyor. Veri biçimi değişmedi; yeni veritabanı
güncellemesi yoktur.

### Eklenen (Added)
- **Renk kartelası artık işlevsel (dosya detayı).** Çubuktaki bir renge tıklayınca
  o rengin **HEX · RGB · HSL** değerleri ve **en yakın RAL Classic** karşılığı
  görünür; her değere tıklayınca panoya kopyalanır. RAL eşleşmesi daima "≈" ile ve
  algısal fark (ΔE) ile sunulur — uzak eşleşmede açıkça uyarılır. RAL fiziksel bir
  boya standardı, elinizdeki renk ise fotoğraftan/render'dan gelen bir ekran rengi
  olduğu için boya kararını fiziksel kartelayla vermelisiniz.
- **"Bu renge yakın görselleri bul".** Arşivin tamamında renk yakınlığına göre
  arama; sonuçlar en yakından uzağa sıralanır ve **aktif filtreleriniz korunur**
  (klasör, proje, etiket…). Model gerektirmez, tamamen çevrimdışı çalışır.
- **Renk verisi geri doldurma** (Ayarlar → AI, yönetici). Baskın renk çıkarımı
  arşiv kurulduktan sonra eklendiği için daha önce indekslenen görsellerde renk
  verisi yoktu; bu dosyalar kartelada boş görünüyor ve renk aramasında
  bulunamıyordu. Geri doldurma **kaynak dosyalara dokunmaz** (renk, kayıtlı
  önizlemeden hesaplanır) — yeniden tarama gerekmez, kaynağı başka makinede olan
  dosyalar da kapsanır. İlerleme hem düğmede hem üst şeritte görünür.
- **Pano · Teknik · Harita · Sohbet görünümlerine sağ tık menüsü.** Bu ekranlarda
  sağ tık tarayıcının menüsünü ("Yeniden yükle", "Kaynağı görüntüle") açıyordu.
  Artık her görünüm kendi menüsünü açar: kopyala, görünüm değiştir ve o ekrana
  özel eylemler (Pano'da yenile/kapsam temizle, Haritada görünümü sıfırla,
  Sohbette yeni sohbet/dışa aktar). Uygulama çerçevesinde de (sol şerit, üst
  çubuk, kenar çubuğu) tarayıcı menüsü artık çıkmaz. **Yazı alanlarında** ise
  varsayılan menü korunur — kes/kopyala/yapıştır kaybolmasın.

### Düzeltilen (Fixed)
- **AI görsel analizi sürerken yapılan toplu işlemler analizi artık durdurmuyor.**
  "Yeniden indeksle", "Taşı" ve "Kural ile düzenle" işlemleri, tüm iş boyunca
  veritabanı yazma kilidini tutuyordu; bu sırada koşan analiz ilk kilit isteğinde
  donuyor ve "İptal" düğmesi cevapsız kalıyordu (büyük çizim dosyalarında
  dakikalarca). Bu üç işlem artık kilidi dosya başına alıp bırakıyor.
- **Analiz sürerken riskli eylemler kilitleniyor.** Analiz edilmekte olan bir
  dosyanın yolunu ya da önizlemesini değiştiren işlemler (yeniden indeksle, taşı,
  kural ile düzenle, klasör tarama) koşu boyunca pasifleşir ve sebebini söyler;
  koşuyu durdurup devam edebilirsiniz. Sessiz kalite kaybı önlenir.
- **"AI ile analiz et" düğmesi artık gerçeği söylüyor.** Başka bir yerden
  başlatılmış bir analiz varken düğme aktif görünüyor, basınca teknik bir hata
  metni çıkıyordu. Artık koşan analizin ilerlemesini gösterir ve durdurma sunar.
- **Analiz ilerlemesi %100'e ulaşıyor.** Koşu sırasında seçimden dosya çöpe
  atılınca çubuk eski toplamda kalıyor, iş bittiği hâlde yarım görünüyordu.
- **Benzerlik/renk sonuçlarında sıralama seçicisi yanıltmıyor.** Bu sonuçların
  sırasını arama belirler (en iyi eşleşme önce); üstteki sıralama seçicisi hiçbir
  şey yapmadığı hâlde açık duruyordu. Artık yerini "En iyi eşleşme önce" bilgisine
  bırakır.
- Haritadaki "Tümünü Gezgin'de aç" düğmesinin metni koda gömülüydü; artık diğer
  diller gibi çevriliyor ve ürünün geri kalanıyla aynı terimi kullanıyor.

## [3.6.1] — 2026-08-18 — Görsel Analizi Yarıda Kesilince Dosya Suçlanmıyor

Görsel analizinin bir kısım dosyada sessizce başarısız olmasını ve o dosyaların
haksız yere "denendi, sonuç alınamadı" diye işaretlenmesini düzelten sürüm.
Veri biçimi değişmedi; yeni veritabanı güncellemesi yoktur.

### Düzeltilen (Fixed)
- **Model yanıtı yarıda kesilince analiz artık "başarısız dosya" sayılmıyor.**
  AI görsel analizinde model bazen yanıtı tamamlayamadan düşüyor; geriye anlamsız
  bir metin (`@@@@…`) kalıyordu. Uygulama bunu **modelin tam cevabı** sanıyor,
  içinde beklediği alanları bulamayınca da dosyayı kalıcı olarak *"denendi, sonuç
  alınamadı"* diye işaretliyordu. Yani bağlantı düzeyindeki geçici bir kesinti,
  dosyanın ya da modelin suçu gibi raporlanıyordu. Artık bu durum ayrı bir geçici
  hata olarak tanınıyor ve dosya işaretlenmiyor.
- **Aynı görsel otomatik olarak daha küçük boyutta yeniden deneniyor.** Kesinti
  ölçülebilir biçimde görselin gönderim boyutuna bağlı: aynı fotoğraf büyük
  boyutta her seferinde düşerken küçültülmüş hâlinde sorunsuz analiz ediliyor.
  Kesinti olursa görsel bir kez daha, küçültülmüş olarak gönderilir.
- Analiz sırasındaki hata açıklaması artık *"model bu görseli betimlemeyi
  reddetmiş olabilir"* demiyor; kesintiyi olduğu gibi bildiriyor.

### Eklenen (Added)
- **"İşaretleri temizle"** (Pano → Görsel Analizi, yönetici). Önceki sürümlerde
  geçici kesinti yüzünden *"denendi, sonuç alınamadı"* işareti almış dosyaların
  işaretini kaldırır. Analiz çıktılarına, etiketlere ve dosyalarınıza dokunmaz;
  bu dosyalar zaten yeniden analiz edilebilir durumdaydı, işaret yalnızca listeyi
  şişiriyordu.

## [3.6.0] — 2026-08-18 — Metnin Tamamı Aramaya Girsin

Belge içeriğinin yalnızca bir kısmının aramaya girdiği bir kusurun düzeltildiği
sürüm. Aramanın "çalışmadığı" izlenimini veren şey buydu: metin var, indekste
yok. Veri biçimi değişmedi ve **mevcut arşivler olduğu gibi açılır**; küçük bir
şema eklemesi (parçaların hangi kuralla üretildiği) otomatik uygulanır.

### Düzeltilen (Fixed)
- **Belge metninin tamamı artık aramaya giriyor.** Metin, aramaya hazırlanırken
  parçalara bölünür. Bu bölme **kelime sayısına** göre yapılıyordu, ama parçanın
  modele sığıp sığmadığı **token** denen daha küçük birimlerle ölçülür — ve
  Türkçede bir kelime ortalama 3'ten fazla token eder (ölçüldü: 3,29; bazı
  belgelerde 13'e kadar). Sonuç: her parçanın yalnızca baş tarafı indeksleniyor,
  gerisi **hiçbir aramaya girmiyordu**. Gerçek arşiv metniyle ölçülen kayıp
  **%74**'tü. Bölme artık doğrudan token bütçesiyle yapılıyor; ölçüm
  **%100 kapsama** gösteriyor.
- **Uzun çizim özetleri kesilmiyor.** Dosya adı, proje, etiket ve çizim
  bilgilerinden (katman/blok listeleri gibi) üretilen özet tek parçaya
  sığmadığında sessizce kesiliyordu; artık gerektiği kadar parçaya bölünüyor.
  Ölçüm: özetlerin %1,3'ü sınırı aşıyordu, en uzunu sınırın 14 katıydı.

### Eklenen (Added)
- **"Parçaları yeniden kur"** (Pano → RAG İndeksi, yönetici). Bölme kuralları
  değiştiğinde mevcut parçaları güncel kurallarla yeniden üretir. Semantik ve
  görsel arama indekslerine **dokunmaz** — daha önceki tek seçenek olan tam
  sıfırlama onları da siliyordu ve saatler süren gereksiz bir işe yol açıyordu.
- **Eski kuralla üretilmiş parçalar için uyarı.** Önceki sürümden yükselen bir
  arşivde parçalar eski kurallarla üretilmiştir; Pano bunu artık açıkça söyler
  ve indeksleme onları kendiliğinden yeniler. (Eskiden kart "tümü indekslendi"
  der, düzeltmenin arşive ulaşmadığı görülmezdi.)

### Değişen (Changed)
- RAG indeks durumu "indekslendi" sayarken artık **güncel kuralla** üretilmiş
  parçaları sayar. Bu yüzden bu sürüme geçince bekleyen sayısı bir kerelik
  yükselir; indeksleme tamamlanınca normale döner. Bekleyen parçalar yenisi
  yazılana kadar **aranabilir kalır** — arama hiçbir an geriye gitmez.



Ekrandaki her sayının, tıklanınca gelen listeyle **aynı şeyi** söylemesine
odaklanan sürüm. Üç yerde sayı ile gerçek ayrışıyordu: "analiz edilmemiş"
sayacı, önizlemesi hiç üretilmeyen iki dosya biçimi ve hiç çalışmadığı hâlde
"başarılı" diye kapanan bir AI taraması. Veri biçimi değişmedi; mevcut
arşivler olduğu gibi açılır.

### Eklenen (Added)
- **WebP ve ICO dosyalarının önizlemesi artık üretiliyor.** Bu iki biçim hiçbir
  çıkarıcı tarafından sahiplenilmiyordu; dosyalar sessizce önizlemesiz kalıyor
  ve — görsel analizi önizleme üzerinden çalıştığı için — AI taramasına da hiç
  girmiyordu. Hiçbir uyarı da çıkmıyordu.
- *AI görsel analiz durumu* satırlarında, hangi kümeyi saydıklarını açıklayan
  ipuçları (fare ile üzerine gelince).

### Düzeltilen (Fixed)
- **"Analiz edilmemiş" artık gerçekten hiç analize girmemişleri sayıyor.** Bu
  satır iki şeyi yanlış kapsıyordu: (1) denenip sonuç alınamayan görseller de
  içindeydi, (2) sayı tüm arşivden hesaplandığı için küçük resmi olmayan — yani
  görsel analize hiç giremeyecek — çizim ve belge dosyalarını da içeriyordu.
  Artık dört satırın üçü birbirini dışlayan bir bölme oluşturur ve her satırın
  **sayısı, tıklanınca gelen listeyle birebir aynıdır**.
- **Seçilen dosyalar analiz edilemediğinde koşu artık "başarılı" demiyor.**
  Önizlemesi olmayan dosyalar analiz kuyruğuna hiç giremez; eskiden bu durum
  *"0 görsel analiz edildi, 0 başarısız"* diye başarı tonunda kapanıyor,
  kartlarda hiçbir şey değişmiyordu. Artık kaç dosyanın neden atlandığı ve ne
  yapılacağı (dosyaları seçip **Yeniden indeksle**) söyleniyor.

### Değişen (Changed)
- *"Analiz edilmemiş"* filtresiyle başlatılan kapsamlı bir analiz koşusu, daha
  önce denenip elenmiş görselleri atlar; onlar kendi satırından seçilip daha
  yetenekli bir modelle yeniden denenir. Bu, iki satırın birbirini dışlamasının
  doğal sonucudur.

> ℹ️ **Mevcut arşivler için:** videoların ve webp/ico dosyalarının önizlemesi
> **geriye dönük oluşturulmaz.** İlgili dosyaları seçip **Yeniden indeksle**
> deyin — önizleme üretilir, ardından AI görsel analizi de çalışır ve kartta ✨
> işareti belirir. Yeniden indeksleme etiketleri, favorileri, koleksiyonları ve
> mevcut AI verilerini korur; dosyalarınıza dokunmaz.

## [3.4.0] — 2026-08-15 — Görsel Analizinde Şeffaflık

AI görsel analizi bir görseli betimleyemediğinde ne olduğunu **görünür** kılan
sürüm. Davranış değişmedi — kullanılamaz bir analiz arşive hâlâ yazılmaz — ama
artık hangi görsellerin elendiği bulunabiliyor, bildirimler sayı veriyor ve
tavsiye seçili modelin ölçülmüş kalitesine göre değişiyor. Veri biçimi
değişmedi; mevcut arşivler olduğu gibi açılır.

### Eklenen (Added)
- **"Denendi, sonuç alınamadı" filtresi:** modelin kullanılabilir sonuç
  üretemediği görseller işaretlenir ve sol taraftaki *AI görsel analiz durumu*
  bölümünden tek tıkla listelenir. Bu görseller analiz sırasında beklemeye
  devam eder; daha yetenekli bir modelle yeniden denenebilirler.
- Analiz bildirimlerinde **"Bu görselleri göster"** düğmesi — filtreyi doğrudan
  o görsellere daraltır.

### Değişen (Changed)
- Analiz koşusu bildirimi artık **sayı veriyor**: "60 görselden 55'i analiz
  edilip arşive kaydedildi, 5 tanesinde…". Önceki tek tip uyarı, koşunun
  büyük kısmı başarılı olsa bile tüm işin boşa gittiği izlenimini veriyordu.
- Bir görsel bile kaydedildiyse bildirim hata değil **bilgi** tonunda gösterilir.
- Tavsiye cümlesi modelin **ölçülmüş kalitesine** göre ayrışır: kanıtlanmış bir
  model kullanılıyorsa "model değiştirin" denmez; bazı görsellerin (logo, boş
  ya da çok küçük görüntü, düz metin ekranı) betimlenemeyeceği söylenir.
- Devre kesici koşuyu yarıda kestiğinde artık yalnızca "art arda N hata"
  denmiyor; elenen dosyaların akıbeti ve ne yapılabileceği de bildiriliyor.

### Düzeltilen (Fixed)
- Uzun bildirim metinleri, yanlarındaki eylem düğmesi yüzünden satır başına
  birkaç kelimeye sıkışıp okunamaz hale geliyordu; düğme artık metnin altında.

## [3.3.3] — 2026-08-13 — Yeni Nesil Kod Tabanı (H3)

Bu sürüm, uygulamanın yeniden yazılmış **yeni nesil kod tabanının** ilk halka
açık sürümüdür (3.3.0–3.3.3 hattının toplamı). 3.2.2 ve öncesinden farklı bir
uygulama kimliği kullanır: eski sürümün **yerinde yükseltmesi değildir** —
yan yana kurulur; eski arşiv, yeni sürümde **Ayarlar → İçe Aktarma**
sihirbazıyla taşınır (kaynak veriye dokunmaz, güvenle tekrarlanabilir).

### Değişen (Changed)
- Veri katmanı tarayıcı içi sql.js'ten **native SQLite'a (Rust)** taşındı;
  arşiv artık tarayıcı belleğinde değil, diskte tek doğruluk kaynağında tutulur.
- AI/embedding hesaplamaları tarayıcıdan **Rust ONNX Runtime'a** taşındı.
- Büyük arşiv desteği: on binlerce dosyalık gerçek arşivlerle doğrulandı;
  mimari yüz binler ve üzeri ölçek hedefiyle tasarlandı.

### Eklenen (Added)
- Eski nesil (3.2.x) arşivinden **içe aktarma sihirbazı**; son aktarımın
  özeti (tarih, kaç yeni / kaç mevcut kayıt) kartta gösterilir (3.3.1).
- Sürüm göstergesi: üst çubukta ve Ayarlar → Genel'de uygulama sürümü.

### Düzeltilen (Fixed)
- "Önceki sürüm bulundu" kartının, uygulamanın kendi kurulumunu eski sürüm
  sanması düzeltildi (3.3.2).
- Ek (ikincil) arşivlerde sohbetlerin kaydedilmemesi düzeltildi; sohbet
  kaydetme hatası artık sessizce yutulmaz, kullanıcıya bildirilir (3.3.3).

## [3.2.2] — 2026-07-01 — Klasörler & Arama İnce Ayarları

Klasör yönetimi ve arama sonuçlarını iyileştiren bir yama. Veri ve iş akışı
değişmez; mevcut arşivler olduğu gibi açılır.

### Düzeltilenler

- **Klasörler sekmesi — sağ-tık menüsü ve sıralama.** Sağ-tık (bağlam) menüsü
  artık bulunulan sayfaya özel seçenekler gösteriyor; klasör sıralaması gerçekten
  uygulanıyor (önceden bazı durumlarda etkisizdi).
- **Klasörler sekmesinde ilgisiz filtreler gizlendi.** Yalnız dosya (asset)
  düzeyinde anlamlı olan filtreler Klasörler görünümünde artık görünmüyor —
  arayüz sadeleşti.
- **AI Sohbet — "X hangi dosyada?" liste yanıtları.** Bu tür liste sorularında
  dosyalar artık alaka düzeyine (BM25) göre sıralanıyor; en olası eşleşme en üstte.
- **Görsel arama — Osmanlı/geleneksel mimari terimleri.** "Şadırvan" gibi
  dini/geleneksel terimler görsel (CLIP) aramasında doğru İngilizce karşılığına
  (ablution fountain) çevrilerek daha isabetli sonuç veriyor.

## [3.2.1] — 2026-06-26 — Yardım Aramada Gezinme

Yardım panelindeki arama deneyimini iyileştiren bir yama. Veri ve iş akışı değişmez.

### İyileştirilenler

- **Yardım aramasında sonuçlar arası gezinme.** Arama birden fazla sonuç bulduğunda
  arama çubuğunda **"X/Y" sayaç + ↑/↓ butonları** çıkar; **Enter** sonrakine,
  **Shift+Enter** öncekine gider (sona gelince başa sarar). Aktif eşleşme belirgin
  vurgulanır ve görünüme kaydırılır.

### Düzeltilenler

- **Yardım arama vurgusu artık tüm sekmelerde çalışıyor.** Önceden yalnızca Kullanıcı
  Kılavuzu ve Teknik Referans'ta vurgulanıyordu; **Sürüm Notları** ve **Senaryolar**
  sekmelerinde aranan terim içerikte görünmesine rağmen vurgulanmıyordu — düzeltildi.

## [3.2.0] — 2026-06-26 — OCR, Harita & Kategori Arşivleri

Son dağıtılan sürümden (3.0.4) bu yana biriken yeni özellikleri getiren minor
sürüm. Veri ve iş akışı geriye uyumlu; mevcut arşivler olduğu gibi açılır.

### Eklenenler

- **OCR — Offline metin tanıma (yeni).** Taranmış belge ve görsellerdeki metin
  artık gerçek OCR ile çıkarılıp hem tam-metin hem semantik aramada bulunur.
  Tamamen offline çalışan **Tesseract** motoru (internet/Ollama gerekmez); isteğe
  bağlı Ollama vision-LLM de seçilebilir. Varsayılan kapalı — Ayarlar > AI & Vision
  > OCR'dan açılır. Çok-sayfalı taranmış PDF'ler sayfa sayfa OCR'lanır. "Mevcut
  dosyaları OCR'la" düğmesiyle önceden taranmış kütüphane tek tıkla taranır.
- **Harita görünümü — EXIF GPS (yeni).** GPS'li fotoğraflar offline bir dünya
  haritasında işaretçi/kümeleme ile gösterilir; ülke + en yakın şehir bilgisi,
  fare ile zoom/pan, haritadan Kaşif'e drill. Tamamen offline (tile sunucusu yok).
- **Kategori arşivleri (3.1.0).** İçeriği proje/yıl/müşteriye göre ayrı arşivlere
  bölme; yalnız aktif arşivi belleğe yükleyerek büyük kütüphanelerde açılış
  belleğini kontrol altında tutma. Oluştur / yeniden adlandır / çöp kutusu / geri
  yükle + gruplar arası taşıma.

### İyileştirilenler

- **Yerel arşivde semantik & içerik arama** — yerel (kişisel) arşivler de artık
  epoch-aware vec.db ile semantik/RAG aramayı tam destekler.
- **Açılışta semantik arama otomatik aktif** (login sonrası arka plan ısınma).

### Düzeltilenler

- Harita sekmesi, koordinatlı/koordinatsız her durumda taban haritayı gösterir.
- Harita görünümünde sağ-tık artık alakasız bağlam menüsünü açmıyor.
- OCR indeks yolu üç çağrı yerinde birleştirildi (chunk_ocr tutarlılığı + sağlayıcı-aware).

## [3.0.1] — 2026-06-04 — Başlangıç Performansı & UX

Açılış donmasını gideren bir yama sürümü. Veri ve iş akışı değişmez; yalnızca
uygulamanın açılış deneyimi ile klasör yönetimi iyileşir.

### İyileştirilenler

- **Açılış donması giderildi** — Giriş ekranı artık anında gelir, donmaz.
  Önceden embedding AI modeli (semantik arama için) açılışta yüklenip ana iş
  parçacığını ~8 saniye bloklayarak giriş ekranını dondururdu. Model artık
  yalnızca **ilk semantik aramada** yüklenir; hiç arama yapılmayan oturum bu
  maliyeti hiç ödemez. (commit bac382d)
- **Büyük arşivlerde akıcı giriş** — Ağır arşiv veritabanının (sql.js)
  yüklenmesi giriş sonrasına ertelendi; giriş ekranı dosya/varlık sayısından
  bağımsız akıcı kalır.
- **Arşiv yükleme ekranı** — Giriş sonrası büyük arşiv yüklenirken animasyonlu,
  geçen süre + (önceki yüklemeden ölçülen) tahmini kalan süreyi gösteren bir
  bekleme ekranı eklendi.

### Eklenenler

- **Klasörler sekmesi — kart sağ-tık menüsü** — Klasör kartına sağ-tıklayınca
  "Aç" ve "Çöp'e Taşı" (klasörü ve içindeki dosyaları geri-alınabilir biçimde
  Çöp Kutusu'na taşıma) seçenekleri. Mevcut görünüm/sıralama menüsü korunur.
  (commit f7c06cc)

---

## [3.0.0] — 2026-05-23 — V3 Mimari

ArchivistPro v3, mimari arşivleri yönetme yaklaşımında köklü bir altyapı
yenilemesi getirir. Kullanıcı için günlük deneyim aynı kalır; ancak veri
saklama, AI sohbet doğruluğu ve büyük arşivlerle çalışma performansı kayda
değer biçimde iyileşir.

### ⚠️ Önemli — Geriye Uyumluluk

- Mevcut arşivler **ilk açılışta otomatik** olarak V3 şemasına taşınır.
  Migrasyondan önce `archivist_premigrate_v3.db.bak` adıyla yedek üretilir —
  geri dönüş güvenlidir.
- Manuel kontrol isteyen yöneticiler **Ayarlar → Depolama → V3 Şema
  Migrasyonu** panelinden tetikleyebilir (otomatik tetik isteğe bağlı
  kapatılabilir: `localStorage ARCHIVIST_V3_EPOCH='off'`).
- Eski sürümlere dönüş `.bak` dosyasından geri yüklemeyle mümkündür.

### Eklenenler

- **V3 Şema Mimari** — Vektör verileri (embeddings, text chunks, asset
  relations, FTS5 keyword index) ayrı `archivist_vec.db` dosyasına taşındı.
  Sonuç: ana `archivist.db` yaklaşık **3-4× küçülür**; gerçek örnekte
  181 MB → 52 MB ölçümlendi.
- **Settings → V3 Şema Migrasyonu paneli** (admin-only) — manuel tetik
  butonu, migrasyon ilerlemesi, hata teşhisi.
- **HNSW ANN Vektör Dizini** — büyük embedding kümelerinde (1M+ ölçek)
  semantik arama latency'si milisaniyelerde (p50≈9 ms, p99≈10 ms ölçüldü).
- **Per-arşiv yazma kilidi** — birden fazla arşivle eşzamanlı çalışırken
  veri güvenliği. Eski "tek global kilit" deseni kaldırıldı.
- **Cross-archive merge** (Join/Extract) artık embedding ve text chunk
  verilerini de korur — sadece asset metadata değil.
- **Klasör silme geri-al** snapshot artık V3 verisini de kapsar
  (embeddings, text chunks, ilişkiler hep birlikte geri yüklenir).
- **Türkçe AI Sohbet "var mı / geçer mi / olur mu" yakalama** — soru-eki
  doğru tanınır, liste yanıtı doğrudan dosya listesiyle döner.

### Değişenler

- **WAL Journal default açık** — yerel disk için varsayılan SQLite journal
  modu WAL (yazma performansı artar). Ağ paylaşımı (UNC / `\\sunucu\...`)
  otomatik tespit edilir ve DELETE moduna düşülür (paylaşımlı dosya
  sisteminde WAL güvensiz). Opt-out: `ARCHIVIST_DB_JOURNAL=delete`.
- **Migration finalize Rust tarafında** — büyük monolit arşivlerde
  (180+ MB) ortaya çıkan `RangeError: Invalid array length` (Tauri IPC
  payload sınırı) sorunu çözüldü. Migration artık Rust'ta atomik:
  rusqlite ile DROP + VACUUM + `user_version=3` tek seferde.
- **AI Sohbet okuma yolları epoch-aware** — embedding/text-chunk/keyword/
  ilişki okumaları migrasyondan sonra vec.db'ye yönlenir (PRE-5).
- **AI Sohbet yazma yolları epoch-aware** — tarama, snapshot, metadata
  oto-sync, cross-archive merge migrasyondan sonra vec.db'ye yazar (PRE-6).

### İyileştirilenler

- **Migration mekanik tamamlanma** — gerçek 185 MB monolit arşivde başarılı
  test (3. canlı denemede commit `5cc6417` ile).
- **Recall metriği** — vektör arama doğruluğu mesafe-tabanlı recall ile
  ölçülür (ANN-benchmark standardı). Gerçek arşivde recall@10 ≥ 0.98.
- **Stale WAL temizliği** — `write_database` blob-overwrite sonrası
  yetim `-wal` / `-shm` dosyaları otomatik silinir (Gate 0 ağı).
- **Backup/export öncesi `wal_checkpoint(TRUNCATE)`** — snapshot ve
  arşiv ihracında tutarlılık garantilenir.

### Düzeltilenler

- **AI Sohbet "X var mı" → "Hayır" hatası** — `detectListIntent` Türkçe
  soru-eki "mı/mi/mu/mü"yü önceki kelimeden ayırıyor, marker listesi
  yalnız birleşik `varmi` tutuyordu. Fix `92681e9`: hem ham hem soru-eki
  birleştirilmiş tokenları markerlara karşı kontrol et.
- **A6 migration disk-write fail sahte-başarı** — `runV3EpochMigration`
  disk yazımı başarısız olsa bile epoch ilerletip "ok" döndürebiliyordu;
  artık save dönüşü kontrol edilir, başarısız ise migration durdurulur
  (commit `76d2acf`).
- **Tauri'de `window.confirm` yasak** — paneldeki onay diyaloğu
  `showConfirmDialog` ile değiştirildi (commit `42ae798`).
- **HNSW reload `load_hnsw_with_dist` ile çöküyordu** — `load_hnsw`
  (`&mut self`, datamap mmap doldurur) ile değiştirildi. 1M reload
  artık paniksiz, in-RAM ile birebir doğruluk (commit `0e0335d`).
- **`verify_embeddings` karışık-boyut bug** — hard-coded `384*4` blob
  sağlaması, 512-dim CLIP'i sahte-FAIL ediyordu; boyuttan bağımsız
  round-trip kontrolüne geçildi.

### Güvenlik

- Anonimleştirici `scanned_roots.label` PII açığı kapatıldı (commit
  `e71b59b`) — test verisi üretiminde hassas etiketler temizlenir.

---

## [2.4.10] — 2026-05-17

### Eklenenler

- **AI Sohbet — "X hangi belgede" list-intent içerik araması** —
  `directFileListAnswer` artık dosya adı/etiket/metadata YANINDA belge
  metnini de tarar (FTS5 + tr_norm fallback). "Şenay hangi dosyada"
  gibi sorularda asset metadata'da olmasa bile chunk içeriğinde geçtiği
  belge bulunur.

### Düzeltilenler

- **AI Sohbet keyword fallback Türkçe karakterleri kaçırıyordu** —
  Türkçe-aware normalize (İ→i, I→ı, vb.) tüm karşılaştırma noktalarına
  uygulandı (commit `4d010a8`).
- **Sızan prompt iskeleti** — LLM cevabında kalan "KAYNAKLAR:" / "SORU:"
  gibi şablon satırları post-process ile temizlenir (commit `deb51d3`).
- **Keyword-gate birebir tüm-token eşleşmesi topK'ya garanti dahil** —
  yüksek embedding skoruna sahip ama keyword eşleşmesi olmayan chunk'lar
  kesin eşleşmeyi gölgeleyemez.
- **pre-2.4.8 ölü `dwg_shapes` tablosu migration ile temizlensin** —
  %99'a varan DB bloat'ı düzeltildi (commit `b1445ed`).

---

## [2.4.9] — 2026-05-16

### Eklenenler

- **fp32 modelleri harici/kullanıcı-sağlamalı import** — varsayılan q8
  modeller paketle gelir; isteyen kullanıcı (örn. doğruluk için) fp32
  modelleri ayrı indirip yerleştirebilir.

### Düzeltilenler

- **transformers v4.2.0 offline regresyonları** — fp32/WebGPU + q8 yollarının
  tümü offline çalışır (commit `e343f76`).
- **CLIP warmup CSP** — `data:` URL yerine Blob; WebGPU tarama stall'ı
  giderildi (commit `999d319`).
- **Offline BENİ_OKU dinamik sürüm** + ODA/fp32 dokümantasyonu.

---

## [2.4.8] — 2026-05-15

### Değişenler

- **`dwg_shapes` ayrı DB dosyasına taşındı** — WAL mode + batch persist
  ile DWG shape verisinin ana DB'den izole edilmesi (commit `a39d20e`).
  V3 mimarinin temelini hazırlayan refactor.

### Düzeltilenler

- **SetupWizard 'admin/admin' yanıltıcı ipucu kaldırıldı** — kullanıcıyı
  yanlış yönlendiren placeholder metni temizlendi.

### Eklenenler

- **WebGPU embedding desteği** — transformers.js v4 upgrade ile
  kullanılabilir donanımda CPU yerine GPU'da embedding üretimi.

---

## [2.4.7] — 2026-05-13

### Düzeltilenler

- **Arşiv switch crash** — IPC binary migration ile çoklu arşiv geçişinde
  oluşan crash giderildi (commit `75aa611`).

### Eklenenler

- **mirror-release workflow** — Arsiv-H2 release'leri otomatik olarak
  ArchivistPro aynalama deposuna kopyalanır.

---

## [2.4.6] — 2026-05-12

### Düzeltilenler

- **Spinner animasyonları** — `.animate-spin` sınıfı tanımlandı, Loader2
  bileşenlerine uygulandı (commit `c059949`).

### İyileştirilenler

- **A-SAVE-FREEZE performans** — collections / tags / root_groups için
  tablo-özel rusqlite mirror; "DB kaydediliyor" donma giderildi
  (commit `adc1094`).

---

## [2.4.5] — 2026-05-10

### Eklenenler

- **DWG thumbnail limiti 100 → 500 MB** — büyük DWG dosyalarının önizleme
  üretimi (commit `276f7f2`).
- **Tarama sırasında process priority Below Normal** — tarama arka planda
  daha az yer kaplar, UI akıcılığı korunur.

### Düzeltilenler

- **MAX dosya boyut limitleri** 200MB→2GB, 10MB→50MB.
- **SetupWizard Ollama kontrolü** `pingOllama`'ya taşındı — HTTP plugin
  scope sorunu giderildi.

---

## [2.4.4] — 2026-04-30

### Açık Kaynak Hazırlık

- Lisans (MIT), dokümantasyon yapısı, `.gitignore` temizliği.
- 33 Rust clippy uyarısı düzeltildi (CI yeşil).

---

## Önceki Sürümler

v2.4.4 öncesi sürümlerin notları için git tag geçmişine bakın:

```bash
git tag --list 'v*' --sort=-v:refname
git show v2.4.3  # belirli sürüm
```

Önceki ana sürüm sınırları:

- **v2.4.x:** açık kaynak hazırlık, AI sohbet RAG iyileştirmeleri,
  thumbnail/format desteği genişlemeleri
- **v2.3.x:** Çoklu arşiv (main + local) altyapısı, AI hassasiyet filtresi
- **v2.2.x:** İlk AI sohbet (RAG) sürümü, embedding tabanlı arama
- **v2.1.x:** Tarama performansı, LAN paylaşım
- **v2.0.x:** Tauri v2 migration, React 19 upgrade
- **v1.x:** İlk Electron tabanlı sürümler (artık desteklenmiyor)

# ArchivistPro — Yeni Başlayanlar İçin Kurulum Rehberi

> **Sürüm:** 3.4.0 · **Güncelleme:** 2026-08-15 · **Platform:** Windows 10/11 (64-bit)
>
> Bu rehber bilgisayar kurulumlarına alışkın olmayanlar için adım adım yazılmıştır.
> Daha kısa/teknik bir özet için: **[Sistem yöneticileri rehberi](KULLANICI_KURULUM_PRO.md)**

## 1. ArchivistPro nedir?

Mimarlık ve tasarım arşivleri için **tamamen çevrimdışı** çalışan bir masaüstü
arşiv programıdır. Proje klasörlerinizi tarar; dosya adına ve içeriğe göre arama,
önizleme, kopya bulma ve (isterseniz) yapay zekâ destekli arama sunar.
**Dosyalarınız olduğu yerde kalır** — program hiçbir dosyayı taşımaz, kopyalamaz
ve internete göndermez.

## 2. Başlamadan önce — gereksinimler

| Gereksinim | Durum |
|---|---|
| Windows 10 veya 11 (64-bit) | Zorunlu |
| WebView2 Runtime | Güncel Windows'ta genellikle zaten kurulu; yoksa kurucu kendisi indirir |
| İnternet | Yalnız indirme sırasında; program çevrimdışı çalışır |
| Yönetici (admin) yetkisi | **Gerekmez** — kurulum kullanıcı hesabınıza yapılır |

## 3. İndirme

1. Tarayıcınızda şu adresi açın:
   **https://github.com/ahmet3ddd/ArchivistPro/releases/latest**
2. **Assets** başlığı altındaki dosyalardan şunu indirin:
   - **`ArchivistPro_3.4.0_x64-setup.exe`** ← Önerilen
   - `ArchivistPro_3.4.0_x64_en-US.msi` ← Alternatif (makine düzeyine **ayrı** kopya
     kurar; ne yaptığınızı biliyorsanız kullanın)
3. Dosya genellikle **İndirilenler** klasörüne iner.

> 💡 Dosyanın bozulmadan indiğini doğrulamak isterseniz release sayfasındaki
> SHA-256 tablosuyla karşılaştırabilirsiniz (zorunlu değildir).

## 4. Kurulum

1. İndirdiğiniz **`ArchivistPro_3.4.0_x64-setup.exe`** dosyasına çift tıklayın.
2. Windows **SmartScreen** mavi bir uyarı gösterebilir ("Windows kişisel
   bilgisayarınızı korudu"). Bu, paketin kod imzası olmamasından kaynaklanır ve
   beklenen bir durumdur: **"Ek bilgi"** yazısına, sonra **"Yine de çalıştır"**
   düğmesine tıklayın.
3. Kurulum sihirbazını takip edin (varsayılan ayarlar uygundur).
4. Kurulum saniyeler içinde biter ve programı başlatabilirsiniz.

> ℹ️ Program açılınca sol üstte, başlığın yanında sürüm numarasını (**v3.4.0**)
> görürsünüz — doğru sürümü kurduğunuzu buradan teyit edebilirsiniz.

## 5. İlk açılış

1. İlk açılışta **"İlk kurulum"** ekranı gelir: *"İlk yönetici (admin) hesabını
   oluşturun."* Bir kullanıcı adı ve parola (en az 6 karakter) belirleyip
   **"Hesabı oluştur"** deyin.
   > ⚠️ Bu parolayı not edin — parola tamamen bu bilgisayarda saklanır,
   > "parolamı unuttum" e-postası YOKTUR.
2. Oluşturduğunuz hesapla **giriş yapın**.
3. Karşınıza kısa bir tanıtım turu çıkar (**"Arşive hoş geldiniz"**). **Başla**
   ile 30 saniyede gezebilir ya da **"Turu atla"** diyebilirsiniz — sonradan
   Ayarlar'daki **"Rehberi göster"** ile yeniden açılır.

## 6. Arşivinizi kurun: klasör ekleyin ve taratın

1. Sol şeritten **Kaynak Klasörler** bölümünü açın.
2. **"Klasör ekle"** düğmesiyle proje arşivinizin bulunduğu klasörü seçin
   (örneğin `D:\Projeler`).
3. Program **"Şimdi taransın mı?"** diye sorar — **Tara** deyin.
   - Tarama seçeneklerinde **"Klasörden otomatik proje ata"** işaretliyse, kök
     klasörün altındaki ilk klasör adları proje adı olarak atanır (önerilir).
4. Tarama süresi arşiv boyutuna bağlıdır (on binlerce dosya ~dakikalar,
   yüz bin dosya ~yarım saat mertebesi). Bittiğinde bir tarama raporu görürsünüz.
5. Sonraki taramalar **çok daha hızlıdır**: değişmeyen dosyalar atlanır.

Ne tarandı? **Bütün dosyalarınız** arşive alınır (gizli ve sistem dosyaları
hariç — bunlar raporda "atlanan" bölümünde listelenir). DWG, MAX, IFC, RVT, SKP,
PDF, Office ve görüntü/video dahil **95+ format** özel olarak tanınır: içerik
metni, önizleme ve teknik bilgiler çıkarılır.

## 7. Eski sürümden (3.2.2) mi geliyorsunuz?

ArchivistPro 3.2.2 ve öncesi **eski nesil** bir programdır; 3.4.0 onun yerine
geçmez, **yan yana** kurulur. Verileriniz güvende — şöyle taşıyın:

1. ⚠️ **Eski sürümü ve verisini KALDIRMAYIN** (aktarım bitip siz doğrulayana kadar).
2. Yeni programda **Ayarlar → Genel** bölümüne gidin; **"Önceki sürüm bulundu"**
   kartını göreceksiniz.
3. Karttaki **"Önceki sürümden veri aktar"** düğmesine tıklayın. Sihirbaz,
   bulduğu arşiv dosyalarını listeler — gerçek arşiviniz genellikle **'ana'**
   etiketli ve en büyük olandır.
4. Önce **"Önce dene (hiçbir şey yazmaz)"** ile deneme yapın: uygulanırsa tam
   olarak ne olacağını gösterir.
5. **"Aktar"** deyin. İşlem öncesi otomatik yedek alınır; işlem yarıda kesilirse
   yeniden çalıştırmak güvenlidir.
   - **Taşınanlar:** dosya kayıtları, AI analizleri, etiketler, favoriler,
     koleksiyonlar, klasörler.
   - **Taşınamayanlar:** kullanıcı parolaları (yeni programda yeniden oluşturun)
     ve sohbet geçmişi.
6. Aktarımdan sonra klasörlerinizi **yeniden taratın** — kaliteli önizlemeler ve
   içerik metni taramayla oluşur; taşınan etiket ve AI analizleri korunur.

> ℹ️ Aktarımdan sonra kart kaybolmaz (kaynak veri silinmediği için) — kartta
> artık **"Son aktarım: …"** satırı görünür. Bu, aktarımın yapılmadığı anlamına
> gelmez.

## 8. AI özellikleri (isteğe bağlı)

Program AI'sız tam çalışır: tarama, dosya adı/içerik araması, önizleme, kopya
bulucu hepsi açıktır. Şunları da isterseniz AI kurulumu yapın:

- **Anlamsal arama** ("ahşap cephe detayı" gibi serbest aramalar) ve **Görsel Arama**
- **Sohbet** (arşive soru sorma) ve **görsel analiz** (AI'nın görselleri etiketlemesi)

Kurulum: **Ayarlar → AI → AI Kurulum Sihirbazı**

1. **Arama modelleri:** bir klasörden içe aktarılır (tamamen çevrimdışı).
2. **Sohbet & görsel analiz (opsiyonel):** ücretsiz [Ollama](https://ollama.com)
   programı gerekir. Ollama olmadan arama çalışır; yalnız sohbet ve görsel analiz
   kapalı kalır.
3. Sonunda **Ayarlar → AI → Kurulum kontrolü** ile GPU/Ollama/model durumunuzu
   görebilirsiniz.

> 💡 NVIDIA ekran kartı AI'yı hızlandırır ama şart değildir. Ekran kartınız varsa
> sürücüsünün güncel olmasına dikkat edin.

## 9. Sık sorulan sorular

**Dosyalarım kopyalanıyor/taşınıyor mu?**
Hayır. Program yalnız bir dizin (indeks) oluşturur; dosyalarınız yerinde kalır.
Bir klasörü listeden çıkarmak da dosyaları silmez.

**İnternet gerekiyor mu?**
Hayır. Yalnız indirme (ve isterseniz Ollama kurulumu) için gerekir; günlük
kullanım tamamen çevrimdışıdır. Hiçbir veriniz dışarı gönderilmez.

**Güncelleme nasıl yapılır?**
Yeni sürümün `setup.exe`'sini indirip çalıştırın — mevcut 3.3.x kurulumunuzu
yerinde yükseltir, verileriniz korunur.

**Programı kaldırırsam arşivim silinir mi?**
Hayır. Program kaldırılınca arşiv veritabanınız diskte kalır; yeniden kurunca
kaldığınız yerden devam edersiniz.

**Parolamı unuttum, ne yapabilirim?**
Başka bir yönetici hesabı varsa o sıfırlayabilir. Tek yönetici sizseniz ve parola
kayıpsa kurtarma yolu yoktur — parolanızı güvenli bir yerde saklayın.

## 10. Yardım

- Uygulama içi yardım: sol şeritteki **Yardım** düğmesi (kısayollar için **?** tuşu)
- Sorun bildirme: **https://github.com/ahmet3ddd/ArchivistPro/issues**
  ("şu ekranı anlamadım" da geçerli bir başlıktır)
- Sürüm notları: [CHANGELOG](../CHANGELOG.md)

---

*Bu rehber programla birlikte güncellenir. Son güncelleme: 2026-08-15 (v3.4.0).*

# ArchivistPro — Yol Haritası

Bu dosya projenin nereye gittiğini anlatır. Amaç söz vermek değil, yönü şeffaf tutmak: neyin sırada olduğu kadar **neyin bilinçli olarak ertelendiği** de burada yazılı.

Ayrıntılı teknik borç listesi ve karar gerekçeleri için: [`docs/dev/TODO.md`](dev/TODO.md)
Sürüm sürüm ne değiştiği için: [`CHANGELOG.md`](../CHANGELOG.md)

---

## Bugün nerede

Uygulama günlük kullanımda çalışır durumda: tarama, önizleme, kopya bulma, anlamsal arama ve arşive soru sorma özellikleri kullanılabilir. Arayüz beş dilde tamamlanmış, test paketi yeşil.

Şu anki mimari **on binler mertebesinde dosya** için tasarlandı. Bu ölçekte rahat çalışıyor; yüz binler ve üzeri için mimari değişiklik gerekiyor (aşağıya bakın).

---

## Sırada

**Kullanıcı tarafında**
- DWG'nin yeni sürümlerinde (R2004+) katman bilgisi çıkarımı şu an sınırlı — arayüzde bunun açıkça belirtilmesi, ardından tam destek
- Kurulum akışındaki tekrar eden "görüldü" bayraklarının tek bir yere indirilmesi

**Kod tarafında**
- Rust katmanı için birim test paketi (şu an testlerin tamamı arayüz tarafında)
- Üretim derlemesinde kalan konsol çıktılarının temizlenmesi

---

## Büyük adım: yüz binlerce dosya ölçeği

Bu ayrı bir dalda yürüyen, mevcut sürümü bozmadan ilerleyen bir çalışma. Ana konular:

- **Arama indeksi** — şu anki arama tüm vektörleri belleğe alıp tek tek karşılaştırıyor. Milyon dosya ölçeğinde yaklaşık indeks (ANN) yapısına geçilmesi gerekiyor.
- **Veritabanı katmanı** — veritabanının tamamının tarayıcı belleğine yüklenmesi büyük arşivlerde tavana vuruyor. Diskten tembel okuma yapan bir yapıya geçiş planlanıyor.
- **Çoklu arşivde yazma** — yazma işlemleri şu an tek sırada; beş üzeri arşivde tıkanıyor. Arşiv başına bağlantı havuzu gerekiyor.
- **Toplu işleme** — etiket önerisi şu an dosya başına bir model çağrısı yapıyor; büyük arşivlerde kuyruk ve toplu istek şart.
- **Büyük listelerin çizimi** — on binden fazla öğede liste ve ızgaraların tamamının sanallaştırılması.

Bu değişikliklerin bir kısmı geriye dönük uyumsuz. Bu yüzden ana dalda denenmiyor; hazır olduğunda ayrı bir sürüm olarak gelecek.

---

## Bilinçli olarak yapılmayanlar

- **Bulut senkronizasyonu yok.** Projenin varlık sebebi dosyaların yerelde kalması. Ağ üzerinden paylaşım yerel ağ içinde kalır.
- **Hesap ve abonelik sistemi yok.** Uygulama internete bağlanmadan çalışır; bunu bozacak bir özellik eklenmez.
- **macOS / Linux şu an planda değil.** Tauri bunu teknik olarak mümkün kılıyor ama önizleme üretimi Windows'a özgü bileşenlere dayanıyor. İlgi olursa yeniden değerlendirilir.
- **Küçük optimizasyonlar ertelendi.** Ölçülmemiş bir performans sorununu çözmek yerine, gerçekten yaşanan tıkanmalar öncelikli.

---

## Öneriniz varsa

Buradaki sıralama kullanıcı geri bildirimiyle değişir. Eksik bulduğunuz ya da öncelikli gördüğünüz bir şey varsa [Issues](https://github.com/ahmet3ddd/ArchivistPro/issues) üzerinden yazın — "şu ekranı anlamadım" da geçerli bir başlıktır.

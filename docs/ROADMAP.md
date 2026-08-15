# ArchivistPro — Yol Haritası

Bu dosya projenin nereye gittiğini anlatır. Amaç söz vermek değil, yönü şeffaf tutmak: neyin sırada olduğu kadar **neyin bilinçli olarak ertelendiği** de burada yazılı.

Sürüm sürüm ne değiştiği için: [`CHANGELOG.md`](../CHANGELOG.md)

---

## Bugün nerede (v3.4.0)

Uygulama günlük kullanımda çalışır durumda: tarama, önizleme, kopya bulma, tam metin + anlamsal arama, görsel arama ve arşive soru sorma özellikleri kullanılabilir. Arayüz beş dilde; test paketi (920+ Rust testi + arayüz testleri) yeşil.

3.3.x hattı, uygulamanın **yeniden yazılmış yeni nesil kod tabanıdır:** veriyi Rust tarafı sahiplenir, arşiv tarayıcı belleğinde değil diskte native SQLite'ta tutulur; AI/embedding hesaplamaları da tarayıcıda değil Rust tarafında koşar. Bu mimari **on binlerce dosyalık gerçek arşivlerle doğrulandı** ve yüz binler ölçeği hedefiyle tasarlandı — eski neslin (3.2.x) "yüz binler için mimari değişiklik gerekiyor" sınırı bu hatta aşıldı.

**Eski nesil (3.2.2 ve öncesi) kullanıcıları için:** 3.3.x yerinde yükseltme değildir; yan yana kurulur, eski arşiv **Ayarlar → İçe Aktarma** sihirbazıyla taşınır. Geliştirme yeni kod tabanında sürüyor; 3.2.x hattına yeni özellik planlanmıyor.

---

## Sırada

**Kullanıcı tarafında**
- Görsel ağırlıklı arşivlerde AI ile içerik analizi/etiketlemenin kapsam seçilerek (klasör/proje bazlı) ve kaldığı yerden devam edebilir biçimde yaygınlaştırılması — metin içermeyen dosyalarda aramanın ana kaldıracı bu.
- DWG'nin yeni sürümlerinde (R2004+) katman bilgisi çıkarımı şu an sınırlı — önce arayüzde bunun açıkça belirtilmesi, ardından tam destek.
- Uygulama içi güncelleme bildirimi (yeni sürüm çıktığında haber verme).

**Kod tarafında**
- Vektör (anlamsal/görsel) aramanın çok büyük arşivlerde yaklaşık indekse (ANN) taşınması — bugünkü yapı doğru sonucu veriyor, hedef milyonlar ölçeğinde de hızlı kalması.
- Uzun süren işlerin (toplu AI analizi gibi) kalıcı iş kuyruğuna bağlanması.

---

## Bilinçli olarak yapılmayanlar

- **Bulut senkronizasyonu yok.** Projenin varlık sebebi dosyaların yerelde kalması. Ağ üzerinden paylaşım yerel ağ içinde kalır.
- **Hesap ve abonelik sistemi yok.** Uygulama internete bağlanmadan çalışır; bunu bozacak bir özellik eklenmez.
- **macOS / Linux şu an planda değil.** Tauri bunu teknik olarak mümkün kılıyor ama önizleme üretimi Windows'a özgü bileşenlere dayanıyor. İlgi olursa yeniden değerlendirilir.
- **Her dosyaya otomatik AI analizi yok.** Milyonlarca dosyalık arşivde "hepsini tara" yaklaşımı günlerce sürer; bunun yerine kapsam seçimli, durdurulup devam ettirilebilir analiz tercih ediliyor.
- **Küçük optimizasyonlar ertelendi.** Ölçülmemiş bir performans sorununu çözmek yerine, gerçekten yaşanan tıkanmalar öncelikli.

---

## Öneriniz varsa

Buradaki sıralama kullanıcı geri bildirimiyle değişir. Eksik bulduğunuz ya da öncelikli gördüğünüz bir şey varsa [Issues](https://github.com/ahmet3ddd/ArchivistPro/issues) üzerinden yazın — "şu ekranı anlamadım" da geçerli bir başlıktır.

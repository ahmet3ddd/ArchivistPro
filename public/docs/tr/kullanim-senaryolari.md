# ArchivistPro — Ne Yapabilirim?

> Sürüm 3.0.0 | 2026-05-23
>
> Bu rehber gerçek ofis senaryolarıyla ArchivistPro'yu tanıtır. Her senaryo 1 dakikada okunur.

---

## 1. "Geçen yılki villa projesinin cephe detayını bulmam lazım"

1. Arama kutusuna **villa cephe** yazın
2. Sonuçlar otomatik sıralanır — dosya adı, proje adı ve AI etiketleri taranır
3. Soldaki **Kategori** filtresinden "2D Çizim" seçerek sadece çizimleri görün
4. Dosyaya tıklayın → sağ panelde önizleme, katmanlar ve detaylar görünür

> **İpucu:** Tam kelimeyi hatırlamıyorsanız yaklaşık yazın — "cehpe" yazarsanız bile bulur (fuzzy arama).

---

## 2. "Müşteriye göndereceğim tüm renderleri bir araya toplayayım"

1. Soldaki **Kategori** filtresinden **Render** seçin
2. İstediğiniz renderleri tek tek tıklayarak seçin (veya Ctrl+A ile tümünü)
3. Sağ tık → **Etiketle** → "Müşteri Sunumu" gibi bir etiket oluşturun
4. Artık her zaman soldaki **Etiket Filtresi**'nden "Müşteri Sunumu" seçerek bu dosyalara ulaşabilirsiniz

---

## 3. "Bu DWG'nin eski versiyonu var mıydı?"

1. DWG dosyasını bulun ve tıklayın
2. Sağ panelde **Bağlantılı Dosyalar** bölümüne bakın
3. Sistem `plan_v1.dwg`, `plan_v2.dwg`, `plan_Rev-A.dwg` gibi dosyaları **otomatik** gruplayıp burada gösterir
4. Bağlantılı dosyanın adına tıklayarak o versiyona geçin

> Otomatik bulunamazsa: dosyaya sağ tık → **Benzerini Bul** — yapısal olarak benzer DWG'leri listeler.

---

## 4. "Şu malzemeye benzer başka projelerde ne kullandık?"

1. Beğendiğiniz render veya fotoğrafı bulun
2. Sağ tık → **Benzerini Bul** veya üst bardaki **Gelişmiş Arama → Görsel Arama**
3. Görseli yükleyin — sistem renk, doku ve kompozisyon bazında benzer dosyaları getirir

> DWG dosyaları için de çalışır: katman yapısı, blok yapısı ve metin içeriği karşılaştırılır.

---

## 5. "Sadece bu ay değiştirilen dosyaları görmek istiyorum"

1. Sol paneldeki **Tarih Filtresi**'ni açın
2. Başlangıç tarihini bu ayın 1'i yapın
3. Sonuçlar otomatik güncellenir — sadece son değişiklikler görünür
4. **Sıralama**'yı "Değiştirilme tarihi" yaparak en yenileri üste alın

---

## 6. "Ofisteki arşivi kendi bilgisayarıma çekmek istiyorum"

1. Yöneticinizden şu bilgileri alın: **IP adresi** ve **8 haneli bağlantı kodu**
2. Ayarlar → Ağ sekmesine gidin
3. IP ve kodu girin → **Bağlan**
4. "Arşivi İndir" butonuna tıklayın — birkaç dakika içinde tüm arşiv bilgisayarınızda

> İnternet gerekmez. Aynı ofis ağında (Wi-Fi veya kablo) olmanız yeterli.

---

## 7. "Aynı dosyadan birden fazla kopya var mı kontrol edeyim"

1. Üst bardaki **Gelişmiş Arama → Kopya Bulucu**'yu açın
2. **Birebir Kopya** modunu seçip **Tara** butonuna tıklayın
3. Aynı içerikli dosyalar gruplar halinde listelenir
4. Karşılaştırma görünümünde yan yana inceleyin
5. Gereksiz kopyaları seçip silin (yönetici yetkisi gerekir)

---

## 8. "Onaylanacak çizimler var mı bakayım" (yönetici)

1. **Dashboard** görünümüne geçin
2. **Onay Kuyruğu** panelinde "İncelemede" bekleyen dosyaları görün
3. Dosyaya tıklayıp inceleme yapın
4. **Onayla** veya **Reddet** (red sebebi yazın)
5. Tüm değişiklikler **Onay Geçmişi**'nde kayıt altında

---

## 9. "AI ile arşivime soru sormak istiyorum"

1. Üst bardaki **AI** butonuna tıklayın
2. Doğal dilde soru yazın:
   - *"Ahşap cephe detayı olan çizimler var mı?"*
   - *"Hüvellezi geçen dosyalar var mı?"*
   - *"Son 3 ayda eklenen PDF'leri listele"*
   - *"Mutfak projelerinde hangi malzemeler kullanılmış?"*
   - *"Merdiven hangi DWG dosyalarında çiziliyor?"*
3. AI arşivinizdeki dosyaları tarayarak kaynaklı yanıt verir
4. Kaynağa tıklayarak doğrudan o dosyaya gidin

> AI tamamen bilgisayarınızda çalışır. Dosyalarınız internete gönderilmez.
>
> **v3.0.0 İpucu:** "X var mı / geçer mi / olur mu" gibi yes/no soruları
> AI doğrudan dosya listesi olarak yanıtlar — LLM beklemesine gerek
> kalmaz, anında sonuç gelir.

---

## 10. "Bir dosyanın metadata bilgilerini dışa aktarmak istiyorum"

1. Dosyaya sağ tıklayın → **XMP Dışa Aktar**
2. Dosyanın yanına `.xmp` uzantılı bir sidecar oluşturulur
3. Bu dosyayı Adobe Bridge, Lightroom veya başka DAM araçlarıyla açabilirsiniz

---

## 11. "Eski sürümden v3.0.0'a geçtim, ne değişti?"

1. **İlk açılışta** arşiviniz otomatik olarak yeni mimariye taşınır
2. Bu işlem birkaç saniye sürer; ekranda kısa bir bildirim görürsünüz
3. Migration tamamlanınca her şey eskisi gibi çalışır — arama, tarama,
   AI sohbet, etiketler, koleksiyonlar
4. Arşiv klasörünüze bakarsanız iki yeni dosya görürsünüz:
   - `archivist_vec.db` — vektör verileri (embedding'ler, metin parçaları)
   - `archivist_premigrate_v3.db.bak` — eski sürümün yedeği

> **Endişelenmeyin:** Veriniz güvende. `.bak` dosyası migration'dan ÖNCEKİ
> halinizin tam yedeğidir. Bir hafta her şeyin yolunda gittiğine emin
> olduktan sonra `.bak` dosyasını silebilirsiniz.

> **Yedek almak istediğinizde:** Eski sürümde sadece `archivist.db`'yi
> kopyalardınız. Şimdi **iki dosyayı birlikte** kopyalayın
> (`archivist.db` + `archivist_vec.db`). Uygulama içi yedek/snapshot
> mekanizması bunu otomatik yapar.

---

## 12. "Hassas dosyalar AI sohbette çıkmasın istiyorum" (yönetici)

Arşivinizde sözleşmeler, maaş tabloları veya gizli müşteri bilgileri varsa:

1. **Ayarlar → Güvenlik → AI Hassasiyet Filtresi**'ni açın
2. İlgili kategoriyi aktifleştirin (Finansal, Kişisel, Hukuki, İK)
3. Gerekirse özel kelime ekleyin (ör. müşteri adı)
4. Tek bir dosya için: dosyaya sağ tık → **"AI'dan Gizle"**
5. Tüm klasör için: kaynak klasör menüsünden → **"AI'dan Hariç Tut"**

> Gizlenen dosyalar arşivde görünmeye devam eder, sadece AI sohbet onlara erişemez.

---

## Günlük Kısayollar

| Ne yapmak istiyorsunuz? | Nasıl? |
|--------------------------|--------|
| Dosya aramak | Arama kutusuna yazın |
| Birden fazla kelimeyle aramak | `plan AND kesit` veya `"kat planı"` |
| Dosyayı açmak | Çift tık veya sağ tık → Aç |
| Dosyayı etiketlemek | Sağ tık → Etiketle |
| Favorilere eklemek | Detay panelinde yıldız ikonu |
| Son işlemi geri almak | Ctrl+Z |
| Yardım almak | F1 veya sol alttaki ? ikonu |

---

*Sorunuz mu var? Yöneticinize sorun veya uygulamadaki F1 tuşuna basarak yardım kılavuzuna ulaşın.*

*Son güncelleme: 2026-05-23 (v3.0.0).*

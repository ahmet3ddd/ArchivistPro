# ArchivistPro — Veri Güvenliği Profili

> **Canlı belge.** Yeni nesil kod tabanında (3.3.x) orijinal dosyalarınızın ve
> arşiv verisinin nasıl korunduğu. Son güncelleme: **2026-08-14 (v3.3.3)** —
> belge bu depodaki kod esas alınarak yeniden yazıldı; eski neslin profili
> `archive/` altında tarihsel kayıttır.
> Kimlik/yetki için: [`GUVENLIK.md`](GUVENLIK.md)

## Yönetici özeti

**Orijinal dosyalarınıza hiçbir şey olmaz:** tarama ve içerik çıkarımı
salt-okunurdur; uygulamada kaynak dosyayı taşıyan, yeniden adlandıran veya
silen bir kod yolu yoktur. **Arşiv verisi** (indeks) tek doğruluk kaynağı
olarak diskteki native SQLite dosyasında tutulur; WAL günlüğü, sürümlü ve
testli migration'lar, otomatik + elle yedekler ve bozulmada otomatik geri
yükleme ile korunur.

## 1. Orijinal dosyalar (kaynak diskiniz)

- Tarama yalnız **okur**: dizin gezme, boyut/tarih okuma ve içerik parmak izi
  (**BLAKE3**, akış halinde — büyük dosyada sabit bellek).
  — `crates/archivist-ingest/`
- İçerik çıkarımı da okur; tek istisna DWG'nin ODA dönüştürmesidir ve o da
  dosyanın **kopyasını** uygulamanın geçici klasörüne alarak çalışır —
  orijinale dokunulmaz. — `crates/archivist-extract-cad/src/oda.rs`
- Önizlemeler ve türetilmiş veriler kaynak klasörünüze değil, uygulama veri
  dizinine yazılır.
- "Listeden çıkar" ve "Çöpe at" işlemleri **yalnız arşiv kayıtlarını** etkiler;
  diskteki dosyalar silinmez (arayüz metinleri de bunu açıkça söyler).
- Gizli ve sistem dosyaları indekslenmez ve bu **sessiz değildir**: tarama
  raporunun "atlanan" bölümünde sebebiyle listelenir.

## 2. Arşiv verisi (tek doğruluk kaynağı)

- Native SQLite, diskte: `%APPDATA%\com.archivistpro.h3\` (eski neslin
  tarayıcı-belleğinde-veritabanı modeli tamamen terk edildi).
- **WAL** günlük kipi + `synchronous=NORMAL`: elektrik kesintisinde
  tamamlanmamış işlem geri sarılır; okuyucular yazıcıyı beklemez.
  — `crates/archivist-db/src/connection.rs`
- Sorgu bağlantıları **salt-okunur** açılır (`query_only`); yanlışlıkla yazma
  girişimi anında hata verir. — `crates/archivist-db/src/lib.rs`
- Şema değişiklikleri **sürümlü, ileri-yönlü ve testli** migration'larla
  yapılır (`crates/archivist-db/src/migrations/` + kapsamlı migration test
  paketi). Sağlık kartında görülen "Şema vN" rozeti bu sürümdür.

## 3. Yedekler

- **Elle:** Ayarlar → Yedekler — *Yedek Al · Geri Yükle · Dışa Aktar · İçe
  Aktar*. Yedekler arşivin yanında saklanır; **felaket yedeği için "Dışa
  Aktar" ile harici diske** kopyalayın (arşivle aynı disk ölürse yanındaki
  yedek de ölür).
- **Otomatik:** ayarlanabilir aralıkla (saat cinsinden; kapalı da olabilir)
  ve üst sayı sınırıyla; yalnız uygulama açık ve admin girişliyken çalışır.
- **Kritik işlem öncesi:** eski sürümden veri aktarımı gibi geri dönüşü zor
  işlemlerden önce otomatik yedek alınır.

## 4. Bozulma ve çökme senaryoları

| Senaryo | Davranış |
|---|---|
| Veritabanı bozuk açılırsa | En son sağlam yedekten **otomatik geri yükleme**; bozuk dosya silinmez, karantinaya alınır |
| Yedek de yoksa | Temiz veritabanıyla açılır; bozuk dosya saklanır, Ayarlar → Yedekler'den elle dönebilirsiniz |
| Uygulama çöker / kapanmazsa | WAL yarım işlemi geri sarar; açılışta "önceki oturum temiz kapanmadı" tespiti sağlık denetimi (Doctor) önerir |
| Elektrik kesintisi | WAL + senkron yazma disiplini; tamamlanmış işlemler kalır, yarım işlem geri sarılır |
| Tarama yarıda kesilirse | O ana kadar indekslenenler kayıtlıdır; tarama **artımsaldır** — yeniden başlatmak güvenlidir, değişmeyen dosyalar atlanır |
| Kullanıcı hatası (yanlış silme) | Çöp kutusu + geri yükleme; kalıcı silme bile yalnız **kayıtları** siler, diskteki dosyaları değil |

## 5. İçerik parmak izi ve tutarlılık

- Her dosya için **BLAKE3** içerik özeti tutulur: kopya (duplicate) tespiti,
  değişiklik algılama ve artımsal taramanın temelidir.
- Eski sürümden aktarım **idempotenttir**: "Önce dene" kuru koşusu hiçbir şey
  yazmaz; gerçek koşu yarıda kesilse bile yeniden çalıştırmak mevcut kayıtlara
  dokunmaz. Kaynak (eski) veri hiçbir aşamada silinmez.

## 6. Çoklu arşiv

- Ek arşivler ayrı SQLite dosyalarıdır; ana arşiv kimlik/oturum merkezidir.
- Uygulamayı kaldırmak veriyi **silmez**: arşiv `%APPDATA%` altında kalır,
  yeniden kurulumda kaldığı yerden devam eder. Veriyi bilerek silmek isterseniz
  dizini elle silmeniz gerekir (pro rehberinde yazar).

## 7. Kullanıcıya düşenler (öneri)

1. **Dışa aktarılmış bir yedeği** düzenli olarak harici diskte/ağda tutun.
2. Fiziksel erişim riskiniz varsa disk şifrelemesi kullanın
   (bkz. [GUVENLIK.md §6](GUVENLIK.md)).
3. Büyük temizlik/düzenleme işlemlerinden önce elle bir yedek alın — ucuzdur.

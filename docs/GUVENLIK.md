# ArchivistPro — Güvenlik Profili

> **Canlı belge.** Yeni nesil kod tabanının (3.3.x) mevcut güvenlik duruşu.
> Son güncelleme: **2026-08-14 (v3.3.3)** — belge, eski neslin (3.2.x) profili
> yerine bu depodaki kod esas alınarak yeniden yazıldı; her iddianın yanında
> kaynağı var. Eski profil tarihsel kayıt olarak `archive/` altındadır.
> Veri kalıcılığı/yedekleme için: [`VERI_GUVENLIGI.md`](VERI_GUVENLIGI.md)

## Tehdit modeli (özet)

Tek makinede ya da güvenilen ofis ağında çalışan, **internete kapalı** bir
masaüstü uygulaması. Koruduğu şey: arşiv verisinin bütünlüğü, hesap parolaları
ve rol sınırları. Kapsam dışı: fiziksel disk erişimi olan saldırgan (bkz. §6).

## 1. Kimlik doğrulama

- Parolalar **argon2id** ile özetlenir (rastgele tuz `OsRng`; PHC formatı);
  düz parola hiçbir yerde saklanmaz. — `crates/archivist-db/src/auth.rs`
- **Anti-enumeration:** var olmayan kullanıcı adında da sahte bir argon2
  doğrulaması koşulur; yanıt süresi kullanıcının varlığını ele vermez.
- **Deneme kilidi:** art arda başarısız girişte hesap geçici kilitlenir
  (varsayılan 5 deneme; eşik 3–20, süre 1–120 dk aralığında ayarlanabilir).
- Parola tamamen **yereldedir**: kurtarma e-postası/sunucusu yoktur. Tek
  yöneticinin parolası kaybolursa kurtarma yolu yoktur (rehberlerde de yazar).

## 2. Roller ve yetki denetimi (RBAC)

- Roller: **admin** (tam yetki) ve **viewer** (salt-görüntüleme).
- Gerçek denetim **Rust komut katmanındadır** (`require_admin` vb. muhafızlar;
  `src-tauri/src/rbac.rs` + komut modülleri). Arayüzdeki gizleme yalnız
  kullanılabilirlik içindir, güvenlik sınırı değildir.
- **Nöbetçi test:** `src-tauri/tests/rbac_coverage.rs` tüm Tauri komutlarını
  tarar — muhafızsız yeni bir komut eklendiğinde test kırılır. (Bu mekanizma
  geliştirme sırasında fiilen hata yakalamıştır.)
- Oturum, hareketsizlikte **kilit ekranına** düşer (uyarı + süre uzatma;
  kilitten kullanıcı değiştirme mümkündür).

## 3. Uygulama yüzeyi (webview)

- **Sıkı CSP:** `default-src 'self'`; ağ bağlantısı yalnız Tauri IPC
  (`src-tauri/tauri.conf.json`). Uzak kaynak, inline-script gevşetmesi veya
  `wasm-unsafe-eval` yoktur — eski nesildeki AI-tarayıcıda istisnaları,
  AI'nın Rust'a taşınmasıyla ortadan kalktı.
- Kullanıcıya görünen metinler React/JSX kaçışından geçer; markdown içerik
  arındırılarak çizilir.

## 4. Ağ yüzeyi

- **Telemetri yok, bulut yok, oto-güncelleme kanalı yok.** Çalışma anında
  dışarı giden tek isteğe bağlı bağlantı, **yerel** Ollama sunucusudur
  (varsayılan `localhost`; AI özellikleri kapalıysa o da yok).
- Kurulum sırasında setup.exe, eksikse WebView2 Runtime'ı Microsoft'tan
  indirebilir (çevrimdışı kurulum yolu rehberlerde).

### Yerel ağ paylaşımı (opsiyonel, varsayılan KAPALI)

- Sunucu yalnız admin başlatınca çalışır; `0.0.0.0:<port>`'a bağlanır.
- `/ping` dışındaki **bütün** uçlar **8 haneli CSPRNG kodu** ister; kod
  sabit-zamanlı karşılaştırılır; IP başına deneme kilidi ve istek hız sınırı
  vardır. — `crates/archivist-server/`
- Kod bir hesap değil, **paylaşılan ofis anahtarıdır**: kodu bilen istemci
  arşiv içeriğini (salt-okunur yetki matrisine göre) görür. Yalnız güvenilen
  cihazlarla paylaşın.
- Taşıma **düz HTTP'dir** (TLS yok): güvenilen LAN'da ya da WireGuard/Tailscale
  benzeri bir tünel üzerinden kullanın. Ayrıntı: LAN erişim modeli belgesi.

## 5. Denetim izi

- Yıkıcı ve yönetimsel eylemler **Denetim Günlüğü**'ne yazılır
  (kim · ne zaman · hangi eylem · hedef · detay); arayüzden salt-okunur.
- Eski sürümden veri aktarımı gibi kritik işlemler ayrıca özet kayıt bırakır.

## 6. Veri-at-rest ve sınırlar (dürüst bölüm)

- Arşiv veritabanı **şifreli değildir**: dosya sistemine erişebilen biri
  içeriği okuyabilir. Tehdit modeliniz fiziksel erişimi içeriyorsa disk
  şifrelemesi (BitLocker) kullanın. Parola özetleri (argon2id) bu durumda da
  düz metne çevrilemez.
- Kurulum paketleri **kod imzasızdır** → SmartScreen uyarısı. Bütünlük için
  her release'te **SHA-256** yayımlanır; kurumsal dağıtımda doğrulayın.
- 2FA yoktur (tek-makine/ofis-içi tehdit modeli).

## 7. Güvenlik açığı bildirimi

Lütfen [SECURITY.md](../SECURITY.md) üzerinden (GitHub Security Advisory)
sorumlu bildirim yapın.

# ArchivistPro vs Piyasa Liderleri — UI/UX Tasarım Karşılaştırması

> **Analiz tarihi:** 2 Mayıs 2026 · **Versiyon:** 2.4.1 · **Kaynak:** index.css (677 satır), 96 bileşen, themeService.ts, data.ts + güncel kod tabanı

## Referans Platformlar

| Segment | UI Referansı |
|---|---|
| Doğrudan rakip (AEC DAM) | **OpenAsset**, **Autodesk Vault**, **BIM 360 Docs** |
| Genel DAM / Asset browser | **Adobe Bridge**, **Eagle**, **Bynder**, **Canto** |
| Modern masaüstü uygulama standardı | **Figma**, **Linear**, **Notion**, **Arc Browser** |

---

## 1. GÖRSEL DİL VE TASARIM SİSTEMİ

### Piyasa Liderleri

**Figma / Linear / Arc** (altın standart):
- Tam tokenize edilmiş tasarım sistemi (spacing, color, type, elevation)
- Figma'da kendi tasarım sistemi belgelenmiş ve dışa açık
- Her token semantik isimlendirmeli (`--color-surface-elevated`, `--color-text-subtle`)
- Tutarlı 4px grid, 8pt spacing scale

**Adobe Bridge**:
- Adobe Spectrum Design System üstüne kurulu
- Tutarlı ama eski (2018-era component kütüphanesi)
- Koyu tema varsayılan, ama "yaşlı" hissettiriyor

**Eagle**:
- Modern, temiz, minimal
- Figma/Linear'a yakın görsel kalite ama daha az derinlik

**Bynder / OpenAsset**:
- SaaS standardı — temiz ama "jenerik" (Material Design veya Bootstrap türevi)
- Kişiliksiz, kurumsal

### ArchivistPro

**Token Sistemi (40+ CSS custom property)**:
```
Arka plan: 6 katman (primary → secondary → tertiary → card → glass → modal)
Metin: 3 kademe (primary → secondary → muted)
Border: 2 kademe (normal → hover) + modal özel (alt + üst ayrı)
Accent: 3 kademe (main → hover → glow) + secondary accent
Semantik: 3 renk (success → warning → danger)
Radius: 4 kademe (8px → 12px → 20px → 32px)
Transition: 3 hız (120ms → 240ms → 450ms)
Shadow: glow + modal (3 katmanlı)
```

**Glassmorphism**:
- `backdrop-filter: blur(16px) saturate(1.4)` — stat kartları, glass-card bileşeni
- Modal backdrop: `blur(6px)` + `rgba(0,0,0,0.6)`
- Kart hover: `translateY(-3px)` + accent glow

**4 Accent Renk Şeması**: Indigo (varsayılan), Amber, Lime, Teal — her biri dark/light varyantlarıyla

| Kriter | Figma/Linear | Bridge | Eagle | Bynder | **ArchivistPro** |
|---|---|---|---|---|---|
| Token sayısı | 100+ | 60+ | 30+ | 40+ | **40+** |
| Semantik isimlendirme | ✓✓✓ | ✓✓ | ✓ | ✓✓ | ✓✓ |
| Dark/Light tema | ✓ | ✓ | ✓ | Yok (sadece light) | **✓** |
| Accent renk seçimi | Yok | Yok | Yok | Yok | **✓ (4 seçenek)** |
| Glassmorphism | Kısmi | Yok | Yok | Yok | **✓ (blur+saturate)** |
| Görsel kişilik | Çok güçlü | Orta | İyi | Zayıf (jenerik) | **İyi** (koyu+cam+gradient) |

**Verdikt**: ArchivistPro'nun görsel dili Bynder/OpenAsset'ten belirgin şekilde üstün, Eagle seviyesinde, Figma/Linear'ın bir kademe altında. Glassmorphism + gradient accent + koyu tema kombinasyonu sektörde nadir — çoğu DAM "beyaz SaaS" görünümünde. ArchivistPro'nun belirgin bir görsel kişiliği var. Zayıf nokta: Token isimlendirmesi biraz genel (`--color-bg-primary` vs Figma'nın `--color-surface-default/elevated/sunken` gibi daha semantik yaklaşımı).

---

## 2. LAYOUT MİMARİSİ

### Piyasa Liderleri

**Adobe Bridge**:
- 4+ panel: Folder tree (sol) + content browser (merkez) + preview (sağ) + metadata (alt)
- Panel boyutları sürüklenebilir divider ile ayarlanabilir
- Workspace preset'leri (Essentials, Filmstrip, Metadata, etc.)
- Her panel bağımsız olarak gizlenebilir/gösterilebilir

**Figma**:
- Sol: Layer tree (değişken genişlik)
- Merkez: Canvas (sonsuz)
- Sağ: Properties panel (sabit 240px)
- Üst: Toolbar
- Panel genişlikleri sürüklenebilir

**Eagle**:
- Sol: Klasör/koleksiyon ağacı (değişken)
- Merkez: Thumbnail grid (auto-fill)
- Sağ: Inspector panel (sabit)
- Basit, temiz, 3 panel

### ArchivistPro

```
┌─ TopBar (56px) ──────────────────────────────────────────┐
├─ Sidebar (260px sabit) ─┬─ MainView (flex:1) ─┬─ Detail (360px sabit) ─┤
│  Arama                  │  ExplorerView        │  Önizleme              │
│  Facet filtreleri       │  (VirtuosoGrid)      │  Metadata              │
│  Kaynak klasörler       │  veya DashboardView  │  Etiketler             │
│  Alt-klasör ağacı       │  veya TechnicalView  │  İlişkiler             │
│  Embedding durumu       │  veya FoldersView    │  Aksiyonlar            │
├─────────────────────────┴──────────────────────┴────────────────────────┤
└─ StatusBar (32px) ──────────────────────────────────────────────────────┘
```

| Kriter | Bridge | Figma | Eagle | **ArchivistPro** |
|---|---|---|---|---|
| Panel sayısı | 4+ | 3 | 3 | **3** (sidebar + content + detail) |
| Sürüklenebilir divider | ✓ | ✓ | ✓ | **✗** (sabit genişlik) |
| Workspace preset | ✓ (6 preset) | Yok | Yok | **✗** |
| Panel gizle/göster | ✓ | ✓ | ✓ | **Kısmen** (detail açılır/kapanır) |
| Görünüm modları | 4 (thumbnail, list, detail, filmstrip) | N/A | 2 (grid, list) | **5** (grid, list, dashboard, teknik, klasör) |
| Status bar | ✓ | ✓ | Yok | **✓** (görev ilerlemesi + bildirim + kullanıcı) |
| Responsive (<900px) | Yok (masaüstü only) | Kısmen | Yok | **✓** (sidebar slide, full-screen detail) |

**Verdikt**: Layout yapısı sağlam ve modern. 5 görünüm modu (grid, list, dashboard, teknik tablo, klasör ağacı) çoğu rakipten zengin. **Ama en büyük eksik: sürüklenebilir panel divider'ı yok.** Bridge'de kullanıcı sidebar'ı 200px'e daraltıp preview'a daha fazla alan verebilir. ArchivistPro'da sidebar 260px, detail panel 360px — sabit. Bu, özellikle 1080p ekranlarda içerik alanını sıkıştırıyor. Workspace preset'leri de yok — Bridge'in "Filmstrip", "Metadata" gibi hazır layout'ları kullanıcıların iş akışına göre optimize edilmiş.

---

## 3. TİPOGRAFİ VE OKUNABİLİRLİK

### Piyasa Liderleri

**Figma / Linear**: Inter font, çok katmanlı tip ölçeği, tutarlı line-height sistemi
**Adobe Bridge**: Adobe Clean (proprietary), sıkışık ama okunabilir
**Eagle**: System font, basit ama temiz

### ArchivistPro

**Font**: Inter Variable (woff2, yerel yükleme, font-display: swap)
**Tip ölçeği** (13 kademe):
```
0.62rem — Badge/etiket (tiny)
0.65rem — Küçük gösterge
0.68rem — Section başlık (uppercase + letter-spacing)
0.70rem — Küçük etiket
0.72rem — Facet sayıları, tablo başlık
0.78rem — Gövde metin, diyalog
0.82rem — Birincil gövde, buton, kart başlık
0.88rem — Diyalog başlık
0.90rem — Arama input
0.92rem — Markdown H2
1.10rem — Logo, Markdown H1
1.30rem — Login başlık
1.80rem — Dashboard stat değeri
```

**Font ağırlıkları**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold — sadece logo)

| Kriter | Figma | Bridge | Eagle | **ArchivistPro** |
|---|---|---|---|---|
| Font kalitesi | Inter (✓✓✓) | Adobe Clean (✓✓) | System (✓) | **Inter Variable (✓✓✓)** |
| Tip ölçeği kademeleri | ~8 | ~6 | ~5 | **13** |
| Letter-spacing kullanımı | ✓ | ✓ | Sınırlı | **✓** (uppercase başlıklarda 0.06-0.08em) |
| Line-height tutarlılığı | ✓✓✓ | ✓✓ | ✓ | **✓✓** |

**Verdikt**: Inter Variable font seçimi mükemmel — sektör standardı, çok dilli desteği güçlü (Türkçe/Arapça/Çince/Japonca). 13 kademeli tip ölçeği zengin ama biraz fazla granüler — 0.62, 0.65, 0.68, 0.70 arasındaki farklar çıplak gözle neredeyse ayırt edilemez. Figma/Linear genellikle 6-8 kademe kullanır ve her kademe arasında net bir hiyerarşi farkı vardır.

---

## 4. RENK SİSTEMİ VE ANLAM

### ArchivistPro'nun Dosya Tipi Renk Haritası

```
Kırmızı tonları    → DWG, DWF, PDF, MP4 (dikkat çekici, "ana iş" dosyaları)
Mavi tonları       → RVT, NWD, IFC (BIM)
Mor tonları        → MAX, SKP, SAP2000 (3D modeller)
İndigo             → OBJ, FBX, GLB, STL (interchange formatları)
Yeşil              → PSD, PNG, XLS (görsel + veri)
Amber/Sarı         → JPEG, TGA, TIFF (fotoğraf/texture)
Turuncu            → PPT (sunum)
Cyan               → E57 (nokta bulutu)
Gri                → TXT, CSV, RTF (düz metin)
```

Bu renk haritası mimarlık iş akışına özgü ve sektörde benzeri yok. Rakiplerin hiçbiri dosya tiplerini bu granülerliklte renk kodlamıyor.

### Semantik Renk Kullanımı

| Renk | Anlam | Kullanım |
|---|---|---|
| `#10b981` Yeşil | Başarı, tamam | Toast, onay badge, fixity ok |
| `#f59e0b` Amber | Uyarı, dikkat | Eski dosya, session uyarısı |
| `#f43f5e` Kırmızı | Tehlike, hata | Silme, hata toast, eksik dosya |
| `#6366f1` İndigo | Birincil aksiyon | Butonlar, focus, accent |
| `#a855f7` Mor | İkincil aksiyon | Gradient uç, versiyon badge |
| `#60a5fa` Açık mavi | Bilgi | Versiyon güncelleme, BIM badge |

**Verdikt**: Renk sistemi iyi düşünülmüş. Dosya tipi renklendirmesi sektörde unique. Semantik renkler tutarlı. Bir eksik: Renk körü erişilebilirliği test edilmemiş — kırmızı/yeşil ayırt edemeyenler için alternatif göstergeler (ikon, desen) yok.

---

## 5. BİLEŞEN KALİTESİ VE TUTARLILIĞI

### Kart Tasarımı (AssetCard)

| Kriter | Bridge | Eagle | Bynder | **ArchivistPro** |
|---|---|---|---|---|
| Thumbnail oran | Değişken | Kare | Kare | **4:3** (mimari çizimlere uygun) |
| Hover efekti | Highlight | Gölge | Yok | **translateY(-3px) + glow + border** |
| Seçim göstergesi | Mavi çerçeve | Checkbox | Checkbox | **Checkbox + accent border + glow** |
| Dosya tipi badge | Yok | Uzantı metni | Yok | **Renkli badge (sağ üst)** |
| Favori göstergesi | ✓ (yıldız) | ✓ (yıldız) | Yok | **✓ (altın yıldız, blur backdrop)** |
| Durum badge | Yok | Yok | Yok | **✓ (eksik/eski/versiyon — renk kodlu)** |
| Renk paleti önizleme | Yok | Yok | Yok | **✓ (4 swatch, fallback olarak)** |
| Versiyon etiketi | Yok | Yok | Sınırlı | **✓ (mor pill badge)** |
| Kademeli animasyon | Yok | Yok | Yok | **✓ (index*30ms, max 200ms)** |

**Verdikt**: Kart tasarımı rakiplerin hepsinden bilgi yoğun ve görsel olarak zengin. 4:3 oran mimari çizimler için doğru seçim (kare oran DWG/PDF'leri kesiyor). Hover efekti (lift + glow) premium hissettiriyor. Potansiyel risk: Çok fazla bilgi katmanı (badge + favori + durum + tip + etiket + renk paleti) küçük kartlarda görsel gürültüye dönüşebilir.

### Modal Tasarımı

| Kriter | Figma | Linear | **ArchivistPro** |
|---|---|---|---|
| Backdrop | Blur + karartma | Karartma | **Blur(6px) + rgba(0,0,0,0.6)** |
| Modal gölge | 2 katman | 1 katman | **3 katman** (accent ring + mid glow + deep shadow) |
| Üst kenarlık vurgusu | Yok | Yok | **✓** (border-top daha parlak — derinlik hissi) |
| Radius | 12px | 16px | **20px** |
| Kapatma | X + Escape | X + Escape | **X + Escape** |
| İç navigasyon | Tab | Yok | **Sol tab bar** (Ayarlar) veya **scroll bölümler** |

**Verdikt**: Modal tasarımı rakiplerin üstünde. 3 katmanlı gölge sistemi + blur backdrop + üst kenarlık vurgusu Figma-kalite bir derinlik hissi yaratıyor.

### Buton Varyantları

```
Primary:  Gradient (accent → accent-secondary), beyaz metin, hover'da lift
Ghost:    Şeffaf + border, hover'da tertiary bg
Danger:   Kırmızı metin, kırmızı hover
Disabled: opacity 0.6, cursor not-allowed
```

**Verdikt**: İki ana buton varyantı yeterli ve tutarlı. Gradient primary buton premium hissi destekliyor. Eksik: Bir "secondary" buton varyantı yok — bazı yerlerde ghost, bazı yerlerde primary arası bir tercih gerekiyor.

---

## 6. ANİMASYON VE MİKRO-ETKİLEŞİMLER

### Piyasa Liderleri

**Figma**: Her etkileşimde anlamlı animasyon (panel geçişleri, canvas zoom, selection morph)
**Linear**: Sayfa geçişlerinde spring animasyonları, liste öğelerinde stagger
**Arc Browser**: Tab switching'de fluid geçişler

### ArchivistPro

**Animasyon Envanteri**:
| Animasyon | Süre | Kullanım |
|---|---|---|
| `fadeIn` | 350ms ease-out | Kart girişi (translateY 8px→0) |
| `slideInRight` | 300ms ease-out | Panel girişi (translateX 20px→0) |
| `fadeInUp` | 200ms ease | Toast girişi (translateY 12px→0) |
| `pulse-glow` | Sürekli | Aktif tarama göstergesi |
| `spin` | 800ms linear ∞ | Loading spinner |
| Kart stagger | index*30ms (max 200ms) | Grid yükleme |
| Hover lift | 240ms cubic-bezier | Kart hover (translateY -3px) |
| Sidebar slide | 240ms cubic-bezier | Mobilde sidebar açılma |

**Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` — Material Design standardı, doğal hissettiren yavaşlama eğrisi.

| Kriter | Figma | Linear | Eagle | **ArchivistPro** |
|---|---|---|---|---|
| Animasyon çeşitliliği | ✓✓✓ | ✓✓✓ | ✓ | **✓✓** |
| Spring physics | ✓ | ✓ | Yok | **Yok** |
| Stagger animasyonu | ✓ | ✓ | Yok | **✓** (kart girişi) |
| Hover mikro-etkileşim | ✓ | ✓ | ✓ | **✓** (lift + glow) |
| Sayfa geçiş animasyonu | ✓ | ✓ | Yok | **Yok** |
| Loading skeleton | ✓ | ✓ | Yok | **Yok** (spinner var, skeleton yok) |

**Verdikt**: Animasyonlar var ve kaliteli — özellikle kart stagger ve hover lift premium hissettiriyor. Ama: Spring physics yok (Figma/Linear'ın "canlı" hissinin kaynağı), sayfa/görünüm geçişlerinde animasyon yok (grid → dashboard → teknik tablo arası geçiş anlık), loading skeleton yok (içerik yüklenirken boş alan + spinner görünüyor, skeleton shimmer olsa daha profesyonel olur).

---

## 7. BİLGİ YOĞUNLUĞU VE VERİ GÖRSELLEŞTİRME

### Dashboard

| Kriter | Bynder | OpenAsset | **ArchivistPro** |
|---|---|---|---|
| Widget sayısı | 4-6 | 3-4 | **8** |
| Grafik kütüphanesi | Recharts/D3 | Chart.js | **Saf CSS/HTML** (kütüphane yok) |
| Etkileşimli grafikler | ✓ (hover tooltip, drill-down) | Sınırlı | **Sınırlı** (tıklama filtre, hover yok) |
| Gerçek zamanlı güncelleme | ✓ | Yok | **Kısmen** (store değişiminde) |

**ArchivistPro Dashboard Widget'ları**:
1. Toplam istatistik kartları (5 adet, glass-card + stagger animasyon)
2. Kategori dağılımı (gradient progress bar)
3. Dosya formatları (badge grid)
4. Mimari stiller (gradient blok grafik)
5. Boyut dağılımı (yatay bar)
6. Aylık büyüme (dikey bar chart, 12 ay)
7. Onay kuyruğu (admin-only, scrollable liste)
8. Admin aktivite paneli

**Verdikt**: Widget çeşitliliği iyi. Saf CSS ile grafik yapılması performans açısından avantaj (kütüphane bağımlılığı yok). Ama: Hover tooltip yok (bar'ın üstüne gelince değeri görmek mümkün değil), drill-down yok (grafiğe tıklayınca detaya inemiyorsun), animasyonlu geçiş yok (bar'lar sadece statik render ediliyor). Bynder/Canto gibi analitik odaklı DAM'lar bu noktada çok önde.

---

## 8. ERİŞİLEBİLİRLİK

| Kriter | Figma | Bridge | Bynder | **ArchivistPro** |
|---|---|---|---|---|
| WCAG seviyesi | AA | AA | AA | **Hedef yok** (ama çoğu AA) |
| Focus ring | ✓ (2px) | ✓ | ✓ | **✓ (2px + 4px glow halo)** |
| ARIA etiketleri | ✓✓✓ | ✓✓ | ✓✓ | **✓✓** (role, aria-label, aria-live, aria-modal) |
| Klavye navigasyonu | ✓✓✓ | ✓✓ | ✓✓ | **✓✓** (tab, escape, enter + onboarding ok tuşları) |
| Ekran okuyucu | ✓✓✓ | ✓✓ | ✓✓ | **✓** (aria-live polite, role alert) |
| RTL desteği | Kısmen | Yok | Yok | **✓** (Arapça → document.dir="rtl") |
| Renk körlüğü | ✓ | Kısmen | Kısmen | **✗** (test edilmemiş) |
| Yüksek kontrast mod | ✓ | ✓ | Yok | **✗** |

**Verdikt**: Erişilebilirlik "iyi ama hedefsiz". ARIA kullanımı var, focus ring'ler güçlü (glow halo ekstra dokunuş), RTL desteği rakiplerin çoğundan ileride. Ama WCAG seviyesi hedeflenmemiş, renk körlüğü test edilmemiş, yüksek kontrast mod yok.

---

## 9. BOŞ DURUMLAR VE HATA DURUMLARI

### Piyasa Liderleri

**Linear**: Her boş durumda özel illüstrasyon + "Get started" CTA + bağlamsal açıklama
**Figma**: Boş canvas'ta "Press F for frame" gibi akıllı ipuçları
**Eagle**: Minimal ama net boş durum mesajları

### ArchivistPro

**Boş durum**: Büyük ikon (%30 opacity) + başlık (0.92rem) + açıklama (0.82rem) + CTA butonu
**Sonuç yok**: Aynı yapı + "Filtreleri temizle" butonu
**Hata durumu**: ErrorBoundary → kullanıcı dostu mesaj + "Yeniden Yükle" / "Devam Et"

| Kriter | Linear | Figma | **ArchivistPro** |
|---|---|---|---|
| Özel illüstrasyon | ✓ | ✓ | **✗** (sadece ikon) |
| Bağlamsal CTA | ✓ | ✓ | **✓** (filtre temizle, tarama başlat) |
| Hata kurtarma seçenekleri | ✓✓ | ✓ | **✓** (reload + devam et) |
| Lokalize hata mesajları | ✓ | ✓ | **✓** (errorMapper + 5 dil) |

**Verdikt**: Boş durumlar fonksiyonel ama ilham verici değil. Linear/Figma gibi özel illüstrasyonlar kullanıcıya "burası boş ama sorun değil, şöyle başla" hissi veriyor. ArchivistPro'da soluk bir ikon + metin var — işini görüyor ama duygusal bağ kurmuyorsun.

---

## 10. ONBOARDING VE KEŞFEDİLEBİLİRLİK

### Piyasa Liderleri

**Figma**: İlk açılışta interaktif tutorial (dosya oluştur → çerçeve çiz → paylaş)
**Linear**: Boş workspace'de bağlamsal ipuçları + video
**Notion**: Template gallery ile "buradan başla"

### ArchivistPro

**OnboardingTour** (7 adım):
- Spotlight efekti (9999px box-shadow cutout + blur 4px backdrop)
- Popover: max-width 360px, 3 katmanlı gölge, gradient ikon
- Step indicator: Dolum animasyonlu nokta dizisi (current: 20px genişlik, accent)
- Navigasyon: Ok tuşları + Enter + Escape
- Kayıt: `onboarding_completed` flag, bir kez gösterilir

| Kriter | Figma | Linear | **ArchivistPro** |
|---|---|---|---|
| Spotlight efekti | ✓ | Yok | **✓** (box-shadow cutout + blur) |
| Adım sayısı | 5-7 | 3-4 | **7** |
| Klavye navigasyonu | ✓ | Yok | **✓** (ok, enter, escape) |
| Tekrar erişim | Yok | Yok | **Yok** (sadece Ayarlar'dan sıfırlama) |
| Bağlamsal ipuçları | ✓✓ | ✓✓ | **✗** (tooltip yok, sadece tur) |

**Verdikt**: OnboardingTour teknik olarak iyi (spotlight + klavye + step indicator). Ama: Tur bittikten sonra keşfedilebilirlik düşüyor — bağlamsal tooltip'ler yok. Örneğin kullanıcı ilk kez sağ tıkladığında "Sağ tıklayarak hızlı işlemler yapabilirsiniz" gibi bir ipucu çıkmıyor. Figma/Linear bu "progressive disclosure" konusunda çok güçlü.

---

## 11. GÖRSEL CİLALAMA VE DETAY

### ArchivistPro'nun Premium Hissettiren Detayları

1. **3 katmanlı modal gölgesi** — accent ring + mid glow + deep shadow → derinlik hissi
2. **Kart hover lift** — translateY(-3px) + glow → "havaya kalkıyor" hissi
3. **Gradient butonlar** — accent → accent-secondary (135° açı) → premium
4. **Glass-card blur+saturate** — yarı saydam yüzeyler → katmanlılık
5. **Custom scrollbar** — 4px, yuvarlak, hover'da renk değişimi → detaycılık
6. **Stagger animasyon** — kartlar 30ms arayla beliriyor → dinamizm
7. **Focus glow halo** — 2px outline + 4px accent glow → erişilebilirlik + estetik
8. **Dosya tipi renk haritası** — 20+ format × özel renk → anında tanıma
9. **Modal üst kenarlık** — alt kenarlardan daha parlak → ışık kaynağı illüzyonu
10. **Inter Variable font** — tek woff2 dosyası, tüm ağırlıklar → performans + kalite

### Eksik Cilalama Detayları

1. **Skeleton loading** yok — içerik yüklenirken boşluk + spinner (shimmer olmalı)
2. **Sayfa geçiş animasyonu** yok — grid ↔ dashboard ↔ tablo arası anlık geçiş
3. **Spring physics** yok — tüm animasyonlar cubic-bezier (spring daha "canlı")
4. **Sürüklenebilir panel** yok — sidebar/detail genişliği sabit
5. **Boş durum illüstrasyonları** yok — sadece soluk ikon
6. **Bağlamsal tooltip** yok — butonların çoğunda hover açıklama eksik
7. **Smooth scroll-to-section** yok — sidebar facet tıklaması anlık

---

## SONUÇ TABLOSU

| UI/UX Ekseni | Bridge | Eagle | Bynder | Vault | Figma/Linear | **ArchivistPro** |
|---|---|---|---|---|---|---|
| **Görsel kişilik** | Orta (yaşlı) | İyi | Zayıf (jenerik) | Zayıf (2008) | En iyi | **İyi** (koyu+cam+gradient) |
| **Tema/özelleştirme** | 4 tema | 1 tema | Yok | Yok | 2 tema | **8 kombinasyon** (2 tema × 4 accent) |
| **Layout esnekliği** | En iyi (divider) | İyi | Orta | Orta | İyi | **Orta** (sabit panel) |
| **Tipografi** | İyi | Orta | İyi | Zayıf | En iyi | **İyi** (Inter Variable) |
| **Renk sistemi** | Orta | Orta | Orta | Zayıf | İyi | **En iyi** (20+ format rengi) |
| **Kart tasarımı** | Orta | İyi | Orta | Zayıf | N/A | **En iyi** (bilgi yoğun, görsel zengin) |
| **Modal kalitesi** | Orta | Orta | Orta | Zayıf | İyi | **İyi** (3 katman gölge) |
| **Animasyon** | Zayıf | Orta | Zayıf | Yok | En iyi | **İyi** (stagger, hover, glow) |
| **Dashboard/veri viz** | Yok | Yok | İyi | Zayıf | N/A | **Orta** (tooltip/drill-down yok) |
| **Erişilebilirlik** | İyi | Orta | İyi | Orta | En iyi | **Orta-İyi** (RTL var, WCAG hedef yok) |
| **Onboarding** | Yok | Yok | Var | Var | İyi | **İyi** (spotlight tur) |
| **Boş durumlar** | Zayıf | Orta | Orta | Zayıf | En iyi | **Orta** (illüstrasyon yok) |
| **Responsive** | Yok | Yok | ✓ (web) | Yok | Kısmen | **✓** (900px + 600px breakpoint) |

---

## BİR CÜMLEDE

**ArchivistPro'nun UI'ı, bir mimarlık ofisi yazılımı için alışılmadık derecede cilalı — glassmorphism, gradient aksentler ve kademeli animasyonlarla rakiplerinin "kurumsal gri" estetiğinden net şekilde ayrılıyor; eksikleri layout esnekliği ve veri görselleştirme etkileşimlerinde.**

---

## EN YÜKSEK GETİRİLİ 5 UI/UX HAMLESİ

1. **Sürüklenebilir panel divider'ları** — Sidebar ve detail panel genişliğini kullanıcı ayarlasın. 1080p ekranlarda içerik alanı sıkışıyor. Tek bir `<ResizablePanel>` bileşeni tüm deneyimi iyileştirir.

2. **Skeleton loading** — Kart grid yüklenirken shimmer efektli iskelet kartlar göster. Spinner yerine skeleton, "yükleniyor" hissini "hazırlanıyor" hissine dönüştürür.

3. **Dashboard grafik etkileşimi** — Bar'lara hover tooltip + tıklama drill-down ekle. "Nisan: 47 dosya" gibi bir tooltip bile deneyimi ciddi iyileştirir.

4. **Bağlamsal tooltip'ler** — İlk kullanımda butonların üstüne bir kez "Bu buton şunu yapar" ipucu çıksın (progressive disclosure). Özellikle topbar'daki ikon-only butonlar için kritik.

5. **Görünüm geçiş animasyonu** — Grid → Dashboard → Teknik tablo arası geçişlerde crossfade (150ms). Anlık geçiş "kırılma" hissi veriyor.

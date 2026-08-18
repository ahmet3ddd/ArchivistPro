//! AI gorsel-betimleme (vision) — H2 `vision.ts` (analyzeDWGContent) sadik portu + OCR (METIN).
//!
//! Thumbnail'i bir Ollama VISION modeline yollayip yapisal METIN betimleme cikartir
//! (cizim turu / aciklama / elemanlar / mekanlar / ozel-terimler / anahtar-kelimeler + gorseldeki
//! okunabilir METIN). Bu metin `ai_*` EAV metadata olarak yazilir → `build_metadata_text` jenerik
//! EAV dongusu metadata chunk'ina koyar → "bulutlu gorsel" gibi GORSEL-icerik sorgusu BIRLESIK
//! metin aramasiyla (FTS + semantik + keyword-gate) bulunur. H2'nin "zengin + isabetli" sirri:
//! gorseli ayri CLIP modu degil, AI-metin-betimle text-retrieval'a gomerek.
//!
//! Bu modul SAF (Ollama'dan bagimsiz): prompt insa + yanit ayristirma. Asil Ollama vision cagrisi
//! `ollama::analyze_image`, orkestrasyon `vision_commands` (Faz 3).

/// Geleneksel mimari & susleme alan terimleri (H2 DOMAIN_SPECIFIC_TERMS sadik portu). AI bu
/// terimleri cizimde arar, eslesenleri ÖZEL_TERİMLER olarak raporlar.
pub(crate) const DOMAIN_SPECIFIC_TERMS: &[&str] = &[
    // Geleneksel susleme & tezyinat
    "şebeke", "revzen", "mukarnas", "kuran", "badem", "yaprak", "fitil", "kazayağı", "püskül",
    "rumi", "hatayi", "palmet", "lotus", "nilüfer", "karanfil", "lale", "şemse", "zencerek",
    "münhani", "tepelik", "ayna", "göbek", "bordür", "köşelik",
    // Mimari elemanlar
    "silme", "pencere", "kapı", "fil gözü", "profil", "vitray", "kemer", "sütun", "başlık",
    "kaide", "niş", "mihrap", "minber", "kubbe", "pandantif", "tromp", "kasnak", "alem", "şerefe",
    "minare", "son cemaat", "revak", "eyvan", "avlu", "şadırvan", "çeşme", "sebil", "türbe",
    "külliye",
    // Yapi ve malzeme detaylari
    "taş işçiliği", "ahşap oyma", "çini", "kalem işi", "alçı", "mermer", "traverten", "sedef kakma",
    "kundekari", "geçme", "çatma", "bindirme", "kündekari",
];

/// Bilinen yapi malzemeleri (H2 KNOWN_MATERIALS sadik portu) — MALZEMELER bolumu bu listeye
/// kelepcelenir (model uydurmasin). Eslesme TR-buyuk/kucuk duyarsiz.
pub(crate) const KNOWN_MATERIALS: &[&str] = &[
    "Beton", "Cam", "Metal", "Ahşap", "Taş", "Seramik", "Kompozit", "Tuğla", "Plastik", "Mermer",
    "Alçı", "Kil", "Deri", "Kumaş",
];

/// Pano'da dusuk-kardinaliteli, guvenilir bir dagilim icin modelin secebilecegi kanonik stiller.
/// Serbest metin kabul edilmez; model uydurmalari parser'da elenir.
pub(crate) const KNOWN_ARCHITECTURAL_STYLES: &[&str] = &[
    "Modern", "Çağdaş", "Klasik", "Neoklasik", "Osmanlı", "Selçuklu", "İslami", "Gotik",
    "Barok", "Rokoko", "Art Deco", "Art Nouveau", "Bauhaus", "Brütalist", "Endüstriyel",
    "Minimalist", "Geleneksel", "Yöresel",
];

/// ÇİZİM_TÜRÜ icin modele sunulan secenek menusu. **Tek kaynak**: hem istemi kurar
/// ([`build_vision_prompt`]) hem menu-tekrari tespitini besler ([`echoes_option_menu`]).
/// Ayri yazilsalardi biri degisip digeri bayatlar, tespit sessizce korlesirdi
/// (`prompt_lists_every_drawing_type` testi bunu kilitler).
/// ⚠️ Bu liste YALNIZ teknik cizimlere sorulur (bkz [`IMAGE_CLASSES`]) — `Fotoğraf`/`Render`
/// BILEREK burada DEGIL: onlar bir cizim TURU degil, gorselin MEDYASIdir. (H2 paritesi: H2'nin
/// `buildDWGPrompt` listesi de tam olarak budur; H3 ikisini tek menude birlestirmisti.)
pub(crate) const DRAWING_TYPES: &[&str] = &[
    "Kat Planı",
    "Cephe",
    "Kesit",
    "Detay",
    "Vaziyet Planı",
    "Tesisat",
    "Elektrik",
    "Strüktür",
    "Mobilya Layout",
    "Çatı Planı",
    "Süsleme Detayı",
    "Restorasyon",
    "Diğer",
];


/// Bir alan degeri, istemin SECENEK MENUSUNU geri mi tekrarliyor? (kullanici bulgusu 2026-08-09)
///
/// Olculmus vaka: `qwen2.5vl:3b` — **olculmus-saglikli** model — bir logo gorseline yanit olarak
/// `ÇİZİM_TÜRÜ` alanina *"[Kat Planı / Cephe / Kesit / Detay / Vaziyet Planı / …]"* yazdi, yani
/// kendisine sunulan listeyi kopyaladi. Bu cikti `structured` sayilir ve 2+ alan uretir → eski
/// `is_usable()` onu KABUL ederdi: cop metin DB'ye yazilir, varlik `ai_analyzed` damgasi yiyip
/// KALICI olarak analizli olurdu. Ayni kusur llava'da da olculmustu (2026-08-07).
///
/// Esik **secerek dar**: gercek bir yanit tek tur secer (nadiren iki). `threshold` cagirana
/// birakilir cunku alanlar farklidir — `ANAHTAR_KELIMELER` mesru olarak birkac tur adi icerebilir
/// (or. plan+cephe+kesit tasiyan bir pafta), oysa `ÇİZİM_TÜRÜ`'nde ucu bir arada anlamsizdir.
fn echoes_option_menu(value: &str, threshold: usize) -> bool {
    let v = value.to_lowercase();
    DRAWING_TYPES.iter().filter(|opt| v.contains(&opt.to_lowercase())).count() >= threshold
}

/// Bir thumbnail'in AI analiz sonucu (H2 DWGAnalysisResult + OCR `text` + stil/materials). Bos alanlar atlanir.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct VisionAnalysis {
    pub drawing_type: String,
    pub description: String,
    pub elements: Vec<String>,
    pub spaces: Vec<String>,
    pub domain_terms: Vec<String>,
    pub keywords: Vec<String>,
    /// Goruntuden guvenle secilebilen kanonik mimari stiller.
    pub architectural_styles: Vec<String>,
    /// Yapi malzemeleri (H2 detectMaterials; tek vision cagrisina entegre → ekstra inference yok).
    pub materials: Vec<String>,
    /// Gorselde okunabilir metin/etiket (OCR; H2'de ayri ocr.ts'ti — burada tek gecis).
    pub text: String,
    /// Model istenen ETIKET bicimini gercekten uretti mi (yanitta en az bir bilinen etiket vardi).
    /// `false` → parser hicbir etiket bulamadi, metnin basini aciklama saydi (asagidaki H2
    /// fallback'i). Cop-korumasinin ([`VisionAnalysis::is_usable`]) temel ayrimi budur.
    pub structured: bool,
    /// Model, istemin SECENEK MENUSUNU geri mi yazdi (bkz [`echoes_option_menu`])? Karar **ham**
    /// degerler uzerinde verilir cunku `drawing_type` sonradan kanonik listeye kelepcelenir —
    /// kelepceleme menuyu tek bir ture indirger ve tespiti gorunmez kilardi.
    pub echoed: bool,
}

/// Yazmaya deger sayilmak icin gereken EN AZ dolu alan sayisi. 1 DEGIL: yalniz "ÇİZİM_TÜRÜ: Cephe"
/// donduren bir yanit aramaya kayda deger bir sey katmaz, ama `ai_analyzed` damgasi yiyip varligi
/// KALICI olarak analizli yapar → daha iyi bir modelle tekrar denenemez. 2 alan, gercek bir
/// analizin (tur + aciklama) asgarisi.
pub(crate) const MIN_FILLED_FIELDS: usize = 2;

impl VisionAnalysis {
    /// Bu analiz DB'ye yazmaya deger mi? **Cop-korumasi** (kullanici bulgusu 2026-08-07).
    ///
    /// Yetersiz bir model (olculdu: `moondream` her gorsele `" [0"`, `llava` istemin secenek
    /// menusunu tekrarlayan serbest metin) istenen bicimi hic uretmez. Parser fallback'i bunu
    /// "aciklama" yapar, `set_ai_metadata` ise ustune `ai_analyzed=1` damgasi basar ve metni
    /// `assets_fts.ai` aranabilir govdesine yazar. Sonuc: varlik KALICI olarak analizli sayilir
    /// (bir daha siraya girmez, calisan bir modelle telafi edilemez) + arama sonuclari kirlenir.
    /// Bu yuzden yazim ONCESI elenir; elenen varlik **bekleyen** kalir → resumable.
    pub(crate) fn is_usable(&self) -> bool {
        // Etiketsiz yanit = model bicimi hic anlamadi (fallback dali) → serbest metni analiz sayma.
        if !self.structured || self.to_eav().len() < MIN_FILLED_FIELDS {
            return false;
        }
        // **MENU-TEKRARI** (2026-08-09): bicimi tutturan ama istemin secenek listesini geri
        // kopyalayan yanit. `structured` ve alan sayisi olcutlerini GECER — bicime bakan bir esik
        // icerigi goremez. Karar ayristirma aninda HAM degerlerden verilir (bkz [`Self::echoed`]).
        !self.echoed
    }
}

/// Ham Ollama/HTTP hata metnini KARARLI bir sinif koduna indirger; frontend bunu i18n ile tek
/// cumleye cevirir. Gerekce (kullanici bulgusu 2026-08-07): ekranda
/// `status 500: {"error":"llama-server process has terminated: exit status 0xc0000409: The system
/// detected an overrun of a stack-based buffer... CUDA error"}` gibi ham govde cikiyordu — hem
/// anlasilmaz hem (Windows'un guvenlik metni yuzunden) gereksiz korkutucu. Ham metin KAYBOLMAZ:
/// rapordaki `sample_error` detay olarak tasimaya devam eder.
pub(crate) fn classify_vision_error(err: &str) -> &'static str {
    let e = err.to_ascii_lowercase();
    // GPU/surucu uyumsuzlugu — llama-server cokmesi (PTX/CUDA/0xc0000409). Cozum: surucu guncelle.
    if e.contains("cuda") || e.contains("ptx") || e.contains("0xc0000409") || e.contains("rocm") {
        "gpu_driver"
    // Ollama hic ayakta degil (baglanti REDDEDILDI — 10061/refused): "baslat" onerilir.
    } else if e.contains("10061") || e.contains("connection refused") || e.contains("baglanilamadi")
    {
        "ollama_down"
    // Model yanit veremeyecek kadar yavas: baglanti kuruldu ama sure doldu (10060 / status line).
    } else if e.contains("10060") || e.contains("status line") || e.contains("timed out") {
        "timeout"
    } else if is_context_overflow_text(&e) {
        "context_overflow"
    } else if e.contains("status 404") || e.contains("not found") {
        "model_missing"
    } else if e.contains("out of memory") || e.contains("insufficient memory") {
        "out_of_memory"
    } else if is_stream_aborted_text(&e) {
        "stream_aborted"
    } else {
        "other"
    }
}

/// Model calistiricisi yaniti YARIDA kesti mi (`done:true` gelmeden akis bitti)?
///
/// GECICI bir hatadir — ayni gorsel kucultulunce ya da baska modelle sorunsuz analiz edilir
/// (olculdu 2026-08-18: qwen2.5vl:3b bir fotografta 768px'te 10/10 dusuyor, 384px'te 0/6).
/// Bu yuzden varlik KALICI "denendi, sonuc alinamadi" damgasi ALMAZ; cagiran yeniden dener.
pub(crate) fn is_stream_aborted_text(lowercased: &str) -> bool {
    lowercased.contains("stream_aborted")
}

/// Baglam-penceresi asimi metni mi (siniflandirici + `vision_commands` lean-retry tetigi ayni
/// olcutu paylassin diye tek yerde).
pub(crate) fn is_context_overflow_text(lowercased: &str) -> bool {
    lowercased.contains("exceed_context_size")
        || lowercased.contains("context size")
        || lowercased.contains("context length")
}

/// [`VisionAnalysis::to_eav`]'in uretebilecegi TUM `ai_*` anahtarlari — analiz ICERIGI olanlar.
///
/// Kayit-tutma alanlari (`ai_analyzed`, `ai_analyzed_at`, `ai_model`) ve `ai_gorsel_turu` (betim
/// analizinden DEGIL, deterministik `image_kind` heuristiginden gelir) BU LISTEDE YOKTUR.
///
/// Kullanim: gecmiste yazilmis bir analizin, bugunku [`VisionAnalysis::is_usable`] esigini gecip
/// gecemeyecegini DB'de geriye donuk olcmek (`unusable_analysis_ids`) — o kayitlarda artik
/// `structured` bayragi yok, elimizde yalnizca YAZILMIS alan sayisi var.
/// `to_eav_keys_match_this_list` testi listeyi `to_eav` ile kilitler (drift olmaz).
pub(crate) const VISION_EAV_KEYS: &[&str] = &[
    "ai_cizim_turu",
    "ai_aciklama",
    "ai_elemanlar",
    "ai_mekanlar",
    "ai_ozel_terimler",
    "ai_anahtar_kelimeler",
    "ai_mimari_stiller",
    "ai_malzemeler",
    "ai_metin",
];

impl VisionAnalysis {
    /// `ai_*` EAV alanlari (anahtar, deger) — yalniz DOLU olanlar. `set_ai_metadata` bunu yazar;
    /// `build_metadata_text` jenerik EAV dongusu "AI_ACIKLAMA: ..." olarak metadata chunk'ina koyar.
    pub(crate) fn to_eav(&self) -> Vec<(&'static str, String)> {
        let mut out: Vec<(&'static str, String)> = Vec::new();
        let join = |v: &[String]| v.join(", ");
        if !self.drawing_type.is_empty() {
            out.push(("ai_cizim_turu", self.drawing_type.clone()));
        }
        if !self.description.is_empty() {
            out.push(("ai_aciklama", self.description.clone()));
        }
        if !self.elements.is_empty() {
            out.push(("ai_elemanlar", join(&self.elements)));
        }
        if !self.spaces.is_empty() {
            out.push(("ai_mekanlar", join(&self.spaces)));
        }
        if !self.domain_terms.is_empty() {
            out.push(("ai_ozel_terimler", join(&self.domain_terms)));
        }
        if !self.keywords.is_empty() {
            out.push(("ai_anahtar_kelimeler", join(&self.keywords)));
        }
        if !self.architectural_styles.is_empty() {
            out.push(("ai_mimari_stiller", join(&self.architectural_styles)));
        }
        if !self.materials.is_empty() {
            out.push(("ai_malzemeler", join(&self.materials)));
        }
        if !self.text.is_empty() {
            out.push(("ai_metin", self.text.clone()));
        }
        out
    }
}

/// Vision prompt'u (H2 buildDWGPrompt sadik portu + METIN/OCR bolumu). `binary_context`: dosyadan
/// cikarilmis teknik metadata (layer/blok/metin/baslik...) — varsa AI'a baglam olarak verilir
/// (H2 paritesi: daha isabetli analiz). Cizim DEGIL fotograf/render de kapsanir.
/// `ask_drawing_type`: `ÇİZİM_TÜRÜ` alani SORULSUN mu — **dosya turune gore** karar verilir
/// ([`asks_drawing_type`]), modele DEGIL. Bkz o fonksiyonun olcum gerekcesi.
pub(crate) fn build_vision_prompt(binary_context: Option<&str>, ask_drawing_type: bool) -> String {
    // Menu, tespitle AYNI kaynaktan kurulur → istem degisirse tespit de birlikte degisir.
    let spec = ask_drawing_type.then(|| drawing_type_spec(DRAWING_TYPES));
    build_vision_prompt_with(binary_context, spec.as_deref())
}

/// CAD uzantilari — `ÇİZİM_TÜRÜ` YALNIZ bunlara sorulur.
const CAD_EXT: &[&str] = &["dwg", "dxf"];

/// CAD dalinin acilis cumlesi — dosya turu ZATEN kesin oldugu icin iddiali olmasi dogru.
const CAD_LEAD: &str = "Bu bir teknik mimari/mühendislik çiziminin (DWG/CAD) önizlemesidir.";

/// Raster dalinin acilis cumlesi — **UYDURMA BETIM** karsi tedbiri (bulgu 2026-08-10).
///
/// Eski hali *"Bu bir mimari görsel … olabilir"* idi ve istemin devaminda "her alanı olabildiğince
/// DETAYLI DOLDUR, yüzeysel geçme" yaziyordu. Ikisi birlesince model, mimari OLMAYAN dosyada da
/// (olculdu: Carrera mermer DOKUSU) olmayan bir bina anlatiyordu — *"tarihi yapı… kubbe… avlu…
/// koridor"*. Bu metin `assets_fts.ai` aranabilir govdesine yazildigi icin arama sonuclarini
/// kirletir. Acilis artik icerik hakkinda **iddiada bulunmaz** ve "mimari degilse oldugu gibi
/// soyle" iznini ACIKCA verir.
///
/// **UC TUR OLCULDU (2026-08-10), ISTEM BU SORUNU COZMUYOR** — asagidaki metin en az zararli
/// olani, tam cozum DEGIL. Mermer dokusuna verilen cevaplar:
///   · ozgun ("Bu bir mimari görsel… olabilir") → *"tarihi yapı, kemerler, vitraylar, minare"*
///   · **bu metin (tarafsiz)** → *"kesin bir analiz yapamıyorum"* — mimari uydurma DURDU
///   · tarafsiz + *"'Analiz edemiyorum' DEME"* → model tam olarak *"Analiz edemiyorum."* yazdi
///     (isteme konulan ifade, uretilen ifadeye donusuyor — menu deneyindeki hatanin aynisi)
///   · tamamen olumlu ("ne varsa yaz…") → *"orman, göl, çimen"* — kurgu degisti, uydurma bitmedi
/// Gercek cami render'i UC turde de dogru betimlendi → model gercek mimariyi GORUYOR; goremedigi
/// sey duz bir mermer deseninin NE OLDUGU. 3B model bu soyut goruntude her seferinde hikaye anlatir.
///
/// Bu metin secildi cunku uydurmayi **mimari kelimelere** (yapı/kemer/minare — mimarin aradigi tam
/// o kelimeler) akmaktan alikoyar; gercek mimaride olculmus kayip YOK. Asil cozum **kapsam secimi**
/// (kullanici karari 2026-08-10): mimari olmayan dosya zaten analiz edilmemeli.
///
/// `ARSIV_VISION_RASTER_LEAD` ile degistirilebilir — A/B olcumu uretim kodunu degistirmeden
/// kosulabilsin diye (`fabrication_prompt_experiment`).
fn raster_lead() -> String {
    std::env::var("ARSIV_VISION_RASTER_LEAD").unwrap_or_else(|_| {
        "Bu görselin ne olduğunu ÖNCE sen belirle; mimari bir içerik olduğunu VARSAYMA. \
         Mimari bir yapı/mekan/çizim GÖRMÜYORSAN (ör. malzeme dokusu, kumaş, desen, logo, ikon, \
         ekran görüntüsü, tablo/resim, yazı, arayüz) bunu OLDUĞU GİBİ yaz — görmediğin bir binayı \
         ANLATMA, uydurma. Yapı yoksa yapı anlatma."
            .to_string()
    })
}

/// Bu dosyaya `ÇİZİM_TÜRÜ` sorulmali mi? **H2 paritesi + olcum sonucu (2026-08-10).**
///
/// H2 bu soruyu modele sormazdi; DOSYA TURUNE gore yonlendirirdi (`analyzeDWGThumbnail` yalniz DWG
/// onizlemelerine, sirdan gorsellere `analyzeImage` — orada cizim turu alani HIC yoktu). H3 ikisini
/// birlestirmisti; olculdu ve iki kez basarisiz oldu:
///   1. Tek 15 maddelik menu → model tereddut ettiginde listenin ILK maddesine demirliyor
///      (mermer DOKUSUNA "Kat Planı"; sira ters cevrilince "Render" — yani cevabi ICERIK degil
///      menudeki KONUM belirliyordu).
///   2. Onune "bu nedir" diye ikinci bir menu koymak DAHA KOTU oldu: dort dosyanin dordu de yeni
///      menunun ILK maddesini ("Teknik Çizim") sectiler, ustelik model iki benzer etiketi
///      karistirip uydurma bir `GÖRSEL_TÜR:` yazdi → **gercek DWG turunu KAYBETTI**.
///
/// Sonuc: bu modele menuden sectirmek guvenilir degil. Menu olmayan yerde demirleme de olmaz —
/// raster gorsele alan hic sorulmaz, `ai_cizim_turu` BOS kalir (yanlis dolmaz). Medya turu
/// (fotograf/render/doku) zaten ayri ve LLM'siz bir boyuttur: `ai_gorsel_turu`.
pub(crate) fn asks_drawing_type(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| CAD_EXT.contains(&e.to_ascii_lowercase().as_str()))
}

/// `ÇİZİM_TÜRÜ` satirinin koseli-parantez ICI. Ayri fonksiyon cunku menunun **sirasi ve
/// yonlendirmesi** olculebilir bir degisken: `cizim_turu_menu_order_experiment` ayni uretim
/// istemini farkli menulerle kosturup demirlemenin nedenini olcer (bkz STATUS 2026-08-09).
pub(crate) fn drawing_type_spec(types: &[&str]) -> String {
    types.join(" / ")
}

/// Uretim istemi, `ÇİZİM_TÜRÜ` alan tarifi disaridan verilerek. `build_vision_prompt` bunun
/// kanonik menuyle cagrilmis halidir — yani uretim davranisi tek satirda tanimli kalir.
pub(crate) fn build_vision_prompt_with(binary_context: Option<&str>, types: Option<&str>) -> String {
    let terms = DOMAIN_SPECIFIC_TERMS.join(", ");
    let mats = KNOWN_MATERIALS.join(", ");
    let styles = KNOWN_ARCHITECTURAL_STYLES.join(", ");
    // Alan SORULMUYORSA satir hic yazilmaz — "BOŞ birak" diye rica etmek yetmiyor (olculdu:
    // model kurala ragmen doldurdu). Sormamak, doldurmamasini GARANTI eden tek yol.
    let drawing_line = match types {
        Some(t) => format!("ÇİZİM_TÜRÜ: [{t}]\n"),
        None => String::new(),
    };
    let lead = if types.is_some() { CAD_LEAD.to_string() } else { raster_lead() };
    let ctx = match binary_context {
        Some(c) if !c.trim().is_empty() => format!(
            "\n\nDosyadan doğrudan çıkarılan teknik metadata:\n{}\n\nBu bilgileri görselle birlikte \
             değerlendirerek daha doğru bir analiz yap.",
            c.trim()
        ),
        _ => String::new(),
    };
    format!(
        "{lead}{ctx}\n\n\
         Görseli DİKKATLE ve KAPSAMLI incele. Aşağıdaki bilgileri Türkçe olarak, BU ETİKETLERLE ver; \
         her alanı olabildiğince DETAYLI DOLDUR, yüzeysel geçme — gördüğün ayrıntıları raporla \
         (yalnızca gerçekten görünmeyen/emin olmadığın alanı BOŞ bırak):\n\n\
         {drawing_line}\
         AÇIKLAMA: [İçeriği DETAYLI betimle (4-6 cümle): ne tür yapı/sahne olduğu, üslup/dönem, \
         kompozisyon ve yerleşim, öne çıkan mimari öğeler, malzeme ve doku, renk/atmosfer/ışık, \
         dikkat çeken ayrıntılar. Geleneksel/tarihi bir yapı ise üslubunu belirt.]\n\
         ELEMANLAR: [görünen TÜM mimari/yapısal elemanlar, virgülle: duvar, kolon, kiriş, merdiven, kapı, \
         pencere, mobilya, ölçü, aks, gökyüzü, ağaç, vb.]\n\
         MEKANLAR: [tanımlanabilen mekan/oda tipleri, virgülle: salon, yatak odası, banyo, koridor, vb. \
         Yoksa BOŞ yaz.]\n\
         ÖZEL_TERİMLER: [şu terimlerden görüneni virgülle listele, yoksa BOŞ. Terimler: {terms}]\n\
         ANAHTAR_KELİMELER: [arama için 12-20 anahtar kelime, virgülle. Her önemli kavramın HEM kökünü \
         HEM çekimli/eş anlamlı hallerini yaz (ör. bulut, bulutlu; kubbe, kubbeli; ağaç, ağaçlı, ağaçlık).]\n\
         MİMARİ_STİL: [yalnız açıkça ayırt edilebilen mimari stilleri şu listeden virgülle: {styles}. \
         Emin değilsen BOŞ yaz.]\n\
         MALZEMELER: [görünen yapı malzemeleri, YALNIZ şu listeden virgülle: {mats}. Yoksa BOŞ.]\n\
         METİN: [Görselde okunabilir TÜM yazı/etiket/başlık/ölçü metnini olabildiğince aynen yaz. \
         Tahmin yapma; yoksa BOŞ yaz.]"
    )
}

/// Etiketten sonraki bolum degerini cikar (label'dan sonraki ':' → bir SONRAKI etikete kadar).
/// Regex'siz (H2 regex parser paritesi, manuel). `labels` TUM olasi etiketler (sinir tespiti icin).
fn section(text: &str, label: &str, all_labels: &[&str]) -> Option<String> {
    let pos = text.find(label)?;
    let start = pos + label.len();
    // Bu etiketten SONRA gelen en yakin diger etiket → bolum sonu.
    let mut end = text.len();
    for &other in all_labels {
        if other == label {
            continue;
        }
        if let Some(p) = text[start..].find(other) {
            end = end.min(start + p);
        }
    }
    let raw = text.get(start..end)?.trim();
    let val = raw.strip_prefix(':').unwrap_or(raw).trim();
    Some(val.to_string())
}

/// Virgul/yeni-satirla ayir → temiz dize. "BOŞ"/"YOK"/bos → bos vektor (H2 paritesi).
fn split_list(raw: &str) -> Vec<String> {
    let t = raw.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("BOŞ") || t.eq_ignore_ascii_case("BOS")
        || t.eq_ignore_ascii_case("YOK")
    {
        return Vec::new();
    }
    t.split([',', ';', '\n'])
        .map(|s| s.trim().trim_start_matches('-').trim().to_string())
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("BOŞ") && !s.eq_ignore_ascii_case("YOK"))
        .collect()
}

/// Vision yanitini ayristir (H2 parseDWGAnalysisResponse paritesi). Etiket bulunmazsa o alan bos;
/// hicbiri yoksa metnin basini aciklama yapar (H2 fallback).
pub(crate) fn parse_vision_response(text: &str) -> VisionAnalysis {
    const LABELS: &[&str] = &[
        "ÇİZİM_TÜRÜ",
        "AÇIKLAMA",
        "ELEMANLAR",
        "MEKANLAR",
        "ÖZEL_TERİMLER",
        "ANAHTAR_KELİMELER",
        "MİMARİ_STİL",
        "MALZEMELER",
        "METİN",
    ];
    let get = |label: &str| section(text, label, LABELS).unwrap_or_default();
    // Model istenen bicimi URETTI mi: yanitta bilinen etiketlerden en az biri geciyor mu. Bu bayrak
    // asagidaki "hicbir yapisal alan yok → metnin basini aciklama say" fallback'inden AYIRIR;
    // cop-korumasi (`is_usable`) yalniz bu ayrima guvenerek yazim/damga kararini verir.
    let structured = LABELS.iter().any(|l| text.contains(l));

    // Pano boyutlari kanonik sozluge kelepcelenir (uydurma/kardinalite patlamasi yok).
    let canonical_list = |label: &str, known: &[&str]| -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        split_list(&get(label))
            .into_iter()
            .filter_map(|m| {
                let nm = archivist_db::normalize_tr(&m);
                known
                    .iter()
                    .find(|k| archivist_db::normalize_tr(k) == nm)
                    .map(|k| (*k).to_string())
            })
            .filter(|k| seen.insert(k.clone()))
            .collect()
    };
    let architectural_styles = canonical_list("MİMARİ_STİL", KNOWN_ARCHITECTURAL_STYLES);
    let materials = canonical_list("MALZEMELER", KNOWN_MATERIALS);

    // **MENU-TEKRARI kararini HAM degerler uzerinde ver** — asagida `drawing_type` kanonik listeye
    // kelepcelenecek, yani menuyu tekrarlayan deger tek bir tura indirgenecek. Sirayi ters kursak
    // tespit korlesirdi: "[Kat Planı / Cephe / …]" once "Kat Planı"ya inerdi, sonra hicbir sey
    // anormal gorunmezdi.
    let raw_drawing_type = get("ÇİZİM_TÜRÜ");
    let echoed = echoes_option_menu(&raw_drawing_type, 3)
        || LABELS.iter().any(|l| echoes_option_menu(&get(l), 5));

    // `ÇİZİM_TÜRÜ` bir FACET boyutudur (Pano dagilimi) → kanonik listeye kelepcelenir; stil ve
    // malzemede zaten yapilan sey. Gerekce (olculdu 2026-08-09): model `Kat Planı ###` yazdi;
    // ham birakilsaydi facet'te `Kat Planı` ile `Kat Planı ###` AYRI iki kova olurdu — tam da
    // "kardinalite patlamasi" diye onlenmeye calisilan sey. Listede karsiligi yoksa BOS kalir.
    let drawing_type = {
        let nm = archivist_db::normalize_tr(&raw_drawing_type);
        // EN UZUN eslesme kazanir: "Süsleme Detayı" ayni zamanda "Detay"i da icerir, kisa olan
        // listede once geldigi icin naif bir `find` onu "Detay"a indirgerdi.
        let mut best: Option<&&str> = None;
        for k in DRAWING_TYPES {
            if nm.contains(&archivist_db::normalize_tr(k))
                && best.is_none_or(|b| k.len() > b.len())
            {
                best = Some(k);
            }
        }
        best.map(|k| (*k).to_string()).unwrap_or_default()
    };

    let mut a = VisionAnalysis {
        drawing_type,
        echoed,
        description: get("AÇIKLAMA"),
        elements: split_list(&get("ELEMANLAR")),
        spaces: split_list(&get("MEKANLAR")),
        domain_terms: split_list(&get("ÖZEL_TERİMLER")),
        keywords: split_list(&get("ANAHTAR_KELİMELER")),
        architectural_styles,
        materials,
        text: {
            let t = get("METİN");
            if t.eq_ignore_ascii_case("BOŞ") || t.eq_ignore_ascii_case("YOK") {
                String::new()
            } else {
                t
            }
        },
        structured,
    };
    // Hicbir yapisal alan yoksa → ham metnin basini aciklama say (H2 fallback).
    if a.drawing_type.is_empty() && a.description.is_empty() {
        a.description = text.chars().take(300).collect::<String>().trim().to_string();
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DRIFT KILIDI: `VISION_EAV_KEYS`, `to_eav`'in uretebilecegi anahtar kumesinin TAMAMI olmali.
    /// `to_eav`'a yeni bir alan eklenip liste guncellenmezse, o alan geriye donuk "kullanilabilirlik"
    /// olcumunde SAYILMAZ → duzgun analizler yanlislikla "cop" sayilip sifirlanabilirdi.
    #[test]
    fn to_eav_keys_match_this_list() {
        // TUM alanlari dolu bir analiz → to_eav her anahtari uretir.
        let full = VisionAnalysis {
            drawing_type: "Cephe".into(),
            description: "aciklama".into(),
            elements: vec!["kolon".into()],
            spaces: vec!["hol".into()],
            domain_terms: vec!["mukarnas".into()],
            keywords: vec!["anahtar".into()],
            architectural_styles: vec!["Modern".into()],
            materials: vec!["Beton".into()],
            text: "metin".into(),
            structured: true,
            echoed: false,
        };
        let produced: Vec<&str> = full.to_eav().into_iter().map(|(k, _)| k).collect();
        assert_eq!(
            produced, VISION_EAV_KEYS,
            "to_eav anahtarlari VISION_EAV_KEYS ile birebir ayni olmali (sira dahil)"
        );
        // Kayit-tutma ve medya-turu alanlari icerik sayilmamali (sifirlama olcutunu bozarlar).
        for k in ["ai_analyzed", "ai_analyzed_at", "ai_model", "ai_gorsel_turu"] {
            assert!(!VISION_EAV_KEYS.contains(&k), "{k} icerik alani DEGIL");
        }
    }

    /// **YONLENDIRME** (olculdu 2026-08-10): `ÇİZİM_TÜRÜ` yalniz CAD dosyalarina sorulur.
    ///
    /// Bu, iki basarisiz denemenin sonucudur (ikisi de gercek arsiv dosyalariyla olculdu):
    /// (1) tek buyuk menu → model tereddutte ILK maddeye demirledi; (2) onune "bu nedir" kapisi
    /// koymak daha kotu oldu — dort dosyanin dordu de yeni menunun ilk maddesini secti ve model
    /// iki benzer etiketi karistirip gercek DWG'nin turunu kaybetti. Menuyu KALDIRMAK, demirlemeyi
    /// yapisal olarak imkansiz kilar.
    #[test]
    fn drawing_type_is_asked_only_for_cad_files() {
        for cad in ["C:/a/plan.dwg", "C:/a/PLAN.DWG", "C:/a/kesit.dxf"] {
            assert!(asks_drawing_type(cad), "{cad} → CAD, tur sorulmali");
        }
        for other in ["C:/a/render.jpg", "C:/a/doku.png", "C:/a/foto.tga", "C:/a/tarama.pdf", "C:/a/x"]
        {
            assert!(!asks_drawing_type(other), "{other} → CAD degil, tur SORULMAMALI");
        }
    }

    /// Alan sorulmuyorsa istemde **hic gecmemeli** — "BOŞ birak" diye rica etmek yetmez
    /// (olculdu: model kurala ragmen doldurdu; mermer dokusuna "Detay" yazdi).
    #[test]
    fn non_cad_prompt_omits_the_drawing_type_field_entirely() {
        let cad = build_vision_prompt(None, true);
        assert!(cad.contains("ÇİZİM_TÜRÜ:"), "CAD isteminde alan olmali");
        for t in DRAWING_TYPES {
            assert!(cad.contains(t), "CAD istemi `{t}` turunu icermeli");
        }
        let raster = build_vision_prompt(None, false);
        assert!(!raster.contains("ÇİZİM_TÜRÜ"), "CAD olmayan istemde alan HIC gecmemeli");
        // Menu de sizmamali: tur adlari istemde durursa model onlari baska alana tasiyabilir.
        assert!(!raster.contains("Vaziyet Planı"), "tur menusu sizmamali");
        // Analizin geri kalani AYNEN durur (betim/anahtar kelime/OCR kaybi YOK).
        for label in ["AÇIKLAMA:", "ELEMANLAR:", "ANAHTAR_KELİMELER:", "MALZEMELER:", "METİN:"] {
            assert!(raster.contains(label), "{label} raster isteminde de olmali");
        }
    }

    /// Medya turu bir cizim TURU degildir → menude olmamali (H2'nin listesi de boyleydi).
    #[test]
    fn media_kinds_left_the_drawing_menu() {
        for media in ["Fotoğraf", "Render"] {
            assert!(!DRAWING_TYPES.contains(&media), "{media} bir cizim TURU degil");
        }
    }

    #[test]
    fn prompt_includes_domain_terms_and_labels() {
        let p = build_vision_prompt(None, true);
        assert!(p.contains("ÇİZİM_TÜRÜ:"));
        assert!(p.contains("METİN:"), "OCR bolumu prompt'ta olmali");
        assert!(p.contains("MALZEMELER:"), "malzeme bolumu prompt'ta olmali");
        assert!(p.contains("MİMARİ_STİL:"), "mimari stil bolumu prompt'ta olmali");
        assert!(p.contains("mukarnas"), "domain terimleri prompt'ta");
        assert!(p.contains("Beton"), "bilinen malzemeler prompt'ta");
        // Kapsamlilik yonergeleri (kullanici geri-bildirimi 2026-07-11: cikti yeterince zengin degil).
        assert!(p.contains("DETAYLI"), "detayli-betim yonergesi (kapsamlilik)");
        assert!(p.contains("kökünü"), "kok+cekim anahtar-kelime yonergesi (arama isabeti)");
        let p2 = build_vision_prompt(Some("KATMANLAR: duvar, kapi"), true);
        assert!(p2.contains("teknik metadata"), "binary-context eklenir");
        assert!(p2.contains("KATMANLAR: duvar, kapi"));
    }

    #[test]
    fn parses_structured_response() {
        let resp = "ÇİZİM_TÜRÜ: Kat Planı\n\
                    AÇIKLAMA: 3. kat konut planı, odalar ve koridor.\n\
                    ELEMANLAR: duvar, kapı, merdiven\n\
                    MEKANLAR: salon, yatak odası, banyo\n\
                    ÖZEL_TERİMLER: BOŞ\n\
                    ANAHTAR_KELİMELER: konut, plan, kat\n\
                    MİMARİ_STİL: osmanlı, BAROK, uydurma-stil\n\
                    MALZEMELER: beton, CAM, uydurma-malzeme\n\
                    METİN: 3.KAT PLANI, ÖLÇEK 1:50";
        let a = parse_vision_response(resp);
        assert!(a.structured, "etiketli yanit yapisal isaretlenir");
        assert!(a.is_usable(), "yapisal + dolu → yazilabilir");
        assert_eq!(a.drawing_type, "Kat Planı");
        assert!(a.description.contains("konut planı"));
        assert_eq!(a.elements, vec!["duvar", "kapı", "merdiven"]);
        assert_eq!(a.spaces, vec!["salon", "yatak odası", "banyo"]);
        assert!(a.domain_terms.is_empty(), "BOŞ → bos");
        assert_eq!(a.keywords, vec!["konut", "plan", "kat"]);
        assert_eq!(a.architectural_styles, vec!["Osmanlı", "Barok"], "stiller kanoniklesir + uydurma elenir");
        // Malzemeler KNOWN_MATERIALS'a kelepcelenir (kanonik yazim) + bilinmeyen elenir.
        assert_eq!(a.materials, vec!["Beton", "Cam"], "TR-normalize eslesme + uydurma elenir");
        assert!(a.text.contains("3.KAT PLANI"), "METIN (OCR) cikarilir");
    }

    #[test]
    fn eav_only_includes_nonempty() {
        let a = VisionAnalysis {
            drawing_type: "Cephe".into(),
            keywords: vec!["taş".into(), "cephe".into()],
            ..Default::default()
        };
        let eav = a.to_eav();
        assert!(eav.iter().any(|(k, v)| *k == "ai_cizim_turu" && v == "Cephe"));
        assert!(eav.iter().any(|(k, v)| *k == "ai_anahtar_kelimeler" && v == "taş, cephe"));
        assert!(!eav.iter().any(|(k, _)| *k == "ai_aciklama"), "bos alan EAV'ye girmez");
    }

    #[test]
    fn fallback_uses_text_head_when_unstructured() {
        let a = parse_vision_response("Bu bir bahçe fotoğrafıdır, ağaçlar ve gökyüzü görünüyor.");
        assert!(a.description.contains("bahçe"), "yapisal etiket yoksa metin basi aciklama");
        assert!(!a.structured, "etiket bulunmadi → fallback dali isaretlenir");
    }

    // ── Cop-korumasi: OLCULEN gercek yetersiz-model ciktilari (2026-08-07, GTX 1050 Ti) ──

    #[test]
    fn junk_response_is_rejected_before_write() {
        // moondream her gorsele AYNEN bunu donduruyordu.
        let a = parse_vision_response(" [0");
        assert!(!a.structured, "etiket yok");
        assert!(!a.is_usable(), "cop yanit DB'ye YAZILMAMALI (yoksa ai_analyzed damgasi kalici)");

        // llava: uzun serbest metin, istemin SECENEK MENUSUNU bulgu sanip tekrarliyor; etiket yok.
        let rambling = "Bu görsel, bir modernist mimari örneği temsil ediyor. \
                        **Tanımlanabilen alanlar:** - **Kat Plan**: ... - **Cephe**: ... \
                        - **Kesit**: ... - **Vaziyet Plan**: ...";
        let b = parse_vision_response(rambling);
        assert!(!b.structured);
        assert!(!b.is_usable(), "UZUN olmasi cop olmadigi anlamina gelmez");
        // H2 fallback'i (metin basi → aciklama) KORUNUR; degisen yalniz yazim karari.
        assert!(!b.description.is_empty(), "fallback davranisi bozulmadi");
    }

    #[test]
    fn usable_requires_structure_and_substance() {
        // qwen2.5vl:3b'nin gercek ciktisinin kisaltilmis sekli → yazilir.
        let good = parse_vision_response(
            "### ÇİZİM_TÜRÜ:\nKat Planı\n\n### AÇIKLAMA:\nBir ofis kat planı; çalışma masaları.",
        );
        assert!(good.structured);
        assert!(good.is_usable(), "tur + aciklama = gecerli analiz");

        // Yalniz TEK alan: aramaya katkisi yok ama damga yerdi → elenir, bekleyen kalir.
        let thin = parse_vision_response("ÇİZİM_TÜRÜ: Cephe");
        assert!(thin.structured, "etiket var");
        assert!(!thin.is_usable(), "tek alan yazmaya deger degil");
    }

    /// SIFIRLAMA OLCUTUNUN DAYANAGI — makineden ve DB'den BAGIMSIZ.
    ///
    /// Gecmiste yazilmis kayitlarda `structured` bayragi TUTULMAZ; `unusable_analysis_ids` yalnizca
    /// YAZILMIS alan sayisina bakabilir. Bu testin kanitladigi denklik olmadan o sorgu bir TAHMIN
    /// olurdu:
    ///
    ///   `to_eav().len() < MIN_FILLED_FIELDS`  ⟹  `!is_usable()`   (**tek yon**)
    ///
    /// Gerekce (parser'dan cikar, veriden DEGIL): `structured=false` demek yanitta hicbir etiket
    /// GECMIYOR demektir → `section()` tum alanlar icin bos doner → geriye yalnizca fallback'in
    /// yazdigi `ai_aciklama` kalir, yani **tam 1 alan**. Dolayisiyla `!structured` zaten `len<2`'yi
    /// getirir.
    ///
    /// ⚠️ **DENKLIK 2026-08-09'da TEK YONE DARALDI.** Once cift yonluydu; menu-tekrari elemesi
    /// (bkz [`echoes_option_menu`]) eklenince artik **2+ alan uretip yine de elenen** yanitlar var.
    /// Sonuc: uretim, `unusable_analysis_ids`'in yakalayabildiginden DAHA COGUNU eler. Bu yon
    /// GUVENLIDIR (sifirlama fazladan kayit secmez, yani veri kaybi yonunde degildir) ama sifirlama
    /// onizlemesi artik menu-tekrari iceren ESKI kayitlari GOSTERMEZ — onlar damgali kalir.
    /// Kapatmak icin DB olcutunun de `ai_cizim_turu` degerine bakmasi gerekir (ayri is).
    ///
    /// ⚠️ Bu cikarim, ofisten ofise DEGISMEZ — hangi modelin ne yazdigina bagli degil, parser'in
    /// yapisina baglidir. Bir DB'deki dagilima bakarak dogrulanamaz (orada yalnizca SONUCU gorunur).
    #[test]
    fn unusable_is_exactly_fewer_than_min_fields() {
        // Farkli "cop" bicimleri: olculmus gercek ciktilar + ucdurumlar. Hicbirinde etiket YOK.
        let label_free = [
            " [0",                                        // moondream (olculdu)
            "Bu görsel, bir mimari projenin 3D modelini gösterir. Parçalar birbirine bağlı.", // llava (olculdu)
            "",                                           // bos yanit
            "   \n\t  ",                                  // yalniz bosluk
            &"çok uzun ama etiketsiz metin. ".repeat(40), // uzunluk yapisallik DEGILDIR
        ];
        for raw in label_free {
            let a = parse_vision_response(raw);
            assert!(!a.structured, "etiket yok → yapisal degil: {raw:?}");
            assert!(
                a.to_eav().len() <= 1,
                "etiketsiz yanit EN FAZLA tek alan (ai_aciklama) uretebilir: {raw:?} → {:?}",
                a.to_eav()
            );
        }

        // Asil denklik: etiketli/etiketsiz, zengin/cilizin hepsinde iki taraf AYNI karari vermeli.
        let samples = [
            " [0",
            "etiketsiz serbest metin",
            "ÇİZİM_TÜRÜ: Cephe",
            "AÇIKLAMA: yalnizca aciklama",
            "ÇİZİM_TÜRÜ: Kat Planı\nAÇIKLAMA: ofis katı",
            "AÇIKLAMA: cami avlusu\nANAHTAR_KELİMELER: kubbe, minare\nMETİN: BOŞ",
            "MİMARİ_STİL: Modern\nMALZEMELER: Beton\nAÇIKLAMA: bir yapı",
        ];
        for raw in samples {
            let a = parse_vision_response(raw);
            assert_eq!(
                a.is_usable(),
                a.to_eav().len() >= MIN_FILLED_FIELDS,
                "sifirlama olcutu ile cop-korumasi ayni karari vermeli: {raw:?} \
                 (structured={}, alanlar={:?})",
                a.structured,
                a.to_eav().iter().map(|(k, _)| *k).collect::<Vec<_>>()
            );
        }

        // TEK YON: az alan → daima elenir. (Ters yon artik gecerli DEGIL; asagidaki test gosterir.)
        for raw in ["", " [0", "ÇİZİM_TÜRÜ: Cephe"] {
            let a = parse_vision_response(raw);
            if a.to_eav().len() < MIN_FILLED_FIELDS {
                assert!(!a.is_usable(), "az alanli yanit her zaman elenmeli: {raw:?}");
            }
        }
    }

    /// **MENU-TEKRARI ELENIR** — bicimi tutturan ama istemin secenek listesini geri kopyalayan yanit.
    ///
    /// Olculmus vaka (kullanici, 2026-08-09): `qwen2.5vl:3b` bir logo gorseline `ÇİZİM_TÜRÜ` olarak
    /// istemin kendi menusunu yazdi. Cikti `structured` idi ve 2+ alan uretiyordu → eski esik onu
    /// KABUL ederdi ve varlik `ai_analyzed` damgasi yiyip kalici olarak "analizli" olurdu.
    #[test]
    fn echoed_option_menu_is_rejected_even_though_the_format_looks_right() {
        // Kullanicinin ekraninda gorulen iki gercek varyant.
        let echoed = [
            "ÇİZİM_TÜRÜ: [Kat Planı / Cephe / Kesit / Detay / Vaziyet Planı / Tesisat / Elektrik / \
             Strüktür / Mobilya Layout / Çatı Planı / Süsleme Detayı / Restorasyon / Fotoğraf / \
             Render / Diğer] 2.\nAÇIKLAMA: görselin türü belirlenemedi",
            "ÇİZİM_TÜRÜ: Görselin türü (kat planı, cephe, kesit, Detay, Vaziyet Planı, Tesisat, \
             Elektrik, Strüktür) belirlemek için\nAÇIKLAMA: bir logo",
        ];
        for raw in echoed {
            let a = parse_vision_response(raw);
            assert!(a.structured, "etiket VAR — bicim dogru gorunuyor: {raw:?}");
            assert!(
                a.to_eav().len() >= MIN_FILLED_FIELDS,
                "alan sayisi esigi de GECIYOR — eski kural bunu kabul ederdi: {raw:?}"
            );
            assert!(!a.is_usable(), "menu-tekrari yazilmamali: {raw:?}");
        }

        // ⚠️ DAR KALMALI: gercek yanitlar elenmemeli.
        let legit = [
            "ÇİZİM_TÜRÜ: Kat Planı\nAÇIKLAMA: zemin kat yerlesimi",
            // Bir pafta birden fazla tur tasiyabilir — IKI tur hala mesru.
            "ÇİZİM_TÜRÜ: Kat Planı, Cephe\nAÇIKLAMA: pafta iki cizim iceriyor",
            // Anahtar kelimelerde birkac tur adi gecebilir; bu alan icin esik daha yuksektir.
            "ÇİZİM_TÜRÜ: Cephe\nAÇIKLAMA: bir yapı\nANAHTAR_KELİMELER: cephe, kesit, detay, plan",
        ];
        for raw in legit {
            assert!(parse_vision_response(raw).is_usable(), "gercek yanit elenmemeli: {raw:?}");
        }
    }

    /// **ÇİZİM_TÜRÜ kanonik listeye kelepcelenir** — cunku bu bir FACET boyutudur.
    ///
    /// Olculdu (kullanici, 2026-08-09): model iki gorsele de `ÇİZİM_TÜRÜ: Kat Planı ###` yazdi.
    /// Ham birakilsaydi Pano dagiliminda `Kat Planı` ile `Kat Planı ###` AYRI iki kova olurdu —
    /// stil/malzemede zaten onlenen "kardinalite patlamasi"nin aynisi.
    #[test]
    fn drawing_type_is_clamped_to_the_canonical_list() {
        let noisy = parse_vision_response("ÇİZİM_TÜRÜ: Kat Planı ###\nAÇIKLAMA: bir çizim");
        assert_eq!(noisy.drawing_type, "Kat Planı", "markdown gurultusu temizlenmeli");

        let starred = parse_vision_response("ÇİZİM_TÜRÜ: **cephe**\nAÇIKLAMA: x");
        assert_eq!(starred.drawing_type, "Cephe", "buyuk/kucuk harf duyarsiz eslesmeli");

        // Listede karsiligi olmayan uydurma tur → BOS (facet'e uydurma kova acilmaz).
        let made_up = parse_vision_response("ÇİZİM_TÜRÜ: Uzay Gemisi Şeması\nAÇIKLAMA: x");
        assert_eq!(made_up.drawing_type, "");

        // EN UZUN eslesme kazanir: "Süsleme Detayı" kisa "Detay"a indirgenmemeli.
        let long = parse_vision_response("ÇİZİM_TÜRÜ: Süsleme Detayı\nAÇIKLAMA: x");
        assert_eq!(long.drawing_type, "Süsleme Detayı");
    }

    /// Istem ile tespit AYNI listeden beslenmeli — biri degisip digeri bayatlarsa tespit korlesir.
    #[test]
    fn prompt_lists_every_drawing_type() {
        let prompt = build_vision_prompt(None, true);
        for t in DRAWING_TYPES {
            assert!(prompt.contains(t), "istem `{t}` turunu icermeli (menu tek kaynaktan kurulur)");
        }
    }

    #[test]
    fn error_texts_map_to_stable_classes() {
        // Kullanicinin ekranda gordugu gercek hata (2026-08-07).
        assert_eq!(
            classify_vision_error(
                "Ollama vision hatasi: status 500: {\"error\":\"llama-server process has \
                 terminated: exit status 0xc0000409: ... CUDA error: the provided PTX was \
                 compiled with an unsupported toolchain\"}"
            ),
            "gpu_driver"
        );
        // Olculen zaman asimi metni (Turkce sistem mesaji + os error 10060).
        assert_eq!(
            classify_vision_error(
                "Ollama vision hatasi: Network Error: Error encountered in the status line: \
                 Bağlanılan ... bir bağlantı kurulamadı. (os error 10060)"
            ),
            "timeout",
            "Turkce sistem metni ASCII-lowercase'e takilmamali; 10060 kararli imza"
        );
        assert_eq!(classify_vision_error("Ollama'ya baglanilamadi: ..."), "ollama_down");
        assert_eq!(
            classify_vision_error("Ollama vision hatasi: status 400: exceed_context_size_error"),
            "context_overflow"
        );
        assert_eq!(classify_vision_error("status 404: model not found"), "model_missing");
        assert_eq!(classify_vision_error("beklenmedik bir sey oldu"), "other");
    }
}

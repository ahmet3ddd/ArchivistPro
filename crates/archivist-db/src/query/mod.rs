//! Sayfali, tipli okuma sorgulari — liste / FTS arama / detay / facet.
//!
//! Renderer DB'yi gormez; bu tiplerin IPC'ye serileştirilmis hallerini alir (yalniz
//! o anki sayfa). Sayfalama offset/limit — sanallastirilmis grid rastgele atlar
//! (keyset rastgele atlamayi desteklemez; cok-buyuk olcekte gelecek optimizasyonu).
//!
//! Bu modul bir dizin-modul: tipler + paylasilan yardimcilar burada; okuma sorgulari
//! alt-modullere bolundu (saf refactor, davranis degismez):
//! - `list`   — liste / FTS / fuzzy / detay / thumbnail / klasor / koleksiyon (`impl Db`).
//! - `facets` — facet sayimlari (ext/metadata/tag/onay/musteri/versiyon/termin/favori).
//! - `fts`    — FTS5 MATCH ifadesi uretimi (boolean/tumce parser) + fuzzy terim ayiklama.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

mod facets;
mod fts;
mod list;

/// FTS sorgu-parser: `build_match_query` (boolean/tumce) + `fts_query` (guvenli geri-dusus) +
/// `build_and_query`/`build_or_query` (token-listesi AND/OR onek ifadeleri).
/// `pub(crate)` re-export: hibrit arama (semantic.rs) `crate::query::build_match_query` /
/// `crate::query::fts_query` yoluyla list_assets ile AYNI FTS ifadesini kurar → yol korunur.
/// `build_and_query`/`build_or_query`: liste-niyeti asset aramasi (`rag::list_intent_search`)
/// crate kokunden `crate::query::` ile AYNI onek/quote ifadesini kurar (Gezgin ile tutarli).
pub(crate) use fts::{build_and_query, build_match_query, build_or_query, fts_query};

/// Asset satiri (liste/arama/detay basligi).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetRow {
    pub id: i64,
    pub path: String,
    pub file_name: String,
    pub ext: Option<String>,
    pub size_bytes: i64,
    pub mime: Option<String>,
    pub title: Option<String>,
    pub created_at: i64,
    pub modified_at: i64,
    pub indexed_at: Option<i64>,
    /// Favori mi (kullanici isareti). Listede/detayda gosterilir.
    pub favorite: bool,
    /// FTS eslesme parcasi ("neden bu sonuc") — yalniz tam-metin aramada dolu;
    /// eslesen terimler `\u{2}`..`\u{3}` ile isaretli. Liste/fuzzy/detay → None.
    pub snippet: Option<String>,
    /// AI vision-analizi yapilmis mi (asset_metadata'da `ai_analyzed` marker'i var mi;
    /// `set_ai_metadata` yazar). Grid rozeti icin — TUM okuma yollarinda dolar (map_asset_row
    /// index 12). serde otomatik akar (snake_case `ai_analyzed`; AssetPage → AssetRow Serialize).
    pub ai_analyzed: bool,
    /// Gorsel MEDYA turu (`Fotoğraf`|`Render`|`Doku`) — asset_metadata'daki `ai_gorsel_turu` EAV
    /// degeri (skaler; `write_image_kind`/image_kind heuristik yazar). Grid tur-rozeti icin — TUM
    /// okuma yollarinda dolar (map_asset_row index 13; ai_analyzed'in hemen ardi). `None` = tur
    /// atanmamis. serde otomatik akar (snake_case `ai_gorsel_turu`; AssetPage → AssetRow Serialize).
    pub ai_gorsel_turu: Option<String>,
    /// CIELAB-tabanli cikaricinin buldugu en cok 5 baskin renk. EAV'deki tek JSON degeri
    /// `map_asset_row` tarafindan guvenli bicimde ayrisitilir; eski/bozuk kayit -> bos liste.
    pub dominant_colors: Vec<DominantColor>,
    /// Semantik (vektor) benzerlik skoru — **yalniz `semantic_search` yolunda** dolu (kNN aday
    /// vektoru ile sorgunun GERCEK cosine'i; vec0 mesafe-metriginden BAGIMSIZ, `image_search_scored`
    /// deseni). Yuksek = daha benzer. Liste/FTS/detay/fuzzy → `None`. `skip_serializing_if`: yalniz
    /// dolu oldugunda tele girer → `/assets` (list) cikti sekli BYTE-BYTE degismez (yalniz
    /// `/search/semantic` items'i `score` tasir; frontend "% benzerlik rozeti"ni bundan uretir).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
}

/// Bir baskin renk: RGB + gorseldeki yaklasik payi (0..100).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DominantColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub percentage: f32,
}

/// Extractor -> EAV -> sorgu -> IPC boyunca kullanilan tek metadata anahtari.
pub const DOMINANT_COLORS_METADATA_KEY: &str = "dominant_colors";

/// Sayfa sonucu: toplam (sayfalama icin) + o sayfanin satirlari.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetPage {
    pub total: i64,
    pub items: Vec<AssetRow>,
}

/// Bir arama isabetinin **alan-atfi** ("neden bu sonuc"): sorgunun asset'in HANGI `assets_fts`
/// sutununda eslestigini gosterir (H2 `findMatchSources` pariti — sayfali mimariye uyarlanmis).
/// Atif DOGRUDAN FTS sutunlarindan uretilir → gosterilen "neden", asset'i gercekten arama
/// sonucuna sokan eslesmeyle BIREBIR tutarlidir (H2 gibi ayri bir istemci-tarafi metin taramasi
/// DEGIL → renderer DB tutmaz ilkesi korunur; kirletme yok).
///
/// `field`: eslesen sutun (`file_name`|`title`|`description`|`body`|`ai`). `group`: UI gruplamasi
/// (`meta`|`file`|`ai`; H2'nin file/ai/meta uclusuyle ayni ruh). `snippet`: eslesen pencere —
/// eslesen terimler `\u{2}`..`\u{3}` ile isaretli (AssetCard FTS snippet'iyle AYNI isaretleyici →
/// frontend ayni vurgu bileseniyle cozer). Yalniz keyword (FTS) yolunda anlamli; semantik/gorsel
/// modda "neden" zaten % benzerlik rozetidir → atif hesaplanmaz.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MatchSource {
    pub field: String,
    pub group: String,
    pub snippet: String,
}

/// Bir asset'in **dosya-sistemi denetim meta'si** — staleness (mtime/varlik) + fixity
/// (rehash) girdisi (Doctor'un FS ayagi). `Db::active_assets_fs_meta` doldurur (yalniz
/// aktif = `deleted_at IS NULL`; path ASC). IPC'ye gitmez (renderer'a *rapor* tipleri
/// gider, ham meta degil) → serileştirme derive'i YOK; yalniz crate-ici denetim girdisi.
#[derive(Debug, Clone, PartialEq)]
pub struct AssetFsMeta {
    pub id: i64,
    pub path: String,
    pub modified_at: i64,
    pub size_bytes: i64,
    /// Ingest-ani BLAKE3 baseline (fixity karsilastirma tabani). `None` → baseline yok
    /// (fixity orneklemesi dislar; savunma icin `FixityKind::NoBaseline`).
    pub content_hash: Option<String>,
}

/// Tek metadata girdisi (EAV) — `value_text` veya `value_num`'dan biri dolu.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetaEntry {
    pub key: String,
    pub value_text: Option<String>,
    pub value_num: Option<f64>,
}

/// Bir etiket referansi (ad + tur + renk). `kind`: user | auto | system.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagRef {
    pub name: String,
    pub kind: String,
    pub color: Option<String>,
}

/// Bir koleksiyon referansi (id + ad + renk + uye sayisi). Kenar cubugu faceti +
/// detay editoru (uyelik) icin ortak tip. `color` parite-hazir (secici UI sonra).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CollectionRef {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub count: i64,
}

/// Proje-durum alanlari (H2 pariti) — detay panelinin proje bolumu. Hepsi
/// kullanici-tanimli, opsiyonel. `approval_status`: draft|review|approved|rejected
/// (None=ayarlanmamis). `set_project_meta` ile yazilir; ingest DOKUNMAZ.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectMetaOut {
    pub client_name: Option<String>,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    pub version_label: Option<String>,
    pub deadline: Option<String>,
}

/// Asset'in ATANDIGI proje (entity; `assets.project_id` FK, 0019). `None` = projesiz.
/// `client_name` proje-DUZEYI musteri → asset'in kendi `project.client_name`'i (per-asset, 0008)
/// NULL ise GORUNUMDE devralinir (COALESCE inheritance; veri KOPYALANMAZ — detay paneli
/// "(projeden)" isaretiyle gosterir). Boylece musteri projede BIR KEZ girilir, dosyalar devralir.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssignedProject {
    pub id: i64,
    pub name: String,
    pub client_name: Option<String>,
}

/// Asset detayi — satir + metadata + etiketler + koleksiyonlar (detay paneli).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetDetail {
    pub asset: AssetRow,
    pub metadata: Vec<MetaEntry>,
    pub tags: Vec<TagRef>,
    /// Bu asset'in uyesi oldugu koleksiyonlar (CollectionEditor cipleri).
    pub collections: Vec<CollectionRef>,
    /// Proje-durum alanlari (H2 pariti; PER-ASSET, 0008) — musteri/onay/versiyon/teslim.
    pub project: ProjectMetaOut,
    /// Asset'in atandigi PROJE (entity, 0019; `None`=projesiz). Proje-duzeyi `client_name`,
    /// asset'in kendisininki NULL ise gorunumde devralinir (inheritance; bkz `AssignedProject`).
    pub assigned_project: Option<AssignedProject>,
    /// RAG'den manuel dislandi mi (hassasiyet filtresi, A1). True → sohbet retrieve'i bu asset'in
    /// parcalarini getirmez. Detay "Parçalar" sekmesindeki toggle bunu yansitir/degistirir.
    pub rag_excluded: bool,
}

/// Facet (gruplama) girdisi — bir deger + o degerdeki asset sayisi.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Facet {
    /// Deger (uzanti / metadata degeri / etiket adi). `None` = uzantisiz asset'ler.
    pub value: Option<String>,
    pub count: i64,
}

/// Klasor (dizin) ozeti — bir ust-dizin + altindaki dogrudan asset sayisi.
/// "Klasorler" gorunumu icin (H2 FoldersView pariti): H3'te `scanned_roots` tablosu
/// henuz YOK; klasorler mevcut `assets.path` satirlarinin ust-dizininden TURETILIR.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderSummary {
    /// Ust-dizin yolu (ayrac normalize edilmez; path'te ne varsa o korunur).
    pub path: String,
    /// Bu dizindeki dogrudan asset sayisi.
    pub file_count: i64,
    /// Bu klasordeki asset'lerin EN YENI `indexed_at` degeri (klasor-basi son indeksleme;
    /// siralama icin). `None` = klasordeki hicbir asset'in `indexed_at`'i yok (hepsi NULL).
    /// NULL `indexed_at`'ler yok sayilir → max yalniz non-null degerler uzerinden.
    pub last_indexed: Option<i64>,
}

/// Bir asset'in kucuk resmi — ham baytlar (kodlanmis, genelde JPEG). IC tip: transport
/// kodlamasi (base64) komut katmaninda yapilir; db ham bayt doner.
#[derive(Debug, Clone, PartialEq)]
pub struct ThumbnailData {
    pub asset_id: i64,
    pub mime: String,
    pub width: i64,
    pub height: i64,
    pub bytes: Vec<u8>,
}

/// Liste siralama secenekleri (frontend'ten gelir; SQL whitelist).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetSort {
    #[default]
    ModifiedDesc,
    ModifiedAsc,
    NameAsc,
    NameDesc,
    TypeAsc,
    TypeDesc,
    SizeAsc,
    SizeDesc,
    CreatedAsc,
    CreatedDesc,
    PathAsc,
    PathDesc,
}

impl AssetSort {
    /// Whitelist → ORDER BY parcasi (kullanici-girdisi DEGIL → SQL-injection yok). Teknik gorunum
    /// sutun-basligina tiklama bunlari secer (ad/tur/boyut/degistirilme/olusturulma/yol × asc/desc).
    /// `ext` NULL olabilir (uzantisiz) → SQLite ASC'de NULL basta, DESC'de sonda gruplar (kabul).
    /// Ikincil `id` daima deterministik esitlik-kirici (esit anahtar → stabil siralama).
    fn order_by(self) -> &'static str {
        match self {
            AssetSort::ModifiedDesc => "modified_at DESC, id DESC",
            AssetSort::ModifiedAsc => "modified_at ASC, id ASC",
            AssetSort::NameAsc => "file_name ASC, id ASC",
            AssetSort::NameDesc => "file_name DESC, id DESC",
            AssetSort::TypeAsc => "ext ASC, id ASC",
            AssetSort::TypeDesc => "ext DESC, id DESC",
            AssetSort::SizeAsc => "size_bytes ASC, id ASC",
            AssetSort::SizeDesc => "size_bytes DESC, id DESC",
            AssetSort::CreatedAsc => "created_at ASC, id ASC",
            AssetSort::CreatedDesc => "created_at DESC, id DESC",
            AssetSort::PathAsc => "path ASC, id ASC",
            AssetSort::PathDesc => "path DESC, id DESC",
        }
    }
}

/// Liste/arama sorgu secenekleri. Tek birlesik yol: `query` bossa filtreli liste
/// (sort sirali), doluysa FTS5 tam-metin (rank sirali) — her iki durumda da TUM
/// filtreler (ext/tag/collection/favori/tarih) birlikte (AND) uygulanir.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
pub struct ListOpts {
    /// 0-tabanli sayfa numarasi.
    #[serde(default)]
    pub page: i64,
    /// Sayfa boyu (1..=500'e kelepcelenir; <=0 → 50).
    #[serde(default)]
    pub page_size: i64,
    #[serde(default)]
    pub sort: AssetSort,
    /// Tam-metin sorgusu (None/bos → filtreli liste; dolu → FTS5 rank sirali).
    /// Boolean (AND/OR/NOT), "tumce" ve ( ) gruplama destekli; hatali sozdiziminde
    /// guvenli (hepsi-tirnakli) sorguya zarif duser.
    #[serde(default)]
    pub query: Option<String>,
    /// Bulanik (fuzzy) arama acik mi? `query` doluyken FTS yerine Levenshtein-yakin
    /// kelime eslesmesi (yazim-hatasi toleransi). Tam-tarama → opt-in.
    #[serde(default)]
    pub fuzzy: bool,
    /// Uzanti filtresi — **cok-degerli** (facet-ici OR: listedeki uzantilardan herhangi
    /// biriyle eslesen asset'ler). Bos liste = filtre yok (tum uzantilar).
    #[serde(default)]
    pub ext: Vec<String>,
    /// Etiket adina gore filtre — **cok-degerli** (facet-ici OR: secili etiketlerden
    /// herhangi birine sahip asset'ler). Bos liste = filtre yok.
    #[serde(default)]
    pub tag: Vec<String>,
    /// Koleksiyon id'sine gore filtre — **cok-degerli** (facet-ici OR: secili
    /// koleksiyonlardan herhangi birinde olan asset'ler). Bos liste = filtre yok.
    #[serde(default)]
    pub collection: Vec<i64>,
    /// Proje id'sine gore filtre — **cok-degerli** (facet-ici OR: secili projelerden
    /// herhangi birine atanmis asset'ler; `assets.project_id` FK, 0019). Bos liste = filtre
    /// yok. `collection` deseninin birebir esi (json_each IN). "Bir projenin asset'leri"
    /// = `list_assets(opts{project:[id]})` (ayri sorgu yok; liste yolu yeniden kullanilir).
    #[serde(default)]
    pub project: Vec<i64>,
    /// modified_at alt siniri (unix saniye, dahil). None = sinir yok.
    #[serde(default)]
    pub modified_after: Option<i64>,
    /// modified_at ust siniri (unix saniye, dahil). None = sinir yok.
    #[serde(default)]
    pub modified_before: Option<i64>,
    /// Yalniz favoriler.
    #[serde(default)]
    pub favorites_only: bool,
    /// Onay durumu filtresi — **cok-degerli** (facet-ici OR: secili durumlardan herhangi
    /// birine sahip asset'ler; proje-durum faceti). Bos liste = filtre yok. Diger
    /// filtrelerle AND (facet-arasi).
    #[serde(default)]
    pub approval_status: Vec<String>,
    /// Musteri adina gore filtre — **cok-degerli** (facet-ici OR; proje-durum faceti).
    /// Bos liste = filtre yok. Diger filtrelerle AND (facet-arasi).
    #[serde(default)]
    pub client_name: Vec<String>,
    /// Versiyon etiketine gore filtre — **cok-degerli** (facet-ici OR; proje-durum faceti).
    /// Bos liste = filtre yok. Diger filtrelerle AND.
    #[serde(default)]
    pub version_label: Vec<String>,
    /// Termin YILINA gore filtre (deadline'in ilk 4 hanesi, or. "2026") — **cok-degerli**
    /// (facet-ici OR; proje-durum faceti). Bos liste = filtre yok. Diger filtrelerle AND.
    #[serde(default)]
    pub deadline_year: Vec<String>,
    /// Yol on-eki filtresi (None = filtre yok). Verildiginde yalniz `path` bu on-ekle
    /// baslayan asset'ler doner — "Klasorler" gorunumunde bir klasore tiklama bunu
    /// ayarlar. LIKE joker karakterleri (`%` `_` `\`) guvenli sekilde escape edilir
    /// (kullanici yolu literal eslesir, joker yorumlanmaz). Diger filtrelerle AND.
    #[serde(default)]
    pub path_prefix: Option<String>,
    /// AI vision-analiz durumuna gore TRI-STATE filtre: **None = filtre yok** (varsayilan;
    /// absent/yok gelirse serde default None) · **Some(true) = yalniz analizli** (`ai_analyzed`
    /// marker'i olanlar) · **Some(false) = yalniz HIC ANALIZE GIRMEMIS gorseller** (analizsiz +
    /// denenmemis + thumbnail'i olan + vision-skip'siz; marker'in duz degili DEGIL — gerekce
    /// `FILTER_FRAG` doc'unda). Frontend snake_case `ai_analyzed` gonderir (alan yoksa → None).
    /// Diger facet'lerle AND (facet-arasi kesisim).
    #[serde(default)]
    pub ai_analyzed: Option<bool>,
    /// Gorsel MEDYA turu faceti — **tekil** deger filtresi (`ai_gorsel_turu` EAV token'i):
    /// **None = filtre yok** (varsayilan; absent/yok gelirse serde default None) · `Some("Render")`
    /// vb. = yalniz o turdeki asset'ler. Kanonik TR token: `Fotoğraf` | `Render` | `Doku`. Frontend
    /// snake_case `gorsel_turu` gonderir (`ai_analyzed` ile ayni konvansiyon; alan yoksa → None).
    /// Diger facet'lerle AND (facet-arasi kesisim).
    #[serde(default)]
    pub gorsel_turu: Option<String>,
    /// **GENEL metadata (EAV) filtresi** — cikarici-uretimi `asset_metadata` anahtarlari uzerinde
    /// (`unit_type`, `version`, ...). Her girdi bir anahtar + secili degerleri: **anahtar-ici OR**,
    /// **anahtarlar-arasi AND** (diger facet'lerle ayni semantik). Bos liste = filtre yok.
    ///
    /// NEDEN GENEL (2026-07-19): her yeni metadata facet'i icin ayri `ListOpts` alani + ayri
    /// `FILTER_FRAG` dali + ayri bind acmak (bkz `:gorsel_turu`) facet basina ~20 dokunus noktasi
    /// demekti. Bu alan TEK parametrik dal ile calisir → yeni bir metadata facet'i eklemek
    /// **sifir Rust degisikligi** ister (yalniz UI + i18n). `metadata_facets` sayim komutu ZATEN
    /// vardi; eksik olan yalnizca buydu (H2_PARITY #11).
    ///
    /// ⚠️ Yalniz `value_text` ile eslesir (`value_num` DEGIL) — facet'ler kategorik metin
    /// degerler icindir; sayisal aralik sorgusu ayri bir ozellik olur.
    #[serde(default)]
    pub metadata: Vec<MetaFilter>,
}

/// Tek bir metadata anahtari icin secili degerler (`ListOpts::metadata` girdisi).
/// `values` bos ise o girdi filtreye HIC katilmaz (bkz `FilterBinds::new`) — "anahtari sec ama
/// hicbir deger secme" kullanicida "filtre yok" demektir, "hicbir sey eslesmesin" degil.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct MetaFilter {
    pub key: String,
    #[serde(default)]
    pub values: Vec<String>,
}

/// AssetRow'un cekirdek 10 sutunu (favorite HARIC; o, sorguya alias'la eklenir).
/// `get_asset` ve `trash::list_trash` icin (FROM assets, alias yok).
pub(crate) const COLS: &str =
    "id, path, file_name, ext, size_bytes, mime, title, created_at, modified_at, indexed_at";

/// Ayni 10 sutun `a.` alias'li — birlesik liste/arama yolu (FROM assets a).
/// `pub(crate)`: semantic.rs (vektor arama) ayni sutun setini hidratlamak icin paylasir.
pub(crate) const COLS_A: &str =
    "a.id, a.path, a.file_name, a.ext, a.size_bytes, a.mime, a.title, a.created_at, a.modified_at, a.indexed_at";

/// favorite (0/1) ifadesi — `a.` alias'li (map_asset_row indeks 10).
pub(crate) const FAV_A: &str = "EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = a.id)";

/// ai_analyzed (0/1) ifadesi — `a.` alias'li (map_asset_row indeks 12; snippet'ten SONRA).
/// asset_metadata'da `ai_analyzed` marker'i (set_ai_metadata) var mi → AI vision-analizi
/// yapilmis mi. TUM COLS_A besleyen SELECT'ler (liste/fuzzy/semantik/hibrit/gorsel/shape) bunu
/// projeksiyonun 13. sutunu olarak ekler → kolon-hizasi korunur. `get_asset`/`list_trash`
/// (COLS, alias'siz) `assets.id`'li esdeger ifadeyi INLINE eder (ayni marker sorgusu).
pub(crate) const AI_A: &str =
    "EXISTS (SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.id AND m.key = 'ai_analyzed')";

/// ai_gorsel_turu (value_text) ifadesi — `a.` alias'li (map_asset_row indeks 13; AI_A'dan SONRA).
/// asset_metadata'daki `ai_gorsel_turu` EAV degeri (skaler; `write_image_kind`/image_kind heuristik
/// yazar) → gorsel MEDYA turu (`Fotoğraf`|`Render`|`Doku`; yoksa NULL → None). TUM COLS_A besleyen
/// SELECT'ler (liste/fuzzy/semantik/hibrit/gorsel/shape) bunu projeksiyonun 14. sutunu olarak AI_A'dan
/// HEMEN SONRA ekler → kolon-hizasi korunur. `get_asset`/`list_trash` (COLS, alias'siz) `assets.id`'li
/// esdeger ifadeyi INLINE eder (ayni EAV sorgusu).
pub(crate) const AI_GORSEL_TURU_EXPR: &str =
    "(SELECT value_text FROM asset_metadata m WHERE m.asset_id = a.id AND m.key = 'ai_gorsel_turu')";

/// Baskin renk JSON'u (value_text) - `a.` alias'li tum AssetRow projeksiyonlarinin son kolonu.
pub(crate) const DOMINANT_COLORS_EXPR: &str =
    "(SELECT value_text FROM asset_metadata m WHERE m.asset_id = a.id AND m.key = 'dominant_colors')";

/// Ortak filtre WHERE parcasi (liste + arama yollari paylasir). Adli parametreler:
/// :ext :tag :fav :collection :project :mod_after :mod_before :approval :path_prefix
/// :ai_analyzed :gorsel_turu. `a` = assets alias'i. `:path_prefix` ONCEDEN escape'lenmis (joker
/// `%`/`_`/`\` → `\X`) bir on-ek; NULL = filtre yok. `ESCAPE '\'` ile literal eslesme garanti.
///
/// **`:ai_analyzed` TRI-STATE** (Option<bool> → Option<i64>): NULL = filtre yok (varsayilan) ·
/// 1 = yalniz analizli (`ai_analyzed` marker VAR) · 0 = **"hic analize girmemis"** — bkz asagi.
/// Fragman `CASE WHEN :ai_analyzed = 1` her zaman-var; param NULL iken kisa-devre eder.
///
/// ⚠️ **0 dali marker'in duz DEGILI DEGILDIR** (kullanici itirazi 2026-08-16). Once oyleydi ve
/// sidebar'daki "Analiz edilmemis" satiri, (a) denenip cop-korumasinca elenmis gorselleri ve
/// (b) thumbnail'i olmadigi icin gorsel-analize ASLA giremeyecek PDF/DWG gibi dosyalari da
/// donduruyordu — satirin vaadi ise "hic analize girmemis GORSELLER"di. 0 dali artik
/// `pending_count_with(never_attempted = true)` ile BIREBIR ayni kumeyi kurar:
/// analiz yok · `ai_attempt_failed` isareti yok · thumbnail VAR · vision-skip'siz (+ FILTER_FRAG'in
/// bas kosulu `deleted_at IS NULL`). Sayi ile filtrenin ayni seyi gostermesi bu esitlige baglidir;
/// biri degisirse digeri de degismeli (`ai_status.rs` testleri ikisini birlikte kilitler).
/// "Denendi, sonuc alinamadi" ayri bir satirdir ve GENEL metadata filtresiyle (`:metadata`,
/// `ai_attempt_failed`) calisir → ikisi artik kesismez (birbirini dislayan bolme).
///
/// **`:gorsel_turu` TEKIL** (Option<String>): NULL = filtre yok (varsayilan) · dolu iken yalniz
/// `ai_gorsel_turu` EAV degeri esit (`= :gorsel_turu`) asset'ler (`Fotoğraf`|`Render`|`Doku`).
/// Deger PARAMETRE olarak baglanir (injection yok); param NULL iken `IS NULL` dali kisa-devre eder.
///
/// **`:metadata` GENEL EAV FILTRESI** (Vec<MetaFilter>): NULL = filtre yok · dolu iken
/// `[{"key":"unit_type","values":["Metre"]},...]` JSON'u olarak baglanir. Mantik **cift NOT
/// EXISTS**: *"karsilanmayan HICBIR anahtar yok"* ⇒ asset istenen TUM anahtarlari karsilar
/// (anahtarlar-arasi AND) ve her anahtarda degerlerden HERHANGI biriyle eslesir (anahtar-ici OR)
/// — mevcut facet semantiginin aynisi. Ic sorgu `asset_metadata` PK'sini (`asset_id, key`)
/// kullanir → asset basina anahtar basina tek indeks aramasi.
///
/// 🔑 Bu dal **parametriktir**: anahtar adi SQL'e gomulmez, JSON'dan `json_extract` ile okunur →
/// yeni bir metadata facet'i icin bu sabit fragman DEGISMEZ (`:gorsel_turu` gibi anahtar-basina
/// dal acmaya son verir).
///
/// **Cok-degerli facet'ler** (`:ext` `:tag` `:collection` `:approval`): her biri ya NULL
/// (filtre yok) ya da bir **JSON dizi metni** (`["pdf","dwg"]` / `[1,2]`) olarak baglanir;
/// `json_each(...)` ile `IN (...)` listesine acilir → **facet-ici OR** (secili degerlerden
/// herhangi biriyle eslesme), **facet-arasi AND** (her facet ayri kosul). Deger her zaman
/// PARAMETRE olarak baglanir → SQL'e gomulmez (injection yok). JSON metnini `FilterBinds`
/// uretir (bos liste → NULL). json1 (json_each) bundled SQLite'ta varsayilan acik.
///
/// §O cop kutusu (KRITIK DOGRULUK): ilk kosul `a.deleted_at IS NULL` → cop'e atilmis
/// (soft-delete) asset bu parcayi kullanan TUM aktif yollardan (liste + FTS + fuzzy)
/// dislanir. `list_filtered` (duz + FTS) ve `list_fuzzy` bu parcayi paylastigindan tek
/// noktada uygulanmasi her uc yolu da kapsar (sizinti yok). `pub(crate)`: semantic.rs
/// (vektor arama) ayni filtreyi paylasir → cop'e atilmis asset semantik sonuca da sizmaz.
pub(crate) const FILTER_FRAG: &str = "a.deleted_at IS NULL
        AND (:ext IS NULL OR a.ext IN (SELECT value FROM json_each(:ext)))
        AND (:fav = 0 OR EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = a.id))
        AND (:tag IS NULL OR EXISTS (
                SELECT 1 FROM asset_tags at JOIN tags t ON t.id = at.tag_id
                WHERE at.asset_id = a.id AND t.name IN (SELECT value FROM json_each(:tag))))
        AND (:collection IS NULL OR EXISTS (
                SELECT 1 FROM collection_items ci
                WHERE ci.asset_id = a.id AND ci.collection_id IN (SELECT value FROM json_each(:collection))))
        AND (:project IS NULL OR a.project_id IN (SELECT value FROM json_each(:project)))
        AND (:mod_after IS NULL OR a.modified_at >= :mod_after)
        AND (:mod_before IS NULL OR a.modified_at <= :mod_before)
        AND (:approval IS NULL OR a.approval_status IN (SELECT value FROM json_each(:approval)))
        AND (:client IS NULL OR a.client_name IN (SELECT value FROM json_each(:client)))
        AND (:version IS NULL OR a.version_label IN (SELECT value FROM json_each(:version)))
        AND (:dyear IS NULL OR substr(a.deadline, 1, 4) IN (SELECT value FROM json_each(:dyear)))
        AND (:path_prefix IS NULL OR a.path LIKE :path_prefix || '%' ESCAPE '\\')
        AND (:ai_analyzed IS NULL OR CASE WHEN :ai_analyzed = 1
                THEN EXISTS (SELECT 1 FROM asset_metadata m2
                        WHERE m2.asset_id = a.id AND m2.key = 'ai_analyzed')
                ELSE NOT EXISTS (SELECT 1 FROM asset_metadata m2
                        WHERE m2.asset_id = a.id
                          AND m2.key IN ('ai_analyzed', 'ai_attempt_failed'))
                     AND EXISTS (SELECT 1 FROM asset_thumbnails th WHERE th.asset_id = a.id)
                     AND NOT EXISTS (SELECT 1 FROM index_skips s
                        WHERE s.asset_id = a.id AND s.stage = 'vision')
                END)
        AND (:gorsel_turu IS NULL OR EXISTS (SELECT 1 FROM asset_metadata mg
                WHERE mg.asset_id = a.id AND mg.key = 'ai_gorsel_turu' AND mg.value_text = :gorsel_turu))
        AND (:metadata IS NULL OR NOT EXISTS (
                SELECT 1 FROM json_each(:metadata) mf
                WHERE NOT EXISTS (
                    SELECT 1 FROM asset_metadata am
                    WHERE am.asset_id = a.id
                      AND am.key = json_extract(mf.value, '$.key')
                      AND am.value_text IN (
                            SELECT value FROM json_each(json_extract(mf.value, '$.values'))))))";

/// `map_asset_row`: 0..9 COLS sirasinda, 10 favorite (0/1), 11 snippet (NULL olabilir),
/// 12 ai_analyzed (0/1), 13 ai_gorsel_turu (value_text, NULL olabilir), 14 dominant_colors
/// (JSON text, NULL olabilir). TUM map_asset_row kullanan sorgular 15 sutun (bu sirada) uretmeli.
/// `pub(crate)`: `trash::list_trash` ayni AssetRow seklini yeniden kullanir.
pub(crate) fn map_asset_row(r: &Row) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        id: r.get(0)?,
        path: r.get(1)?,
        file_name: r.get(2)?,
        ext: r.get(3)?,
        size_bytes: r.get(4)?,
        mime: r.get(5)?,
        title: r.get(6)?,
        created_at: r.get(7)?,
        modified_at: r.get(8)?,
        indexed_at: r.get(9)?,
        favorite: r.get::<_, i64>(10)? != 0,
        snippet: r.get(11)?,
        ai_analyzed: r.get::<_, i64>(12)? != 0,
        ai_gorsel_turu: r.get::<_, Option<String>>(13)?,
        dominant_colors: r
            .get::<_, Option<String>>(14)?
            .and_then(|json| serde_json::from_str::<Vec<DominantColor>>(&json).ok())
            .unwrap_or_default(),
        // Semantik skor yalniz `semantic_search` yolunda doldurulur (kNN cosine); diger tum
        // okuma yollari (list/FTS/fuzzy/detay/trash) → None (tele girmez, skip_serializing_if).
        score: None,
    })
}

/// `CollectionRef` satir esleyici (id, name, color, count sirasinda 4 sutun).
fn map_collection_row(r: &Row) -> rusqlite::Result<CollectionRef> {
    Ok(CollectionRef {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        count: r.get(3)?,
    })
}

/// Bir tam dosya yolundan **ust-dizini** turet (son ayraca kadarki on-ek). Hem `/`
/// hem `\` ayracini destekler (Windows + POSIX, karisik de olabilir) → ikisinden
/// **son geleni** kesim noktasi alinir. Ayrac yoksa `None` (ust-dizini olmayan ciplak
/// ad). Tek-ayrac kalan kok (or. "/a.txt" → "/", "C:\\x" → "C:\\") korunur.
///
/// std::path KULLANILMAZ: o, calisan OS'a baglidir (Windows'ta `/` ayrac ama POSIX'te
/// `\` dosya-adi-karakteri) → DB'deki yollar farkli OS'tan gelmis olabilir. Manuel
/// rfind ile her iki ayrac da her platformda tutarli ele alinir.
fn parent_dir(path: &str) -> Option<&str> {
    let last_sep = path.rfind(['/', '\\'])?;
    if last_sep == 0 {
        // Kok ayrac (or. "/dosya") → kok "/" doner.
        Some(&path[..1])
    } else {
        Some(&path[..last_sep])
    }
}

/// LIKE on-eki icin joker karakterleri escape et: `\` `%` `_` → `\\` `\%` `\_`.
/// `ESCAPE '\'` ile birlikte kullaniciin yolu LITERAL eslesir (joker yorumlanmaz,
/// SQL-injection yok — deger her zaman parametre olarak baglanir). `None` → `None`
/// (filtre yok). Sonuca `'%'` SQL tarafinda eklenir (yalniz on-ek eslesmesi).
/// `pub(crate)`: semantic.rs ayni FILTER_FRAG'i kullandigindan path_prefix'i ayni escape eder.
pub(crate) fn escape_like_prefix(prefix: Option<&str>) -> Option<String> {
    prefix.map(|p| {
        let mut out = String::with_capacity(p.len());
        for ch in p.chars() {
            if matches!(ch, '\\' | '%' | '_') {
                out.push('\\');
            }
            out.push(ch);
        }
        out
    })
}

/// `FILTER_FRAG`'in adli parametre degerlerini SAHIPLENEN paket — uretilen referanslar
/// (`&dyn ToSql`) sorgu calistirmasi boyunca yasasin diye locallerde tutulur. **Cok-degerli
/// facet'ler** (ext/tag/collection/approval) JSON dizi metnine cevrilir; `FILTER_FRAG`
/// icinde `json_each(...)` → `IN (...)` olur (facet-ici OR; facet-arasi AND). Bos liste →
/// `None` (o facet filtre disi: `:x IS NULL` dali). Tekil alanlar (fav/tarih/yol) aynen.
/// TUM filtre-kullanan yollar (list/fuzzy/semantik/hibrit/gorsel) bunu paylasir → filtre
/// baglama icin TEK dogruluk noktasi (kopya-yapistir 7 binding blogu kaldirildi).
pub(crate) struct FilterBinds {
    ext: Option<String>,
    tag: Option<String>,
    collection: Option<String>,
    project: Option<String>,
    approval: Option<String>,
    client: Option<String>,
    version: Option<String>,
    dyear: Option<String>,
    fav: i64,
    mod_after: Option<i64>,
    mod_before: Option<i64>,
    path_prefix: Option<String>,
    /// Tri-state AI-analiz filtresi: None → NULL (filtre yok) · Some(true) → 1 (yalniz analizli) ·
    /// Some(false) → 0 (yalniz hic analize girmemis gorseller; bkz `FILTER_FRAG` doc'u).
    /// `FILTER_FRAG` `:ai_analyzed` dali bunu tuketir.
    ai_analyzed: Option<i64>,
    /// Gorsel medya turu filtresi (tekil): None → NULL (filtre yok) · Some(token) → yalniz o
    /// `ai_gorsel_turu` EAV degeri. `FILTER_FRAG` `:gorsel_turu` dali bunu tuketir (parametre).
    gorsel_turu: Option<String>,
    /// Genel EAV filtresi: None → NULL (filtre yok) · Some(JSON) → `[{"key":..,"values":[..]}]`.
    /// `FILTER_FRAG` `:metadata` dali bunu `json_each`/`json_extract` ile acar.
    metadata: Option<String>,
}

impl FilterBinds {
    /// `ListOpts`'tan filtre baglarini turet (cok-degerli alanlar JSON dizi metnine).
    pub(crate) fn new(opts: &ListOpts) -> Self {
        FilterBinds {
            ext: json_list_str(&opts.ext),
            tag: json_list_str(&opts.tag),
            collection: json_list_i64(&opts.collection),
            project: json_list_i64(&opts.project),
            approval: json_list_str(&opts.approval_status),
            client: json_list_str(&opts.client_name),
            version: json_list_str(&opts.version_label),
            dyear: json_list_str(&opts.deadline_year),
            fav: i64::from(opts.favorites_only),
            mod_after: opts.modified_after,
            mod_before: opts.modified_before,
            path_prefix: escape_like_prefix(opts.path_prefix.as_deref()),
            // Tri-state: None → None (NULL, filtre yok); Some(bool) → Some(1/0).
            ai_analyzed: opts.ai_analyzed.map(i64::from),
            // Tekil: None → NULL (filtre yok); Some(token) → deger olarak baglanir.
            gorsel_turu: opts.gorsel_turu.clone(),
            metadata: json_meta_filters(&opts.metadata),
        }
    }

    /// `FILTER_FRAG`'in adli parametreleri. Donen referanslar `self`'e baglidir → `self`
    /// sorgu calistirmasi boyunca yasamali (cagiranlar `FilterBinds`'i locale baglar).
    /// `:match` (FTS) bu sete DAHIL DEGIL; cagiran ayrica ekler (yalniz FTS yolunda).
    pub(crate) fn params(&self) -> Vec<(&str, &dyn rusqlite::ToSql)> {
        vec![
            (":ext", &self.ext),
            (":tag", &self.tag),
            (":fav", &self.fav),
            (":collection", &self.collection),
            (":project", &self.project),
            (":mod_after", &self.mod_after),
            (":mod_before", &self.mod_before),
            (":approval", &self.approval),
            (":client", &self.client),
            (":version", &self.version),
            (":dyear", &self.dyear),
            (":path_prefix", &self.path_prefix),
            (":ai_analyzed", &self.ai_analyzed),
            (":gorsel_turu", &self.gorsel_turu),
            (":metadata", &self.metadata),
        ]
    }
}

/// `ListOpts::metadata`'yi `FILTER_FRAG` `:metadata` dalinin bekledigi JSON'a cevir.
/// **Degeri bos olan girdiler ELENIR** ("anahtari sec ama deger secme" = o anahtarda filtre yok;
/// elenmezse ic `IN (...)` hicbir seyle eslesmez ve liste sessizce BOSALIRDI). Eleme sonrasi
/// hicbir girdi kalmadiysa `None` → dal tumuyle kisa-devre eder (diger facet'lerle ayni desen).
fn json_meta_filters(filters: &[MetaFilter]) -> Option<String> {
    let live: Vec<&MetaFilter> = filters.iter().filter(|f| !f.values.is_empty()).collect();
    if live.is_empty() {
        return None;
    }
    // serde_json dogru kacisi saglar (tirnak/ters-bolu/Unicode) → deger PARAMETRE olarak
    // baglanir, anahtar adi dahil hicbir sey SQL'e gomulmez (injection yok).
    let payload: Vec<serde_json::Value> = live
        .iter()
        .map(|f| serde_json::json!({ "key": f.key, "values": f.values }))
        .collect();
    serde_json::to_string(&payload).ok()
}

/// Bos olmayan string listesini JSON dizi metnine (`["a","b"]`) cevir → `json_each` icin.
/// Bos → `None` (filtre yok). `serde_json` dogru kacisi saglar (tirnak/ters-bolu/Unicode
/// guvenli) → deger PARAMETRE olarak baglanir, injection yok. Serileştirme pratikte asla
/// basarisiz olmaz; yine de olursa filtreyi guvenli tarafta (uygulanmamis) birak.
fn json_list_str(vals: &[String]) -> Option<String> {
    if vals.is_empty() {
        None
    } else {
        serde_json::to_string(vals).ok()
    }
}

/// Bos olmayan i64 listesini JSON dizi metnine (`[1,2]`) cevir → `json_each` icin. Bos → `None`.
fn json_list_i64(vals: &[i64]) -> Option<String> {
    if vals.is_empty() {
        None
    } else {
        serde_json::to_string(vals).ok()
    }
}

/// Sayfa boyu kelepceleme: <=0 → 50, ust sinir 500.
fn clamp_page_size(n: i64) -> i64 {
    if n <= 0 {
        50
    } else {
        n.min(500)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `parent_dir`: her iki ayrac (/, \), karisik, kok ve ayracsiz durumlar.
    #[test]
    fn parent_dir_handles_both_separators() {
        // POSIX.
        assert_eq!(parent_dir("/a/b/1.pdf"), Some("/a/b"));
        assert_eq!(parent_dir("/1.pdf"), Some("/")); // kok
        // Windows.
        assert_eq!(parent_dir(r"C:\proj\villa\2.dwg"), Some(r"C:\proj\villa"));
        // Karisik ayrac → son gelen ayrac kesim noktasi.
        assert_eq!(parent_dir(r"C:\proj/villa\3.dxf"), Some(r"C:\proj/villa"));
        assert_eq!(parent_dir("/a/b\\c.txt"), Some("/a/b"));
        // Ayrac yok → ust-dizin yok.
        assert_eq!(parent_dir("a.txt"), None);
        assert_eq!(parent_dir(""), None);
    }

    /// `escape_like_prefix`: joker karakterler (`%` `_` `\`) escape, digerleri aynen.
    #[test]
    fn escape_like_prefix_escapes_wildcards() {
        assert_eq!(escape_like_prefix(None), None);
        assert_eq!(escape_like_prefix(Some("/a/b")).as_deref(), Some("/a/b"));
        // Joker karakterler escape edilir (literal eslesir).
        assert_eq!(escape_like_prefix(Some("/a_b")).as_deref(), Some(r"/a\_b"));
        assert_eq!(escape_like_prefix(Some("/50%")).as_deref(), Some(r"/50\%"));
        // Ters-bolu once gelir (kendisi de escape).
        assert_eq!(escape_like_prefix(Some(r"C:\x")).as_deref(), Some(r"C:\\x"));
    }

    /// `FILTER_FRAG`'in `:ai_analyzed = 0` dali iki anahtari SABIT olarak gomer (const bir `&str`
    /// oldugu icin `format!` kullanilamaz). Bu test o gomulu metinleri asil sabitlere baglar →
    /// biri yeniden adlandirilirsa filtre sessizce hicbir seyi eslememeye baslamak yerine
    /// derleme-sonrasi ilk testte patlar.
    #[test]
    fn filter_frag_ai_branch_matches_constants() {
        assert_eq!(crate::AI_ATTEMPT_FAILED_KEY, "ai_attempt_failed");
        assert_eq!(crate::index_skips::IndexStage::Vision.as_str(), "vision");
        assert!(FILTER_FRAG.contains("'ai_analyzed', 'ai_attempt_failed'"));
        assert!(FILTER_FRAG.contains("s.stage = 'vision'"));
        assert!(FILTER_FRAG.contains("FROM asset_thumbnails th"));
    }
}

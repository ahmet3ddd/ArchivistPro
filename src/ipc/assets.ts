// IPC alan modulu: asset listeleme/arama (FTS5) + detay + thumbnail + facet + dashboard
// sorgu yuzeyi ve ortak okuma DTO'lari (AssetRow/ListOpts/Facet...).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { invoke } from "@tauri-apps/api/core";

export type AssetSort =
  | "modified_desc"
  | "modified_asc"
  | "name_asc"
  | "name_desc"
  | "type_asc"
  | "type_desc"
  | "size_asc"
  | "size_desc"
  | "created_asc"
  | "created_desc"
  | "path_asc"
  | "path_desc";

export interface AssetRow {
  id: number;
  path: string;
  file_name: string;
  ext: string | null;
  size_bytes: number;
  mime: string | null;
  title: string | null;
  created_at: number;
  modified_at: number;
  indexed_at: number | null;
  favorite: boolean;
  /** AI gorsel-analizi yapildi mi (vision pipeline `ai_analyzed` marker). Grid rozeti + "AI
   *  analizi" filtresi bunu okur. Backend `AssetRow`'a snake_case ekler; analiz edilmemis/
   *  gorsel-olmayan asset'lerde false. */
  ai_analyzed: boolean;
  /** AI gorsel turu (vision pipeline `ai_gorsel_turu`): kanonik token
   *  "Fotoğraf"|"Render"|"Doku" veya null. `ai_analyzed` ile AYNI yoldan gelir
   *  (analiz edilmemis/gorsel-olmayan asset'te null). Grid karti renkli tur noktasi
   *  bunu okur; `gorselTuruMeta` (tek kaynak) token->etiket+renk esler. Bos/null → gosterilmez. */
  ai_gorsel_turu?: string | null;
  /** CIELAB-tabanli cikaricinin buldugu baskin renkler. Eski LAN hostlari alani
   *  gondermeyebilir; kart/detay bunu bos palet gibi ele alir. */
  dominant_colors?: DominantColor[];
  /** FTS eslesme parcasi ("neden"); eslesenler .. ile isaretli. Yoksa null. */
  snippet: string | null;
  /** Anlamli (semantik) arama isabetinin GERCEK cosine benzerligi (0..1; yuksek = daha benzer).
   *  YALNIZ `semantic_search` / `remote_semantic_search` items'i tasir (backend `skip_serializing_if`
   *  → normal liste/FTS/detay yolunda alan HIC gelmez → undefined). Kartta % benzerlik rozeti bunu
   *  okur (`Math.round(score*100)`). */
  score?: number;
}

export interface DominantColor {
  r: number;
  g: number;
  b: number;
  percentage: number;
}

export interface AssetPage {
  total: number;
  items: AssetRow[];
}

/** GPS konumlu aktif varlik; yerel Harita gorunumunun dar aktarim tipi. */
export interface GeoAsset { id: number; file_name: string; path: string; latitude: number; longitude: number; }
/** Bir version iliski zincirinin zaman sirali halkasi. */
export interface VersionTimelineItem { id: number; file_name: string; path: string; modified_at: number; }

/** Bir arama isabetinin alan-atfi ("neden bu sonuc") — sunucu-tarafi `MatchSource` ile
 *  birebir. `field`: eslesen FTS sutunu ("file_name"|"title"|"description"|"body"|"ai").
 *  `group`: UI gruplamasi ("meta"|"file"|"ai"). `snippet`: eslesen pencere; eslesenler
 *  char(2)/char(3) ile isaretli (AssetCard FTS snippet'iyle AYNI isaretleyici → ayni vurgu
 *  bileseniyle cozulur). Yalniz keyword (FTS) aramada anlamli. */
export interface MatchSource {
  field: string;
  group: string;
  snippet: string;
}

/** Bir klasor (ust-dizin) ozeti — yol + altindaki dogrudan asset sayisi
 *  (sunucu-tarafi `FolderSummaryDto` ile birebir). "Klasorler" gorunumunun kart
 *  verisi; `assets.path`'ten turetilir. Karta tiklayinca `ListOpts.path_prefix`
 *  = path ayarlanir → liste o klasore filtrelenir. */
export interface FolderSummaryDto {
  path: string;
  file_count: number;
  /** Bu klasordeki en son indeksleme zamani (unix SANIYE; JS Date icin ×1000).
   *  Backend doldurur; hic indekslenmemis/eski arsivde undefined olabilir. Klasor
   *  kartinda "son tarama" rozeti + `lastScan` siralamasi bunu kullanir. */
  last_indexed?: number;
}

export interface MetaEntry {
  key: string;
  value_text: string | null;
  value_num: number | null;
}

export interface TagRef {
  name: string;
  kind: string; // user | auto | system
  color: string | null;
}

/** Bir koleksiyon (id + ad + renk + uye sayisi). */
export interface CollectionRef {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

/** Proje-durum alanlari (H2 pariti) — sunucu-tarafi `ProjectMetaOut` (query DTO)
 *  ile birebir (snake_case). Hepsi kullanici-tanimli, opsiyonel. `approval_status`:
 *  "draft" | "review" | "approved" | "rejected" (null = ayarlanmamis). */
export interface ProjectMeta {
  client_name: string | null;
  approval_status: string | null;
  rejection_reason: string | null;
  version_label: string | null;
  deadline: string | null; // ISO YYYY-MM-DD
}

/** Asset'in atandigi PROJE (entity, 0019). `client_name` proje-DUZEYI musteri → asset'in kendi
 *  `project.client_name`'i bosken GORUNUMDE devralinir (inheritance; veri kopyalanmaz).
 *  `null`/undefined = projesiz. */
export interface AssignedProject {
  id: number;
  name: string;
  client_name: string | null;
}

export interface AssetDetail {
  asset: AssetRow;
  metadata: MetaEntry[];
  tags: TagRef[];
  collections: CollectionRef[];
  /** Proje-durum alanlari (H2 pariti; PER-ASSET) — musteri/onay/versiyon/teslim. */
  project: ProjectMeta;
  /** Atandigi proje (entity) — `client_name` inheritance icin proje-duzeyi client de gelir. */
  assigned_project?: AssignedProject | null;
  /** RAG'den manuel dislandi mi (hassasiyet filtresi, A1). True → sohbet bu dosyanin
   *  parcalarini getirmez. "Parçalar" sekmesindeki toggle bunu yansitir/degistirir. */
  rag_excluded: boolean;
}

/** `list_assets` (birlesik liste/arama) sorgu secenekleri. `query` doluysa FTS5
 *  (rank), bossa filtreli liste (sort). Filtreler her iki durumda da uygulanir. */
export interface ListOpts {
  page: number;
  page_size: number;
  sort: AssetSort;
  query: string | null; // FTS5 (boolean/tumce destekli); null/bos → filtreli liste
  fuzzy: boolean; // query doluyken Levenshtein-yakin (yazim-hatasi toleransi)
  // Cok-degerli facet'ler — her biri DIZI (Rust ListOpts Vec ile birebir). Bos dizi =
  // o facet filtre yok. Facet-ici OR (listedeki degerlerden herhangi biri), facet-arasi AND.
  ext: string[];
  tag: string[];
  collection: number[];
  modified_after: number | null; // unix saniye (dahil)
  modified_before: number | null; // unix saniye (dahil)
  favorites_only: boolean;
  // Onay durumu filtresi (H2 pariti) — cok-degerli (OR; proje-durum faceti). Bos dizi =
  // filtre yok; diger filtrelerle AND. NOT: anahtar `approval_status` (snake) — Rust serde
  // alaniyla birebir (eski camelCase `approvalStatus` serde tarafindan yutuluyordu → HATA).
  approval_status: string[];
  // Proje-durum facet filtreleri (H2-otesi; non-destructive) — hepsi cok-degerli (OR ici,
  // AND arasi). Rust ListOpts Vec alanlariyla birebir (snake). Bos dizi = o facet filtre yok.
  // `deadline_year`: termin YILI ("2026"; substr(deadline,1,4) ile eslesir).
  client_name: string[];
  version_label: string[];
  deadline_year: string[];
  // Proje (entity) filtresi — cok-degerli (OR; `assets.project_id` ∈ liste). Rust ListOpts
  // `project: Vec<i64>` ile birebir. Bos dizi = filtre yok; diger filtrelerle AND. Tipik
  // kullanim tek proje ([id]) — "bir projenin asset'leri" ana liste filtresiyle gosterilir.
  project: number[];
  // Klasor filtresi (Faz 7.2): doluysa yalniz bu on-ekle baslayan path'ler (alt-dizinler
  // dahil); diger filtrelerle AND. null/yok → klasor filtresi uygulanmaz.
  path_prefix?: string | null;
  // AI gorsel-analizi filtresi (tri-state): `true` = yalniz analiz edilmis, `false` = yalniz
  // analiz edilmemis, undefined/yok = filtre yok. Rust ListOpts `ai_analyzed: Option<bool>` ile
  // birebir; diger filtrelerle AND.
  ai_analyzed?: boolean;
  // Gorsel turu filtresi (AI vision `ai_gorsel_turu`): kanonik token ("Fotoğraf"|"Render"|"Doku")
  // veya null/yok = filtre yok. Rust ListOpts `gorsel_turu: Option<String>` ile birebir (ai_analyzed
  // ile ayni konvansiyon); diger filtrelerle AND.
  gorsel_turu?: string | null;
  // GENEL metadata (EAV) filtresi — cikarici-uretimi anahtarlar (`unit_type`, `version`, ...).
  // Her girdi bir anahtar + secili degerleri: anahtar-ici OR, anahtarlar-arasi AND (diger
  // facet'lerle ayni semantik). Bos dizi / yok = filtre yok. Rust `ListOpts.metadata` ile birebir.
  // Yeni bir metadata facet'i eklemek icin BU tip degismez — yalniz UI yeni bir anahtar gonderir.
  metadata?: MetaFilterDto[];
}

/** Tek metadata anahtari icin secili degerler (Rust `MetaFilter` ile birebir). */
export interface MetaFilterDto {
  key: string;
  values: string[];
}

export interface ThumbnailDto {
  asset_id: number;
  mime: string;
  width: number;
  height: number;
  data_base64: string;
}

export interface Facet {
  value: string | null; // uzanti veya metadata degeri; null = yok
  count: number;
}

/** Bir ay kovasi — "YYYY-MM" + o aydaki asset sayisi (Dashboard zaman serisi;
 *  sunucu-tarafi `MonthCountDto` ile birebir). */
export interface MonthCount {
  month: string; // "YYYY-MM" (her zaman 7 karakter)
  count: number;
}

/** Bir uzanti + o uzantinin TOPLAM boyutu (bayt) — format-bazli boyut karti (sunucu `ExtSize`). */
export interface ExtSize {
  value: string | null; // uzanti; null = uzantisiz
  size: number; // toplam bayt
}

/** Dashboard ozet istatistikleri (sunucu-tarafi `DashboardStatsDto` ile birebir).
 *  Renderer TOPLAMAZ — DB toplar; bu yalniz cizilir. `ext_counts` `ext_facets` ile
 *  ayni `Facet` sekli (en cok ~12, count azalan). `month_counts` SEYREK: yalniz verisi
 *  olan son-12-ay kovalari (artan; sifir aylar atlanir). */
export interface DashboardStatsDto {
  total_assets: number; // COUNT(*)
  total_size: number; // SUM(size_bytes) bayt; bos DB'de 0
  ext_counts: Facet[]; // en cok ~12 uzanti (count azalan)
  size_by_ext: ExtSize[]; // format-bazli toplam boyut (en cok 8, boyut azalan)
  month_counts: MonthCount[]; // son-12-ay serisi, artan, SEYREK
  approval_counts: Facet[]; // review → draft → rejected → approved
  active_projects: number; // kullanilan (atanmis) benzersiz proje sayisi
  indexed_assets: number; // metni cikarilmis asset sayisi (icerikten aranabilir); total ile "N/M"
  architectural_styles: Facet[]; // vision AI: en cok 8 kanonik mimari stil
  material_groups: Facet[]; // vision AI: en cok 8 kanonik malzeme
}

/** Aktivite ozeti girdisi (ad + sayi) — en aktif kullanici / islem turu. */
export interface ActivityCount {
  name: string;
  count: number;
}

/** Son 7 gunun audit_log aktivite ozeti (sunucu `ActivitySummary`; admin-only komut). */
export interface ActivitySummary {
  total_ops: number;
  top_users: ActivityCount[]; // en aktif 5 kullanici
  top_actions: ActivityCount[]; // en cok 6 islem turu
}

/** Asset liste/detay/facet/dashboard komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const assetsIpc = {
  listAssets: (opts: ListOpts): Promise<AssetPage> =>
    invoke<AssetPage>("list_assets", { opts }),

  getAsset: (id: number): Promise<AssetDetail | null> =>
    invoke<AssetDetail | null>("get_asset", { id }),


  geoAssets: (): Promise<GeoAsset[]> => invoke<GeoAsset[]>("geo_assets"),
  versionTimeline: (assetId: number): Promise<VersionTimelineItem[]> => invoke<VersionTimelineItem[]>("version_timeline", { assetId }),

  /** Bir asset icin sorgunun alan-atfi ("neden bu sonuc"): sorgu hangi FTS sutunlarinda
   *  eslesti. Yalniz YEREL keyword (FTS) aramada anlamli; bos/eslesmeyen sorgu → []. */
  matchSources: (id: number, query: string): Promise<MatchSource[]> =>
    invoke<MatchSource[]>("match_sources", { id, query }),

  getThumbnails: (ids: number[]): Promise<ThumbnailDto[]> =>
    invoke<ThumbnailDto[]>("get_thumbnails", { ids }),

  /** Aktif yerel video asset'ini Tauri Range-destekli asset protokolune tek-dosya olarak acar. */
  prepareMediaSource: (id: number): Promise<string> =>
    invoke<string>("prepare_media_source", { id }),

  extFacets: (): Promise<Facet[]> => invoke<Facet[]>("ext_facets"),

  /** Gorsel turune gore asset sayilari (AI vision `ai_gorsel_turu` faceti; Fotoğraf/Render/Doku).
   *  `extFacets` ile ayni `Facet` sekli (value = kanonik token, count). Salt-okuma (her rol). */
  gorselTuruFacets: (): Promise<Facet[]> => invoke<Facet[]>("gorsel_turu_facets"),

  /** Klasor ozetleri (ust-dizine gore gruplu asset sayilari, en cok ilk; cap 1000).
   *  "Klasorler" gorunumunun kart verisi. */
  folderSummary: (): Promise<FolderSummaryDto[]> =>
    invoke<FolderSummaryDto[]>("folder_summary"),

  /** Arsiv ozet istatistikleri (Dashboard): toplam sayi/boyut + uzanti dagilimi +
   *  son-12-ay zaman serisi + onay kuyrugu. Salt-okuma (her rol). Renderer toplamaz; yalniz cizer.
   *  `pathPrefix` verilirse istatistik O KLASORE (alt-dizinler dahil) kapsamlanir;
   *  null/undefined → tum arsiv (backend None → global; geriye-uyumlu). */
  dashboardStats: (pathPrefix?: string | null): Promise<DashboardStatsDto> =>
    invoke<DashboardStatsDto>("dashboard_stats", { pathPrefix: pathPrefix ?? null }),

  /** Son 7 gunun aktivite ozeti (toplam islem + en aktif kullanici + islem turleri).
   *  YALNIZ admin (backend `require_admin`); viewer/editor cagirirsa hata → cagiran (Pano)
   *  yalniz admin icin cagirir. Arsiv-geneli (path-kapsamsiz; audit asset degil). */
  dashboardActivity: (): Promise<ActivitySummary> =>
    invoke<ActivitySummary>("dashboard_activity"),

  /** ⚠️ SU AN CAGIRANI YOK — ama SILINMEDI, bilerek (2026-07-18 olu-kod taramasi).
   *  Olu olmasinin sebebi kotu kod degil **bitirilmemis ozellik**: kenar cubugu icerik-facet'leri
   *  (H2 `data.ts:394-430` kategori/asama/malzeme) H3'e tasinmadi. H3'un metadata'si ise H2'den
   *  DAHA iyi — gercek cikarim verisi (dev DB olcumu: `unit_type` 3 deger [Santimetre/Metre/
   *  Milimetre] · `scale` 2 [1:1, 1/50] · `version` 5 [AutoCAD 2007/2010/2011...]) → hepsi
   *  dusuk-kardinaliteli, mimarlik arsivi icin birinci sinif filtre.
   *  BAGLAMAK ICIN EKSIK OLAN: `ListOpts`'ta genel metadata key/value FILTRESI yok → facet'i
   *  gostermek yetmez, filtreleyememek gerekir. Yani bu bir OZELLIK isi, temizlik degil.
   *  Karar kullaniciya birakildi (bkz docs/H2_PARITY.md ⏳ tablosu #11). */
  metadataFacets: (key: string, limit: number): Promise<Facet[]> =>
    invoke<Facet[]>("metadata_facets", { key, limit }),
};

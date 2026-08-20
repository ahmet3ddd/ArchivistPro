// UI/sorgu durumu — Zustand slice (tek-bag store YOK; odakli UI dilimi).
//
// Renderer DB tutmaz; bu store yalniz "su an hangi sorgu/secim gosteriliyor"u tutar.
// Veri komutlardan sorgu-hook'lariyla gelir. Sayfalama hook icinde (sonsuz-kaydirma)
// yonetilir — store'da page yok; sorgu/sirala/ext/tag/favori degisince hook sifirlanir.

import { create } from "zustand";

import type { AssetSort, StaleKind, StalenessReport } from "../ipc/client";
import {
  initialCardSize,
  initialSort,
  saveCardSize,
  saveSort,
} from "../features/explorer/explorerPrefs";
import type { Accent, Theme } from "../theme";
import { applyAccent, applyTheme, initialAccent, initialTheme } from "../theme";
import type { AssetSource } from "./assetSource";
import { isRemoteView, sourceSwitchReset } from "./assetSource";

/** Ana gorunum kipi (sol serit ActivityBar gorunum-secici). H2 pariti: baglam-once gezinme. */
export type ViewMode = "folders" | "explorer" | "dashboard" | "technical" | "chat" | "map";

// Arsiv kaynagi (LAN Faz 2): tip + kaynak-degisimi sifirlamasi saf modulde (test edilebilirlik).
export type { AssetSource } from "./assetSource";

/** Son dosya-guncellik denetiminin Doctor'da tekrar kullanilabilecek hafif gorunum verisi.
 *  Kart rozetleri icin gereken tum kimlikler ayri `stalenessById` kaydinda tutulur; burada ise
 *  yalnizca sayimlar ve en cok 200 sorun ornegi tutulur. */
export type StalenessDisplayReport = Pick<
  StalenessReport,
  "total" | "ok" | "stale" | "missing" | "offline" | "samples"
>;

/** Sol serit (ActivityBar) → TopBar overlay acma istegi. Bu araclar/Ayarlar TopBar'da modal
 *  olarak render edilir (mevcut "Ayarlar'a geri don" mantigi orada) → serit onlari DOGRUDAN
 *  acamaz; bir istek birakir, TopBar effect'i tuketip ilgili modal'i acar. */
export type OverlayKind = "settings" | "visual" | "shape" | "dedup";

/** Sag-tik menusu Kopya Bulucu'yu belirli bir yerel asset'e odaklayabilir. */
export interface DedupSeed {
  id: number;
  name: string;
}

// Gezgin gorunum tercihleri (kart boyutu + siralama) artik oturumlar arasi KALICI —
// saf yardimcilar `features/explorer/explorerPrefs.ts`'te (gerekce + H2 kaniti orada).
export { DEFAULT_CARD_SIZE } from "../features/explorer/explorerPrefs";

/** Herhangi bir filtre/arama aktif mi? (baglam-once gezinme + "tumunu temizle" tetigi) */
export function anyFilterActive(s: Pick<
  UiState,
  | "query"
  | "geoListIds"
  | "ext"
  | "tag"
  | "collection"
  | "project"
  | "dateFrom"
  | "dateTo"
  | "favoritesOnly"
  | "pathPrefix"
  | "approvalStatus"
  | "clientName"
  | "versionLabel"
  | "deadlineYear"
  | "aiAnalyzed"
  | "gorselTuru"
  | "metadata"
>): boolean {
  return (
    s.query.trim() !== "" ||
    s.geoListIds != null ||
    s.ext.length > 0 ||
    s.tag.length > 0 ||
    s.collection.length > 0 ||
    s.project.length > 0 ||
    s.dateFrom !== "" ||
    s.dateTo !== "" ||
    s.favoritesOnly ||
    s.pathPrefix != null ||
    s.approvalStatus.length > 0 ||
    s.clientName.length > 0 ||
    s.versionLabel.length > 0 ||
    s.deadlineYear.length > 0 ||
    s.aiAnalyzed != null ||
    s.gorselTuru != null ||
    Object.values(s.metadata).some((v) => v.length > 0)
  );
}

/** Bir filtre/arama anlik goruntusu — preset olarak kaydedilebilir/uygulanabilir.
 *  Cok-degerli facet'ler (ext/tag/collection/approvalStatus) DIZI olarak saklanir. */
export interface FilterSnapshot {
  query: string;
  /** Arama sorgusunun FTS mi semantik mi calisacagini belirler; preset sonucu deterministik olur. */
  semanticMode: boolean;
  sort: AssetSort;
  ext: string[];
  tag: string[];
  collection: number[];
  project: number[];
  dateFrom: string;
  dateTo: string;
  favoritesOnly: boolean;
  pathPrefix: string | null;
  approvalStatus: string[];
  clientName: string[];
  versionLabel: string[];
  deadlineYear: string[];
  // AI gorsel-analizi tri-state filtresi: true = yalniz analizli, false = yalniz analizsiz,
  // null = filtre yok. Eski (alansiz) preset'lerde undefined → null'a normallenir.
  aiAnalyzed: boolean | null;
  // Gorsel turu filtresi (AI vision): kanonik token ("Fotoğraf"|"Render"|"Doku") veya null (tumu).
  // Eski (alansiz) preset'lerde undefined → null'a normallenir.
  gorselTuru: string | null;
  // GENEL metadata (EAV) facet secimleri: anahtar → secili degerler. Eski (alansiz)
  // preset'lerde undefined → {} (filtre yok). Yeni bir metadata facet'i bu tipi DEGISTIRMEZ.
  metadata: Record<string, string[]>;
}

/** Eski (skaler/null) kayitli preset'leri cok-degerli diziye normalle (geriye uyum). */
function normArrStr(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}
function normArrNum(v: number[] | number | null | undefined): number[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

interface UiState {
  // ── Sorgu/filtre durumu ──
  query: string;
  sort: AssetSort;
  // "Benzer gorseller" (Faz 5.3) — gorsel→gorsel modu. Bir asset id'si set'liyse liste
  // o gorselin CLIP komsulariyla degisir (sorgu/filtre yolu yerine). null = kapali.
  // `similarToName` yalniz banner basligi icin (gorsel adi); preset'e GIRMEZ (geciici).
  similarTo: number | null;
  similarToName: string | null;
  /** Renk-yakinligi aramasi hedefi (detay panelindeki kartelanin "bu renge yakinlari bul"u).
   *  `similarTo` ile AYNI aile: gecici bir SONUC KAPSAMI — preset'e girmez, kaynak degisiminde
   *  ve filtre sifirlamada temizlenir. */
  colorSearch: { r: number; g: number; b: number } | null;
  geoListIds: number[] | null;
  // En son AKILLI ARAMA / benzer-gorsel sonucunun toplam sayisi (top-k tek sayfa). Grid
  // (useInfiniteAssets) yazar; TopBar sayaci (useAssetTotal) arama aktifken BUNU okur — aksi
  // halde list_assets FTS-sayimi grid'in gosterdigi sonucla CELISIR ("0 sonuç" vs N asset).
  // Gozatta (sorgu bos) null.
  searchResultTotal: number | null;
  // ANLAMLI (semantik) arama modu (LAN Faz 5) — SearchBar keyword↔anlamli gecisi. AÇIK + sorgu
  // DOLU iken: yerel → `semantic_search`, uzak → `remote_semantic_search` (vektor kNN, % rozet).
  // KAPALI: klasik FTS. Kaynaktan BAGIMSIZ (query/sort gibi) → kaynak degisiminde SIFIRLANMAZ
  // (yereldeki anlamli sorguyu ana arsivde de calistirmak ozelligin amaci). Bos sorguda etkisiz.
  semanticMode: boolean;
  // Cok-degerli facet'ler — her biri DIZI; facet-ici OR (secili degerlerden herhangi
  // biriyle eslesme), facet-arasi AND. Bos dizi = o facet filtre disi.
  ext: string[];
  tag: string[]; // etiket filtresi (facet) — cok-degerli (OR)
  collection: number[]; // koleksiyon filtresi (facet) — cok-degerli (OR)
  // Proje (entity) filtresi — cok-degerli (OR; `assets.project_id`). Bos = filtre yok.
  // Tipik tek proje ([id]): "bir projenin asset'leri" ana liste project=[id] ile gosterilir.
  project: number[];
  dateFrom: string; // modified alt sinir (YYYY-MM-DD; "" = yok)
  dateTo: string; // modified ust sinir (YYYY-MM-DD; "" = yok)
  favoritesOnly: boolean; // yalniz favoriler
  pathPrefix: string | null; // aktif klasor filtresi (path on-eki; null = yok). Faz 7.2
  // Onay durumu filtresi (proje-durum faceti; H2 pariti) — cok-degerli (OR). Her deger
  // "draft|review|approved|rejected". Bos dizi = filtre yok. Diger filtrelerle AND.
  approvalStatus: string[];
  // Proje-durum facet filtreleri (non-destructive; organize'a alternatif) — hepsi cok-degerli
  // (OR icinde, AND arasi). Bos dizi = o facet filtre disi. `deadlineYear`: termin YILI ("2026").
  clientName: string[];
  versionLabel: string[];
  deadlineYear: string[];
  // AI gorsel-analizi tri-state filtresi (H2-otesi; gorunur/yonetilebilir AI). true = yalniz
  // analiz EDILMIS, false = yalniz analiz EDILMEMIS, null = filtre yok (Tumu). `favoritesOnly`
  // (boolean toggle) deseni ama UC-DURUMLU → segment kontrolu + kaldirilabilir cip.
  aiAnalyzed: boolean | null;
  // Gorsel turu filtresi (AI vision `ai_gorsel_turu`; H2-otesi) — TEKIL secim: kanonik token
  // ("Fotoğraf"|"Render"|"Doku") veya null (Tumu). Kenar-cubugu bolumunde ayni ture tekrar
  // tiklama temizler; kaldirilabilir cip. Diger filtrelerle AND.
  gorselTuru: string | null;
  // GENEL metadata (EAV) facet secimleri: anahtar → secili degerler ("unit_type" → ["Metre"]).
  // Facet basina AYRI alan acmak yerine tek kayit: yeni bir metadata facet'i eklemek bu store'u,
  // clearFilters'i, preset semasini ve tum tuketicileri DEGISTIRMEZ (yalniz yeni bir anahtar girer).
  metadata: Record<string, string[]>;
  // ── Gorunum (TopBar) ──
  // Hangi ana gorunum render ediliyor (folders/explorer/dashboard/technical).
  // Baglam-once gezinme: bir filtre/arama aktiflesince explorer'a otomatik gecilir
  // (MainViewContainer'da). Kullanici secici ile yine her gorunume gidebilir.
  viewMode: ViewMode;
  /** Gezgin hangi arsivi listeliyor: bu makine mi, LAN'daki ana arsiv mi (LAN Faz 2).
   *  `remote` iken yerel-id'ye dayanan her sey KAPALIDIR (detay paneli, etiketleme, cop,
   *  facet kenar cubugu) — uzak id'ler HOST'un id'leridir, yerel komutlara verilirse
   *  YANLIS dosyaya gider. Bkz `setAssetSource`. */
  assetSource: AssetSource;
  // ── Aktif YEREL arsiv (adlandirilmis eszamanli izole DB'ler) ──
  /** Su an secili yerel arsivin kimligi (`"main"` = ANA arsiv). `db`/`read_db` buna bagli.
   *  Gecis admin eylemidir; acilista daima `"main"`. Kimlik/yonetim (kullanici/mesaj/LAN)
   *  yalniz ANA arsivde → `activeArchiveIsMain` false iken o paneller kapilanir. */
  activeArchiveId: string;
  /** Aktif arsivin adi (ANA icin bos → UI i18n `archive.main` gosterir). */
  activeArchiveName: string;
  /** Aktif arsiv ANA mi (kimlik/yonetim kapilamasi bunu okur). */
  activeArchiveIsMain: boolean;
  // Explorer grid kart genisligi (px) — TopBar kaydiraci ile ayarlanir.
  cardSize: number;
  // ── Secim ──
  // NOT (Faz 6 / B1): rol artik BURADA degil — sunucu oturumundan (`useSessionStore`/
  // `useSession`) okunur. Istemci rolu secemez; gercek yetki Rust command'da.
  selectedId: number | null;
  // ── Coklu secim (Faz 7.5) ──
  // `selectedId` (DetayPaneli) ile AYRI tutulur: bu, toplu islem (batch toolbar +
  // baglam menusu) icin secili asset KUMESI. Duz tik detayi acar (selectedId);
  // ctrl/cmd+tik bir id'yi bu kumede degistirir; shift+tik aralik secer. Array
  // (Set degil) — Zustand sig esitlik + serilestirme dostu; uyelik kontrolu O(n)
  // ama secim tipik olarak kucuk.
  selectedIds: number[];
  // Veri-tazeleme sayaclari:
  //  - dataVersion: ingest sonrasi artar → liste + facet hepsi yeniden cagrilir.
  //  - facetVersion: etiket/favori degisince artar → facet'ler tazelenir (liste sifirlanmaz).
  dataVersion: number;
  facetVersion: number;
  //  - backupConfigVersion: otomatik-yedek ayari (interval/max) degisince artar →
  //    useBackupScheduler zamanlayiciyi yeniden kurar (localStorage'dan taze okur).
  backupConfigVersion: number;
  //  - watchConfigVersion: canli-izleme ayari (enabled/autoRescan/roots) degisince artar →
  //    useFolderWatcher watcher'lari yeniden kurar (localStorage'dan taze okur).
  watchConfigVersion: number;
  //  - remotePairingVersion: LAN eslesmesi (Ayarlar → LAN Istemci: baglan/kes) degisince artar →
  //    useRemoteArchive uzak durumu YENIDEN yoklar (aksi halde durum yalniz acilista okunur →
  //    eslesme sonrasi RELOAD'suz belirmez: staleness kusuru).
  remotePairingVersion: number;
  /** LAN istemci host'undan okunmamis bildirim sayisi (kabuk rozeti). */
  lanClientNewCount: number;
  // Favori iyimser override'lari (id → on). Anlik UI; dataVersion artinca temizlenir.
  favoriteOverrides: Record<number, boolean>;
  // Son Doctor staleness denetiminden gelen, kart rozeti için id → problem türü. Bu bir
  // dosya-sistemi sorgusu DEGIL; yeni veri geldikçe geçersizleşir.
  stalenessById: Record<number, StaleKind>;
  // Her rolün durum çubuğunda ve Admin Doctor kartında gösterebildiği son denetim özeti.
  // `problemStatuses` burada tutulmaz: onlar yalnızca rozet eşlemesi için üstteki kayıttadır.
  stalenessReport: StalenessDisplayReport | null;
  // ── Gorsel tema (Faz 8.3) ──
  // Acik/koyu + vurgu semasi. Gercek uygulama <html data-theme/data-accent> ile
  // (src/theme) — bu alanlar UI kontrolu icin durumu yansitir. Kalicilik theme
  // modulunde (localStorage). Varsayilan: koyu + indigo.
  theme: Theme;
  accent: Accent;
  // ── Kisayol yardimi + OS-klasor-drop → ingest sinyali (Faz A) ──
  // shortcutHelpOpen: '?' kisayolu ile acilan yardim overlay'i (AppShell'de render edilir).
  // ingestOpen + pendingIngestPaths: OS klasor surukle-birak (useOsFolderDrop) VEYA IngestButton
  //   VEYA RootsPanel tetikler → IngestButton, IngestModal'i bu sinyalle (yollar on-dolulu) acar.
  //   Renderer DB tutmaz; bunlar yalniz "hangi modal/hangi yollar acik" UI sinyalidir.
  //   COKLU (2026-08-11): RootsPanel "bekleyenleri tarat" TEK acilista N kok gonderir — tekil
  //   alan kalsaydi kullanici 19 kok icin paneli 19 kez acip kapamak zorunda kalirdi.
  shortcutHelpOpen: boolean;
  archivePanelOpen: boolean;
  ingestOpen: boolean;
  pendingIngestPaths: string[] | null;
  // ARKA PLAN (2026-08-11): tarama penceresi kucultulebilir. `ingestMinimized` yalniz
  // GORUNURLUGU kapatir — `IngestModal` MOUNTLU kalir, kosu/zamanlayici/rapor sozu yasar.
  // Bileseni sokup takmak calisan taramanin raporunu kaybettirirdi (kosu backend'de surer,
  // ama sonucu bekleyen soz cozuldugunde ortada onu alacak bilesen olmaz).
  ingestMinimized: boolean;
  // Arka plandaki tarama BITTI ve pencere hala gizli — raporu okunmadi.
  // NEDEN (kullanici karari 2026-08-11): kosu bitince cip "aktif tarama yok" diye kayboluyordu;
  // pencere de gizli oldugu icin RAPOR ulasilamaz kaliyordu (yeniden "Indeksle" demeden).
  // Bu bayrak cipi "Tarama bitti — raporu gor" olarak ayakta tutar.
  ingestFinishedInBackground: boolean;
  // Sol serit (ActivityBar) → overlay acma istegi (arac modallari + Ayarlar). TopBar bir effect
  // ile tuketir → ilgili modal'i acar, sonra consumeOverlayRequest ile null'a doner. Renderer DB
  // tutmaz; bu yalniz "serit hangi overlay'i acmak istedi" UI sinyalidir. null = bekleyen yok.
  overlayRequest: OverlayKind | null;
  dedupSeed: DedupSeed | null;

  // ── Eylemler ──
  setQuery: (query: string) => void;
  setSearchResultTotal: (total: number | null) => void;
  /** Anlamli-ara modunu ac/kapa (SearchBar keyword↔anlamli). Modu degistirmek liste kimligini
   *  degistirir → useInfiniteAssets yeniden sorgular (FTS ↔ semantik). */
  setSemanticMode: (on: boolean) => void;
  setSort: (sort: AssetSort) => void;
  setSimilarTo: (id: number, name: string) => void;
  clearSimilarTo: () => void;
  setGeoListIds: (ids: number[] | null) => void;
  /** Renk-yakinligi aramasini baslat/temizle (`null` → kapsam kalkar). */
  setColorSearch: (color: { r: number; g: number; b: number } | null) => void;
  // Cok-degerli facet setter'lari: setX diziyi DEGISTIRIR (or. dashboard drill-down →
  // [value]; "Tum turler" → []); toggleX bir degeri ekler/cikarir (facet satiri + cip).
  setExt: (ext: string[]) => void;
  setTag: (tag: string[]) => void;
  setCollection: (collection: number[]) => void;
  setProject: (project: number[]) => void;
  toggleExt: (v: string) => void;
  toggleTag: (v: string) => void;
  toggleCollection: (id: number) => void;
  toggleProject: (id: number) => void;
  toggleApproval: (v: string) => void;
  setDateRange: (from: string, to: string) => void;
  setFavoritesOnly: (on: boolean) => void;
  setPathPrefix: (pathPrefix: string | null) => void;
  setApprovalStatus: (approvalStatus: string[]) => void;
  setClientName: (clientName: string[]) => void;
  setVersionLabel: (versionLabel: string[]) => void;
  setDeadlineYear: (deadlineYear: string[]) => void;
  setAiAnalyzed: (aiAnalyzed: boolean | null) => void; // tri-state: true/false/null(Tumu)
  setGorselTuru: (gorselTuru: string | null) => void; // tekil: token veya null(Tumu)
  /** Bir metadata degerini ac/kapa (anahtar-ici cok-secim). Son deger kalkinca anahtar DUSER
   *  (bos dizi birakilmaz) → `anyFilterActive` ve cip listesi kendiliginden temizlenir. */
  toggleMetadata: (key: string, value: string) => void;
  /** Bir metadata anahtarinin TUM secimini kaldir (cip 'x'). */
  clearMetadataKey: (key: string) => void;
  toggleClient: (v: string) => void;
  toggleVersion: (v: string) => void;
  toggleDeadlineYear: (v: string) => void;
  clearFilters: () => void; // tum filtreleri + sorguyu temizle ("Tumunu temizle")
  setViewMode: (viewMode: ViewMode) => void;
  /** Arsiv kaynagini degistir (yerel ↔ uzak). Filtreleri + secimi SIFIRLAR — gerekce uygulamada. */
  setAssetSource: (assetSource: AssetSource) => void;
  /** YEREL arsiv gecisi UYGULA (IPC + toast cagiran bilesende; backend zaten degistirdi). Filtre/
   *  sorgu/secim SIFIRLANIR + veri/facet tazelenir → yeni arsivin (izole) verisi gorunur. Kaynak
   *  yerele cekilir (arsiv gecisi yerel kavramdir). */
  applyArchiveSwitch: (archive: { id: string; name: string; isMain: boolean }) => void;
  setCardSize: (cardSize: number) => void;
  applyPreset: (f: FilterSnapshot) => void;
  select: (selectedId: number | null) => void;
  // Coklu secim eylemleri (Faz 7.5):
  toggleSelected: (id: number) => void; // ctrl/cmd+tik — kumede degistir
  setSelectedRange: (ids: number[]) => void; // shift+tik — aralik (mevcut + birlestir)
  setSelectedMany: (ids: number[]) => void; // "tumunu sec" — kumeyi degistir
  clearSelected: () => void; // secimi bosalt
  bumpData: () => void;
  bumpFacets: () => void;
  bumpBackupConfig: () => void;
  bumpWatchConfig: () => void;
  /** LAN eslesmesi degisince (baglan/kes) cagir → useRemoteArchive durumu tazeler. */
  bumpRemotePairing: () => void;
  setLanClientNewCount: (count: number) => void;
  setFavoriteOverride: (id: number, on: boolean) => void;
  /** Tek tarama sonucunu atomik olarak kart rozetine + durum/Doctor özetine yansıtır. */
  setStalenessReport: (report: StalenessReport) => void;
  // Tema eylemleri (Faz 8.3): durumu degistir + <html> dataset uygula + kalici yap.
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  // Kisayol yardimi (Faz A): '?' overlay'ini ac/kapa.
  toggleShortcutHelp: () => void;
  setShortcutHelp: (open: boolean) => void;
  setArchivePanelOpen: (open: boolean) => void;
  // OS-klasor-drop / RootsPanel → ingest: modali (yollar on-dolulu) ac / kapat.
  // Tek yol da (string) coklu da (string[]) verilebilir; ikisi de diziye normalize edilir.
  openIngest: (paths?: string | string[] | null) => void;
  closeIngest: () => void;
  /** Tarama penceresini arka plana al / geri getir (kosu etkilenmez; yalniz gorunurluk). */
  setIngestMinimized: (minimized: boolean) => void;
  /** "Arka planda bitti, rapor okunmadi" bayragi (cip bunu gosterir). */
  setIngestFinishedInBackground: (finished: boolean) => void;
  // Sol serit overlay istegi: birak (serit) / tuket (TopBar effect).
  requestOverlay: (kind: OverlayKind) => void;
  requestDedupFor: (seed: DedupSeed) => void;
  consumeOverlayRequest: () => void;
}

/**
 * Liste ÜYELİĞİNİ değiştiren her sorgu/filtre mutasyonunda sıfırlanacak seçim alanları.
 *
 * **NEDEN (2026-07-28 UI/UX denetimi K3 — VERİ GÜVENLİĞİ):** seçim yalnız kaynak değişiminde
 * (`sourceSwitchReset`) ve `bumpData`'da temizleniyordu. Sorgu/facet/tarih/pathPrefix
 * değişimlerinde ise HAYATTA KALIYORDU — oysa liste bu değişimlerin her birinde tamamen
 * yeniden kuruluyor (`useAssets.ts` `identity`). Sonuç: kullanıcı 30 dosya seçip arama yazınca
 * grid başka dosyalar gösteriyor ama "30 seçili" çubuğu duruyordu; ardından **"Çöpe at" /
 * "Etiketle" / Delete EKRANDA OLMAYAN dosyalara uygulanıyordu** ve hangileri olduğunu görmenin
 * yolu yoktu (onay diyaloğu yalnız sayı söyler).
 *
 * 🔑 **INVARIANT:** `selectedIds` ⊆ o an listelenebilir küme. Liste üyeliğini değiştiren bir
 * setter yazıyorsan bunu yaymak ZORUNDASIN. Nöbetçi: `useUiStore.selection.test.ts`.
 *
 * ⚠️ **`setSort` KASITLI OLARAK HARİÇ** — sıralama üyeliği değil SIRAYI değiştirir; aynı
 * dosyalar farklı düzende gelir, seçim geçerli kalır. Sıralamada seçim kaybettirmek
 * kullanıcıyı gereksiz cezalandırırdı.
 *
 * Her çağrıda YENİ dizi döner (`sourceSwitchReset` ile aynı gerekçe: paylaşılan dizi örneği
 * store'lar arasında sızıntı yapmasın).
 */
function selectionReset(): { selectedId: null; selectedIds: number[] } {
  return { selectedId: null, selectedIds: [] };
}

export const useUiStore = create<UiState>((set) => ({
  query: "",
  sort: initialSort(),
  similarTo: null,
  similarToName: null,
  colorSearch: null,
  geoListIds: null,
  searchResultTotal: null,
  semanticMode: false,
  ext: [],
  tag: [],
  collection: [],
  project: [],
  dateFrom: "",
  dateTo: "",
  favoritesOnly: false,
  pathPrefix: null,
  approvalStatus: [],
  clientName: [],
  versionLabel: [],
  deadlineYear: [],
  aiAnalyzed: null,
  gorselTuru: null,
  metadata: {},
  // Varsayilan: explorer (Folders su an stub — kullaniciyi bos stub'a hapsetme).
  viewMode: "explorer",
  assetSource: "local", // varsayilan DAIMA yerel — uzak arsiv acikca secilir
  // Acilista daima ANA yerel arsiv (backend de "main" ile baslar; kalici "son aktif" YOK).
  activeArchiveId: "main",
  activeArchiveName: "",
  activeArchiveIsMain: true,

  cardSize: initialCardSize(),
  selectedId: null,
  selectedIds: [],
  dataVersion: 0,
  facetVersion: 0,
  backupConfigVersion: 0,
  watchConfigVersion: 0,
  remotePairingVersion: 0,
  lanClientNewCount: 0,
  favoriteOverrides: {},
  stalenessById: {},
  stalenessReport: null,
  // Tema/accent baslangici: theme modulunden (localStorage → varsayilan).
  // Modul import-aninda <html> dataset'i zaten uygulamis olur (render oncesi).
  theme: initialTheme(),
  accent: initialAccent(),
  shortcutHelpOpen: false,
  archivePanelOpen: false,
  ingestOpen: false,
  pendingIngestPaths: null,
  ingestMinimized: false,
  ingestFinishedInBackground: false,
  overlayRequest: null,
  dedupSeed: null,

  // Yeni sorgu yazinca benzer-gorsel modundan cik (metin sorgusu, gorsel komsulugunu ezer).
  setQuery: (query) =>
    set({
      query,
      similarTo: null,
      similarToName: null,
      colorSearch: null,
  geoListIds: null,
      searchResultTotal: null,
      ...selectionReset(),
    }),
  setSearchResultTotal: (total) => set({ searchResultTotal: total }),
  setSemanticMode: (on) => set({ semanticMode: on, ...selectionReset() }),
  // Siralama + kart boyutu: degisince localStorage'a da yaz (oturumlar arasi kalici).
  setSort: (sort) => {
    saveSort(sort);
    set({ sort });
  },
  // "Benzer gorseller": gorsel→gorsel moduna gir (id + ad banner basligi icin).
  setSimilarTo: (id, name) =>
    set({ similarTo: id, similarToName: name, ...selectionReset() }),
  clearSimilarTo: () => set({ similarTo: null, similarToName: null, ...selectionReset() }),
  setGeoListIds: (geoListIds) => set({ geoListIds, ...selectionReset() }),
  // Renk aramasi ACILIRKEN benzer-gorsel kapatilir: ikisi de "sonuc kapsami" ve ayni anda
  // ikisinin acik olmasi kullaniciya HANGI listeyi gordugunu belirsiz kilardi (yol secici
  // zaten tek yol secer; durum da tek olsun).
  setColorSearch: (colorSearch) =>
    set({ colorSearch, similarTo: null, similarToName: null, ...selectionReset() }),
  setExt: (ext) => set({ ext, ...selectionReset() }),
  setTag: (tag) => set({ tag, ...selectionReset() }),
  setCollection: (collection) => set({ collection, ...selectionReset() }),
  setProject: (project) => set({ project, ...selectionReset() }),
  // toggleX: deger dizide varsa cikar, yoksa ekle (facet-ici OR; yeni dizi → refetch).
  toggleExt: (v) =>
    set((s) => ({
      ext: s.ext.includes(v) ? s.ext.filter((x) => x !== v) : [...s.ext, v],
      ...selectionReset(),
    })),
  toggleTag: (v) =>
    set((s) => ({
      tag: s.tag.includes(v) ? s.tag.filter((x) => x !== v) : [...s.tag, v],
      ...selectionReset(),
    })),
  toggleCollection: (id) =>
    set((s) => ({
      collection: s.collection.includes(id)
        ? s.collection.filter((x) => x !== id)
        : [...s.collection, id],
      ...selectionReset(),
    })),
  toggleProject: (id) =>
    set((s) => ({
      project: s.project.includes(id)
        ? s.project.filter((x) => x !== id)
        : [...s.project, id],
      ...selectionReset(),
    })),
  toggleApproval: (v) =>
    set((s) => ({
      approvalStatus: s.approvalStatus.includes(v)
        ? s.approvalStatus.filter((x) => x !== v)
        : [...s.approvalStatus, v],
      ...selectionReset(),
    })),
  setDateRange: (dateFrom, dateTo) => set({ dateFrom, dateTo, ...selectionReset() }),
  setFavoritesOnly: (favoritesOnly) => set({ favoritesOnly, ...selectionReset() }),
  setPathPrefix: (pathPrefix) => set({ pathPrefix, ...selectionReset() }),
  setApprovalStatus: (approvalStatus) => set({ approvalStatus, ...selectionReset() }),
  setClientName: (clientName) => set({ clientName, ...selectionReset() }),
  setVersionLabel: (versionLabel) => set({ versionLabel, ...selectionReset() }),
  setDeadlineYear: (deadlineYear) => set({ deadlineYear, ...selectionReset() }),
  setAiAnalyzed: (aiAnalyzed) => set({ aiAnalyzed, ...selectionReset() }),
  setGorselTuru: (gorselTuru) => set({ gorselTuru, ...selectionReset() }),
  toggleMetadata: (key, value) =>
    set((s) => {
      const cur = s.metadata[key] ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      const meta = { ...s.metadata };
      // Bos kalan anahtari SIL (bos dizi birakma): aksi halde "filtre aktif" gorunur ve
      // preset'ler zamanla olu anahtar biriktirirdi.
      if (next.length === 0) delete meta[key];
      else meta[key] = next;
      return { metadata: meta, ...selectionReset() };
    }),
  clearMetadataKey: (key) =>
    set((s) => {
      const meta = { ...s.metadata };
      delete meta[key];
      return { metadata: meta, ...selectionReset() };
    }),
  toggleClient: (v) =>
    set((s) => ({
      clientName: s.clientName.includes(v)
        ? s.clientName.filter((x) => x !== v)
        : [...s.clientName, v],
      ...selectionReset(),
    })),
  toggleVersion: (v) =>
    set((s) => ({
      versionLabel: s.versionLabel.includes(v)
        ? s.versionLabel.filter((x) => x !== v)
        : [...s.versionLabel, v],
      ...selectionReset(),
    })),
  toggleDeadlineYear: (v) =>
    set((s) => ({
      deadlineYear: s.deadlineYear.includes(v)
        ? s.deadlineYear.filter((x) => x !== v)
        : [...s.deadlineYear, v],
      ...selectionReset(),
    })),
  // "Tumunu temizle": tum filtreler + sorgu sifirlanir (sort/fuzzy/mod KORUNUR).
  // ⚠️ Secim de sifirlanir — liste uyeligi degisiyor (bkz `selectionReset`).
  clearFilters: () =>
    set({
      query: "",
      geoListIds: null,
      ext: [],
      tag: [],
      collection: [],
      project: [],
      dateFrom: "",
      dateTo: "",
      favoritesOnly: false,
      pathPrefix: null,
      approvalStatus: [],
      clientName: [],
      versionLabel: [],
      deadlineYear: [],
      aiAnalyzed: null,
      gorselTuru: null,
      metadata: {},
      ...selectionReset(),
    }),
  setViewMode: (viewMode) => set({ viewMode }),
  // Kaynak degisimi: filtreler + secim SIFIRLANIR, `query` ve `sort` KORUNUR.
  //
  // Sifirlanan alanlar ve GEREKCESI: `./assetSource` → `sourceSwitchReset` (saf + test'li).
  // ⚠️ INVARIANT (remote ⇒ REMOTE_ALLOWED_VIEWS): uzak (ana) arsiv verisini yalniz Gezgin ve
  // Teknik gosterebilir (ikisi de /assets'ten beslenir). Klasorler/Pano/Sohbet host'ta uygun
  // okuma ucu OLMADIGI icin uzakta KILITLI. 'remote' secilince gorunum uygun degilse Gezgin'e
  // cekilir; ActivityBar diger butonlari kilitler → "Ana arsiv secili ama yerel veri" olusmaz.
  setAssetSource: (assetSource) =>
    set((s) => {
      if (s.assetSource === assetSource) return {}; // ayni kaynak → dokunma (gereksiz refetch yok)
      if (assetSource === "remote") {
        // Mevcut gorunum uzak veriyi sunabiliyorsa KORU (Gezgin↔Teknik gecisini bozma); degilse
        // Gezgin'e cek → yerel-yalniz gorunumde "Ana arsiv" secili kalip yerel veri gostermesin.
        const viewMode = isRemoteView(s.viewMode) ? s.viewMode : "explorer";
        return { assetSource, viewMode, ...sourceSwitchReset() };
      }
      return { assetSource, ...sourceSwitchReset() };
    }),
  // YEREL arsiv gecisi uygula: backend `db`/`read_db`'yi degistirdi (izole DB); burada UI durumu
  // yeni arsive hizalanir. `collection`/`project`/`pathPrefix` gibi ESKI arsive ozgu id/yol'lar +
  // acik secim + sorgu SIFIRLANIR (yanlis-veri onlenir; `sourceSwitchReset` gerekcesi). Kaynak
  // yerele cekilir. `dataVersion`/`facetVersion` bump → tum sorgular yeni arsivden yeniden kosar.
  applyArchiveSwitch: (archive) =>
    set((s) => ({
      activeArchiveId: archive.id,
      activeArchiveName: archive.name,
      activeArchiveIsMain: archive.isMain,
      assetSource: "local",
      query: "",
      ...sourceSwitchReset(),
      dataVersion: s.dataVersion + 1,
      facetVersion: s.facetVersion + 1,
      favoriteOverrides: {},
      stalenessById: {},
      stalenessReport: null,
    })),
  setCardSize: (cardSize) => {
    saveCardSize(cardSize);
    set({ cardSize });
  },
  // Preset uygula: tum filtre/arama alanlarini tek seferde ata. Benzer-gorsel gecici bir moddur;
  // preset'in sonucunu ezmemesi icin kapanir. Liste uyeligi degistigi icin secim de sifirlanir.
  applyPreset: (f) =>
    set({
      query: f.query,
      // Eski (semanticMode alansiz) preset deterministik olarak klasik FTS'e duser.
      semanticMode: f.semanticMode ?? false,
      sort: f.sort,
      // Eski (skaler/null) kayitli preset'leri cok-degerli diziye normalle (geriye uyum).
      ext: normArrStr(f.ext),
      tag: normArrStr(f.tag),
      collection: normArrNum(f.collection),
      project: normArrNum(f.project),
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      favoritesOnly: f.favoritesOnly,
      // Eski (Faz <7.2) kayitli preset'lerde alan yok → null'a normalle.
      pathPrefix: f.pathPrefix ?? null,
      approvalStatus: normArrStr(f.approvalStatus),
      clientName: normArrStr(f.clientName),
      versionLabel: normArrStr(f.versionLabel),
      deadlineYear: normArrStr(f.deadlineYear),
      // Eski (alansiz) kayitli preset'lerde alan yok → null'a normalle (filtre yok).
      aiAnalyzed: f.aiAnalyzed ?? null,
      gorselTuru: f.gorselTuru ?? null,
      metadata: f.metadata ?? {},
      similarTo: null,
      similarToName: null,
      colorSearch: null,
  geoListIds: null,
      searchResultTotal: null,
      ...selectionReset(),
    }),
  select: (selectedId) => set({ selectedId }),
  // ctrl/cmd+tik: id zaten kumedeyse cikar, degilse ekle.
  toggleSelected: (id) =>
    set((s) =>
      s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
        : { selectedIds: [...s.selectedIds, id] },
    ),
  // shift+tik: verilen aralik id'lerini mevcut secime BIRLESTIR (yinelenenler tekillesir).
  setSelectedRange: (ids) =>
    set((s) => ({ selectedIds: Array.from(new Set([...s.selectedIds, ...ids])) })),
  // "tumunu sec": kumeyi verilenle DEGISTIR (yinelenenleri at).
  setSelectedMany: (ids) => set({ selectedIds: Array.from(new Set(ids)) }),
  clearSelected: () => set({ selectedIds: [] }),
  // Ingest sonrasi: liste + facet tam tazelenir; favori override'lari ve son Doctor sonucu
  // (artik eski DB/mtime snapshot'i) temizlenir.
  bumpData: () =>
    set((s) => ({
      dataVersion: s.dataVersion + 1,
      favoriteOverrides: {},
      stalenessById: {},
      stalenessReport: null,
      selectedIds: [],
    })),
  bumpFacets: () => set((s) => ({ facetVersion: s.facetVersion + 1 })),
  bumpBackupConfig: () => set((s) => ({ backupConfigVersion: s.backupConfigVersion + 1 })),
  bumpWatchConfig: () => set((s) => ({ watchConfigVersion: s.watchConfigVersion + 1 })),
  bumpRemotePairing: () => set((s) => ({ remotePairingVersion: s.remotePairingVersion + 1 })),
  setLanClientNewCount: (count) => set({ lanClientNewCount: Math.max(0, count) }),
  setFavoriteOverride: (id, on) =>
    set((s) => ({ favoriteOverrides: { ...s.favoriteOverrides, [id]: on } })),
  setStalenessReport: (report) =>
    set({
      stalenessById: Object.fromEntries(
        report.problemStatuses.map((status) => [status.id, status.kind]),
      ),
      stalenessReport: {
        total: report.total,
        ok: report.ok,
        stale: report.stale,
        missing: report.missing,
        offline: report.offline,
        samples: report.samples,
      },
    }),
  // Tema: <html data-theme> uygula + kalici yap (theme modulu) + durumu guncelle.
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  // Accent: <html data-accent> uygula + kalici yap (theme modulu) + durumu guncelle.
  setAccent: (accent) => {
    applyAccent(accent);
    set({ accent });
  },
  // Kisayol yardimi (Faz A): '?' overlay durumu.
  toggleShortcutHelp: () => set((s) => ({ shortcutHelpOpen: !s.shortcutHelpOpen })),
  setShortcutHelp: (open) => set({ shortcutHelpOpen: open }),
  setArchivePanelOpen: (archivePanelOpen) => set({ archivePanelOpen }),
  // OS-klasor-drop → ingest (Faz A): IngestButton bu sinyali okuyup IngestModal'i acar.
  // Tek yol → tek elemanli dizi; bos dizi → null (modal "yol secilmedi" haliyle acilir).
  // Acilis daima GORUNUR: arka planda birakilmis bir pencere varken yeni bir tarama istegi
  // (or. RootsPanel "Tara") sessizce gizli kalmamali.
  openIngest: (paths = null) => {
    const list = paths == null ? [] : typeof paths === "string" ? [paths] : paths;
    set({
      ingestOpen: true,
      ingestMinimized: false,
      ingestFinishedInBackground: false, // yeni acilis → okunmamis rapor bayragi duser
      pendingIngestPaths: list.length > 0 ? list : null,
    });
  },
  closeIngest: () =>
    set({
      ingestOpen: false,
      ingestMinimized: false,
      ingestFinishedInBackground: false,
      pendingIngestPaths: null,
    }),
  // Pencere ONE getirilince rapor artik gorunur → bayrak duser (cip kaybolur).
  setIngestMinimized: (minimized) =>
    set(
      minimized
        ? { ingestMinimized: true }
        : { ingestMinimized: false, ingestFinishedInBackground: false },
    ),
  setIngestFinishedInBackground: (ingestFinishedInBackground) =>
    set({ ingestFinishedInBackground }),
  // Sol serit → overlay istegi birak / tuket (TopBar effect ilgili modal'i acar).
  requestOverlay: (kind) =>
    set({ overlayRequest: kind, ...(kind === "dedup" ? { dedupSeed: null } : {}) }),
  requestDedupFor: (dedupSeed) => set({ overlayRequest: "dedup", dedupSeed }),
  consumeOverlayRequest: () => set({ overlayRequest: null }),
}));

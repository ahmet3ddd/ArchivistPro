// Arsiv KAYNAGI (LAN Faz 2) — tip + kaynak degisiminde uygulanacak SIFIRLAMA.
//
// Saf modul (store'dan ayri): `useUiStore` acilista <html> dataset'ine dokundugu icin test
// ortaminda import edilemez. Kritik mantik burada saf tutulur → dogrudan test edilir
// (`listOpts.ts` / `trapTargetIndex` ile ayni proje deseni).

/** Gezginin hangi arsivi listeledigi.
 *  `local` = bu makinenin DB'si · `remote` = LAN uzerinden ana arsiv (salt-okuma). */
export type AssetSource = "local" | "remote";

/** Uzak (ana) arsiv modunda VERI SUNULABILEN gorunumler. Uzak sunucu okuma uclari:
 *  /assets + /asset/{id} + /thumbs + /folders + /search/semantic + /rag + /stats → bunlardan
 *  beslenen gorunumler burada:
 *  - `explorer` (Gezgin): dogrudan /assets grid'i (anlamli-ara modunda /search/semantic).
 *  - `technical` (Teknik): AYNI /assets verisinin tablo hali (`useInfiniteAssets` kaynak-farkinda;
 *    satir-ici yazma yok → tikla = uzak SALT-OKUMA detay).
 *  - `folders` (Klasorler): host `/folders` ucu (klasor ozetleri); kart tiklama = pathPrefix + Gezgin
 *    (uzak-farkinda grid). Uzakta sag-tik menusu (yazma eylemleri) FoldersView'da kapatilir.
 *  - `chat` (Sohbet; LAN Faz 5): retrieval HOST'un onceden insa ettigi indeksinden (`ragChat(remote)`);
 *    LLM uretimi yine ISTEMCI Ollama'sinda. Atif tiklama = uzak SALT-OKUMA detay (host asset-id).
 *  - `dashboard` (Pano; LAN Faz 5): SALT-OKUMA "Ana arsiv ozeti" (`/stats` sayaclari). Yerel Pano'nun
 *    aksine TETIKLEYICI/grafik/onay-kuyrugu YOK (H2 dersi: uzak Pano yalniz indeks sayaclari).
 *  Not: bu liste yalniz "hangi gorunum uzak VERIYI gosterebilir"i belirler; yerel-id/yerel-yol'a
 *  dokunan eylemler uzakta ayrica kapali (secim/facet/yazma). */
  // Harita yerel GPS EAV sorgusuna dayanir; uzak host bu ucu sunmaz.
export const REMOTE_ALLOWED_VIEWS: readonly string[] = [
  "explorer",
  "technical",
  "folders",
  "chat",
  "dashboard",
];

/** Verilen gorunum uzak modda veri sunabilir mi (REMOTE_ALLOWED_VIEWS uyeligi). Saf → test'li. */
export function isRemoteView(mode: string): boolean {
  return REMOTE_ALLOWED_VIEWS.includes(mode);
}

/** Kaynak degisiminde store'a uygulanan sifirlama parcasi. */
export interface SourceSwitchReset {
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
  aiAnalyzed: boolean | null;
  gorselTuru: string | null;
  metadata: Record<string, string[]>;
  similarTo: number | null;
  similarToName: string | null;
  geoListIds: number[] | null;
  selectedId: number | null;
  selectedIds: number[];
}

/**
 * Kaynak (yerel ↔ uzak) degisiminde sifirlanacak alanlar. `query` ve `sort` KASITLI OLARAK
 * DISARIDA — onlar kaynaktan bagimsizdir ve korunmalari ozelligin asil amacidir
 * ("villa"yi yerelde arayip ana arsivde de aramak).
 *
 * 🔑 IKI BAGIMSIZ GEREKCE (her biri tek basina yeterli):
 * (1) **Yerel id tasiyan filtreler yanlis sonuc uretir.** `collection`/`project` YEREL
 *     id'lerdir; uzak host'ta ayni sayilar BASKA kayitlara denk gelir → sessizce yanlis liste.
 *     `similarTo` de yerel bir asset id'sidir. `selectedId`/`selectedIds` ise daha kotusudur:
 *     acik kalan bir secim, kaynak degisiminden sonra YANLIS dosyalara Delete/etiket uygularr.
 * (2) **Uzakta facet kenar cubugu gizlidir** (kullanici karari: uzak facet'ler sonraki is) ⇒
 *     tasinan bir filtre kullaniciya GORUNMEZ ve KALDIRILAMAZ olurdu → "arsiv bos" yanilgisi.
 *
 * Her cagride YENI nesne/dizi doner — paylasilan dizi ornegi store'lar arasi sizinti yapmasin.
 */
export function sourceSwitchReset(): SourceSwitchReset {
  return {
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
    similarTo: null,
    similarToName: null,
    geoListIds: null,
    selectedId: null,
    selectedIds: [],
  };
}

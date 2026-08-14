// Asset listeleme YONLENDIRME karari — saf fonksiyon (tek dogruluk kaynagi; `listOpts` deseni).
//
// useInfiniteAssets'in "hangi backend yoluna gidilecek" kararini KOD-DISI + test edilebilir kilar.
// Karar girdileri: arsiv kaynagi (yerel/uzak) · anlamli-ara modu · sorgu dolu mu · benzer-gorsel
// aktif mi. Cikti tek bir route etiketi; useInfiniteAssets etiketi ipc cagrisina baglar.
//
// ⚠️ MIMARI GEREKCE (anlamli-ara neden AYRI mod, oto-harman DEGIL): H2 tek-kutu oto-harman
// yapiyordu (sql.js TUM vektorler RAM'de → her sorgu FTS + vektor karisimi). H3 FTS'i ve vektoru
// AYRI backend yollarina ayirir (renderer DB tutmaz; vektor DB-ici) → kor oto-harman yeni bir
// backend "hibrit" ucu ister; ana gorev (uzak tuketim) icin gereksiz. Bunun yerine ACIK mod:
// kullanici keyword↔anlamli gecisini bilincli secer (H2 f625ebc dersi de kor harmanin metin
// aramasini kirlettigini gosterdi). Gorsel/CLIP arama AYRI acik arac (VisualSearchModal) kalir.

/** Bir asset listesi/aramasi icin secilecek backend yolu. */
export type AssetQueryRoute =
  | "remote-semantic" // uzak arsiv + anlamli mod + sorgu → remote_semantic_search (top-k, % rozet)
  | "remote-list" // uzak arsiv (klasik) → remote_list_assets (sayfali)
  | "similar" // yerel + benzer-gorsel (gorsel→gorsel; sag-tik) → similar_images (top-k)
  | "semantic" // yerel + anlamli mod + sorgu → semantic_search (top-k, % rozet)
  | "fts" // yerel + sorgu → list_assets (FTS; 0 sonucta fuzzy son-care)
  | "browse"; // yerel + sorgu yok → list_assets (filtreli sayfali gozat)

export interface AssetRouteInput {
  /** Arsiv kaynagi — `remote` iken yalniz uzak uclar (yerel-id yollari kapali). */
  assetSource: "local" | "remote";
  /** Anlamli-ara modu acik mi (SearchBar keyword↔anlamli). */
  semanticMode: boolean;
  /** Sorgu metni dolu mu (trim sonrasi > 0). */
  hasQuery: boolean;
  /** Benzer-gorsel (gorsel→gorsel) aktif mi (`similarTo` set'li). Yerelde anlamlidir; uzakta
   *  kaynak degisiminde temizlenir → uzak yol bunu YOK SAYAR. */
  hasSimilar: boolean;
}

/**
 * Girdilere gore TEK bir backend yolu sec. Oncelik:
 *  UZAK: anlamli mod + sorgu → `remote-semantic`; aksi halde `remote-list` (benzer-gorsel uzakta yok).
 *  YEREL: benzer-gorsel > anlamli(mod+sorgu) > FTS(sorgu) > gozat.
 *
 * Anlamli mod YALNIZ sorgu doluyken devreye girer — bos sorguda vektor aramasinin anlami yok
 * (gozata duser). Boylece "mod acik ama kutu bos" durumu sessizce klasik gozat gosterir.
 */
export function resolveAssetQueryRoute(i: AssetRouteInput): AssetQueryRoute {
  if (i.assetSource === "remote") {
    return i.semanticMode && i.hasQuery ? "remote-semantic" : "remote-list";
  }
  if (i.hasSimilar) return "similar";
  if (i.semanticMode && i.hasQuery) return "semantic";
  if (i.hasQuery) return "fts";
  return "browse";
}

/** Bu route TEK-SAYFA (top-k) mi — benzer-gorsel ve semantik yollari sayfalama YAPMAZ; total =
 *  donen oge sayisi, loadMore no-op. `useInfiniteAssets` sayaci + kaydirmayi buna gore sabitler. */
export function isSinglePageRoute(route: AssetQueryRoute): boolean {
  return route === "similar" || route === "semantic" || route === "remote-semantic";
}

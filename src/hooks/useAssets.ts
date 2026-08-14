// Sonsuz-kaydirma asset hook'u (sanallastirma) — store'a bagli. Tek birlesik yol:
// list_assets (query bossa filtreli liste, doluysa FTS; her durumda ext/tag/collection/
// favori/tarih filtreleri uygulanir). Sayfalar kaydirildikca biriktirilir; herhangi bir
// sorgu/filtre/dataVersion degisince sifirlanir.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetPage, AssetRow } from "../ipc/client";
import { ipc, remoteErrorMessage } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";
import { isSinglePageRoute, resolveAssetQueryRoute } from "./assetQueryRoute";
import { buildListOpts, dateToEpoch, metaIdentity } from "./listOpts";

const PAGE = 60; // sayfa basina cekilen kayit

export interface InfiniteAssets {
  items: AssetRow[];
  total: number;
  loading: boolean; // ilk sayfa yukleniyor
  loadingMore: boolean; // sonraki sayfa ekleniyor
  error: string | null;
  loadMore: () => void;
  retry: () => void;
}

export function useInfiniteAssets(): InfiniteAssets {
  const { t } = useTranslation();
  const query = useUiStore((s) => s.query);
  const sort = useUiStore((s) => s.sort);
  const similarTo = useUiStore((s) => s.similarTo);
  const geoListIds = useUiStore((s) => s.geoListIds);
  const ext = useUiStore((s) => s.ext);
  const tag = useUiStore((s) => s.tag);
  const collection = useUiStore((s) => s.collection);
  const project = useUiStore((s) => s.project);
  const dateFrom = useUiStore((s) => s.dateFrom);
  const dateTo = useUiStore((s) => s.dateTo);
  const favoritesOnly = useUiStore((s) => s.favoritesOnly);
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const approvalStatus = useUiStore((s) => s.approvalStatus);
  const clientName = useUiStore((s) => s.clientName);
  const versionLabel = useUiStore((s) => s.versionLabel);
  const deadlineYear = useUiStore((s) => s.deadlineYear);
  const aiAnalyzed = useUiStore((s) => s.aiAnalyzed);
  const gorselTuru = useUiStore((s) => s.gorselTuru);
  const metadata = useUiStore((s) => s.metadata);
  const dataVersion = useUiStore((s) => s.dataVersion);
  const assetSource = useUiStore((s) => s.assetSource);
  const semanticMode = useUiStore((s) => s.semanticMode);
  const setSearchResultTotal = useUiStore((s) => s.setSearchResultTotal);

  const q = query.trim();
  const modifiedAfter = dateToEpoch(dateFrom, false);
  const modifiedBefore = dateToEpoch(dateTo, true);
  const identity = `${q} ${similarTo ?? ""} ${geoListIds?.join(",") ?? ""} ${sort} ${ext.join(",")} ${tag.join(",")} ${collection.join(",")} ${project.join(",")} ${dateFrom} ${dateTo} ${favoritesOnly ? 1 : 0} ${pathPrefix ?? ""} ${approvalStatus.join(",")} ${clientName.join(",")} ${versionLabel.join(",")} ${deadlineYear.join(",")} ${aiAnalyzed == null ? "" : aiAnalyzed ? 1 : 0} ${gorselTuru ?? ""} ${metaIdentity(metadata)} ${dataVersion} ${assetSource} ${semanticMode ? 1 : 0}`;

  const [items, setItems] = useState<AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const genRef = useRef(0); // sorgu nesli — eski yanitlari yutar
  const nextPageRef = useRef(0); // yuklenecek sonraki sayfa indeksi
  const loadedRef = useRef(0); // yuklenen kayit sayisi
  const totalRef = useRef(0);
  const busyRef = useRef(false); // loadMore tekrarini onler

  const fetchPage = useCallback(
    async (gen: number, page: number, append: boolean) => {
      busyRef.current = true;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        // Ortak facet filtresi — tum yollar (list_assets / similar_images) AYNI
        // `buildListOpts` (tek dogruluk kaynagi) uzerinden gecer; filtreler her yolda uygulanir.
        const facet = {
          sort,
          ext,
          tag,
          collection,
          project,
          modifiedAfter,
          modifiedBefore,
          favoritesOnly,
          pathPrefix,
          approvalStatus,
          clientName,
          versionLabel,
          deadlineYear,
          aiAnalyzed,
          gorselTuru,
          metadata,
        };
        const opts = buildListOpts(facet, { page, pageSize: PAGE, query: q || null });
        // Yonlendirme — TEK dogruluk kaynagi `resolveAssetQueryRoute` (saf + test'li):
        //  UZAK: anlamli mod + sorgu → remote_semantic_search (vektor kNN, % rozet); aksi → /assets.
        //  YEREL: benzer-gorsel > anlamli(mod+sorgu) > FTS(sorgu) > gozat.
        // Anlamli-ara AYRI ACIK mod (kor 3-dal harman DEGIL; H2 f625ebc + mimari gerekce
        // assetQueryRoute.ts basliginda). FTS-ONCELIKLI klasik metin aramasi korunur.
        // similar/semantic/remote-semantic tek sayfa (top-k) → total = items.length, loadMore no-op.
        const route = resolveAssetQueryRoute({
          assetSource,
          semanticMode,
          hasQuery: q.length > 0,
          hasSimilar: similarTo != null,
        });
        const singlePage = isSinglePageRoute(route);
        let res: AssetPage;
        if (geoListIds) { const details = await Promise.all(geoListIds.map((id) => ipc.getAsset(id))); res = { items: details.flatMap((detail) => detail ? [detail.asset] : []), total: geoListIds.length }; } else
        if (!geoListIds && route === "remote-semantic") {
          // Uzak anlamli arama: `opts.query` (= q) semantik sorgu metni; host embed + kNN → AssetPage
          // (items EKSTRA `score`). Host'ta model/indeks yoksa `remote_not_indexed` token'i.
          res = await ipc.remoteSemanticSearch(opts);
        } else if (!geoListIds && route === "remote-list") {
          // UZAK ARSIV (LAN Faz 2): ayni `ListOpts` → host'un `/assets` ucu → ayni `AssetPage`.
          // Sekil ozdes → grid/sanallastirma/sayfalama katmani DEGISMEDEN calisir. Uzakta fuzzy
          // son-caresi YOK (her deneme bir AG gidis-donusu) — kullanici sorguyu kendi duzeltir.
          res = await ipc.remoteListAssets(opts);
        } else if (!geoListIds && route === "similar" && similarTo != null) {
          res = await ipc.similarImages(similarTo, opts);
        } else if (!geoListIds && route === "semantic") {
          // Yerel anlamli arama: `query` AYRI parametre (backend semantic_search(query, opts));
          // items `score` tasir → kartta % benzerlik rozeti. Model yoksa komut Err → ham mesaj.
          res = await ipc.semanticSearch(q, opts);
        } else if (!geoListIds && route === "fts") {
          res = await ipc.listAssets(opts); // FTS (opts.query dolu)
          // Son-care: tam eslesme yoksa (0) yazim-toleransli FTS ile bir kez dene ("yaklasik").
          if (res.items.length === 0) {
            res = await ipc.listAssets(
              buildListOpts(facet, { page, pageSize: PAGE, query: q, fuzzy: true }),
            );
          }
        } else {
          res = await ipc.listAssets(opts);
        }
        if (gen !== genRef.current) return; // bayat yanit — yut
        // Tek-sayfa yollar: total'i donen oge sayisiyla sabitle ("X / N" gostergesi tutarli).
        const effectiveTotal = singlePage ? res.items.length : res.total;
        totalRef.current = effectiveTotal;
        setTotal(effectiveTotal);
        // TopBar sayaci (useAssetTotal) arama/benzer-gorsel aktifken gercek sonuc sayisini
        // BURADAN okur (list_assets FTS-sayimi ile celismesin). Gozatta null → list-sayimi.
        setSearchResultTotal(singlePage ? effectiveTotal : null);
        nextPageRef.current = page + 1;
        if (append) {
          setItems((prev) => {
            // TODO(perf): cok-buyuk arsivde items penceresi (AssetRow hafif oldugundan
            // su an dusuk oncelik; thumbnail cache'i useGridThumbnails'te sinirli).
            const next = prev.concat(res.items);
            loadedRef.current = next.length;
            return next;
          });
        } else {
          loadedRef.current = res.items.length;
          setItems(res.items);
        }
      } catch (e: unknown) {
        if (gen === genRef.current) {
          // Uzak arsivde backend TIPLI token doner ("auth_failed" vb.) — kullaniciya ham token
          // degil, ne yapacagini soyleyen mesaj gosterilir. Taninmayan hata ham metniyle kalir
          // (yutmak teshisi imkansiz kilar; bu oturumun dersi).
          setError(assetSource === "remote" ? remoteErrorMessage(e, t) : String(e));
        }
      } finally {
        if (gen === genRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        busyRef.current = false;
      }
    },
    [
      q,
      similarTo,
      geoListIds,
      sort,
      ext,
      tag,
      collection,
      project,
      modifiedAfter,
      modifiedBefore,
      favoritesOnly,
      pathPrefix,
      approvalStatus,
      clientName,
      versionLabel,
      deadlineYear,
      aiAnalyzed,
      gorselTuru,
      metadata,
      assetSource,
      semanticMode,
      setSearchResultTotal,
      t,
    ],
  );

  // Sorgu kimligi degisince: sifirla + ilk sayfayi cek.
  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    nextPageRef.current = 0;
    loadedRef.current = 0;
    totalRef.current = 0;
    setItems([]);
    setTotal(0);
    void fetchPage(gen, 0, false);
    // identity tum girdileri (q/sort/ext/tag/favori/dataVersion) kapsar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const loadMore = useCallback(() => {
    if (busyRef.current) return;
    if (loadedRef.current >= totalRef.current) return; // hepsi yuklendi
    void fetchPage(genRef.current, nextPageRef.current, true);
  }, [fetchPage]);

  const retry = useCallback(() => {
    const append = loadedRef.current > 0;
    void fetchPage(genRef.current, append ? nextPageRef.current : 0, append);
  }, [fetchPage]);

  return { items, total, loading, loadingMore, error, loadMore, retry };
}

// Hafif sonuc-sayisi hook'u — aktif filtre/arama icin TOPLAM kayit sayisini ceker.
//
// TopBar sonuc-sayaci tum gorunum kiplerinde (folders/dashboard/technical dahil)
// gosterilir; bu yuzden grid'in durumlu sonsuz-kaydirma hook'una bagli OLMAMALI.
// Ayni filtrelerle `page_size: 1, page: 0` ceker → yalniz `total` (1 satir maliyeti)
// doner. Renderer ince kalir; DB yok. Filtre/arama/dataVersion degisince yeniden cagrilir.
//
// 🐛 KAYNAK FARKINDALIGI (2026-07-22 canli test bulgusu): bu hook `listAssets`'i KOSULSUZ
// cagiriyordu → "Ana arşiv" secili ve grid UZAK ogeleri gosterirken sayac YEREL toplami
// yaziyordu. Loopback'te iki sayi ayni oldugu icin aylarca gorunmedi; **ornek arsiv** sunulunca
// ortaya cikti (grid 12 ÖRNEK oge, sayac "285 sonuç" = yerel arsiv). Kullanici bulgusu.
// Artik kaynaga gore `remoteListAssets`'e yonlenir — grid ile AYNI ucu sayar.

import type { AssetSort } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";
import { metadataToDto } from "./listOpts";
import { useIpcQuery } from "./useIpcQuery";

/** YYYY-MM-DD → unix saniye (gun basi/sonu). Bos/gecersiz → null. */
function toEpoch(date: string, endOfDay: boolean): number | null {
  if (!date) return null;
  const ms = new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}`).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Aktif filtre/arama icin toplam asset sayisi (yuklenmemisken null). */
export function useAssetTotal(): number | null {
  const query = useUiStore((s) => s.query);
  const similarTo = useUiStore((s) => s.similarTo);
  const searchResultTotal = useUiStore((s) => s.searchResultTotal);
  const sort = useUiStore((s) => s.sort) as AssetSort;
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
  // Grid hangi arsivi listeliyorsa sayac da ONU saymali (aksi halde iki farkli arsivin sayisi
  // yan yana gorunur — "285 sonuç" yazip 12 oge cizmek gibi).
  const assetSource = useUiStore((s) => s.assetSource);
  const remotePairingVersion = useUiStore((s) => s.remotePairingVersion);

  const q = query.trim();
  const modifiedAfter = toEpoch(dateFrom, false);
  const modifiedBefore = toEpoch(dateTo, true);
  // Bir kez hesapla: deps dizisinde `metadata` referansi zaten var (store kaydi degisince yenilenir).
  const metaDto = metadataToDto(metadata);

  const { data } = useIpcQuery(
    () => {
      const opts = {
        page: 0,
        page_size: 1, // yalniz total lazim — tek satir
        sort,
        query: q || null,
        fuzzy: false,
        ext,
        tag,
        collection,
        project,
        modified_after: modifiedAfter,
        modified_before: modifiedBefore,
        favorites_only: favoritesOnly,
        path_prefix: pathPrefix ?? null,
        approval_status: approvalStatus,
        client_name: clientName,
        version_label: versionLabel,
        deadline_year: deadlineYear,
        // Tri-state: null → alan absent (filtre yok); true/false → gonder.
        ai_analyzed: aiAnalyzed ?? undefined,
        // Gorsel turu: null → alan absent (filtre yok); token → gonder.
        gorsel_turu: gorselTuru ?? undefined,
        // Metadata: yalniz DOLU secim varsa gonder (bos → alan absent = filtre yok).
        metadata: metaDto.length > 0 ? metaDto : undefined,
      };
      // Uzak sayimda hata (host kapali/yetkisiz) → sayac "…" kalir; TopBar zaten null'i
      // "sayiliyor" olarak cizer. Sessiz YEREL sayiya DUSULMEZ — yanlis sayi, sayisizliktan
      // kotudur (bu bulgunun ta kendisi).
      return assetSource === "remote" ? ipc.remoteListAssets(opts) : ipc.listAssets(opts);
    },
    [
      assetSource,
      remotePairingVersion,
      q,
      sort,
      ext,
      tag,
      collection,
      project,
      dateFrom,
      dateTo,
      favoritesOnly,
      pathPrefix,
      approvalStatus,
      clientName,
      versionLabel,
      deadlineYear,
      aiAnalyzed,
      gorselTuru,
      metadata,
      dataVersion,
    ],
  );

  // Benzer-gorsel (similarTo) top-k sonucu GRID'ten gelir (list_assets sayimi baska kume dondurur)
  // → grid'in yazdigi gercek sayi. Metin sorgusu artik FTS/list_assets (sayfali) → kendi total'i
  // ZATEN dogru (searchResultTotal degil). Gozat da list-sayimi. Yani yalniz similarTo store'dan.
  const nonBrowse = similarTo != null;
  return nonBrowse ? searchResultTotal : (data?.total ?? null);
}

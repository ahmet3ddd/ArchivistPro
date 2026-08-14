// Facet hook'lari — uzanti / etiket sayilari + favori sayisi + koleksiyonlar.
// Uzanti: ingest sonrasi (dataVersion). Etiket/favori/koleksiyon: ingest + kurasyon
// (facetVersion).

import type { CollectionRef, Facet, ImageAnalysisStatus, ProjectRow } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";
import { useIpcQuery } from "./useIpcQuery";

/** Uzantiya gore asset sayilari (tur filtre faceti). */
export function useExtFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const { data } = useIpcQuery(() => ipc.extFacets(), [dataVersion]);
  return data ?? [];
}

/** Gorsel turune gore asset sayilari (AI vision `ai_gorsel_turu` faceti; Fotoğraf/Render/Doku).
 *  Ingest (dataVersion) + AI gorsel-analizi (bumpFacets → facetVersion) sonrasi tazelenir. */
export function useGorselTuruFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.gorselTuruFacets(), [dataVersion, facetVersion]);
  return data ?? [];
}

/** AI gorsel-analiz durum sayimlari. `analyzed` tum aktif asset'lerdeki kalici
 *  `ai_analyzed` marker sayisidir; sidebar bunu arsiv toplamindan cikararak "analiz edilmemis"
 *  sayisini gosterir. Ingest + analiz/kurasyon sonrasi tazelenir. */
export function useAiAnalysisStatus(): ImageAnalysisStatus | null {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.imageAnalysisStatus(), [dataVersion, facetVersion]);
  return data ?? null;
}

/** GENEL metadata (EAV) facet sayilari — cikarici-uretimi anahtarlar (`unit_type`, `version`...).
 *  Backend `metadata_facets` komutu (deger + sayi, count DESC; §O cop haric) ZATEN vardi; eksik
 *  olan filtreydi (bkz `ListOpts.metadata`). Anahtar parametrik → yeni bir metadata facet'i icin
 *  YENI HOOK YAZILMAZ, bu hook baska bir anahtarla cagrilir.
 *
 *  Yalniz ingest (dataVersion) sonrasi tazelenir: bu degerler cikaricidan gelir, kurasyonla
 *  (facetVersion) degismez — gereksiz yeniden-sorgu yok. */
export function useMetadataFacets(key: string, limit = 50): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const { data } = useIpcQuery(() => ipc.metadataFacets(key, limit), [dataVersion, key, limit]);
  return data ?? [];
}

/** Kullanici etiketleri + sayilari (kurasyon faceti). */
export function useTagFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.tagFacets(50), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Favori asset sayisi (filtre rozeti). */
export function useFavoriteCount(): number {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.favoriteCount(), [dataVersion, facetVersion]);
  return data ?? 0;
}

/** Tum koleksiyonlar + uye sayilari (kenar cubugu faceti + detay editoru). */
export function useCollections(): CollectionRef[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.listCollections(), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Tum projeler (entity) + atanmis asset sayilari. Filtre cipi + atama seciciler icin ad
 *  cozumu; ingest/kurasyon (dataVersion) + atama (facetVersion) sonrasi tazelenir. Proje
 *  YAZIMLARI bumpData cagirir → dataVersion artar → burasi otomatik tazelenir. */
export function useProjects(): ProjectRow[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.listProjects(), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Onay durumuna gore asset sayilari (proje-durum faceti; H2 pariti). Ingest +
 *  proje-durum yazimi (facetVersion) sonrasi tazelenir. */
export function useApprovalFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.approvalFacets(), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Musteri adina gore asset sayilari (proje-durum faceti). Ingest + proje-durum yazimi
 *  (facetVersion) sonrasi tazelenir. */
export function useClientFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.clientFacets(200), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Versiyon etiketine gore asset sayilari (proje-durum faceti). */
export function useVersionFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.versionFacets(200), [dataVersion, facetVersion]);
  return data ?? [];
}

/** Termin yilina gore asset sayilari (proje-durum faceti; yil azalan). */
export function useDeadlineYearFacets(): Facet[] {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const facetVersion = useUiStore((s) => s.facetVersion);
  const { data } = useIpcQuery(() => ipc.deadlineYearFacets(), [dataVersion, facetVersion]);
  return data ?? [];
}

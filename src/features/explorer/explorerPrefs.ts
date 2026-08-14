// Gezgin gorunum tercihleri (localStorage) — oturumlar arasi KALICI.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H2 kart boyutunu ve siralamayi
// kaliciydi (`hooks/useStorePersistence.ts:28-30` + `store/useStore.ts:356,359-362`);
// H3'te ikisi de salt-bellekti → kullanici her acilista yeniden ayarliyordu.
// ⚠️ Tutarsizligin kaniti: KLASOR siralamasi H3'te ZATEN kalici
// (`features/folders/FoldersView.tsx:44-52`) — desen vardi, Gezgin'in iki tercihi atlanmisti.
//
// AYRI MODUL, bilerek: bu yardimcilar SAF (yalniz localStorage) → `useUiStore`'un agir
// import grafigi (tema/i18n) olmadan birim test edilebilir. Depo disiplini: karar saf
// fonksiyonda, yan etki cagirimda.

import type { AssetSort } from "../../ipc/client";

const CARD_SIZE_KEY = "arsiv.explorer.cardSize";
const SORT_KEY = "arsiv.explorer.sort";

/** Kart boyutu varsayilani (px) — grid sutun genisligi (minmax). */
export const DEFAULT_CARD_SIZE = 220;

/** Kart boyutu makul araligi — asiri deger grid'i kullanilamaz hale getirmesin. */
const MIN_CARD = 120;
const MAX_CARD = 480;

/** Gecerli siralama degerleri. Bozuk/eski bir localStorage degeri backend'e SIZMAMALI:
 *  `sort` orada ORDER BY whitelist'ine girer → taninmayan deger sorguyu dusururdu. */
const VALID_SORTS: readonly AssetSort[] = [
  "modified_desc",
  "modified_asc",
  "name_asc",
  "name_desc",
  "type_asc",
  "type_desc",
  "size_asc",
  "size_desc",
  "created_asc",
  "created_desc",
  "path_asc",
  "path_desc",
];

const DEFAULT_SORT: AssetSort = "modified_desc";

/** Kayitli kart boyutu; yok/bozuk → varsayilan, asiri → kelepcelenir. */
export function initialCardSize(): number {
  const n = Number.parseInt(localStorage.getItem(CARD_SIZE_KEY) ?? "", 10);
  if (!Number.isFinite(n)) return DEFAULT_CARD_SIZE;
  return Math.max(MIN_CARD, Math.min(MAX_CARD, n));
}

/** Kart boyutunu kalici yaz. */
export function saveCardSize(size: number): void {
  localStorage.setItem(CARD_SIZE_KEY, String(size));
}

/** Kayitli siralama; yok/taninmayan → varsayilan. */
export function initialSort(): AssetSort {
  const v = localStorage.getItem(SORT_KEY);
  return VALID_SORTS.includes(v as AssetSort) ? (v as AssetSort) : DEFAULT_SORT;
}

/** Siralamayi kalici yaz (yalniz gecerli deger; cagiran zaten tipli). */
export function saveSort(sort: AssetSort): void {
  localStorage.setItem(SORT_KEY, sort);
}

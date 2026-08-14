// Grid klavye navigasyonunun ODAK KAPSAMI karari — SAF (import'suz, test edilebilir).
//
// NEDEN AYRI MODUL: `useGridKeyboardNav` zinciri store/tema uzerinden `document`'e dokunur;
// karar mantigi orada kalsaydi test etmek icin DOM stub'i ya da jsdom bagimliligi gerekirdi.
// Ayni desen repoda var: `useModalFocusTrap.trapTargetIndex`, `store/assetSource.ts`.

/** Grid'in kaydirma bolgesini isaretleyen oznitelik (AssetGrid'de kok liste kabina konur). */
export const GRID_SCOPE_SELECTOR = "[data-grid-scope]";

/** Odagin NEREDE oldugu — tus sahipligi kararinin tek girdisi. */
export type FocusZone = "none" | "grid" | "elsewhere";

/**
 * Bu tus grid navigasyonuna mi ait?
 *
 * **NEDEN VAR (2026-07-28 UI/UX denetimi K2):** dinleyici `document`'te ve guard'i yalnizca
 * "duzenlenebilir alan mi / overlay acik mi" diye soruyordu. Oysa Gezgin'de FacetSidebar, grid
 * ve DetayPaneli AYNI ANDA ekranda. Imlec bir kez kurulduktan sonra odak NEREDE olursa olsun:
 * `Enter` `preventDefault` ile odakli dugmenin aktivasyonunu IPTAL edip grid ogesinin detayini
 * aciyor **ve coklu secimi siliyordu** (`clearSelected`); `Space` dugme yerine grid secimini
 * degistiriyordu; oklar da odakli bilesenin kendi gezinmesini kaciriyordu.
 *
 * Somut acik: kullanici okla 3 dosya gezip Tab'la kenar cubugundaki "Klasorler"e gider ve
 * Enter'a basar → **dugme calismaz**, grid detayi acilir ve coklu secim sessizce kaybolur.
 *
 * **Karar:** odak grid bolgesindeyse ya da HICBIR YERDE (body/document) ise tuslar bizim;
 * baska bir bilesende ise DOKUNMAYIZ. "Hicbir yerde" dali ZORUNLU — `blurFocusedCard()`
 * sonrasi odak `body`'ye duser ve klavye-only kullanicinin gezinmesi orada surer.
 */
export function gridOwnsKey(zone: FocusZone): boolean {
  return zone !== "elsewhere";
}

/**
 * Olay hedefini odak bolgesine cevir.
 *
 * ⚠️ `instanceof HTMLElement` KULLANILMAZ, ordek-tiplemesi yapilir: vitest ortami "node"
 * (jsdom kurulu degil) → `HTMLElement` tanimsizdir ve `instanceof` ReferenceError atardi.
 * Ordek-tiplemesi hem tarayicida dogru calisir hem testte sahte hedefle surulebilir.
 */
export function focusZone(target: EventTarget | null): FocusZone {
  const el = target as { closest?: (s: string) => unknown; tagName?: string } | null;
  if (!el || typeof el.closest !== "function") return "none"; // document / null → odak yok
  if (el.tagName === "BODY") return "none"; // odak hicbir yerde → gezinme bizim
  return el.closest(GRID_SCOPE_SELECTOR) ? "grid" : "elsewhere";
}

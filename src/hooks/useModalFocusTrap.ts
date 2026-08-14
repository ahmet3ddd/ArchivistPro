// Modal Tab-hapsi (focus trap) — H2 `useFocusTrap.ts` paritesi, TEK YERDE.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H3'te hicbir Tab-hapsi YOKTU
// (`key === "Tab"` araması `src/` genelinde sifir eslesme) — buna ragmen **21 modal
// `aria-modal="true"` ILAN EDIYOR**. Yani ekran okuyucuya "burasi kipsel bir pencere,
// arkasi erisilemez" sozu veriliyor ama kod bu sozu tutmuyordu: klavye kullanicisi
// modal icinden Tab'layip arkadaki (scrim ile tiklanamaz) grid'e odaklanabiliyordu.
//
// 🔑 H2'DEN FARKLI (bilincli): H2 hook'u HER modalde tek tek cagiriyordu (15 yerde) →
// yeni bir modal eklerken unutulursa o modal sessizce hapissiz kalir; nitekim H2'de de
// bazi modaller listede yoktu. H3'te tek bir GLOBAL dinleyici, DOM'daki
// `[aria-modal="true"]` ogelerinin EN USTTEKINI bulup Tab'i orada dondurur → **sozu veren
// oznitelik ile sozu tutan kod ayni sey**. Yeni modal `aria-modal` ilan ettigi anda
// hapsi bedava kazanir; ilan etmiyorsa zaten kipsel degildir.
//
// Escape'e DOKUNULMAZ: H3 modalleri Escape'i zaten kendi iclerinde ele aliyor (tarama
// bulgusu: "role/aria-modal/Escape/autoFocus konularinda iyi durumda, eksik olan yalniz
// Tab-hapsi") → burada ikinci bir Escape yolu kurmak cift-kapanma riski dogururdu.

import { useEffect } from "react";

/** Odaklanabilir oge secicisi (H2 ile ayni kume + `[contenteditable]`). */
export const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Tab hapsi karari — SAF (test edilebilir). Donen deger odaklanacak INDEKS, `null` ise
 * varsayilan tarayici davranisi birakilir (modal ortasindaki normal Tab gezinmesi).
 *
 * - `activeIndex < 0` (odak modal DISINDA) → ice al (ilk oge)
 * - Shift+Tab ilk ogedeyken → sona sar
 * - Tab son ogedeyken → basa sar
 */
export function trapTargetIndex(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count === 0) return null;
  if (activeIndex < 0) return 0;
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}

/** Oge GORUNUR mu? `offsetParent` KULLANILAMAZ — modaller `position: fixed` ve fixed
 *  ogelerde `offsetParent` daima null'dur (sessizce "hicbiri gorunur degil" derdi). */
export function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

export function topmostVisibleIndex(visibility: boolean[]): number {
  return visibility.lastIndexOf(true);
}

export function topmostVisibleModal(): HTMLElement | undefined {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
  const index = topmostVisibleIndex(modals.map(isVisible));
  return index < 0 ? undefined : modals[index];
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && isVisible(el),
  );
}

/** Uygulama kokunde BIR KEZ cagrilir (App.tsx). */
export function useModalFocusTrap(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      // En ustteki gorunur modal = DOM sirasinda SON olan (portal/uste-binen modaller
      // sonra monte edilir; ic ice acilan panel bu sayede dogru secilir).
      const top = topmostVisibleModal();
      if (!top) return; // acik modal yok → normal Tab

      const items = focusableElements(top);
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const target = trapTargetIndex(items.length, activeIndex, e.shiftKey);
      if (target == null) return;

      e.preventDefault();
      items[target].focus();
    };

    // capture: modal-ici kendi Tab isleyicileri varsa once bizim sarma kararimiz gecerli.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

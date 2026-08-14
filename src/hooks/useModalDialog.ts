import { useEffect, useRef, type RefObject } from "react";

import { focusableElements, topmostVisibleModal } from "./useModalFocusTrap";

/**
 * Bir modal icin ortak Escape, ilk odak ve odagi geri-verme davranisi.
 * Yalniz DOM sirasindaki en ust modal kapanir; alttaki modal dinleyicileri etkilenmez.
 */
export function useModalDialog<T extends HTMLElement>(
  onDismiss: () => void,
  enabled = true,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  // React `autoFocus` commit sirasinda passive effect'ten ONCE calisabilir. Cagiran kontrolu
  // render aninda yakalamak, geri-donus hedefinin modal-ici input'a donusmesini onler.
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;
    const previous = returnFocusRef.current;

    queueMicrotask(() => {
      const dialog = dialogRef.current;
      if (!dialog || topmostVisibleModal() !== dialog || dialog.contains(document.activeElement)) {
        return;
      }
      focusableElements(dialog)[0]?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-escape-local]")) return;
      const dialog = dialogRef.current;
      if (!dialog || topmostVisibleModal() !== dialog) return;
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
    };

    // Bubble: modal icindeki bir alan Escape'i yerel olarak kullaniyorsa once davranabilir.
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => {
        if (!previous?.isConnected) return;
        const top = topmostVisibleModal();
        if (!top || top.contains(previous)) previous.focus();
      }, 0);
    };
  }, [enabled]);

  return dialogRef;
}

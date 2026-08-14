// Grid ok-navigasyonu (klavye Faz B) — AssetGrid'de monte edilir.
//
// Faz A (useGlobalShortcuts) global tuslari yonetir ama ok tuslarina DOKUNMAZ (grid'e
// ozgu: `items` + sutun sayisi + Virtuoso kaydirma referansi gerekir). Bu hook o boslugu
// doldurur: `document` uzerinde tek keydown dinleyicisi, Faz A ile AYNI korumalar
// (isEditableTarget / isOverlayOpen) — cift-tetik/catisma yok (Faz A ok/Enter/Space islemez).
//
// 🔑 UCUNCU KORUMA — ODAK KAPSAMI (2026-07-28 UI/UX denetimi K2): dinleyici document'te oldugu
// icin yukaridaki iki koruma YETMEZ; Gezgin'de kenar cubugu/detay paneli ayni anda ekranda ve
// odak orada olabilir. `gridOwnsKey(focusZone(e.target))` ile tuslar yalniz odak GRID'de ya da
// HICBIR YERDE iken islenir. Gerekce + somut acik: `gridOwnsKey` JSDoc'u.
//
// Model: "gezinen imlec" (roving cursor). Oklar YALNIZ imleci tasir (yikici DEGIL — detay/secim
// degismez); Enter detayi acar, Space coklu-secime ekler/cikarir, Shift+Ok aralik secer.
//   • ← / →           → imlec ±1
//   • ↑ / ↓           → imlec ±sutun (grid genisligine gore CANLI olculur)
//   • Home / End      → ilk / son (yuklu) oge
//   • Enter           → imlecteki ogenin detayini ac (select)
//   • Space           → imlecteki ogeyi coklu-secimde degistir (anchor'i tasir)
//   • Shift + Ok/Home/End → anchor'dan imlece aralik sec (setSelectedRange)
//
// Imlec YOKKEN (cursorIndex<0) ilk ok basisi imleci baslangica (acik detay varsa onun indeksine,
// yoksa 0) yerlestirir — hareketi bir sonraki basiste uygular. Enter/Space imlec yokken pas gecer
// (odakli bir kartin native tetigini ezmesin). Liste kimligi degisince (ilk id) imlec sifirlanir.

import { useEffect, useRef, type MutableRefObject } from "react";

import { isEditableTarget, isOverlayOpen } from "../../hooks/useGlobalShortcuts";
import type { AssetRow } from "../../ipc/client";
// Odak-kapsami karari SAF ve AYRI modulde (import'suz) → jsdom/stub olmadan test edilebilir.
import { focusZone, gridOwnsKey } from "./gridKeyboardScope";

export interface GridNavOptions {
  /** Etkin mi? (yalniz explorer görünümü). */
  enabled: boolean;
  /** Yuklu ogeler (tek dogruluk kaynagi grid'de). */
  items: AssetRow[];
  /** Imlec indeksi (-1 = yok). */
  cursorIndex: number;
  /** Acik detay ogesinin indeksi (-1 = yok) — imlec yokken baslangic noktasi. */
  selectedIndex: number;
  setCursorIndex: (index: number) => void;
  /** Grid'in CANLI sutun sayisi (genislik/kart-boyutuna gore olculur). */
  getColumnCount: () => number;
  /** Indeksi gorunur pencereye kaydir (yalniz gerekliyse). */
  ensureVisible: (index: number) => void;
  /** Enter → detayi ac. */
  select: (id: number) => void;
  /** Enter → coklu-secimi temizle (duz tik ile ayni semantik; bkz Enter dali). */
  clearSelected: () => void;
  /** Space → coklu-secimde degistir. */
  toggleSelected: (id: number) => void;
  /** Shift+Ok → aralik sec. */
  setSelectedRange: (ids: number[]) => void;
  /** Shift-aralik capasi (fare ile PAYLASILIR → tutarli davranis). */
  anchorRef: MutableRefObject<number | null>;
  /** Kuyruga yaklasinca sonraki sayfayi getir (klavye-only akista tikanma olmasin). */
  loadMore: () => void;
}

export function useGridKeyboardNav(opts: GridNavOptions): void {
  // En guncel opts'u ref'te tut → dinleyici BIR KEZ eklenir (her imlec hareketinde yeniden
  // baglanmaz), govdede daima taze deger okur.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // Ayni tik'te art arda tuslar (ok-tekrari) icin imleci yerel olarak da tut → state commit'i
  // beklemeden tutarli taban.
  const posRef = useRef(opts.cursorIndex);
  posRef.current = opts.cursorIndex;

  // Odakli kart butonunu birak — WebView2/Chromium karta tiklayinca butona odak verir; klavye
  // navigasyonu devralinca o odak Enter/Space'te native tetigi de calistirip CIFT eylem yaratir
  // (ozellikle Space keyup-click). Ilk nav tusunda blur → sonraki Enter/Space temiz (tek eylem).
  const blurFocusedCard = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest('[data-testid="asset-card"]')) el.blur();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const o = optsRef.current;
      if (!o.enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+A/K vb. Faz A'nin
      if (isEditableTarget(e.target)) return;
      if (isOverlayOpen()) return;
      // K2: odak baska bir bilesendeyse (kenar cubugu / detay sekmesi / arac cubugu dugmesi)
      // tuslar ONUN — ok/Enter/Space'i kacirmayiz.
      if (!gridOwnsKey(focusZone(e.target))) return;
      const len = o.items.length;
      if (len === 0) return;

      const clamp = (i: number) => Math.max(0, Math.min(len - 1, i));
      const cols = Math.max(1, o.getColumnCount());
      const pos = posRef.current;
      const hadCursor = pos >= 0;
      const base = hadCursor ? pos : o.selectedIndex >= 0 ? o.selectedIndex : 0;

      // Ok / Home / End → imleci tasi.
      let next: number | null = null;
      switch (e.key) {
        case "ArrowRight":
          next = hadCursor ? clamp(base + 1) : base;
          break;
        case "ArrowLeft":
          next = hadCursor ? clamp(base - 1) : base;
          break;
        case "ArrowDown":
          next = hadCursor ? clamp(base + cols) : base;
          break;
        case "ArrowUp":
          next = hadCursor ? clamp(base - cols) : base;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = len - 1;
          break;
      }
      if (next !== null) {
        e.preventDefault();
        blurFocusedCard();
        posRef.current = next;
        o.setCursorIndex(next);
        o.ensureVisible(next);
        if (e.shiftKey) {
          // Aralik: anchor SABIT kalir, imlec ucu hareket eder.
          if (o.anchorRef.current == null) o.anchorRef.current = base;
          const anchor = o.anchorRef.current;
          const a = Math.min(anchor, next);
          const b = Math.max(anchor, next);
          o.setSelectedRange(o.items.slice(a, b + 1).map((x) => x.id));
        } else {
          o.anchorRef.current = next; // taze anchor → sonraki Shift buradan baslar
        }
        if (next >= len - 1) o.loadMore(); // kuyrukta on-getir
        return;
      }

      // Enter → detayi ac (yalniz gecerli imlec varken; yoksa odakli kartin native tetigini birak).
      // pos>=len korumasi: ortadaki oge silinince indeks kayabilir (ilk-id degismezse sifirlanmaz).
      //
      // ⚠️ `clearSelected()` ONCE: Enter, duz TIKIN klavye ikizidir → ayni semantigi tasimali
      // (bkz AssetGrid.tsx `onActivate` duz-tik dali, H2 `ExplorerView.tsx:92`). Aksi halde
      // kullanici Space ile 5 dosya secip baska bir karta Enter'a bastiginda secim GORUNMEZ
      // sekilde canli kalir ve sonraki `Delete` o 5 dosyaya gider. Space (coklu-sec) ve
      // Shift+Ok (aralik) dallari secimi KORUR — onlar zaten coklu-secim eylemleridir.
      if (e.key === "Enter") {
        if (pos < 0 || pos >= len) return;
        e.preventDefault();
        blurFocusedCard();
        o.clearSelected();
        o.select(o.items[pos].id);
        return;
      }

      // Space → coklu-secimde degistir (yalniz gecerli imlec varken; ' ' sayfayi kaydirmasin).
      if (e.key === " " || e.key === "Spacebar") {
        if (pos < 0 || pos >= len) return;
        e.preventDefault();
        blurFocusedCard();
        o.toggleSelected(o.items[pos].id);
        o.anchorRef.current = pos;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // Dinleyici mount'ta bir kez; guncel durumu optsRef/posRef uzerinden okur.
  }, []);
}

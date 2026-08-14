// Merkezi klavye kisayolu katmani (Faz A) — AppShell'de BIR KEZ monte edilir.
//
// Tek bir `document` keydown dinleyicisi tum global kisayollari yonetir. Mevcut ~29
// dagitik Escape dinleyicisine (modal/menu/dropdown kendi Escape'ini yonetir) DOKUNMAZ:
// bu katmanin Escape'i yalniz bir FALLBACK'tir ve YALNIZ acik overlay yokken calisir.
//
// Kisayollar:
//   • Ctrl/Cmd+K      → aramaya odaklan (input icinde de gecerli; metin-duzenleme degil).
//   • /               → aramaya odaklan (yalniz input DISINDA).
//   • Ctrl/Cmd+A      → yuklu asset'leri sec (yalniz explorer + overlay yok; grid'e event ile).
//   • Delete          → secili asset'leri cope tasi (yalniz admin/canWrite + secim + onayli).
//   • ?  (Shift+/)    → kisayol yardim overlay'ini ac/kapat (yalniz overlay yok / kendi acikken).
//   • Escape (fallb.) → secim + detay secimini birak (YALNIZ overlay yokken).
//
// INPUT-GUARD: hedef INPUT/TEXTAREA/SELECT/contentEditable ise metin-duzenleme kisayollari
// (/ · ? · Ctrl+A · Delete · Escape-fallback) YAKALANMAZ (Ctrl+K istisnadir — metin islemi degil).
//
// Ctrl+A'nin "yuklu asset'ler" kaynagi AssetGrid'in sonsuz-kaydirmada biriken listesidir;
// hook o listeye sahip degildir → `document` uzerinden `h3:select-all` custom event yayar,
// AssetGrid dinleyip `setSelectedMany(items)` cagirir (yuklu-liste tek dogruluk kaynagi grid'de).

import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "./useSession";
import { useBulkActions } from "../features/explorer/useBulkActions";
import { useUiStore } from "../store/useUiStore";

/** AssetGrid'in dinledigi custom-event adi (Ctrl+A → yuklu ogeleri sec). */
export const SELECT_ALL_EVENT = "h3:select-all";

/** Hedef metin-duzenlenebilir mi? (INPUT/TEXTAREA/SELECT/contentEditable)
 *  Faz B grid ok-navigasyonu da ayni korumayi kullanir → export. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** Bloke edici bir overlay acik mi? Tum modallar (`[role="dialog"]`) + baglam menuleri /
 *  gelismis-arama dropdown'i (`[role="menu"]`) sayilir. Kisayol yardim overlay'i (kendisi
 *  `[role="dialog"]`) HARIC tutulur — o "baska bir overlay" degildir (kendi Escape'i vardir).
 *  PickerModal/SearchBar dropdown'lari `[role="dialog"]` degil ama input-odakli → INPUT-GUARD
 *  onlari zaten kapsar (odak kutularinin icindedir). Faz B de ayni kontrolu kullanir → export. */
export function isOverlayOpen(): boolean {
  const nodes = document.querySelectorAll('[role="dialog"], [role="menu"]');
  for (const node of nodes) {
    if (!node.hasAttribute("data-shortcut-help")) return true;
  }
  return false;
}

/** Ana arama kutusuna odaklan (varsa metni de sec → hizli degistirme). */
function focusSearch(): void {
  const el = document.querySelector('[data-testid="search-input"]');
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  } else if (el instanceof HTMLElement) {
    el.focus();
  }
}

export function useGlobalShortcuts(): void {
  const { t } = useTranslation();
  const { canWrite } = useSession();
  const { trashMany } = useBulkActions();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;

      // Ctrl/Cmd+K → aramaya odaklan (input icinde de gecerli; metin-duzenleme kisayolu degil).
      if (ctrl && (key === "k" || key === "K")) {
        e.preventDefault();
        focusSearch();
        return;
      }

      // INPUT-GUARD: buradan sonrasi metin-duzenlemeyi ezmemek icin input DISINDA calisir.
      if (isEditableTarget(e.target)) return;

      const overlayOpen = isOverlayOpen();

      // "/" → aramaya odaklan (yalniz input disinda; Shift+/ = '?' asagida ele alinir).
      if (key === "/") {
        e.preventDefault();
        focusSearch();
        return;
      }

      // "?" (Shift+/) → kisayol yardim overlay'ini ac/kapat. Baska bir modal acikken acma
      // (uzerine binmesin); kendi acikken '?' kapatir (isOverlayOpen kendini HARIC tutar).
      if (key === "?") {
        e.preventDefault();
        if (overlayOpen) return;
        useUiStore.getState().toggleShortcutHelp();
        return;
      }

      // Ctrl/Cmd+A → yuklu asset'leri sec. Yalniz explorer + overlay yok. Grid custom-event dinler.
      if (ctrl && (key === "a" || key === "A")) {
        if (overlayOpen) return;
        if (useUiStore.getState().viewMode !== "explorer") return;
        e.preventDefault();
        document.dispatchEvent(new CustomEvent(SELECT_ALL_EVENT));
        return;
      }

      // Delete → secili asset'leri cope tasi. Yalniz admin/canWrite + secim varsa + overlay yok;
      // onayli (uygulamadaki diger yikici eylemlerle ayni native uyari diyalogu).
      if (key === "Delete") {
        if (overlayOpen || !canWrite) return;
        // 🔒 UZAK arsivde Delete ETKISIZ: `selectedIds` o an HOST'un id'leridir; `trashMany`
        // ise YEREL DB'ye gider ⇒ ayni sayilara denk gelen BASKA yerel dosyalar cope giderdi.
        // (Kaynak degisimi secimi zaten temizler; bu, arada kalan bir secime karsi ikinci kapi.)
        if (useUiStore.getState().assetSource === "remote") return;
        const ids = useUiStore.getState().selectedIds;
        if (ids.length === 0) return;
        e.preventDefault();
        void confirm(t("shortcuts.trash_confirm", { count: ids.length }), {
          title: t("shortcuts.trash_confirm_title"),
          kind: "warning",
        })
          .then((ok) => {
            if (ok) return trashMany(ids);
            return undefined;
          })
          .catch(() => undefined);
        return;
      }

      // Escape (FALLBACK) → secim + detay secimini birak. YALNIZ overlay/yardim yokken; acik
      // modallar/menuler kendi Escape'ini yonetir (cift-tetik/erken-kapanma OLMAMALI). Temizlenecek
      // bir sey yoksa preventDefault ETME (baska yerel Escape dinleyicileri serbest kalsin).
      if (key === "Escape") {
        if (overlayOpen) return;
        const s = useUiStore.getState();
        if (s.shortcutHelpOpen) return; // yardim overlay'i kendi Escape'ini yonetir
        const hasSelection = s.selectedIds.length > 0;
        const hasDetail = s.selectedId != null;
        if (!hasSelection && !hasDetail) return;
        e.preventDefault();
        if (hasSelection) s.clearSelected();
        if (hasDetail) s.select(null);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [t, canWrite, trashMany]);
}

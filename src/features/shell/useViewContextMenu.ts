// Görünüm-düzeyi sağ-tık durumu (konum + o andaki metin seçimi) — tek yerde.
//
// NEDEN BURADA (2026-08-20): sağ-tık handler'ı olmayan her yüzeyde WebView2'nin kendi TARAYICI
// menüsü açılıyor ("Yeniden yükle · Farklı kaydet · Kaynağı görüntüle"). Görünümlere kendi
// menülerini eklerken iki karar her seferinde tekrarlanacaktı; ikisi de burada:
//
//  1) METİN GİRİŞLERİ HARİÇ. `input`/`textarea`/`contenteditable` üzerinde varsayılan menü
//     ENGELLENMEZ — kes/kopyala/yapıştır WebView2'nin düzenleme menüsünden gelir ve bizde onun
//     karşılığı yok. Genel bir `preventDefault` bu yeteneği sessizce götürürdü (Sohbet'in yazı
//     alanı bunun en somut örneği).
//  2) İÇTEKİ MENÜ ÖNCELİKLİ. `defaultPrevented` ise olay zaten sahiplenilmiştir (asset kartı,
//     gezgin boş alanı, görünüm menüsü) — üstteki kabuk handler'ı karışmaz, iki menü açılmaz.
//  3) SEÇİLİ METİN taşınır. Tarayıcı menüsünü kapattığımız yerde "Kopyala"yı biz sunarız; menü
//     açılırken seçim okunur (menü açıldıktan sonra odak değişebilir → o an okumak GEREKLİ).

import { useCallback, useState, type MouseEvent } from "react";

/** METİN GİRİŞİ mi (kes/kopyala/yapıştır menüsü gereken alan)? Onay kutusu/radyo/kaydırıcı gibi
 *  metin girilmeyen `input`'lar HARİÇ: onlarda tarayıcı menüsünün sunacağı bir şey yok. */
export function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const field = el.closest<HTMLElement>("input, textarea, [contenteditable='true']");
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    const NON_TEXT = ["checkbox", "radio", "range", "color", "file", "button", "submit", "reset", "image"];
    return !NON_TEXT.includes(field.type);
  }
  return true;
}

export interface ViewContextMenuState {
  x: number;
  y: number;
  /** Sağ-tık anındaki metin seçimi (boş → "Kopyala" öğesi çizilmez). */
  text: string;
}

export interface UseViewContextMenu {
  /** Açık menü (null → menü yok). */
  menu: ViewContextMenuState | null;
  /** Görünümün kök öğesine bağlanır: `onContextMenu={open}`. */
  open: (event: MouseEvent) => void;
  close: () => void;
}

export function useViewContextMenu(): UseViewContextMenu {
  const [menu, setMenu] = useState<ViewContextMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((event: MouseEvent) => {
    // Daha İÇTEKİ bir menü olayı zaten sahiplendiyse (asset kartı, gezgin boş alanı, görünüm
    // menüsü) ÜSTTEKİ kabuk/görünüm handler'ı karışmaz → iki menü birden açılmaz.
    if (event.defaultPrevented) return;
    // Düzenlenebilir alan → varsayılan menü KALSIN (kes/kopyala/yapıştır).
    if (isTextEntry(event.target)) return;
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      text: window.getSelection()?.toString().trim() ?? "",
    });
  }, []);

  return { menu, open, close };
}

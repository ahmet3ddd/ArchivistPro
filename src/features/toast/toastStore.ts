// Toast (anlik bildirim) durumu — odakli Zustand dilimi (tek-bag store YOK).
//
// H2 pariti: yazma eylemleri (favori/etiket/koleksiyon/cop) artik sessiz degil —
// bu store kisa-omurlu bildirim kuyrugunu tutar. Mesaj ZATEN cevrili string'tir
// (cagiran `t()` ile uretir; `useToast` sarmalar) — dil degisirse acik toast'lar
// yeniden cevrilmez (ephemeral, ~4sn). Otomatik kapanma ToastItem'da (bilesen
// yasam-dongusune bagli zamanlayici); burada yalniz kuyruk + ekle/kapat.

import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

/** Opsiyonel toast eylemi (or. "Geri al"). `label` ZATEN cevrili string; `onClick` cagiran
 *  tarafindan verilir (geri-al gibi geri-alinabilir eylemler). Yoksa toast salt-bildirimdir. */
export interface ToastAction {
  label: string; // zaten cevrili
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string; // zaten cevrili
  action?: ToastAction; // opsiyonel eylem butonu; success/error/info cagrilari bunu vermez
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

// Modul-ici artan sayac — id catismasi olmaz (Date.now/Math.random gerekmez).
let nextId = 1;
// Ekrani tasirmamak icin en fazla bu kadar toast gorunur.
const MAX_TOASTS = 4;

/**
 * Kuyrugu MAX_TOASTS'a indir — ama **HATALARI KORUYARAK**. SAF (test edilebilir).
 *
 * NEDEN (2026-07-18 H2-gerileme taramasi bulgusu): eski kural "en eskiyi dusur"du. Hata
 * toast'i da otomatik kapandigi icin (bkz ToastItem) bir hata mesaji, ardindan gelen
 * BASARI mesajlariyla ekrandan atilabiliyordu → kullanici "islem yaptim, olmadi ama neden
 * olmadigini goremedim" durumunda kaliyordu. H2'de hata bildirimleri
 * `notificationCenter.ts:115` `autoDismissMs: 0` ile kullanici kapatana kadar durur + 100'luk
 * gecmiste birikirdi. H3'te bildirim merkezi yok → en azindan hata EKRANDAN ATILMAMALI.
 *
 * Kural: tasma varken once en eski HATA-DISI toast dusurulur. Hepsi hataysa (nadire) mecburen
 * en eski hata duser — aksi halde kuyruk sonsuz buyur ve ekrani kaplar.
 */
export function trimToasts(list: Toast[], max: number = MAX_TOASTS): Toast[] {
  if (list.length <= max) return list;
  const out = [...list];
  for (let dropped = list.length - max; dropped > 0; dropped--) {
    const idx = out.findIndex((t) => t.kind !== "error");
    out.splice(idx === -1 ? 0 : idx, 1); // hata-disi yoksa en eskiyi dusur
  }
  return out;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message, action) =>
    set((s) => ({ toasts: trimToasts([...s.toasts, { id: nextId++, kind, message, action }]) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

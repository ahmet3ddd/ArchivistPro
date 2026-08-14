// Otomatik AI indeks — banner GORUNUM durumu (odakli Zustand dilimi; tek-bag store YOK).
//
// `useAutoIndex` hook'u (AppShell'de bir kez) 3 backend olayini dinler ve bu dilimi gunceller;
// `AutoIndexBanner` bilesen bunu OKUR ve cizer (toastStore + useToast + ToastContainer deseni:
// slice = durum, hook = yazar/yan-etki, bilesen = okuyucu). `banner === null` → isSiz → banner
// RENDER OLMAZ. Toast (bitis ozeti) hook'ta uretilir (t/useToast React-ici) — burada YOK.

import { create } from "zustand";

import type { AutoIndexStage } from "../../ipc/client";

/** Banner'da gosterilen anlik ilerleme. `stage === null` → "basliyor" (indeterminate; henuz
 *  ilk ilerleme gelmedi / acilista aktif yakalandi). `total === 0` → indeterminate cubuk. */
export interface AutoIndexBanner {
  stage: AutoIndexStage | null;
  processed: number;
  total: number;
  currentPath: string;
}

interface AutoIndexState {
  /** Aktif banner durumu; null = surucu isSiz → banner gizli. */
  banner: AutoIndexBanner | null;
  /** `index_started` / acilista-aktif → indeterminate "basliyor" (pending = kaba payda). */
  showStarting: (pending: number) => void;
  /** `index_progress` → belirli stage + processed/total + o anki dosya. */
  updateProgress: (p: {
    stage: AutoIndexStage;
    processed: number;
    total: number;
    currentPath: string;
  }) => void;
  /** `index_done` → banner gizle (isSiz). */
  hide: () => void;
}

export const useAutoIndexStore = create<AutoIndexState>((set) => ({
  banner: null,
  showStarting: (pending) =>
    set({ banner: { stage: null, processed: 0, total: Math.max(0, pending), currentPath: "" } }),
  updateProgress: (p) =>
    set({
      banner: {
        stage: p.stage,
        processed: p.processed,
        total: p.total,
        currentPath: p.currentPath,
      },
    }),
  hide: () => set({ banner: null }),
}));

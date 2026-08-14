// Arka-plan bakim islemi (tarama / yeniden-indeksleme) — GLOBAL ilerleme GORUNUM durumu (odakli
// Zustand dilimi; autoIndexStore ikizi). AutoIndexBanner deseni: slice = durum, YAZAR = islemi
// tetikleyen cagirici (useFolderWatcher oto-rescan · FoldersView klasor rescan/reindex ·
// BatchToolbar toplu reindex), OKUYUCU = BgTaskBanner.
//
// GEREKCE: bu islemlerin ilerlemesi per-call Channel ile YALNIZ tetikleyen bilesende yasiyordu
// (klasor gorunumu basligi / buton metni) → baska gorunumdeyken gorunmez, watcher oto-rescan ise
// TAMAMEN sessizdi. Bu dilim ilerlemeyi global banner'a tasir → her gorunumden gorunur. Backend DEGISMEZ
// (mevcut Channel ilerlemesi kullanilir).
//
// CAKISMA (ayni anda >1 islem — or. watcher oto-rescan + elle reindex): tasklar `id` ile listede
// tutulur; banner tek islemde detay, coklu islemde "N islem" ozeti gosterir. `start` id doner,
// `update`/`end` o id'yi hedefler → biten bir islem digerinin banner'ini KAPATMAZ.

import { create } from "zustand";

/** Arka-plan islem turu (banner etiketi: `bgTask.<kind>`). */
export type BgTaskKind = "rescan" | "reindex" | "analyze";

/** Tek aktif arka-plan islemi. `total === 0` → belirsiz (henuz tariyor / toplam bilinmiyor). */
export interface BgTask {
  id: number;
  kind: BgTaskKind;
  processed: number;
  total: number;
  currentPath: string; // reindex'te bos (ReindexProgress dosya yolu tasimaz); rescan'da dolu
}

interface BgTaskState {
  /** Aktif arka-plan islemleri (biten cikar; bos dizi → banner gizli). */
  tasks: BgTask[];
  /** Yeni islem basladi → `id` doner (update/end icin). `total` bilinmiyorsa 0 (belirsiz cubuk). */
  start: (kind: BgTaskKind, total?: number) => number;
  /** Bir islemin ilerlemesini guncelle (Channel callback'inden). `currentPath` verilmezse korunur. */
  update: (id: number, p: { processed: number; total: number; currentPath?: string }) => void;
  /** Islem bitti → listeden cikar (DAIMA finally'de cagir; hata dahil). */
  end: (id: number) => void;
}

// Modul-duzeyi artan sayac — task id uretir (stabil/deterministik; Date.now/random YOK).
let seq = 0;

export const useBgTaskStore = create<BgTaskState>((set) => ({
  tasks: [],
  start: (kind, total = 0) => {
    const id = ++seq;
    set((s) => ({
      tasks: [...s.tasks, { id, kind, processed: 0, total: Math.max(0, total), currentPath: "" }],
    }));
    return id;
  },
  update: (id, p) =>
    set((s) => ({
      tasks: s.tasks.map((tk) =>
        tk.id === id
          ? {
              ...tk,
              processed: p.processed,
              total: p.total,
              currentPath: p.currentPath ?? tk.currentPath,
            }
          : tk,
      ),
    })),
  end: (id) => set((s) => ({ tasks: s.tasks.filter((tk) => tk.id !== id) })),
}));

// Otomatik AI indeks hook'u (P1) — AppShell'de BIR KEZ monte edilir (useFolderWatcher deseni).
//
// 3 backend olayini dinler → banner GORUNUM dilimini (autoIndexStore) gunceller + bitiste ozet
// TOAST atar:
//   • index_started → banner "basliyor" (indeterminate).
//   • index_progress → stage + processed/total + o anki dosya.
//   • index_done     → banner gizlenir + ozet toast (metin/gorsel/parca [· atlanan]; stopped → "durduruldu" varyanti).
// Acilista `auto_index_status().active` true ise (uygulama yeniden baslayip surucu kaldigi yerden
// devam ediyorsa) banner'i hemen "basliyor" olarak tohumlar → ilk ilerleme gelene dek gorunur.
//
// Abonelik STABIL kurulur: `t`/`toast` ref'te tutulur (dil degisince yeniden-abone olup olay
// kacirmayi onler); store setter'lari Zustand'dan zaten stabil → effect bir kez kosar.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { IndexDoneEvent } from "../../ipc/client";
import { ipc, onIndexDone, onIndexProgress, onIndexStarted } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { useAutoIndexStore } from "./autoIndexStore";

/** Bitis olayi → hangi toast anahtari (stopped × skipped kombinasyonu; 4 tam-cumle varyant). */
function doneToastKey(p: IndexDoneEvent): string {
  if (p.stopped) return p.skipped > 0 ? "autoIndex.stopped_skipped" : "autoIndex.stopped";
  return p.skipped > 0 ? "autoIndex.done_skipped" : "autoIndex.done";
}

export function useAutoIndex(): void {
  const { t } = useTranslation();
  const toast = useToast();
  const showStarting = useAutoIndexStore((s) => s.showStarting);
  const updateProgress = useAutoIndexStore((s) => s.updateProgress);
  const hide = useAutoIndexStore((s) => s.hide);

  // t/toast'i ref'te tut → abonelik dil degisiminde yeniden kurulmaz (olay kacmaz).
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    // Abonelik kurulurken effect cozulduyse hemen unlisten et (yaris koruma).
    const track = (u: UnlistenFn) => {
      if (disposed) u();
      else unlisteners.push(u);
    };

    // Acilista surucu zaten aktifse (yeniden-baslatma sonrasi devam) banner'i hemen goster.
    void ipc
      .autoIndexStatus()
      .then((s) => {
        if (!disposed && s.active) showStarting(0);
      })
      .catch(() => {
        /* durum okunamadi → sessiz (kritik degil; ilk ilerleme yine banner'i acar) */
      });

    void onIndexStarted((p) => {
      if (!disposed) showStarting(p.pending);
    }).then(track);

    void onIndexProgress((p) => {
      if (!disposed) updateProgress(p);
    }).then(track);

    void onIndexDone((p) => {
      if (disposed) return;
      hide();
      const msg = tRef.current(doneToastKey(p), {
        embedded: p.embedded,
        imageEmbedded: p.imageEmbedded,
        chunked: p.chunked,
        skipped: p.skipped,
      });
      // Tamamlandi → success; kullanici durdurdu → info (notrl bilgi).
      if (p.stopped) toastRef.current.info(msg);
      else toastRef.current.success(msg);
    }).then(track);

    return () => {
      disposed = true;
      for (const u of unlisteners) u();
    };
  }, [showStarting, updateProgress, hide]);
}

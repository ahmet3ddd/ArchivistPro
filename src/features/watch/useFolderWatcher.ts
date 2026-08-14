// Klasor watcher hook'u (H2 useFolderWatcher pariti) — admin girisliyken canli izleme.
//
// Faz 1 (enabled): izlenen koklerde FS degisikligi → backend `folder_changed` olayi → TOAST
//   (kok basina 30 sn debounce; tek dosya kopyasi onlarca olay → tek bildirim).
// Faz 2 (autoRescan, opt-in): degisiklik sonrasi 60 sn SESSIZLIK → o koku otomatik yeniden
//   tara (ingestFolder merge — guvenli/yikici-degil; eklenen/degisen yakalanir). Bir oto-tarama
//   surerken yenisi baslamaz (cift-tarama guard). Bitince liste tazelenir (bumpData) + toast.
//
// Ayar localStorage'da (watchSettings); degisince store `watchConfigVersion` artar → bu effect
// yeniden kurulur (taze ayarla). Yalniz admin oturumda aktif (AppShell `isAdmin` gecer). Backend
// start/stop admin-gated; tum izleme oturum/ayar kapaninca `stopAllWatchers` ile temizlenir.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

import type { WatchFailure } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { useBgTaskStore } from "../bgtask/bgTaskStore";
import { useToast } from "../toast/useToast";
import type { WatchErrorKind } from "./watchErrors";
import { watchErrorKind, watchFailedKey } from "./watchErrors";
import { getWatchAutoRescan, getWatchEnabled } from "./watchSettings";

/** Kok basina yinelenen toast onleme penceresi (ms) — H2 pariti. */
const TOAST_DEBOUNCE_MS = 30_000;
/** Oto-yeniden-tarama icin "sessizlik" suresi (ms): son degisiklikten bu kadar sonra tara. */
const AUTO_RESCAN_QUIET_MS = 60_000;

interface FolderChangePayload {
  rootPath: string;
  kind: "created" | "modified" | "removed";
}

/** Yoldan dosya/klasor adi (son parca; Windows + POSIX). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Hata kullanicinin kendi IPTALI mi (banner'daki "Durdur")? Oyleyse hata gibi bildirilmez. */
function isCancelled(e: unknown): boolean {
  return /iptal|cancel/i.test(String(e));
}

export function useFolderWatcher(isAdmin: boolean): void {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const configVersion = useUiStore((s) => s.watchConfigVersion);

  useEffect(() => {
    // Admin degil veya izleme kapali → her ihtimale karsi tum watcher'lari durdur, cik.
    if (!isAdmin || !getWatchEnabled()) {
      void ipc.stopAllWatchers().catch(() => {});
      return;
    }
    let disposed = false;
    const lastToast = new Map<string, number>(); // kok → son toast ani (ms)
    const rescanTimers = new Map<string, number>(); // kok → bekleyen oto-tarama timer'i
    let rescanInFlight = false; // ayni anda tek oto-tarama
    let unlisten: (() => void) | null = null;

    const runRescan = async (root: string) => {
      if (disposed || rescanInFlight) return;
      rescanInFlight = true;
      // Global banner: bu oto-tarama artik her gorunumden gorunur (eskiden TAMAMEN sessizdi).
      // Aksiyonlar Zustand'da stabil → getState() snapshot'i guvenli (effect dep'i gerekmez).
      const bg = useBgTaskStore.getState();
      const taskId = bg.start("rescan");
      try {
        // Merge (yikici-degil): eklenen/degisen yakalanir, hicbir sey silinmez. Artimsal
        // (skip_unchanged) → degismeyen dosyalar hash'siz atlanir, ucuz. Ilerleme → global banner.
        await ipc.ingestFolder(root, true, "merge", (p) =>
          bg.update(taskId, {
            processed: p.processed,
            total: p.total,
            currentPath: p.currentPath,
          }),
        );
        if (!disposed) {
          bumpData();
          toast.info(t("watch.rescan_done", { folder: baseName(root) }));
        }
      } catch (e) {
        // Y3 (2026-07-28 denetimi): eskiden TAMAMEN sessizdi. Kullanici "degisiklik algilandi"
        // toast'ini gormus oluyor, sonra ne basari ne hata — arsivin guncel oldugunu SANIYORDU.
        // Iptal ("Durdur") ozel durum: kullanicinin kendi istegi, hata gibi gosterilmez.
        if (!disposed && !isCancelled(e)) {
          toast.error(t("watch.rescan_failed", { folder: baseName(root) }));
        }
      } finally {
        rescanInFlight = false;
        bg.end(taskId);
      }
    };

    // Izlenen kokler artik DB'de (scanned_roots) — asenkron cek; yalniz AKTIF kokler izlenir.
    // Roots gelene kadar disposed guard'i korunur (cleanup once kosarsa hicbir sey kurulmaz).
    void (async () => {
      let roots: string[];
      try {
        const list = await ipc.listScannedRoots();
        roots = list.filter((r) => r.status === "active").map((r) => r.path);
      } catch {
        return; // kokler cekilemedi → izleme kurulmaz (sonraki configVersion'da tekrar denenir)
      }
      if (disposed || roots.length === 0) return;
      const autoRescan = getWatchAutoRescan();

      // Backend olayini dinle (async; unlisten cleanup'ta cagrilir).
      void listen<FolderChangePayload>("folder_changed", (event) => {
        if (disposed) return;
        const { rootPath } = event.payload;

        // Toast (kok basina 30 sn debounce).
        const now = Date.now();
        if (now - (lastToast.get(rootPath) ?? 0) >= TOAST_DEBOUNCE_MS) {
          lastToast.set(rootPath, now);
          toast.info(t("watch.changed", { folder: baseName(rootPath) }));
        }

        // Oto-tarama: her degisiklikte sessizlik sayacini sifirla; 60 sn sonra tara.
        if (autoRescan) {
          const existing = rescanTimers.get(rootPath);
          if (existing != null) window.clearTimeout(existing);
          const timer = window.setTimeout(() => {
            rescanTimers.delete(rootPath);
            void runRescan(rootPath);
          }, AUTO_RESCAN_QUIET_MS);
          rescanTimers.set(rootPath, timer);
        }
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

      // Her aktif koku izlemeye basla (backend admin-gated).
      //
      // Y3: hata artik SESSIZ DEGIL. Eskiden `catch(() => {})` idi → klasor silinmis ya da ag
      // kopmussa izleme hic kurulmuyordu ama kullanici "izleniyor" saniyordu; degisiklik
      // bildirimi ASLA gelmiyordu ve hicbir yuzeyde iz yoktu. Tek toast'ta topluyoruz —
      // kok basina ayri toast, cok koklu arsivde spam olurdu.
      // Y4 (kullanici bulgusu 2026-08-08): hata artik YUTULMUYOR. Eskiden `catch(() => ...)` yalniz
      // klasorun KISA adini topluyordu → "1 klasor izlenemiyor (silsil)". Neden bilinmeden yapilacak
      // sey de bilinemez: klasor silinmis mi, ag surucusu cevrimdisi mi, izin mi yok, isletim
      // sisteminin izleme siniri mi doldu — dordu de TAMAMEN farkli eylem ister. Backend sinifi
      // (`WatchFailure.kind`) tasiyor; SINIFA GORE grupluyoruz (tek toast'ta karisik nedenleri
      // birlestirmek yine yaniltirdi) ve TAM YOLU gosteriyoruz (kisa ad surucuyu gizler).
      const failures: WatchFailure[] = [];
      await Promise.all(
        roots.map((root) =>
          ipc.startWatchingRoot(root).catch((e: unknown) => {
            const f = e as Partial<WatchFailure> | null;
            failures.push({
              kind: f?.kind ?? "other",
              message: f?.message ?? String(e),
              path: f?.path || root,
            });
          }),
        ),
      );
      if (!disposed && failures.length > 0) {
        // Gruplama DARALTILMIS sinif uzerinden: ileride eklenen bir sunucu kodu kendi (cevirisi
        // olmayan) kovasini acmaz, `other`'a duser — orada ham metin zaten gosterilir.
        const byKind = new Map<WatchErrorKind, WatchFailure[]>();
        for (const f of failures) {
          const k = watchErrorKind(f.kind);
          byKind.set(k, [...(byKind.get(k) ?? []), f]);
        }
        for (const [kind, list] of byKind) {
          toast.error(
            t(watchFailedKey(kind), {
              count: list.length,
              folders: list.map((f) => f.path).join(", "),
              // `other` sinifi icin ham metin tek bilgi kaynagi → kaybolmamali.
              message: list[0].message,
            }),
          );
        }
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
      for (const timer of rescanTimers.values()) window.clearTimeout(timer);
      rescanTimers.clear();
      void ipc.stopAllWatchers().catch(() => {});
    };
  }, [isAdmin, configVersion, t, toast, bumpData]);
}

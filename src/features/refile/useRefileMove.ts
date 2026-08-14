// "Tasi" akisi (paylasimli hook) — hem tekil (AssetDetailPanel) hem toplu (BatchToolbar) kullanir.
//
// Akis: klasor-secici (Tauri dialog; IngestOptions deseni) → secilirse refileAssets(ids, dest,
// onProgress) → surerken `moving`/`progress` (buton metni) → bitince ozet toast + `onComplete`
// (bumpData/refetch). Klasor secilmezse (iptal) sessiz no-op. Yetki ADMIN (gate backend'de; UI
// yalniz gorunum). i18n zorunlu.

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { refileErrorMessage } from "./refileError";

export interface UseRefileMove {
  /** refileAssets su an calisiyor mu (buton disabled + ilerleme kilidi). */
  moving: boolean;
  /** Canli ilerleme (buton metni: "Tasiniyor… processed/total"). */
  progress: { processed: number; total: number };
  /** Klasor-secici ac → secilirse `ids`'i tasi → ozet toast + onComplete. İptal → no-op. */
  move: (ids: number[]) => Promise<void>;
}

/** `onComplete` tasima BASARIYLA calistiktan sonra (grid tazeleme / detay refetch). */
export function useRefileMove(onComplete?: () => void): UseRefileMove {
  const { t } = useTranslation();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });

  const move = useCallback(
    async (ids: number[]) => {
      if (moving || ids.length === 0) return;
      const dest = await open({ directory: true, multiple: false, title: t("refile.choose_dest") });
      if (typeof dest !== "string") return; // iptal edildi

      setMoving(true);
      setProgress({ processed: 0, total: ids.length });
      try {
        const report = await ipc.refileAssets(ids, dest, (p) =>
          setProgress({ processed: p.processed, total: p.total }),
        );

        // Tekil tasi + tasinamadi → ozet yerine nedeni dogrudan goster (detay panelinde daha net).
        if (ids.length === 1 && report.moved === 0) {
          const reason = report.failed[0]?.error ?? report.skipped[0]?.reason ?? "";
          const msg = refileErrorMessage(reason, t);
          if (report.failed.length > 0) toast.error(msg);
          else toast.info(msg);
        } else {
          const summary = t("refile.move_done", {
            moved: report.moved,
            skipped: report.skipped.length,
            failed: report.failed.length,
          });
          if (report.failed.length > 0) toast.error(summary);
          else toast.success(summary);
        }

        onComplete?.();
      } catch (e) {
        // Ust-seviye hata (or. yetki reddi) → thrown kod → i18n.
        toast.error(refileErrorMessage(e, t));
      } finally {
        setMoving(false);
      }
    },
    [moving, t, toast, onComplete],
  );

  return { moving, progress, move };
}

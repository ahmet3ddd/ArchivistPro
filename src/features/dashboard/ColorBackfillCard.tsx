// Renk verisi geri-doldurma kartı (Ayarlar → AI) — `ImageKindCard` ikizi.
//
// NEDEN VAR (ölçüldü 2026-08-20, gerçek arşiv): baskın-renk çıkarımı arşiv kurulduktan SONRA
// eklendi → o tarihten önce indekslenen raster görsellerde `dominant_colors` EAV'si hiç oluşmadı
// (dev arşivinde saf raster dosyaların **%68'i**). O dosyalarda kart kartelası boş görünüyor ve
// "bu renge yakın görselleri bul" araması onları BULAMIYOR. Kullanıcı sorusu tam buydu:
// "gezginde bazı kartlarda renk kartelası var, bazılarında yok".
//
// Geri-doldurma KAYNAK DOSYAYA DOKUNMAZ: renk, DB'deki thumbnail baytlarından hesaplanır →
// kaynağı başka makinede olan dosyalar da kapsanır, yeniden tarama gerekmez. İdempotent: mevcut
// (çıkarımdan gelen) değer EZİLMEZ; ikinci koşu 0 döner.
//
// ⚠️ Sayı 0 iken kart RENDER OLMAZ: yapacak işi olmayan bir bakım düğmesi göstermek gürültüdür.
// Yetki UI-only (admin); gerçek kontrol Rust'ta (`backfill_dominant_colors` admin-gate).

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useBgTaskStore } from "../bgtask/bgTaskStore";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

export function ColorBackfillCard() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const dataVersion = useUiStore((s) => s.dataVersion);

  const { data: missing } = useIpcQuery<number>(
    () => ipc.countMissingDominantColors(),
    [dataVersion],
  );

  const bgStart = useBgTaskStore((s) => s.start);
  const bgUpdate = useBgTaskStore((s) => s.update);
  const bgEnd = useBgTaskStore((s) => s.end);

  const [running, setRunning] = useState(false);
  // İş dosya başına ~25ms; binlerce dosyada dakikaya yaklaşıyor (ölçüm: 1.231 dosya ≈ 30sn).
  // Sessiz bekleme "donmuş mu?" sorusunu doğurur → HEM buton metninde HEM global banner'da
  // ilerleme (reindex deseni: Ayarlar kapansa bile iş görünür kalır).
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const runningRef = useRef(false); // çift-tetik koruma

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress({ processed: 0, total: missing ?? 0 });
    const taskId = bgStart("colors", missing ?? 0);
    try {
      const count = await ipc.backfillDominantColors((p) => {
        setProgress(p);
        bgUpdate(taskId, { processed: p.processed, total: p.total });
      });
      if (count > 0) {
        toast.success(t("color_backfill.done_toast", { count }));
        bumpData(); // kartelalar + renk araması artık bu dosyaları da görsün
      } else {
        toast.info(t("color_backfill.none_toast"));
      }
    } catch (e: unknown) {
      toast.error(t("color_backfill.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      bgEnd(taskId);
    }
  }, [t, toast, bumpData, missing, bgStart, bgUpdate, bgEnd]);

  // Eksik yoksa (ya da sayım henüz gelmediyse) kart hiç çizilmez.
  if (!missing || missing <= 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("color_backfill.title")}
      </h3>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-bg-secondary p-4">
        <p className="text-xs leading-relaxed text-text-muted">
          {t("color_backfill.hint", { count: missing })}
        </p>

        {isAdmin && (
          <button
            type="button"
            data-testid="color-backfill-run"
            onClick={() => void run()}
            disabled={running}
            className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {running
              ? progress.total > 0
                ? t("color_backfill.running_progress", progress)
                : t("color_backfill.running")
              : t("color_backfill.run", { count: missing })}
          </button>
        )}

        {/* İlerleme çubuğu — "ne kadar kaldı" sorusunu metin tek başına yeterince iyi
            cevaplamıyor (1.231 sayısı gözde ölçek kurmuyor). */}
        {running && progress.total > 0 && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.processed}
            className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary"
          >
            <div
              className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
              style={{
                inlineSize: `${Math.min(100, Math.round((progress.processed / progress.total) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

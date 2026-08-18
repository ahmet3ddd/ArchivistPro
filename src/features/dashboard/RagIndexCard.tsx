// RAG Indeks karti (Artim 2) — Dashboard'a yerlesir. SemanticIndexCard pariti:
// chunk indeksleme durumu + admin'e "Indeksle (kalan N)" eylemi.
//   • durum: "X / N indekslendi" + kalan (pending) + toplam chunk — ragIndexStatus().
//   • modelReady=false → net uyari (model yok), buton pasif.
//   • admin + pending>0 → runRagIndexing(onProgress) (INGEST determinate idiomu). Toast + tazele.
//   • metadata chunk HER asset'e (dosya-adi/proje/etiket/DWG katman) → DWG/MAX bile sohbette
//     aranabilir; govde chunk yalniz belge turleri.
//
// Yetki UI-only: rol useSession'dan; gercek kontrol Rust'ta. Glassmorphic (.glass) + RTL.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RagIndexStatus, RagProgress } from "../../ipc/client";
import { Spinner } from "../../components/Spinner";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

/** Yoldan dosya adi (son `/` veya `\` parcasi); Windows + POSIX. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function RagIndexCard() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const toast = useToast();
  const dataVersion = useUiStore((s) => s.dataVersion);

  const [tick, setTick] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<RagIndexStatus>(
    () => ipc.ragIndexStatus(),
    [tick, dataVersion],
  );

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RagProgress | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    try {
      const report = await ipc.runRagIndexing((p) => setProgress(p));
      toast.success(
        t("rag_index.done_toast", { indexed: report.indexed, chunks: report.chunks, failed: report.failed }),
      );
    } catch (e: unknown) {
      toast.error(t("rag_index.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
      setTick((x) => x + 1);
    }
  }, [t, toast]);

  const [rebuilding, setRebuilding] = useState(false);
  const rebuildingRef = useRef(false);

  /** Parcalari sil + hemen yeniden kur. Vektor/CLIP indeksleri KORUNUR (bkz `resetRagChunks`). */
  const rebuild = useCallback(async () => {
    if (rebuildingRef.current || runningRef.current) return;
    rebuildingRef.current = true;
    setRebuilding(true);
    try {
      const cleared = await ipc.resetRagChunks();
      toast.success(t("rag_index.rebuild_cleared", { count: cleared }));
      setTick((x) => x + 1);
      const report = await ipc.runRagIndexing((p) => setProgress(p));
      toast.success(
        t("rag_index.done_toast", {
          indexed: report.indexed,
          chunks: report.chunks,
          failed: report.failed,
        }),
      );
    } catch (e: unknown) {
      toast.error(t("rag_index.failed", { message: String(e) }));
    } finally {
      rebuildingRef.current = false;
      setRebuilding(false);
      setProgress(null);
      setTick((x) => x + 1);
    }
  }, [t, toast]);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("rag_index.title")}
      </h3>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-bg-secondary p-4">
        {loading && <Spinner label={t("list.loading")} />}

        {error && !loading && (
          <div className="flex items-center gap-3 text-sm text-danger">
            <span>{t("list.error", { message: error })}</span>
            <button
              type="button"
              onClick={refetch}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-text-primary">
                  {t("rag_index.status", { indexed: data.indexed, total: data.total })}
                </span>
                <span className="text-xs tabular-nums text-text-muted">
                  {t("rag_index.pending", { count: data.pending })}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                  style={{
                    inlineSize: `${data.total > 0 ? Math.round((data.indexed / data.total) * 100) : 0}%`,
                  }}
                  aria-hidden
                />
              </div>
              <span className="text-xs tabular-nums text-text-muted">
                {t("rag_index.chunks", { count: data.chunks })}
              </span>
            </div>

            {!data.modelReady && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("rag_index.model_missing")}
              </p>
            )}

            {/* Parcalama kurallari degisti → mevcut parcalar bayat. Bunu SOYLEMEZSEK kart
                "hepsi indekslendi" derdi ve duzeltmenin ulasmadigi gorulmezdi. */}
            {data.staleChunks > 0 && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("rag_index.stale_notice", { count: data.staleChunks })}
              </p>
            )}

            {data.modelReady && data.pending === 0 && data.staleChunks === 0 && data.total > 0 && (
              <p className="text-xs text-text-muted">{t("rag_index.all_done")}</p>
            )}

            {(running || rebuilding) && (
              <div className="flex flex-col gap-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                    style={{ inlineSize: `${pct}%` }}
                    aria-hidden
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {progress
                      ? t("rag_index.progress_count", {
                          done: progress.processed,
                          total: progress.total,
                        })
                      : t("rag_index.running")}
                  </span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                {progress?.currentPath && (
                  <p dir="ltr" title={progress.currentPath} className="truncate text-xs text-text-muted">
                    {baseName(progress.currentPath)}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && data.pending > 0 && (
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={!data.modelReady || running || rebuilding}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {running ? t("rag_index.running") : t("rag_index.run", { count: data.pending })}
                </button>
              )}

              {/* Parcalama kurallari degistiginde mevcut parcalar bayatlar ama vektor
                  indeksleri gecerli kalir → tam sifirlama yerine yalniz parcalari kur. */}
              {isAdmin && data.chunks > 0 && (
                <button
                  type="button"
                  onClick={() => void rebuild()}
                  disabled={!data.modelReady || running || rebuilding}
                  title={t("rag_index.rebuild_hint")}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {rebuilding ? t("rag_index.rebuilding") : t("rag_index.rebuild")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

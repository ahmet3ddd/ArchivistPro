// Semantik Indeks karti (Faz 5.1) — Dashboard'a yerlesir. Embedding (vektor) uretim
// durumunu gosterir + admin'e "Embedle (kalan N)" eylemi verir:
//   • durum: "X / N embedlendi" + kalan (pending) — embedStatus() ile.
//   • modelReady=false → net uyari (model bulunamadi), buton pasif.
//   • admin + pending>0 → uretim butonu → runEmbedding(onProgress); INGEST ilerleme idiomu
//     (determinate cubuk + processed/total + currentPath dir=ltr). Bitince toast + durum tazele.
//   • bitince "artik Semantik arama kullanilabilir" ipucu.
//
// Yetki UI-only: rol useSession'dan (viewer/editor butonu gormez); gercek kontrol Rust'ta.
// Glassmorphic kart (.glass) + token'lar + logical CSS (RTL) + motion-reduce (transition).

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EmbedProgress, EmbedStatus } from "../../ipc/client";
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

export function SemanticIndexCard() {
  const { t } = useTranslation();
  const { isAdmin } = useSession(); // gorunum-only; gercek yetki Rust'ta
  const toast = useToast();
  const dataVersion = useUiStore((s) => s.dataVersion);

  // Durum sorgusu (her rol okur). `tick` ile uretim sonrasi yeniden cekilir.
  const [tick, setTick] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<EmbedStatus>(
    () => ipc.embedStatus(),
    [tick, dataVersion],
  );

  // Uretim durumu + canli ilerleme (Channel'dan).
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const runningRef = useRef(false); // cift-tetik koruma

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    try {
      const report = await ipc.runEmbedding((p) => setProgress(p));
      toast.success(
        t("embed.done_toast", { embedded: report.embedded, failed: report.failed }),
      );
    } catch (e: unknown) {
      toast.error(t("embed.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
      setTick((x) => x + 1); // durumu yeniden cek (kalan/embedlenen guncellensin)
    }
  }, [t, toast]);

  // Ilerleme yuzdesi (total>0 → determinate; aksi halde 0).
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("embed.title")}
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
            {/* Durum ozeti: "X / N embedlendi" + kalan */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-text-primary">
                  {t("embed.status", { embedded: data.embedded, total: data.total })}
                </span>
                <span className="text-xs tabular-nums text-text-muted">
                  {t("embed.pending", { count: data.pending })}
                </span>
              </div>
              {/* Tamamlanma cubugu (embedded / total) — durum gostergesi */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                  style={{
                    inlineSize: `${data.total > 0 ? Math.round((data.embedded / data.total) * 100) : 0}%`,
                  }}
                  aria-hidden
                />
              </div>
            </div>

            {/* Model yok → net uyari (buton pasif) */}
            {!data.modelReady && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("embed.model_missing")}
              </p>
            )}

            {/* Tum asset'ler embedli → "hazir" ipucu */}
            {data.modelReady && data.pending === 0 && data.total > 0 && (
              <p className="text-xs text-text-muted">{t("embed.all_done")}</p>
            )}

            {/* Uretim ilerlemesi (calisirken) — INGEST determinate idiomu */}
            {running && (
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
                      ? t("embed.progress_count", {
                          done: progress.processed,
                          total: progress.total,
                        })
                      : t("embed.running")}
                  </span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                {progress?.currentPath && (
                  <p
                    dir="ltr"
                    title={progress.currentPath}
                    className="truncate text-xs text-text-muted"
                  >
                    {baseName(progress.currentPath)}
                  </p>
                )}
              </div>
            )}

            {/* Admin + kalan var → uretim butonu (viewer/editor gormez) */}
            {isAdmin && data.pending > 0 && (
              <button
                type="button"
                onClick={() => void run()}
                disabled={!data.modelReady || running}
                className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                {running
                  ? t("embed.running")
                  : t("embed.run", { count: data.pending })}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

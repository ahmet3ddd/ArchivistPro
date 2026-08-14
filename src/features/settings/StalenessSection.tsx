// Archive freshness (staleness) Doctor section.
//
// Automatic and manual checks share one request. Only a changed (stale) sample can be corrected
// here: it is reindexed by id, without a folder-wide rescan or any deletion.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StaleItem, StaleKind } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { useBgTaskStore } from "../bgtask/bgTaskStore";
import { refreshStalenessReport } from "../health/useStalenessMonitor";
import { useToast } from "../toast/useToast";
import { CountItem, KindBadge, SampleList, SampleRow, type Tone } from "./healthPrimitives";

const KIND_TONE: Record<StaleKind, Tone> = {
  ok: "ok",
  stale: "warn",
  missing: "danger",
  offline: "muted",
};
const KIND_LABEL: Record<StaleKind, string> = {
  ok: "health.ok",
  stale: "health.kind_stale",
  missing: "health.kind_missing",
  offline: "health.kind_offline",
};

export function StalenessSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const report = useUiStore((s) => s.stalenessReport);
  const bumpData = useUiStore((s) => s.bumpData);
  const bgStart = useBgTaskStore((s) => s.start);
  const bgUpdate = useBgTaskStore((s) => s.update);
  const bgEnd = useBgTaskStore((s) => s.end);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reindexingId, setReindexingId] = useState<number | null>(null);
  const reindexingRef = useRef<number | null>(null);

  const run = useCallback(async () => {
    if (busyRef.current || reindexingRef.current != null) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Automatic monitor and manual Doctor action share one in-flight filesystem scan.
      await refreshStalenessReport();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [toast]);

  const reindexChanged = useCallback(
    async (sample: StaleItem) => {
      if (sample.kind !== "stale" || reindexingRef.current != null) return;
      reindexingRef.current = sample.id;
      setReindexingId(sample.id);
      const taskId = bgStart("reindex", 1);
      try {
        const result = await ipc.reindexAssets([sample.id], (progress) =>
          bgUpdate(taskId, { processed: progress.processed, total: progress.total }),
        );
        toast.success(
          t("reindex.done", {
            reindexed: result.reindexed,
            missing: result.missing,
            failed: result.failed,
          }),
        );
        if (result.reindexed > 0) bumpData();
        // The source may have disappeared during the operation, so refresh even when no write
        // occurred. This replaces the old stale marker with the current missing/offline state.
        const refreshed = await refreshStalenessReport().catch(() => null);
        // Baska bir denetim veri-surumunden once baslamissa yukaridaki cagri onun gecersiz
        // sonucunu beklemis olabilir. O durumda yeni an icin bir kez daha tara.
        if (refreshed == null) await refreshStalenessReport().catch(() => null);
      } catch {
        toast.error(t("reindex.failed"));
      } finally {
        bgEnd(taskId);
        reindexingRef.current = null;
        setReindexingId(null);
      }
    },
    [bgEnd, bgStart, bgUpdate, bumpData, t, toast],
  );

  const allFresh =
    report != null && report.stale === 0 && report.missing === 0 && report.offline === 0;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-text-secondary">{t("health.staleness_title")}</h4>
      <p className="text-xs text-text-muted">{t("health.staleness_hint")}</p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || reindexingId != null}
        className="inline-flex items-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        {busy && (
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden
          />
        )}
        {busy ? t("health.checking") : t("health.check")}
      </button>

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <CountItem label={t("health.ok")} value={report.ok} tone="ok" />
            <CountItem label={t("health.stale")} value={report.stale} tone="warn" />
            <CountItem label={t("health.stale_missing")} value={report.missing} tone="danger" />
            <CountItem label={t("health.stale_offline")} value={report.offline} tone="muted" />
          </div>

          {allFresh ? (
            <p className="text-xs text-success">{t("health.stale_fresh")}</p>
          ) : (
            <>
              {report.stale > 0 && (
                <p className="text-xs text-text-muted">{t("health.stale_reindex_hint")}</p>
              )}
              {report.samples.length > 0 && (
                <SampleList>
                  {report.samples.map((sample) => (
                    <SampleRow
                      key={sample.id}
                      path={sample.path}
                      badge={
                        <KindBadge
                          label={t(KIND_LABEL[sample.kind])}
                          tone={KIND_TONE[sample.kind]}
                        />
                      }
                      action={
                        sample.kind === "stale" ? (
                          <button
                            type="button"
                            onClick={() => void reindexChanged(sample)}
                            disabled={reindexingId != null}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-1 text-[10px] font-medium text-text-secondary transition hover:border-border-hover hover:bg-bg-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {reindexingId === sample.id && (
                              <span
                                className="h-2.5 w-2.5 animate-spin rounded-full border border-border border-t-accent"
                                aria-hidden
                              />
                            )}
                            {t("reindex.action")}
                          </button>
                        ) : undefined
                      }
                    />
                  ))}
                </SampleList>
              )}
              {report.offline > 0 && (
                <p className="text-xs text-text-muted">{t("health.stale_offline_hint")}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

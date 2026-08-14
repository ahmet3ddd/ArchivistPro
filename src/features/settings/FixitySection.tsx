// Icerik Butunlugu (fixity / bit-rot) — Doctor dosya-sistemi ayagi II.
//
// Orneklem-% (10/25/50/100, varsayilan 10) + "Kontrol Et" → check_fixity(pct): orneklem BLAKE3
// rehash ↔ ingest-ani baseline. mtime degismeden dosya sessizce bozulmus mu (bit-rot). Pahali →
// orneklem. Sonuc: sampled/ok/mismatch/missing (+ noBaseline yalniz >0) + mismatch/missing listesi.
// mismatch bulunursa "yedekten geri-yukleyin" onerisi. Cift-tetik koruma (ref) + hata toast.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { FixityKind, FixityReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { CountItem, KindBadge, SampleList, SampleRow, type Tone } from "./healthPrimitives";

const SAMPLE_OPTIONS = [10, 25, 50, 100] as const;

// mismatches listesinde yalniz mismatch + missing gorunur; esleme yine de eksiksiz.
const KIND_TONE: Record<FixityKind, Tone> = {
  ok: "ok",
  mismatch: "danger",
  missing: "warn",
  noBaseline: "muted",
};
const KIND_LABEL: Record<FixityKind, string> = {
  ok: "health.ok",
  mismatch: "health.kind_mismatch",
  missing: "health.kind_missing",
  noBaseline: "health.kind_no_baseline",
};

export function FixitySection() {
  const { t } = useTranslation();
  const toast = useToast();

  const [pct, setPct] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [report, setReport] = useState<FixityReport | null>(null);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setReport(await ipc.checkFixity(pct));
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [toast, pct]);

  const clean = report != null && report.mismatch === 0 && report.missing === 0;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-text-secondary">{t("health.fixity_title")}</h4>
      <p className="text-xs text-text-muted">{t("health.fixity_hint")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          {t("health.fixity_sample")}
          <select
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            disabled={busy}
            className="rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {SAMPLE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}%
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          {busy && (
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent"
              aria-hidden
            />
          )}
          {busy ? t("health.checking") : t("health.fixity_run")}
        </button>
      </div>

      {report && (
        <>
          {/* Sayim: sampled(notr) ok(yesil) mismatch(kirmizi) missing(amber); noBaseline yalniz >0. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <CountItem label={t("health.fixity_sampled")} value={report.sampled} tone="muted" />
            <CountItem label={t("health.ok")} value={report.ok} tone="ok" />
            <CountItem label={t("health.fixity_mismatch")} value={report.mismatch} tone="danger" />
            <CountItem label={t("health.stale_missing")} value={report.missing} tone="warn" />
            {report.noBaseline > 0 && (
              <CountItem
                label={t("health.kind_no_baseline")}
                value={report.noBaseline}
                tone="muted"
              />
            )}
          </div>

          {clean ? (
            <p className="text-xs text-success">
              {t("health.fixity_clean", { sampled: report.sampled })}
            </p>
          ) : (
            <>
              {report.mismatches.length > 0 && (
                <SampleList>
                  {report.mismatches.map((m) => (
                    <SampleRow
                      key={m.id}
                      path={m.path}
                      badge={<KindBadge label={t(KIND_LABEL[m.kind])} tone={KIND_TONE[m.kind]} />}
                    />
                  ))}
                </SampleList>
              )}
              {report.mismatch > 0 && (
                <p className="text-xs text-text-muted">{t("health.fixity_mismatch_hint")}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

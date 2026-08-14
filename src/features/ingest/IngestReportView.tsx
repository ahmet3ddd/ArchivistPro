// Indeksleme modali — "Rapor" adimi (IngestModal alt-bileseni; <500 satir).
//
// Backend IngestReport'u cizer: sayac cipleri (added/updated/skipped/failed) + Sure
// (elapsedMs → "Xm Ys") + Bicim dagilimi (typeCounts rozetleri; SUNUCU sirali) + Hatalar
// (#7: olumcul {path,message}, danger, yalniz varsa) + Uyarilar (olumcul-olmayan {path,message};
// kaydirlabilir liste, dostca bos-durum). Renderer TOPLAMAZ — yalniz bicimler/cizer.
// Renderer TOPLAMAZ — yalniz bicimler/cizer. i18n + logical CSS (RTL); yol dir='ltr'.

import { useTranslation } from "react-i18next";

import type { IngestMode, IngestReport } from "../../ipc/client";

interface Props {
  report: IngestReport;
  /** Calistirilan mod — yikici modda (replace/reset) `removed` satiri buna gore etiketlenir. */
  mode: IngestMode;
}

/** elapsedMs → "Xm Ys" (dakika dusukse 0m gizlenmez; H2 pariti basit format). */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/** Tek istatistik cipi (etiket + sayi). */
function StatChip({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "danger" | "muted" }) {
  const toneCls =
    tone === "ok"
      ? "text-accent"
      : tone === "warn"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-text-secondary";
  return (
    <div className="flex flex-col items-center rounded-md border border-border bg-bg-tertiary/50 px-3 py-2">
      <span className={`font-display text-xl font-bold tabular-nums ${toneCls}`}>{value}</span>
      <span className="mt-0.5 text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
    </div>
  );
}

export function IngestReportView({ report, mode }: Props) {
  const { t } = useTranslation();
  const {
    added,
    updated,
    skipped,
    failed,
    removed,
    elapsedMs,
    typeCounts,
    warnings,
    errors,
    skippedReasons,
    droppedEntries,
  } = report;
  // Geriye-uyum: eski (④-C oncesi) rapor DTO'sunda alan yoksa bos kabul et (undefined guard).
  const skips = skippedReasons ?? [];
  // Tavan asildiysa listeler ORNEKtir — bunu SOYLEMEK zorunlu (sessiz kesme yanlis-guven uretir).
  const dropped = droppedEntries ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Sayac cipleri */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatChip label={t("ingest.added")} value={added} tone="ok" />
        <StatChip label={t("ingest.updated")} value={updated} tone="muted" />
        <StatChip label={t("ingest.skipped")} value={skipped} tone="muted" />
        <StatChip label={t("ingest.failed")} value={failed} tone={failed > 0 ? "danger" : "muted"} />
      </div>

      {/* Liste KIRPILDI uyarisi — sayaclar (yukarida) tam, asagidaki listeler ornek. */}
      {dropped > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-snug text-warning">
          {t("ingest.report_truncated", { count: dropped })}
        </p>
      )}

      {/* Sure */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-muted">{t("ingest.duration")}</span>
        <span className="font-medium tabular-nums text-text-primary">{formatDuration(elapsedMs)}</span>
      </div>

      {/* Yikici mod ozeti: Replace → cope tasinan; Reset → bastan silinen (mod-bazli etiket). */}
      {mode !== "merge" && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            mode === "reset"
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
        >
          <span className="tabular-nums font-medium">
            {mode === "reset"
              ? t("ingest.removed_purged", { count: removed })
              : t("ingest.removed_trashed", { count: removed })}
          </span>
        </div>
      )}

      {/* Bicim dagilimi (typeCounts; sunucu sirali) */}
      {typeCounts.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t("ingest.formats")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {typeCounts.map((tc) => (
              <span
                key={tc.ext}
                className="rounded-full border border-border bg-bg-tertiary/60 px-2.5 py-1 text-xs text-text-secondary"
              >
                <span dir="ltr" className="font-medium text-text-primary">
                  {tc.ext === "" ? t("ingest.no_ext") : `.${tc.ext}`}
                </span>
                <span className="ms-1 tabular-nums text-text-muted">{tc.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Hatalar (#7: olumcul — dosya indekslenEMEDI) — yalniz varsa, danger vurgu, kaydirlabilir.
          `failed` cipi sayiyi zaten gosteriyor → bos-durum kutusu YOK (gurultu olmasin). */}
      {errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-danger">
            {t("ingest.errors_title", { count: errors.length })}
          </span>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-auto rounded-md border border-danger/40 bg-danger/5 p-2">
            {errors.map((e, i) => (
              <li
                key={`${e.path}-${i}`}
                className="rounded border-s-2 border-danger/70 bg-bg-secondary/60 px-2.5 py-1.5 text-xs"
              >
                <span dir="ltr" className="block truncate text-start font-medium text-text-primary" title={e.path}>
                  {e.path}
                </span>
                <span className="mt-0.5 block text-danger">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Uyarilar (yapilandirilmis) — kaydirlabilir; dostca bos-durum */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("ingest.warnings_title", { count: warnings.length })}
        </span>
        {warnings.length === 0 ? (
          <p className="rounded-md border border-border bg-bg-tertiary/40 px-3 py-3 text-center text-sm text-text-secondary">
            {t("ingest.warnings_none")}
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-auto rounded-md border border-border bg-bg-tertiary/40 p-2">
            {warnings.map((w, i) => (
              <li
                key={`${w.path}-${i}`}
                className="rounded border-s-2 border-warning/60 bg-bg-secondary/60 px-2.5 py-1.5 text-xs"
              >
                <span dir="ltr" className="block truncate text-start font-medium text-text-primary" title={w.path}>
                  {w.path}
                </span>
                <span className="mt-0.5 block text-text-secondary">{w.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Atlananlar (④-C): walker seviyesinde INDEKSLENMEYEN girdiler + sebep. Yalniz varsa
          gosterilir (bos-durum gurultusu yok). `message` = sebep-KODU → i18n ile yerellestirilir
          (bilinmeyen kod fallback olarak ham gosterilir). Yol dir='ltr'. */}
      {skips.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t("ingest.skipped_reasons_title", { count: skips.length })}
          </span>
          <p className="text-[11px] text-text-muted">{t("ingest.skipped_reasons_hint")}</p>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-auto rounded-md border border-border bg-bg-tertiary/40 p-2">
            {skips.map((sk, i) => (
              <li
                key={`${sk.path}-${i}`}
                className="flex items-center justify-between gap-2 rounded border-s-2 border-border bg-bg-secondary/60 px-2.5 py-1.5 text-xs"
              >
                <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-medium text-text-primary" title={sk.path}>
                  {sk.path}
                </span>
                <span className="shrink-0 rounded-full border border-border bg-bg-tertiary/60 px-2 py-0.5 text-[10px] text-text-secondary">
                  {t(`ingest.skipReason.${sk.message}`, sk.message)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

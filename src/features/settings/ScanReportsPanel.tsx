// Tarama raporlari gecmisi (P2.5 ④) — yalniz admin; salt-okuma + Farkli Kaydet + Gecmisi Temizle.
// Her tarama (ingest) sonunda backend'in kalici kaydettigi raporlari usta-detay yerlesimiyle gosterir.
// CrashLogPanel/AuditLogPanel deseni: portal (TopBar backdrop-blur containing-block tuzagindan kacar)
// + scrim + Esc; veri sorgu-hook (useIpcQuery). Sol: kosu listesi (`list_scan_reports`, en yeni once);
// satira tikla → sag: tam detay (`get_scan_report`) mevcut IngestReportView ile cizilir (ADAPTER YOK —
// ScanReportDetail, IngestReport'un tum alanlarini tasir). "Farkli Kaydet" (.txt/.json) kaydet-diyalogu
// → export_scan_report. "Gecmisi Temizle" onayli (danger). i18n + logical CSS (RTL); yol dir='ltr'.

import { confirm, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { IngestMode, ScanReportDetail, ScanReportSummary } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatDate } from "../../lib/format";
import { EmptyState } from "../../components/EmptyState";
import { IngestReportView } from "../ingest/IngestReportView";
import { useToast } from "../toast/useToast";

const LIMIT = 200;

interface Props {
  onClose: () => void;
}

const btn =
  "rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

export function ScanReportsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<ScanReportSummary[]>(
    () => ipc.listScanReports(LIMIT),
    [reloadKey],
  );
  // data ref'i fetch tamamlaninca degisir → useMemo ile stabil dizi (secim efekti donmesin).
  const items = useMemo(() => data ?? [], [data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  // Secili kosu: liste degisince gecerli tut (bos → yok; secili silinmis/ilk yukleme → ilk satir).
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
    } else if (selectedId == null || !items.some((r) => r.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  // Secili raporun tam detayi (typeCounts/warnings/errors). selectedId yoksa cekme (null'a coz).
  const {
    data: detail,
    loading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useIpcQuery<ScanReportDetail | null>(
    () => (selectedId == null ? Promise.resolve(null) : ipc.getScanReport(selectedId)),
    [selectedId, reloadKey],
  );

  // Esc → kapat (capture; CrashLogPanel ile ayni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Gecmisi temizle (onayli; danger) → sil + secim/listeyi tazele.
  const clearAll = () =>
    void (async () => {
      if (clearing || items.length === 0) return;
      const ok = await confirm(t("scanReport.clear_confirm"), {
        title: t("scanReport.clear"),
        kind: "warning",
      });
      if (!ok) return;
      setClearing(true);
      try {
        await ipc.clearScanReports();
        toast.success(t("scanReport.cleared"));
        setSelectedId(null);
        setReloadKey((k) => k + 1);
      } catch {
        toast.error(t("scanReport.clear_failed"));
      } finally {
        setClearing(false);
      }
    })();

  // Farkli Kaydet: format sec → kaydet-diyalogu → export_scan_report → toast.
  const saveAs = (report: ScanReportDetail, format: "txt" | "json") =>
    void (async () => {
      const dest = await save({
        defaultPath: `${defaultBaseName(report)}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        title: t("scanReport.save"),
      });
      if (typeof dest !== "string") return;
      try {
        await ipc.exportScanReport(report.id, format, dest);
        toast.success(t("scanReport.export_ok"));
      } catch {
        toast.error(t("scanReport.export_failed"));
      }
    })();

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("scanReport.title")}
      >
        {/* Baslik + sayi + Gecmisi Temizle + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("scanReport.title")}
            {items.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("scanReport.count", { count: items.length })}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={clearing || items.length === 0}
              className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("scanReport.clear")}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        <p className="border-b border-border bg-bg-tertiary/40 px-5 py-2 text-xs text-text-muted">
          {t("scanReport.hint")}
        </p>

        {/* Icerik: yukleniyor / hata / bos / usta-detay */}
        {loading ? (
          <p className="px-5 py-6 text-sm text-text-muted">{t("scanReport.loading")}</p>
        ) : error ? (
          <div className="px-5 py-6 text-sm text-danger">
            <p>{t("list.error", { message: error })}</p>
            <button type="button" onClick={refetch} className={`mt-2 ${btn}`}>
              {t("common.retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t("scanReport.empty")} hint={t("scanReport.empty_hint")} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            {/* Usta: kosu listesi (sol/ust) */}
            <ul className="flex max-h-48 shrink-0 flex-col gap-1.5 overflow-auto border-b border-border p-3 sm:max-h-none sm:w-80 sm:border-b-0 sm:border-e">
              {items.map((r) => (
                <ScanReportRow
                  key={r.id}
                  report={r}
                  selected={r.id === selectedId}
                  onSelect={() => setSelectedId(r.id)}
                />
              ))}
            </ul>

            {/* Detay (sag/alt): secili raporun tam raporu */}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {detailLoading ? (
                <p className="text-sm text-text-muted">{t("scanReport.loading")}</p>
              ) : detailError ? (
                <div className="text-sm text-danger">
                  <p>{t("list.error", { message: detailError })}</p>
                  <button type="button" onClick={refetchDetail} className={`mt-2 ${btn}`}>
                    {t("common.retry")}
                  </button>
                </div>
              ) : detail == null ? (
                <EmptyState title={t("scanReport.select_hint")} />
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Detay basligi: kok yolu + zaman + mod + Farkli Kaydet */}
                  <div className="flex flex-col gap-2 border-b border-border pb-3">
                    <span
                      dir="ltr"
                      className="truncate text-start text-sm font-medium text-text-primary"
                      title={detail.rootPath}
                    >
                      {detail.rootPath}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span className="tabular-nums">{formatDate(detail.ts)}</span>
                      <ModeBadge mode={detail.mode} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text-secondary">{t("scanReport.save")}</span>
                      <button type="button" onClick={() => saveAs(detail, "txt")} className={btn}>
                        {t("scanReport.save_txt")}
                      </button>
                      <button type="button" onClick={() => saveAs(detail, "json")} className={btn}>
                        {t("scanReport.save_json")}
                      </button>
                    </div>
                  </div>

                  {/* Tam rapor — mevcut IngestReportView reuse (typeCounts/warnings/errors + mode). */}
                  <IngestReportView report={detail} mode={detail.mode} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Kaydet-diyalogu icin varsayilan dosya adi (dil-notr; uzanti cagiran tarafta eklenir). */
function defaultBaseName(report: ScanReportDetail): string {
  return `scan-report-${report.id}`;
}

/** Tarama modu rozeti (merge/replace/reset). Yikici modlar (replace/reset) vurgulu. */
function ModeBadge({ mode }: { mode: IngestMode }) {
  const { t } = useTranslation();
  const tone =
    mode === "reset"
      ? "border-danger/40 bg-danger/10 text-danger"
      : mode === "replace"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-bg-tertiary text-text-muted";
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase ${tone}`}>
      {t(`scanReport.mode.${mode}`)}
    </span>
  );
}

/** Tek istatistik cipi (etiket + sayi) — usta liste satirinda kompakt. */
function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "danger" | "muted";
}) {
  const toneCls =
    tone === "ok" ? "text-accent" : tone === "danger" ? "text-danger" : "text-text-secondary";
  return (
    <span className="rounded border border-border bg-bg-tertiary/50 px-1.5 py-0.5 text-[10px]">
      <span className="text-text-muted">{label}</span>
      <span className={`ms-1 font-medium tabular-nums ${toneCls}`}>{value}</span>
    </span>
  );
}

/** Tek kosu satiri (usta) — kok yolu + zaman + mod rozeti + sayi cipleri + uyari/hata rozetleri. */
function ScanReportRow({
  report,
  selected,
  onSelect,
}: {
  report: ScanReportSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-md border px-3 py-2 text-start transition ${
          selected
            ? "border-accent bg-accent/10"
            : "border-border bg-bg-secondary/50 hover:border-border-hover hover:bg-bg-tertiary"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            dir="ltr"
            className="truncate text-start text-xs font-medium text-text-primary"
            title={report.rootPath}
          >
            {report.rootPath}
          </span>
          <ModeBadge mode={report.mode} />
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-text-muted">{formatDate(report.ts)}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <CountChip label={t("scanReport.added")} value={report.added} tone="ok" />
          <CountChip label={t("scanReport.updated")} value={report.updated} tone="muted" />
          <CountChip label={t("scanReport.skipped")} value={report.skipped} tone="muted" />
          <CountChip
            label={t("scanReport.failed")}
            value={report.failed}
            tone={report.failed > 0 ? "danger" : "muted"}
          />
          {report.warningCount > 0 && (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
              {t("scanReport.warnings_badge", { count: report.warningCount })}
            </span>
          )}
          {report.errorCount > 0 && (
            <span className="rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">
              {t("scanReport.errors_badge", { count: report.errorCount })}
            </span>
          )}
          {report.skippedReasonCount > 0 && (
            <span className="rounded-full border border-border bg-bg-tertiary/60 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              {t("scanReport.skipped_badge", { count: report.skippedReasonCount })}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

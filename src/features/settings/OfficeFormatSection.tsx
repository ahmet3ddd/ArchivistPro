// Eski Office biçimleri — Doctor'un salt-tanı ayağı.
//
// Aktif Microsoft Office dosyalarında yalnız ilk sekiz baytı denetler. Gerçek
// ikili DOC/XLS/PPT'leri ve uzantı-içerik çelişkilerini gösterir; dönüşüm,
// yeniden adlandırma ve DB yazımı YOKTUR. Erişilemeyen kaynaklar Staleness
// bölümünde göründüğü için burada ikinci bir Missing alarmı üretilmez.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OfficeFormatKind, OfficeFormatReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { CountItem, KindBadge, SampleList, SampleRow, type Tone } from "./healthPrimitives";

const KIND_TONE: Record<OfficeFormatKind, Tone> = {
  legacyBinary: "warn",
  extensionMismatch: "danger",
  unknown: "danger",
};
const KIND_LABEL: Record<OfficeFormatKind, string> = {
  legacyBinary: "health.office_legacy",
  extensionMismatch: "health.office_mismatch",
  unknown: "health.office_unknown",
};

export function OfficeFormatSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [report, setReport] = useState<OfficeFormatReport | null>(null);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setReport(await ipc.checkOfficeFormats());
    } catch (error: unknown) {
      toast.error(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [toast]);

  const clean =
    report != null &&
    report.legacyBinary === 0 &&
    report.extensionMismatch === 0 &&
    report.unknown === 0;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-xs font-semibold text-text-secondary">{t("health.office_title")}</h4>
      <p className="text-xs text-text-muted">{t("health.office_hint")}</p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex self-start items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        {busy && (
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden
          />
        )}
        {busy ? t("health.checking") : t("health.office_run")}
      </button>

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <CountItem label={t("health.office_checked")} value={report.checked} tone="muted" />
            <CountItem
              label={t("health.office_legacy")}
              value={report.legacyBinary}
              tone="warn"
            />
            <CountItem
              label={t("health.office_mismatch")}
              value={report.extensionMismatch}
              tone="danger"
            />
            <CountItem label={t("health.office_unknown")} value={report.unknown} tone="danger" />
          </div>

          {clean ? (
            <p className="text-xs text-success">{t("health.office_clean", { checked: report.checked })}</p>
          ) : (
            <>
              {report.items.length > 0 && (
                <SampleList>
                  {report.items.map((item) => (
                    <SampleRow
                      key={item.id}
                      path={item.path}
                      badge={<KindBadge label={t(KIND_LABEL[item.kind])} tone={KIND_TONE[item.kind]} />}
                    />
                  ))}
                </SampleList>
              )}
              {report.legacyBinary > 0 && (
                <p className="text-xs text-text-muted">{t("health.office_legacy_hint")}</p>
              )}
              {(report.extensionMismatch > 0 || report.unknown > 0) && (
                <p className="text-xs text-text-muted">{t("health.office_mismatch_hint")}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

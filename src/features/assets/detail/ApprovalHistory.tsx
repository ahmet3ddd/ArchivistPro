// Onay durumu GECIS gecmisi (H2 `approval_log` pariti) — Proje-durum bolumunun alt-parcasi.
// Bir asset'in onay durumu her degistiginde (eski→yeni) bir satir: kim / ne zaman / sebep.
// `dataVersion`'a ABONE → kaydetme/geri-al/toplu islem sonrasi otomatik tazelenir (ProjectSection
// save bumpData cagirir). Salt-okuma (her rol gorur).

import { useTranslation } from "react-i18next";

import type { ApprovalLogEntry } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { useIpcQuery } from "../../../hooks/useIpcQuery";
import { useUiStore } from "../../../store/useUiStore";
import { approvalStatusLabel } from "./projectStatus";

/** unix SANIYE → yerel kisa tarih+saat. */
function formatTs(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(seconds * 1000),
  );
}

export function ApprovalHistory({ assetId }: { assetId: number }) {
  const { t } = useTranslation();
  const dataVersion = useUiStore((s) => s.dataVersion);
  const { data } = useIpcQuery<ApprovalLogEntry[]>(
    () => ipc.listApprovalLog(assetId),
    [assetId, dataVersion],
  );
  const entries = data ?? [];

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="approval-history">
      <h4 className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        {t("project.approval_history")}
      </h4>
      {entries.length === 0 ? (
        <p className="text-[11px] text-text-muted">{t("project.approval_history_empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="text-[11px] leading-4">
              <div className="flex items-center gap-1 text-text-secondary">
                <span>{approvalStatusLabel(e.fromStatus, t)}</span>
                <span aria-hidden className="text-text-muted">
                  →
                </span>
                <span className="font-medium text-text-primary">
                  {approvalStatusLabel(e.toStatus, t)}
                </span>
              </div>
              {e.reason && <p className="text-text-muted">{e.reason}</p>}
              <p className="text-[10px] text-text-muted">
                {t("project.approval_history_by", { user: e.changedBy })} · {formatTs(e.changedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

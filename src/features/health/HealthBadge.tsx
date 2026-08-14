// Alt durum cubugundaki DB ve dosya guncelligi rozeti.

import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";

export function HealthBadge() {
  const { t } = useTranslation();
  const dataVersion = useUiStore((s) => s.dataVersion);
  const remoteMode = useUiStore((s) => s.assetSource === "remote");
  const stalenessReport = useUiStore((s) => s.stalenessReport);
  const { data } = useIpcQuery(() => ipc.dbHealth(), [dataVersion]);

  if (!data && (!stalenessReport || remoteMode)) return null;

  const freshnessProblemCount = stalenessReport
    ? stalenessReport.stale + stalenessReport.missing + stalenessReport.offline
    : 0;
  const freshnessOk = freshnessProblemCount === 0;
  const freshnessDotClass =
    stalenessReport?.missing
      ? "bg-danger"
      : stalenessReport?.stale
        ? "bg-warning"
        : stalenessReport?.offline
          ? "bg-text-muted"
          : "bg-success";
  const freshnessTitle = freshnessOk
    ? t("health.stale_fresh")
    : t("health.staleness_summary", {
        stale: stalenessReport?.stale ?? 0,
        missing: stalenessReport?.missing ?? 0,
        offline: stalenessReport?.offline ?? 0,
      });

  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      {data && (
        <>
          <span
            className={`h-2 w-2 rounded-full ${data.integrity_ok ? "bg-success" : "bg-danger"}`}
            title={data.integrity_ok ? t("health.ok") : t("health.broken")}
          />
          <span>{t("health.schema", { v: data.schema_version })}</span>
          <span className="text-text-muted">{"\u00b7"}</span>
          <span>{t("health.assets", { count: data.asset_count })}</span>
        </>
      )}
      {stalenessReport && !remoteMode && (
        <>
          {data && <span className="text-text-muted">{"\u00b7"}</span>}
          <span className="flex items-center gap-1.5" title={freshnessTitle}>
            <span className={`h-2 w-2 rounded-full ${freshnessDotClass}`} aria-hidden />
            <span>
              {freshnessOk
                ? t("health.staleness_current")
                : t("health.staleness_issues", { count: freshnessProblemCount })}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

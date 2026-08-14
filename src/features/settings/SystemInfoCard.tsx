// Ayarlar → Bakım → makine tanısı. Yalnız admin'e gösterilir; backend de aynı
// yetkiyi zorlar. Disk sayısı yalnız arşiv DB'sinin bulunduğu birimi temsil eder.

import { useTranslation } from "react-i18next";

import { useIpcQuery } from "../../hooks/useIpcQuery";
import { ipc } from "../../ipc/client";
import { formatBytes } from "../../lib/format";

function InfoLine({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border pt-2 text-xs">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 break-all text-end text-text-secondary" title={title} dir="ltr">
        {value}
      </span>
    </div>
  );
}

export function SystemInfoCard() {
  const { t } = useTranslation();
  const { data, loading, error, refetch } = useIpcQuery(() => ipc.systemInfo(), []);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("system_info.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("system_info.hint")}</p>

      {loading && <p className="text-xs text-text-muted">{t("list.loading")}</p>}

      {error && !loading && (
        <div className="flex items-center gap-2 text-xs text-danger">
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
          <InfoLine label={t("system_info.app_version")} value={data.appVersion} />
          <InfoLine
            label={t("system_info.build")}
            value={`${data.buildProfile} · ${data.targetOs}/${data.targetArch}`}
          />
          <InfoLine
            label={t("system_info.features")}
            value={data.buildFeatures.join(" · ")}
          />
          <InfoLine label={t("system_info.hostname")} value={data.hostname} />
          <InfoLine label={t("system_info.local_ip")} value={data.localIp} />
          <InfoLine
            label={t("system_info.archive_disk")}
            value={
              data.disk
                ? t("system_info.disk_usage", {
                    free: formatBytes(data.disk.freeBytes),
                    total: formatBytes(data.disk.totalBytes),
                  })
                : t("system_info.disk_unavailable")
            }
            title={data.diskError ?? undefined}
          />
          <InfoLine
            label={t("system_info.archive_path")}
            value={data.archivePath}
            title={data.archivePath}
          />
          <button
            type="button"
            onClick={refetch}
            className="self-start rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:border-border-hover hover:bg-bg-tertiary"
          >
            {t("system_info.refresh")}
          </button>
        </>
      )}
    </section>
  );
}

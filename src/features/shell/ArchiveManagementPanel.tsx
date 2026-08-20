import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useUiStore } from "../../store/useUiStore";
import { IngestButton } from "../ingest/IngestButton";
import { ProjectsButton } from "../projects/ProjectsButton";
import { OrganizeButton } from "../refile/OrganizeButton";
import { RootsButton } from "../roots/RootsButton";
import { MaintenanceGate } from "./MaintenanceGate";
import { RemoteWriteGate } from "./RemoteWriteGate";

const PANEL_ACTION =
  "flex w-full items-center rounded-lg border border-border bg-bg-tertiary px-3 py-2.5 text-start text-sm text-text-primary transition hover:border-border-hover hover:bg-bg-primary";
const PANEL_PRIMARY =
  "flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover";

/** Sol etkinlik şeridindeki Arşiv girişinin açtığı global yönetim paneli. */
export function ArchiveManagementPanel() {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.archivePanelOpen);
  const setOpen = useUiStore((state) => state.setArchivePanelOpen);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"], [role="menu"]')) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, setOpen]);

  // NOT (2026-08-11): bu erken cikis tum alt agaci soker. Uzun-omurlu pencereler bu panelin
  // COCUGU OLMAMALI — tarama penceresi bu yuzden `AppShell`e tasindi (`IngestHost`). Buraya
  // yeni bir modal eklerken ayni tuzaga dikkat: panel kapaninca kosan is penceresiz kalir.
  if (!open) return null;

  return (
    <aside
      id="archive-management-panel"
      aria-label={t("archive_panel.title")}
      className="flex h-full w-[17rem] shrink-0 flex-col border-e border-border bg-bg-secondary"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-text-primary">
            {t("archive_panel.title")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {t("archive_panel.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("archive_panel.close")}
          title={t("archive_panel.close")}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-lg text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary"
        >
          ×
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <RemoteWriteGate className="flex flex-col gap-2">
          {/* Klasor tarama: `ingest_folders` yazma kilidini TUM kosu boyunca tutar (STATUS B2) →
              AI analizi surerken baslatilirsa analiz donar. Bu yuzden ANALIZ KOSARKEN kilitli. */}
          <MaintenanceGate className="[&>span]:block [&>span]:w-full">
            <IngestButton className={PANEL_PRIMARY} />
          </MaintenanceGate>

          <p className="px-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {t("archive_panel.sources")}
          </p>
          <RootsButton className={PANEL_ACTION} />

          <p className="px-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {t("archive_panel.organization")}
          </p>
          <ProjectsButton className={PANEL_ACTION} />
          {/* Kural ile duzenle: dosyalari TASIR/KOPYALAR → analiz kosarken kilitli (yol degisir). */}
          <MaintenanceGate className="[&>span]:block [&>span]:w-full">
            <OrganizeButton className={PANEL_ACTION} />
          </MaintenanceGate>
        </RemoteWriteGate>
      </div>
    </aside>
  );
}
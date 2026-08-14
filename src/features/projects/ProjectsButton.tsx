// Sol Arşiv yönetim panelindeki "Projeler" giriş noktası. Kendi açık/kapalı durumunu ve
// ProjectsPanel örneğini yönetir; panel kapanınca yalnız modal kapanır.
// Listeleme her role açıktır, yazma eylemleri panel içinde editor+ ile sınırlandırılır.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ProjectsPanel } from "./ProjectsPanel";

export function ProjectsButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary transition hover:border-border-hover"}
      >
        {t("projects.title")}
      </button>
      {open && <ProjectsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

// Sol Arşiv yönetim panelindeki "Kaynak Klasörler" giriş noktası. Kendi açık/kapalı durumunu
// ve RootsPanel örneğini yönetir. Listeleme her role açıktır; yazmalar panel içinde yetkilidir.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { RootsPanel } from "./RootsPanel";

export function RootsButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary transition hover:border-border-hover"}
      >
        <span aria-hidden>📁</span>
        {t("roots.title")}
      </button>
      {open && <RootsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

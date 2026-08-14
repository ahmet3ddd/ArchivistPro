// Sol Arşiv yönetim panelindeki genel "Kural ile düzenle" giriş noktası (yalnız admin).
// OrganizeModal'i seçili dosya vermeden açar; kaynak varsayılanı klasör seçimidir.
// BatchToolbar'daki seçili-dosya giriş noktası ayrıca korunur.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ProtectedAction } from "../../permissions";
import { useUiStore } from "../../store/useUiStore";
import { OrganizeModal } from "./OrganizeModal";

export function OrganizeButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bumpData = useUiStore((s) => s.bumpData);

  return (
    <>
      <ProtectedAction require="admin" mode="disabled">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={className ?? "rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary transition hover:border-border-hover"}
        >
          {t("organize.action")}
        </button>
      </ProtectedAction>
      {open && <OrganizeModal onClose={() => setOpen(false)} onDone={() => bumpData()} />}
    </>
  );
}

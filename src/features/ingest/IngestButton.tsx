// Sol Arşiv yönetim panelindeki birincil "İndeksle…" TETİĞİ (yalnız admin).
// Yetkisiz kullanıcıda keşfedilebilir fakat pasiftir; gerçek yetki Rust tarafındadır.
//
// ⚠️ Pencerenin KENDİSİ burada DEĞİL, `IngestHost` içinde (AppShell) yaşar — bu bileşen sol
// panelin çocuğu ve panel kapanınca sökülüyor; pencere burada olsaydı koşan tarama penceresi
// de onunla birlikte yok olurdu (2026-08-11 bulgusu, bkz IngestHost).
import { useTranslation } from "react-i18next";

import { ProtectedAction } from "../../permissions";
import { useUiStore } from "../../store/useUiStore";

export function IngestButton({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const openIngest = useUiStore((s) => s.openIngest);

  return (
    <ProtectedAction require="admin" mode="disabled">
      <button
        type="button"
        data-testid="ingest-button"
        onClick={() => openIngest(null)}
        className={
          className ??
          "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        }
      >
        {t("ingest.button")}
      </button>
    </ProtectedAction>
  );
}

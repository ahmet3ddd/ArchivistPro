// Crash raporlari karti (P2.5) — Ayarlar modali icindeki admin kart (AuditLogCard deseni birebir).
// Hafif crash sayacini cekip rozetler; "Crash raporlarini ac" dugmesi ebeveyn (TopBar) tetikler,
// Ayarlar kapanir, tam-genis CrashLogPanel acilir. Yalniz admin: SettingsModal `isAdmin` ile kosullu.

import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatNumber } from "../../lib/format";

interface Props {
  /** "Crash raporlarini ac" → ebeveyn (TopBar) Ayarlar'i kapatip CrashLogPanel'i acar. */
  onOpen: () => void;
}

export function CrashLogCard({ onOpen }: Props) {
  const { t } = useTranslation();
  // Kart admin'a ozel oldugu icin ayni admin-gated sayaci kullanir. Panel kapatilip Ayarlar'a
  // donuldugunde kart yeniden kurulur → temizleme sonrasi sayi da taze gelir.
  const { data: count } = useIpcQuery(() => ipc.crashReportCount(), []);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        <span>{t("crash.title")}</span>
        {count != null && count > 0 && (
          <span
            className="rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case tabular-nums text-danger"
            title={t("crash.count", { count })}
          >
            {formatNumber(count)}
          </span>
        )}
      </h3>
      <p className="text-xs text-text-muted">{t("crash.hint")}</p>
      <button
        type="button"
        onClick={onOpen}
        className="self-start rounded-md border border-border px-3 py-1 text-xs text-text-secondary
                   transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent
                   focus:outline-none motion-reduce:transition-none"
      >
        {t("crash.open")}
      </button>
    </section>
  );
}

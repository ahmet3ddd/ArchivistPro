// Kalici otomatik-AI-indeks banner'i (P1; H2 AutoRagIndexBanner pariti). TopBar altinda, surucu
// bir tur kosarken gorunur; isSizken (autoIndexStore.banner === null) RENDER OLMAZ.
//
// Durum autoIndexStore'dan OKUNUR (yazan: useAutoIndex hook'u, AppShell'de). Gosterir:
//   • stage etiketi (yerellestirilmis: Metin/Gorsel/RAG) + processed/total + ilerleme cubugu,
//   • o anki dosya (currentPath; dosya adina kisaltilir, LTR),
//   • "Durdur" (yalniz ADMIN gorur; gercek yetki backend'de — bu UI-gate).
// index_started geldiginde stage henuz yok → indeterminate "basliyor" (pulse cubuk).
//
// Tailwind token'lar (accent) + logical CSS (RTL) + motion-reduce. i18n zorunlu (autoIndex.*).

import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../toast/useToast";
import { useAutoIndexStore } from "./autoIndexStore";

/** Yoldan dosya adi (son `/` veya `\` parcasi); Windows + POSIX (SemanticIndexCard pariti). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function AutoIndexBanner() {
  const { t } = useTranslation();
  const { isAdmin } = useSession(); // gorunum-only; gercek yetki Rust'ta (stop_auto_index ADMIN)
  const toast = useToast();
  const banner = useAutoIndexStore((s) => s.banner);

  if (!banner) return null; // isSiz → banner yok

  const determinate = banner.total > 0 && banner.stage !== null;
  const pct = determinate
    ? Math.min(100, Math.round((banner.processed / banner.total) * 100))
    : 0;
  const label = banner.stage
    ? t("autoIndex.progress", {
        stage: t(`autoIndex.stage.${banner.stage}`),
        processed: banner.processed,
        total: banner.total,
      })
    : t("autoIndex.starting");

  const stop = () => {
    void ipc
      .stopAutoIndex()
      .catch((e: unknown) => toast.error(t("autoIndex.stop_failed", { message: String(e) })));
  };

  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-1.5 text-xs text-text-secondary">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse"
      />
      <span className="shrink-0 font-medium text-text-primary">{label}</span>

      {/* İlerleme cubugu — belirli stage'de determinate (processed/total); "basliyor"da pulse. */}
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-bg-tertiary">
        {determinate ? (
          <div
            className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
            style={{ inlineSize: `${pct}%` }}
            aria-hidden
          />
        ) : (
          <div
            className="h-full w-full rounded-full bg-accent/60 motion-safe:animate-pulse"
            aria-hidden
          />
        )}
      </div>
      {determinate && <span className="shrink-0 tabular-nums text-text-muted">{pct}%</span>}

      {/* O anki dosya (flex-1: bosken de yer tutar → "Durdur" saga yaslanir). */}
      <span
        dir="ltr"
        title={banner.currentPath || undefined}
        className="min-w-0 flex-1 truncate text-text-muted"
      >
        {banner.currentPath ? baseName(banner.currentPath) : ""}
      </span>

      {/* Durdur — yalniz admin gorur (backend zaten ADMIN-gated). */}
      {isAdmin && (
        <button
          type="button"
          onClick={stop}
          className="shrink-0 rounded px-2 py-0.5 text-xs text-danger transition hover:bg-danger/15 focus:outline-none focus:ring-1 focus:ring-danger/40 motion-reduce:transition-none"
        >
          {t("autoIndex.stop")}
        </button>
      )}
    </div>
  );
}

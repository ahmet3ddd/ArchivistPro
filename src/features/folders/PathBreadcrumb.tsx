// Yol izi (breadcrumb) — Explorer'da aktif klasor filtresi (pathPrefix) varken arac
// cubugunun altinda gosterilir; filtre yoksa hic render edilmez. GIDIS-DONUS SIMETRISI:
// Klasorler'den bir klasore tiklamak tek-tik → bu cubuktaki "📁 Klasorler" koku de tek-tik
// GERI doner (agac hafizali: birakildigi yerde, aktif dugum vurgulu). Ara segment → o
// ust-klasore filtrele (Explorer'da kal; Windows Gezgini yukari-cikis deseni). Son segment
// = mevcut kapsam (tiklanmaz). Yol parcalari daima LTR (Windows/POSIX; RTL dilde bozulmaz).

import { useTranslation } from "react-i18next";

import { ancestors } from "../../lib/paths";
import { useUiStore } from "../../store/useUiStore";

export function PathBreadcrumb() {
  const { t } = useTranslation();
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const setPathPrefix = useUiStore((s) => s.setPathPrefix);
  const setViewMode = useUiStore((s) => s.setViewMode);

  if (pathPrefix == null) return null;
  const segs = ancestors(pathPrefix);

  return (
    <nav
      aria-label={t("folders.path_nav")}
      className="flex items-center gap-1 overflow-hidden border-b border-border bg-bg-secondary/40 px-4 py-1.5 text-xs"
    >
      {/* Kok: Klasorler gorunumune tek-tik donus (agac birakildigi yerde acilir). */}
      <button
        type="button"
        onClick={() => setViewMode("folders")}
        title={t("folders.back_to_folders")}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-text-secondary transition hover:bg-bg-tertiary hover:text-accent"
      >
        <span aria-hidden>📁</span>
        {t("folders.title")}
      </button>
      {/* Yol segmentleri (LTR): ara segment tiklanabilir (ust-klasore cik), son = mevcut. */}
      <span dir="ltr" className="flex min-w-0 items-center gap-1">
        {segs.map((s, i) => (
          <span key={s.path} className="flex min-w-0 items-center gap-1">
            <span aria-hidden className="shrink-0 text-text-muted">
              ›
            </span>
            {i < segs.length - 1 ? (
              <button
                type="button"
                onClick={() => setPathPrefix(s.path)}
                title={s.path}
                className="max-w-[10rem] truncate rounded px-1 py-0.5 text-text-secondary transition hover:bg-bg-tertiary hover:text-accent"
              >
                {s.name}
              </button>
            ) : (
              <span
                title={s.path}
                aria-current="location"
                className="max-w-[14rem] truncate px-1 font-medium text-text-primary"
              >
                {s.name}
              </span>
            )}
          </span>
        ))}
      </span>
    </nav>
  );
}

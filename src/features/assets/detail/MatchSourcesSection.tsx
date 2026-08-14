// Arama alan-atfi bolumu ("Neden bu sonuc") — detay panelinin ust basliginda, YALNIZ
// yerel keyword aramada gorunur (bkz useMatchSources gate). Sorgunun asset'in hangi
// alaninda (dosya adi/baslik/aciklama/dosya-icerigi/AI) eslestigini, eslesen terim vurgulu
// snippet'le birlikte gosterir. H2 findMatchSources'in H3 sayfali mimariye uyarlanmis hali;
// atif gercekten eslesen FTS sutunundan gelir → gosterilen "neden" arama isabetiyle tutarli.

import { useTranslation } from "react-i18next";

import { HighlightedText } from "../../../components/HighlightedText";
import type { MatchSource } from "../../../ipc/client";

/** Grup → nokta rengi (file=icerik/accent, ai=vision/mor, meta=genel/mute). */
const GROUP_DOT: Record<string, string> = {
  file: "bg-accent",
  ai: "bg-accent-secondary",
  meta: "bg-text-muted",
};

export function MatchSourcesSection({ sources }: { sources: MatchSource[] }) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;
  return (
    <section data-testid="match-sources">
      <h3 className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        {t("detail.match_sources")}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {sources.map((s) => (
          <li key={s.field} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUP_DOT[s.group] ?? "bg-text-muted"}`}
                aria-hidden
              />
              {t(`detail.match_field.${s.field}`)}
            </span>
            <p className="line-clamp-2 ps-3 text-[11px] leading-4 text-text-secondary">
              <HighlightedText text={s.snippet} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

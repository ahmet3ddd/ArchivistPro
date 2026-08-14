// Katlanabilir facet bolumu — baslik (collapse chevron + aktif-secim rozeti) + opsiyonel
// "bolumu temizle" butonu + katlaninca govdeyi gizle. Collapse durumu cagiran tarafindan
// (localStorage) yonetilir; bu bilesen yalniz sunum. Heading'in yerini alir.

import type { ReactNode } from "react";
import { formatNumber } from "../../lib/format";

interface FacetSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Bu facet'te kac deger secili (>0 ise rozet + temizle gosterilir). */
  activeCount?: number;
  /** Bu bolumun secimlerini temizle (yalniz activeCount>0'da gorunur). */
  onClear?: () => void;
  clearLabel?: string;
  children: ReactNode;
}

export function FacetSection({
  title,
  collapsed,
  onToggle,
  activeCount = 0,
  onClear,
  clearLabel,
  children,
}: FacetSectionProps) {
  return (
    <div className="border-t border-border/40 first:border-t-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-1.5 px-2 pb-1 pt-3 text-start"
        >
          <span
            aria-hidden
            className={`text-[9px] text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            ▶
          </span>
          <span className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {title}
          </span>
          {activeCount > 0 && (
            <span className="ms-0.5 rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold leading-tight text-accent">
              {formatNumber(activeCount)}
            </span>
          )}
        </button>
        {onClear && activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label={clearLabel}
            title={clearLabel}
            className="me-1 shrink-0 rounded px-1 text-xs text-text-muted transition hover:text-danger"
          >
            ×
          </button>
        )}
      </div>
      {!collapsed && <div className="pb-1">{children}</div>}
    </div>
  );
}

/** Explanation for a visible facet that has not produced any options yet. */
export function FacetEmptyState({ label }: { label: string }) {
  return <p className="px-2 py-1 text-xs italic text-text-muted">{label}</p>;
}

/** One facet row: label, count and checkbox selection semantics. */
export function FacetRow({ label, count, active, onClick, dotClass }: RowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-sm transition-colors
        ${active ? "bg-accent/20 text-accent" : "text-text-secondary hover:bg-bg-tertiary"}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="ms-2 shrink-0 text-xs text-text-muted">{count}</span>
    </button>
  );
}

interface RowProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  /** Opsiyonel renkli oncu nokta (Tailwind arka-plan sinifi) — Gorsel turu satiri (foto/render/doku). */
  dotClass?: string;
}

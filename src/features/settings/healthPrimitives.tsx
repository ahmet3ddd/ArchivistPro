// Veri Sagligi / Doctor — dosya-sistemi ayaklarinin (staleness + fixity) ortak sunum parcalari.
//
// StalenessSection ve FixitySection AYNI gorsel dili paylasir: renkli sayim satiri (sifir → soluk),
// kucuk kind rozeti, kaydirilabilir problemli-ornek listesi (yol dir=ltr truncate + title=tam yol).
// Salt-sunum (state/IPC yok) → her iki bolum de tuketir; tekrar (DRY) burada tek yerde.

import type { ReactNode } from "react";

/** Sunum tonu → durum rengi. `warn` = amber (warning tokeni), `muted` = notr/gri. */
export type Tone = "ok" | "warn" | "danger" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-warning",
  danger: "text-danger",
  muted: "text-text-secondary",
};

const TONE_BADGE: Record<Tone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-border bg-bg-tertiary text-text-secondary",
};

/** Tek sayim ogesi (etiket + sayi). value=0 → tum oge soluk (opacity), sayi notr. */
export function CountItem({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const active = value > 0;
  return (
    <span className={active ? undefined : "opacity-40"}>
      <span className="text-text-muted">{label}</span>{" "}
      <span className={`font-semibold tabular-nums ${active ? TONE_TEXT[tone] : "text-text-muted"}`}>
        {value}
      </span>
    </span>
  );
}

/** Kind rozeti (kucuk pill; ornek satirlarinin basinda). */
export function KindBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TONE_BADGE[tone]}`}
    >
      {label}
    </span>
  );
}

/** Kaydirilabilir problemli-ornek listesi (max-h); satirlari cagiran doldurur. */
export function SampleList({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-h-40 flex-col gap-1 overflow-auto rounded border border-border bg-bg-tertiary/40 p-2">
      {children}
    </ul>
  );
}

/** Tek ornek satiri: kind rozeti + yol (dir=ltr, truncate, title=tam yol) + istege bagli eylem. */
export function SampleRow({
  badge,
  path,
  action,
}: {
  badge: ReactNode;
  path: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      {badge}
      <span
        dir="ltr"
        className="min-w-0 flex-1 truncate text-start font-mono text-[11px] text-text-secondary"
        title={path}
      >
        {path}
      </span>
      {action}
    </li>
  );
}

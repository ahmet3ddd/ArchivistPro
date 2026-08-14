// Pano (Dashboard) alt-bilesenleri — saf CSS/div grafikler (recharts YOK; yeni npm
// bagimliligi YOK). Mevcut koyu Tailwind stiliyle uyumlu (tema revizyonu Faz 8).
// Mantiksal CSS ozellikleri (ms-/me-/text-start) → RTL korunur.
//
// - StatCard: tek ozet kart (etiket + buyuk deger).
// - ExtDistribution: yatay cubuk listesi (uzanti dagilimi). Null-olmayan satira
//   tiklayinca onSelectExt(value) → cagiran explorer'a gecirir (baglam-once filtre).
// - MonthlyGrowth: dikey cubuk grafik (aylik buyume; seyrek seri, artan).

import type { ActivitySummary, ExtSize, Facet, MonthCount } from "../../ipc/client";
import { formatBytes, formatNumber } from "../../lib/format";

/** Ozet kart — etiket + buyuk deger (sayi veya bicimlenmis boyut). */
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass flex flex-1 flex-col gap-1 p-4">
      <span className="font-display text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

interface ExtDistributionProps {
  /** En cok ~12 uzanti (count azalan; `ext_counts`). */
  items: Facet[];
  /** "Uzantisiz" (value===null) satir etiketi (i18n). */
  noExtLabel: string;
  /** Null-olmayan bir uzantiya tiklandiginda (explorer'a gec + filtrele). */
  onSelectExt: (value: string) => void;
}

// Yatay cubuk listesi: her satir = uzanti etiketi + orantili cubuk (en cok say'a gore
// %) + sayi. Sanallastirma gerekmez — backend en cok 12 satir dondurur.
export function ExtDistribution({ items, noExtLabel, onSelectExt }: ExtDistributionProps) {
  const max = items.reduce((m, f) => Math.max(m, f.count), 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((f) => {
        const pct = Math.max(2, Math.round((f.count / max) * 100));
        const label = f.value === null ? noExtLabel : `.${f.value}`;
        const row = (
          <>
            <span className="w-20 shrink-0 truncate text-end text-xs text-text-muted" dir="ltr">
              {label}
            </span>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-bg-tertiary">
              <span
                className="absolute inset-y-0 start-0 rounded bg-accent"
                style={{ inlineSize: `${pct}%` }}
                aria-hidden
              />
            </span>
            <span className="w-12 shrink-0 text-end text-xs tabular-nums text-text-muted">
              {formatNumber(f.count)}
            </span>
          </>
        );
        // value===null → tiklanmaz (filtre yok); aksi halde explorer'a gecirir.
        if (f.value === null) {
          return (
            <div key="__none__" className="flex items-center gap-2 px-1 py-0.5">
              {row}
            </div>
          );
        }
        const value = f.value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelectExt(value)}
            title={`.${value}`}
            className="flex items-center gap-2 rounded px-1 py-0.5 text-start transition-colors hover:bg-bg-tertiary focus:bg-bg-tertiary focus:outline-none"
          >
            {row}
          </button>
        );
      })}
    </div>
  );
}

/** AI analizinden gelen ad+sayi dagilimi. Salt-gosterim; analizsiz arsivde kart cizilmez. */
export function AiFacetDistribution({ items }: { items: Facet[] }) {
  const max = items.reduce((m, f) => Math.max(m, f.count), 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {items.flatMap((item) => {
        if (item.value === null) return [];
        const pct = Math.max(2, Math.round((item.count / max) * 100));
        return [
          <div key={item.value} className="flex items-center gap-2 px-1 py-0.5">
            <span className="w-28 shrink-0 truncate text-end text-xs text-text-muted">
              {item.value}
            </span>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-bg-tertiary">
              <span
                className="absolute inset-y-0 start-0 rounded bg-accent"
                style={{ inlineSize: `${pct}%` }}
                aria-hidden
              />
            </span>
            <span className="w-12 shrink-0 text-end text-xs tabular-nums text-text-muted">
              {formatNumber(item.count)}
            </span>
          </div>,
        ];
      })}
    </div>
  );
}

// Dikey cubuk grafik: her cubuk bir ay ("YYYY-MM"); yuksekligi say'a orantili.
// Seyrek seri (bos aylar zaten yok) → cubuklari oldugu gibi cizeriz (bosluk doldurma
// yok; backend belgelendi). Yatay kaydirma cok ay olursa. Cubuk yuzdeleri SABIT
// yukseklikli (BAR_AREA) bir alana gore cozulur (indefinite parent'a karsi % calismaz).
const BAR_AREA = "8rem";

export function MonthlyGrowth({ items }: { items: MonthCount[] }) {
  const max = items.reduce((m, c) => Math.max(m, c.count), 0) || 1;
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1">
      {items.map((c) => {
        const pct = Math.max(4, Math.round((c.count / max) * 100));
        return (
          <div key={c.month} className="flex w-12 shrink-0 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-text-muted">{c.count}</span>
            {/* Sabit yukseklikli kova alani → ic cubugun % yuksekligi cozulur */}
            <div className="flex w-full items-end justify-center" style={{ blockSize: BAR_AREA }}>
              <div
                className="w-full rounded-t bg-accent"
                style={{ blockSize: `${pct}%`, minBlockSize: "0.25rem" }}
                title={`${c.month}: ${c.count}`}
                aria-hidden
              />
            </div>
            {/* Ay etiketi her zaman LTR (YYYY-MM), RTL dilde bozulmasin */}
            <span className="text-[10px] tabular-nums text-text-muted" dir="ltr">
              {c.month}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface ApprovalQueueProps {
  /** Onay durumu sayilari; backend review'yu once siralar. */
  items: Facet[];
  /** Kanonik durum tokenini yerel etikete cevirir. */
  labelFor: (value: string) => string;
  /** Bir duruma tiklaninca Explorer'a o filtreyle gecilir. */
  onSelectStatus: (value: string) => void;
}

interface SizeByFormatProps {
  /** En cok 8 uzanti (TOPLAM boyut azalan; `size_by_ext`). */
  items: ExtSize[];
  /** "Uzantisiz" (value===null) satir etiketi (i18n). */
  noExtLabel: string;
  /** Null-olmayan bir uzantiya tiklandiginda (explorer'a gec + filtrele). */
  onSelectExt: (value: string) => void;
}

// Format-bazli boyut (H2 sizeByFormat). ExtDistribution ile ayni yatay-cubuk deseni, AMA
// cubuk boyuta orantili + deger `formatBytes` (bayt). Cubuk rengi `bg-success` (say dagilimindan
// gorsel olarak ayrilir). Backend en cok 8 satir dondurur → sanallastirma gerekmez.
export function SizeByFormat({ items, noExtLabel, onSelectExt }: SizeByFormatProps) {
  const max = items.reduce((m, e) => Math.max(m, e.size), 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((e) => {
        const pct = Math.max(2, Math.round((e.size / max) * 100));
        const label = e.value === null ? noExtLabel : `.${e.value}`;
        const row = (
          <>
            <span className="w-20 shrink-0 truncate text-end text-xs text-text-muted" dir="ltr">
              {label}
            </span>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-bg-tertiary">
              <span
                className="absolute inset-y-0 start-0 rounded bg-success"
                style={{ inlineSize: `${pct}%` }}
                aria-hidden
              />
            </span>
            <span className="w-16 shrink-0 text-end text-xs tabular-nums text-text-muted">
              {formatBytes(e.size)}
            </span>
          </>
        );
        if (e.value === null) {
          return (
            <div key="__none__" className="flex items-center gap-2 px-1 py-0.5">
              {row}
            </div>
          );
        }
        const value = e.value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelectExt(value)}
            title={`.${value}`}
            className="flex items-center gap-2 rounded px-1 py-0.5 text-start transition-colors hover:bg-bg-tertiary focus:bg-bg-tertiary focus:outline-none"
          >
            {row}
          </button>
        );
      })}
    </div>
  );
}

interface ActivityPanelProps {
  /** Son 7 gun audit ozeti (backend toplar). */
  data: ActivitySummary;
  /** Onceden bicimlenmis "Son 7 günde N işlem" metni (count interpolasyonu cagiranda). */
  totalOpsText: string;
  usersTitle: string;
  actionsTitle: string;
}

// Son 7 gun aktivite paneli (H2 AdminActivityPanel pariti) — iki sutun: en aktif kullanicilar
// + en cok islem turleri. Islem anahtari ("user_create") H2 gibi alt-cizgisiz duz gosterilir
// (yerellestirilmez — kararli anahtar; H2 de replace(/_/g,' ') yapiyordu). Salt-gosterim (drill yok).
export function ActivityPanel({ data, totalOpsText, usersTitle, actionsTitle }: ActivityPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">{totalOpsText}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium text-text-secondary">{usersTitle}</h4>
          <ul className="flex flex-col gap-0.5">
            {data.top_users.map((u) => (
              <li key={u.name} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-text-primary">{u.name}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{u.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium text-text-secondary">{actionsTitle}</h4>
          <ul className="flex flex-col gap-0.5">
            {data.top_actions.map((a) => (
              <li key={a.name} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-text-primary" dir="ltr">{a.name.replace(/_/g, " ")}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{a.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Onay kuyrugu — her durum satiri Explorer'daki ayni facet'e bagli bir drill-down'dir. */
export function ApprovalQueue({ items, labelFor, onSelectStatus }: ApprovalQueueProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.flatMap((item) => {
        if (item.value === null) return [];
        const value = item.value;
        return [
          <button
            key={value}
            type="button"
            onClick={() => onSelectStatus(value)}
            className="glass flex min-w-32 flex-1 items-baseline justify-between gap-3 px-3 py-2 text-start transition-colors hover:bg-bg-tertiary focus:bg-bg-tertiary focus:outline-none"
          >
            <span className="text-xs text-text-secondary">{labelFor(value)}</span>
            <span className="text-lg font-semibold tabular-nums text-text-primary">{item.count}</span>
          </button>,
        ];
      })}
    </div>
  );
}

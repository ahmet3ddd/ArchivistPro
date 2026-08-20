// Global arka-plan islem ilerleme banner'i (tarama / yeniden-indeksleme) — TopBar altinda, bir
// rescan/reindex kosarken gorunur; isSizken (tasks bos) RENDER OLMAZ. AutoIndexBanner ikizi ama
// AI-indeks (accent) yerine IKINCIL-VURGU (accent-secondary) → iki bari gorsel olarak ayirt eder.
//
// Durum bgTaskStore'dan OKUNUR (yazan: useFolderWatcher / FoldersView / BatchToolbar). Tek islemde:
// etiket (Yeniden taraniyor / indeksleniyor) + processed/total + cubuk (+ o anki dosya, varsa). Coklu
// islemde: "N islem suruyor" + belirsiz pulse. `total === 0` → belirsiz (henuz tariyor).
//
// 🛑 "DURDUR" (2026-07-28 UI/UX denetimi Y3): buradaki eski not *"tarama/reindex iptali backend'de
// yok"* diyordu — **rescan icin YANLISTI**: `cancel_ingest` (commands/ingest.rs) BASTAN BERI vardi
// ve oto-yeniden-tarama da ayni `ingestFolder` yolunu kullaniyor. Yani MUMKUN olan iptal
// kullaniciya sunulmamisti; oto-tarama modal'siz basliyor ve tum sure `state.db` kilidini tutuyor
// → kullanici calisirken uygulama dakikalarca doniyor ve DURDURAMIYORDU.
// Dugme artik **yalniz iptal yolu GERCEKTEN olan** tur icin cizilir (sahte buton koymayiz):
//   · rescan  → `cancelIngest`        ✓
//   · analyze → `stopImageAnalysis`   ✓
//   · reindex → iptal komutu YOK      ✗ (dugme cizilmez — dogru olan bu)
// Coklu islemde de cizilmez: hangi isi durduracagi belirsiz olurdu.
//
// Tailwind token (accent-secondary) + logical CSS (RTL) + motion-reduce. i18n zorunlu (bgTask.*).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import type { BgTaskKind } from "./bgTaskStore";
import { useBgTaskStore } from "./bgTaskStore";

/** Bu is turunun GERCEK bir iptal yolu var mi → yoksa dugme cizilmez (sahte buton yasak). */
function cancelFor(kind: BgTaskKind): (() => Promise<void>) | null {
  if (kind === "rescan") return ipc.cancelIngest;
  if (kind === "analyze") return ipc.stopImageAnalysis;
  return null; // reindex + colors: backend'de iptal komutu yok
}

/** Yoldan dosya adi (son `/` veya `\` parcasi); Windows + POSIX (AutoIndexBanner pariti). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function BgTaskBanner() {
  const { t } = useTranslation();
  const tasks = useBgTaskStore((s) => s.tasks);
  const [stopping, setStopping] = useState(false);

  if (tasks.length === 0) return null; // isSiz → banner yok

  const multiple = tasks.length > 1;
  // Tek islemde o islemi goster; coklu islemde ilk islem cubuk temeli olur (metin ozet verir).
  const task = tasks[0];
  const determinate = !multiple && task.total > 0;
  const cancel = cancelFor(task.kind);
  const pct = determinate ? Math.min(100, Math.round((task.processed / task.total) * 100)) : 0;

  const label = multiple
    ? t("bgTask.multiple", { count: tasks.length })
    : task.total > 0
      ? t("bgTask.progress", {
          label: t(`bgTask.${task.kind}`),
          processed: task.processed,
          total: task.total,
        })
      : t(`bgTask.${task.kind}`);

  return (
    <div className="flex items-center gap-3 border-b border-accent-secondary/30 bg-accent-secondary/10 px-4 py-1.5 text-xs text-text-secondary">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-accent-secondary motion-safe:animate-pulse"
      />
      <span className="shrink-0 font-medium text-text-primary">{label}</span>

      {/* İlerleme cubugu — tek + belirli islemde determinate; aksi halde belirsiz pulse. */}
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-bg-tertiary">
        {determinate ? (
          <div
            className="h-full rounded-full bg-accent-secondary transition-all duration-200 motion-reduce:transition-none"
            style={{ inlineSize: `${pct}%` }}
            aria-hidden
          />
        ) : (
          <div
            className="h-full w-full rounded-full bg-accent-secondary/60 motion-safe:animate-pulse"
            aria-hidden
          />
        )}
      </div>
      {determinate && <span className="shrink-0 tabular-nums text-text-muted">{pct}%</span>}

      {/* O anki dosya (yalniz tek islemde ve doluysa; flex-1 → yer tutar, banner sabit yukseklik). */}
      <span
        dir="ltr"
        title={!multiple && task.currentPath ? task.currentPath : undefined}
        className="min-w-0 flex-1 truncate text-text-muted"
      >
        {!multiple && task.currentPath ? baseName(task.currentPath) : ""}
      </span>

      {/* Y3 — DURDUR: yalniz tek islem + iptal yolu GERCEKTEN olan turde. */}
      {!multiple && cancel && (
        <button
          type="button"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void cancel().catch(() => setStopping(false));
          }}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary
                     transition hover:border-border-hover hover:text-text-primary
                     disabled:cursor-not-allowed disabled:opacity-60"
        >
          {stopping ? t("bgTask.stopping") : t("bgTask.stop")}
        </button>
      )}
    </div>
  );
}

// Ham veri sekmesi - asset satirinin ham alanlarini okunabilir anahtar/deger tablosu
// olarak gosterir. Metadata ayri sekmede oldugu icin burada tekrar edilmez. Tum degerler
// dir="ltr" (yol/hash/mime/sayisal - ceviri degil); tarih/boyut formatlanmaz.

import { useTranslation } from "react-i18next";

import type { AssetDetail } from "../../../ipc/client";
import { useUiStore } from "../../../store/useUiStore";

/** Ham deger → string (null/undefined → "null", bool → true/false, digerleri String). */
function raw(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 border-b border-border py-1 last:border-0">
      <span className="w-32 shrink-0 break-all text-text-muted">{k}</span>
      <span dir="ltr" className="min-w-0 flex-1 break-all text-start text-text-secondary">
        {v}
      </span>
    </div>
  );
}

export function TechnicalTab({ detail }: { detail: AssetDetail }) {
  const { t } = useTranslation();
  const setViewMode = useUiStore((s) => s.setViewMode);
  const hasGps = detail.metadata.some((m) => m.key === "gps_lat" && m.value_num != null)
    && detail.metadata.some((m) => m.key === "gps_lon" && m.value_num != null);
  // asset satir alanlari — kontrat sirasini koru (client.ts AssetRow).
  const rowEntries = Object.entries(detail.asset);
  return (
    <div className="p-1 font-mono text-[11px] leading-relaxed">
      <h4 className="mb-1 mt-1 font-display text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        asset
      </h4>
      <div>
        {rowEntries.map(([k, v]) => (
          <Row key={k} k={k} v={raw(v)} />
        ))}
      {hasGps && (
        <button
          type="button"
          onClick={() => setViewMode("map")}
          className="mb-2 rounded border border-border px-2 py-1 font-sans text-[11px] text-text-secondary hover:border-accent hover:text-accent"
        >
          {t("view.map_open")}
        </button>
      )}
      </div>
    </div>
  );
}

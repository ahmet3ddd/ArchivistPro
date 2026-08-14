// Sekil arama — "Cizime Gore" sekmesi (kompozit / cizim-cizim). Referans = global secili asset.
// Referansin TUM sekil kumesine en cok ortusen diger aktif DXF/DWG asset'leri `searchShapesComposite`
// ile getirir (ortusme skoru sirali). Secim yoksa ipucu gosterir; DWG/DXF olmayan secimde notr uyari
// (yine de Tara'ya izin — backend bos donerse modal "empty" durumunu gosterir). Salt-okuma (her rol).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAssetDetail } from "../../hooks/useAssetDetail";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import type { ShapeSearchCtx } from "./ShapeSearchModal";

interface Props {
  ctx: ShapeSearchCtx;
}

export function CompositeShapeTab({ ctx }: Props) {
  const { t } = useTranslation();
  const selectedId = useUiStore((s) => s.selectedId);
  const { data } = useAssetDetail(selectedId);

  const [minScore, setMinScore] = useState(60);
  const [topK, setTopK] = useState("40");

  const field =
    "w-full rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none";

  if (selectedId == null) {
    return (
      <p className="py-2 text-sm text-text-muted">{t("shape.composite_no_selection")}</p>
    );
  }

  const fileName = data?.asset.file_name ?? `#${selectedId}`;
  const ext = data?.asset.ext?.toLowerCase() ?? "";
  const isDrawing = ext === "dwg" || ext === "dxf";

  const runSearch = () => {
    ctx.run(async () => {
      const k = parseInt(topK, 10);
      const hits = await ipc.searchShapesComposite(
        selectedId,
        Number.isNaN(k) ? 40 : k,
        minScore,
      );
      ctx.showResults(hits);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        {t("shape.composite_reference", { name: fileName })}
      </p>
      {!isDrawing && (
        <p className="text-xs text-text-muted">{t("shape.composite_not_drawing")}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          <span className="flex items-center justify-between">
            {t("shape.composite_min_score")}
            <span className="text-text-primary">%{minScore}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="accent-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t("shape.top_k")}
          <input
            type="number"
            value={topK}
            min={1}
            max={200}
            onChange={(e) => setTopK(e.target.value)}
            className={field}
          />
        </label>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={runSearch}
          disabled={ctx.busy}
          className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ctx.busy ? t("shape.analyzing") : t("shape.search")}
        </button>
      </div>
    </div>
  );
}

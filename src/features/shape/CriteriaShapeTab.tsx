// Sekil arama — "Ozellik Ara" sekmesi. Parametrik kriter formu → `searchShapesByFeatures`.
// Alanlar: kose sayisi ± tolerans · min duzgunluk/kompaktlik/dikdortgensellik · kategori
// dropdown · acik-sekil toggle · sonuc sayisi (topK). Bos birakilan sayisal alan → null
// (o filtre uygulanmaz); kategori "TUMU" → null. Skor sekil-KALITESIdir (referans-benzerligi
// degil) — sonuclar kendi ici siralamayla anlamli.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ShapeCriteria } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import type { ShapeSearchCtx } from "./ShapeSearchModal";
import { SHAPE_CATEGORIES } from "./shapeLabels";

interface Props {
  ctx: ShapeSearchCtx;
}

/** Bos/gecersiz → null; aksi halde ondalik sayi. */
function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
}

/** Bos/gecersiz → null; aksi halde tam sayi. */
function intOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
}

export function CriteriaShapeTab({ ctx }: Props) {
  const { t } = useTranslation();

  const [vertexCount, setVertexCount] = useState("8");
  const [vertexTolerance, setVertexTolerance] = useState("2");
  const [minRegularity, setMinRegularity] = useState("0.3");
  const [minCompactness, setMinCompactness] = useState("");
  const [minRectangularity, setMinRectangularity] = useState("");
  const [category, setCategory] = useState<string>("TUMU");
  const [includeOpen, setIncludeOpen] = useState(false);
  const [topK, setTopK] = useState("40");

  const runSearch = () => {
    const criteria: ShapeCriteria = {
      vertexCount: intOrNull(vertexCount),
      vertexTolerance: intOrNull(vertexTolerance) ?? 0,
      minRegularity: numOrNull(minRegularity),
      layerCategory: category === "TUMU" ? null : category,
      aspectMin: null,
      aspectMax: null,
      minCompactness: numOrNull(minCompactness),
      minRectangularity: numOrNull(minRectangularity),
      includeOpen,
      topK: intOrNull(topK) ?? 40,
    };
    ctx.run(async () => {
      const hits = await ipc.searchShapesByFeatures(criteria);
      ctx.showResults(hits);
    });
  };

  const field =
    "w-full rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <NumField
          label={t("shape.vertex_count")}
          value={vertexCount}
          onChange={setVertexCount}
          min={3}
          max={50}
          className={field}
        />
        <NumField
          label={t("shape.vertex_tolerance")}
          value={vertexTolerance}
          onChange={setVertexTolerance}
          min={0}
          max={10}
          className={field}
        />
        <NumField
          label={t("shape.min_regularity")}
          value={minRegularity}
          onChange={setMinRegularity}
          min={0}
          max={1}
          step={0.1}
          className={field}
        />
        <NumField
          label={t("shape.min_compactness")}
          value={minCompactness}
          onChange={setMinCompactness}
          min={0}
          max={1}
          step={0.1}
          placeholder="0–1"
          className={field}
        />
        <NumField
          label={t("shape.min_rectangularity")}
          value={minRectangularity}
          onChange={setMinRectangularity}
          min={0}
          max={1}
          step={0.1}
          placeholder="0–1"
          className={field}
        />
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {t("shape.category")}
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            {SHAPE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`shape.category_label.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <NumField
          label={t("shape.top_k")}
          value={topK}
          onChange={setTopK}
          min={1}
          max={200}
          className={field}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={includeOpen}
            onChange={(e) => setIncludeOpen(e.target.checked)}
            className="accent-accent"
          />
          {t("shape.include_open")}
        </label>
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

interface NumFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className: string;
}

function NumField({ label, value, onChange, min, max, step, placeholder, className }: NumFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-secondary">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
    </label>
  );
}

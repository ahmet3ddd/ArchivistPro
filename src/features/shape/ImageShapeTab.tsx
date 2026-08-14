// Sekil arama — "Gorsel Yukle" sekmesi. Surukle-birak / dosya-sec → gorsel baytlarini oku →
// `extractShapeFromImageBytes` → algilanan sekli onizle (poligon adi + C/S/R mini-bar) →
// "Ara" → `searchShapesBySimilarity(detected.shape, 40, includeOpen)`.
//
// Baytlar tarayici File API'siyle okunur (plugin-fs yok): `arrayBuffer()` →
// `Array.from(new Uint8Array(...))` → IPC number[]. Cok buyuk gorseller number[] olarak agir
// gider → makul bir ust sinir (≤12 MB) uygulanir; asilirsa yumusak uyari (arama yapilmaz).

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DetectedShape } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { formatBytes } from "../../lib/format";
import type { ShapeSearchCtx } from "./ShapeSearchModal";
import { shapeLabel } from "./shapeLabels";

interface Props {
  ctx: ShapeSearchCtx;
}

/** Referans sekle en benzeyen kac asset istenir (backend `top_k`). */
const TOP_K = 40;
/** number[] olarak IPC'den gecen gorsel icin makul ust sinir (agir seri. onlemek). */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function ImageShapeTab({ ctx }: Props) {
  const { t } = useTranslation();
  const [detected, setDetected] = useState<DetectedShape | null>(null);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      ctx.setError(
        t("shape.image_too_large", {
          size: formatBytes(file.size),
          max: formatBytes(MAX_IMAGE_BYTES),
        }),
      );
      return;
    }
    setDetected(null);
    ctx.clearResults();
    ctx.run(async () => {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const result = await ipc.extractShapeFromImageBytes(bytes);
      setDetected(result);
    });
  };

  const runSearch = () => {
    if (!detected) return;
    ctx.run(async () => {
      const hits = await ipc.searchShapesBySimilarity(detected.shape, TOP_K, includeOpen);
      ctx.showResults(hits);
    });
  };

  const ds = detected?.shape;

  return (
    <div className="flex flex-col gap-3">
      {/* Surukle-birak / tikla-sec bolgesi */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
        }`}
      >
        {ctx.busy ? (
          <p className="text-sm text-text-secondary">{t("shape.analyzing")}</p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">{t("shape.drop_hint")}</p>
            <p className="mt-1 text-xs text-text-muted">{t("shape.drop_sub_hint")}</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/bmp,image/tiff"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ""; // ayni dosya tekrar secilebilsin
        }}
      />

      {/* Algilanan sekil onizlemesi */}
      {ds && (
        <div className="rounded-md border border-border bg-bg-secondary p-3">
          <p className="mb-2 text-sm text-text-primary">
            {t("shape.detected")}{" "}
            <b className="text-accent">{shapeLabel(t, ds.vertexCount, ds.regularity)}</b>{" "}
            <span className="text-text-muted">
              ({t("shape.detected_vertices", { count: detected!.simplifiedPointCount })})
            </span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            <MiniBar value={ds.compactness} label={t("shape.metric.compact")} tone="accent" />
            <MiniBar value={ds.solidity} label={t("shape.metric.solid")} tone="success" />
            <MiniBar value={ds.rectangularity} label={t("shape.metric.rect")} tone="warning" />
          </div>
        </div>
      )}

      {/* Acik-sekil toggle + Ara */}
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
          disabled={!detected || ctx.busy}
          className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ctx.busy ? t("shape.analyzing") : t("shape.search")}
        </button>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
};

/** Kompaktlik/dolulk/dikdortgensellik icin 0-1 mini-bar (yuzde etiketli). */
function MiniBar({ value, label, tone }: { value: number; label: string; tone: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-primary">
        <div className={`h-full rounded-full ${TONE[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

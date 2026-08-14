// Tek gorsel-arama sonuc hucresi — thumbnail (yoksa uzanti ikonu) + dosya adi + uzanti rozeti
// + SKOR ROZETI (yuzde; or. "%73"). VisualHit yalniz asset + gercek cosine skor tasir. Skor
// GORUNUR (seffaflik; kor-kalibrasyon yok). Tikla → detayda ac (ShapeResultTile deseni).

import { useTranslation } from "react-i18next";

import type { VisualHit } from "../../ipc/client";
import { extIcon, formatBytes } from "../../lib/format";
import { displayPct } from "./visualScore";

interface Props {
  hit: VisualHit;
  thumbnail?: string; // data-URI; yoksa uzanti ikonu
  onOpen: (id: number) => void;
  /** Detay panelinde secili mi (mavi cerceve; master-detay). */
  selected: boolean;
}

export function VisualResultTile({ hit, thumbnail, onOpen, selected }: Props) {
  const { t } = useTranslation();
  const { asset, score } = hit;
  const label = asset.title?.trim() || asset.file_name;
  // Ham cosine → ALGISAL yuzde (CLIP cosine'i sikisiktir; ham %30 aslinda guclu eslesme → algisal
  // olceklendir ki sezgisel okunsun). Siralama ham skorda; bu yalniz gosterim. Bkz visualScore.ts.
  const pct = displayPct(score);

  return (
    <button
      type="button"
      onClick={() => onOpen(asset.id)}
      title={asset.path}
      className={`group flex flex-col gap-2 rounded-lg border p-2 text-start transition hover:border-border-hover hover:bg-bg-tertiary hover:shadow-glow ${
        selected ? "border-accent bg-accent/10" : "border-border bg-bg-tertiary/60"
      }`}
    >
      <div className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded bg-bg-primary/60">
        {thumbnail ? (
          <img src={thumbnail} alt={label} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl leading-none">{extIcon(asset.ext)}</span>
        )}
        {asset.ext && (
          <span className="absolute end-1 top-1 rounded bg-bg-primary/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-secondary">
            {asset.ext}
          </span>
        )}
        {/* Skor rozeti — gercek cosine benzerlik, yuzde (seffaflik). */}
        <span className="absolute start-1 top-1 rounded bg-accent/85 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {t("visual_search.score_pct", { score: pct })}
        </span>
      </div>
      <p className="line-clamp-2 break-all px-1 text-sm font-medium text-text-primary">{label}</p>
      <p className="px-1 text-[11px] text-text-muted">{formatBytes(asset.size_bytes)}</p>
    </button>
  );
}

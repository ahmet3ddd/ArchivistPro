// Tek sekil-arama sonuc hucresi — thumbnail (yoksa uzanti ikonu) + dosya adi + uzanti rozeti
// + skor rozeti (toFixed(3)). ShapeHit yalniz asset + skor tasir (per-sekil geometri backend'de
// kalir) → tile asset-duzeyi bilgi + skoru gosterir. Tikla → detayda ac (AssetCard deseni).

import type { ShapeHit } from "../../ipc/client";
import { extIcon, formatBytes } from "../../lib/format";

interface Props {
  hit: ShapeHit;
  thumbnail?: string; // data-URI; yoksa uzanti ikonu
  onOpen: (id: number) => void;
}

export function ShapeResultTile({ hit, thumbnail, onOpen }: Props) {
  const { asset, score } = hit;
  const label = asset.title?.trim() || asset.file_name;

  return (
    <button
      type="button"
      onClick={() => onOpen(asset.id)}
      title={asset.path}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-bg-tertiary/60 p-2 text-start transition hover:border-border-hover hover:bg-bg-tertiary hover:shadow-glow"
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
        {/* Skor rozeti (referans-benzerlik veya kalite; toFixed(3)) */}
        <span className="absolute start-1 top-1 rounded bg-accent/85 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {score.toFixed(3)}
        </span>
      </div>
      <p className="line-clamp-2 break-all px-1 text-sm font-medium text-text-primary">{label}</p>
      <p className="px-1 text-[11px] text-text-muted">{formatBytes(asset.size_bytes)}</p>
    </button>
  );
}

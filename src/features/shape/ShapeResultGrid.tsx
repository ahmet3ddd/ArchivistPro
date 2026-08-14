// Sekil-arama sonuc grid'i — ShapeHit[] → thumbnail tile + skor rozeti. Sonuclar top-k ile
// sinirli (≤200; tipik 40) → sanallastirma gerekmez (dedup paneli paritesi). Thumbnail'lar
// tek batch cekilir (`useThumbnails`; kucuk sabit kume). Tikla → detay sag sutunda (master-detay).

import { useMemo } from "react";

import type { ShapeHit } from "../../ipc/client";
import { useThumbnails } from "../../hooks/useThumbnails";
import { ShapeResultTile } from "./ShapeResultTile";

interface Props {
  results: ShapeHit[];
  onOpen: (id: number) => void;
}

export function ShapeResultGrid({ results, onOpen }: Props) {
  const ids = useMemo(() => results.map((h) => h.asset.id), [results]);
  const thumbs = useThumbnails(ids);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {results.map((hit) => (
        <ShapeResultTile
          key={hit.asset.id}
          hit={hit}
          thumbnail={thumbs[hit.asset.id]}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

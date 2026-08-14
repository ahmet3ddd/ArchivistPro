// Gorsel-arama sonuc grid'i — VisualHit[] → thumbnail tile + yuzde skor rozeti. Sonuclar tek
// sayfa (top-k; pageSize 60) → sanallastirma gerekmez (ShapeResultGrid paritesi). Thumbnail'lar
// tek batch cekilir (`useThumbnails`; kucuk sabit kume). Tikla → detay sag sutunda (master-detay).
//
// Thumbnail seti `allIds` (TAM sonuc kumesi; hassasiyet esiginden BAGIMSIZ) → slider oynayinca
// yalniz render edilen alt-kume degisir, thumbnail YENIDEN CEKILMEZ (esik reaktif ama thumb kararli).

import type { VisualHit } from "../../ipc/client";
import { useThumbnails } from "../../hooks/useThumbnails";
import { VisualResultTile } from "./VisualResultTile";

interface Props {
  /** Esik-ustu (gorunur) sonuclar — yalniz bunlar render edilir. */
  results: VisualHit[];
  /** TAM sonuc kumesinin id'leri (esikten bagimsiz; thumbnail prefetch icin kararli). */
  allIds: number[];
  onOpen: (id: number) => void;
  /** Su an detayda gosterilen asset (master-detay vurgusu). */
  selectedId: number | null;
}

export function VisualResultGrid({ results, allIds, onOpen, selectedId }: Props) {
  const thumbs = useThumbnails(allIds);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {results.map((hit) => (
        <VisualResultTile
          key={hit.asset.id}
          hit={hit}
          thumbnail={thumbs[hit.asset.id]}
          onOpen={onOpen}
          selected={hit.asset.id === selectedId}
        />
      ))}
    </div>
  );
}

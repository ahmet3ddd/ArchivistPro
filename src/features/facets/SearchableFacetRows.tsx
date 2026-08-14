// Uzun facet listeleri icin yardimci — esik asilirsa satir-ici arama kutusu + "daha fazla
// goster"/"daha az" kelepcesi. Tamamen YEREL durum (arama metni + tumunu-goster); store'a
// dokunmaz, filtre uygulamaz (yalniz hangi facet satirlarinin gorundugunu yonetir).

import { Fragment, useState } from "react";
import type { ReactNode } from "react";

interface SearchableFacetRowsProps<T> {
  items: T[];
  keyOf: (item: T) => string | number;
  /** Arama kutusunun eslestigi metin (or. uzanti adi / etiket / koleksiyon adi). */
  matchText: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  searchPlaceholder: string;
  /** Arama kutusu bu sayidan fazla ogede gosterilir (varsayilan 8). */
  searchThreshold?: number;
  /** Baslangicta gosterilen max satir; ustu "daha fazla" ile acilir (varsayilan 12). */
  maxVisible?: number;
  moreLabel: (n: number) => string;
  lessLabel: string;
}

export function SearchableFacetRows<T>({
  items,
  keyOf,
  matchText,
  renderRow,
  searchPlaceholder,
  searchThreshold = 8,
  maxVisible = 12,
  moreLabel,
  lessLabel,
}: SearchableFacetRowsProps<T>) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);

  const showSearch = items.length > searchThreshold;
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? items.filter((it) => matchText(it).toLowerCase().includes(needle))
    : items;
  const visible = showAll ? filtered : filtered.slice(0, maxVisible);
  const hidden = filtered.length - visible.length;

  return (
    <>
      {showSearch && (
        <div className="px-2 pb-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
      )}
      {visible.map((it) => (
        <Fragment key={keyOf(it)}>{renderRow(it)}</Fragment>
      ))}
      {hidden > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="px-2 py-1 text-start text-xs text-accent/80 transition hover:text-accent"
        >
          {moreLabel(hidden)}
        </button>
      )}
      {showAll && filtered.length > maxVisible && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="px-2 py-1 text-start text-xs text-text-muted transition hover:text-text-secondary"
        >
          {lessLabel}
        </button>
      )}
      {showSearch && filtered.length === 0 && <p className="px-2 py-1 text-xs text-text-muted">—</p>}
    </>
  );
}

// Teknik gorunum (Faz 7.4 — H2 TechnicalView pariti). Explorer grid'inin TABLO karsiligi:
// ayni filtreli asset verisini (useInfiniteAssets) genisletilmis sutunlu detayli liste olarak
// gosterir. AYNI veri kaynagi → tum aktif filtreler (arama/ext/tag/koleksiyon/tarih/favori/
// pathPrefix + sort) otomatik uygulanir; backend degisikligi YOK.
//
// Sanallastirma + sonsuz-kaydirma (100K+): react-virtuoso TableVirtuoso — sabit (sticky)
// baslik + pencereli satirlar + endReached→loadMore. Bellek sinirli (pencere; tum satirlar
// render EDILMEZ). Yukleme/hata(retry)/bos durumlari AssetGrid ile tutarli.
//
// Güncellik rozeti bu turda yalnız Grid kartlarındadır. Teknik tablo için ayrı sütun gerekirse
// aynı son-Doctor sonucunu kullanır; satır başına dosya sistemi sorgusu yapılmaz.

import { useTranslation } from "react-i18next";
import { TableVirtuoso, type TableComponents } from "react-virtuoso";

import type { AssetRow, AssetSort } from "../../ipc/client";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useInfiniteAssets } from "../../hooks/useAssets";
import { useUiStore } from "../../store/useUiStore";
import { TechnicalCells, TechnicalRow } from "./TechnicalRow";

// TableVirtuoso bilesenleri MODUL seviyesinde (sabit referans) — secim/yeniden-render'da
// scroller yeniden monte edilmez. Table: table-fixed → sutun genislikleri (th) govdeye
// yansir, truncate calisir. TableHead: sticky baslik (koyu zemin, kaydirinca ustte kalir).
const tableComponents: TableComponents<AssetRow> = {
  Table: ({ style, ...props }) => (
    <table
      {...props}
      style={{ ...style, width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}
      className="text-sm"
    />
  ),
  TableHead: ({ style, ...props }) => (
    <thead
      {...props}
      style={{ ...style }}
      className="sticky top-0 z-10 bg-bg-secondary text-xs uppercase tracking-wide text-text-muted shadow-[0_1px_0_0_theme(colors.slate.800)]"
    />
  ),
  TableRow: TechnicalRow,
};

// Sutun genislikleri (table-fixed): ad ve yol esner (auto), digerleri sabit. Baslik
// hucrelerine uygulanir; table-fixed sayesinde govde hucreleri ayni genisligi alir.
const COL = {
  name: undefined, // esner (kalan alan)
  type: "5.5rem",
  size: "6.5rem",
  modified: "12rem",
  created: "12rem",
  path: "32%",
} as const;

// Siralanabilir sutunlar → asc/desc AssetSort anahtarlari + yeni-secimde varsayilan yon.
// Siralama BACKEND'de (query/mod.rs AssetSort whitelist) → sanallastirmada TUM veri dogru
// siralanir (yalniz yuklu pencere degil; H2'nin client-side sort'unun aksine — H2 tum veriyi
// renderer'a yukluyordu). Yon varsayilani: metin sutunlari asc, sayi/tarih desc (kullanici sezgisi).
type SortCol = "name" | "type" | "size" | "modified" | "created" | "path";
const SORT_MAP: Record<SortCol, { asc: AssetSort; desc: AssetSort; def: "asc" | "desc" }> = {
  name: { asc: "name_asc", desc: "name_desc", def: "asc" },
  type: { asc: "type_asc", desc: "type_desc", def: "asc" },
  size: { asc: "size_asc", desc: "size_desc", def: "desc" },
  modified: { asc: "modified_asc", desc: "modified_desc", def: "desc" },
  created: { asc: "created_asc", desc: "created_desc", def: "desc" },
  path: { asc: "path_asc", desc: "path_desc", def: "asc" },
};

/** Guncel sort → aktif sutun + yon (hicbiri eslesmezse col=null). */
function activeSort(sort: AssetSort): { col: SortCol | null; dir: "asc" | "desc" } {
  for (const key of Object.keys(SORT_MAP) as SortCol[]) {
    const m = SORT_MAP[key];
    if (sort === m.asc) return { col: key, dir: "asc" };
    if (sort === m.desc) return { col: key, dir: "desc" };
  }
  return { col: null, dir: "desc" };
}

export function TechnicalView() {
  const { t } = useTranslation();
  const { items, total, loading, loadingMore, error, loadMore, retry } = useInfiniteAssets();
  const sort = useUiStore((s) => s.sort);
  const setSort = useUiStore((s) => s.setSort);

  const th = "px-3 py-2 text-start font-semibold";
  const active = activeSort(sort);
  const onSort = (col: SortCol) => {
    const m = SORT_MAP[col];
    // Ayni sutuna tiklama → yon degistir; yeni sutun → o sutunun varsayilan yonu.
    setSort(
      active.col === col
        ? active.dir === "asc"
          ? m.desc
          : m.asc
        : m.def === "asc"
          ? m.asc
          : m.desc,
    );
  };
  /** Siralanabilir baslik hucresi: tiklaninca onSort; aktifse ▲/▼, degilse ↕ (siralanabilir ipucu). */
  const sortTh = (col: SortCol, label: string, width: string | undefined, end = false) => {
    const isActive = active.col === col;
    return (
      <th
        className={`${th} ${end ? "text-end" : ""}`}
        style={{ width }}
        aria-sort={isActive ? (active.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => onSort(col)}
          title={t("technical.sort_hint")}
          className={`inline-flex max-w-full items-center gap-1 transition hover:text-text-primary ${
            end ? "flex-row-reverse" : ""
          } ${isActive ? "text-text-primary" : ""}`}
        >
          <span className="truncate">{label}</span>
          <span aria-hidden className="shrink-0 text-[9px] leading-none opacity-70">
            {isActive ? (active.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Arac cubugu — AssetGrid/FoldersView ile gorsel tutarli (baslik + yuklenen/toplam) */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="font-display text-sm font-semibold text-text-primary">{t("technical.title")}</h2>
        {!loading && !error && items.length > 0 && (
          <span className="ms-auto text-xs text-text-muted">
            {items.length < total
              ? `${items.length} / ${t("list.total", { count: total })}`
              : t("list.total", { count: total })}
          </span>
        )}
      </div>

      {/* Govde (sanallastirilmis tablo) */}
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="p-4">
            <Spinner label={t("list.loading")} />
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center gap-3 p-4 text-sm text-danger">
            <span>{t("list.error", { message: error })}</span>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="p-4">
            <EmptyState title={t("technical.empty")} hint={t("list.empty_hint")} />
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <TableVirtuoso<AssetRow>
            style={{ height: "100%" }}
            data={items}
            endReached={loadMore}
            overscan={600}
            components={tableComponents}
            fixedHeaderContent={() => (
              <tr className="border-b border-border bg-bg-secondary">
                {sortTh("name", t("technical.name"), COL.name)}
                {sortTh("type", t("technical.type"), COL.type)}
                {sortTh("size", t("technical.size"), COL.size, true)}
                {sortTh("modified", t("technical.modified"), COL.modified)}
                {sortTh("created", t("technical.created"), COL.created)}
                {sortTh("path", t("technical.path"), COL.path)}
              </tr>
            )}
            itemContent={(_index, asset) => <TechnicalCells asset={asset} />}
          />
        )}
        {loadingMore && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-full bg-bg-secondary/90 px-3 py-1 text-xs text-text-muted shadow">
              {t("list.loading")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

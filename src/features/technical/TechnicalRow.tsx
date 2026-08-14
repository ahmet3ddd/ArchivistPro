// Teknik gorunum tablo satiri + hucreleri (Faz 7.4). TableVirtuoso'nun `components.TableRow`
// ve `itemContent` parcalarini saglar. Satir ayri dosyada tutulur (TechnicalView <500 satir).
//
// - TechnicalRow: pencereli `<tr>`. Secim (selectedId) + tiklama (select) store'dan okunur,
//   boylece TableVirtuoso'ya gecen `components` referansi SABIT kalir (secim degisince
//   scroller yeniden monte edilmez). data-index vb. tum prop'lar `<tr>`'a aktarilir.
// - TechnicalCells: bir satirin <td>'leri (itemContent'ten cagrilir). Sutunlar AssetRow
//   alanlariyla birebir; yol/tarihler dir="ltr" (RTL'de bozulmaz), yol truncate + title.

import type { ItemProps } from "react-virtuoso";

import type { AssetRow } from "../../ipc/client";
import { extIcon, formatBytes, formatDate } from "../../lib/format";
import { useUiStore } from "../../store/useUiStore";

/** Pencereli tablo satiri — tiklayinca asset secilir (DetailPanel acilir, grid ile ayni).
 *  Secili satir vurgulanir. TableVirtuoso `components.TableRow`'a verilir (ItemProps<AssetRow>:
 *  item + data-index/data-known-size vb. + children/style). Bilinmeyenler `...rest` ile <tr>'a. */
export function TechnicalRow({ item, children, ...rest }: ItemProps<AssetRow>) {
  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const selected = item.id === selectedId;
  return (
    <tr
      {...rest}
      onClick={() => select(item.id)}
      aria-selected={selected}
      className={`cursor-pointer border-b border-border transition-colors ${
        selected ? "bg-accent/10 text-accent" : "hover:bg-bg-tertiary"
      }`}
    >
      {children}
    </tr>
  );
}

/** Bir asset satirinin hucreleri (TableVirtuoso `itemContent`). Sutunlar TechnicalView'daki
 *  baslik sirasiyla birebir. dosya adi: ikon + ad; tur: .ext; boyut; degisiklik; olusturma;
 *  yol (truncate, ltr, title). Güncellik rozeti bu turda yalnız Grid kartlarındadır; tabloya
 *  ek sütun gerekirse aynı son-Doctor sonucu yeniden kullanılır (satır başına FS sorgusu yok). */
export function TechnicalCells({ asset }: { asset: AssetRow }) {
  const name = asset.title?.trim() || asset.file_name;
  return (
    <>
      {/* Dosya adi (ikon + ad) — esnek; tasarsa kesilir */}
      <td className="max-w-0 px-3 py-1.5 text-text-primary">
        <span className="flex items-center gap-2">
          <span className="shrink-0 text-base leading-none" aria-hidden>
            {extIcon(asset.ext)}
          </span>
          <span className="truncate" title={name}>
            {name}
          </span>
        </span>
      </td>
      {/* Tur (.ext) — LTR, uzanti her zaman latin */}
      <td className="whitespace-nowrap px-3 py-1.5 text-text-muted" dir="ltr">
        {asset.ext ? `.${asset.ext}` : "—"}
      </td>
      {/* Boyut — sagda hizali, tabular */}
      <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums text-text-secondary" dir="ltr">
        {formatBytes(asset.size_bytes)}
      </td>
      {/* Degisiklik tarihi — LTR (yerel tarih-saat) */}
      <td className="whitespace-nowrap px-3 py-1.5 text-text-muted" dir="ltr">
        {formatDate(asset.modified_at)}
      </td>
      {/* Olusturma tarihi — LTR */}
      <td className="whitespace-nowrap px-3 py-1.5 text-text-muted" dir="ltr">
        {formatDate(asset.created_at)}
      </td>
      {/* Yol — truncate + title; her zaman LTR (Windows/POSIX yol RTL'de bozulmasin) */}
      <td className="max-w-0 px-3 py-1.5 text-text-muted">
        <span className="block truncate" dir="ltr" title={asset.path}>
          {asset.path}
        </span>
      </td>
    </>
  );
}

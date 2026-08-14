// Tek asset hucresi (grid icinde). Thumbnail varsa gosterir, yoksa uzanti ikonu.
// Favori yildizi kartin kardesi (ic ice buton degil) olarak ust-baslangic koseye yerlesir.
//
// Faz 7.5 (gezgin etkilesimleri):
//  - Coklu-secim onay kutusu (ust-baslangic kose): hover'da YA DA secim aktifken gorunur.
//  - Coklu-secili gorsel durum (ring/overlay) — `multiSelected` prop'u (grid hesaplar;
//    kart `selectedIds`'e abone OLMAZ → buyuk grid'de re-render firtinasi yok).
//  - Sag-tik → `onContextMenu(id, x, y)` (grid imlec konumunda menu acar).
//  - Tiklamada modifier'lar (ctrl/cmd/shift) grid'e iletilir → duz/coklu/aralik anlami.
//
// ⚠️ BIRIM YUKSEKLIK SARTI (bozulursa grid dipte TITRER — bkz asagi):
// Kart VirtuosoGrid icinde yasar; VirtuosoGrid **esit boyutlu** oge varsayar (README:
// "displays same sized items"; dist tek bir `itemHeight` olcup TUM ogelere uygular).
// Yukseklik karttan karta degisirse Virtuoso toplam yuksekligi tek olcumden ekstrapole
// eder → hata liste boyunca birikir → EN DIPTE tahmin ile gercek son arasindaki fark
// kapatilirken scrollTop duzeltilir → aralik degisir → yeniden olcum → tekrar duzeltme
// = gorunur TITREME (yalniz dipte). H2 bu sarti `.asset-card-title { white-space:nowrap;
// text-overflow:ellipsis }` ile saglardi (her zaman 1 satir).
// H3'te sart REZERVE SATIRLARLA saglanir (tasarim korunur):
//   - kucuk resim: `aspect-[4/3]` → genislik sutundan gelir, satirdaki tum kartlar esit
//   - baslik: HER ZAMAN 2 satirlik yer (`h-10` + `leading-5`), ad kisa olsa da
//   - boyut: 1 satir (`h-4` + `leading-4`)
//   - gorsel-turu cipi: satir HER ZAMAN rezerve (`h-5`), cip yoksa bos kalir
//   - snippet: `reserveSnippet` ile LISTE BAZINDA acilir/kapanir (arama modunda tum
//     kartlarda rezerve, gozatta hicbirinde) → her iki durumda da liste-ici birim
// Yeni bir satir/rozet eklenecekse: ya sabit yukseklik ver ya da mutlak konumlandir.

import type { DragEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { HighlightedText } from "../../components/HighlightedText";
import type { AssetRow, StaleKind } from "../../ipc/client";
import { extIcon, formatBytes } from "../../lib/format";
import { GORSEL_TURU_META } from "../facets/gorselTuruMeta";
import { semanticScorePct } from "../search/semanticScore";
import { DominantColorPalette } from "./DominantColorPalette";
import { FavoriteButton } from "./FavoriteButton";

interface Props {
  asset: AssetRow;
  /** Detay paneli secimi (tekil; mavi cerceve). */
  selected: boolean;
  /** Coklu-secim kumesinde mi? (toplu islem; ring + overlay). */
  multiSelected: boolean;
  /** Klavye imleci (Faz B ok-navigasyonu) — detay/coklu-secimden AYRI, offset'li odak halkasi. */
  active?: boolean;
  thumbnail?: string; // data-URI; yoksa ikon
  /** Son Doctor denetiminden gelen problem türü; kart kendi başına dosya sistemi sorgulamaz. */
  staleness?: StaleKind;
  /** Snippet satirini rezerve et (arama modu). Grid TUM kartlara ayni degeri verir →
   *  liste-ici birim yukseklik korunur (bkz dosya basi "BIRIM YUKSEKLIK SARTI"). */
  reserveSnippet?: boolean;
  /** Tiklama — modifier'lar (ctrl/cmd/shift) grid'de anlamlandirilir. */
  onActivate: (id: number, e: MouseEvent) => void;
  /** Onay kutusu — bu id'yi coklu-secimde degistir. */
  onToggleSelect: (id: number) => void;
  /** Sag-tik — imlec konumunda baglam menusu. */
  onContextMenu: (id: number, x: number, y: number) => void;
  /** Yazabilen yerel kullanıcıda kart, koleksiyon satırına sürüklenebilir. */
  onDragStart?: (id: number, event: DragEvent<HTMLButtonElement>) => void;
}

export function AssetCard({
  asset,
  selected,
  multiSelected,
  active,
  thumbnail,
  staleness,
  reserveSnippet,
  onActivate,
  onToggleSelect,
  onContextMenu,
  onDragStart,
}: Props) {
  const { t } = useTranslation();
  const label = asset.title?.trim() || asset.file_name;

  // AI gorsel turu (foto/render/doku) -> renkli nokta. TEK KAYNAK gorselTuruMeta
  // (labelKey + dot). Taninmayan/bos token -> undefined -> nokta gosterilmez
  // (facet ile ayni 3-kova davranisi). ai_gorsel_turu, ai_analyzed ile birlikte
  // gelir ama bagimsiz kontrol edilir (biri digeri olmadan gelse de dogru gorunur).
  const gorselTuruMeta = asset.ai_gorsel_turu ? GORSEL_TURU_META[asset.ai_gorsel_turu] : undefined;

  // Kenarlik: coklu-secim > detay-secimi > varsayilan.
  const border = multiSelected
    ? "border-accent ring-2 ring-accent/60 bg-accent/10"
    : selected
      ? "border-accent bg-accent/10"
      : "border-border bg-bg-tertiary/60 hover:border-border-hover hover:bg-bg-tertiary hover:shadow-glow";
  // Klavye imleci: `outline` (ring DEGIL) → coklu-secim ring'i / detay border'i ile CAKISMAZ,
  // offset'li halka net "odak" okur. Detay/secim durumundan bagimsiz her zaman gorunur.
  const cursorRing = active ? "outline outline-2 outline-offset-2 outline-accent" : "";

  return (
    <div data-asset-card className="group/card relative">
      <button
        type="button"
        data-testid="asset-card"
        onClick={(e) => onActivate(asset.id, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(asset.id, e.clientX, e.clientY);
        }}
        draggable={onDragStart != null}
        onDragStart={onDragStart ? (event) => onDragStart(asset.id, event) : undefined}
        title={asset.path}
        className={`flex w-full flex-col gap-2 rounded-lg border p-2 text-start transition ${border} ${cursorRing}`}
      >
        {/* Thumbnail kutusu (yoksa ikon) + uzanti rozeti.
            aspect-[4/3] (sabit h-24 DEGIL) → yukseklik kart genisligini takip eder; kart-boyutu
            kaydiraci/1fr-esneme ile genisleyince oran KORUNUR (eski sabit-yukseklik "basik"
            gorunumu duzeldi). */}
        <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-bg-primary/60">
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
          {(staleness === "stale" || staleness === "missing") && (
            <span
              title={t(staleness === "missing" ? "health.kind_missing" : "health.kind_stale")}
              aria-label={t(staleness === "missing" ? "health.kind_missing" : "health.kind_stale")}
              className={
                staleness === "missing"
                  ? "pointer-events-none absolute end-1 bottom-1 grid size-5 place-items-center rounded-full bg-danger text-xs font-bold text-white"
                  : "pointer-events-none absolute end-1 bottom-1 grid size-5 place-items-center rounded-full bg-warning text-xs font-bold text-white"
              }
            >
              {staleness === "missing" ? "×" : "!"}
            </span>
          )}
          {/* Anlamli (semantik) arama % benzerlik rozeti — YALNIZ semantik isabetlerde (`score`
              tasiyan; normal liste/FTS'te undefined → gizli). Thumbnail'in alt-baslangic kosesi:
              ust-kose'ler (kutu/ext) ve favori/✨ ile carpismaz. VisualResultTile skor deseni. */}
          {asset.score != null && (
            <span className="pointer-events-none absolute start-1 bottom-1 rounded bg-accent/85 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
              {t("search_mode.score_pct", { score: semanticScorePct(asset.score) })}
            </span>
          )}
        </div>
        {/* Baslik: HER ZAMAN 2 satirlik yer (h-10 = 2 × leading-5) — kisa adda da kart
            kisalmaz (birim yukseklik sarti). */}
        <p className="line-clamp-2 h-10 break-all px-1 text-sm font-medium leading-5 text-text-primary">
          {label}
        </p>
        <p className="h-4 px-1 text-[11px] leading-4 text-text-muted">
          {formatBytes(asset.size_bytes)}
        </p>
        {/* Gorsel turu renkli metin-hapi (foto=emerald/render=violet/doku=amber) — referans UI
            "Turetilmis/Surum" cipleri gibi; detay rozeti + facet ile ayni renk (tek kaynak
            gorselTuruMeta.chip). Taninmayan/bos token -> cip gosterilmez ama SATIR rezerve
            kalir (h-5) → cipli/cipsiz kartlar ayni yukseklikte. */}
        <div className="flex h-5 items-center justify-between gap-2 px-1">
          {gorselTuruMeta && (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${gorselTuruMeta.chip}`}
            >
              {t(gorselTuruMeta.labelKey)}
            </span>
          )}
          <DominantColorPalette colors={asset.dominant_colors} compact className="ms-auto" />
        </div>
        {/* Snippet: arama modunda TUM kartlarda rezerve (eslesmeyen kartta bos), gozatta
            hic render edilmez → her iki liste de kendi icinde birim yukseklikli. */}
        {reserveSnippet &&
          (asset.snippet ? <SnippetText text={asset.snippet} /> : <div className="h-8" aria-hidden />)}
      </button>

      {/* Coklu-secim onay kutusu — hover'da YA DA kumede iken gorunur. Kartin kardesi
          (ic ice buton degil); kendi tiklamasini durdurur (detay acmasin). */}
      <label
        className={`absolute start-1 top-1 z-20 inline-flex cursor-pointer rounded bg-bg-primary/80 p-1
          ${multiSelected ? "opacity-100" : "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={multiSelected}
          onChange={() => onToggleSelect(asset.id)}
          className="h-3.5 w-3.5 accent-accent"
          aria-label={label}
        />
      </label>

      {/* ✨ = "AI bu gorseli inceledi + icerigi aranabilir" (alt-baslangic kose; favori bottom-end,
          kutu top-start, uzanti top-end ile carpismaz). Gorsel turu ARTIK govdede renkli metin-hapi
          (yukarida) — kose yalniz ✨. */}
      {asset.ai_analyzed && (
        <span
          title={t("ai_vision.badge_title")}
          aria-label={t("ai_vision.badge_title")}
          className="pointer-events-none absolute start-1 bottom-1 z-10 rounded bg-bg-primary/70 px-1 text-sm leading-none"
        >
          ✨
        </span>
      )}

      <FavoriteButton
        assetId={asset.id}
        favorite={asset.favorite}
        className="absolute end-1 bottom-1 z-10 rounded bg-bg-primary/70 px-1 text-sm"
      />
    </div>
  );
}

/** "Neden bu sonuc": eslesen terimler vurgulu snippet. Isaretleyicileri (char(2)/char(3))
 *  paylasilan `HighlightedText` ile `<mark>`'a cevirir (arama alan-atfiyla tek cozucu). */
function SnippetText({ text }: { text: string }) {
  return (
    // h-8 = 2 × leading-4 → 1-satirlik snippet de 2-satirlik da ayni yeri kaplar.
    <p className="line-clamp-2 h-8 px-1 text-start text-[11px] leading-4 text-text-secondary">
      <HighlightedText text={text} />
    </p>
  );
}

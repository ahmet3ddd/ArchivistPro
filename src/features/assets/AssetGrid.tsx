// Ana icerik — arac cubugu (siralama + toplam) + sanallastirilmis (pencereli) asset grid.
// Sonsuz-kaydirma: alta yaklasinca sonraki sayfa eklenir (H2 pariti: VirtuosoGrid 100K+).
//
// Faz 7.5 (gezgin etkilesimleri): coklu-secim (duz/ctrl/shift tik) + sag-tik baglam menusu
// + toplu islem arac cubugu. Secim modeli:
//   - duz tik       → detayi ac (mevcut `select`)
//   - ctrl/cmd+tik  → id'yi coklu-secimde degistir (`toggleSelected`)
//   - shift+tik     → son-tiklanan indeks ile bu indeks arasi araligi sec (`setSelectedRange`)

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type DragEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { VirtuosoGrid, type VirtuosoGridHandle } from "react-virtuoso";

import type { AssetSort } from "../../ipc/client";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useInfiniteAssets } from "../../hooks/useAssets";
import { useCollections, useTagFacets } from "../../hooks/useFacets";
import { SELECT_ALL_EVENT } from "../../hooks/useGlobalShortcuts";
import { useIngestWriteLock } from "../../hooks/useIngestLock";
import { useSession } from "../../hooks/useSession";
import { useGridThumbnails } from "../../hooks/useThumbnails";
import { useUiStore } from "../../store/useUiStore";
import { AssetContextMenu, type ContextMenuTarget } from "../explorer/AssetContextMenu";
import { BatchToolbar } from "../explorer/BatchToolbar";
import { BlankContextMenu } from "../explorer/BlankContextMenu";
import { PathBreadcrumb } from "../folders/PathBreadcrumb";
import { PickerModal } from "../explorer/PickerModal";
import { useBulkActions } from "../explorer/useBulkActions";
import { AssetCard } from "./AssetCard";
import { writeAssetCollectionDrag } from "./assetCollectionDrag";
import { useGridKeyboardNav } from "./useGridKeyboardNav";

// Acik picker modal: hangi tur + hangi asset id'lerine uygulanacak.
// Hem baglam menusu hem batch toolbar bu modali ACAR (ortak ebeveyn = AssetGrid);
// window.prompt yerine autocomplete. EKLE turleri find-or-create; KALDIR turleri
// yalniz-secim (allowCreate=false → olmayani uretmek anlamsiz).
type PickerKind = "tag" | "collection" | "remove-tag" | "remove-collection";
type Picker = { kind: PickerKind; ids: number[] };

// Picker baslik/placeholder i18n anahtarlari (tur → anahtar). Modul-duzeyi sabit
// (her render yeniden kurulmaz).
const PICKER_TITLE: Record<PickerKind, string> = {
  tag: "picker.tag_title",
  collection: "picker.collection_title",
  "remove-tag": "picker.remove_tag_title",
  "remove-collection": "picker.remove_collection_title",
};
const PICKER_PLACEHOLDER: Record<PickerKind, string> = {
  tag: "picker.tag_placeholder",
  collection: "picker.collection_placeholder",
  "remove-tag": "picker.remove_tag_placeholder",
  "remove-collection": "picker.remove_collection_placeholder",
};

const SORTS: AssetSort[] = [
  "modified_desc",
  "modified_asc",
  "name_asc",
  "size_desc",
  "created_desc",
];

// VirtuosoGrid'in grid kabi — kartlar duyarli CSS grid'e akar. Sutun genisligi
// store.cardSize'a baglidir (TopBar kaydiraci): repeat(auto-fill, minmax(Npx, 1fr))
// — H2 pariti (sabit grid-cols-* yerine kullanici-ayarli kart boyutu).
//
// Iki olcum-hassas ayrinti (H2 `ExplorerView.tsx` gridComponents ile ayni):
//  - DIKEY padding YOK (`px-4`, `p-4` DEGIL): Virtuoso bu kaba kendi `paddingTop`/
//    `paddingBottom`'unu INLINE yazar (sanal bosluk) → sinif ile verilen dikey padding
//    zaten ezilir; `p-4` birakmak yalniz yaniltir. Yatay padding cakismaz, kalir.
//  - `alignContent: start`: kap icerikten yuksek kaldiginda satirlarin esneyip
//    yukselmesini onler (auto satirlar stretch olur) → satir yuksekligi sabit kalir.
const GridList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function GridList({ children, className, style, ...props }, ref) {
    const cardSize = useUiStore((s) => s.cardSize);
    return (
      <div
        ref={ref}
        data-grid-list=""
        {...props}
        style={{
          ...style,
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
          alignContent: "start",
        }}
        className={`grid gap-3 px-4 ${className ?? ""}`}
      >
        {children}
      </div>
    );
  },
);

/** Grid'in CANLI sutun sayisi — cozulmus grid-template-columns'un parca sayisi (genislik +
 *  kart-boyutuna gore tarayici hesaplar; ok ↑/↓ = ±sutun). Bulunamazsa 1 (guvenli varsayilan). */
function countGridColumns(): number {
  const el = document.querySelector<HTMLElement>("[data-grid-list]");
  if (!el) return 1;
  const cols = getComputedStyle(el).gridTemplateColumns;
  const n = cols.split(" ").filter((s) => s.trim().length > 0).length;
  return Math.max(1, n);
}

export function AssetGrid() {
  const { t } = useTranslation();
  const { items, total, loading, loadingMore, error, loadMore, retry } = useInfiniteAssets();
  const { canWrite } = useSession();
  const { addTagMany, removeTagMany, addToCollectionMany, removeFromCollectionMany } =
    useBulkActions();
  // Picker secenekleri (autocomplete kaynagi): mevcut etiketler + koleksiyonlar.
  const tagFacets = useTagFacets();
  const collections = useCollections();

  const sort = useUiStore((s) => s.sort);
  const setSort = useUiStore((s) => s.setSort);
  const similarTo = useUiStore((s) => s.similarTo);
  const similarToName = useUiStore((s) => s.similarToName);
  const setSimilarTo = useUiStore((s) => s.setSimilarTo);
  const clearSimilarTo = useUiStore((s) => s.clearSimilarTo);
  const geoListIds = useUiStore((s) => s.geoListIds);
  const setGeoListIds = useUiStore((s) => s.setGeoListIds);
  const query = useUiStore((s) => s.query);
  const viewMode = useUiStore((s) => s.viewMode);
  const selectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const stalenessById = useUiStore((s) => s.stalenessById);
  const clearSelected = useUiStore((s) => s.clearSelected);
  const toggleSelected = useUiStore((s) => s.toggleSelected);
  const setSelectedRange = useUiStore((s) => s.setSelectedRange);
  const setSelectedMany = useUiStore((s) => s.setSelectedMany);
  // LAN Faz 2: uzak arsiv listeleniyor mu (yerel-id'ye dayanan eylemler kapanir).
  const remoteMode = useUiStore((s) => s.assetSource === "remote");
  // YAZMA KILIDI = uzak arsiv **veya** kosan tarama. Tarama arka plana alinabildigi icin
  // kullanici artik kosu sirasinda gride ULASIYOR; buradaki eylemlerin hepsi (favori/etiket/
  // cop/toplu islem) yazma kilidini bekler ve senkron olduklari icin UI is parcacigini
  // dondururdu (bkz `useIngestLock`). `remoteMode` AYRI tutulur: `staleness` gosterimi bir
  // OKUMA ozelligidir, tarama sirasinda kapatilmasi icin bir neden yok.
  const scanning = useIngestWriteLock();
  const writeLocked = remoteMode || scanning;

  // Ctrl+A (useGlobalShortcuts) → yuklu ogeleri sec. Merkezi hook grid'in biriken listesine
  // sahip degil → `document` custom-event ile buraya haber verir; kaynak (items) burada.
  // BatchToolbar "Tumunu sec" ile ayni davranis (o an YUKLU tum id'ler).
  useEffect(() => {
    const onSelectAll = () => setSelectedMany(items.map((a) => a.id));
    document.addEventListener(SELECT_ALL_EVENT, onSelectAll);
    return () => document.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
  }, [items, setSelectedMany]);

  // Coklu-secimi O(1) uyelik testi icin Set'e cevir (kartlar prop ile alir; tek tek
  // store'a abone OLMAZ → buyuk grid'de re-render firtinasi yok).
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // id → liste indeksi (shift-aralik hesabi). items biriktikce yeniden kurulur.
  const indexById = useMemo(() => {
    const m = new Map<number, number>();
    items.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [items]);
  const lastIndexRef = useRef<number | null>(null); // shift-aralik capasi (son tiklanan)
  // Klavye imleci (Faz B) — onActivate'ten ONCE tanimli: fare tiklamasi imleci de senkronlar
  // (tik → ok, tiklanan hucreden devam eder). Kaydirma referansi + kullanan hook asagida.
  const virtuosoRef = useRef<VirtuosoGridHandle>(null);
  const [cursorIndex, setCursorIndex] = useState(-1);

  // Tiklama anlamlandirma: modifier'a gore duz/ctrl/shift.
  const onActivate = useCallback(
    (id: number, e: MouseEvent) => {
      const idx = indexById.get(id) ?? null;
      if (idx != null) setCursorIndex(idx); // klavye imleci fareyi takip etsin
      if (e.shiftKey && lastIndexRef.current != null && idx != null) {
        const a = Math.min(lastIndexRef.current, idx);
        const b = Math.max(lastIndexRef.current, idx);
        const rangeIds = items.slice(a, b + 1).map((x) => x.id);
        setSelectedRange(rangeIds);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        toggleSelected(id);
        lastIndexRef.current = idx;
        return;
      }
      // Duz tik → coklu-secimi ONCE bosalt, sonra detayi ac; capayi da bu id'ye tasi.
      // ⚠️ VERI-RISKI: clearSelected() ATLANIRSA secim GORUNMEZ sekilde canli kalir
      // (kartlar gorus disinda olabilir) → ardindan Delete (useGlobalShortcuts → trashMany)
      // veya BatchToolbar YANLIS dosyalara uygulanir. H2 pariti:
      // C:\Arsiv-H2\src\components\ExplorerView.tsx:92 → onOpen={() => { clearAssetSelection();
      // onSelectAsset(asset.id); }} — duz tik daima once coklu-secimi bosaltir.
      clearSelected();
      select(id);
      lastIndexRef.current = idx;
    },
    [indexById, items, select, clearSelected, toggleSelected, setSelectedRange],
  );

  const onToggleSelect = useCallback(
    (id: number) => {
      toggleSelected(id);
      const idx = indexById.get(id) ?? null;
      lastIndexRef.current = idx;
      if (idx != null) setCursorIndex(idx);
    },
    [toggleSelected, indexById],
  );

  // Picker modal (etiket/koleksiyon ekle) — baglam menusu + batch toolbar ACAR; submit'te
  // bulk action calisir (find-or-create + toast). null = kapali.
  const [picker, setPicker] = useState<Picker | null>(null);
  const onPickerSubmit = useCallback(
    (value: string) => {
      if (!picker) return;
      switch (picker.kind) {
        case "tag":
          void addTagMany(picker.ids, value);
          break;
        case "remove-tag":
          void removeTagMany(picker.ids, value);
          break;
        case "collection":
          void addToCollectionMany(picker.ids, value);
          break;
        case "remove-collection": {
          // Kaldir yalniz-secim → deger mevcut bir koleksiyon adi; id'sine cevir.
          const c = collections.find((x) => x.name === value);
          if (c) void removeFromCollectionMany(picker.ids, c.id, c.name);
          break;
        }
      }
    },
    [picker, addTagMany, removeTagMany, addToCollectionMany, removeFromCollectionMany, collections],
  );

  // Baglam menusu hedefi (null = kapali). Sag-tiklanan asset coklu-secimin parcasiysa
  // menu TUM secime; degilse yalniz o asset'e uygulanir.
  const [menu, setMenu] = useState<ContextMenuTarget | null>(null);
  // Bos grid alani sag-tik menusu (H2 BlankContextMenu paritesi). Kartlar kendi baglam
  // menusunu acar; onlari asagidaki target denetimiyle bilerek disarida birakiriz.
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  const requestDedupFor = useUiStore((s) => s.requestDedupFor);
  const onContextMenu = useCallback(
    (id: number, x: number, y: number) => {
      // UZAK arsivde baglam menusu ACILMAZ: icindeki her eylem (favori/etiket/cop/dosya ac)
      // YEREL id ile yerel DB'ye gider ⇒ uzak satirin id'si baska bir YEREL dosyayi vururdu.
      // Menuyu tek tek kisitlamak yerine yol bastan kapatilir (guvenli taraf).
      if (writeLocked) return;
      const asset = items.find((a) => a.id === id);
      if (!asset) return;
      const ids = selectedSet.has(id) && selectedIds.length > 0 ? selectedIds : [id];
      setMenu({ ids, clickedId: id, favorite: asset.favorite, path: asset.path, x, y });
    },
    [items, selectedSet, selectedIds, writeLocked],
  );
  const onBlankContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        "[data-asset-card], [data-context-menu], button, a, input, select, textarea, [role=menu]",
      )
    ) {
      return;
    }
    event.preventDefault();
    setBlankMenu({ x: event.clientX, y: event.clientY });
  }, []);

  // Kart sürüklenirse çoklu-seçim içindeyse tüm seçimi, değilse yalnız kartı taşır.
  // Uzak arşivde yerel id'ler güvenli olmadığından ve viewer yazamayacağından kaynak
  // başlangıçta kapalıdır; drop hedefindeki gate ikinci savunma katmanıdır.
  const onAssetCollectionDragStart = useCallback(
    (id: number, event: DragEvent<HTMLButtonElement>) => {
      const ids = selectedSet.has(id) && selectedIds.length > 0 ? selectedIds : [id];
      writeAssetCollectionDrag(event.dataTransfer, ids);
    },
    [selectedSet, selectedIds],
  );

  // Yalniz GORUNUR pencere (VirtuosoGrid'in render ettigi aralik + overscan) id'lerinin
  // thumbnail'lerini cek. ONEMLI: tum `items`'i DEGIL pencereyi geciyoruz — useGridThumbnails
  // LRU cache'i ancak pencereli girdiyle dogru sinirlanir (tum liste verilirse evict edilen
  // id'ler her sayfada yeniden cekilir = thrash). Aralik `rangeChanged`'den gelir.
  const [range, setRange] = useState({ startIndex: 0, endIndex: 0 });
  // LAN Faz 3: uzak modda da thumbnail CEKILIR — `useGridThumbnails` kaynaga gore
  // `remote_thumbnails`'a yonlenir (ve kaynak degisiminde cache'ini temizler). Faz 2'deki
  // "uzakta bos liste" kisitlamasi KALKTI; o kisitlama yerel DB'den yanlis gorsel gelmesini
  // onlemek icindi, artik dogru kaynaktan geliyor.
  const visibleIds = useMemo(
    () => items.slice(range.startIndex, range.endIndex + 1).map((a) => a.id),
    [items, range],
  );
  const thumbs = useGridThumbnails(visibleIds);

  // — Klavye Faz B: grid ok-navigasyonu (imlec state'i/refi yukarida, onActivate'ten once) —
  // Imlec yokken baslangic noktasi = acik detay ogesinin indeksi (varsa), yoksa 0.
  const selectedIndex = selectedId != null ? (indexById.get(selectedId) ?? -1) : -1;
  // Liste kimligi degisince (siralama/sorgu/filtre → ilk id degisir) imleci sifirla; sayfa
  // eklenmesinde (items[0] AYNI kalir) DOKUNMAZ → sonsuz-kaydirmada imlec korunur.
  const firstId = items[0]?.id ?? -1;
  useEffect(() => {
    setCursorIndex(-1);
  }, [firstId]);
  // Imleci YALNIZ gerektiginde gorunur pencereye kaydir (pencere-ici hareketlerde ziplamaz).
  // NOT: `range` Virtuoso'nun RENDER araligidir (overscan dahil) → imlec kisa sure gorus disinda
  // kalabilir ama render'lidir; sonraki adimda hizalanir. Ilk kesit icin kabul (canli testte incele).
  const ensureVisible = useCallback(
    (index: number) => {
      if (index < range.startIndex) virtuosoRef.current?.scrollToIndex({ index, align: "start" });
      else if (index > range.endIndex) virtuosoRef.current?.scrollToIndex({ index, align: "end" });
    },
    [range],
  );
  useGridKeyboardNav({
    enabled: viewMode === "explorer",
    items,
    cursorIndex,
    selectedIndex,
    setCursorIndex,
    getColumnCount: countGridColumns,
    ensureVisible,
    select,
    clearSelected,
    toggleSelected,
    setSelectedRange,
    anchorRef: lastIndexRef,
    loadMore,
  });

  const ctrl =
    "rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none";

  // Aktif metin sorgusu (sorgu dolu + benzer-gorsel modunda DEGIL). Ana kutu FTS-ONCELIKLI
  // (list_assets); 0 sonucta EmptyState durust "bulunamadi" mesajini verir (asagida).
  const activeTextQuery = query.trim().length > 0 && similarTo == null;
  // FTS, 1-3 karakterli ciplak terimleri kasten TAM kelime olarak arar; bu, "kat" gibi
  // koklerin katman/katalog gurultusunu tum arsive yaymasini onler. 0-sonucta eskiden
  // kullanici bu kurali hic gormeden bos ekran aliyordu. Anlamli arama kendi yolunu
  // kullandigi icin bu yalniz klasik metin sorgusuna uygulanir.
  const shortTextQuery = activeTextQuery && Array.from(query.trim()).length <= 3;

  return (
    <div className="flex h-full flex-col">
      {/* Arac cubugu */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <select className={ctrl} value={sort} onChange={(e) => setSort(e.target.value as AssetSort)}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
        <span className="ms-auto text-xs text-text-muted">
          {items.length < total
            ? `${items.length} / ${t("list.total", { count: total })}`
            : t("list.total", { count: total })}
        </span>
      </div>

      {/* Yol izi — aktif klasor filtresi varken: 📁 Klasorler'e tek-tik donus + ust-klasore
          cikis (segment tik). Filtre yoksa render edilmez. */}
      <PathBreadcrumb />

      {/* "Benzer gorseller" modu banneri (gorsel→gorsel aktifken) — kaynak gorsel adi + temizle. */}
      {similarTo != null && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-4 py-2 text-xs">
          <span className="truncate text-text-secondary">
            {t("visual.similar_title", { name: similarToName ?? "" })}
          </span>
          <button
            type="button"
            onClick={clearSimilarTo}
            title={t("visual.similar_clear")}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 text-text-secondary transition hover:bg-bg-secondary hover:border-border-hover motion-reduce:transition-none"
          >
            {t("visual.similar_clear")}
          </button>
        </div>
      )}

      {geoListIds != null && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-4 py-2 text-xs">
          <span className="truncate text-text-secondary">
            {t("view.map_cluster", { count: geoListIds.length })}
          </span>
          <button
            type="button"
            onClick={() => setGeoListIds(null)}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 text-text-secondary transition hover:border-border-hover hover:bg-bg-secondary motion-reduce:transition-none"
          >
            {t("visual.similar_clear")}
          </button>
        </div>
      )}
      {/* Toplu islem arac cubugu (yalniz secim varken). UZAK arsivde RENDER EDILMEZ:
          etiket/koleksiyon/cop eylemlerinin hepsi yerel id ile yerel DB'ye gider. */}
      {!writeLocked && (
        <BatchToolbar
          items={items}
          total={total}
          onAddTag={(ids) => setPicker({ kind: "tag", ids })}
          onRemoveTag={(ids) => setPicker({ kind: "remove-tag", ids })}
          onAddToCollection={(ids) => setPicker({ kind: "collection", ids })}
          onRemoveFromCollection={(ids) => setPicker({ kind: "remove-collection", ids })}
        />
      )}

      {/* Govde (sanallastirilmis) */}
      {/* `data-grid-scope`: klavye ok/Enter/Space'in SAHIPLIK bolgesi (K2). Dinleyici
          `document`'te oldugu icin odak bu kabin DISINDAysa (kenar cubugu, detay sekmesi)
          tuslara dokunmaz — bkz `useGridKeyboardNav.gridOwnsKey`. */}
      <div data-grid-scope className="relative min-h-0 flex-1" onContextMenu={onBlankContextMenu}>
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
              className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="p-4">
            {/* Sorgu varken 0 sonuc → DURUST "guclu eslesme bulunamadi" + ne yapilacagi ipucu.
                Filtreli gozatta (sorgu yok) genel bos-durum. */}
            <EmptyState
              title={activeTextQuery ? t("search_mode.not_found_title") : t("list.empty")}
              hint={
                activeTextQuery
                  ? t(shortTextQuery ? "search_mode.short_query_hint" : "search_mode.not_found_hint")
                  : t("list.empty_hint")
              }
            />
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <VirtuosoGrid
            ref={virtuosoRef}
            style={{ height: "100%" }}
            data={items}
            endReached={loadMore}
            overscan={600}
            rangeChanged={setRange}
            components={{ List: GridList }}
            itemContent={(index, a) => (
              <AssetCard
                asset={a}
                selected={a.id === selectedId}
                multiSelected={selectedSet.has(a.id)}
                active={index === cursorIndex}
                thumbnail={thumbs[a.id]}
                staleness={remoteMode ? undefined : stalenessById[a.id]}
                reserveSnippet={activeTextQuery}
                onActivate={onActivate}
                onToggleSelect={onToggleSelect}
                onContextMenu={onContextMenu}
                onDragStart={canWrite && !writeLocked ? onAssetCollectionDragStart : undefined}
              />
            )}
          />
        )}
        {loadingMore && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <span className="rounded-full bg-bg-secondary/90 px-3 py-1 text-xs text-text-secondary shadow backdrop-blur-md">
              {t("list.loading")}
            </span>
          </div>
        )}
      </div>

      {menu && (
        <AssetContextMenu
          target={menu}
          canWrite={canWrite}
          onAddTag={(ids) => setPicker({ kind: "tag", ids })}
          onAddToCollection={(ids) => setPicker({ kind: "collection", ids })}
          onSimilarImages={(id) => {
            const a = items.find((x) => x.id === id);
            if (a) setSimilarTo(a.id, a.file_name);
          }}
          onFindDuplicates={(id) => {
            const a = items.find((x) => x.id === id);
            if (a) requestDedupFor({ id: a.id, name: a.file_name });
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {blankMenu && (
        <BlankContextMenu
          assetIds={items.map((asset) => asset.id)}
          x={blankMenu.x}
          y={blankMenu.y}
          onClose={() => setBlankMenu(null)}
        />
      )}

      {picker && (
        <PickerModal
          title={t(PICKER_TITLE[picker.kind])}
          placeholder={t(PICKER_PLACEHOLDER[picker.kind])}
          options={
            picker.kind === "tag" || picker.kind === "remove-tag"
              ? tagFacets.map((f) => f.value).filter((v): v is string => v != null)
              : collections.map((c) => c.name)
          }
          allowCreate={picker.kind === "tag" || picker.kind === "collection"}
          count={picker.ids.length}
          onSubmit={onPickerSubmit}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

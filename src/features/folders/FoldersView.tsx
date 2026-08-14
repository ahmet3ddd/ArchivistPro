// Klasor gorunumu (H2 FoldersView pariti — zenginlestirilmis baglam menusu). Kullanicinin
// ingest ettigi klasorleri kart olarak gosterir; bir karta tiklayinca liste o klasore
// filtrelenir (`pathPrefix`) ve gorunum explorer'a gecer (sonuc grid'de gosterilir).
//
// Veri: `folder_summary()` (ust-dizine gore gruplu asset sayilari + son-tarama tarihi). Renderer
// DB tutmaz; sorgu-hook (useIpcQuery) ile komut cagrilir; `dataVersion` artinca (ingest) tazelenir.
// Kart grid'i sanallastirilir (VirtuosoGrid) — backend cap 1000, AssetGrid ile ayni desen.
//
// Kartlar YEREL siralanir (ad / dosya sayisi / son tarama · artan/azalan); tercih localStorage'a
// kalir. Sag-tik menusu (FolderContextMenu): GORUNUM (explorer/technical/dashboard) · SIRALAMA ·
// Yeniden Tara (admin) · Ac/Kural ile duzenle/Yeniden indeksle/Cop'e Tasi (admin).

import { confirm } from "@tauri-apps/plugin-dialog";
import {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { VirtuosoGrid } from "react-virtuoso";

import type { FolderSummaryDto } from "../../ipc/client";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { basename } from "../../lib/format";
import { useUiStore, type ViewMode } from "../../store/useUiStore";
import { useBgTaskStore } from "../bgtask/bgTaskStore";
import { OrganizeModal } from "../refile/OrganizeModal";
import { useToast } from "../toast/useToast";
import { FolderCard } from "./FolderCard";
import { FolderTree } from "./FolderTree";
import {
  FolderContextMenu,
  type FolderSortBy,
  type FolderSortOrder,
} from "./FolderContextMenu";
import type { TreeBlankContextTarget, TreeContextTarget } from "./FolderTree";

// Yerel siralama tercihi localStorage anahtarlari (oturumlar arasi kalici).
const SORT_BY_KEY = "arsiv.folders.sortBy";
const SORT_ORDER_KEY = "arsiv.folders.sortOrder";

function initialSortBy(): FolderSortBy {
  const v = localStorage.getItem(SORT_BY_KEY);
  return v === "name" || v === "fileCount" || v === "lastScan" ? v : "name";
}
function initialSortOrder(): FolderSortOrder {
  const v = localStorage.getItem(SORT_ORDER_KEY);
  return v === "asc" || v === "desc" ? v : "asc";
}

// Gorunum kipi (Kart / Agac) — yerel tercih, oturumlar arasi kalici.
type FolderView = "cards" | "tree";
const VIEW_KEY = "arsiv.folders.view";
function initialView(): FolderView {
  return localStorage.getItem(VIEW_KEY) === "tree" ? "tree" : "cards";
}

// Kart kabi — duyarli CSS grid (AssetGrid ile AYNI yaklasim): sutun genisligi TopBar
// kart-boyutu kaydiracina (store.cardSize) baglidir → klasor kartlari da kucultulebilir.
// VirtuosoGrid icin forwardRef gerek.
const GridList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function GridList({ children, className, style, ...props }, ref) {
    const cardSize = useUiStore((s) => s.cardSize);
    return (
      <div
        ref={ref}
        {...props}
        style={{
          ...style,
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
        }}
        className={`grid gap-3 p-4 ${className ?? ""}`}
      >
        {children}
      </div>
    );
  },
);

export function FoldersView() {
  const { t } = useTranslation();
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const setPathPrefix = useUiStore((s) => s.setPathPrefix);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const assetSource = useUiStore((s) => s.assetSource);
  const remote = assetSource === "remote";
  const dataVersion = useUiStore((s) => s.dataVersion);
  const bumpData = useUiStore((s) => s.bumpData);
  const bgStart = useBgTaskStore((s) => s.start);
  const bgUpdate = useBgTaskStore((s) => s.update);
  const bgEnd = useBgTaskStore((s) => s.end);
  const toast = useToast();

  // Kaynak-farkinda: uzak modda ANA arsivin klasorleri (remote_folder_summary), yerelde bu makine.
  // Uzakta kartlar SALT-OKUMA: sol tik = pathPrefix + Gezgin (uzak-farkinda grid); yazma eylemleri
  // (sag-tik menusu) asagida kapatilir. `assetSource` dep → kaynak degisince yeniden ceker.
  const { data, loading, error, refetch } = useIpcQuery<FolderSummaryDto[]>(
    () => (remote ? ipc.remoteFolderSummary() : ipc.folderSummary()),
    [dataVersion, assetSource],
  );

  // Yerel siralama durumu (kart siralamasi; localStorage'a kalici). Menuye current gecer (✓ icin).
  const [sortBy, setSortBy] = useState<FolderSortBy>(initialSortBy);
  const [sortOrder, setSortOrder] = useState<FolderSortOrder>(initialSortOrder);
  useEffect(() => {
    localStorage.setItem(SORT_BY_KEY, sortBy);
  }, [sortBy]);
  useEffect(() => {
    localStorage.setItem(SORT_ORDER_KEY, sortOrder);
  }, [sortOrder]);

  // Gorunum kipi (Kart/Agac) + kalicilik.
  const [view, setView] = useState<FolderView>(initialView);
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // Sag-tik baglam menusu durumu (imlec konumu + hedef klasor yolu) — AssetGrid deseni.
  const [menu, setMenu] = useState<{
    path: string;
    x: number;
    y: number;
    treeTarget?: TreeContextTarget;
    treeBlankTarget?: TreeBlankContextTarget;
  } | null>(null);
  // "Kural ile duzenle" acilinca OrganizeModal'a verilecek klasor yolu (null → kapali).
  const [organizeFolder, setOrganizeFolder] = useState<string | null>(null);
  // Klasor yeniden-indeksleme / yeniden-tarama durumu (admin bakim eylemi) — yalniz re-entrancy
  // guard'i. Ilerleme artik GLOBAL banner'da (bgTaskStore) → her gorunumden gorunur (eskiden yalniz
  // bu gorunumun basligindaydi → baska gorunumdeyken kaybolurdu; kullanici bulgusu).
  const [reindexing, setReindexing] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  const folders = useMemo(() => data ?? [], [data]);

  // Kartlari yerel olarak sirala. name → basename(path) yerel-duyarli; fileCount → file_count;
  // lastScan → last_indexed (null/undefined DAIMA sona — yonden bagimsiz). Yon en son uygulanir.
  const sortedFolders = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...folders].sort((a, b) => {
      if (sortBy === "name") return basename(a.path).localeCompare(basename(b.path)) * dir;
      if (sortBy === "fileCount") return (a.file_count - b.file_count) * dir;
      // lastScan: eksik tarihliler yonden bagimsiz sona itilir.
      const av = a.last_indexed;
      const bv = b.last_indexed;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [folders, sortBy, sortOrder]);

  // Bir klasoru SECILI gorunumde ac: liste filtresini ata + o gorunume gec. GORUNUM ogeleri +
  // "Ac" (explorer) bunu kullanir. NOT: MainViewContainer baglam-once efekti explorer/technical/
  // dashboard'a zorlamaz (yalniz folders/chat'ten kacirir) → secili gorunum korunur.
  const openInView = (path: string, mode: ViewMode) => {
    setPathPrefix(path);
    setViewMode(mode);
    setMenu(null);
  };

  // Kart tiklamasi → explorer (varsayilan ac). openInView ile ayni; menu yokken de calisir.
  const openFolder = (folder: FolderSummaryDto) => {
    setPathPrefix(folder.path);
    setViewMode("explorer");
  };

  // Klasor kartina sag-tik → baglam menusu (imlec konumunda). preventDefault: OS/tarayici menusu cikmasin.
  const openMenu = (path: string, e: MouseEvent, treeTarget?: TreeContextTarget) => {
    e.preventDefault();
    // Uzak modda baglam menusu KAPALI: eylemleri (Yeniden Tara / indeksle / Cop'e Tasi / Kural ile
    // duzenle) yerel-yol/yerel-id'ye dokunur → uzak klasorde YANLIS veya gecersiz hedef; menudeki
    // gorunum secenekleri de (Pano/Sohbet) uzakta kilitli. Sol tik (klasoru ac) calismaya devam eder.
    if (remote) return;
    setMenu({ path, x: e.clientX, y: e.clientY, treeTarget });
  };

  // Agacin bos alaninda hedef klasor yoktur: yalniz agac-geneli eylemler gosterilir.
  const openBlankTreeMenu = (e: MouseEvent, treeBlankTarget: TreeBlankContextTarget) => {
    e.preventDefault();
    if (remote) return;
    setMenu({ path: "", x: e.clientX, y: e.clientY, treeBlankTarget });
  };

  // "Kural ile duzenle" → OrganizeModal'i bu klasor icin ac (modal on-cozer). Menuyu kapat.
  const handleOrganize = () => {
    if (!menu) return;
    setOrganizeFolder(menu.path);
    setMenu(null);
  };

  // "Yeniden indeksle" → klasor altindaki indeksli id'leri coz → zorla yeniden cikar.
  // 0 dosya → bilgi toast. Surerken baslikta gosterge; bitince ozet toast + bumpData.
  const handleReindex = async () => {
    if (!menu || reindexing) return;
    const path = menu.path;
    setMenu(null);
    let ids: number[];
    try {
      ids = await ipc.assetIdsUnderFolder(path);
    } catch {
      toast.error(t("reindex.failed"));
      return;
    }
    if (ids.length === 0) {
      toast.info(t("organize.folder_empty"));
      return;
    }
    setReindexing(true);
    const taskId = bgStart("reindex", ids.length);
    try {
      const report = await ipc.reindexAssets(ids, (p) =>
        bgUpdate(taskId, { processed: p.processed, total: p.total }),
      );
      toast.success(
        t("reindex.done", {
          reindexed: report.reindexed,
          missing: report.missing,
          failed: report.failed,
        }),
      );
      bumpData(); // thumbnail'lar tazelensin (grid yeniden ceker)
    } catch {
      toast.error(t("reindex.failed"));
    } finally {
      setReindexing(false);
      bgEnd(taskId);
    }
  };

  // "Yeniden Tara" → bu klasoru KLASOR-KAPSAMLI replace tara (H2 "Yeniden Tara" pariti: yeni +
  // degisen + silinen hepsi senkron). Artimsal (skipUnchanged) + mode "replace": diskte artik
  // olmayan dosyalar YALNIZ bu alt-agacta cope tasinir (soft-delete, geri-alinabilir; backend
  // kaynak-yokluk koruması global silmeyi engeller → ekstra agir onay GEREKMEZ). Surerken baslikta
  // ilerleme (total=0 → henuz tariyor); bitince NET ozet toast + bumpData.
  const handleRescan = async () => {
    if (!menu || rescanning) return;
    const path = menu.path;
    setMenu(null);
    setRescanning(true);
    const taskId = bgStart("rescan"); // total 0 → belirsiz; ilk ilerlemede toplam gelir
    try {
      const report = await ipc.ingestFolder(path, true, "replace", (p) =>
        bgUpdate(taskId, { processed: p.processed, total: p.total, currentPath: p.currentPath }),
      );
      // Hicbir dosya islenmedi → backend koruması silmeyi de engelledi (removed=0, arsiv korundu).
      // AMA bu sonuc tek basina SEBEBI soylemez: klasor gercekten BOS olabilir (onemsiz) ya da
      // KAYIP/ERISILEMEZ olabilir (ALARM — arsivin bir kismi diskle bagini kopardi). Eskiden
      // ikisi tek bilgi-mesajini paylasiyordu; kullanici 2026-07-19 canli testinde kayip klasoru
      // "ici bos" diye okudu → sonda ile ayirt et. Sonda YALNIZ bu belirsiz dalda cagrilir.
      const nothingScanned =
        report.added === 0 &&
        report.updated === 0 &&
        report.skipped === 0 &&
        report.failed === 0;
      if (nothingScanned) {
        // Sonda kendisi patlarsa teshis kaybolmasin: bilinmeyen → ALARM tarafinda kal
        // (sessiz "bos" yanilgisi, bu duzeltmenin tam olarak onlemek istedigi sey).
        const src = await ipc.folderSourceState(path).catch(() => "unreadable" as const);
        if (src === "missing") {
          toast.error(t("folders.ctx.rescan_missing"));
        } else if (src === "unreadable") {
          toast.error(t("folders.ctx.rescan_unreadable"));
        } else {
          toast.info(t("folders.ctx.rescan_empty"));
        }
      } else {
        toast.success(
          t("folders.ctx.rescan_done", {
            added: report.added,
            updated: report.updated,
            removed: report.removed,
            failed: report.failed,
          }),
        );
      }
      bumpData();
    } catch {
      toast.error(t("folders.ctx.rescan_failed"));
    } finally {
      setRescanning(false);
      bgEnd(taskId);
    }
  };

  // "Cop'e Tasi" → klasor altindaki asset id'lerini coz → 0 ise bilgi; degilse ONAY (sayi) →
  // soft-delete (geri-alinabilir; diske dokunulmaz) + toast + bumpData.
  const handleTrash = async () => {
    if (!menu) return;
    const path = menu.path;
    const name = basename(path);
    setMenu(null);
    let ids: number[];
    try {
      ids = await ipc.assetIdsUnderFolder(path);
    } catch {
      toast.error(t("toast.trash_failed"));
      return;
    }
    if (ids.length === 0) {
      toast.info(t("organize.folder_empty"));
      return;
    }
    const ok = await confirm(t("folders.ctx.trash_confirm", { name, count: ids.length }), {
      title: t("folders.ctx.trash"),
      kind: "warning",
    });
    if (!ok) return;
    try {
      await ipc.trashAssets(ids);
      toast.success(t("toast.trashed", { count: ids.length }));
      bumpData(); // cope atilanlar aktif gorunumden kaybolur
    } catch {
      toast.error(t("toast.trash_failed"));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Baslik cubugu — AssetGrid arac cubugu ile gorsel tutarli */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="font-display text-sm font-semibold text-text-primary">{t("folders.title")}</h2>
        {/* Gorunum gecisi: Kart / Agac (yerel tercih) */}
        <div className="inline-flex gap-0.5 rounded-md border border-border p-0.5">
          {(["cards", "tree"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                view === v ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t(v === "cards" ? "folders.view_cards" : "folders.view_tree")}
            </button>
          ))}
        </div>
        {!loading && !error && folders.length > 0 && (
          <span className="ms-auto text-xs text-text-muted">
            {t("folders.count_total", { count: folders.length })}
          </span>
        )}
      </div>

      {/* Govde */}
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
              onClick={refetch}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
        {!loading && !error && folders.length === 0 && (
          <div className="p-4">
            <EmptyState title={t("folders.empty")} hint={t("folders.empty_hint")} />
          </div>
        )}
        {!loading &&
          !error &&
          folders.length > 0 &&
          (view === "tree" ? (
            <div className="h-full overflow-auto">
              <FolderTree
                folders={folders}
                activePath={pathPrefix}
                onOpen={(p) => openInView(p, "explorer")}
                onContextMenu={openMenu}
                onBlankContextMenu={openBlankTreeMenu}
              />
            </div>
          ) : (
            <VirtuosoGrid
              style={{ height: "100%" }}
              data={sortedFolders}
              overscan={600}
              components={{ List: GridList }}
              itemContent={(_index, folder) => (
                <FolderCard
                  name={basename(folder.path)}
                  path={folder.path}
                  fileCount={folder.file_count}
                  lastIndexed={folder.last_indexed}
                  onOpen={() => openFolder(folder)}
                  onContextMenu={(e) => openMenu(folder.path, e)}
                />
              )}
            />
          ))}
      </div>

      {/* Sag-tik baglam menusu (imlec konumunda; admin-gate icerde). */}
      {menu && (
        <FolderContextMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          sortBy={sortBy}
          sortOrder={sortOrder}
          treeTarget={menu.treeTarget}
          treeBlankTarget={menu.treeBlankTarget}
          onView={(mode) => openInView(menu.path, mode)}
          onSortBy={setSortBy}
          onSortOrder={setSortOrder}
          onRescan={() => void handleRescan()}
          onOpen={() => openInView(menu.path, "explorer")}
          onOrganize={handleOrganize}
          onReindex={() => void handleReindex()}
          onTrash={() => void handleTrash()}
          onClose={() => setMenu(null)}
        />
      )}

      {/* "Kural ile duzenle" → OrganizeModal bu klasoru on-cozer (initialFolder). */}
      {organizeFolder && (
        <OrganizeModal
          initialFolder={organizeFolder}
          onClose={() => setOrganizeFolder(null)}
          onDone={() => bumpData()}
        />
      )}
    </div>
  );
}

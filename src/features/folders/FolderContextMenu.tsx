// Klasor karti sag-tik baglam menusu (H2 pariti — zenginlestirilmis; H2 BlankContextMenu deseni).
//
// Imlec konumunda sabit (fixed) menu; disari-tik + Esc + kaydirma ile kapanir (AssetContextMenu
// ile birebir). Dort bolum:
//   GORUNUM  — o klasoru SECILI gorunumde ac (pathPrefix + viewMode: explorer/technical/dashboard).
//              "Su gorunumde ac" aksiyonu → checkmark YOK.
//   SIRALAMA — klasor KARTLARINI siralar (FoldersView yerel durumu). Olcut 3 + yon 2; secili ✓.
//              Siralama tiklamasi menuyu ACIK birakir (kullanici ✓'i gorup yon de secebilsin).
//   Yeniden Tara — artimsal ingest (admin).
//   [klasor] — Ac / Kural ile duzenle / Yeniden indeksle / Cop'e Tasi (danger). Bakim eylemleri
//              admin-gate: admin degilse GORUNUR-ama-pasif + tooltip (kesfedilebilirlik). Gercek
//              yetki Rust'ta (UI yalniz gorunum).
//
// AI ANALIZ KAPISI (2026-08-20): Yeniden Tara · Kural ile duzenle · Yeniden indeksle bir analiz
// kosarken de pasiflesir (`MaintenanceGate` ile ayni sebep ve ayni cumle) — ucu de analiz
// edilmekte olan dosyanin yolunu/onizlemesini degistirir; tarama ayrica yazma kilidini tum kosu
// boyunca tutar. "Cop'e Tasi" KAPSAM DISI: soft-delete yol/onizleme degistirmez.

import { useTranslation } from "react-i18next";

import { ContextMenu, MenuDivider, MenuItem, MenuSectionLabel } from "../../components/ContextMenu";

import { useSession } from "../../hooks/useSession";
import { useVisionRunState } from "../../hooks/useVisionLock";
import type { ViewMode } from "../../store/useUiStore";

/** Klasor kartlarinin siralama olcutu (FoldersView yerel durumu; ✓ referansi). */
export type FolderSortBy = "name" | "fileCount" | "lastScan";
/** Siralama yonu (artan/azalan). */
export type FolderSortOrder = "asc" | "desc";

interface Props {
  /** Sag-tiklanan klasorun tam yolu (baslik + eylem hedefi). */
  path: string;
  /** Imlec konumu (viewport koordinati). */
  x: number;
  y: number;
  /** SIRALAMA — su anki olcut/yon (secili ogeye ✓). */
  sortBy: FolderSortBy;
  sortOrder: FolderSortOrder;
  /** Agac dugumunde kart-siralamasi yerine genislet/daralt eylemi gorunur. */
  treeTarget?: {
    hasChildren: boolean;
    expanded: boolean;
    onToggle: () => void;
  };
  /** Agacin bos alaninda hedef klasor olmadan agac-geneli eylemler gorunur. */
  treeBlankTarget?: {
    hasExpandSnapshot: boolean;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    onRestorePrevious: () => void;
  };
  /** GORUNUM — o klasoru secili gorunumde ac (setPathPrefix + setViewMode). */
  onView: (mode: ViewMode) => void;
  /** SIRALAMA — olcut/yon degistir (menu ACIK kalir; ✓ aninda guncellenir). */
  onSortBy: (by: FolderSortBy) => void;
  onSortOrder: (order: FolderSortOrder) => void;
  /** Yeniden Tara — bu klasoru artimsal yeniden tara (ingest merge; admin). */
  onRescan: () => void;
  /** Ac — klasoru explorer'da filtrele (mevcut openFolder). */
  onOpen: () => void;
  /** Kural ile duzenle — OrganizeModal'i bu klasor icin ac (admin). */
  onOrganize: () => void;
  /** Yeniden indeksle — klasor altindaki dosyalari zorla yeniden cikar (admin). */
  onReindex: () => void;
  /** Cop'e Tasi — klasor altindaki asset'leri onayli soft-delete (admin, danger). */
  onTrash: () => void;
  onClose: () => void;
}

const MENU_W = 248; // menu genisligi (yukseklik ARTIK tahmin edilmiyor — iskelet olcuyor)

export function FolderContextMenu({
  path,
  x,
  y,
  sortBy,
  sortOrder,
  treeTarget,
  treeBlankTarget,
  onView,
  onSortBy,
  onSortOrder,
  onRescan,
  onOpen,
  onOrganize,
  onReindex,
  onTrash,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const viewerHint = t("context.viewer_hint");
  // AI gorsel analizi kosarken dosya YOLUNU/onizlemesini degistiren (ya da yazma kilidini uzun
  // tutan) klasor eylemleri kilitli — `MaintenanceGate` ile AYNI sebep, menude ayni gorsel dil
  // (disabled + ipucu) zaten var. Yetki kapisi ONCE gelir: rol yetmiyorsa once o soylenir.
  const analysisRunning = useVisionRunState().active;
  const maintenanceHint = t("vision_index.maintenance_locked");
  const gateHint = (base: string | undefined) =>
    !isAdmin ? base : analysisRunning ? maintenanceHint : base;

  return (
    <ContextMenu
      x={x}
      y={y}
      width={MENU_W}
      onClose={onClose}
      testId="folder-context-menu"
      ariaLabel={t("folders.ctx.aria_label")}
    >
      {/* ── GORUNUM: o klasoru secili gorunumde ac (checkmark YOK — aksiyon) ── */}
      {!treeBlankTarget && (
        <>
          <MenuSectionLabel>{t("folders.ctx.section_view")}</MenuSectionLabel>
          <MenuItem label={t("folders.ctx.view_explorer")} onClick={() => onView("explorer")} />
          <MenuItem label={t("folders.ctx.view_technical")} onClick={() => onView("technical")} />
          <MenuItem label={t("folders.ctx.view_dashboard")} onClick={() => onView("dashboard")} />
        </>
      )}

      {treeBlankTarget && (
        <>
          <MenuSectionLabel>{t("folders.ctx.section_tree")}</MenuSectionLabel>
          <MenuItem
            label={t("folders.ctx.tree_expand_all")}
            onClick={() => {
              treeBlankTarget.onExpandAll();
              onClose();
            }}
          />
          <MenuItem
            label={t(
              treeBlankTarget.hasExpandSnapshot
                ? "folders.ctx.tree_restore_previous"
                : "folders.ctx.tree_collapse_all",
            )}
            onClick={() => {
              if (treeBlankTarget.hasExpandSnapshot) treeBlankTarget.onRestorePrevious();
              else treeBlankTarget.onCollapseAll();
              onClose();
            }}
          />
        </>
      )}

      {treeTarget && (
        <>
          <MenuDivider />
          <MenuSectionLabel>{t("folders.ctx.section_tree")}</MenuSectionLabel>
          <MenuItem
            label={t(treeTarget.expanded ? "folders.ctx.tree_collapse" : "folders.ctx.tree_expand")}
            onClick={() => {
              treeTarget.onToggle();
              onClose();
            }}
            disabled={!treeTarget.hasChildren}
          />
        </>
      )}
      {!treeTarget && !treeBlankTarget && (
        <>
      <MenuDivider />

      {/* ── SIRALAMA: kart siralamasi (secili ✓; tiklama menuyu kapatmaz) ── */}
      <MenuSectionLabel>{t("folders.ctx.section_sort")}</MenuSectionLabel>
      <MenuItem
        label={t("folders.ctx.sort_name")}
        checked={sortBy === "name"}
        onClick={() => onSortBy("name")}
      />
      <MenuItem
        label={t("folders.ctx.sort_fileCount")}
        checked={sortBy === "fileCount"}
        onClick={() => onSortBy("fileCount")}
      />
      <MenuItem
        label={t("folders.ctx.sort_lastScan")}
        checked={sortBy === "lastScan"}
        onClick={() => onSortBy("lastScan")}
      />
      <MenuDivider subtle />
      <MenuItem
        label={t("folders.ctx.order_asc")}
        checked={sortOrder === "asc"}
        onClick={() => onSortOrder("asc")}
      />
      <MenuItem
        label={t("folders.ctx.order_desc")}
        checked={sortOrder === "desc"}
        onClick={() => onSortOrder("desc")}
      />
        </>
      )}

      {!treeBlankTarget && <MenuDivider />}

      {/* ── Yeniden Tara (artimsal ingest; admin) ── */}
      {!treeBlankTarget && (
        <>
      <MenuItem
        label={t("folders.ctx.rescan")}
        onClick={onRescan}
        disabled={!isAdmin || analysisRunning}
        disabledHint={gateHint(viewerHint)}
      />

      <MenuDivider />

      {/* ── Klasor eylemleri (baslik = yol) ── */}
      {/* Yol her zaman LTR okunur (Windows/POSIX), RTL dilde de bozulmasin */}
      <p dir="ltr" title={path} className="truncate px-3 py-1 text-[11px] text-text-muted">
        {path}
      </p>
      <MenuItem label={t("folders.ctx.open")} onClick={onOpen} />
      <MenuItem
        label={t("organize.action")}
        onClick={onOrganize}
        disabled={!isAdmin || analysisRunning}
        disabledHint={gateHint(viewerHint)}
      />
      <MenuItem
        label={t("reindex.action")}
        onClick={onReindex}
        disabled={!isAdmin || analysisRunning}
        disabledHint={gateHint(viewerHint)}
      />
      <MenuItem
        label={t("folders.ctx.trash")}
        onClick={onTrash}
        disabled={!isAdmin}
        disabledHint={viewerHint}
        danger
      />
        </>
      )}
    </ContextMenu>
  );
}

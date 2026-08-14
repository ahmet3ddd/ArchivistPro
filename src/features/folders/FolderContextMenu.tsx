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

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
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

const MENU_W = 248; // tahmini menu genisligi (kenardan tasmayi onlemek icin)
const MENU_H = 560; // tahmini menu yuksekligi (4 bolum; alt kenar sikismasi engelleme)

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
  const ref = useRef<HTMLDivElement>(null);

  // Disari-tik + Esc → kapat. capture: VirtuosoGrid scroll'una karismadan yakalar (AssetContextMenu ile ayni).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Kaydirma baslayinca menuyu kapat (acik menu kaydirilan icerikten ayrilmasin).
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Kenardan tasmayi onle: imlec sag/alt kenara yakinsa menuyu ice kaydir (kucuk pencerede >=8).
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  // Bos agac menusu cok daha kisa; kart/dugum menusu yuksekligiyle hesaplanirsa imlecten gereksiz
  // uzaklasir. Her varyanti kendi yaklasik boyuyla kenara sigdir.
  const menuH = treeBlankTarget ? 96 : treeTarget ? 420 : MENU_H;
  const top = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));

  const viewerHint = t("context.viewer_hint");

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left, top, width: MENU_W }}
      className="z-50 overflow-hidden rounded-md border border-border bg-bg-secondary/95 py-1 text-sm text-text-primary shadow-xl backdrop-blur-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── GORUNUM: o klasoru secili gorunumde ac (checkmark YOK — aksiyon) ── */}
      {!treeBlankTarget && (
        <>
          <SectionLabel>{t("folders.ctx.section_view")}</SectionLabel>
          <MenuItem label={t("folders.ctx.view_explorer")} onClick={() => onView("explorer")} />
          <MenuItem label={t("folders.ctx.view_technical")} onClick={() => onView("technical")} />
          <MenuItem label={t("folders.ctx.view_dashboard")} onClick={() => onView("dashboard")} />
        </>
      )}

      {treeBlankTarget && (
        <>
          <SectionLabel>{t("folders.ctx.section_tree")}</SectionLabel>
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
          <Divider />
          <SectionLabel>{t("folders.ctx.section_tree")}</SectionLabel>
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
      <Divider />

      {/* ── SIRALAMA: kart siralamasi (secili ✓; tiklama menuyu kapatmaz) ── */}
      <SectionLabel>{t("folders.ctx.section_sort")}</SectionLabel>
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
      <Divider subtle />
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

      {!treeBlankTarget && <Divider />}

      {/* ── Yeniden Tara (artimsal ingest; admin) ── */}
      {!treeBlankTarget && (
        <>
      <MenuItem
        label={t("folders.ctx.rescan")}
        onClick={onRescan}
        disabled={!isAdmin}
        disabledHint={viewerHint}
      />

      <Divider />

      {/* ── Klasor eylemleri (baslik = yol) ── */}
      {/* Yol her zaman LTR okunur (Windows/POSIX), RTL dilde de bozulmasin */}
      <p dir="ltr" title={path} className="truncate px-3 py-1 text-[11px] text-text-muted">
        {path}
      </p>
      <MenuItem label={t("folders.ctx.open")} onClick={onOpen} />
      <MenuItem
        label={t("organize.action")}
        onClick={onOrganize}
        disabled={!isAdmin}
        disabledHint={viewerHint}
      />
      <MenuItem
        label={t("reindex.action")}
        onClick={onReindex}
        disabled={!isAdmin}
        disabledHint={viewerHint}
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
    </div>
  );
}

/** Bolum basligi (GORUNUM / SIRALAMA) — kucuk, buyuk-harf, pasif. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </p>
  );
}

/** Ayirici — `subtle` (olcut↔yon arasi) daha ince/ic-girintili. */
function Divider({ subtle }: { subtle?: boolean }) {
  return subtle ? (
    <div className="mx-3 my-1 border-t border-border/60" />
  ) : (
    <div className="my-1 border-t border-border" />
  );
}

interface ItemProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledHint?: string;
  danger?: boolean;
  /** Tanimliysa siralama ogesi → sol tarafta ✓ yuvasi ayrilir (true ise isaret gorunur). */
  checked?: boolean;
}

function MenuItem({ label, onClick, disabled, disabledHint, danger, checked }: ItemProps) {
  const showCheckSlot = checked !== undefined;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledHint : undefined}
      aria-disabled={disabled}
      className={`flex w-full items-center px-3 py-1.5 text-start transition-colors ${
        disabled
          ? "cursor-not-allowed text-text-muted"
          : danger
            ? "text-danger hover:bg-danger/15"
            : "text-text-primary hover:bg-bg-tertiary"
      }`}
    >
      {showCheckSlot && (
        <span aria-hidden className="me-2 w-3.5 flex-none text-accent">
          {checked ? "✓" : ""}
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

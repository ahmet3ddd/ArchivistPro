// Explorer bos alan baglam menusu. H2 BlankContextMenu paritesi:
// gorunum, kart boyutu, secim, siralama ve indeksleme girisi.
//
// Asset kartinin kendi menusu ayri kalir. Bu menu yalniz Grid govdesindeki bos bir
// alana sag-tiklaninca acilir; uzak arsivde yerel indeksleme girisi gizlenir.

import { useTranslation } from "react-i18next";

import { ContextMenu, MenuDivider, MenuItem, MenuSectionLabel } from "../../components/ContextMenu";
import type { AssetSort } from "../../ipc/client";
import { useIngestWriteLock } from "../../hooks/useIngestLock";
import { useVisionRunState } from "../../hooks/useVisionLock";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { MENU_VIEW_MODES } from "../shell/viewModes";

interface Props {
  assetIds: number[];
  x: number;
  y: number;
  onClose: () => void;
}

const MENU_W = 224;

const CARD_SIZES = [
  { value: 140, labelKey: "blank_menu.card_small" },
  { value: 220, labelKey: "blank_menu.card_medium" },
  { value: 320, labelKey: "blank_menu.card_large" },
] as const;

const SORTS: AssetSort[] = [
  "modified_desc",
  "modified_asc",
  "name_asc",
  "size_desc",
  "created_desc",
];

export function BlankContextMenu({ assetIds, x, y, onClose }: Props) {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const cardSize = useUiStore((s) => s.cardSize);
  const setCardSize = useUiStore((s) => s.setCardSize);
  const sort = useUiStore((s) => s.sort);
  const setSort = useUiStore((s) => s.setSort);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const setSelectedMany = useUiStore((s) => s.setSelectedMany);
  const clearSelected = useUiStore((s) => s.clearSelected);
  const openIngest = useUiStore((s) => s.openIngest);
  // Uzak arsiv **veya** kosan tarama → yazan girisler (indeksle vb.) kapali: tarama
  // arka plana alinabildigi icin bu menu kosu sirasinda acilabilir.
  const remote = useUiStore((s) => s.assetSource === "remote");
  // ⚠️ Hook KOSULSUZ (kisa-devre hook'u atlardi → hook sirasi bozulur).
  const scanning = useIngestWriteLock();
  const analysisRunning = useVisionRunState().active;
  const remoteMode = remote || scanning;

  const run = (action: () => void) => {
    onClose();
    action();
  };
  const nearestCardSize = CARD_SIZES.reduce((closest, candidate) =>
    Math.abs(candidate.value - cardSize) < Math.abs(closest.value - cardSize)
      ? candidate
      : closest,
  );
  const viewerHint = t("context.viewer_hint");

  return (
    <ContextMenu
      x={x}
      y={y}
      width={MENU_W}
      onClose={onClose}
      testId="blank-context-menu"
      ariaLabel={t("blank_menu.aria_label")}
    >
      <MenuSectionLabel>{t("blank_menu.section_view")}</MenuSectionLabel>
      {MENU_VIEW_MODES.map(({ mode, labelKey }) => (
        <MenuItem
          key={mode}
          label={t(labelKey)}
          checked={viewMode === mode}
          onClick={() => run(() => setViewMode(mode))}
        />
      ))}

      <MenuDivider />

      <MenuSectionLabel>{t("blank_menu.section_card_size")}</MenuSectionLabel>
      {CARD_SIZES.map(({ value, labelKey }) => (
        <MenuItem
          key={value}
          label={t(labelKey)}
          checked={nearestCardSize.value === value}
          onClick={() => run(() => setCardSize(value))}
        />
      ))}

      <MenuDivider />

      <MenuSectionLabel>{t("blank_menu.section_selection")}</MenuSectionLabel>
      <MenuItem
        label={t("shortcuts.select_all")}
        testId="blank-context-select-all"
        onClick={() => run(() => setSelectedMany(assetIds))}
      />
      {selectedIds.length > 0 && (
        <MenuItem
          label={t("blank_menu.clear_selection", { count: selectedIds.length })}
          testId="blank-context-clear-selection"
          onClick={() => run(clearSelected)}
        />
      )}

      <MenuDivider />

      <MenuSectionLabel>{t("sort.label")}</MenuSectionLabel>
      {SORTS.map((value) => (
        <MenuItem
          key={value}
          label={t("sort." + value)}
          checked={sort === value}
          onClick={() => run(() => setSort(value))}
        />
      ))}

      {!remoteMode && (
        <>
          <MenuDivider />
          {/* Klasor tarama analiz kosarken KILITLI: `ingest_folders` yazma kilidini tum kosu
              boyunca tutar (STATUS B2) → analiz donardi. Ayni kapi sol Arsiv panelinde de var
              (`MaintenanceGate`); ayni cumleyi gosterir. */}
          <MenuItem
            label={t("ingest.button")}
            testId="blank-context-index"
            disabled={!isAdmin || analysisRunning}
            disabledHint={
              !isAdmin ? viewerHint : analysisRunning ? t("vision_index.maintenance_locked") : undefined
            }
            onClick={() => run(() => openIngest(null))}
          />
        </>
      )}
    </ContextMenu>
  );
}

// Explorer bos alan baglam menusu. H2 BlankContextMenu paritesi:
// gorunum, kart boyutu, secim, siralama ve indeksleme girisi.
//
// Asset kartinin kendi menusu ayri kalir. Bu menu yalniz Grid govdesindeki bos bir
// alana sag-tiklaninca acilir; uzak arsivde yerel indeksleme girisi gizlenir.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetSort } from "../../ipc/client";
import { useIngestWriteLock } from "../../hooks/useIngestLock";
import { useSession } from "../../hooks/useSession";
import { useUiStore, type ViewMode } from "../../store/useUiStore";

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

const VIEW_MODES: { mode: ViewMode; labelKey: string }[] = [
  { mode: "explorer", labelKey: "view.explorer" },
  { mode: "technical", labelKey: "view.technical" },
  { mode: "dashboard", labelKey: "view.dashboard" },
];

export function BlankContextMenu({ assetIds, x, y, onClose }: Props) {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
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
  const remoteMode = remote || scanning;

  // Gercek boyutu render sonrasi olc: pencere kenarinda menu her zaman gorunur kalsin.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = {
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    };
    if (next.x !== position.x || next.y !== position.y) setPosition(next);
  }, [x, y, position.x, position.y]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

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
    <div
      ref={ref}
      role="menu"
      data-context-menu
      data-testid="blank-context-menu"
      style={{ position: "fixed", left: position.x, top: position.y, width: MENU_W }}
      className="z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-border bg-bg-secondary/95 py-1 text-sm text-text-primary shadow-xl backdrop-blur-lg"
      onContextMenu={(event) => event.preventDefault()}
    >
      <SectionLabel>{t("blank_menu.section_view")}</SectionLabel>
      {VIEW_MODES.map(({ mode, labelKey }) => (
        <MenuItem
          key={mode}
          label={t(labelKey)}
          checked={viewMode === mode}
          onClick={() => run(() => setViewMode(mode))}
        />
      ))}

      <Divider />

      <SectionLabel>{t("blank_menu.section_card_size")}</SectionLabel>
      {CARD_SIZES.map(({ value, labelKey }) => (
        <MenuItem
          key={value}
          label={t(labelKey)}
          checked={nearestCardSize.value === value}
          onClick={() => run(() => setCardSize(value))}
        />
      ))}

      <Divider />

      <SectionLabel>{t("blank_menu.section_selection")}</SectionLabel>
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

      <Divider />

      <SectionLabel>{t("sort.label")}</SectionLabel>
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
          <Divider />
          <MenuItem
            label={t("ingest.button")}
            testId="blank-context-index"
            disabled={!isAdmin}
            disabledHint={viewerHint}
            onClick={() => run(() => openIngest(null))}
          />
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-1 border-t border-border" />;
}

interface ItemProps {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  testId?: string;
  onClick: () => void;
}

function MenuItem({ label, checked, disabled, disabledHint, testId, onClick }: ItemProps) {
  const showCheck = checked !== undefined;
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={
        "flex w-full items-center px-3 py-1.5 text-start transition-colors " +
        (disabled
          ? "cursor-not-allowed text-text-muted"
          : "text-text-primary hover:bg-bg-tertiary")
      }
    >
      {showCheck && (
        <span aria-hidden className="me-2 w-3.5 flex-none text-accent">
          {checked ? "✓" : ""}
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

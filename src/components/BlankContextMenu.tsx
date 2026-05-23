import { useRef, useLayoutEffect, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, LayoutGrid, List, BarChart2, ScanSearch } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { SortBy, SortOrder, ViewMode } from '../types';

interface BlankContextMenuProps {
  x: number;
  y: number;
  assetIds: string[];
  onClose: () => void;
  rescanFolderPath?: string;
  onRescanFolder?: (path: string) => void;
}

function MenuItem({ label, icon, onClick, checked, danger }: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  checked?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 12px', border: 'none', borderRadius: 4,
        background: 'transparent', cursor: 'pointer',
        color: danger ? '#f38ba8' : 'var(--color-text-primary)',
        fontSize: '0.78rem', textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ width: 14, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {checked ? <Check size={13} color="var(--color-accent)" /> : (icon ?? null)}
      </span>
      {label}
    </button>
  );
}

function Separator() {
  return <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 8px' }} />;
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      padding: '4px 12px 2px',
      fontSize: '0.68rem',
      color: 'var(--color-text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      userSelect: 'none',
    }}>
      {label}
    </div>
  );
}

export default function BlankContextMenu({ x, y, assetIds, onClose, rescanFolderPath, onRescanFolder }: BlankContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const cardSize = useStore(s => s.cardSize);
  const setCardSize = useStore(s => s.setCardSize);
  const sortBy = useStore(s => s.sortBy);
  const setSortBy = useStore(s => s.setSortBy);
  const sortOrder = useStore(s => s.sortOrder);
  const setSortOrder = useStore(s => s.setSortOrder);
  const selectedAssetIds = useStore(s => s.selectedAssetIds);
  const selectAllAssets = useStore(s => s.selectAllAssets);
  const clearAssetSelection = useStore(s => s.clearAssetSelection);
  const setIsScanModalOpen = useStore(s => s.setIsScanModalOpen);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x, ny = y;
    if (x + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-context-menu]')) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const handle = (fn: () => void) => () => { onClose(); fn(); };

  const VIEW_MODES: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'explorer', label: t('blankMenu.view.explorer'), icon: <LayoutGrid size={13} /> },
    { mode: 'technical', label: t('blankMenu.view.technical'), icon: <List size={13} /> },
    { mode: 'dashboard', label: t('blankMenu.view.dashboard'), icon: <BarChart2 size={13} /> },
  ];

  const CARD_SIZES: { label: string; value: number }[] = [
    { label: t('blankMenu.cardSize.small'), value: 140 },
    { label: t('blankMenu.cardSize.medium'), value: 220 },
    { label: t('blankMenu.cardSize.large'), value: 320 },
  ];

  const SORT_FIELDS: { key: SortBy; label: string }[] = [
    { key: 'name', label: t('blankMenu.sort.name') },
    { key: 'date', label: t('blankMenu.sort.date') },
    { key: 'type', label: t('blankMenu.sort.type') },
    { key: 'size', label: t('blankMenu.sort.size') },
    { key: 'aiScore', label: t('blankMenu.sort.aiScore') },
  ];

  const SORT_ORDERS: { key: SortOrder; label: string }[] = [
    { key: 'asc', label: t('blankMenu.sort.asc') },
    { key: 'desc', label: t('blankMenu.sort.desc') },
  ];

  // Card size'ı 3 kademeden hangisine en yakın?
  const nearestCardSize = CARD_SIZES.reduce((prev, cur) =>
    Math.abs(cur.value - cardSize) < Math.abs(prev.value - cardSize) ? cur : prev
  );

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 10000,
        minWidth: 210,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '4px 0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}
    >
      {/* Görünüm */}
      <SectionLabel label={t('blankMenu.section.view')} />
      {VIEW_MODES.map(({ mode, label, icon }) => (
        <MenuItem
          key={mode}
          label={label}
          icon={icon}
          checked={viewMode === mode}
          onClick={handle(() => setViewMode(mode))}
        />
      ))}

      {/* Kart boyutu — sadece explorer modunda anlamlı */}
      {viewMode === 'explorer' && (
        <>
          <Separator />
          <SectionLabel label={t('blankMenu.section.cardSize')} />
          {CARD_SIZES.map(({ label, value }) => (
            <MenuItem
              key={value}
              label={label}
              checked={nearestCardSize.value === value}
              onClick={handle(() => setCardSize(value))}
            />
          ))}
        </>
      )}

      {/* Seçim */}
      <Separator />
      <SectionLabel label={t('blankMenu.section.selection')} />
      <MenuItem
        label={t('blankMenu.selection.selectAll')}
        onClick={handle(() => selectAllAssets(assetIds))}
      />
      {selectedAssetIds.length > 0 && (
        <MenuItem
          label={t('blankMenu.selection.clearSelection', { count: selectedAssetIds.length })}
          onClick={handle(() => clearAssetSelection())}
        />
      )}

      {/* Sıralama */}
      <Separator />
      <SectionLabel label={t('blankMenu.section.sort')} />
      {SORT_FIELDS.map(({ key, label }) => (
        <MenuItem
          key={key}
          label={label}
          checked={sortBy === key}
          onClick={handle(() => setSortBy(key))}
        />
      ))}
      <div style={{ height: 4 }} />
      {SORT_ORDERS.map(({ key, label }) => (
        <MenuItem
          key={key}
          label={label}
          checked={sortOrder === key}
          onClick={handle(() => setSortOrder(key))}
        />
      ))}

      {/* Tara */}
      <Separator />
      <MenuItem
        label={t('blankMenu.rescan')}
        icon={<ScanSearch size={13} />}
        onClick={handle(() => {
          if (rescanFolderPath && onRescanFolder) {
            onRescanFolder(rescanFolderPath);
          } else {
            setIsScanModalOpen(true);
          }
        })}
      />
    </div>,
    document.body,
  );
}

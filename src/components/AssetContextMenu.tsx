import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FolderOpen, Copy, Star, Tag, Trash2, RefreshCw, GitCompare, SquareCheck, FileOutput, ShieldOff, Shield } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openShell } from '@tauri-apps/plugin-shell';
import type { Asset } from '../types';
import { useStore } from '../store/useStore';
import { addFavorite, removeFavorite, isFavorite } from '../services/favorites';
import { notifyError, notifySuccess } from '../services/notificationCenter';
import { writeXmpSidecar } from '../services/xmpSidecar';
import { setAssetRagExcluded } from '../services/database';
import { hasAdminFeatures } from '../services/buildFeatures';
import { useIsAdmin } from '../permissions';
import i18n from '../i18n';

interface AssetContextMenuProps {
  x: number;
  y: number;
  asset: Asset;
  onClose: () => void;
}

/* ── Internal sub-components ─────────────────────────────── */

function ContextMenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '7px 12px', border: 'none', borderRadius: 4,
        background: 'transparent', cursor: 'pointer',
        color: danger ? '#f38ba8' : 'var(--color-text-primary)',
        fontSize: '0.78rem', textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(243,139,168,0.12)' : 'rgba(255,255,255,0.07)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
      {label}
    </button>
  );
}

function MenuSeparator() {
  return <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 8px' }} />;
}

/* ── Main component ──────────────────────────────────────── */

export default function AssetContextMenu({ x, y, asset, onClose }: AssetContextMenuProps) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Viewport clamping
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  const isFav = isFavorite(asset.id);

  // ── Actions ─────────────────────────────────────────

  const handleOpen = useCallback(async () => {
    onClose();
    try {
      await invoke('open_file_native', { path: asset.filePath });
    } catch {
      try { await openShell(asset.filePath); } catch (err) {
        notifyError(i18n.t('detail.error.openFileFailed', { error: err }));
      }
    }
  }, [asset.filePath, onClose]);

  const handleShowInFolder = useCallback(async () => {
    onClose();
    try {
      await invoke('show_in_folder', { path: asset.filePath });
    } catch (err) {
      notifyError(i18n.t('detail.error.openFolderFailed', { error: err }));
    }
  }, [asset.filePath, onClose]);

  const handleCopyPath = useCallback(async () => {
    onClose();
    try {
      await navigator.clipboard.writeText(asset.filePath);
      notifySuccess(t('contextMenu.pathCopied'));
    } catch {
      notifyError(i18n.t('detail.error.copyPathFailed'));
    }
  }, [asset.filePath, onClose, t]);

  const handleToggleFavorite = useCallback(() => {
    onClose();
    const next = !isFav;
    if (next) addFavorite(asset.id); else removeFavorite(asset.id);
    useStore.getState().toggleFavoriteId(asset.id, next);
  }, [asset.id, isFav, onClose]);

  const handleToggleRagExcluded = useCallback(() => {
    onClose();
    const next = !asset.ragExcluded;
    setAssetRagExcluded(asset.id, next);
    // Store'daki asset'i güncelle
    const assets = useStore.getState().scannedAssets.map(a =>
      a.id === asset.id ? { ...a, ragExcluded: next } : a
    );
    useStore.getState().setScannedAssets(assets);
    const label = next ? t('contextMenu.ragExclude') : t('contextMenu.ragInclude');
    useStore.getState().addToast(label + ': ' + asset.fileName, 'info');
  }, [asset.id, asset.ragExcluded, asset.fileName, onClose, t]);

  const handleAddTags = useCallback(() => {
    onClose();
    useStore.getState().setSelectedAssetId(asset.id);
  }, [asset.id, onClose]);

  const handleRescan = useCallback(async () => {
    onClose();
    const { addRescanningAsset, removeRescanningAsset } = useStore.getState();
    addRescanningAsset(asset.id);
    try {
      const { scanDirectory, ScanController } = await import('../services/fileScanner');
      const aiConfig = useStore.getState().aiConfig;
      const controller = new ScanController();
      const results = await scanDirectory(
        () => {},
        true,
        controller,
        false,
        aiConfig,
        [asset.filePath],
        new Set([asset.filePath]),
      );
      if (results.length > 0) {
        useStore.getState().setScannedAssets((prev) => {
          const merged = new Map(prev.map((a) => [a.id, a]));
          results.forEach((a) => merged.set(a.id, a));
          return Array.from(merged.values());
        });
        notifySuccess(i18n.t('contextMenu.rescan.done'), asset.fileName);
      } else {
        notifyError(i18n.t('contextMenu.rescan.failed'), asset.fileName);
      }
    } catch (err) {
      notifyError(i18n.t('contextMenu.rescan.failed'), String(err));
    } finally {
      removeRescanningAsset(asset.id);
    }
  }, [asset, onClose]);

  const handleFindSimilar = useCallback((threshold: number) => {
    onClose();
    useStore.getState().setDuplicateFinderOpen(true, asset.id, threshold);
  }, [asset.id, onClose]);

  const isInSelection = useStore.getState().selectedAssetIds.includes(asset.id);
  const handleToggleSelection = useCallback(() => {
    onClose();
    useStore.getState().toggleAssetSelection(asset.id);
  }, [asset.id, onClose]);

  const handleDelete = useCallback(() => {
    onClose();
    useStore.getState().showConfirmDialog(
      i18n.t('deletion.confirmTitle', { fileName: asset.fileName }),
      i18n.t('deletion.confirmBody'),
      async () => {
        const { executeCommand } = await import('../services/undoRedo');
        const { softDeleteAsset, restoreAsset } = await import('../services/database');
        const { notifySuccess: ns } = await import('../services/notificationCenter');
        await executeCommand({
          type: 'DELETE_ASSET',
          label: i18n.t('deletion.label', { fileName: asset.fileName }),
          execute: () => {
            softDeleteAsset(asset.id);
            useStore.getState().setScannedAssets((prev) => prev.filter(a => a.id !== asset.id));
            useStore.getState().setSelectedAssetId(null);
            ns(i18n.t('deletion.removed'), i18n.t('deletion.removedUndo', { fileName: asset.fileName }));
          },
          undo: async () => {
            restoreAsset(asset.id);
            useStore.getState().setScannedAssets((prev) => [...prev, asset]);
            const { notifySuccess: ns2 } = await import('../services/notificationCenter');
            ns2(i18n.t('deletion.undone'), i18n.t('deletion.undoneDetail', { fileName: asset.fileName }));
          },
        });
      },
      undefined,
      true,
    );
  }, [asset, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 10000,
        minWidth: 200,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '4px 0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}
    >
      <ContextMenuItem icon={<ExternalLink size={14} />} label={t('contextMenu.openFile')} onClick={handleOpen} />
      <ContextMenuItem icon={<FolderOpen size={14} />} label={t('contextMenu.showInFolder')} onClick={handleShowInFolder} />
      <ContextMenuItem icon={<Copy size={14} />} label={t('contextMenu.copyPath')} onClick={handleCopyPath} />
      <MenuSeparator />
      <ContextMenuItem
        icon={<Star size={14} fill={isFav ? '#f59e0b' : 'none'} color={isFav ? '#f59e0b' : 'currentColor'} />}
        label={isFav ? t('contextMenu.removeFromFavorites') : t('contextMenu.addToFavorites')}
        onClick={handleToggleFavorite}
      />
      <ContextMenuItem icon={<Tag size={14} />} label={t('contextMenu.addTags')} onClick={handleAddTags} />
      {isAdmin && (
        <ContextMenuItem
          icon={asset.ragExcluded ? <Shield size={14} /> : <ShieldOff size={14} />}
          label={asset.ragExcluded ? t('contextMenu.ragInclude') : t('contextMenu.ragExclude')}
          onClick={handleToggleRagExcluded}
        />
      )}
      <MenuSeparator />
      <ContextMenuItem
        icon={<SquareCheck size={14} />}
        label={isInSelection ? t('contextMenu.removeFromSelection') : t('contextMenu.addToSelection')}
        onClick={handleToggleSelection}
      />
      <ContextMenuItem icon={<RefreshCw size={14} />} label={t('contextMenu.rescan.label')} onClick={handleRescan} />
      {hasAdminFeatures() && (
        <ContextMenuItem icon={<FileOutput size={14} />} label={t('xmp.contextMenu')} onClick={async () => {
          onClose();
          try {
            await writeXmpSidecar(asset);
            notifySuccess(i18n.t('xmp.exportSuccess', { file: asset.fileName + '.xmp' }));
          } catch (err) {
            notifyError(i18n.t('xmp.exportError'), err instanceof Error ? err.message : String(err));
          }
        }} />
      )}
      {/* DWG Composite Benzerlik Araması */}
      {(asset.fileType === 'DWG' || asset.fileType === 'DXF') && (
        <ContextMenuItem
          icon={<GitCompare size={14} />}
          label={t('contextMenu.dwgSimilarity')}
          onClick={() => { onClose(); useStore.getState().setDwgSimilarityAssetId(asset.id); }}
        />
      )}
      {/* Benzerini Bul — 4 eşik seviyesi */}
      <div style={{
        padding: '4px 12px 2px',
        fontSize: '0.7rem',
        color: 'var(--color-text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <GitCompare size={12} />
        {t('contextMenu.findSimilar.title')}
      </div>
      {([
        { threshold: 90, key: 'high' },
        { threshold: 75, key: 'normal' },
        { threshold: 60, key: 'medium' },
        { threshold: 40, key: 'wide' },
      ] as const).map(({ threshold, key }) => (
        <button
          key={key}
          onClick={() => handleFindSimilar(threshold)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '5px 12px 5px 28px',
            border: 'none', borderRadius: 4,
            background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            fontSize: '0.76rem', textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        >
          <span>{t(`contextMenu.findSimilar.${key}`)}</span>
          <span style={{
            fontSize: '0.66rem', padding: '1px 5px', borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--color-text-muted)', marginLeft: 8,
          }}>{threshold}%+</span>
        </button>
      ))}
      <MenuSeparator />
      <ContextMenuItem icon={<Trash2 size={14} />} label={t('contextMenu.delete')} onClick={handleDelete} danger />
    </div>,
    document.body,
  );
}

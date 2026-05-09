/**
 * ArchivistPro — Çöp Kutusu Modal
 *
 * Soft-delete edilen dosyaların listesi.
 * Seçim, geri yükleme, kalıcı silme, çöpü boşaltma işlemleri.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, RotateCcw, Trash, Folder } from 'lucide-react';
import {
    getDeletedAssets,
    restoreAsset,
    permanentlyDeleteAsset,
    emptyTrashDb,
    getDeletedRoots,
    restoreScannedRootFromTrash,
    deleteScannedRootWithAssets,
    type DeletedRoot,
} from '../services/database';
import { notifySuccess } from '../services/notificationCenter';
import { useStore } from '../store/useStore';
import { formatFileSize, getTypeBadgeStyle } from '../data';
import type { TrashItem } from '../types';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrashChanged?: () => void;
}

type Tab = 'files' | 'folders';

export default function TrashModal({ isOpen, onClose, onTrashChanged }: TrashModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('files');
  const [items, setItems] = useState<TrashItem[]>([]);
  const [folders, setFolders] = useState<DeletedRoot[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const showConfirmDialog = useStore((s) => s.showConfirmDialog);

  const loadItems = useCallback(() => {
    setItems(getDeletedAssets());
    setFolders(getDeletedRoots());
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    if (isOpen) { loadItems(); setTab('files'); }
  }, [isOpen, loadItems]);

  if (!isOpen) return null;

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const handleRestore = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const restoredNames: string[] = [];
    for (const id of ids) {
      const item = items.find(i => i.id === id);
      if (restoreAsset(id) && item) restoredNames.push(item.fileName);
    }
    // Refresh the main asset list
    import('../services/database').then(({ getAllAssets }) => {
      useStore.getState().setScannedAssets(getAllAssets());
    });
    if (restoredNames.length === 1) {
      notifySuccess(t('trash.undone'), t('trash.restoredSingle', { fileName: restoredNames[0] }));
    } else {
      notifySuccess(t('trash.undone'), t('trash.restored', { count: restoredNames.length }));
    }
    onTrashChanged?.();
    loadItems();
  };

  const handlePermanentDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    showConfirmDialog(
      t('trash.button.permanentDelete'),
      t('trash.confirmPermanentDelete', { count: ids.length }),
      () => {
        let count = 0;
        for (const id of ids) {
          if (permanentlyDeleteAsset(id)) count++;
        }
        notifySuccess(t('trash.button.permanentDelete'), t('trash.permanentDeleted', { count }));
        onTrashChanged?.();
        loadItems();
      },
      t('trash.button.permanentDelete'),
      true,
    );
  };

  const handleEmptyTrash = () => {
    showConfirmDialog(
      t('trash.button.emptyTrash'),
      t('trash.confirmEmptyTrash'),
      () => {
        const count = emptyTrashDb();
        notifySuccess(t('trash.button.emptyTrash'), t('trash.trashEmptied', { count }));
        onTrashChanged?.();
        loadItems();
      },
      t('trash.button.emptyTrash'),
      true,
    );
  };

  const handleRestoreFolder = (folder: DeletedRoot) => {
    restoreScannedRootFromTrash(folder.id);
    import('../services/database').then(({ getAllAssets, getScannedRoots }) => {
      useStore.getState().setScannedAssets(getAllAssets());
      useStore.getState().setScannedRoots(getScannedRoots());
    });
    notifySuccess(t('trash.undone'), t('trash.folder.restoredSingle', { label: folder.label }));
    onTrashChanged?.();
    loadItems();
  };

  const handlePermanentDeleteFolder = (folder: DeletedRoot) => {
    showConfirmDialog(
      t('trash.button.permanentDelete'),
      t('trash.folder.confirmPermanentDelete', { label: folder.label }),
      () => {
        deleteScannedRootWithAssets(folder.id);
        notifySuccess(t('trash.button.permanentDelete'), t('trash.folder.permanentDeleted', { count: 1 }));
        onTrashChanged?.();
        loadItems();
      },
      t('trash.button.permanentDelete'),
      true,
    );
  };

  const formatDeletedDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="trash-modal-title"
        style={{ width: 680, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={18} style={{ color: 'var(--color-danger)' }} />
            <h2 id="trash-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('trash.title')}</h2>
            {(items.length + folders.length) > 0 && (
              <span style={{
                background: 'var(--color-danger)', color: '#fff', borderRadius: 10,
                padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700,
              }}>
                {items.length + folders.length}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label={t('common.aria.close')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', padding: '0 20px' }}>
          {(['files', 'folders'] as Tab[]).map(t2 => (
            <button key={t2} onClick={() => { setTab(t2); setSelectedIds(new Set()); }}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: tab === t2 ? 600 : 400,
                color: tab === t2 ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderBottom: tab === t2 ? '2px solid var(--color-accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
              {t2 === 'files' ? <Trash size={13} /> : <Folder size={13} />}
              {t2 === 'files' ? t('trash.tab.files') : t('trash.tab.folders')}
              <span style={{
                background: tab === t2 ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                color: tab === t2 ? '#fff' : 'var(--color-text-muted)',
                borderRadius: 8, padding: '0 5px', fontSize: '0.68rem',
              }}>
                {t2 === 'files' ? items.length : folders.length}
              </span>
            </button>
          ))}
        </div>

        {/* Files Tab Toolbar */}
        {tab === 'files' && items.length > 0 && (
          <div style={{
            padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.78rem' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              {allSelected ? t('trash.deselectAll') : t('trash.selectAll')}
            </label>
            <div style={{ flex: 1 }} />
            {selectedIds.size > 0 && (
              <>
                <button className="btn btn-primary" onClick={handleRestore}
                  style={{ padding: '5px 14px', fontSize: '0.76rem', gap: 5 }}>
                  <RotateCcw size={13} />
                  {t('trash.button.restore')} ({selectedIds.size})
                </button>
                <button className="btn btn-ghost" onClick={handlePermanentDelete}
                  style={{ padding: '5px 14px', fontSize: '0.76rem', color: 'var(--color-danger)', gap: 5 }}>
                  <Trash size={13} />
                  {t('trash.button.permanentDelete')} ({selectedIds.size})
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={handleEmptyTrash}
              style={{ padding: '5px 14px', fontSize: '0.76rem', color: 'var(--color-danger)', gap: 5 }}>
              <Trash2 size={13} />
              {t('trash.button.emptyTrash')}
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          {tab === 'files' && (
            items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--color-text-muted)' }}>
                <Trash2 size={40} style={{ opacity: 0.15, marginBottom: 14 }} />
                <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{t('trash.empty.title')}</div>
                <div style={{ fontSize: '0.76rem', marginTop: 6 }}>{t('trash.empty.description')}</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', width: 32 }}></th>
                    <th style={{ padding: '8px 6px', textAlign: 'left' }}>{t('trash.column.fileName')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: 70 }}>{t('trash.column.fileType')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right', width: 80 }}>{t('trash.column.fileSize')}</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: 140 }}>{t('trash.column.deletedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}
                      onClick={() => toggleSelect(item.id)}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        background: selectedIds.has(item.id) ? 'var(--color-accent-glow)' : 'transparent',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!selectedIds.has(item.id)) (e.currentTarget.style.background = 'var(--color-bg-tertiary)'); }}
                      onMouseLeave={e => { if (!selectedIds.has(item.id)) (e.currentTarget.style.background = 'transparent'); }}
                    >
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                          onClick={e => e.stopPropagation()} />
                      </td>
                      <td style={{ padding: '8px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}
                        title={item.filePath}>
                        {item.fileName}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <span style={{
                          ...getTypeBadgeStyle(item.fileType),
                          display: 'inline-block', padding: '1px 8px', borderRadius: 4,
                          fontSize: '0.68rem', fontWeight: 600,
                        }}>
                          {item.fileType}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                        {formatFileSize(item.fileSize)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>
                        {formatDeletedDate(item.deletedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'folders' && (
            folders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--color-text-muted)' }}>
                <Folder size={40} style={{ opacity: 0.15, marginBottom: 14 }} />
                <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{t('trash.folder.emptyTitle')}</div>
                <div style={{ fontSize: '0.76rem', marginTop: 6 }}>{t('trash.folder.emptyDescription')}</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>{t('trash.column.label')}</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left' }}>{t('trash.column.path')}</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: 140 }}>{t('trash.column.deletedAt')}</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: 140 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map(folder => (
                    <tr key={folder.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Folder size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                          {folder.label}
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, color: 'var(--color-text-muted)', fontSize: '0.72rem' }}
                        title={folder.path}>
                        {folder.path}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>
                        {formatDeletedDate(folder.deletedAt)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          <button className="btn btn-primary" onClick={() => handleRestoreFolder(folder)}
                            style={{ padding: '3px 10px', fontSize: '0.72rem', gap: 4 }}>
                            <RotateCcw size={11} />
                            {t('trash.button.restore')}
                          </button>
                          <button className="btn btn-ghost" onClick={() => handlePermanentDeleteFolder(folder)}
                            style={{ padding: '3px 10px', fontSize: '0.72rem', color: 'var(--color-danger)', gap: 4 }}>
                            <Trash size={11} />
                            {t('trash.button.permanentDelete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--color-border)',
          fontSize: '0.7rem', color: 'var(--color-text-muted)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{t('trash.footer.note')}</span>
          {tab === 'files' && items.length > 0 && (
            <span>{t('trash.footer.count', { count: items.length })}</span>
          )}
          {tab === 'folders' && folders.length > 0 && (
            <span>{t('trash.folder.footerCount', { count: folders.length })}</span>
          )}
        </div>
      </div>
    </div>
  );
}

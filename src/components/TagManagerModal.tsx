/**
 * Archivist Pro — Etiket Yönetim Paneli
 *
 * Admin için merkezi tag yönetimi: listeleme, yeniden adlandırma,
 * renk değiştirme, silme, birleştirme (merge).
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Tag as TagIcon, Pencil, Trash2, GitMerge, Check, XCircle } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getAllTags, renameTag, updateTagColor, getTagCounts, mergeTags, type Tag } from '../services/tagService';
import { commandDeleteTag } from '../services/undoCommands';
import { useStore } from '../store/useStore';

interface TagManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TagWithCount extends Tag {
  assetCount: number;
}

export default function TagManagerModal({ isOpen, onClose }: TagManagerModalProps) {
  const { t } = useTranslation();
  const modalRef = useFocusTrap(isOpen, onClose);

  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  const loadTags = useCallback(() => {
    const allTags = getAllTags();
    const counts = getTagCounts();
    const countMap = new Map(counts.map(c => [c.tagId, c.count]));
    setTags(allTags.map(tag => ({
      ...tag,
      assetCount: countMap.get(tag.id) ?? 0,
    })));
  }, []);

  /** Tag değişikliklerini (rename/color/delete/merge) store'a yansıt */
  const syncTagsToStore = useCallback(() => {
    const freshTags = getAllTags();
    const tagMap = new Map(freshTags.map(tg => [tg.id, tg]));
    useStore.getState().setScannedAssets((prev) =>
      prev.map(a => ({
        ...a,
        userTags: (a.userTags ?? [])
          .map(ut => {
            const fresh = tagMap.get(ut.id);
            return fresh ? { id: fresh.id, name: fresh.name, color: fresh.color } : null;
          })
          .filter((x): x is { id: number; name: string; color: string } => x !== null),
      }))
    );
  }, []);

  useEffect(() => {
    if (isOpen) loadTags();
  }, [isOpen, loadTags]);

  if (!isOpen) return null;

  const handleRename = (tagId: number) => {
    if (!editName.trim()) return;
    const ok = renameTag(tagId, editName.trim());
    if (ok) {
      loadTags();
      syncTagsToStore();
    }
    setEditingId(null);
    setEditName('');
  };

  const handleColorChange = (tagId: number, color: string) => {
    updateTagColor(tagId, color);
    loadTags();
    syncTagsToStore();
  };

  const handleDelete = (tagId: number) => {
    const tag = tags.find(t => t.id === tagId);
    if (!tag) return;
    useStore.getState().showConfirmDialog(
      t('tagManager.confirmDelete', { name: tag.name }),
      undefined,
      () => {
        void commandDeleteTag(tagId, tag.name, () => { loadTags(); syncTagsToStore(); });
      },
      undefined,
      true,
    );
  };

  const handleMerge = () => {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) return;
    const source = tags.find(t => t.id === mergeSourceId);
    const target = tags.find(t => t.id === mergeTargetId);
    if (!source || !target) return;
    useStore.getState().showConfirmDialog(
      t('tagManager.confirmMerge', { source: source.name, target: target.name }),
      undefined,
      () => {
        mergeTags(mergeSourceId!, mergeTargetId!);
        setMergeSourceId(null);
        setMergeTargetId(null);
        loadTags();
        syncTagsToStore();
        useStore.getState().addToast(t('tagManager.merged'), 'success');
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-manager-title"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 20px)',
          width: 'min(92vw, 560px)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TagIcon size={18} style={{ color: 'var(--color-accent)' }} />
            <span id="tag-manager-title" style={{ fontSize: '0.92rem', fontWeight: 600 }}>
              {t('tagManager.title')}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              ({tags.length})
            </span>
          </div>
          <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Merge bar */}
        {mergeSourceId && (
          <div style={{
            padding: '8px 20px',
            background: 'rgba(99,102,241,0.08)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: '0.76rem',
          }}>
            <GitMerge size={14} style={{ color: 'var(--color-accent)' }} />
            <span>{t('tagManager.mergeHint', { source: tags.find(t => t.id === mergeSourceId)?.name })}</span>
            <button onClick={() => { setMergeSourceId(null); setMergeTargetId(null); }} className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.7rem', marginLeft: 'auto' }}>
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* Tag list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {tags.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
              <TagIcon size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <div>{t('tagManager.empty')}</div>
            </div>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 20px',
                  borderBottom: '1px solid var(--color-border)',
                  background: mergeSourceId === tag.id ? 'rgba(99,102,241,0.06)' : undefined,
                }}
              >
                {/* Renk */}
                <input
                  type="color"
                  value={tag.color}
                  onChange={(e) => handleColorChange(tag.id, e.target.value)}
                  title={t('tagManager.changeColor')}
                  style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0, background: 'none' }}
                />

                {/* Ad (editable) */}
                {editingId === tag.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(tag.id); if (e.key === 'Escape') setEditingId(null); }}
                      style={{
                        flex: 1, padding: '4px 8px', fontSize: '0.8rem', borderRadius: 4,
                        border: '1px solid var(--color-accent)', background: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-primary)', outline: 'none',
                      }}
                    />
                    <button onClick={() => handleRename(tag.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', padding: 2 }}>
                      <Check size={14} />
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2 }}>
                      <XCircle size={14} />
                    </button>
                  </div>
                ) : (
                  <span
                    style={{ flex: 1, fontSize: '0.82rem', cursor: mergeSourceId ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (mergeSourceId && mergeSourceId !== tag.id) {
                        setMergeTargetId(tag.id);
                        handleMerge();
                      }
                    }}
                  >
                    {tag.name}
                  </span>
                )}

                {/* Asset sayısı */}
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', minWidth: 30, textAlign: 'right' }}>
                  {tag.assetCount}
                </span>

                {/* Aksiyonlar */}
                {!mergeSourceId && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={() => { setEditingId(tag.id); setEditName(tag.name); }}
                      title={t('tagManager.rename')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setMergeSourceId(tag.id)}
                      title={t('tagManager.merge')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
                    >
                      <GitMerge size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      title={t('tagManager.delete')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', padding: 4 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

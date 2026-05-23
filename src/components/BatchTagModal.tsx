/**
 * ArchivistPro — BatchTagModal
 *
 * Seçili birden fazla asset'e toplu etiket ekler.
 * Mevcut etiketler listelenir, seçilir ve batchAddTags ile uygulanır.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Plus, Check, X, Loader2, AlertTriangle } from 'lucide-react';
import { getAllTags, getTagsForAsset } from '../services/tagService';
import { commandCreateTag } from '../services/undoCommands';
import type { Tag as TagType } from '../services/tagService';
import { batchAddTags } from '../services/batchActions';
import { notifySuccess } from '../services/notificationCenter';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStore } from '../store/useStore';

interface BatchTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetIds: string[];
}

export default function BatchTagModal({ isOpen, onClose, assetIds }: BatchTagModalProps) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<TagType[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [showNewTag, setShowNewTag] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useFocusTrap(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setTags(getAllTags());
      setSelectedTagIds(new Set());
      setNewTagName('');
      setShowNewTag(false);
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleTag = (id: number) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const created = await commandCreateTag(newTagName.trim(), newTagColor, () => setTags(getAllTags()));
    if (created) {
      setSelectedTagIds(prev => new Set([...prev, created.id]));
      setNewTagName('');
      setShowNewTag(false);
    }
  };

  const handleApply = () => {
    if (selectedTagIds.size === 0) {
      setError(t('batchTagModal.noTagsSelected'));
      return;
    }
    setIsApplying(true);
    setError('');

    const tagIds = Array.from(selectedTagIds);
    const result = batchAddTags(assetIds, tagIds);

    // Store'u güncelle — tüm etkilenen asset'lerin userTags'ını yenile
    const affectedSet = new Set(assetIds);
    useStore.getState().setScannedAssets((prev) =>
      prev.map(a => {
        if (!affectedSet.has(a.id)) return a;
        const fresh = getTagsForAsset(a.id);
        return { ...a, userTags: fresh.map(tg => ({ id: tg.id, name: tg.name, color: tg.color })) };
      })
    );

    notifySuccess(
      t('batchTagModal.successTitle'),
      t('batchTagModal.success', { count: result.success, tagCount: tagIds.length }),
    );

    setIsApplying(false);
    onClose();
  };

  const selectedTagNames = tags
    .filter(t => selectedTagIds.has(t.id))
    .map(t => t.name)
    .join(', ');

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
        style={{
          width: 400, maxHeight: '80vh',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag size={16} style={{ color: 'var(--color-accent)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text-primary)' }}>
                {t('batchTagModal.title')}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 1 }}>
                {t('batchTagModal.subtitle', { count: assetIds.length })}
              </div>
            </div>
          </div>
          {assetIds.length > 50 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', borderRadius: 6,
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600,
              flexShrink: 0,
            }}>
              <AlertTriangle size={12} />
              {assetIds.length.toLocaleString()}
            </div>
          )}
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Çok fazla dosya uyarısı */}
        {assetIds.length > 50 && (
          <div style={{
            padding: '7px 16px',
            background: 'rgba(245,158,11,0.08)',
            borderBottom: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: '0.74rem', color: '#f59e0b',
          }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            {t('batchTagModal.bulkWarning', { count: assetIds.length.toLocaleString() })}
          </div>
        )}

        {/* Tag list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {tags.length === 0 && !showNewTag ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: 20 }}>
              {t('batchTagModal.noTags')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tags.map(tag => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 20,
                      border: `1px solid ${active ? tag.color : 'rgba(255,255,255,0.12)'}`,
                      background: active ? `${tag.color}22` : 'transparent',
                      color: active ? tag.color : 'var(--color-text-secondary)',
                      cursor: 'pointer', fontSize: '0.76rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    {active && <Check size={11} />}
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: tag.color, flexShrink: 0,
                    }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Yeni etiket oluştur */}
          {showNewTag ? (
            <div style={{
              marginTop: 12, padding: 10,
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="color"
                  value={newTagColor}
                  onChange={e => setNewTagColor(e.target.value)}
                  style={{ width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0 }}
                />
                <input
                  autoFocus
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); if (e.key === 'Escape') setShowNewTag(false); }}
                  placeholder={t('batchTagModal.newTagPlaceholder')}
                  style={{
                    flex: 1, background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6, padding: '4px 8px',
                    color: 'var(--color-text-primary)', fontSize: '0.78rem',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '4px 10px', fontSize: '0.74rem' }}
                >
                  {t('batchTagModal.createAndAdd')}
                </button>
                <button
                  onClick={() => setShowNewTag(false)}
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewTag(true)}
              style={{
                marginTop: 10, width: '100%',
                background: 'none', border: '1px dashed var(--color-border)',
                borderRadius: 8, padding: '6px 10px',
                color: 'var(--color-text-muted)', fontSize: '0.75rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <Plus size={13} /> {t('batchTagModal.newTag')}
            </button>
          )}
        </div>

        {/* Preview + Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--color-border)',
        }}>
          {selectedTagNames && (
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              marginBottom: 8, lineHeight: 1.4,
            }}>
              {t('batchTagModal.willAdd')}: <strong style={{ color: 'var(--color-text-secondary)' }}>{selectedTagNames}</strong>
            </div>
          )}

          {error && (
            <div style={{ fontSize: '0.72rem', color: '#ef4444', marginBottom: 6 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              className="btn btn-ghost"
              style={{ flex: 1, padding: '6px 0', fontSize: '0.78rem' }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={isApplying || selectedTagIds.size === 0}
              className="btn btn-primary"
              style={{
                flex: 2, padding: '6px 0', fontSize: '0.78rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: selectedTagIds.size === 0 ? 0.5 : 1,
              }}
            >
              {isApplying ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
              {isApplying ? t('batchTagModal.applying') : t('batchTagModal.apply', { count: selectedTagIds.size })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

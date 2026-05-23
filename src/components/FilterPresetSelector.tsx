import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Plus, Trash2, Check } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function FilterPresetSelector() {
  const { t } = useTranslation();
  const presets = useStore((s) => s.filterPresets);
  const savePreset = useStore((s) => s.saveFilterPreset);
  const loadPreset = useStore((s) => s.loadFilterPreset);
  const deletePreset = useStore((s) => s.deleteFilterPreset);
  const activeFilters = useStore((s) => s.activeFilters);

  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = Object.values(activeFilters).some(v => v && v.length > 0);

  useEffect(() => {
    if (isAdding && inputRef.current) inputRef.current.focus();
  }, [isAdding]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsAdding(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    savePreset(name);
    setNewName('');
    setIsAdding(false);
  };

  const filterSummary = (preset: typeof presets[0]) => {
    const parts: string[] = [];
    for (const [, vals] of Object.entries(preset.activeFilters)) {
      if (vals && vals.length > 0) parts.push(...vals);
    }
    return parts.length > 0 ? parts.slice(0, 3).join(', ') + (parts.length > 3 ? ` +${parts.length - 3}` : '') : '-';
  };

  if (presets.length === 0 && !hasActiveFilters) return null;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-ghost"
        style={{
          width: '100%', justifyContent: 'space-between',
          padding: '6px 10px', fontSize: '0.76rem',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bookmark size={13} />
          {t('filterPreset.label')}
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
          {presets.length > 0 ? presets.length : ''}
        </span>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
          borderRadius: 8, zIndex: 30, maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {/* Preset list */}
          {presets.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 10px', borderBottom: '1px solid var(--color-border)',
              cursor: 'pointer',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <button
                onClick={() => { loadPreset(p.id); setIsOpen(false); }}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', padding: 0, color: 'var(--color-text-primary)',
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {filterSummary(p)}
                </div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}
                title={t('common.delete')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', padding: 4, flexShrink: 0,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {presets.length === 0 && (
            <div style={{
              padding: '12px 10px', fontSize: '0.74rem',
              color: 'var(--color-text-muted)', textAlign: 'center',
            }}>
              {t('filterPreset.empty')}
            </div>
          )}

          {/* Add new preset */}
          {isAdding ? (
            <div style={{ padding: '8px 10px', display: 'flex', gap: 6 }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setIsAdding(false); }}
                placeholder={t('filterPreset.namePlaceholder')}
                style={{
                  flex: 1, padding: '4px 8px', fontSize: '0.78rem',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                }}
              />
              <button
                onClick={handleSave}
                disabled={!newName.trim()}
                className="btn btn-primary"
                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { if (hasActiveFilters) setIsAdding(true); }}
              disabled={!hasActiveFilters}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 10px', background: 'none', border: 'none',
                cursor: hasActiveFilters ? 'pointer' : 'not-allowed',
                color: hasActiveFilters ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontSize: '0.76rem', fontWeight: 600,
                opacity: hasActiveFilters ? 1 : 0.5,
              }}
            >
              <Plus size={13} />
              {t('filterPreset.saveCurrentFilters')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

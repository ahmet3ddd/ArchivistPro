/**
 * ArchivistPro — BatchToolbar
 *
 * Çoklu seçim aktifken ekranda beliren kayan araç çubuğu.
 * Toplu etiket ekleme, tümünü seç ve seçimi temizle.
 */

import { useTranslation } from 'react-i18next';
import { Tag, CheckSquare, X } from 'lucide-react';

interface BatchToolbarProps {
  selectedCount: number;
  totalCount: number;
  onAddTags: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export default function BatchToolbar({
  selectedCount,
  totalCount,
  onAddTags,
  onSelectAll,
  onClearSelection,
}: BatchToolbarProps) {
  const { t } = useTranslation();

  return (
    <div
      role="toolbar"
      aria-label={t('batchToolbar.ariaLabel')}
      style={{
        position: 'fixed',
        bottom: 40, // StatusBar'ın (32px) üzerinde kalır
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 150,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-accent)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(99,102,241,0.25)',
        fontSize: '0.78rem',
        color: 'var(--color-text-primary)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {/* Seçim sayısı */}
      <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
        {t('batchToolbar.selectedCount', { count: selectedCount })}
      </span>

      <div style={{ width: 1, height: 16, background: 'var(--color-border, rgba(255,255,255,0.1))' }} />

      {/* Tümünü Seç */}
      {selectedCount < totalCount && (
        <button
          onClick={onSelectAll}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', borderRadius: 6,
            fontSize: '0.75rem',
          }}
          title={t('batchToolbar.selectAll')}
        >
          <CheckSquare size={13} />
          {t('batchToolbar.selectAll')}
        </button>
      )}

      {/* Etiket Ekle */}
      <button
        onClick={onAddTags}
        className="btn btn-primary"
        style={{
          padding: '4px 12px', fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <Tag size={13} />
        {t('batchToolbar.addTags')}
      </button>

      {/* Seçimi Temizle */}
      <button
        onClick={onClearSelection}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '2px 4px', borderRadius: 6,
          fontSize: '0.75rem',
        }}
        title={t('batchToolbar.clearSelection')}
      >
        <X size={13} />
        {t('batchToolbar.clearSelection')}
      </button>
    </div>
  );
}

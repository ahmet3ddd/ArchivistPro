/**
 * Tarama sonrası arka planda çalışan otomatik RAG indekslemesinin görünür
 * göstergesi. Kullanıcı durdurabilir; aktif değilse render olmaz.
 */

import { useTranslation } from 'react-i18next';
import { Brain, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cancelAutoRagIndexing } from '../services/fileScanner';

export default function AutoRagIndexBanner() {
  const { t } = useTranslation();
  const progress = useStore((s) => s.autoRagIndexProgress);

  if (!progress) return null;

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const fileLabel = progress.currentFile
    ? ` — ${progress.currentFile.length > 48 ? progress.currentFile.slice(0, 45) + '…' : progress.currentFile}`
    : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 16px',
      background: 'rgba(99,102,241,0.06)',
      borderBottom: '1px solid rgba(99,102,241,0.12)',
      fontSize: '0.74rem',
      color: 'var(--color-text-primary)',
    }}>
      <Brain size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
      <span style={{ flexShrink: 0, fontWeight: 500 }}>
        {t('autoRagIndex.progress', { current: progress.current, total: progress.total })}
      </span>
      <div style={{
        width: 100, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.08)', overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'var(--color-accent)', transition: 'width 200ms',
        }} />
      </div>
      <span style={{ flex: 1, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fileLabel}
      </span>
      <button
        onClick={() => { void cancelAutoRagIndexing(); }}
        title={t('autoRagIndex.stop')}
        style={{
          padding: '3px 8px', borderRadius: 4, border: 'none',
          background: 'rgba(239,68,68,0.12)', color: '#ef4444',
          fontSize: '0.7rem', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        <X size={12} /> {t('autoRagIndex.stop')}
      </button>
    </div>
  );
}

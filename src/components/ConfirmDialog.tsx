import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';

export default function ConfirmDialog() {
  const { t } = useTranslation();
  const dialog = useStore((s) => s.confirmDialog);
  const dismiss = useStore((s) => s.dismissConfirmDialog);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog && btnRef.current) btnRef.current.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dialog, dismiss]);

  if (!dialog) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={dismiss}
    >
      <div
        className="glass-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={dialog.message}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(90vw, 400px)', padding: '24px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {dialog.message}
            </div>
            {dialog.detail && (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {dialog.detail}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!dialog.hideCancel && (
            <button className="btn btn-ghost" onClick={dismiss} style={{ padding: '6px 16px', fontSize: '0.78rem' }}>
              {t('common.cancel')}
            </button>
          )}
          <button
            ref={btnRef}
            className="btn btn-primary"
            onClick={() => { dialog.onConfirm(); dismiss(); }}
            style={{ padding: '6px 16px', fontSize: '0.78rem', background: dialog.isDanger === false ? 'var(--color-accent)' : '#dc2626' }}
          >
            {dialog.confirmLabel ?? t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

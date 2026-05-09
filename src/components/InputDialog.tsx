import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';

export default function InputDialog() {
  const { t } = useTranslation();
  const dialog = useStore((s) => s.inputDialog);
  const dismiss = useStore((s) => s.dismissInputDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog) {
      setValue(dialog.defaultValue ?? '');
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      if (e.key === 'Enter') handleConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  if (!dialog) return null;

  function handleConfirm() {
    const trimmed = value.trim();
    if (!trimmed) return;
    dialog!.onConfirm(trimmed);
    dismiss();
  }

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
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(90vw, 360px)', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {dialog.message}
        </div>
        <input
          ref={inputRef}
          className="search-input"
          style={{ width: '100%' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={dismiss} style={{ padding: '6px 16px', fontSize: '0.78rem' }}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={!value.trim()}
            style={{ padding: '6px 16px', fontSize: '0.78rem' }}
          >
            {t('common.ok', 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';

export default function StorageWarningBanner() {
  const { t } = useTranslation();
  const storageWarning = useStore((s) => s.storageWarning);
  const setStorageWarning = useStore((s) => s.setStorageWarning);

  if (!storageWarning) return null;

  return (
    <div
      style={{
        background: 'rgba(245,158,11,0.15)',
        borderBottom: '1px solid rgba(245,158,11,0.4)',
        padding: '8px 16px',
        fontSize: '0.78rem',
        color: '#f59e0b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span>
        {t('storageWarning.message')}
      </span>
      <button
        aria-label={t('storageWarning.aria.dismiss')}
        onClick={() => setStorageWarning(false)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#f59e0b',
          fontSize: '1rem',
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

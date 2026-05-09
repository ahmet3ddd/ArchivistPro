/**
 * Archivist Pro — Session Timeout Uyarı Toast'u
 *
 * Timeout'tan 60 saniye önce gösterilir.
 * Geri sayım + "Süreyi Uzat" butonu içerir.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, RefreshCw } from 'lucide-react';

interface SessionWarningToastProps {
  visible: boolean;
  onExtend: () => void;
  onDismiss: () => void;
  /** Geri sayım 0'a ulaşınca çağrılır — kilit ekranını tetikler. */
  onTimeout: () => void;
}

export default function SessionWarningToast({ visible, onExtend, onDismiss, onTimeout }: SessionWarningToastProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!visible) {
      setRemaining(60);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    setRemaining(60);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          // Geri sayım bitti — kilit ekranını tetikle
          onTimeoutRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  const handleExtend = () => {
    onExtend();
    onDismiss();
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: 'var(--color-bg-card, rgba(10,13,20,0.95))',
        border: '1px solid var(--color-warning)',
        borderRadius: 'var(--radius-md, 12px)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        animation: 'fadeInUp 0.2s ease-out',
        maxWidth: 440,
      }}
    >
      <Clock size={20} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />

      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '0.84rem',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          marginBottom: 2,
        }}>
          {t('sessionWarning.title')}
        </div>
        <div style={{
          fontSize: '0.78rem',
          color: 'var(--color-text-muted)',
        }}>
          {t('sessionWarning.message', { seconds: remaining })}
        </div>
      </div>

      <button
        onClick={handleExtend}
        className="btn btn-primary"
        style={{
          padding: '6px 14px',
          fontSize: '0.78rem',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          flexShrink: 0,
        }}
      >
        <RefreshCw size={13} />
        {t('sessionWarning.extend')}
      </button>
    </div>
  );
}

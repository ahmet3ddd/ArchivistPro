/**
 * Veritabanı yazımı sırasında sağ alt köşede beliren küçük rozet.
 * Donma'yı önleyemiyor ama kullanıcıya "ne için bekliyor" sorusunun cevabını verir.
 */

import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { useDbSaving } from '../hooks/useDbSaving';

export default function DbSavingIndicator() {
  const { t } = useTranslation();
  const saving = useDbSaving();

  if (!saving) return null;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 6,
      background: 'rgba(245,158,11,0.12)',
      border: '1px solid rgba(245,158,11,0.30)',
      color: 'var(--color-warning)',
      fontSize: '0.74rem', fontWeight: 600,
      boxShadow: '0 4px 12px rgba(0,0,0,0.20)',
      pointerEvents: 'none',
    }}>
      <Database size={13} style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />
      <span>{t('dbSaving.label')}</span>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
    </div>
  );
}

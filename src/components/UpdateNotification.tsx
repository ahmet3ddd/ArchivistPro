/**
 * ArchivistPro — Update Notification Banner
 *
 * Yeni surum LAN sunucudan tespit edildiginde gosterilir.
 * "Indir" butonu LAN'daki .exe URL'sini varsayilan tarayicida acar.
 */

import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import type { UpdateState, UpdateActions } from '../hooks/useUpdateChecker';

type Props = UpdateState & UpdateActions;

export default function UpdateNotification(props: Props) {
  const { t } = useTranslation();
  const { status, version, dismissed, openDownload, dismissUpdate } = props;

  if (status !== 'available' || dismissed) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px',
      background: 'rgba(99,102,241,0.08)',
      borderBottom: '1px solid rgba(99,102,241,0.15)',
      fontSize: '0.76rem',
      color: 'var(--color-text-primary)',
    }}>
      <Download size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        {t('updater.available', { version })}
      </span>
      <button
        onClick={openDownload}
        style={{
          padding: '4px 12px', borderRadius: 6, border: 'none',
          background: 'var(--color-accent)', color: '#fff',
          fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer',
        }}
      >
        {t('updater.openDownload')}
      </button>
      <button
        onClick={dismissUpdate}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

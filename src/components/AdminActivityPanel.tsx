/**
 * Archivist Pro — Admin Aktivite Özet Paneli
 *
 * Son 7 günlük audit log verilerini özetler:
 * - Toplam işlem sayısı
 * - En aktif kullanıcılar
 * - En çok yapılan işlem tipleri
 *
 * DashboardView içinde admin olarak gösterilir.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Users, BarChart3 } from 'lucide-react';
import { getAuditLogs, type AuditLogEntry } from '../services/logger';

export default function AdminActivityPanel() {
  const { t } = useTranslation();

  const { totalOps, topUsers, topActions } = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    let logs: AuditLogEntry[];
    try {
      logs = getAuditLogs(500, 0, { dateFrom: cutoff });
    } catch {
      logs = [];
    }

    // Kullanıcı bazlı grupla (role alanı username gibi kullanılıyor)
    const userCounts = new Map<string, number>();
    const actionCounts = new Map<string, number>();

    for (const log of logs) {
      const user = log.role || 'system';
      userCounts.set(user, (userCounts.get(user) || 0) + 1);
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
    }

    const topUsers = [...userCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topActions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return { totalOps: logs.length, topUsers, topActions };
  }, []);

  if (totalOps === 0) return null;

  return (
    <div className="glass-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Activity size={16} style={{ color: 'var(--color-accent)' }} />
        <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>
          {t('dashboard.activity.title')}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          {t('dashboard.activity.totalOps', { count: totalOps })}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* En aktif kullanıcılar */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, fontSize: '0.74rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            <Users size={13} />
            {t('dashboard.activity.topUsers')}
          </div>
          {topUsers.map(([user, count]) => (
            <div key={user} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.74rem' }}>
              <span style={{ color: 'var(--color-text-primary)' }}>{user}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{count}</span>
            </div>
          ))}
        </div>

        {/* En çok yapılan işlemler */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, fontSize: '0.74rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            <BarChart3 size={13} />
            {t('dashboard.activity.topActions')}
          </div>
          {topActions.map(([action, count]) => (
            <div key={action} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.74rem' }}>
              <span style={{ color: 'var(--color-text-primary)', textTransform: 'lowercase' }}>{action.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

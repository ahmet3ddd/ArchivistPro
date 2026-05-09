/**
 * ArchivistPro — StatusBar (Alt Bar)
 *
 * Aktif task ilerleme çubuğu + bildirim merkezi badge + arşiv durumu.
 * TaskRunner ve NotificationCenter servisleriyle entegre.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Bell, Pause, Play, X, CheckCircle, AlertTriangle, XCircle, Info, Archive, Shield, Eye, LogOut, Users, Trash2, Send } from 'lucide-react';
import { getActiveTask, onTaskUpdate, pauseTask, resumeTask, cancelTask, type TaskInfo } from '../services/taskRunner';
import {
  onNotificationsChange, markAsRead, markAllAsRead, dismissNotification, clearAllNotifications,
  type Notification,
} from '../services/notificationCenter';
import { sendMessage, canSendMessage } from '../services/messageService';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { APP_VERSION } from '../appVersion';

export default function StatusBar() {
  const { t } = useTranslation();
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(getActiveTask());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [sentReports, setSentReports] = useState<Set<string>>(new Set());
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const { activeArchive, archives, currentUser, currentRole, currentUserId, startSwitchUser } = useStore(useShallow((s) => ({
    activeArchive: s.activeArchive,
    archives: s.archives,
    currentUser: s.currentUser,
    currentRole: s.currentRole,
    currentUserId: s.currentUserId,
    startSwitchUser: s.startSwitchUser,
  })));
  const currentArchiveDef = archives.find(a => a.id === activeArchive);

  // Avatar bilgisi — profil paneli kapandığında yenile
  const isUserProfileOpen = useStore((s) => s.isUserProfileOpen);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!currentUserId) { setUserAvatar(null); return; }
    import('../services/userService').then(m => {
      const u = m.getUserById(currentUserId);
      setUserAvatar(u?.avatar || null);
    });
  }, [currentUserId, isUserProfileOpen]);

  // Click-outside ve Escape ile bildirim paneli kapanması
  useEffect(() => {
    if (!showNotifPanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showNotifPanel]);

  useEffect(() => {
    const unsub1 = onTaskUpdate((task) => setActiveTask(task));
    const unsub2 = onNotificationsChange((notifs, count) => {
      setNotifications(notifs);
      setUnreadCount(count);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const formatTime = useCallback((ms: number) => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }, []);

  const notifIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={13} style={{ color: '#10b981' }} />;
      case 'error': return <XCircle size={13} style={{ color: '#ef4444' }} />;
      case 'warning': return <AlertTriangle size={13} style={{ color: '#f59e0b' }} />;
      default: return <Info size={13} style={{ color: '#6366f1' }} />;
    }
  };

  return (
    <div className="status-bar" style={{
      height: 32, display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', fontSize: '0.72rem',
      borderTop: '1px solid var(--color-border, rgba(255,255,255,0.06))',
      background: 'var(--color-bg-secondary)',
      color: 'var(--color-text-muted)',
      position: 'relative', zIndex: 100,
    }}>
      {/* Arşiv durumu */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        color: currentArchiveDef?.color || '#10b981',
      }}>
        <Archive size={12} />
        <span style={{ fontWeight: 500 }}>{currentArchiveDef?.name || activeArchive}</span>
      </div>

      {/* Aktif task */}
      {activeTask && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          marginLeft: 16,
        }}>
          {activeTask.status === 'running' && (
            <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
          )}
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {activeTask.label}
          </span>

          {/* İlerleme çubuğu */}
          <div style={{
            flex: 1, maxWidth: 200, height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.08)',
          }}>
            <div style={{
              width: `${activeTask.progress.percent}%`, height: '100%', borderRadius: 2,
              background: activeTask.status === 'paused' ? '#f59e0b' : 'var(--color-accent)',
              transition: 'width 300ms',
            }} />
          </div>

          <span>{activeTask.progress.percent}%</span>

          {activeTask.progress.currentItem && (
            <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeTask.progress.currentItem}
            </span>
          )}

          {/* Zamanlayıcı */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={11} />
            <span>{formatTime(activeTask.elapsedMs)}</span>
            {activeTask.estimatedRemainingMs > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                {t('statusBar.timeRemaining', { time: formatTime(activeTask.estimatedRemainingMs) })}
              </span>
            )}
          </div>

          {/* Hız */}
          {activeTask.speed > 0 && (
            <span>{t('statusBar.itemsPerSec', { speed: activeTask.speed })}</span>
          )}

          {/* Pause/Resume/Cancel butonları */}
          <div style={{ display: 'flex', gap: 2 }}>
            {activeTask.status === 'running' && (
              <button onClick={pauseTask} title={t('statusBar.pause')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f59e0b', padding: 2 }}>
                <Pause size={13} />
              </button>
            )}
            {activeTask.status === 'paused' && (
              <button onClick={resumeTask} title={t('statusBar.resume')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10b981', padding: 2 }}>
                <Play size={13} />
              </button>
            )}
            <button onClick={cancelTask} title={t('statusBar.cancelTask')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Boşluk */}
      {!activeTask && <div style={{ flex: 1 }} />}

      {/* Bildirim butonu */}
      <div ref={notifPanelRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setShowNotifPanel(!showNotifPanel)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: unreadCount > 0 ? '#6366f1' : '#b0bec5',
            padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 4,
          }}
          title={t('statusBar.unreadNotifications', { count: unreadCount })}
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <span style={{
              background: '#ef4444', color: '#fff', borderRadius: 8,
              padding: '0 5px', fontSize: '0.65rem', fontWeight: 600, lineHeight: '14px',
            }}>
              {unreadCount}
            </span>
          )}
        </button>

        {/* Bildirim paneli */}
        {showNotifPanel && (
          <div style={{
            position: 'absolute', bottom: 36, right: 0, width: 340,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            maxHeight: 400, overflow: 'auto', zIndex: 200,
          }}>
            {/* Header */}
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid var(--color-border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.78rem' }}>
                {t('statusBar.notifications')}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {unreadCount > 0 && (
                  <button onClick={markAllAsRead}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.7rem' }}>
                    {t('statusBar.markAllRead')}
                  </button>
                )}
                {notifications.length > 0 && (
                  <button onClick={clearAllNotifications}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Trash2 size={10} /> {t('statusBar.clearAll')}
                  </button>
                )}
              </div>
            </div>

            {/* Bildirim listesi */}
            {notifications.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                {t('statusBar.noNotifications')}
              </div>
            ) : (
              notifications.slice(0, 20).map(n => (
                <div key={n.id}
                  onClick={() => markAsRead(n.id)}
                  style={{
                    padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'flex-start',
                    borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                    background: n.read ? 'transparent' : 'rgba(99,102,241,0.04)',
                  }}>
                  {notifIcon(n.type)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.74rem', fontWeight: n.read ? 400 : 600,
                      color: 'var(--color-text-primary)',
                    }}>
                      {n.title}
                    </div>
                    {n.message && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {n.message}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)' }}>
                        {new Date(n.timestamp).toLocaleTimeString(document.documentElement.lang || navigator.language)}
                      </span>
                      {(n.type === 'error' || n.type === 'warning') && currentUser && !sentReports.has(n.id) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const check = canSendMessage(currentUser!);
                            if (!check.allowed) {
                              useStore.getState().addToast(t('statusBar.reportLimitReached'), 'warning');
                              return;
                            }
                            sendMessage(
                              currentUser!,
                              currentRole || 'viewer',
                              'developer',
                              'important',
                              `[${n.type.toUpperCase()}] ${n.title}\n\n${n.message || '—'}\n\n🕐 ${n.timestamp}\n📋 v${APP_VERSION}`,
                              t('statusBar.errorReportSubject', { title: n.title }),
                            );
                            setSentReports(prev => new Set(prev).add(n.id));
                            useStore.getState().addToast(t('statusBar.errorReported'), 'success');
                          }}
                          title={t('statusBar.reportError')}
                          style={{
                            background: 'none', border: '1px solid rgba(99,102,241,0.3)',
                            borderRadius: 4, cursor: 'pointer', color: '#818cf8',
                            padding: '1px 6px', fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: 3,
                          }}
                        >
                          <Send size={9} /> {t('statusBar.reportError')}
                        </button>
                      )}
                      {sentReports.has(n.id) && (
                        <span style={{ fontSize: '0.62rem', color: '#10b981' }}>
                          ✓ {t('statusBar.errorReportSent')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Kullanıcı göstergesi */}
      {currentUser && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, borderLeft: '1px solid var(--color-border)', paddingLeft: 8 }}>
          {/* Admin: Kullanıcı Yönetimi butonu */}
          {currentRole === 'admin' && (
            <button
              onClick={() => useStore.getState().setIsUserManagementOpen(true)}
              title={t('statusBar.userManagement')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', padding: 2, display: 'flex', alignItems: 'center' }}
            >
              <Users size={14} />
            </button>
          )}

          {/* Tıklanabilir profil alanı */}
          <button
            onClick={() => useStore.getState().setIsUserProfileOpen(true)}
            title={t('statusBar.editProfile')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
              background: currentRole === 'admin' ? 'rgba(99,102,241,0.1)' : 'rgba(168,85,247,0.1)',
              color: currentRole === 'admin' ? '#818cf8' : '#c084fc',
              fontSize: '0.68rem', fontWeight: 600,
              border: 'none',
            }}
          >
            {userAvatar ? (
              <img src={userAvatar} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              currentRole === 'admin' ? <Shield size={10} /> : <Eye size={10} />
            )}
            {currentUser}
            <span style={{ opacity: 0.6, fontWeight: 400 }}>
              ({currentRole === 'admin' ? t('common.role.admin') : t('common.role.viewer')})
            </span>
          </button>

          {/* Kullanıcı Değiştir */}
          <button
            onClick={() => startSwitchUser()}
            title={t('statusBar.switchUser')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2 }}
          >
            <LogOut size={13} />
          </button>
        </div>
      )}

      {/* Versiyon */}
      <span style={{ marginLeft: 'auto', fontSize: '0.64rem', color: 'var(--color-text-muted)', opacity: 0.6, letterSpacing: '0.02em' }}>
        v{APP_VERSION}
      </span>
    </div>
  );
}

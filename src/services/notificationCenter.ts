/**
 * Archivist Pro — Bildirim Merkezi
 *
 * TaskRunner ile entegre. Tüm bildirimleri (task tamamlandı, hata, uyarı)
 * merkezi olarak yönetir. Alt bar + bildirim paneli.
 *
 * Bildirimler oturum boyunca tutulur, kullanıcı silene kadar kalır.
 */

import i18n from '../i18n';

/* ── Tipler ── */

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  /** İlgili task ID (varsa) */
  taskId?: string;
  /** Otomatik kapanma süresi (ms, 0 = kalıcı) */
  autoDismissMs: number;
}

export type NotificationListener = (notifications: Notification[], unreadCount: number) => void;

/* ── Dahili durum ── */

const MAX_NOTIFICATIONS = 100;

let _notifications: Notification[] = [];
let _listeners = new Set<NotificationListener>();
let _idCounter = 0;
const _dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function _notify(): void {
  const unread = _notifications.filter(n => !n.read).length;
  for (const l of _listeners) l([..._notifications], unread);
}

/* ── Public API ── */

/** Bildirim listener'ı ekler, unsubscribe fonksiyonu döner */
export function onNotificationsChange(listener: NotificationListener): () => void {
  _listeners.add(listener);
  const unread = _notifications.filter(n => !n.read).length;
  listener([..._notifications], unread);
  return () => {
    _listeners.delete(listener);
  };
}

/** Yeni bildirim ekler */
export function addNotification(opts: {
  type: NotificationType;
  title: string;
  message: string;
  taskId?: string;
  autoDismissMs?: number;
}): string {
  _idCounter++;
  const id = `notif_${Date.now()}_${_idCounter}`;

  const autoDismissMs = opts.autoDismissMs ?? 0;

  const notification: Notification = {
    id,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    timestamp: new Date().toISOString(),
    read: false,
    taskId: opts.taskId,
    autoDismissMs,
  };

  // Sınırsız birikim engeli: max limiti aşınca en eski okunmuş bildirimi sil
  if (_notifications.length >= MAX_NOTIFICATIONS) {
    let oldestReadIdx = -1;
    for (let i = _notifications.length - 1; i >= 0; i--) {
      if (_notifications[i].read) { oldestReadIdx = i; break; }
    }
    if (oldestReadIdx !== -1) {
      const removed = _notifications.splice(oldestReadIdx, 1)[0];
      const timer = _dismissTimers.get(removed.id);
      if (timer) { clearTimeout(timer); _dismissTimers.delete(removed.id); }
    }
  }

  _notifications.unshift(notification);

  // autoDismiss timer kur
  if (autoDismissMs > 0) {
    _dismissTimers.set(id, setTimeout(() => {
      _dismissTimers.delete(id);
      dismissNotification(id);
    }, autoDismissMs));
  }

  _notify();

  return id;
}

/** Bildirim kolaylık fonksiyonları */
export function notifySuccess(title: string, message = ''): string {
  return addNotification({ type: 'success', title, message });
}

export function notifyError(title: string, message = ''): string {
  return addNotification({ type: 'error', title, message, autoDismissMs: 0 });
}

export function notifyWarning(title: string, message = ''): string {
  return addNotification({ type: 'warning', title, message, autoDismissMs: 12000 });
}

export function notifyInfo(title: string, message = ''): string {
  return addNotification({ type: 'info', title, message });
}

/** Task tamamlandığında bildirim (TaskRunner entegrasyonu) */
export function notifyTaskComplete(taskLabel: string, taskId: string, elapsedMs: number): string {
  const seconds = Math.round(elapsedMs / 1000);
  const timeStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return addNotification({
    type: 'success',
    title: i18n.t('notifications.taskCompleted', { label: taskLabel }),
    message: i18n.t('notifications.duration', { time: timeStr }),
    taskId,
  });
}

/** Task hata aldığında bildirim */
export function notifyTaskFailed(taskLabel: string, taskId: string, error: string): string {
  return addNotification({
    type: 'error',
    title: i18n.t('notifications.taskFailed', { label: taskLabel }),
    message: error,
    taskId,
    autoDismissMs: 0,
  });
}

/** Bildirimi okundu olarak işaretler */
export function markAsRead(id: string): void {
  const n = _notifications.find(n => n.id === id);
  if (n) {
    n.read = true;
    _notify();
  }
}

/** Tüm bildirimleri okundu olarak işaretler */
export function markAllAsRead(): void {
  _notifications.forEach(n => { n.read = true; });
  _notify();
}

/** Bildirimi kaldırır */
export function dismissNotification(id: string): void {
  const timer = _dismissTimers.get(id);
  if (timer) { clearTimeout(timer); _dismissTimers.delete(id); }
  _notifications = _notifications.filter(n => n.id !== id);
  _notify();
}

/** Tüm bildirimleri temizler */
export function clearAllNotifications(): void {
  for (const timer of _dismissTimers.values()) clearTimeout(timer);
  _dismissTimers.clear();
  _notifications = [];
  _notify();
}

/** Okunmamış bildirim sayısı */
export function getUnreadCount(): number {
  return _notifications.filter(n => !n.read).length;
}

/** Tüm bildirimleri getirir */
export function getAllNotifications(): Notification[] {
  return [..._notifications];
}

/** Test yardımcısı */
export function _resetForTesting(): void {
  for (const timer of _dismissTimers.values()) clearTimeout(timer);
  _dismissTimers.clear();
  _notifications = [];
  _listeners = new Set();
  _idCounter = 0;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addNotification,
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  clearAllNotifications,
  getUnreadCount,
  getAllNotifications,
  onNotificationsChange,
  _resetForTesting,
} from '../services/notificationCenter';

vi.mock('../i18n', () => ({
  default: { t: (_k: string, opts?: Record<string, unknown>) => opts?.label ? `Task: ${opts.label}` : _k },
}));

describe('NotificationCenter', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('addNotification yeni bildirim ekler', () => {
    const id = addNotification({ type: 'info', title: 'Test', message: 'Mesaj' });
    expect(id).toContain('notif_');
    expect(getAllNotifications()).toHaveLength(1);
  });

  it('bildirimler en yeni en üstte sıralanır', () => {
    addNotification({ type: 'info', title: 'Birinci', message: '' });
    addNotification({ type: 'info', title: 'İkinci', message: '' });
    const all = getAllNotifications();
    expect(all[0].title).toBe('İkinci');
    expect(all[1].title).toBe('Birinci');
  });

  it('yeni bildirim okunmamış olarak eklenir', () => {
    addNotification({ type: 'success', title: 'Test', message: '' });
    expect(getUnreadCount()).toBe(1);
    expect(getAllNotifications()[0].read).toBe(false);
  });

  it('markAsRead bildirimi okundu işaretler', () => {
    const id = addNotification({ type: 'info', title: 'Test', message: '' });
    markAsRead(id);
    expect(getUnreadCount()).toBe(0);
    expect(getAllNotifications()[0].read).toBe(true);
  });

  it('markAllAsRead tüm bildirimleri okundu işaretler', () => {
    addNotification({ type: 'info', title: 'A', message: '' });
    addNotification({ type: 'info', title: 'B', message: '' });
    expect(getUnreadCount()).toBe(2);
    markAllAsRead();
    expect(getUnreadCount()).toBe(0);
  });

  it('dismissNotification bildirimi kaldırır', () => {
    const id = addNotification({ type: 'info', title: 'Test', message: '' });
    dismissNotification(id);
    expect(getAllNotifications()).toHaveLength(0);
  });

  it('clearAllNotifications tümünü temizler', () => {
    addNotification({ type: 'info', title: 'A', message: '' });
    addNotification({ type: 'info', title: 'B', message: '' });
    clearAllNotifications();
    expect(getAllNotifications()).toHaveLength(0);
    expect(getUnreadCount()).toBe(0);
  });

  it('notifySuccess success tipli bildirim oluşturur', () => {
    notifySuccess('Başarılı', 'Detay');
    const n = getAllNotifications()[0];
    expect(n.type).toBe('success');
    expect(n.title).toBe('Başarılı');
    expect(n.message).toBe('Detay');
  });

  it('notifyError error tipli bildirim oluşturur', () => {
    notifyError('Hata');
    const n = getAllNotifications()[0];
    expect(n.type).toBe('error');
    expect(n.autoDismissMs).toBe(0); // kalıcı
  });

  it('notifyWarning warning tipli bildirim oluşturur', () => {
    notifyWarning('Uyarı');
    const n = getAllNotifications()[0];
    expect(n.type).toBe('warning');
    expect(n.autoDismissMs).toBe(12000);
  });

  it('notifyInfo info tipli bildirim oluşturur', () => {
    notifyInfo('Bilgi');
    expect(getAllNotifications()[0].type).toBe('info');
  });

  it('onNotificationsChange listener ekler ve hemen çağırır', () => {
    const listener = vi.fn();
    addNotification({ type: 'info', title: 'Önceki', message: '' });
    const unsub = onNotificationsChange(listener);
    // Listener hemen mevcut durumla çağrılır
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.any(Array), 1);
    unsub();
  });

  it('onNotificationsChange değişikliklerde çağrılır', () => {
    const listener = vi.fn();
    const unsub = onNotificationsChange(listener);
    // İlk çağrı: subscribe anı
    expect(listener).toHaveBeenCalledTimes(1);
    // Yeni bildirim eklenince tekrar çağrılır
    addNotification({ type: 'info', title: 'Test', message: '' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('unsubscribe sonrası listener çağrılmaz', () => {
    const listener = vi.fn();
    const unsub = onNotificationsChange(listener);
    unsub();
    addNotification({ type: 'info', title: 'Test', message: '' });
    // Sadece subscribe anındaki çağrı
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('max 100 bildirime sınırlıdır', () => {
    for (let i = 0; i < 105; i++) {
      const id = addNotification({ type: 'info', title: `N${i}`, message: '' });
      markAsRead(id); // okunmuş olarak işaretle ki sınır aşılınca silinebilsin
    }
    expect(getAllNotifications().length).toBeLessThanOrEqual(100);
  });

  it('bildirimler benzersiz ID alır', () => {
    const id1 = addNotification({ type: 'info', title: 'A', message: '' });
    const id2 = addNotification({ type: 'info', title: 'B', message: '' });
    expect(id1).not.toBe(id2);
  });

  it('autoDismiss timer ile bildirim silinir', async () => {
    vi.useFakeTimers();
    addNotification({ type: 'info', title: 'Geçici', message: '', autoDismissMs: 100 });
    expect(getAllNotifications()).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(getAllNotifications()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('taskId bildirime atanabilir', () => {
    addNotification({ type: 'success', title: 'Task', message: '', taskId: 'task_123' });
    expect(getAllNotifications()[0].taskId).toBe('task_123');
  });
});

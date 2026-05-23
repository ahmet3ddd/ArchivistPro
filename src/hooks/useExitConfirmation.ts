/**
 * ArchivistPro — Pencere Kapatma + Reload Koruması
 *
 * 1) Kullanıcı pencereyi X ile veya Alt+F4 ile kapattığında onay diyaloğu (preventDefault).
 * 2) F5 / Ctrl+R / Ctrl+F5 ile webview reload'u sessizce engelleyip toast ile bildirir;
 *    aksi halde reload login state'i sıfırlar ve kullanıcı tarama/oturum verisi kaybeder.
 * Login ekranında her ikisi de devre dışı (enabled=false).
 */

import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import i18n from '../i18n';
import { auditLog } from '../services/logger';
import { flushDeferredSave, flushPendingWrites } from '../services/database';

export function useExitConfirmation({ enabled = true } = {}) {
    const showConfirmDialog = useStore((s) => s.showConfirmDialog);

    // Reload guard: F5 / Ctrl+R / Ctrl+Shift+R webview reload'u engellenir.
    // capture:true → React event handler'larından önce yakalar.
    useEffect(() => {
        if (!enabled) return;
        let lastToastMs = 0;
        const handler = (e: KeyboardEvent) => {
            const isF5 = e.key === 'F5';
            const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
            if (!isF5 && !isCtrlR) return;
            e.preventDefault();
            e.stopPropagation();
            // 3sn'de bir toast — kullanıcı tuşa basılı tutsa veya tekrarlasa spam olmasın
            const now = Date.now();
            if (now - lastToastMs < 3000) return;
            lastToastMs = now;
            useStore.getState().addToast(i18n.t('reload.disabled'), 'info');
        };
        window.addEventListener('keydown', handler, { capture: true });
        return () => window.removeEventListener('keydown', handler, { capture: true });
    }, [enabled]);

    useEffect(() => {
        // Login ekranında ConfirmDialog render edilmediğinden hook devre dışı —
        // devre dışıyken pencere X'i doğrudan kapanır.
        if (!enabled) return;

        let unlisten: (() => void) | null = null;
        let cancelled = false;
        let confirming = false;

        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            if (cancelled) return; // Cleanup zaten çağrıldı, handler kaydetme
            const win = getCurrentWindow();
            win.onCloseRequested((event) => {
                if (confirming) return;
                event.preventDefault();
                showConfirmDialog(
                    i18n.t('common.exitConfirm'),
                    i18n.t('common.exitConfirmDetail'),
                    () => {
                        confirming = true;
                        // Graceful shutdown sinyali iki katmanlı:
                        // 1) marker dosyası — küçük JSON, garantili (DB save'den bağımsız)
                        // 2) flushPendingWrites — kuyrukta bekleyen yazımları tamamlar (max 1.5sn)
                        //    Yeni saveDatabase() çağrısı YOK: tüm CRUD işlemleri kendi save'ini yapıyor
                        //    + settings rusqlite üzerinden anında diske yazıyor → exit'te export gereksiz.
                        (async () => {
                            try {
                                const { invoke } = await import('@tauri-apps/api/core');
                                // Marker önce yazılır (saniyenin altında, kritik yol)
                                await invoke('mark_graceful_shutdown', {
                                    timestamp: new Date().toISOString(),
                                    reason: 'user_close',
                                });
                            } catch { /* sessizce */ }
                            try {
                                auditLog('APP_SHUTDOWN_GRACEFUL', '', { reason: 'user_close' }, 'SUCCESS');
                                // Deferred save bekliyor olabilir — anında tetikle
                                flushDeferredSave();
                                // Ardından kuyruktaki yazımları bekle
                                await Promise.race([
                                    flushPendingWrites(),
                                    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
                                ]);
                            } catch { /* sessizce — marker zaten yazıldı */ }
                            try {
                                const { invoke } = await import('@tauri-apps/api/core');
                                await invoke('app_quit');
                            } catch { /* exit zaten oldu */ }
                        })();
                    },
                    i18n.t('common.exitConfirmLabel'),
                    true,
                );
            }).then((fn) => {
                if (cancelled) {
                    fn(); // Promise geç resolve oldu — hemen unregister et
                } else {
                    unlisten = fn;
                }
            });
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [showConfirmDialog, enabled]);
}

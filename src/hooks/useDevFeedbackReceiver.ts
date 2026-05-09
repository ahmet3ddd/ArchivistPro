/**
 * ArchivistPro — Geliştirici Geri Bildirim Alıcısı
 *
 * LAN sunucusu üzerinden gelen 'dev-feedback-received' Tauri olayını dinler,
 * mesajı yerel DB'ye kaydeder ve OS bildirimi gösterir.
 * Sadece dev_mode etkin ve LAN sunucusu çalışıyorsa aktiftir.
 */

import { useEffect } from 'react';
import { isDevModeConfigured } from '../services/developerFeedback';
import { sendMessage } from '../services/messageService';
import i18n from '../i18n';

export function useDevFeedbackReceiver() {
    useEffect(() => {
        if (!isDevModeConfigured()) return;

        let unlisten: (() => void) | null = null;

        import('@tauri-apps/api/event').then(({ listen }) => {
            listen<{ sender: string; subject: string | null; body: string; timestamp: string }>(
                'dev-feedback-received',
                async (event) => {
                    const { sender, subject, body } = event.payload;

                    // DB'ye kaydet (geliştirici gelen kutusu)
                    sendMessage(
                        sender,
                        'viewer',
                        'developer',
                        'normal',
                        body,
                        subject ?? undefined,
                        undefined,
                    );

                    // OS bildirimi
                    try {
                        const { isPermissionGranted, requestPermission, sendNotification } =
                            await import('@tauri-apps/plugin-notification');
                        let permitted = await isPermissionGranted();
                        if (!permitted) permitted = (await requestPermission()) === 'granted';
                        if (permitted) {
                            sendNotification({
                                title: i18n.t('notification.devFeedbackTitle'),
                                body: `${sender}: ${body.slice(0, 80)}`,
                            });
                        }
                    } catch { /* bildirim desteklenmiyor */ }
                },
            ).then((fn) => { unlisten = fn; });
        });

        return () => { unlisten?.(); };
    }, []);
}

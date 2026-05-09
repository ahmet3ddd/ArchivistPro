/**
 * ArchivistPro — Geliştirici Geri Bildirim LAN Servisi
 *
 * Kullanıcının yazdığı geliştirici mesajını LAN üzerinden
 * geliştiricinin makinesine (port 9471 /dev-feedback) iletir.
 * Geliştirici çevrimdışıysa 'offline' döner; mesaj zaten yerel
 * DB'ye kaydedilmiş olduğundan veri kaybı olmaz.
 */

import { getSetting } from './database';

export type FeedbackSendResult = 'sent' | 'offline' | 'no-config';

export function getDevIp(): string | null {
    return getSetting('dev_ip') || null;
}

export function isDevModeConfigured(): boolean {
    return getDevIp() !== null && getSetting('dev_mode') === 'true';
}

export async function sendFeedbackOverLan(
    sender: string,
    body: string,
    subject?: string,
): Promise<FeedbackSendResult> {
    const devIp = getDevIp();
    if (!devIp) return 'no-config';

    const payload = {
        sender,
        subject: subject ?? null,
        body,
        timestamp: new Date().toISOString(),
    };

    try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const resp = await tauriFetch(`http://${devIp}:9471/dev-feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return resp.ok ? 'sent' : 'offline';
    } catch {
        return 'offline';
    }
}

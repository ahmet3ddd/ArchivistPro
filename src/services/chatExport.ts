/**
 * Chat oturumu Markdown dışa aktarma servisi.
 * chatStorage.ts'den session + mesaj bilgisi yükler,
 * okunabilir Markdown üretir ve tarayıcı indirme tetikler.
 */

import { listSessions, listMessages, type ChatSession, type ChatMessage } from './chatStorage';

/* ── Yardımcı ── */

function formatDate(isoString: string): string {
    try {
        const d = new Date(isoString);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return isoString;
    }
}

function scopeDescription(session: ChatSession): string {
    const { scope } = session;
    if (scope.type === 'all') return 'Tüm Arşiv';
    if (scope.type === 'project') return `Proje: ${(scope as { value: string }).value}`;
    if (scope.type === 'tag') return `Etiket: ${(scope as { value: string }).value}`;
    return '';
}

function renderMessage(msg: ChatMessage): string {
    const roleHeader = msg.role === 'user' ? '## Kullanıcı' : '## Asistan';
    const lines: string[] = [roleHeader, '', msg.content];

    if (msg.role === 'assistant' && msg.citations && msg.citations.length > 0) {
        lines.push('', '**Kaynaklar:**');
        for (const c of msg.citations) {
            const page = c.page != null ? ` (s.${c.page})` : '';
            const score = c.score != null ? ` — skor: ${c.score.toFixed(3)}` : '';
            lines.push(`- [${c.index}] ${c.fileName}${page}${score}`);
        }
    }

    return lines.join('\n');
}

/* ── Ana Fonksiyonlar ── */

/**
 * Belirtilen oturum için Markdown string üretir.
 * Oturum bulunamazsa veya mesaj yoksa boş string döner.
 */
export function exportSessionToMarkdown(sessionId: string): string {
    const sessions = listSessions(1000);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return '';

    const messages = listMessages(sessionId).filter((m) => m.role !== 'system');
    if (messages.length === 0) return '';

    const header = [
        `# ${session.title}`,
        '',
        `**Tarih:** ${formatDate(session.createdAt)}`,
        `**Model:** ${session.model ?? 'Bilinmiyor'}`,
        `**Kapsam:** ${scopeDescription(session)}`,
        '',
        '---',
        '',
    ].join('\n');

    const body = messages.map(renderMessage).join('\n\n---\n\n');

    return header + body + '\n';
}

/**
 * Markdown içeriğini dosya olarak tarayıcı üzerinden indirir.
 */
export function downloadMarkdown(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

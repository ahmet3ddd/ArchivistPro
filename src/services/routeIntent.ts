/**
 * Sohbet girdisi için niyet yönlendirmesi.
 *
 * Kullanıcı input'u geldiğinde pipeline hangi yola gider:
 *  - `visual` → CLIP text→image arama (`/görsel <sorgu>` veya `/g <sorgu>`)
 *  - `text`   → Standart RAG (retrieve + LLM)
 *
 * Pure — React/DB bağımlılığı yok, test edilebilir.
 */

export type ChatIntent =
    | { kind: 'visual'; query: string }
    | { kind: 'text'; query: string };

const VISUAL_SLASH_PATTERN = /^\/(görsel|gorsel|g|visual)\s+(.+)$/i;

/**
 * Trim edilmiş kullanıcı girdisini intent'e dönüştürür.
 * Boş/whitespace input geldiğinde `{ kind: 'text', query: '' }` döner —
 * çağıran early-exit yapmalı.
 */
export function routeChatIntent(rawInput: string): ChatIntent {
    const q = rawInput.trim();
    if (!q) return { kind: 'text', query: '' };

    const visualMatch = q.match(VISUAL_SLASH_PATTERN);
    if (visualMatch) {
        return { kind: 'visual', query: visualMatch[2].trim() };
    }

    return { kind: 'text', query: q };
}

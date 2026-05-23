import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../services/chatStorage';
import type { RagCitation, RetrieveDiagnostics } from '../../services/ragService';
import { getAssetById } from '../../services/database';
import { getAssetThumbnailSrc } from '../../utils/thumbnailSrc';
import { chatStyles as styles } from './chatStyles';

/* ─── renderWithCitations ──────────────────────────────────────── */

function renderWithCitations(text: string): Array<{ kind: 'text'; text: string } | { kind: 'cite'; index: number }> {
    const out: Array<{ kind: 'text'; text: string } | { kind: 'cite'; index: number }> = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        out.push({ kind: 'cite', index: parseInt(m[1], 10) });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
    return out;
}

/* ─── MessageBubble ─────────────────────────────────────────────── */

function MessageBubble({
    message,
    onCitationClick,
    showThinking,
}: {
    message: ChatMessage;
    onCitationClick: (c: RagCitation) => void;
    showThinking: boolean;
}) {
    const isUser = message.role === 'user';
    const isVisual = !isUser && message.content.startsWith('[VISUAL]');
    // Thinking bloğu (eğer model düşünme süreci gösterdiyse): content başında
    // <thinking>...</thinking> marker'ı ayıklanır. Asıl cevap altta.
    const { thinking, visibleContent } = useMemo(() => {
        const match = message.content.match(/^<thinking>([\s\S]*?)<\/thinking>\s*/);
        if (match) {
            return { thinking: match[1].trim(), visibleContent: message.content.slice(match[0].length) };
        }
        return { thinking: null as string | null, visibleContent: message.content };
    }, [message.content]);
    const parts = useMemo(() => renderWithCitations(visibleContent), [visibleContent]);
    const referencedCitations = useMemo(
        () => message.citations.filter((c) => visibleContent.includes(`[${c.index}]`)),
        [message.citations, visibleContent],
    );
    const [highlight, setHighlight] = useState<number | null>(null);
    const [thinkingOpen, setThinkingOpen] = useState(false);
    const cardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

    const flashCitation = useCallback((index: number) => {
        setHighlight(index);
        cardRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => setHighlight((cur) => (cur === index ? null : cur)), 1600);
    }, []);

    if (isVisual) {
        const headerLine = message.content.split('\n')[0].replace(/^\[VISUAL\]\s*/, '');
        return (
            <div style={{ ...styles.bubble, ...styles.assistantBubble, maxWidth: '100%', width: '100%' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>🖼️ {headerLine}</div>
                {message.citations.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Eşleşme bulunamadı.</div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                        gap: 8,
                    }}>
                        {message.citations.map((c) => {
                            const a = getAssetById(c.assetId);
                            const src = a ? getAssetThumbnailSrc(a) : (c.snippet || null);
                            return (
                                <button
                                    key={c.chunkId}
                                    onClick={() => onCitationClick(c as RagCitation)}
                                    title={`${c.fileName} · skor ${c.score.toFixed(3)}`}
                                    style={{
                                        background: 'var(--color-bg-modal)', border: '1px solid var(--color-border-hover)',
                                        borderRadius: 6, padding: 0, overflow: 'hidden',
                                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                                        textAlign: 'left',
                                    }}
                                >
                                    {src ? (
                                        <img src={src} alt={c.fileName} loading="lazy" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                                    ) : (
                                        <div style={{
                                            width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center',
                                            justifyContent: 'center', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', fontSize: 11,
                                        }}>thumbnail yok</div>
                                    )}
                                    <div style={{ padding: 4, fontSize: 10, color: 'var(--color-text-primary)', wordBreak: 'break-word', lineHeight: 1.2 }}>
                                        {c.fileName}
                                    </div>
                                    <div style={{ padding: '0 4px 4px', fontSize: 9, color: '#718096' }}>
                                        {c.score.toFixed(3)}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ ...styles.bubble, ...(isUser ? styles.userBubble : styles.assistantBubble) }}>
            {showThinking && thinking && (
                <div style={{ marginBottom: 8 }}>
                    <button
                        onClick={() => setThinkingOpen((v) => !v)}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', fontSize: 11, padding: '2px 0',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}
                    >
                        <span style={{ transition: 'transform 150ms', transform: thinkingOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                        {thinkingOpen ? 'Düşünme sürecini gizle' : 'Düşünme sürecini göster'}
                    </button>
                    {thinkingOpen && (
                        <pre style={{
                            marginTop: 6, padding: 8,
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--color-border-hover)',
                            borderRadius: 6,
                            fontSize: 11, color: 'var(--color-text-muted)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontFamily: 'inherit', lineHeight: 1.5,
                            maxHeight: 300, overflowY: 'auto',
                        }}>{thinking}</pre>
                    )}
                </div>
            )}
            <div style={styles.bubbleContent}>
                {parts.map((p, i) => {
                    if (p.kind === 'text') return <span key={i}>{p.text}</span>;
                    const c = message.citations.find((x) => x.index === p.index);
                    if (!c) return <span key={i}>[{p.index}]</span>;
                    const fileName = c.fileName;
                    return (
                        <button
                            key={i}
                            style={styles.citationChipInline}
                            onClick={() => {
                                flashCitation(p.index);
                                onCitationClick(c as RagCitation);
                            }}
                            title={c.filePath || c.fileName || ''}
                        >[{p.index}] {fileName.length > 28 ? fileName.slice(0, 28) + '…' : fileName}</button>
                    );
                })}
            </div>
            {referencedCitations.length > 0 && (
                <div style={styles.citationsBlock}>
                    {referencedCitations.map((c) => {
                        const isHi = highlight === c.index;
                        return (
                            <button
                                key={c.chunkId}
                                ref={(el) => { cardRefs.current[c.index] = el; }}
                                style={{
                                    ...styles.citationCard,
                                    ...(isHi ? {
                                        border: '2px solid var(--color-citation-highlight)',
                                        boxShadow: '0 0 12px rgba(246,173,85,0.4)',
                                        transform: 'scale(1.01)',
                                    } : {}),
                                    transition: 'box-shadow 200ms, border 200ms, transform 200ms',
                                }}
                                onClick={() => { flashCitation(c.index); onCitationClick(c as RagCitation); }}
                                title={c.filePath}
                            >
                                <div style={{ fontWeight: 600, fontSize: 12 }}>
                                    [{c.index}] {c.fileName}{c.page != null ? ` (s.${c.page})` : ''}
                                </div>
                                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{c.snippet}</div>
                                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
                                    skor: {c.score.toFixed(3)}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ─── ChatMessageList ───────────────────────────────────────────── */

interface ChatMessageListProps {
    messages: ChatMessage[];
    busy: boolean;
    streamingText: string;
    phaseText: string;
    retrieveDiag?: RetrieveDiagnostics | null;
    ollamaOk: boolean | null;
    indexBadge: { indexed: number; total: number; missing: number; skipped: number; contentIndexed?: number } | null;
    autoSyncProgress: { done: number; failed: number; total: number } | null;
    onCitationClick: (c: RagCitation) => void;
    onAbort: () => void;
    listEndRef: React.RefObject<HTMLDivElement | null>;
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string;
    showThinking: boolean;
}

export default function ChatMessageList({
    messages,
    busy,
    streamingText,
    phaseText,
    retrieveDiag,
    ollamaOk,
    indexBadge,
    autoSyncProgress,
    onCitationClick,
    onAbort,
    listEndRef,
    t,
    showThinking,
}: ChatMessageListProps) {
    return (
        <div style={styles.messages}>
            {messages.length === 0 && !busy && (
                <div style={styles.welcome}>
                    <h3 style={{ margin: '0 0 8px' }}>{t('chat.welcome.title')}</h3>
                    <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
                        {t('chat.welcome.subtitle')}
                    </p>

                    {ollamaOk === false && (
                        <div style={{
                            marginTop: 16, padding: 14, borderRadius: 8,
                            background: 'var(--color-status-err-bg)', color: 'var(--color-status-err-text)',
                            textAlign: 'left', fontSize: 13, lineHeight: 1.6,
                        }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                {t('chat.ollama.notRunning')}
                            </div>
                            <div>{t('chat.ollama.hint1')}</div>
                            <div style={{ marginTop: 8, fontWeight: 600 }}>{t('chat.ollama.installSteps')}</div>
                            <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                                <li>{t('chat.ollama.step1')}</li>
                                <li>{t('chat.ollama.step2')}</li>
                                <li>{t('chat.ollama.step3')}</li>
                                <li>{t('chat.ollama.step4')}</li>
                            </ol>
                        </div>
                    )}
                    {ollamaOk === null && (
                        <div style={{
                            marginTop: 12, padding: '6px 12px', borderRadius: 6,
                            background: 'rgba(245,158,11,0.10)',
                            border: '1px solid rgba(245,158,11,0.30)',
                            color: 'var(--color-warning)',
                            fontSize: 12, fontWeight: 600,
                            display: 'inline-block',
                        }}>
                            {t('chat.ollama.checking')}
                        </div>
                    )}

                    {(autoSyncProgress || (indexBadge && indexBadge.missing > 0)) && (
                        <div style={{
                            marginTop: 16, padding: 14, borderRadius: 8,
                            background: 'var(--color-status-info-bg)', color: 'var(--color-status-info-text)',
                            fontSize: 13, lineHeight: 1.5,
                        }}>
                            {autoSyncProgress ? (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span>{t('chat.index.autoPreparing')}</span>
                                        <b>{autoSyncProgress.done}/{autoSyncProgress.total}</b>
                                    </div>
                                    <div style={{
                                        width: '100%', height: 6, background: 'rgba(0,0,0,0.25)',
                                        borderRadius: 3, overflow: 'hidden',
                                    }}>
                                        <div style={{
                                            width: `${Math.min(100, (autoSyncProgress.done / Math.max(1, autoSyncProgress.total)) * 100)}%`,
                                            height: '100%', background: 'var(--color-status-info-bar)',
                                            transition: 'width 0.25s',
                                        }} />
                                    </div>
                                    {autoSyncProgress.failed > 0 && (
                                        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.85 }}>
                                            {autoSyncProgress.failed} dosyada hata — konsol (F12) kontrol edin.
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ textAlign: 'center' }}>
                                    {t('chat.index.autoPending', { count: indexBadge!.missing, defaultValue: `${indexBadge!.missing} dosya için metadata hazırlanacak — otomatik başlayacak.` } as unknown as string)}
                                </div>
                            )}
                        </div>
                    )}
                    <ul style={{ opacity: 0.6, fontSize: 13, marginTop: 16 }}>
                        <li>{t('chat.welcome.example1')}</li>
                        <li>{t('chat.welcome.example2')}</li>
                        <li>{t('chat.welcome.example3')}</li>
                    </ul>
                    <div style={{
                        marginTop: 18, padding: '10px 12px',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.4)',
                        borderRadius: 6, fontSize: 12, textAlign: 'left',
                    }}>
                        <b style={{ color: 'var(--color-accent-hover)' }}>İpucu — Görsel arama:</b>{' '}
                        Mesajına <code style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>/görsel</code>{' '}
                        veya <code style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>/g</code> ile başla, metinden semantik resim araması yapılır.
                        <br />Örnek: <i>/görsel merdiven planı</i>, <i>/g cephe çizimi</i>
                    </div>
                </div>
            )}
            {messages.map((m) => (
                <MessageBubble key={m.id} message={m} onCitationClick={onCitationClick} showThinking={showThinking} />
            ))}
            {busy && (
                <div style={{ ...styles.bubble, ...styles.assistantBubble }}>
                    {streamingText ? (
                        <div style={styles.bubbleContent}>
                            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{streamingText}</span>
                            <span style={styles.streamCursor}>▍</span>
                        </div>
                    ) : (
                        <div style={{ opacity: 0.6 }}>
                            {phaseText && t(`chat.phase.${phaseText}`, '') !== ''
                                ? t(`chat.phase.${phaseText}`)
                                : t('chat.thinking')}
                        </div>
                    )}
                    {retrieveDiag && (
                        <div style={{
                            marginTop: 6, fontSize: 11, lineHeight: 1.5,
                            color: 'var(--color-text-muted)', opacity: 0.85,
                        }}>
                            <div>
                                {t('chat.diagnostics.candidates', {
                                    total: retrieveDiag.fusedHits,
                                    fts: retrieveDiag.ftsHits,
                                    emb: retrieveDiag.embHits,
                                    defaultValue: `${retrieveDiag.fusedHits} aday · FTS ${retrieveDiag.ftsHits} · embedding ${retrieveDiag.embHits}`,
                                } as unknown as string)}
                                {typeof retrieveDiag.rerankedHits === 'number'
                                    ? ' · ' + t('chat.diagnostics.reranked', {
                                        count: retrieveDiag.rerankedHits,
                                        defaultValue: `rerank sonrası ${retrieveDiag.rerankedHits} → LLM'e`,
                                    } as unknown as string)
                                    : ` → ${retrieveDiag.finalHits} LLM'e`}
                            </div>
                            {retrieveDiag.dimMismatch && (
                                <div style={{
                                    marginTop: 4, padding: '4px 8px',
                                    background: 'rgba(245,158,11,0.15)',
                                    border: '1px solid rgba(245,158,11,0.4)',
                                    borderRadius: 4, color: '#f59e0b',
                                }}>
                                    ⚠ {t('chat.diagnostics.dimMismatch', {
                                        skipped: retrieveDiag.dimMismatch.skipped,
                                        queryDim: retrieveDiag.dimMismatch.queryDim,
                                        dbDims: retrieveDiag.dimMismatch.observedDims.join(', '),
                                        defaultValue: `${retrieveDiag.dimMismatch.skipped} chunk atlandı — embedding boyutu uyumsuz (sorgu ${retrieveDiag.dimMismatch.queryDim}, DB'de ${retrieveDiag.dimMismatch.observedDims.join(', ')}). Yeniden indeksleyin.`,
                                    } as unknown as string)}
                                </div>
                            )}
                        </div>
                    )}
                    <button
                        style={styles.abortBtn}
                        onClick={onAbort}
                        title={t('chat.abort')}
                    >{t('chat.abort')}</button>
                </div>
            )}
            <div ref={listEndRef} />
        </div>
    );
}

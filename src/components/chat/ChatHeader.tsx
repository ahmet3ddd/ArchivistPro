import { useEffect, useRef, useState } from 'react';
import { Download, Settings, HelpCircle } from 'lucide-react';
import type { RagScope } from '../../services/ragService';
import { chatStyles as styles } from './chatStyles';

interface ChatHeaderProps {
    modelLabel: string;
    ollamaOk: boolean | null;
    rerankerOn: boolean;
    queryRewriteOn: boolean;
    showThinking: boolean;
    scope: RagScope;
    scopeOptions: { projects: string[]; tags: string[] };
    indexBadge: { indexed: number; total: number; missing: number; skipped: number; contentIndexed?: number } | null;
    hasMessages: boolean;
    onToggleReranker: () => void;
    onToggleQueryRewrite: () => void;
    onToggleThinking: () => void;
    onScopeChange: (value: string) => void;
    onPickerOpen: () => void;
    onHelpOpen: () => void;
    onExport: () => void;
    onClose: () => void;
    onPrepareIndex: () => void;
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string;
}

export default function ChatHeader({
    modelLabel,
    ollamaOk,
    rerankerOn,
    queryRewriteOn,
    showThinking,
    scope,
    scopeOptions,
    indexBadge,
    hasMessages,
    onToggleReranker,
    onToggleQueryRewrite,
    onToggleThinking,
    onScopeChange,
    onPickerOpen,
    onHelpOpen,
    onExport,
    onClose,
    onPrepareIndex,
    t,
}: ChatHeaderProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Dışarı tıklayınca menüyü kapat
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        // Bir event loop sonraki render'a bağla (aynı tıklamada kapatmasın)
        const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [menuOpen]);

    const itemStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', fontSize: 12,
        background: 'transparent', border: 'none', width: '100%',
        color: 'var(--color-text-primary)', cursor: 'pointer', textAlign: 'left',
    };

    const toggleBadge = (on: boolean): React.CSSProperties => ({
        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
        background: on ? 'var(--color-toggle-on-bg)' : 'var(--color-toggle-off-bg)',
        color: on ? 'var(--color-toggle-on-text)' : 'var(--color-toggle-off-text)',
    });

    return (
        <header style={styles.mainHeader}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <strong>{t('chat.header.title')}</strong>

                {/* Sadece hata/ilerleme göster — Ollama OK durumunda sessiz */}
                {ollamaOk === false && (
                    <span style={{
                        ...styles.modelBadge,
                        background: 'var(--color-status-err-bg)', color: 'var(--color-status-err-text)',
                    }}>
                        {t('chat.ollama.disconnected')}
                    </span>
                )}
                {/* Scope — kapsam değişimi sık kullanılan bir kontrol, açıkta kalsın */}
                {scope.type !== 'assets' && (
                    <select
                        value={scope.type === 'all' ? 'all' : `${scope.type}:${(scope as { value: string }).value}`}
                        onChange={(e) => onScopeChange(e.target.value)}
                        style={styles.scopeSelect}
                    >
                        <option value="all">{t('chat.scope.all')}</option>
                        {scopeOptions.projects.length > 0 && (
                            <optgroup label={t('chat.scope.projects')}>
                                {scopeOptions.projects.map((p) => (
                                    <option key={`p:${p}`} value={`project:${p}`}>{p}</option>
                                ))}
                            </optgroup>
                        )}
                        {scopeOptions.tags.length > 0 && (
                            <optgroup label={t('chat.scope.tags')}>
                                {scopeOptions.tags.map((tg) => (
                                    <option key={`t:${tg}`} value={`tag:${tg}`}>{tg}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                )}

                {/* Synthesis chip — scope 'assets' iken otomatik görünür, yoksa menüden açılır */}
                {scope.type === 'assets' && (
                    <button
                        onClick={onPickerOpen}
                        style={{
                            ...styles.modelBadge,
                            cursor: 'pointer',
                            background: 'var(--color-accent)',
                            color: 'white',
                            border: 'none',
                        }}
                        title={t('chat.synthesis.pickTitle')}
                    >
                        📎 {t('chat.synthesis.modeActive', undefined, { count: (scope as { values: string[] }).values.length })}
                    </button>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }} ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((v) => !v)}
                    title={t('chat.header.options', 'Seçenekler')}
                    style={{
                        ...styles.closeBtn,
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '4px 8px',
                        background: menuOpen ? 'var(--color-bg-tertiary)' : 'transparent',
                    }}
                >
                    <Settings size={14} />
                </button>
                <button style={styles.closeBtn} onClick={onClose}>{t('common.close')}</button>

                {menuOpen && (
                    <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                        minWidth: 260,
                        background: 'var(--color-bg-modal)',
                        border: '1px solid var(--color-border-hover)',
                        borderRadius: 8,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                        zIndex: 100,
                        display: 'flex', flexDirection: 'column',
                        padding: '4px 0',
                    }}>
                        {/* Info */}
                        <div style={{ ...itemStyle, cursor: 'default', opacity: 0.85 }}>
                            <span>Model</span>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{modelLabel}</span>
                        </div>
                        <div style={{ ...itemStyle, cursor: 'default', opacity: 0.85 }}>
                            <span>Ollama</span>
                            <span style={{
                                fontSize: 10, fontWeight: 600,
                                color: ollamaOk === true ? 'var(--color-status-ok-text)' : ollamaOk === false ? 'var(--color-status-err-text)' : 'var(--color-text-muted)',
                            }}>
                                {ollamaOk === true ? t('chat.ollama.connected') : ollamaOk === false ? t('chat.ollama.disconnected') : '...'}
                            </span>
                        </div>
                        {indexBadge && (
                            <div style={{ ...itemStyle, cursor: 'default', opacity: 0.85 }}>
                                <span>Meta indeks</span>
                                <span style={{ fontSize: 10, color: indexBadge.missing === 0 ? 'var(--color-status-ok-text)' : 'var(--color-status-warn-text)' }}>
                                    {indexBadge.indexed}/{indexBadge.total}
                                    {indexBadge.contentIndexed != null && ` · ${t('chat.index.content')}: ${indexBadge.contentIndexed}`}
                                </span>
                            </div>
                        )}
                        <button
                            onClick={() => { setMenuOpen(false); onPrepareIndex(); }}
                            disabled={!indexBadge || indexBadge.missing === 0}
                            style={{
                                ...itemStyle,
                                opacity: !indexBadge || indexBadge.missing === 0 ? 0.4 : 1,
                                cursor: !indexBadge || indexBadge.missing === 0 ? 'not-allowed' : 'pointer',
                            }}
                            title={t('chat.prepareIndex.tooltip')}
                        >
                            <span>🧠 {t('chat.prepareIndex.label')}</span>
                            {indexBadge && indexBadge.missing > 0 && (
                                <span style={{ fontSize: 10, color: 'var(--color-warning)' }}>
                                    {indexBadge.missing}
                                </span>
                            )}
                        </button>

                        <div style={{ height: 1, background: 'var(--color-border-hover)', margin: '4px 0' }} />

                        {/* Toggles */}
                        <button onClick={onToggleReranker} style={itemStyle}
                                title={rerankerOn
                                    ? 'Reranker açık — retrieve top-20 → LLM alaka sıralaması. Daha iyi, +1 LLM çağrısı.'
                                    : 'Reranker kapalı — doğrudan top-8. Daha hızlı.'}>
                            <span>Rerank</span>
                            <span style={toggleBadge(rerankerOn)}>
                                {rerankerOn ? t('chat.toggle.on') : t('chat.toggle.off')}
                            </span>
                        </button>
                        <button onClick={onToggleQueryRewrite} style={itemStyle}
                                title={queryRewriteOn
                                    ? 'Sorgu zenginleştirme — kısa sorguya eş anlamlı eklenir (+1 LLM çağrısı, ~0.5sn).'
                                    : 'Sorgu zenginleştirme kapalı.'}>
                            <span>{t('chat.queryRewrite.label')}</span>
                            <span style={toggleBadge(queryRewriteOn)}>
                                {queryRewriteOn ? t('chat.toggle.on') : t('chat.toggle.off')}
                            </span>
                        </button>
                        <button onClick={onToggleThinking} style={itemStyle}
                                title={showThinking
                                    ? 'Modelin düşünme süreci cevabın üstünde (katlanabilir) gösterilir.'
                                    : 'Düşünme süreci gizli — yalnız cevap gösterilir (varsayılan).'}>
                            <span>Düşünme</span>
                            <span style={toggleBadge(showThinking)}>
                                {showThinking ? t('chat.toggle.on') : t('chat.toggle.off')}
                            </span>
                        </button>

                        <div style={{ height: 1, background: 'var(--color-border-hover)', margin: '4px 0' }} />

                        {/* Actions */}
                        {scope.type !== 'assets' && (
                            <button onClick={() => { setMenuOpen(false); onPickerOpen(); }} style={itemStyle}>
                                <span>📎 {t('chat.synthesis.pickButton')}</span>
                            </button>
                        )}
                        {hasMessages && (
                            <button onClick={() => { setMenuOpen(false); onExport(); }} style={itemStyle}
                                    title={t('chat.export.tooltip')}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Download size={13} /> {t('chat.export.button')}
                                </span>
                            </button>
                        )}
                        <button onClick={() => { setMenuOpen(false); onHelpOpen(); }} style={itemStyle}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <HelpCircle size={13} /> {t('chat.help.button')}
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

import type { ReactNode } from 'react';
import { DEFAULT_CHAT_MODEL } from '../../services/ollamaService';

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div style={{ marginBottom: 18 }}>
            <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--color-accent-hover)',
                letterSpacing: '0.04em', textTransform: 'uppercase',
                marginBottom: 8, borderBottom: '1px solid var(--color-border-hover)', paddingBottom: 4,
            }}>{title}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-secondary)' }}>{children}</div>
        </div>
    );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div style={{ marginBottom: 8 }}>
            <span style={{
                display: 'inline-block', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)',
                padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                marginRight: 8, fontFamily: 'monospace',
            }}>{label}</span>
            <span>{children}</span>
        </div>
    );
}

export default function ChatHelpOverlay({ onClose, t }: { onClose: () => void; t: (key: string, fallback?: string) => string }) {
    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
                zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--color-bg-modal)', color: 'var(--color-text-primary)', width: 'min(720px, 92vw)',
                    maxHeight: '85vh', overflowY: 'scroll', borderRadius: 10,
                    padding: 24, border: '1px solid var(--color-border-hover)',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'var(--scrollbar-thumb) var(--color-bg-modal)',
                }}
                className="chat-help-scroll"
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <strong style={{ fontSize: 18 }}>{t('chat.help.title')}</strong>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-hover)',
                            padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
                        }}
                    >{t('common.close')}</button>
                </div>

                <Section title={t('chat.help.glossary')}>
                    <Item label="Chunk">{t('chat.help.chunkDesc')}</Item>
                    <Item label="Embedding">{t('chat.help.embeddingDesc')}</Item>
                    <Item label="Metadata chunk">{t('chat.help.metaChunkDesc')}</Item>
                    <Item label="Citation">{t('chat.help.citationDesc')}</Item>
                    <Item label={t('chat.help.hallucination')}>{t('chat.help.hallucinationDesc')}</Item>
                    <Item label="LLM">{t('chat.help.llmDesc')}</Item>
                </Section>

                <Section title={t('chat.help.flowTitle')}>
                    {t('chat.help.flowDesc')}
                </Section>

                <Section title={t('chat.help.slashTitle')}>
                    <Item label="/görsel">
                        {t('chat.help.slashVisualDesc')}
                    </Item>
                </Section>

                <Section title={t('chat.help.badgesTitle')}>
                    <Item label={DEFAULT_CHAT_MODEL}>{t('chat.help.badgeModel')}</Item>
                    <Item label="Ollama">{t('chat.help.badgeOllama')}</Item>
                    <Item label="Rerank">{t('chat.help.badgeRerank')}</Item>
                    <Item label={t('chat.queryRewrite.label')}>{t('chat.help.badgeEnrich')}</Item>
                    <Item label={t('chat.scope.all')}>{t('chat.help.badgeScope')}</Item>
                </Section>

                <Section title={t('chat.help.indexTitle')}>
                    <Item label={t('chat.help.indexBtn')}>{t('chat.help.indexBtnDesc')}</Item>
                    <Item label={t('chat.help.metaBtn')}>{t('chat.help.metaBtnDesc')}</Item>
                    <Item label={t('chat.help.purgeBtn')}>{t('chat.help.purgeBtnDesc')}</Item>
                </Section>

                <Section title={t('chat.help.answerTitle')}>
                    <Item label={t('chat.help.citationChip')}>{t('chat.help.citationChipDesc')}</Item>
                    <Item label={t('chat.help.sourceCard')}>{t('chat.help.sourceCardDesc')}</Item>
                    <Item label={t('chat.help.stopBtn')}>{t('chat.help.stopBtnDesc')}</Item>
                </Section>

                <Section title={t('chat.help.sessionTitle')}>
                    <Item label={t('chat.help.newSession')}>{t('chat.help.newSessionDesc')}</Item>
                    <Item label={t('chat.help.deleteSession')}>{t('chat.help.deleteSessionDesc')}</Item>
                </Section>

                <Section title={t('chat.help.behaviorTitle')}>
                    <Item label={t('chat.help.antiHallucination')}>{t('chat.help.antiHallucinationDesc')}</Item>
                    <Item label={t('chat.help.conversationCtx')}>{t('chat.help.conversationCtxDesc')}</Item>
                    <Item label={t('chat.help.autoIndex')}>{t('chat.help.autoIndexDesc')}</Item>
                </Section>
            </div>
        </div>
    );
}

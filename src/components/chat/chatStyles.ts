import type React from 'react';

export type AssetChipMeta = { id: string; fileName: string; fileType: string };

export const chatStyles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
        display: 'flex', justifyContent: 'flex-end',
    },
    panel: {
        width: 'min(1100px, 95vw)', height: '100vh',
        background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
        display: 'flex', flexDirection: 'row',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
    },
    sidebar: {
        width: 240, borderRight: '1px solid var(--color-border-hover)',
        display: 'flex', flexDirection: 'column',
    },
    sidebarHeader: {
        padding: 12, display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', borderBottom: '1px solid var(--color-border-hover)',
    },
    newBtn: {
        background: 'var(--color-accent)', color: 'white', border: 'none',
        padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
    },
    sessionList: { flex: 1, overflowY: 'auto', padding: 6 },
    sessionItem: {
        padding: 8, borderRadius: 6, cursor: 'pointer',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 4,
    },
    sessionTitle: {
        fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', flex: 1,
    },
    delBtn: {
        background: 'transparent', color: 'var(--color-text-muted)', border: 'none',
        cursor: 'pointer', fontSize: 16, padding: '0 4px',
    },
    emptyHint: { padding: 16, fontSize: 12, opacity: 0.6, textAlign: 'center' },
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    mainHeader: {
        padding: 12, borderBottom: '1px solid var(--color-border-hover)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    modelBadge: {
        marginLeft: 10, padding: '2px 8px', background: 'var(--color-bg-tertiary)',
        borderRadius: 4, fontSize: 11, opacity: 0.8,
    },
    scopeSelect: {
        marginLeft: 6, padding: '2px 6px', background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border-hover)', borderRadius: 4, fontSize: 11,
        cursor: 'pointer', maxWidth: 180,
    },
    indexBadge: {
        marginLeft: 6, padding: '3px 8px',
        borderRadius: 4, fontSize: 11, fontWeight: 600,
        border: 'none', cursor: 'pointer',
    },
    closeBtn: {
        background: 'transparent', color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border-hover)', padding: '4px 12px',
        borderRadius: 6, cursor: 'pointer',
    },
    synthChipBar: {
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        padding: '8px 16px', borderBottom: '1px solid var(--color-border-hover)',
        background: 'var(--color-accent-subtle)',
    },
    synthLabel: {
        fontSize: 11, fontWeight: 600, color: 'var(--color-accent-hover)', marginRight: 4,
    },
    synthChip: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', background: 'var(--color-bg-tertiary)',
        border: '1px solid var(--color-accent)', borderRadius: 12, fontSize: 11,
        maxWidth: 260,
    },
    synthChipName: {
        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },
    synthChipType: {
        fontSize: 9, fontWeight: 700, opacity: 0.6,
        padding: '1px 4px', background: 'var(--color-bg-secondary)', borderRadius: 3,
    },
    synthChipRemove: {
        background: 'transparent', border: 'none', color: 'var(--color-danger)',
        cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, marginLeft: 2,
    },
    synthChipClear: {
        background: 'transparent', border: '1px solid var(--color-border-hover)',
        color: 'var(--color-text-muted)',
        cursor: 'pointer', padding: '2px 8px', fontSize: 10, borderRadius: 4,
        marginLeft: 4,
    },
    messages: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
    welcome: { padding: 32, textAlign: 'center', opacity: 0.85 },
    bubble: {
        maxWidth: '85%', padding: 12, borderRadius: 10,
        lineHeight: 1.5, fontSize: 14,
    },
    userBubble: { alignSelf: 'flex-end', background: 'var(--color-chat-user-bubble)' },
    assistantBubble: { alignSelf: 'flex-start', background: 'var(--color-bg-tertiary)' },
    bubbleContent: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    citationChipInline: {
        display: 'inline-block', background: 'var(--color-accent)', color: 'white',
        border: 'none', padding: '0 6px', borderRadius: 4, margin: '0 2px',
        fontSize: 11, cursor: 'pointer', fontWeight: 600,
    },
    citationsBlock: {
        marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6,
        paddingTop: 8, borderTop: '1px solid var(--color-border-hover)',
    },
    citationCard: {
        textAlign: 'left', background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-hover)', padding: 8, borderRadius: 6,
        cursor: 'pointer', color: 'var(--color-text-primary)',
    },
    inputRow: {
        padding: 12, borderTop: '1px solid var(--color-border-hover)',
        display: 'flex', gap: 8,
    },
    textarea: {
        flex: 1, minHeight: 50, maxHeight: 150,
        padding: 10, background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border-hover)', borderRadius: 6,
        fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
    },
    sendBtn: {
        background: 'var(--color-accent)', color: 'white', border: 'none',
        padding: '0 20px', borderRadius: 6, cursor: 'pointer',
        fontWeight: 600,
    },
    streamCursor: {
        display: 'inline-block',
        animation: 'blink 1s step-end infinite',
        opacity: 0.7,
        marginLeft: 1,
    },
    abortBtn: {
        marginTop: 8, background: 'transparent', color: 'var(--color-danger)',
        border: '1px solid var(--color-danger)', padding: '3px 10px', borderRadius: 4,
        cursor: 'pointer', fontSize: 11, fontWeight: 600,
    },
};

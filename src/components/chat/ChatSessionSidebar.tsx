import type { ChatSession } from '../../services/chatStorage';
import { chatStyles as styles } from './chatStyles';

interface ChatSessionSidebarProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
    onNewSession: () => void;
    onDeleteSession: (id: string) => void;
    /** Son silinen sohbet etiketi — undo banner için (null = banner gizli) */
    recentlyDeletedLabel?: string | null;
    onUndoDelete?: () => void;
    t: (key: string, fallback?: string) => string;
}

export default function ChatSessionSidebar({
    sessions,
    activeSessionId,
    onSelectSession,
    onNewSession,
    onDeleteSession,
    recentlyDeletedLabel,
    onUndoDelete,
    t,
}: ChatSessionSidebarProps) {
    return (
        <aside style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
                <span style={{ fontWeight: 600 }}>{t('chat.sessions.title')}</span>
                <button style={styles.newBtn} onClick={onNewSession}>+ {t('chat.sessions.new')}</button>
            </div>
            {recentlyDeletedLabel && onUndoDelete && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', margin: '4px 8px',
                    background: 'rgba(59,130,246,0.12)',
                    border: '1px solid rgba(59,130,246,0.35)',
                    borderRadius: 6,
                    fontSize: '0.72rem', color: 'var(--color-text-secondary)',
                    gap: 8,
                }}>
                    <span style={{
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                    }} title={recentlyDeletedLabel}>
                        {recentlyDeletedLabel}
                    </span>
                    <button
                        onClick={onUndoDelete}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-accent)', fontSize: '0.72rem', fontWeight: 600,
                            padding: '2px 6px', borderRadius: 4,
                        }}
                    >{t('undo.action', 'Geri al')}</button>
                </div>
            )}
            <div style={styles.sessionList}>
                {sessions.length === 0 && (
                    <div style={styles.emptyHint}>{t('chat.sessions.empty')}</div>
                )}
                {sessions.map((s) => (
                    <div
                        key={s.id}
                        style={{
                            ...styles.sessionItem,
                            background: s.id === activeSessionId ? 'var(--color-accent-glow)' : 'transparent',
                        }}
                        onClick={() => onSelectSession(s.id)}
                    >
                        <div style={styles.sessionTitle}>{s.title}</div>
                        <button
                            style={styles.delBtn}
                            onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                            title={t('common.delete')}
                        >×</button>
                    </div>
                ))}
            </div>
        </aside>
    );
}

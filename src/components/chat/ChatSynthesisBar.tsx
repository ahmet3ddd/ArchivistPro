import type { AssetChipMeta } from './chatStyles';
import { chatStyles as styles } from './chatStyles';

interface ChatSynthesisBarProps {
    assetChips: AssetChipMeta[];
    onRemoveChip: (id: string) => void;
    onClearAll: () => void;
    t: (key: string, fallback?: string) => string;
}

export default function ChatSynthesisBar({ assetChips, onRemoveChip, onClearAll, t }: ChatSynthesisBarProps) {
    return (
        <div style={styles.synthChipBar}>
            <span style={styles.synthLabel}>
                {t('chat.synthesis.chipBarLabel')}
            </span>
            {assetChips.map((c) => (
                <span key={c.id} style={styles.synthChip} title={c.fileName}>
                    <span style={styles.synthChipName}>{c.fileName}</span>
                    <span style={styles.synthChipType}>{c.fileType}</span>
                    <button
                        style={styles.synthChipRemove}
                        onClick={() => onRemoveChip(c.id)}
                        title={t('chat.synthesis.removeChip')}
                    >×</button>
                </span>
            ))}
            <button
                style={styles.synthChipClear}
                onClick={onClearAll}
                title={t('chat.synthesis.clearAll')}
            >
                {t('chat.synthesis.exit')}
            </button>
            {assetChips.length >= 10 && (
                <span style={{
                    marginLeft: 4, padding: '2px 8px',
                    background: 'var(--color-status-warn-bg)', color: 'var(--color-status-warn-text)',
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                }}>
                    ⚠ {t('chat.synthesis.maxDocsWarning')}
                </span>
            )}
        </div>
    );
}

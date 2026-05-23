import { useTranslation } from 'react-i18next';
import { Database, Archive } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { ArchiveDef } from '../../services/database';

export default function ArchiveButton({ archive }: { archive: ArchiveDef }) {
    const { t } = useTranslation();
    const activeArchive = useStore((s) => s.activeArchive);
    const setActiveArchive = useStore((s) => s.setActiveArchive);
    const isBlockedFromMain = useStore((s) => s.isBlockedFromMain);
    const isActive = activeArchive === archive.id;
    const isDisabled = archive.type === 'shared' && isBlockedFromMain;
    const color = archive.color || 'var(--color-accent)';

    return (
        <button
            onClick={() => { if (isDisabled) return; setActiveArchive(archive.id); }}
            disabled={isDisabled}
            title={isDisabled ? t('sidebar.archive.blocked') : archive.name}
            style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '6px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: isActive ? 600 : 400,
                border: `1px solid ${isDisabled ? 'var(--color-border)' : isActive ? color : 'var(--color-border)'}`,
                background: isDisabled ? 'rgba(255,255,255,0.02)' : isActive ? `${color}1a` : 'transparent',
                color: isDisabled ? 'var(--color-text-muted)' : isActive ? color : 'var(--color-text-muted)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
            }}
        >
            {archive.type === 'shared' ? <Database size={12} /> : <Archive size={12} />}
            {archive.name}
        </button>
    );
}

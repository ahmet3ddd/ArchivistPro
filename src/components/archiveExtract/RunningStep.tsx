import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { ExtractProgress } from '../../services/archiveOps';

export default function RunningStep({ progress }: { progress: ExtractProgress }) {
    const { t } = useTranslation();
    const phaseLabel = t(`extract.progress.phase.${progress.phase}`, { defaultValue: progress.phase });
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: 24 }}>
            <Loader2 size={32} className="spinner" style={{ color: 'var(--color-accent)' }} />
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{phaseLabel}</div>
            {progress.total > 0 && (
                <>
                    <div style={{ width: '100%', height: 6, background: 'var(--color-bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 0.2s' }} />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        {progress.current} / {progress.total}
                    </div>
                </>
            )}
        </div>
    );
}

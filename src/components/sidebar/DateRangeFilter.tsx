/**
 * Tarih Aralığı Filtresi — Faz 4.4
 * Başlangıç/bitiş tarih seçici ile modifiedAt bazlı filtreleme.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useStore } from '../../store/useStore';

export default function DateRangeFilter() {
    const { t } = useTranslation();
    const dateRangeFilter = useStore((s) => s.dateRangeFilter);
    const setDateRangeFilter = useStore((s) => s.setDateRangeFilter);
    const clearDateRangeFilter = useStore((s) => s.clearDateRangeFilter);
    const [expanded, setExpanded] = useState(false);

    const hasFilter = dateRangeFilter.from !== null || dateRangeFilter.to !== null;

    return (
        <div>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '6px 10px', borderRadius: 6, fontSize: '0.72rem',
                    border: `1px solid ${hasFilter ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: hasFilter ? 'rgba(99,102,241,0.08)' : 'transparent',
                    color: hasFilter ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    cursor: 'pointer', fontWeight: hasFilter ? 600 : 400,
                }}
                title={t('dateRange.title')}
            >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {t('dateRange.title')}
                {hasFilter && (
                    <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); clearDateRangeFilter(); }}
                        title={t('dateRange.clear')}
                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--color-text-muted)', padding: 2 }}
                    >
                        <X size={12} />
                    </span>
                )}
            </button>

            {expanded && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        type="date"
                        value={dateRangeFilter.from ?? ''}
                        onChange={(e) => setDateRangeFilter({ ...dateRangeFilter, from: e.target.value || null })}
                        style={inputStyle}
                        title={t('dateRange.from')}
                    />
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>—</span>
                    <input
                        type="date"
                        value={dateRangeFilter.to ?? ''}
                        onChange={(e) => setDateRangeFilter({ ...dateRangeFilter, to: e.target.value || null })}
                        style={inputStyle}
                        title={t('dateRange.to')}
                    />
                </div>
            )}
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 100, maxWidth: 130,
    padding: '4px 8px', fontSize: '0.7rem',
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
};

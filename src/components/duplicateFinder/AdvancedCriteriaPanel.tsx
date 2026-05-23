import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { ComparisonCriteria, PerformanceFilters, DuplicateScanResult } from '../../services/duplicateDetection';
import type { SizeTolerance } from '../../services/duplicateDetection';
import { CRITERIA_SECTIONS, FORMAT_GROUPS, type FormatGroupKey, type BoolCriterionKey } from './duplicateHelpers';

interface AdvancedCriteriaPanelProps {
    criteria: ComparisonCriteria;
    updateCriteria: <K extends keyof ComparisonCriteria>(key: K, value: ComparisonCriteria[K]) => void;
    performance: PerformanceFilters | undefined;
    updatePerformance: <K extends keyof PerformanceFilters>(key: K, value: PerformanceFilters[K]) => void;
    enabledFormats: Set<FormatGroupKey>;
    toggleFormatGroup: (key: FormatGroupKey) => void;
    result: DuplicateScanResult | null;
    lastScannedCriteria: ComparisonCriteria | null;
    lastScannedPerf: PerformanceFilters | null;
    /** ref for outside-click detection */
    panelRef: React.RefObject<HTMLDivElement | null>;
    panelPos: { top: number; left: number };
}

export default function AdvancedCriteriaPanel({
    criteria, updateCriteria, performance, updatePerformance,
    enabledFormats, toggleFormatGroup,
    result, lastScannedCriteria, lastScannedPerf,
    panelRef, panelPos,
}: AdvancedCriteriaPanelProps) {
    const { t } = useTranslation();

    return (
        <div ref={panelRef} style={{
            position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 10000,
            background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
            width: 460, padding: '14px 16px',
            maxHeight: `calc(100vh - ${panelPos.top + 16}px)`,
            overflowY: 'auto', overscrollBehavior: 'contain',
        }}>
            {/* ── Bölüm 1: Genel Kriterler ── */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    {t('duplicateFinder.generalCriteria')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    {t('duplicateFinder.generalCriteriaHint')}
                </div>
                {/* Boyut */}
                <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
                        <input type="checkbox" checked={criteria.sameSize}
                            onChange={e => updateCriteria('sameSize', e.target.checked)}
                            style={{ accentColor: 'var(--color-accent)' }} />
                        {t('duplicateFinder.critSameSize')}
                    </label>
                    {criteria.sameSize && (
                        <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>{t('duplicateFinder.sizeTolerance')}:</span>
                            <select value={criteria.sizeTolerance}
                                onChange={e => updateCriteria('sizeTolerance', e.target.value as SizeTolerance)}
                                style={{ fontSize: '0.78rem', padding: '3px 6px', borderRadius: 4, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                                <option value="exact">{t('duplicateFinder.tolExact')}</option>
                                <option value="1kb">{t('duplicateFinder.tol1kb')}</option>
                                <option value="1percent">{t('duplicateFinder.tol1percent')}</option>
                            </select>
                        </div>
                    )}
                </div>
                {/* Tarih penceresi */}
                <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
                        <input type="checkbox" checked={criteria.sameModifiedWithinDays > 0}
                            onChange={e => updateCriteria('sameModifiedWithinDays', e.target.checked ? 7 : 0)}
                            style={{ accentColor: 'var(--color-accent)' }} />
                        {t('duplicateFinder.critModifiedWithin')}
                    </label>
                    {criteria.sameModifiedWithinDays > 0 && (
                        <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="number" min={1} max={365} value={criteria.sameModifiedWithinDays}
                                onChange={e => updateCriteria('sameModifiedWithinDays', Math.max(1, Number(e.target.value) || 1))}
                                style={{ width: 60, fontSize: '0.78rem', padding: '3px 6px', borderRadius: 4, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
                            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>{t('duplicateFinder.days')}</span>
                        </div>
                    )}
                </div>
                {/* Parent klasör */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
                    <input type="checkbox" checked={criteria.sameParentFolder}
                        onChange={e => updateCriteria('sameParentFolder', e.target.checked)}
                        style={{ accentColor: 'var(--color-accent)' }} />
                    {t('duplicateFinder.critSameParentFolder')}
                </label>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', marginBottom: 14 }} />

            {/* ── Bölüm 2: Format-Spesifik Kriterler ── */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    {t('duplicateFinder.formatCriteria')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                    {t('duplicateFinder.formatCriteriaHint')}
                </div>
                {CRITERIA_SECTIONS.map(section => (
                    <div key={section.label} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{section.label}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', paddingLeft: 4 }}>
                            {section.items.map(item => (
                                <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.82rem' }}>
                                    <input type="checkbox" checked={criteria[item.key as BoolCriterionKey]}
                                        onChange={e => updateCriteria(item.key, e.target.checked)}
                                        style={{ accentColor: 'var(--color-accent)' }} />
                                    {t(`duplicateFinder.${item.labelKey}`)}
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', marginBottom: 14 }} />

            {/* ── Bölüm 3: Performans Filtreleri ── */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    {t('duplicateFinder.performanceFilters')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>{t('duplicateFinder.performanceFiltersHint')}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
                    <input type="checkbox" checked={(performance?.minFileSizeKb ?? 0) > 0}
                        onChange={e => updatePerformance('minFileSizeKb', e.target.checked ? 100 : 0)}
                        style={{ accentColor: 'var(--color-accent)' }} />
                    {t('duplicateFinder.minFileSize')}
                </label>
                {(performance?.minFileSizeKb ?? 0) > 0 && (
                    <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="number" min={1} max={1024 * 1024} value={performance?.minFileSizeKb ?? 100}
                            onChange={e => updatePerformance('minFileSizeKb', Math.max(1, Number(e.target.value) || 1))}
                            style={{ width: 90, fontSize: '0.78rem', padding: '3px 6px', borderRadius: 4, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
                        <span style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>KB</span>
                    </div>
                )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', marginBottom: 14 }} />

            {/* ── Format Görünürlük Filtresi ── */}
            <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    {t('duplicateFinder.formatFilters')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>{t('duplicateFinder.formatFiltersHint')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {FORMAT_GROUPS.map(fg => (
                        <label key={fg.key} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.83rem' }}>
                            <input type="checkbox" checked={enabledFormats.has(fg.key)}
                                onChange={() => toggleFormatGroup(fg.key)}
                                style={{ accentColor: 'var(--color-accent)' }} />
                            {t(`duplicateFinder.${fg.labelKey}`)}
                        </label>
                    ))}
                </div>
            </div>

            {/* Yeniden tarama uyarısı */}
            {result && lastScannedCriteria && lastScannedPerf && (
                (Object.keys(criteria) as (keyof ComparisonCriteria)[]).some(k => criteria[k] !== lastScannedCriteria[k]) ||
                (performance?.minFileSizeKb ?? 0) !== lastScannedPerf.minFileSizeKb
            ) && (
                <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--color-warning)' }}>
                    <AlertTriangle size={12} />
                    {t('duplicateFinder.criteriaRescanNeeded')}
                </div>
            )}
        </div>
    );
}

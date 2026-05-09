import { useTranslation } from 'react-i18next';
import type { ConfigStepProps } from './extractTypes';
import { FilterSection, CheckChip, CheckboxOption } from './extractHelpers';

const COMMON_FILE_TYPES = ['DWG', 'PDF', 'MAX', 'SKP', 'PSD', 'JPEG', 'PNG', 'RVT', 'IFC', '3DM', 'DOC', 'XLS', 'MP4'];
const PROJECT_PHASES = ['Konsept', 'Avan', 'Ruhsat', 'Uygulama'];

export default function ConfigStep(p: ConfigStepProps) {
    const { t } = useTranslation();

    const toggleSet = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
        const next = new Set(set);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        setter(next);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Kaynak */}
            <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
                    {t('extract.source')}
                </label>
                <select value={p.sourceId} onChange={(e) => p.setSourceId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.82rem' }}>
                    <option value="">—</option>
                    {p.archives.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>

            {/* Filtre Kriterleri */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 8 }}>{t('extract.filter.title')}</div>
                <FilterSection label={t('extract.filter.folders')} count={p.selectedFolders.size}
                    expanded={p.expandFolders} onToggle={() => p.setExpandFolders(!p.expandFolders)}>
                    {p.scannedRoots.length === 0 ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{t('extract.filter.noneSelected')}</div>
                    ) : p.scannedRoots.map(root => (
                        <CheckChip key={root.id} checked={p.selectedFolders.has(root.path)}
                            onClick={() => toggleSet(p.selectedFolders, root.path, p.setSelectedFolders)}
                            label={`${root.label} (${root.fileCount})`} />
                    ))}
                </FilterSection>
                <FilterSection label={t('extract.filter.fileTypes')} count={p.selectedFileTypes.size}
                    expanded={p.expandFileTypes} onToggle={() => p.setExpandFileTypes(!p.expandFileTypes)}>
                    {COMMON_FILE_TYPES.map(ft => (
                        <CheckChip key={ft} checked={p.selectedFileTypes.has(ft)}
                            onClick={() => toggleSet(p.selectedFileTypes, ft, p.setSelectedFileTypes)} label={ft} />
                    ))}
                </FilterSection>
                <FilterSection label={t('extract.filter.projectPhases')} count={p.selectedPhases.size}
                    expanded={p.expandPhases} onToggle={() => p.setExpandPhases(!p.expandPhases)}>
                    {PROJECT_PHASES.map(ph => (
                        <CheckChip key={ph} checked={p.selectedPhases.has(ph)}
                            onClick={() => toggleSet(p.selectedPhases, ph, p.setSelectedPhases)} label={ph} />
                    ))}
                </FilterSection>
                <FilterSection label={t('extract.filter.dateRange')} count={(p.dateFrom ? 1 : 0) + (p.dateTo ? 1 : 0)}
                    expanded={p.expandDates} onToggle={() => p.setExpandDates(!p.expandDates)}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="date" value={p.dateFrom} onChange={(e) => p.setDateFrom(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.76rem' }} />
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        <input type="date" value={p.dateTo} onChange={(e) => p.setDateTo(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.76rem' }} />
                    </div>
                </FilterSection>
                <FilterSection label={t('extract.filter.tags')} count={p.selectedTags.size}
                    expanded={p.expandTags} onToggle={() => p.setExpandTags(!p.expandTags)}>
                    {p.availableTags.length === 0 ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{t('extract.filter.noneSelected')}</div>
                    ) : p.availableTags.map(tag => (
                        <CheckChip key={tag.id} checked={p.selectedTags.has(tag.name)}
                            onClick={() => toggleSet(p.selectedTags, tag.name, p.setSelectedTags)}
                            label={tag.name} color={tag.color} />
                    ))}
                </FilterSection>
            </div>

            {/* Hedef */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>{t('extract.target.title')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
                        <input type="radio" checked={p.targetMode === 'new'} onChange={() => p.setTargetMode('new')}
                            style={{ accentColor: 'var(--color-accent)' }} />
                        {t('extract.target.new')}
                    </label>
                    {p.targetMode === 'new' && (
                        <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input type="text" placeholder={t('extract.target.newName')} value={p.newArchiveName}
                                onChange={(e) => p.setNewArchiveName(e.target.value)}
                                style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.82rem' }} />
                            {p.isAdmin && (
                                <div style={{ display: 'flex', gap: 12 }}>
                                    {(['personal', 'shared'] as const).map(type => (
                                        <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', cursor: 'pointer' }}>
                                            <input type="radio" checked={p.newArchiveType === type}
                                                onChange={() => p.setNewArchiveType(type)}
                                                style={{ accentColor: 'var(--color-accent)' }} />
                                            {t(`extract.target.type${type.charAt(0).toUpperCase()}${type.slice(1)}`)}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
                        <input type="radio" checked={p.targetMode === 'existing'} onChange={() => p.setTargetMode('existing')}
                            style={{ accentColor: 'var(--color-accent)' }} />
                        {t('extract.target.existing')}
                    </label>
                    {p.targetMode === 'existing' && (
                        <select value={p.existingTargetId} onChange={(e) => p.setExistingTargetId(e.target.value)}
                            style={{ marginLeft: 24, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.82rem' }}>
                            <option value="">—</option>
                            {p.availableTargets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {/* Mod */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>{t('extract.mode.title')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
                        <input type="radio" checked={p.mode === 'copy'} onChange={() => p.setMode('copy')}
                            style={{ accentColor: 'var(--color-accent)' }} />
                        {t('extract.mode.copy')}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem', color: '#ef4444' }}>
                        <input type="radio" checked={p.mode === 'move'} onChange={() => p.setMode('move')}
                            style={{ accentColor: '#ef4444' }} />
                        {t('extract.mode.move')}
                    </label>
                </div>
                {p.mode === 'move' && (
                    <div style={{ marginTop: 6, padding: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: '0.74rem', color: '#fca5a5' }}>
                        {t('extract.mode.moveWarning')}
                    </div>
                )}
            </div>

            {/* Include */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>{t('extract.include.title')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CheckboxOption checked={p.includeTags} onChange={p.setIncludeTags} label={t('extract.include.tags')} />
                    <CheckboxOption checked={p.includeEmbeddings} onChange={p.setIncludeEmbeddings} label={t('extract.include.embeddings')} />
                    <CheckboxOption checked={p.includeTextChunks} onChange={p.setIncludeTextChunks} label={t('extract.include.textChunks')} />
                    <CheckboxOption checked={p.includeSummaries} onChange={p.setIncludeSummaries} label={t('extract.include.summaries')} />
                    <CheckboxOption checked={p.includeFavorites} onChange={p.setIncludeFavorites} label={t('extract.include.favorites')} />
                </div>
            </div>
        </div>
    );
}

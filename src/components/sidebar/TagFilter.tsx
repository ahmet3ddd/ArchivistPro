import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useIsAdmin } from '../../permissions';
import { commandDeleteTag } from '../../services/undoCommands';

export default function TagFilter() {
    const { t: _t } = useTranslation();
    const scannedAssets = useStore((s) => s.scannedAssets);
    const activeTagFilters = useStore((s) => s.activeTagFilters);
    const toggleTagFilter = useStore((s) => s.toggleTagFilter);
    const clearTagFilters = useStore((s) => s.clearTagFilters);
    const isAdmin = useIsAdmin();
    const activeArchive = useStore((s) => s.activeArchive);
    const canManageTags = isAdmin || activeArchive !== 'main';
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState('');
    const [hoveredTagId, setHoveredTagId] = useState<number | null>(null);

    const handleDeleteTag = useCallback((e: React.MouseEvent, tagId: number, tagName: string) => {
        e.stopPropagation();
        if (!confirm(_t('tagManagement.deleteConfirm', { name: tagName }))) return;
        const refreshAll = () => {
            useStore.getState().setScannedAssets((prev) =>
                prev.map(a => ({ ...a, userTags: (a.userTags ?? []).filter(t => t.id !== tagId) }))
            );
        };
        void commandDeleteTag(tagId, tagName, refreshAll);
    }, [_t]);

    const tagStats = useMemo(() => {
        const map = new Map<number, { id: number; name: string; color: string; count: number }>();
        for (const a of scannedAssets) {
            for (const t of a.userTags ?? []) {
                const cur = map.get(t.id);
                if (cur) cur.count++;
                else map.set(t.id, { id: t.id, name: t.name, color: t.color, count: 1 });
            }
        }
        const arr = [...map.values()];
        arr.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'tr'));
        return arr;
    }, [scannedAssets]);

    const visible = useMemo(() => {
        if (!query.trim()) return tagStats;
        const q = query.trim().toLowerCase();
        return tagStats.filter((t) => t.name.toLowerCase().includes(q));
    }, [tagStats, query]);

    const activeCount = activeTagFilters.length;
    const totalTags = tagStats.length;

    if (totalTags === 0 && !expanded) {
        return (
            <div style={{ padding: '6px 10px', fontSize: '0.7rem', opacity: 0.5, color: 'var(--color-text-muted)' }}>
                Henüz etiket yok
            </div>
        );
    }

    return (
        <div>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '6px 10px', borderRadius: 6, fontSize: '0.72rem',
                    border: `1px solid ${activeCount > 0 ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: activeCount > 0 ? 'rgba(99,102,241,0.08)' : 'transparent',
                    color: activeCount > 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    cursor: 'pointer', fontWeight: activeCount > 0 ? 600 : 400,
                }}
                title={activeCount > 0 ? `${activeCount} etiket aktif` : 'Etiket ile filtrele'}
            >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Etiketler
                {activeCount > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.66rem', background: 'var(--color-accent)', color: '#fff', padding: '0 6px', borderRadius: 8 }}>{activeCount}</span>
                )}
                {activeCount === 0 && totalTags > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.66rem', opacity: 0.6 }}>{totalTags}</span>
                )}
            </button>
            {expanded && (
                <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder="Etiket ara…"
                            style={{ flex: 1, minWidth: 0, padding: '4px 8px', fontSize: '0.7rem', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 4 }} />
                        {canManageTags && totalTags > 0 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); useStore.getState().setIsTagManagerOpen(true); }}
                                title={_t('tagManager.title')}
                                style={{ background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '3px 6px', borderRadius: 4, fontSize: '0.66rem', flexShrink: 0, transition: 'color 0.15s, border-color 0.15s' }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                            >
                                ⚙
                            </button>
                        )}
                    </div>
                    {activeCount > 0 && (
                        <button onClick={clearTagFilters} style={{ fontSize: '0.66rem', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', marginBottom: 4, textDecoration: 'underline' }}>
                            Seçimi temizle ({activeCount})
                        </button>
                    )}
                    <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible.length === 0 ? (
                            <div style={{ fontSize: '0.66rem', opacity: 0.5, padding: 4 }}>Eşleşen etiket yok</div>
                        ) : visible.map((tag) => {
                            const isActive = activeTagFilters.includes(tag.id);
                            const isHovered = hoveredTagId === tag.id;
                            return (
                                <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}
                                    onMouseEnter={() => setHoveredTagId(tag.id)}
                                    onMouseLeave={() => setHoveredTagId(null)}>
                                    <button onClick={() => toggleTagFilter(tag.id)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                                            padding: '3px 8px', borderRadius: 4,
                                            background: isActive ? `${tag.color}22` : 'transparent',
                                            border: `1px solid ${isActive ? tag.color : 'transparent'}`,
                                            color: isActive ? tag.color : 'var(--color-text-secondary)',
                                            cursor: 'pointer', fontSize: '0.7rem', textAlign: 'left',
                                        }}
                                        title={`${tag.name} (${tag.count} dosya)`}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag.name}</span>
                                        <span style={{ fontSize: '0.62rem', opacity: 0.6 }}>{tag.count}</span>
                                    </button>
                                    {canManageTags && isHovered && (
                                        <button onClick={(e) => handleDeleteTag(e, tag.id, tag.name)}
                                            title={_t('tagManagement.delete', { name: tag.name })}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--color-text-muted)', opacity: 0.6, flexShrink: 0 }}>
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

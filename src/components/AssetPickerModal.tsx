/**
 * AssetPickerModal — RAG sentez için belge seçici.
 *
 * Sadece `rag_status='indexed'` (chunk_text embedding'i olan) belgeler gösterilir.
 * Çoklu seçim, arama, dosya tipi filtresi. Onay → seçilen asset ID listesi callback.
 *
 * Soft cap: 10 belge — üstünde sarı uyarı. Alt limit 1.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeRagIndex, type RagAssetStatus } from '../services/ragIndexStatus';
import { useTranslation } from 'react-i18next';

interface Props {
    isOpen: boolean;
    initialSelected?: string[];     // önceden seçili asset ID'ler
    onClose: () => void;
    onConfirm: (assetIds: string[]) => void;
    maxSoftCap?: number;            // varsayılan 10
}

const DEFAULT_MAX = 10;

export default function AssetPickerModal({
    isOpen,
    initialSelected = [],
    onClose,
    onConfirm,
    maxSoftCap = DEFAULT_MAX,
}: Props) {
    const { t } = useTranslation();
    const [indexed, setIndexed] = useState<RagAssetStatus[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
    const [filter, setFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>(''); // '' = tüm tipler

    // Modal açıldığında indexed asset'leri yükle
    useEffect(() => {
        if (!isOpen) return;
        const report = analyzeRagIndex();
        setIndexed(report.indexedAssets);
        setSelected(new Set(initialSelected));
        setFilter('');
        setTypeFilter('');
    }, [isOpen, initialSelected]);

    const availableTypes = useMemo(() => {
        const types = new Set<string>();
        for (const a of indexed) types.add(a.fileType);
        return [...types].sort();
    }, [indexed]);

    const filtered = useMemo(() => {
        const q = filter.trim().toLocaleLowerCase('tr');
        return indexed.filter((a) => {
            if (typeFilter && a.fileType !== typeFilter) return false;
            if (!q) return true;
            return (
                a.fileName.toLocaleLowerCase('tr').includes(q) ||
                a.filePath.toLocaleLowerCase('tr').includes(q)
            );
        });
    }, [indexed, filter, typeFilter]);

    const toggleOne = useCallback((assetId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(assetId)) next.delete(assetId);
            else next.add(assetId);
            return next;
        });
    }, []);

    const selectAllFiltered = useCallback(() => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const a of filtered) next.add(a.assetId);
            return next;
        });
    }, [filtered]);

    const clearAll = useCallback(() => setSelected(new Set()), []);

    const handleConfirm = () => {
        if (selected.size === 0) return;
        onConfirm([...selected]);
    };

    if (!isOpen) return null;

    const overCap = selected.size > maxSoftCap;

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <header style={styles.header}>
                    <div>
                        <h3 style={{ margin: 0 }}>
                            {t('assetPicker.title')}
                        </h3>
                        <div style={styles.subtitle}>
                            {t('assetPicker.subtitle')}
                        </div>
                    </div>
                    <button style={styles.closeBtn} onClick={onClose}>
                        {t('common.close')}
                    </button>
                </header>

                <div style={styles.toolbar}>
                    <input
                        type="text"
                        placeholder={t('assetPicker.searchPlaceholder')}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={styles.search}
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        style={styles.typeSelect}
                        title={t('assetPicker.typeFilterTitle')}
                    >
                        <option value="">
                            {t('assetPicker.allTypes')} ({indexed.length})
                        </option>
                        {availableTypes.map((ty) => (
                            <option key={ty} value={ty}>{ty}</option>
                        ))}
                    </select>
                    <button style={styles.linkBtn} onClick={selectAllFiltered}>
                        {t('assetPicker.selectFiltered')}
                    </button>
                    <button style={styles.linkBtn} onClick={clearAll}>
                        {t('assetPicker.clear')}
                    </button>
                </div>

                <div style={styles.list}>
                    {indexed.length === 0 && (
                        <div style={styles.empty}>
                            {t('assetPicker.empty')}
                        </div>
                    )}
                    {indexed.length > 0 && filtered.length === 0 && (
                        <div style={styles.empty}>
                            {t('assetPicker.noResults')}
                        </div>
                    )}
                    {filtered.map((a) => {
                        const isSelected = selected.has(a.assetId);
                        return (
                            <label
                                key={a.assetId}
                                style={{
                                    ...styles.row,
                                    background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleOne(a.assetId)}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={styles.fileName}>{a.fileName}</div>
                                    <div style={styles.filePath}>{a.filePath}</div>
                                </div>
                                <span style={styles.typeBadge}>{a.fileType}</span>
                                <span style={styles.chunkBadge} title={t('assetPicker.chunkCount')}>
                                    {a.chunkCount}
                                </span>
                            </label>
                        );
                    })}
                </div>

                <footer style={styles.footer}>
                    <div style={styles.counter}>
                        <strong>{selected.size}</strong> {t('assetPicker.selected')}
                        {overCap && (
                            <span style={styles.warnText}>
                                {t('assetPicker.capWarning')}: {maxSoftCap}
                            </span>
                        )}
                    </div>
                    <div style={styles.actions}>
                        <button style={styles.btnSecondary} onClick={onClose}>
                            {t('common.cancel')}
                        </button>
                        <button
                            style={{
                                ...styles.btnPrimary,
                                opacity: selected.size === 0 ? 0.4 : 1,
                                cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                            }}
                            onClick={handleConfirm}
                            disabled={selected.size === 0}
                        >
                            {selected.size >= 2
                                ? t('assetPicker.confirmSynth', { count: selected.size })
                                : t('assetPicker.confirmFocus', { count: selected.size })}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
        width: 'min(780px, 95vw)', maxHeight: '85vh',
        background: '#1a202c', color: '#e2e8f0',
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    },
    header: {
        padding: 16, borderBottom: '1px solid #2d3748',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    },
    subtitle: { fontSize: 12, opacity: 0.7, marginTop: 6 },
    closeBtn: {
        background: 'transparent', color: '#a0aec0',
        border: '1px solid #4a5568', padding: '4px 12px',
        borderRadius: 6, cursor: 'pointer',
    },
    toolbar: {
        padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center',
        borderBottom: '1px solid #2d3748', flexWrap: 'wrap',
    },
    search: {
        flex: 1, minWidth: 160, padding: '6px 10px', background: '#2d3748',
        color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 6, fontSize: 13,
    },
    typeSelect: {
        padding: '6px 10px', background: '#2d3748', color: '#e2e8f0',
        border: '1px solid #4a5568', borderRadius: 6, fontSize: 13,
    },
    linkBtn: {
        background: 'transparent', color: '#6366f1', border: 'none',
        cursor: 'pointer', fontSize: 12, padding: '4px 8px',
    },
    list: { flex: 1, overflowY: 'auto', padding: 6, minHeight: 200 },
    empty: { padding: 30, textAlign: 'center', opacity: 0.6, fontSize: 13 },
    row: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 8, borderRadius: 6, cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
    },
    fileName: {
        fontSize: 13, fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    },
    filePath: { fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    typeBadge: {
        background: '#2d3748', color: '#a0aec0',
        padding: '2px 8px', borderRadius: 4, fontSize: 10,
        fontWeight: 600, textTransform: 'uppercase',
    },
    chunkBadge: {
        background: '#22543d', color: '#9ae6b4',
        padding: '2px 8px', borderRadius: 4, fontSize: 10,
        fontWeight: 600, minWidth: 26, textAlign: 'center',
    },
    footer: {
        padding: 12, borderTop: '1px solid #2d3748',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    },
    counter: { fontSize: 13, display: 'flex', gap: 12, alignItems: 'center' },
    warnText: { fontSize: 11, color: '#f6ad55' },
    actions: { display: 'flex', gap: 8 },
    btnSecondary: {
        background: 'transparent', color: '#a0aec0',
        border: '1px solid #4a5568', padding: '6px 14px',
        borderRadius: 6, cursor: 'pointer', fontSize: 13,
    },
    btnPrimary: {
        background: '#6366f1', color: '#fff', border: 'none',
        padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    },
};

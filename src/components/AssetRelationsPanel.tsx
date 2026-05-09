/**
 * ArchivistPro — Dosya İlişkileri Paneli
 *
 * Detay panelinde kullanılır.
 * İlişki ekleme/kaldırma, otomatik tespit rozeti, dosyaya tıklama.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Plus, X, Cpu, FileText, Image, Layers } from 'lucide-react';
import VersionTimeline from './VersionTimeline';
import {
    addAssetRelation, removeAssetRelation, getRelationsForAsset, getAllAssets,
} from '../services/database';
import type { AssetRelation, RelationType } from '../types';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';

interface AssetRelationsPanelProps {
    asset: Asset;
    onLinkClick?: (assetId: string) => void;
}

const RELATION_ICONS: Record<RelationType, React.ReactNode> = {
    pdf_export: <FileText size={11} />,
    render_of: <Image size={11} />,
    version_of: <Layers size={11} />,
    project_group: <Link2 size={11} />,
};

export default function AssetRelationsPanel({ asset, onLinkClick }: AssetRelationsPanelProps) {
    const { t } = useTranslation();
    const [relations, setRelations] = useState<AssetRelation[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedType, setSelectedType] = useState<RelationType>('project_group');
    const [suggestions, setSuggestions] = useState<Asset[]>([]);

    const scannedAssets = useStore(s => s.scannedAssets);

    const loadRelations = useCallback(() => {
        setRelations(getRelationsForAsset(asset.id));
    }, [asset.id]);

    useEffect(() => {
        loadRelations();
        setShowAdd(false);
        setSearchQuery('');
    }, [asset.id, loadRelations]);

    // Asset arama
    useEffect(() => {
        if (!showAdd) return;
        const q = searchQuery.trim().toLowerCase();
        const existingLinkedIds = new Set([
            asset.id,
            ...relations.map(r => r.sourceId === asset.id ? r.targetId : r.sourceId),
        ]);
        const pool = scannedAssets.length > 0 ? scannedAssets : getAllAssets();
        const filtered = pool.filter(a =>
            !existingLinkedIds.has(a.id) &&
            (q === '' || a.fileName.toLowerCase().includes(q) || a.filePath.toLowerCase().includes(q))
        );
        setSuggestions(filtered.slice(0, 8));
    }, [searchQuery, showAdd, relations, asset.id, scannedAssets]);

    const handleAdd = useCallback((target: Asset) => {
        addAssetRelation({
            sourceId: asset.id,
            targetId: target.id,
            relationType: selectedType,
            createdAt: new Date().toISOString(),
            createdBy: 'user',
        });
        loadRelations();
        setShowAdd(false);
        setSearchQuery('');
    }, [asset.id, selectedType, loadRelations]);

    const handleRemove = useCallback((id: string) => {
        removeAssetRelation(id);
        loadRelations();
    }, [loadRelations]);

    // Bağlantılı dosyanın adını bul
    const getLinkedAsset = useCallback((rel: AssetRelation): Asset | undefined => {
        const linkedId = rel.sourceId === asset.id ? rel.targetId : rel.sourceId;
        const pool = scannedAssets.length > 0 ? scannedAssets : getAllAssets();
        return pool.find(a => a.id === linkedId);
    }, [asset.id, scannedAssets]);

    const RELATION_TYPE_OPTIONS: RelationType[] = ['pdf_export', 'render_of', 'version_of', 'project_group'];

    return (
        <div style={{ padding: '8px 0' }}>
            {/* Başlık */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    <Link2 size={13} />
                    {t('assetRelations.section')}
                </div>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    title={t('assetRelations.addLink')}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: 'var(--color-accent)',
                    }}
                >
                    <Plus size={14} />
                </button>
            </div>

            {/* İlişki listesi */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {relations.map(rel => {
                    const linked = getLinkedAsset(rel);
                    const isSource = rel.sourceId === asset.id;
                    const dirArrow = isSource ? '→' : '←';
                    return (
                        <div key={rel.id} style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 6px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--color-border)',
                            fontSize: '0.7rem',
                        }}>
                            <span style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
                                {RELATION_ICONS[rel.relationType]}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, fontSize: '0.65rem' }}>{dirArrow}</span>
                            <button
                                onClick={() => linked && onLinkClick?.(linked.id)}
                                style={{
                                    background: 'none', border: 'none', cursor: linked ? 'pointer' : 'default',
                                    color: linked ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                                    flex: 1, minWidth: 0, textAlign: 'left', padding: 0,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    fontSize: '0.7rem',
                                }}
                                title={linked?.filePath}
                            >
                                {linked?.fileName ?? t('assetRelations.type.' + rel.relationType)}
                            </button>
                            <span style={{
                                fontSize: '0.6rem', flexShrink: 0, padding: '1px 5px', borderRadius: 4,
                                background: 'rgba(99,102,241,0.12)', color: 'var(--color-accent)',
                            }}>
                                {t('assetRelations.type.' + rel.relationType)}
                            </span>
                            {rel.createdBy === 'auto' && (
                                <span style={{
                                    fontSize: '0.58rem', flexShrink: 0, padding: '1px 4px', borderRadius: 3,
                                    background: 'rgba(166,227,161,0.12)', color: 'var(--color-success)',
                                }}>
                                    <Cpu size={8} style={{ verticalAlign: 'middle' }} /> {t('assetRelations.auto')}
                                </span>
                            )}
                            <button
                                onClick={() => handleRemove(rel.id)}
                                title={t('assetRelations.removeLink')}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', flexShrink: 0 }}
                            >
                                <X size={10} />
                            </button>
                        </div>
                    );
                })}
                {relations.length === 0 && !showAdd && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        {t('assetRelations.noLinks')}
                    </span>
                )}
            </div>

            {/* Bağlantı ekleme formu */}
            {showAdd && (
                <div style={{ marginTop: 8 }}>
                    {/* İlişki tipi seçici */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                        {RELATION_TYPE_OPTIONS.map(rt => (
                            <button
                                key={rt}
                                onClick={() => setSelectedType(rt)}
                                style={{
                                    padding: '2px 7px', borderRadius: 4, fontSize: '0.65rem',
                                    border: '1px solid ' + (selectedType === rt ? 'var(--color-accent)' : 'var(--color-border)'),
                                    background: selectedType === rt ? 'rgba(99,102,241,0.15)' : 'transparent',
                                    color: selectedType === rt ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                    cursor: 'pointer',
                                }}
                            >
                                {t('assetRelations.type.' + rt)}
                            </button>
                        ))}
                    </div>
                    {/* Dosya arama */}
                    <div style={{ position: 'relative' }}>
                        <input
                            autoFocus
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Escape') { setShowAdd(false); setSearchQuery(''); }
                            }}
                            placeholder={t('assetRelations.searchPlaceholder')}
                            style={{
                                width: '100%', padding: '5px 8px', fontSize: '0.72rem',
                                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)',
                                borderRadius: 6, color: 'var(--color-text-primary)', outline: 'none',
                            }}
                        />
                        {suggestions.length > 0 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
                                background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                                borderRadius: 6, maxHeight: 160, overflow: 'auto', zIndex: 10,
                            }}>
                                {suggestions.map(s => (
                                    <button key={s.id}
                                        onClick={() => handleAdd(s)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                            padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer',
                                            color: 'var(--color-text-primary)', fontSize: '0.7rem', textAlign: 'left',
                                            overflow: 'hidden',
                                        }}
                                        title={s.filePath}
                                    >
                                        <span style={{ flexShrink: 0, fontSize: '0.65rem', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 4px' }}>
                                            {s.fileType}
                                        </span>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {s.fileName}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Versiyon Zaman Çizelgesi */}
            <VersionTimeline
                currentAssetId={asset.id}
                relations={relations}
                assetNames={new Map(
                    (scannedAssets.length > 0 ? scannedAssets : getAllAssets()).map(a => [a.id, { fileName: a.fileName, modifiedAt: a.modifiedAt }])
                )}
                onAssetClick={(id) => onLinkClick?.(id)}
            />
        </div>
    );
}

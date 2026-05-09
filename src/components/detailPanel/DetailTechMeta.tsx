import { useTranslation } from 'react-i18next';
import { Cpu, Layers, ExternalLink, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store/useStore';
import type { Asset } from '../../types';
import { CollapsibleList, FilterableTextList } from './detailHelpers';

interface Props { asset: Asset; }

export default function DetailTechMeta({ asset }: Props) {
    const { t } = useTranslation();

    const openFile = async (path: string) => {
        try { await invoke('open_file_native', { path }); }
        catch (err) { useStore.getState().addToast(String(err), 'error'); }
    };
    const showInFolder = async (path: string) => {
        try { await invoke('show_in_folder', { path }); }
        catch (err) { useStore.getState().addToast(String(err), 'error'); }
    };

    const fileRefItem = (ref: string, tagClass: string) => {
        const hasPath = ref.includes('\\') || ref.includes('/');
        const fileName = hasPath ? ref.split(/[\\/]/).pop() ?? ref : ref;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                <span className={`tag ${tagClass}`} style={{ flexShrink: 0, margin: 0 }}>{fileName}</span>
                {hasPath && (
                    <>
                        <span style={{ flex: 1, fontSize: '0.68rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ref}>{ref}</span>
                        <button onClick={() => openFile(ref)} title={t('contextMenu.openFile')}
                            style={{ flexShrink: 0, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <ExternalLink size={11} />{t('detail.action.open')}
                        </button>
                        <button onClick={() => showInFolder(ref)} title={t('contextMenu.showInFolder')}
                            style={{ flexShrink: 0, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <FolderOpen size={11} />{t('detail.action.showInFolder')}
                        </button>
                    </>
                )}
            </div>
        );
    };

    const m = asset.metadata;

    return (
        <>
        <div className="detail-section">
            <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cpu size={12} /> {t('detail.section.techMeta')}
            </div>
            {m.layers && m.layers.length > 0 && (
                <CollapsibleList label={t('detail.label.layers', { count: m.layers.length }).replace(/\s*\(\d+\)\s*$/, '')} count={m.layers.length} icon={<Layers size={11} />}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.layers.map((l, i) => <span key={i} className="tag">{l}</span>)}</div>
                </CollapsibleList>
            )}
            {m.dwgLayers?.length ? (
                <CollapsibleList label="Katmanlar" count={m.dwgLayers.length} icon={<Layers size={11} />}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.dwgLayers.map((l, i) => <span key={i} className="tag">{l}</span>)}</div>
                </CollapsibleList>
            ) : null}
            {m.dwgBlockNames?.length ? (
                <CollapsibleList label="Bloklar" count={m.dwgBlockNames.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.dwgBlockNames.map((b, i) => <span key={i} className="tag tag-warning">{b}</span>)}</div>
                </CollapsibleList>
            ) : null}
            {m.dwgTextContents?.length ? (
                <CollapsibleList label="Metin İçerikleri" count={m.dwgTextContents.length}>
                    <FilterableTextList items={m.dwgTextContents} />
                </CollapsibleList>
            ) : null}
            {m.dwgXrefNames?.length ? (
                <CollapsibleList label="Xref Dosyaları" count={m.dwgXrefNames.length}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {m.dwgXrefNames.map((x, i) => <div key={i}>{fileRefItem(x, 'tag-accent')}</div>)}
                    </div>
                </CollapsibleList>
            ) : null}
            {m.dwgImageRefs?.length ? (
                <CollapsibleList label="Görsel Referansları" count={m.dwgImageRefs.length}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {m.dwgImageRefs.map((img, i) => <div key={i}>{fileRefItem(img, 'tag-success')}</div>)}
                    </div>
                </CollapsibleList>
            ) : null}
            {m.dwgOleObjects?.length ? (
                <CollapsibleList label="Gömülü OLE Objeleri" count={m.dwgOleObjects.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.dwgOleObjects.map((o, i) => <span key={i} className="tag tag-accent">{o}</span>)}</div>
                </CollapsibleList>
            ) : null}
            {m.dwgProperties && (m.dwgProperties.title || m.dwgProperties.author) ? (
                <div style={{ marginTop: 8 }}>
                    {m.dwgProperties.title && <div className="detail-row"><span className="detail-row-label">Başlık</span><span className="detail-row-value">{m.dwgProperties.title}</span></div>}
                    {m.dwgProperties.author && <div className="detail-row"><span className="detail-row-label">Yazar</span><span className="detail-row-value">{m.dwgProperties.author}</span></div>}
                </div>
            ) : null}
            {m.blockCount != null && <div className="detail-row"><span className="detail-row-label">{t('detail.label.blockCount')}</span><span className="detail-row-value">{m.blockCount}</span></div>}
            {m.renderEngine && <div className="detail-row"><span className="detail-row-label">{t('detail.label.renderEngine')}</span><span className="detail-row-value">{m.renderEngine}</span></div>}
            {m.textureCount != null && <div className="detail-row"><span className="detail-row-label">{t('detail.label.textureCount')}</span><span className="detail-row-value">{m.textureCount}</span></div>}
            {m.roomNames && m.roomNames.length > 0 && (
                <CollapsibleList label={t('detail.label.rooms', { count: m.roomNames.length }).replace(/\s*\(\d+\)\s*$/, '')} count={m.roomNames.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.roomNames.map((r, i) => <span key={i} className="tag">{r}</span>)}</div>
                </CollapsibleList>
            )}
            {m.materialList && m.materialList.length > 0 && (
                <CollapsibleList label={t('detail.label.materials')} count={m.materialList.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.materialList.map((mat, i) => <span key={i} className="tag tag-warning">{mat}</span>)}</div>
                </CollapsibleList>
            )}
            {m.maxLayers && m.maxLayers.length > 0 && (
                <CollapsibleList label={t('detail.label.maxLayers')} count={m.maxLayers.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.maxLayers.map((l, i) => <span key={i} className="tag tag-accent">{l}</span>)}</div>
                </CollapsibleList>
            )}
            {m.maxObjects && m.maxObjects.length > 0 && (
                <CollapsibleList label={t('detail.label.maxObjects')} count={m.maxObjects.length}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {m.maxObjects.slice(0, 30).map((o, i) => <span key={i} className="tag">{o}</span>)}
                        {m.maxObjects.length > 30 && <span className="tag" style={{ opacity: 0.6 }}>+{m.maxObjects.length - 30}</span>}
                    </div>
                </CollapsibleList>
            )}
            {m.resolution && <div className="detail-row"><span className="detail-row-label">{t('detail.label.resolution')}</span><span className="detail-row-value">{m.resolution.width}×{m.resolution.height}</span></div>}
            {m.pageCount != null && <div className="detail-row"><span className="detail-row-label">{t('detail.label.pageCount')}</span><span className="detail-row-value">{m.pageCount}</span></div>}
            {m.colorProfile && <div className="detail-row"><span className="detail-row-label">{t('detail.label.colorProfile')}</span><span className="detail-row-value">{m.colorProfile}</span></div>}
        </div>
        {/* Architectural Style */}
        {asset.architecturalStyle && (
            <div className="detail-section">
                <div className="detail-section-title">{t('detail.section.archStyle')}</div>
                <span className="tag tag-accent" style={{ fontSize: '0.78rem' }}>{asset.architecturalStyle}</span>
            </div>
        )}
        </>
    );
}

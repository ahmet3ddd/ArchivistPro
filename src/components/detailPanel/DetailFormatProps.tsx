import { useTranslation } from 'react-i18next';
import { formatDate } from '../../data';
import type { Asset } from '../../types';

interface Props { asset: Asset; }

export default function DetailFormatProps({ asset }: Props) {
    const { t } = useTranslation();
    return (
        <div className="detail-section">
            <div className="detail-section-title">{t('detail.section.formatProps')}</div>
            {asset.fileType === 'DWG' && asset.metadata.dwgCreatedAt && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.drawingDate')}</span><span className="detail-row-value tag tag-accent">{formatDate(asset.metadata.dwgCreatedAt)}</span></div>
            )}
            {(asset.fileType === 'DWG' || asset.fileType === 'DXF') && asset.metadata.dwgVersion && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.dwgVersion')}</span><span className="detail-row-value tag tag-accent">{asset.metadata.dwgVersion}</span></div>
            )}
            {asset.fileType === 'MAX' && asset.metadata.maxVersion && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.maxVersion')}</span><span className="detail-row-value tag tag-accent">{asset.metadata.maxVersion}</span></div>
            )}
            {asset.metadata.convertedFrom && (
                <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: 'rgba(166,227,161,0.08)', border: '1px solid rgba(166,227,161,0.25)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-success)', marginBottom: 4 }}>{t('detail.section.convertedFile')}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{t('detail.label.original')} {asset.metadata.convertedFrom.version}</div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t('detail.label.source')} {asset.metadata.convertedFrom.path.split(/[/\\]/).pop()}
                    </div>
                </div>
            )}
            {asset.fileType === 'SKP' && asset.metadata.skpVersion && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.skpVersion')}</span><span className="detail-row-value tag tag-accent">{asset.metadata.skpVersion}</span></div>
            )}
            {asset.fileType === 'RVT' && asset.metadata.rvtVersion && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.rvtVersion')}</span><span className="detail-row-value tag tag-accent">{asset.metadata.rvtVersion}</span></div>
            )}
            {asset.fileType === 'RVT' && asset.metadata.rvtProjectName && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.rvtProjectName')}</span><span className="detail-row-value">{asset.metadata.rvtProjectName}</span></div>
            )}
            {asset.fileType === 'RVT' && asset.metadata.rvtWorkshared && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.rvtWorkshared')}</span><span className="detail-row-value tag" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>Workshared</span></div>
            )}
            {asset.fileType === 'RVT' && asset.metadata.rvtStoreyCount != null && asset.metadata.rvtStoreyCount > 0 && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.rvtStoreys')}</span>
                    <span className="detail-row-value">{asset.metadata.rvtStoreyCount}{asset.metadata.rvtStoreyNames?.length ? ` (${asset.metadata.rvtStoreyNames.slice(0, 5).join(', ')})` : ''}</span>
                </div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcSchema && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcSchema')}</span><span className="detail-row-value tag tag-accent">{asset.metadata.ifcSchema}</span></div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcProjectName && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcProjectName')}</span><span className="detail-row-value">{asset.metadata.ifcProjectName}</span></div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcBuildingName && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcBuildingName')}</span><span className="detail-row-value">{asset.metadata.ifcBuildingName}</span></div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcOriginatingSystem && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcOriginatingSystem')}</span><span className="detail-row-value">{asset.metadata.ifcOriginatingSystem}</span></div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcTotalEntities != null && asset.metadata.ifcTotalEntities > 0 && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcEntities')}</span><span className="detail-row-value">{asset.metadata.ifcTotalEntities.toLocaleString()}</span></div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcStoreyCount != null && asset.metadata.ifcStoreyCount > 0 && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcStoreys')}</span>
                    <span className="detail-row-value">{asset.metadata.ifcStoreyCount}{asset.metadata.ifcStoreyNames?.length ? ` (${asset.metadata.ifcStoreyNames.slice(0, 5).join(', ')})` : ''}</span>
                </div>
            )}
            {asset.fileType === 'IFC' && asset.metadata.ifcSpaceCount != null && asset.metadata.ifcSpaceCount > 0 && (
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.ifcSpaces')}</span><span className="detail-row-value">{asset.metadata.ifcSpaceCount}</span></div>
            )}
            {asset.omniclassCode && (
                <div className="detail-row"><span className="detail-row-label">OmniClass</span><span className="detail-row-value">{asset.omniclassCode}</span></div>
            )}
        </div>
    );
}

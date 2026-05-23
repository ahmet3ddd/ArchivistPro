/**
 * Archivist Pro — Versiyon Zaman Çizelgesi
 *
 * version_of ilişkileriyle bağlı dosyaların kronolojik dikey timeline'ını gösterir.
 * AssetRelationsPanel içinde version_of ilişkisi varsa render edilir.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Circle } from 'lucide-react';
import type { AssetRelation } from '../types';

interface VersionTimelineProps {
  currentAssetId: string;
  relations: AssetRelation[];
  /** Dosya adlarını resolve etmek için asset haritası */
  assetNames: Map<string, { fileName: string; modifiedAt?: string }>;
  onAssetClick: (assetId: string) => void;
}

export default function VersionTimeline({ currentAssetId, relations, assetNames, onAssetClick }: VersionTimelineProps) {
  const { t } = useTranslation();

  // version_of zincirini topla
  const versionChain = useMemo(() => {
    const versionRels = relations.filter(r => r.relationType === 'version_of');
    if (versionRels.length === 0) return [];

    // Tüm ilgili asset ID'leri
    const ids = new Set<string>();
    ids.add(currentAssetId);
    versionRels.forEach(r => { ids.add(r.sourceId); ids.add(r.targetId); });

    // Zinciri oluştur: tarih sırasına göre sırala
    const chain = [...ids].map(id => {
      const info = assetNames.get(id);
      return {
        id,
        fileName: info?.fileName || id.substring(0, 12) + '...',
        date: info?.modifiedAt || '',
        isCurrent: id === currentAssetId,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    return chain;
  }, [currentAssetId, relations, assetNames]);

  if (versionChain.length < 2) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.74rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
        <GitBranch size={13} />
        {t('versionTimeline.title')}
      </div>

      <div style={{ position: 'relative', paddingLeft: 16 }}>
        {/* Dikey çizgi */}
        <div style={{
          position: 'absolute', left: 5, top: 4, bottom: 4,
          width: 2, background: 'var(--color-border)',
        }} />

        {versionChain.map((item, i) => (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 0', position: 'relative',
              cursor: item.isCurrent ? 'default' : 'pointer',
              opacity: item.isCurrent ? 1 : 0.7,
            }}
            onClick={() => { if (!item.isCurrent) onAssetClick(item.id); }}
          >
            {/* Dot */}
            <Circle
              size={item.isCurrent ? 10 : 8}
              fill={item.isCurrent ? 'var(--color-accent)' : 'var(--color-bg-tertiary)'}
              stroke={item.isCurrent ? 'var(--color-accent)' : 'var(--color-text-muted)'}
              strokeWidth={2}
              style={{ position: 'absolute', left: -12, zIndex: 1 }}
            />

            {/* İçerik */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.74rem',
                fontWeight: item.isCurrent ? 600 : 400,
                color: item.isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {item.fileName}
                {item.isCurrent && (
                  <span style={{ marginLeft: 6, fontSize: '0.62rem', background: 'var(--color-accent)', color: '#fff', padding: '0 5px', borderRadius: 4 }}>
                    {t('versionTimeline.current')}
                  </span>
                )}
              </div>
              {item.date && (
                <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>
                  {new Date(item.date).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Sıra numarası */}
            <span style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
              v{i + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

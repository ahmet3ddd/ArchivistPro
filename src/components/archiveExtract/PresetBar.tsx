import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterPreset } from '../../services/filterPresets';

export default function PresetBar({
    presets, presetName, setPresetName, onApply, onSave, onDelete,
}: {
    presets: FilterPreset[];
    presetName: string;
    setPresetName: (v: string) => void;
    onApply: (p: FilterPreset) => void;
    onSave: () => void;
    onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    const [selectedId, setSelectedId] = useState('');

    const handleApply = () => {
        const p = presets.find(x => x.id === selectedId);
        if (p) onApply(p);
    };
    const handleDelete = () => {
        if (selectedId) { onDelete(selectedId); setSelectedId(''); }
    };

    return (
        <div style={{
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
            padding: 8, marginBottom: 12,
            background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
            borderRadius: 6, fontSize: '0.74rem',
        }}>
            <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {t('extract.presets.label', { defaultValue: 'Preset:' })}
            </span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{
                flex: '1 1 140px', minWidth: 100, padding: '4px 6px',
                background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.74rem',
            }}>
                <option value="">{t('extract.presets.choose', { defaultValue: '— seç —' })}</option>
                {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" onClick={handleApply} disabled={!selectedId} style={{
                padding: '4px 10px', fontSize: '0.72rem',
                background: 'var(--color-accent)', color: 'white', border: 'none',
                borderRadius: 4, cursor: selectedId ? 'pointer' : 'not-allowed',
                opacity: selectedId ? 1 : 0.5,
            }}>
                {t('extract.presets.apply', { defaultValue: 'Uygula' })}
            </button>
            <button type="button" onClick={handleDelete} disabled={!selectedId} style={{
                padding: '4px 10px', fontSize: '0.72rem',
                background: 'transparent', color: '#ef4444', border: '1px solid #ef4444',
                borderRadius: 4, cursor: selectedId ? 'pointer' : 'not-allowed',
                opacity: selectedId ? 1 : 0.4,
            }}>
                {t('extract.presets.delete', { defaultValue: 'Sil' })}
            </button>
            <span style={{ width: 1, height: 18, background: 'var(--color-border)', margin: '0 4px' }} />
            <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('extract.presets.namePlaceholder', { defaultValue: 'Yeni preset adı' })}
                style={{
                    flex: '1 1 120px', minWidth: 100, padding: '4px 6px',
                    background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.74rem',
                }}
            />
            <button type="button" onClick={onSave} disabled={!presetName.trim()} style={{
                padding: '4px 10px', fontSize: '0.72rem',
                background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                border: '1px solid var(--color-accent)',
                borderRadius: 4, cursor: presetName.trim() ? 'pointer' : 'not-allowed',
                opacity: presetName.trim() ? 1 : 0.5,
            }}>
                {t('extract.presets.save', { defaultValue: 'Kaydet' })}
            </button>
        </div>
    );
}

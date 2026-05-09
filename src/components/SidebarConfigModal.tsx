import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, RotateCcw } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FACET_GROUPS } from '../data';
import type { FacetKey } from '../types';

export interface FacetConfig {
    key: FacetKey;
    label: string;
    visible: boolean;
    order: number;
}

interface SidebarConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: FacetConfig[];
    onSave: (newConfig: FacetConfig[]) => void;
    onReset: () => void;
}

export default function SidebarConfigModal({ isOpen, onClose, config, onSave, onReset }: SidebarConfigModalProps) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    // Local state for editing before saving
    const [localConfig, setLocalConfig] = useState<FacetConfig[]>(config);

    if (!isOpen) return null;

    const handleToggle = (key: FacetKey) => {
        setLocalConfig(prev => prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
    };

    const handleLabelChange = (key: FacetKey, newLabel: string) => {
        setLocalConfig(prev => prev.map(c => c.key === key ? { ...c, label: newLabel } : c));
    };

    // Simple move up/down instead of full drag-and-drop for simplicity
    const moveItem = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === localConfig.length - 1) return;

        const newConfig = [...localConfig];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;

        // Swap
        const temp = newConfig[index];
        newConfig[index] = newConfig[swapIndex];
        newConfig[swapIndex] = temp;

        // Update order values
        const reordered = newConfig.map((c, i) => ({ ...c, order: i }));
        setLocalConfig(reordered);
    };

    const handleSave = () => {
        onSave(localConfig);
        onClose();
    };

    const handleReset = () => {
        onReset();
        // Reset local state to the fresh default 
        const defaultConfigs = FACET_GROUPS.map((g, i) => ({
            key: g.key,
            label: g.label,
            visible: true,
            order: i
        }));
        setLocalConfig(defaultConfigs);
    };

    return (
        <div className="modal-overlay">
            <div ref={focusTrapRef} className="modal-content" role="dialog" aria-modal="true" style={{ maxWidth: 'min(90vw, 450px)', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t('sidebarConfig.title')}</h2>
                    <button className="btn btn-icon" aria-label={t('common.aria.close')} onClick={onClose}><X size={18} /></button>
                </div>

                <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
                    <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: 20 }}>
                        {t('sidebarConfig.description')}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {localConfig.sort((a, b) => a.order - b.order).map((item, index) => (
                            <div key={item.key} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '12px', background: 'var(--color-bg-secondary)',
                                borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <button
                                        className="btn btn-icon"
                                        style={{ padding: 2, height: 'auto', width: 'auto', opacity: index === 0 ? 0.3 : 1 }}
                                        onClick={() => moveItem(index, 'up')}
                                        disabled={index === 0}
                                    >
                                        <div style={{ fontSize: '0.6rem' }}>▲</div>
                                    </button>
                                    <button
                                        className="btn btn-icon"
                                        style={{ padding: 2, height: 'auto', width: 'auto', opacity: index === localConfig.length - 1 ? 0.3 : 1 }}
                                        onClick={() => moveItem(index, 'down')}
                                        disabled={index === localConfig.length - 1}
                                    >
                                        <div style={{ fontSize: '0.6rem' }}>▼</div>
                                    </button>
                                </div>

                                <div
                                    onClick={() => handleToggle(item.key)}
                                    style={{
                                        width: 18, height: 18, borderRadius: 4, cursor: 'pointer',
                                        border: `1.5px solid ${item.visible ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                        background: item.visible ? 'var(--color-accent)' : 'transparent',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff'
                                    }}
                                >
                                    {item.visible && <Check size={12} />}
                                </div>

                                <input
                                    value={item.label}
                                    onChange={(e) => handleLabelChange(item.key, e.target.value)}
                                    style={{
                                        flex: 1, background: 'transparent', border: 'none',
                                        color: item.visible ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                                        fontSize: '0.9rem', outline: 'none', textDecoration: item.visible ? 'none' : 'line-through'
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'var(--color-bg-secondary)' }}>
                    <button className="btn btn-secondary" onClick={handleReset} style={{ fontSize: '0.8rem', color: 'var(--color-error)', flexShrink: 0 }}>
                        <RotateCcw size={14} /> {t('sidebarConfig.resetDefaults')}
                    </button>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
                        <button className="btn btn-primary" onClick={handleSave}>{t('common.button.save')}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

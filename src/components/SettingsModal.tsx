/**
 * ArchivistPro — Ayarlar Paneli
 *
 * Modal frame + tab navigation.
 * Tab içerikleri src/components/settings/ altında ayrı dosyalarda.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Wifi, HardDrive, Palette, Info, Lock } from 'lucide-react';
import ModalErrorBoundary from './ModalErrorBoundary';
import SettingsGeneralTab from './settings/SettingsGeneralTab';
import SettingsStorageTab from './settings/SettingsStorageTab';
import SettingsNetworkTab from './settings/SettingsNetworkTab';
import SettingsSecurityTab from './settings/SettingsSecurityTab';
import SettingsAboutTab from './settings/SettingsAboutTab';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsTab = 'general' | 'storage' | 'network' | 'security' | 'about';

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    if (!isOpen) return null;

    const tabs: Array<{ key: SettingsTab; label: string; icon: React.ReactNode }> = [
        { key: 'general',  label: t('settings.tab.general'),  icon: <Palette size={14} /> },
        { key: 'storage',  label: t('settings.tab.storage'),  icon: <HardDrive size={14} /> },
        { key: 'network',  label: t('settings.tab.network'),  icon: <Wifi size={14} /> },
        { key: 'security', label: t('settings.tab.security'), icon: <Lock size={14} /> },
        { key: 'about',    label: t('settings.tab.about'),    icon: <Info size={14} /> },
    ];

    return (
        <ModalErrorBoundary onClose={onClose}>
        <>
        <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title"
                style={{ width: 720, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

                <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
                    <h2 id="settings-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                        {t('modals.settings')}
                    </h2>
                    <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                        <X size={18} />
                    </button>
                </div>

                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    <div style={{ width: 150, borderRight: '1px solid var(--color-border)', padding: '8px 0' }}>
                        {tabs.map(tab => (
                            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                    padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                                    background: activeTab === tab.key ? 'rgba(99,102,241,0.1)' : 'transparent',
                                    color: activeTab === tab.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                    textAlign: 'left', fontWeight: activeTab === tab.key ? 600 : 400,
                                }}>
                                {tab.icon} {tab.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
                        {activeTab === 'general'  && <SettingsGeneralTab onClose={onClose} />}
                        {activeTab === 'storage'  && <SettingsStorageTab />}
                        {activeTab === 'network'  && <SettingsNetworkTab />}
                        {activeTab === 'security' && <SettingsSecurityTab />}
                        {activeTab === 'about'    && <SettingsAboutTab />}
                    </div>
                </div>
            </div>
        </div>
        </>
        </ModalErrorBoundary>
    );
}

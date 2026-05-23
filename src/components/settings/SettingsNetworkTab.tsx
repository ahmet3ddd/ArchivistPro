import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Code2, Wifi, Cpu } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useIsAdmin, useIsDeveloper } from '../../permissions';
import { notifyError } from '../../services/notificationCenter';
import { getSetting, setSettingPersistent } from '../../services/database';
import { LanSharingPanel } from '../LanSharingPanel';
import { SettingsCard, SettingRow } from './settingsShared';

export default function SettingsNetworkTab() {
    const { t } = useTranslation();
    const isAdmin = useIsAdmin();
    const isDev = useIsDeveloper();

    const [devModeEnabled, setDevModeEnabled] = useState<boolean>(() => getSetting('dev_mode') === 'true');
    const [devIp, setDevIp] = useState<string>(() => getSetting('dev_ip') ?? '');
    const [devModeLoading, setDevModeLoading] = useState(false);

    const handleEnableDevMode = async () => {
        setDevModeLoading(true);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const ip = await invoke<string>('get_local_ip');
            await setSettingPersistent('dev_mode', 'true');
            await setSettingPersistent('dev_ip', ip);
            setDevModeEnabled(true);
            setDevIp(ip);
            try {
                await invoke('lan_start_server');
                useStore.getState().addToast(t('settings.developerMode.serverStarted'), 'success');
            } catch {
                useStore.getState().addToast(t('settings.developerMode.serverWarning'), 'warning');
            }
            useStore.getState().addToast(t('settings.developerMode.enabled'), 'success');
        } catch {
            notifyError(t('settings.developerMode.enableError'));
        } finally {
            setDevModeLoading(false);
        }
    };

    const handleDisableDevMode = () => {
        void setSettingPersistent('dev_mode', 'false');
        void setSettingPersistent('dev_ip', '');
        setDevModeEnabled(false);
        setDevIp('');
        useStore.getState().addToast(t('settings.developerMode.disabled'), 'success');
    };

    return (
        <div>
            <SettingsCard
                icon={<Wifi size={15} />}
                title={t('settings.section.lan')}
                subtitle={t('settings.card.lanSub')}
            >
                <LanSharingPanel />
            </SettingsCard>

            {(isAdmin || isDev) && (
                <SettingsCard
                    icon={<Code2 size={15} />}
                    title={t('settings.section.developerMode')}
                    subtitle={t('settings.card.devModeSub')}
                    defaultCollapsed
                >
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                        {t('settings.developerMode.description')}
                    </div>
                    {devModeEnabled && devIp && (
                        <SettingRow label={t('settings.developerMode.currentIp')} value={devIp} />
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {!devModeEnabled ? (
                            <button
                                onClick={handleEnableDevMode}
                                disabled={devModeLoading}
                                style={{
                                    padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-accent)',
                                    background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)',
                                    cursor: devModeLoading ? 'not-allowed' : 'pointer', fontSize: '0.78rem',
                                    opacity: devModeLoading ? 0.6 : 1,
                                }}
                            >
                                {devModeLoading ? '...' : t('settings.developerMode.enable')}
                            </button>
                        ) : (
                            <>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4, padding: '6px 0' }}>
                                    <CheckCircle size={12} /> {t('settings.developerMode.statusActive')}
                                </span>
                                <button
                                    onClick={handleDisableDevMode}
                                    style={{
                                        padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-border)',
                                        background: 'transparent', color: 'var(--color-text-secondary)',
                                        cursor: 'pointer', fontSize: '0.78rem',
                                    }}
                                >
                                    {t('settings.developerMode.disable')}
                                </button>
                            </>
                        )}
                    </div>
                </SettingsCard>
            )}

            <SettingsCard
                icon={<Cpu size={15} />}
                title={t('settings.section.aiConnections')}
                subtitle={t('settings.card.aiConnectionsSub')}
                defaultCollapsed
            >
                <SettingRow label="Ollama" value="http://localhost:11434" />
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', padding: '4px 0' }}>
                    {t('settings.ai.hint')}
                </div>
            </SettingsCard>
        </div>
    );
}

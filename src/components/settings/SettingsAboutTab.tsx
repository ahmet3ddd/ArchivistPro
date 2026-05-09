import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Info, FileCode, AlertTriangle } from 'lucide-react';
import { APP_VERSION, APP_BUILD_DATE, getAppDescription } from '../../appVersion';
import { getExtractorsForFileType, getAllRegisteredFileTypes } from '../../services/extractorRegistry';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { getSetting, setSettingPersistent } from '../../services/database';
import { useStore } from '../../store/useStore';
import CrashLogViewer from '../CrashLogViewer';
import { SettingsCard, SettingRow } from './settingsShared';

/* ── UpdateCheckButton ── */

function UpdateCheckButton() {
    const { t } = useTranslation();
    const updater = useUpdateChecker(false);
    const [busy, setBusy] = useState(false);

    const handleCheck = async () => {
        setBusy(true);
        try { await updater.checkForUpdate(); } finally { setBusy(false); }
    };

    const renderResult = () => {
        switch (updater.status) {
            case 'disabled':
                return t('updater.serverNotConfigured');
            case 'available':
                return t('updater.available', { version: updater.version });
            case 'error':
                return t('updater.checkError', { error: updater.error ?? '' });
            case 'idle':
                return updater.version ? t('updater.upToDate') : '';
            default:
                return '';
        }
    };
    const result = renderResult();

    return (
        <div style={{ padding: '6px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
                onClick={handleCheck}
                disabled={busy || updater.status === 'checking'}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: '0.74rem', gap: 6, padding: '6px 12px' }}
            >
                <RefreshCw size={13} style={(busy || updater.status === 'checking') ? { animation: 'spin 1s linear infinite' } : undefined} />
                {(busy || updater.status === 'checking') ? t('updater.checking') : t('updater.checkNow')}
            </button>
            {result && (
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>
                    {result}
                </div>
            )}
            {updater.status === 'available' && updater.downloadUrl && (
                <button
                    onClick={updater.openDownload}
                    style={{
                        alignSelf: 'flex-start',
                        padding: '4px 12px', borderRadius: 6, border: 'none',
                        background: 'var(--color-accent)', color: '#fff',
                        fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer',
                    }}
                >
                    {t('updater.openDownload')}
                </button>
            )}
        </div>
    );
}

/* ── UpdateServerConfig ── */

function UpdateServerConfig() {
    const { t } = useTranslation();
    const [url, setUrl] = useState<string>(() => getSetting('update_server_url') ?? '');
    const [saved, setSaved] = useState<'idle' | 'saved'>('idle');

    const handleSave = () => {
        const trimmed = url.trim().replace(/\/+$/, '');
        void setSettingPersistent('update_server_url', trimmed);
        setUrl(trimmed);
        setSaved('saved');
        useStore.getState().addToast(t('updater.serverUrlSaved'), 'success');
        window.setTimeout(() => setSaved('idle'), 2000);
    };

    return (
        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('updater.serverUrlHelp')}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('updater.serverUrlPlaceholder')}
                    style={{
                        flex: 1, padding: '6px 10px', borderRadius: 6,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-primary)',
                        color: 'var(--color-text-primary)',
                        fontSize: '0.78rem',
                    }}
                />
                <button
                    onClick={handleSave}
                    style={{
                        padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-accent)',
                        background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)',
                        cursor: 'pointer', fontSize: '0.78rem',
                    }}
                >
                    {saved === 'saved' ? t('updater.serverUrlSaved') : t('common.save')}
                </button>
            </div>
        </div>
    );
}

/* ── ExtractorCapabilityTable ── */

function ExtractorCapabilityTable() {
    const { t } = useTranslation();
    const FILE_TYPES = getAllRegisteredFileTypes();
    const [expanded, setExpanded] = useState<string | null>(null);

    return (
        <div style={{ fontSize: '0.72rem' }}>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>
                {t('settings.about.extractorsDesc')}
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: '80px 1fr 60px',
                    padding: '6px 12px', background: 'var(--color-bg-tertiary)',
                    fontWeight: 600, fontSize: '0.68rem', color: 'var(--color-text-secondary)',
                    borderBottom: '1px solid var(--color-border)',
                }}>
                    <span>{t('settings.about.extractorCol.type')}</span>
                    <span>{t('settings.about.extractorCol.extractors')}</span>
                    <span style={{ textAlign: 'right' }}>{t('settings.about.extractorCol.fields')}</span>
                </div>
                {FILE_TYPES.map(ft => {
                    const extractors = getExtractorsForFileType(ft);
                    if (extractors.length === 0) return null;
                    const totalFields = extractors.reduce((s, e) => s + e.producedFields.length, 0);
                    const isExpanded = expanded === ft;
                    return (
                        <div key={ft}>
                            <div
                                onClick={() => setExpanded(isExpanded ? null : ft)}
                                style={{
                                    display: 'grid', gridTemplateColumns: '80px 1fr 60px',
                                    padding: '6px 12px',
                                    borderBottom: '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    background: isExpanded ? 'rgba(99,102,241,0.04)' : 'transparent',
                                }}
                            >
                                <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{ft}</span>
                                <span style={{ color: 'var(--color-text-secondary)' }}>
                                    {extractors.map(e => e.name.split(':')[1]).join(', ')}
                                </span>
                                <span style={{ textAlign: 'right', fontWeight: 600 }}>{totalFields}</span>
                            </div>
                            {isExpanded && (
                                <div style={{ padding: '6px 12px 10px', background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border)' }}>
                                    {extractors.map(ext => (
                                        <div key={ext.name} style={{ marginBottom: 6 }}>
                                            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                                {ext.name} <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>v{ext.version}</span>
                                                {ext.rustCommand && (
                                                    <span style={{ marginLeft: 6, fontSize: '0.62rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-tertiary)', padding: '1px 5px', borderRadius: 4 }}>
                                                        Rust
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                                {ext.producedFields.map(f => (
                                                    <span key={f} style={{
                                                        fontSize: '0.62rem', padding: '1px 6px', borderRadius: 8,
                                                        background: 'rgba(99,102,241,0.08)', color: 'var(--color-accent)',
                                                        border: '1px solid rgba(99,102,241,0.15)',
                                                    }}>
                                                        {f}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ── SettingsAboutTab ── */

export default function SettingsAboutTab() {
    const { t } = useTranslation();
    return (
        <div>
            <SettingsCard
                icon={<Info size={15} />}
                title="ArchivistPro"
                subtitle={t('settings.card.appInfoSub')}
                collapsible={false}
            >
                <SettingRow label={t('settings.about.version')} value={APP_VERSION} />
                <SettingRow label={t('settings.about.buildDate')} value={APP_BUILD_DATE} />
                <SettingRow label={t('settings.about.platform')} value="Tauri v2 + React 19" />
                <SettingRow label={t('settings.about.database')} value="SQLite (sql.js WASM)" />
                <SettingRow label={t('settings.about.aiml')} value={t('settings.about.aiMlValue')} />
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                    {getAppDescription()}. {t('settings.about.description')}
                </div>
            </SettingsCard>

            <SettingsCard
                icon={<RefreshCw size={15} />}
                title={t('updater.sectionTitle')}
                subtitle={t('settings.card.updatesSub')}
            >
                <SettingRow label={t('updater.currentVersion')} value={APP_VERSION} />
                <UpdateCheckButton />
                <UpdateServerConfig />
            </SettingsCard>

            <SettingsCard
                icon={<FileCode size={15} />}
                title={t('settings.about.extractorsTitle')}
                subtitle={t('settings.card.extractorsSub')}
                defaultCollapsed
            >
                <ExtractorCapabilityTable />
            </SettingsCard>

            <SettingsCard
                icon={<AlertTriangle size={15} />}
                title={t('crashReport.title')}
                subtitle={t('settings.card.crashLogsSub')}
                defaultCollapsed
                accentColor="var(--color-warning)"
            >
                <CrashLogViewer />
            </SettingsCard>
        </div>
    );
}

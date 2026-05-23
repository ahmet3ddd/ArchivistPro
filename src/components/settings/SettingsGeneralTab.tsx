import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Moon, Sun, Search, Route, Zap, User, Palette, FolderSearch, Wrench, HelpCircle, Book, Lightbulb, Keyboard, Cpu } from 'lucide-react';
import { probeWebGPU, type EmbeddingDevicePref } from '../../services/embeddings';
import { useStore } from '../../store/useStore';
import { useIsAdmin, useAppRole, useIsDeveloper } from '../../permissions';
import { notifySuccess } from '../../services/notificationCenter';
import { getTheme, toggleTheme, type Theme, getAccentColor, setAccentColor, type AccentColor } from '../../services/themeService';
import { getSetting, setSettingPersistent } from '../../services/database';
import { SettingsCard, SettingRow } from './settingsShared';
import { FOLDER_WATCH_CHANGED_EVENT } from '../../hooks/useFolderWatchSettings';

/* ── ThemeToggle ── */

function ThemeToggle() {
    const { t } = useTranslation();
    const [theme, setThemeState] = useState<Theme>(getTheme());
    const handleToggle = () => {
        const next = toggleTheme();
        setThemeState(next);
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>{t('settings.appearance.theme')}</span>
            <button onClick={handleToggle} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.04)',
                cursor: 'pointer', fontSize: '0.74rem', fontWeight: 500, color: 'var(--color-text-primary)',
            }}>
                {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                {theme === 'dark' ? t('settings.theme.dark') : t('settings.theme.light')}
            </button>
        </div>
    );
}

/* ── AccentColorPicker ── */

const ACCENT_OPTIONS: Array<{ key: AccentColor; color: string }> = [
    { key: 'default', color: '#6366f1' },
    { key: 'amber',   color: '#ffa000' },
    { key: 'lime',    color: '#98e504' },
    { key: 'teal',    color: '#0accb3' },
];

function AccentColorPicker() {
    const { t } = useTranslation();
    const [accent, setAccent] = useState<AccentColor>(getAccentColor());
    const handlePick = (color: AccentColor) => {
        setAccentColor(color);
        setAccent(color);
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>{t('settings.appearance.accentColor')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
                {ACCENT_OPTIONS.map((opt) => (
                    <button
                        key={opt.key}
                        onClick={() => handlePick(opt.key)}
                        title={t(`settings.accent.${opt.key}`)}
                        style={{
                            width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                            border: accent === opt.key ? `2px solid ${opt.color}` : '2px solid var(--color-border)',
                            background: opt.color, padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'border-color 0.15s, transform 0.15s',
                            transform: accent === opt.key ? 'scale(1.15)' : 'scale(1)',
                            boxShadow: accent === opt.key ? `0 0 12px ${opt.color}40` : 'none',
                        }}
                    >
                        {accent === opt.key && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── Fp32ModelSetting ── */
// WebGPU fp32 modelleri MSI'ye gömülmez (~580MB+, "tamamen offline" korunur).
// Kullanıcı `npm run models:download:fp32` ile dolan 'public/models' klasörünü
// gösterir; Rust app_local_data_dir/models'a kopyalar. ODA paterninin aynısı.

function Fp32ModelSetting() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<'unknown' | 'found' | 'notfound'>('unknown');
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<{ pct: number; file: string } | null>(null);
    const [modelPath, setModelPath] = useState<string>('');

    const refresh = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const s = await invoke<{ imported: boolean; path: string }>('fp32_models_status');
            setModelPath(s.path);
            setStatus(s.imported ? 'found' : 'notfound');
        } catch { setStatus('unknown'); }
    };

    useEffect(() => { void refresh(); }, []);

    const handleBrowse = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const result = await open({
                title: t('settings.fp32.pathLabel'),
                directory: true,
                multiple: false,
            });
            if (!result || typeof result !== 'string') return;

            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            setImporting(true);
            setProgress({ pct: 0, file: '' });
            const unlisten = await listen<{
                phase: string; current_file: string; copied_bytes: number; total_bytes: number;
            }>('fp32_import_progress', (e) => {
                const p = e.payload;
                const pct = p.total_bytes > 0 ? Math.round((p.copied_bytes / p.total_bytes) * 100) : 0;
                setProgress({ pct, file: p.current_file });
            });
            try {
                await invoke('import_fp32_models', { sourceDir: result });
                notifySuccess(t('settings.fp32.imported'));
                await refresh();
            } finally {
                unlisten();
                setImporting(false);
                setProgress(null);
            }
        } catch (err) {
            // Dialog iptal veya import hatası — hata mesajını göster
            const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
            if (msg) useStore.getState().addToast(msg, 'error');
        }
    };

    const statusColor = status === 'found' ? 'var(--color-success)' : status === 'notfound' ? 'var(--color-error)' : 'var(--color-text-muted)';
    const statusText = status === 'found' ? t('settings.fp32.statusFound') : status === 'notfound' ? t('settings.fp32.statusNotFound') : t('settings.fp32.statusUnknown');

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.fp32.description')}
            </div>
            {status === 'found' && modelPath && (
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 6, wordBreak: 'break-all' }}>
                    {t('settings.fp32.pathLabel')}: <span style={{ color: 'var(--color-text-primary)' }}>{modelPath}</span>
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <span style={{ fontSize: '0.72rem', color: statusColor }}>{statusText}</span>
                {status === 'found' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>· {t('settings.fp32.restartHint')}</span>
                )}
            </div>
            {importing && progress && (
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    {t('settings.fp32.importing')} %{progress.pct}{progress.file ? ` — ${progress.file}` : ''}
                </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={handleBrowse} disabled={importing} style={{ fontSize: '0.72rem', gap: 6, padding: '5px 12px' }}>
                    <Zap size={12} /> {t('settings.fp32.browse')}
                </button>
            </div>
        </div>
    );
}

/* ── OdaConverterSetting ── */

function OdaConverterSetting() {
    const { t } = useTranslation();
    const [odaPath, setOdaPath] = useState<string>(() => localStorage.getItem('oda_converter_path') || '');
    const [status, setStatus] = useState<'unknown' | 'found' | 'notfound' | 'detecting'>('unknown');
    const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'installed' | 'no_installer'>('idle');

    useEffect(() => {
        import('@tauri-apps/api/core').then(async ({ invoke }) => {
            try {
                const saved = localStorage.getItem('oda_converter_path');
                if (saved) {
                    try { await invoke('set_oda_converter_path', { path: saved }); setStatus('found'); }
                    catch { setStatus('notfound'); }
                } else {
                    const detected = await invoke<string | null>('get_oda_converter_path_cmd');
                    if (detected) { setOdaPath(detected); setStatus('found'); }
                    else setStatus('notfound');
                }
            } catch { setStatus('unknown'); }
        }).catch(() => setStatus('unknown'));
    }, []);

    const handleAutoDetect = async () => {
        setStatus('detecting');
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const detected = await invoke<string | null>('detect_oda_converter');
            if (detected) {
                setOdaPath(detected);
                localStorage.setItem('oda_converter_path', detected);
                await invoke('set_oda_converter_path', { path: detected });
                setStatus('found');
            } else setStatus('notfound');
        } catch { setStatus('notfound'); }
    };

    const handleBrowse = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const result = await open({
                title: t('settings.oda.pathLabel'),
                filters: [{ name: 'ODAFileConverter', extensions: ['exe', 'msi'] }],
                multiple: false,
            });
            if (!result || typeof result !== 'string') return;
            const lower = result.toLowerCase();
            if (lower.endsWith('.msi')) {
                setInstallStatus('installing');
                const { invoke } = await import('@tauri-apps/api/core');
                try {
                    await invoke<string>('run_local_oda_installer', { path: result });
                    setInstallStatus('installed');
                    const detected = await invoke<string | null>('detect_oda_converter');
                    if (detected) {
                        setOdaPath(detected);
                        localStorage.setItem('oda_converter_path', detected);
                        await invoke('set_oda_converter_path', { path: detected });
                        setStatus('found');
                        notifySuccess(t('settings.oda.installed'));
                    } else setStatus('notfound');
                } catch { setInstallStatus('no_installer'); }
            } else {
                const { invoke } = await import('@tauri-apps/api/core');
                setOdaPath(result);
                localStorage.setItem('oda_converter_path', result);
                await invoke('set_oda_converter_path', { path: result });
                setStatus('found');
            }
        } catch { /* dialog cancel */ }
    };

    const statusColor = status === 'found' ? 'var(--color-success)' : status === 'notfound' ? 'var(--color-error)' : 'var(--color-text-muted)';
    const statusText = status === 'found' ? t('settings.oda.statusFound') : status === 'notfound' ? t('settings.oda.statusNotFound') : status === 'detecting' ? t('settings.oda.statusDetecting') : t('settings.oda.statusUnknown');

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.oda.description')}
            </div>
            {odaPath && (
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 6, wordBreak: 'break-all' }}>
                    {t('settings.oda.pathLabel')}: <span style={{ color: 'var(--color-text-primary)' }}>{odaPath}</span>
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <span style={{ fontSize: '0.72rem', color: statusColor }}>{statusText}</span>
                {installStatus === 'installing' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{t('settings.oda.installing')}</span>
                )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={handleAutoDetect} disabled={status === 'detecting'} style={{ fontSize: '0.72rem', gap: 6, padding: '5px 12px' }}>
                    <Search size={12} /> {t('settings.oda.autoDetect')}
                </button>
                <button className="btn btn-ghost" onClick={handleBrowse} style={{ fontSize: '0.72rem', gap: 6, padding: '5px 12px' }}>
                    <Zap size={12} /> {t('settings.oda.browse')}
                </button>
            </div>
        </div>
    );
}

/* ── AutoRagIndexToggle ── */

function AutoRagIndexToggle() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState<boolean>(() => getSetting('auto_rag_index_after_scan') !== 'false');

    const handleToggle = () => {
        const next = !enabled;
        setEnabled(next);
        // Rust üzerinden tek SQL UPDATE — UI bloklamaz
        void setSettingPersistent('auto_rag_index_after_scan', next ? 'true' : 'false');
        // Reactive hook'a sinyal gönder — Sidebar/ScanModal anında güncellenir
        window.dispatchEvent(new Event('archivist:autoRagIndexChanged'));
    };

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                    {t('settings.autoRagIndex.toggle')}
                </span>
                <button
                    onClick={handleToggle}
                    style={{
                        position: 'relative',
                        width: 38, height: 20, borderRadius: 10,
                        background: enabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer', transition: 'background 0.15s',
                        flexShrink: 0,
                    }}
                    aria-pressed={enabled}
                >
                    <div style={{
                        position: 'absolute', top: 1, left: enabled ? 19 : 1,
                        width: 16, height: 16, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.15s',
                    }} />
                </button>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {t('settings.autoRagIndex.description')}
            </div>
        </div>
    );
}

/* ── FolderWatchToggles ── */

function FolderWatchToggles() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState<boolean>(() => getSetting('folder_watch_enabled') !== 'false');
    const [autoRescan, setAutoRescan] = useState<boolean>(() => getSetting('folder_watch_auto_rescan') === 'true');

    const handleEnabledToggle = () => {
        const next = !enabled;
        setEnabled(next);
        void setSettingPersistent('folder_watch_enabled', next ? 'true' : 'false');
        window.dispatchEvent(new Event(FOLDER_WATCH_CHANGED_EVENT));
    };

    const handleAutoRescanToggle = () => {
        if (!enabled) return; // disabled iken etkisiz
        const next = !autoRescan;
        setAutoRescan(next);
        void setSettingPersistent('folder_watch_auto_rescan', next ? 'true' : 'false');
        window.dispatchEvent(new Event(FOLDER_WATCH_CHANGED_EVENT));
    };

    const renderSwitch = (on: boolean, onClick: () => void, isDisabled = false) => (
        <button
            onClick={onClick}
            disabled={isDisabled}
            style={{
                position: 'relative',
                width: 38, height: 20, borderRadius: 10,
                background: on ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.45 : 1,
                transition: 'background 0.15s, opacity 0.15s',
                flexShrink: 0,
            }}
            aria-pressed={on}
        >
            <div style={{
                position: 'absolute', top: 1, left: on ? 19 : 1,
                width: 16, height: 16, borderRadius: '50%',
                background: '#fff', transition: 'left 0.15s',
            }} />
        </button>
    );

    return (
        <>
            <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('settings.folderWatch.enabledToggle')}
                    </span>
                    {renderSwitch(enabled, handleEnabledToggle)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    {t('settings.folderWatch.enabledDescription')}
                </div>
            </div>

            <div style={{ padding: '8px 0', paddingLeft: 16, opacity: enabled ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('settings.folderWatch.autoRescanToggle')}
                    </span>
                    {renderSwitch(autoRescan && enabled, handleAutoRescanToggle, !enabled)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    {t('settings.folderWatch.autoRescanDescription')}
                </div>
            </div>
        </>
    );
}

/* ── ScanCheckpointSelector ── */

function ScanCheckpointSelector() {
    const { t } = useTranslation();
    const [interval, setIntervalVal] = useState<number>(() => {
        const raw = getSetting('scan_checkpoint_interval');
        return raw ? parseInt(raw, 10) || 50 : 50;
    });
    const presets = [1, 5, 10, 25, 50, 75, 100];
    const handleChange = (value: number) => {
        const clamped = Math.max(1, Math.min(100, value));
        setIntervalVal(clamped);
        void setSettingPersistent('scan_checkpoint_interval', String(clamped));
    };
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 6 }}>
                {t('settings.scan.checkpointTitle')}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.scan.checkpointDescription')}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {presets.map((val) => (
                    <button key={val} onClick={() => handleChange(val)}
                        className={interval === val ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.74rem' }}>
                        {val}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── ScanPrepareWorkersSelector ── */

/**
 * Donanıma göre güvenli concurrency önerisi.
 * Formül: min(16, max(1, cores - 2)) — OS + UI + embed worker için 2 çekirdek headroom.
 */
function computeRecommendedWorkers(cores: number): number {
    return Math.min(16, Math.max(1, cores - 2));
}

function ScanPrepareWorkersSelector() {
    const { t } = useTranslation();
    const detectedCores = navigator.hardwareConcurrency ?? 0;
    const recommended = detectedCores > 0 ? computeRecommendedWorkers(detectedCores) : 3;
    const [workers, setWorkers] = useState<number>(() => {
        const raw = getSetting('scan_prepare_workers');
        const parsed = raw ? parseInt(raw, 10) : 3;
        return Number.isFinite(parsed) && parsed >= 1 && parsed <= 16 ? parsed : 3;
    });
    const presets = [1, 2, 3, 4, 6, 8, 12, 16];
    const handleChange = (value: number) => {
        const clamped = Math.max(1, Math.min(16, value));
        setWorkers(clamped);
        void setSettingPersistent('scan_prepare_workers', String(clamped));
    };
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 6 }}>
                {t('settings.scan.prepareWorkersTitle')}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.scan.prepareWorkersDescription')}
            </div>
            {detectedCores > 0 && (
                <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: 8,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--color-surface-elevated, rgba(127,127,127,0.08))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                }}>
                    <span>
                        {t('settings.scan.prepareWorkersDetected', { cores: detectedCores, recommended })}
                    </span>
                    <button
                        onClick={() => handleChange(recommended)}
                        className={workers === recommended ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '3px 10px', fontSize: '0.7rem' }}
                    >
                        {t('settings.scan.prepareWorkersAutoApply')}
                    </button>
                </div>
            )}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {presets.map((val) => (
                    <button key={val} onClick={() => handleChange(val)}
                        className={workers === val ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.74rem', position: 'relative' }}>
                        {val}
                        {val === recommended && detectedCores > 0 && (
                            <span style={{
                                position: 'absolute', top: -4, right: -4,
                                width: 6, height: 6, borderRadius: '50%',
                                background: 'var(--color-accent, #6366f1)',
                            }} />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── EmbeddingDeviceSelector ── */

function EmbeddingDeviceSelector() {
    const { t } = useTranslation();
    const [pref, setPref] = useState<EmbeddingDevicePref>(() => {
        const raw = getSetting('embedding_device');
        return (raw === 'webgpu' || raw === 'wasm' || raw === 'auto') ? raw : 'auto';
    });
    const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        probeWebGPU().then((ok) => { if (!cancelled) setGpuAvailable(ok); });
        return () => { cancelled = true; };
    }, []);

    const choose = (value: EmbeddingDevicePref) => {
        setPref(value);
        void setSettingPersistent('embedding_device', value);
    };

    const options: Array<{ value: EmbeddingDevicePref; labelKey: string }> = [
        { value: 'auto', labelKey: 'settings.ai.deviceAuto' },
        { value: 'webgpu', labelKey: 'settings.ai.deviceGpu' },
        { value: 'wasm', labelKey: 'settings.ai.deviceCpu' },
    ];

    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cpu size={13} />
                {t('settings.ai.deviceTitle')}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.ai.deviceDescription')}
            </div>
            {gpuAvailable !== null && (
                <div style={{
                    fontSize: '0.7rem',
                    color: gpuAvailable ? 'var(--color-success, #10b981)' : 'var(--color-text-secondary)',
                    marginBottom: 8,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--color-surface-elevated, rgba(127,127,127,0.08))',
                }}>
                    {gpuAvailable ? t('settings.ai.deviceProbeOk') : t('settings.ai.deviceProbeMissing')}
                </div>
            )}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {options.map((opt) => (
                    <button key={opt.value} onClick={() => choose(opt.value)}
                        className={pref === opt.value ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.74rem' }}>
                        {t(opt.labelKey)}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                {t('settings.ai.deviceRestartNote')}
            </div>
        </div>
    );
}

/* ── SettingsGeneralTab ── */

interface SettingsGeneralTabProps {
    onClose: () => void;
}

export default function SettingsGeneralTab({ onClose }: SettingsGeneralTabProps) {
    const { t } = useTranslation();
    const isAdmin = useIsAdmin();
    const isDev = useIsDeveloper();
    const role = useAppRole();
    const currentUser = useStore((s) => s.currentUser);
    const activeArchive = useStore((s) => s.activeArchive);
    const archives = useStore((s) => s.archives);
    const currentArchiveDef = archives.find(a => a.id === activeArchive);

    return (
        <div>
            <SettingsCard
                icon={<User size={15} />}
                title={t('settings.section.userInfo')}
                subtitle={t('settings.card.userInfoSub')}
                collapsible={false}
            >
                <SettingRow label={t('settings.user.username')} value={currentUser || '-'} />
                <SettingRow label={t('settings.user.role')} value={role === 'admin' ? t('common.role.admin') : t('common.role.viewer')} />
                <SettingRow label={t('settings.user.activeArchive')} value={currentArchiveDef?.name || activeArchive} />
            </SettingsCard>

            <SettingsCard
                icon={<Palette size={15} />}
                title={t('settings.section.appearance')}
                subtitle={t('settings.card.appearanceSub')}
            >
                <ThemeToggle />
                <AccentColorPicker />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>{t('settings.language.description')}</span>
                    <select
                        value={i18n.language}
                        onChange={(e) => {
                            const lng = e.target.value;
                            i18n.changeLanguage(lng);
                            localStorage.setItem('archivist_language', lng);
                            import('../../i18n').then(({ applyLanguage }) => applyLanguage(lng));
                        }}
                        style={{
                            padding: '4px 8px', fontSize: '0.82rem', borderRadius: 4,
                            border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-primary)', cursor: 'pointer',
                        }}
                    >
                        <option value="tr">Türkçe</option>
                        <option value="en">English</option>
                        <option value="zh">中文 (Çince)</option>
                        <option value="ja">日本語 (Japonca)</option>
                        <option value="ar">العربية (Arapça)</option>
                    </select>
                </div>
            </SettingsCard>

            <SettingsCard
                icon={<FolderSearch size={15} />}
                title={t('settings.section.scanning')}
                subtitle={t('settings.card.scanningSub')}
            >
                <AutoRagIndexToggle />
                <FolderWatchToggles />
                <div style={{
                    borderTop: '1px solid var(--color-border)',
                    marginTop: 12,
                    paddingTop: 12,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 10,
                }}>
                    {t('settings.card.performance')}
                </div>
                <ScanCheckpointSelector />
                <ScanPrepareWorkersSelector />
                <EmbeddingDeviceSelector />
            </SettingsCard>

            {(isAdmin || isDev) && (
                <SettingsCard
                    icon={<Wrench size={15} />}
                    title={t('settings.section.odaConverter')}
                    subtitle={t('settings.card.odaSub')}
                    defaultCollapsed
                >
                    <OdaConverterSetting />
                </SettingsCard>
            )}

            {(isAdmin || isDev) && (
                <SettingsCard
                    icon={<Cpu size={15} />}
                    title={t('settings.section.fp32')}
                    subtitle={t('settings.card.fp32Sub')}
                    defaultCollapsed
                >
                    <Fp32ModelSetting />
                </SettingsCard>
            )}

            <SettingsCard
                icon={<HelpCircle size={15} />}
                title={t('settings.section.help')}
                subtitle={t('settings.card.helpSub')}
                defaultCollapsed
            >
                {/* Kullanım Kılavuzu */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('help.tab.userGuide')}
                    </span>
                    <button
                        className="btn btn-ghost"
                        onClick={() => {
                            onClose();
                            setTimeout(() => window.dispatchEvent(new CustomEvent('archivistpro:help-open', { detail: { mode: 'guide' } })), 150);
                        }}
                        style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                    >
                        <Book size={14} />
                        {t('common.open')}
                    </button>
                </div>

                {/* Ne Yapabilirim? */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('help.tab.scenarios')}
                    </span>
                    <button
                        className="btn btn-ghost"
                        onClick={() => {
                            onClose();
                            setTimeout(() => window.dispatchEvent(new CustomEvent('archivistpro:help-open', { detail: { mode: 'scenarios' } })), 150);
                        }}
                        style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                    >
                        <Lightbulb size={14} />
                        {t('common.open')}
                    </button>
                </div>

                {/* Klavye Kısayolları */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('help.tab.shortcuts')}
                    </span>
                    <button
                        className="btn btn-ghost"
                        onClick={() => {
                            onClose();
                            setTimeout(() => window.dispatchEvent(new CustomEvent('archivistpro:help-open', { detail: { mode: 'shortcuts' } })), 150);
                        }}
                        style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                    >
                        <Keyboard size={14} />
                        {t('common.open')}
                    </button>
                </div>

                {/* Tanıtım Turu */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                        {t('onboarding.replayTour')}
                    </span>
                    <button
                        className="btn btn-ghost"
                        onClick={() => {
                            void setSettingPersistent('onboarding_completed', '');
                            useStore.getState().setIsOnboardingTourOpen(true);
                            onClose();
                        }}
                        style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                    >
                        <Route size={14} />
                        {t('onboarding.letsGo')}
                    </button>
                </div>
            </SettingsCard>
        </div>
    );
}

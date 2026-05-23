import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
    HardDrive, Shield, GitMerge, Package, Plus, Clock,
    RotateCcw, Trash2, ShieldCheck, CheckCircle, XCircle, Route, Loader2,
    Wrench,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useIsAdmin } from '../../permissions';
import { notifyError } from '../../services/notificationCenter';
import {
    getDatabase, remapFilePaths, saveDatabaseDeferred, setDatabasePath, setLocalDatabasePath,
    reloadDatabase, reloadDatabaseForArchive, getAllAssets, getAllAssetsFromArchive, getSetting, setSettingPersistent,
    MAIN_ARCHIVE_ID, LOCAL_ARCHIVE_ID, findOrphanedAssets, deleteOrphanedAssets, getScannedRoots,
    applyV3PostImportUpgrade, getSchemaEpoch, runV3EpochMigration,
} from '../../services/database';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, type SnapshotInfo } from '../../services/dbSnapshot';
import { exportArchive, importArchive, peekArchive, suggestArchiveFileName } from '../../services/archiveShare';
import ArchiveMergeModal from '../ArchiveMergeModal';
import ArchiveExtractModal from '../ArchiveExtractModal';
import ArchiveImportModal, { type ImportRemapOptions } from '../ArchiveImportModal';
import { SettingsCard } from './settingsShared';

/* ── Yardımcılar ── */

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${i === 0 ? String(bytes) : n.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

/* ── ArchiveCard ── */

function ArchiveCard({ title, isActive, path, size, color, readOnly, description, onChangePath }: {
    title: string; isActive: boolean; path: string; size: string; color: string;
    readOnly: boolean; description: string; onChangePath?: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div style={{
            padding: '12px 14px', borderRadius: 10, marginBottom: 10,
            border: `1px solid ${isActive ? color + '40' : 'var(--color-border)'}`,
            background: isActive ? color + '08' : 'transparent',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: isActive ? 1 : 0.3 }} />
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</span>
                </div>
                {isActive && (
                    <span style={{ fontSize: '0.64rem', fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: color + '20', color }}>
                        {t('settings.archive.active')}
                    </span>
                )}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>{description}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '4px 0' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.archive.location')}</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', direction: 'rtl' }}>{path}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '4px 0' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.archive.size')}</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{size || '—'}</span>
            </div>
            {readOnly && (
                <div style={{ fontSize: '0.66rem', color: '#f59e0b', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Shield size={10} />
                    {t('settings.archive.readOnly')}
                </div>
            )}
            {onChangePath && (
                <button className="btn btn-ghost" onClick={onChangePath} style={{ marginTop: 8, fontSize: '0.72rem', gap: 6, padding: '5px 12px' }}>
                    <HardDrive size={12} />
                    {t('settings.archive.changePath')}
                </button>
            )}
        </div>
    );
}

/* ── BackupScheduleSelector ── */

function BackupScheduleSelector() {
    const { t } = useTranslation();
    const [interval, setIntervalVal] = useState<number>(() => {
        const raw = getSetting('backup_interval_hours');
        return raw ? parseInt(raw, 10) || 0 : 0;
    });
    const options = [
        { value: 0, label: t('settings.backup.scheduleOff') },
        { value: 1, label: '1 ' + t('settings.backup.hours') },
        { value: 4, label: '4 ' + t('settings.backup.hours') },
        { value: 8, label: '8 ' + t('settings.backup.hours') },
        { value: 24, label: '24 ' + t('settings.backup.hours') },
    ];
    const handleChange = (hours: number) => {
        setIntervalVal(hours);
        // Rust üzerinden tek SQL UPDATE — tüm DB export'una gerek yok, ~1ms
        void setSettingPersistent('backup_interval_hours', String(hours));
    };
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 6 }}>
                {t('settings.backup.schedule')}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {options.map((opt) => (
                    <button key={opt.value} onClick={() => handleChange(opt.value)}
                        className={interval === opt.value ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.74rem' }}>
                        {opt.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── MaxSnapshotsSelector ── */

function MaxSnapshotsSelector() {
    const { t } = useTranslation();
    const [max, setMax] = useState<number>(() => {
        const raw = getSetting('max_snapshots');
        const n = raw ? parseInt(raw, 10) : 5;
        return Number.isFinite(n) && n >= 3 && n <= 30 ? n : 5;
    });
    const presets = [3, 5, 10, 15, 20, 30];
    const handleChange = (n: number) => {
        const clamped = Math.max(3, Math.min(30, n));
        setMax(clamped);
        void setSettingPersistent('max_snapshots', String(clamped));
    };
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 500, marginBottom: 4 }}>
                {t('settings.snapshot.maxTitle')}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                {t('settings.snapshot.maxDescription')}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {presets.map((val) => (
                    <button key={val} onClick={() => handleChange(val)}
                        className={max === val ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.72rem' }}>
                        {val}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── ArchiveExportImport ── */

function ArchiveExportImport() {
    const { t } = useTranslation();
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [pendingImport, setPendingImport] = useState<{
        filePath: string;
        dbSizeBytes: number;
        defaultOldRoot?: string;
        sourceRoots?: Array<{ path: string; assetCount: number }>;
    } | null>(null);

    const startTimer = () => {
        setElapsedSec(0);
        timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    };
    const stopTimer = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };

    const handleExport = async () => {
        setExporting(true);
        setStatus(null);
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const dest = await save({
                defaultPath: suggestArchiveFileName(),
                filters: [{ name: 'ArchivistPro Archive', extensions: ['archivistpro'] }],
            });
            if (!dest) { setExporting(false); return; }
            startTimer();
            const result = await exportArchive(dest);
            stopTimer();
            if (result) {
                const dbMb = (result.dbSizeBytes / 1024 / 1024).toFixed(1);
                const fileMb = result.fileSizeBytes ? (result.fileSizeBytes / 1024 / 1024).toFixed(1) : null;
                const text = fileMb
                    ? `Yedek alındı — Dosya: ${fileMb} MB (sıkıştırılmış · ham DB ${dbMb} MB)`
                    : `Yedek alındı — DB: ${dbMb} MB`;
                setStatus({ ok: true, text });
            } else {
                setStatus({ ok: false, text: 'Yedekleme başarısız' });
            }
        } catch (err) {
            stopTimer();
            setStatus({ ok: false, text: String(err) });
        } finally {
            setExporting(false);
        }
    };

    const handleImport = async () => {
        setStatus(null);
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const file = await open({
                filters: [{ name: 'ArchivistPro Archive', extensions: ['archivistpro'] }],
                multiple: false,
            });
            if (!file) return;
            const filePath = file as string;
            const manifest = await peekArchive(filePath);
            if (!manifest) { setStatus({ ok: false, text: 'Manifest okunamadı' }); return; }
            setPendingImport({
                filePath,
                dbSizeBytes: manifest.dbSizeBytes,
                defaultOldRoot: manifest.samplePathPrefix,
                sourceRoots: manifest.sourceRoots,
            });
        } catch (err) {
            setStatus({ ok: false, text: String(err) });
        }
    };

    const performImport = async (remap: ImportRemapOptions) => {
        if (!pendingImport) return;
        const { filePath } = pendingImport;
        setImporting(true);
        startTimer();
        try {
            const result = await importArchive(filePath, true);
            stopTimer();
            if (result.success) {
                await reloadDatabase();
                // V3 Faz 3 A5/A6: bayrak AÇIKSA + epoch hedef altıdaysa migrasyon
                // tetikle (idempotent/resume; premigrate-yedek + verify + atomik
                // DROP). Bayrak kapalı → NOOP. Hata fatal değildir; raporlanır.
                const upg = await applyV3PostImportUpgrade();
                // Opsiyonel: import sonrası her remap satırı için dosya yollarını yeniden eşle
                let appliedCount = 0;
                if (remap.enabled && remap.remaps.length > 0) {
                    for (const r of remap.remaps) {
                        if (r.oldRoot && r.newRoot && r.oldRoot !== r.newRoot) {
                            remapFilePaths(r.oldRoot, r.newRoot);
                            appliedCount++;
                        }
                    }
                    if (appliedCount > 0) saveDatabaseDeferred();
                }
                const assets = getAllAssets();
                useStore.getState().setScannedAssets(assets);
                useStore.getState().setScannedRoots(getScannedRoots());
                const upgNote = upg.triggered
                    ? upg.ok
                        ? ` · v3 epoch→${upg.epoch}`
                        : ` · v3 upgrade hata: ${upg.error ?? 'bilinmeyen'}`
                    : '';
                setStatus({
                    ok: true,
                    text: (appliedCount > 0
                        ? `Geri yüklendi · ${appliedCount} kök yol yeniden eşlendi`
                        : 'Geri yüklendi') + upgNote,
                });
                setPendingImport(null);
            } else if (result.rolledBack) {
                setStatus({ ok: false, text: result.error || 'İçe aktarma başarısız — yedekten geri yüklendi' });
            } else {
                notifyError(t('archiveImport.failed'));
                setStatus({ ok: false, text: result.error || 'İçe aktarma başarısız' });
            }
        } catch (err) {
            stopTimer();
            setStatus({ ok: false, text: String(err) });
        } finally {
            setImporting(false);
        }
    };

    const isBusy = exporting || importing;
    const busyLabel = exporting ? t('settings.archiveBackup.exportLabel') : t('settings.archiveBackup.importLabel');

    return (
        <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                    onClick={handleExport}
                    disabled={isBusy}
                    style={{
                        padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                        cursor: isBusy ? 'wait' : 'pointer', fontSize: '0.74rem',
                    }}
                >
                    {t('settings.archiveBackup.exportButton')}
                </button>
                <button
                    onClick={handleImport}
                    disabled={isBusy}
                    style={{
                        padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
                        cursor: isBusy ? 'wait' : 'pointer', fontSize: '0.74rem',
                    }}
                >
                    {t('settings.archiveBackup.importButton')}
                </button>
                {isBusy && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.74rem' }}>
                        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                        <span>{busyLabel}…{exporting ? ` ${elapsedSec}s` : ''}</span>
                    </div>
                )}
            </div>
            {status && (
                <div style={{ fontSize: '0.72rem', color: status.ok ? '#30a050' : '#e04040', padding: '2px 0' }}>
                    {status.text}
                </div>
            )}
            <ArchiveImportModal
                isOpen={pendingImport !== null}
                onClose={() => { if (!importing) setPendingImport(null); }}
                onConfirm={performImport}
                dbSizeBytes={pendingImport?.dbSizeBytes ?? 0}
                defaultOldRoot={pendingImport?.defaultOldRoot}
                sourceRoots={pendingImport?.sourceRoots}
                importing={importing}
            />
        </div>
    );
}

/* ── SettingsStorageTab ── */

export default function SettingsStorageTab() {
    const { t } = useTranslation();
    const isAdmin = useIsAdmin();
    const activeArchive = useStore((s) => s.activeArchive);

    const [mainDbPath, setMainDbPath] = useState<string>(() => t('settings.storage.loading'));
    const [mainDbSize, setMainDbSize] = useState<string>('');
    const [localDbPath, setLocalDbPath] = useState<string>('');
    const [localDbSize, setLocalDbSize] = useState<string>('');
    const [remapOldPrefix, setRemapOldPrefix] = useState('');
    const [remapNewPrefix, setRemapNewPrefix] = useState('');
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
    const [healthCheckRunning, setHealthCheckRunning] = useState(false);
    const [orphanedAssets, setOrphanedAssets] = useState<{ id: string; fileName: string; filePath: string }[]>([]);
    const [healthCheckDone, setHealthCheckDone] = useState(false);
    const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
    const [snapshotCreating, setSnapshotCreating] = useState(false);

    // V3 migrasyon paneli durumu (2026-05-22: A6 default-on — panel aktif).
    const [v3Epoch, setV3Epoch] = useState<number | null>(null);
    const [v3Status, setV3Status] = useState<{
        phase: 'idle' | 'running' | 'success' | 'error';
        message?: string;
    }>({ phase: 'idle' });

    const snapshotArchiveType = activeArchive === LOCAL_ARCHIVE_ID ? 'local' : 'main';
    const canManageSnapshots = isAdmin || activeArchive === LOCAL_ARCHIVE_ID;

    const loadSnapshots = async () => {
        const list = await listSnapshots(snapshotArchiveType);
        setSnapshots(list);
    };

    useEffect(() => {
        loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeArchive]);

    useEffect(() => {
        import('@tauri-apps/api/core').then(async ({ invoke }) => {
            try {
                const [path, size] = await invoke<[string, number]>('get_database_info');
                setMainDbPath(path);
                setMainDbSize(formatBytes(size));
            } catch {
                setMainDbPath(t('settings.storage.browserMode'));
                try {
                    const bytes = getDatabase()?.export()?.length ?? 0;
                    setMainDbSize(formatBytes(bytes));
                } catch { /* */ }
            }
        }).catch(() => setMainDbPath(t('settings.storage.browserMode')));

        import('@tauri-apps/api/core').then(async ({ invoke }) => {
            try {
                const [path, size] = await invoke<[string, number]>('get_local_database_info');
                setLocalDbPath(path);
                setLocalDbSize(size > 0 ? formatBytes(size) : t('settings.storage.notCreated'));
            } catch {
                try {
                    const saved = localStorage.getItem('archivist_local_db');
                    setLocalDbSize(saved ? formatBytes(Math.round(saved.length * 0.75)) : t('settings.storage.notCreated'));
                } catch { setLocalDbSize('—'); }
            }
        }).catch(() => setLocalDbSize(t('settings.storage.notCreated')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleChangeDbLocation = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const result = await open({ title: t('settings.storage.selectFolder'), directory: true, multiple: false });
            if (!result || typeof result !== 'string') return;
            await setDatabasePath(result);
            useStore.getState().addToast(t('settings.storage.locationUpdated'), 'success');
        } catch { notifyError(t('settings.storage.locationUpdateError')); }
    };

    const handleChangeLocalDbLocation = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const result = await open({ title: t('settings.storage.selectFolder'), directory: true, multiple: false });
            if (!result || typeof result !== 'string') return;
            await setLocalDatabasePath(result);
            useStore.getState().addToast(t('settings.storage.locationUpdated'), 'success');
        } catch { notifyError(t('settings.storage.locationUpdateError')); }
    };

    const handleRemapPaths = () => {
        const oldP = remapOldPrefix.trim();
        const newP = remapNewPrefix.trim();
        if (!oldP) { useStore.getState().addToast(t('settings.storage.remapOldRequired'), 'warning'); return; }
        remapFilePaths(oldP, newP);
        saveDatabaseDeferred();
        useStore.getState().addToast(t('settings.storage.remapSuccess'), 'success');
    };

    // V3 epoch durumunu yükle (component mount'unda + tetikten sonra).
    useEffect(() => {
        try { setV3Epoch(getSchemaEpoch()); } catch { setV3Epoch(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Migrasyonu fiilen koşar (onay sonrası). NOT: `window.confirm` Tauri
    // webview'de YASAK ("dialog.confirm not allowed") → uygulama-içi
    // `showConfirmDialog` kullanılır (aşağıda handleV3Migrate).
    const runV3MigrateConfirmed = async () => {
        setV3Status({ phase: 'running', message: 'Migrasyon başlıyor (premigrate yedek + epoch 1/2/3)…' });
        try {
            const result = await runV3EpochMigration();
            const newEpoch = getSchemaEpoch();
            setV3Epoch(newEpoch);
            if (result.ok) {
                setV3Status({
                    phase: 'success',
                    message: `Tamamlandı. Şema epoch=${result.epoch}. Embeddings/text_chunks/asset_relations artık vec.db'de.`,
                });
            } else {
                setV3Status({
                    phase: 'error',
                    message: `Başarısız: ${result.error ?? 'bilinmeyen sebep'} — premigrate yedeği duruyor; sql.js sağlam.`,
                });
            }
        } catch (err) {
            setV3Status({ phase: 'error', message: `Hata: ${String(err)}` });
        }
    };

    const handleV3Migrate = () => {
        if (v3Epoch === null) return;
        useStore.getState().showConfirmDialog(
            'V3 Şema Migrasyonu',
            `Mevcut epoch ${v3Epoch} → hedef 3. Önce sql.js diske kalıcılaştırılır + `
            + `premigrate yedek alınır; sonra her epoch için migrate → verify → `
            + `atomik DROP+user_version. Hata olursa rollback yedeği duruyor, `
            + `sql.js sağlam kalır. Tahmini süre 10–60 sn. Devam edilsin mi?`,
            () => { void runV3MigrateConfirmed(); },
        );
    };

    return (
        <>
        <div>
            {/* ── Arşivler ── */}
            <SettingsCard
                icon={<HardDrive size={15} />}
                title={t('settings.section.archives')}
                subtitle={t('settings.card.archivesSub')}
                collapsible={false}
            >
                <ArchiveCard
                    title={t('common.archive.main')} isActive={activeArchive === MAIN_ARCHIVE_ID}
                    path={mainDbPath} size={mainDbSize} color="#10b981" readOnly={!isAdmin}
                    description={isAdmin ? t('settings.archive.managedByAdmin') : t('settings.archive.readOnlyAccess')}
                    onChangePath={isAdmin ? handleChangeDbLocation : undefined}
                />
                <ArchiveCard
                    title={t('common.archive.local')} isActive={activeArchive === LOCAL_ARCHIVE_ID}
                    path={localDbPath || t('settings.archive.localStoragePath')} size={localDbSize}
                    color="#a855f7" readOnly={false}
                    description={t('settings.archive.personalFullAccess')}
                    onChangePath={handleChangeLocalDbLocation}
                />
            </SettingsCard>

            {/* ── V3 Şema Migrasyonu (admin-only) ── */}
            {isAdmin && (
                <SettingsCard
                    icon={<Wrench size={15} />}
                    title="V3 Şema Migrasyonu"
                    subtitle="Büyük tabloları (embeddings, text_chunks, asset_relations) ayrı vec.db dosyasına taşır — büyük arşivlerde RAM kazancı + arama hızı."
                    collapsible={false}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: '0.78rem' }}>
                            Mevcut durum:{' '}
                            <strong style={{ color: v3Epoch === 3 ? '#30a050' : 'var(--color-text-primary)' }}>
                                {v3Epoch === null ? 'okunuyor…' : `epoch=${v3Epoch}`}
                            </strong>
                            <span style={{ color: 'var(--color-text-muted)' }}> / hedef: 3</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                            {v3Epoch === 3
                                ? '✅ Migrasyon tamamlanmış. Yapacak iş yok.'
                                : 'Sıra: sql.js diske kalıcılaştırılır → premigrate yedek (geri dönüş için) → her epoch için migrate → verify → atomik DROP+user_version. Hata olursa rollback yedeği duruyor.'}
                        </div>
                        {v3Epoch !== null && v3Epoch < 3 && v3Status.phase !== 'running' && (
                            <button
                                onClick={handleV3Migrate}
                                style={{
                                    padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border)',
                                    background: '#8b5cf6', color: '#fff', cursor: 'pointer',
                                    fontSize: '0.78rem', fontWeight: 500, alignSelf: 'flex-start',
                                }}
                            >
                                Migrasyonu Şimdi Tetikle
                            </button>
                        )}
                        {v3Status.phase === 'running' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.74rem' }}>
                                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                <span>{v3Status.message}</span>
                            </div>
                        )}
                        {v3Status.phase === 'success' && (
                            <div style={{ fontSize: '0.74rem', color: '#30a050', padding: '4px 0' }}>
                                ✅ {v3Status.message}
                            </div>
                        )}
                        {v3Status.phase === 'error' && (
                            <div style={{ fontSize: '0.74rem', color: '#e04040', padding: '4px 0' }}>
                                ❌ {v3Status.message}
                            </div>
                        )}
                    </div>
                </SettingsCard>
            )}

            {/* ── Arşiv İşlemleri (Remap + Merge + Extract) ── */}
            {(isAdmin || activeArchive === LOCAL_ARCHIVE_ID) && (
                <SettingsCard
                    icon={<GitMerge size={15} />}
                    title={t('settings.card.archiveOps')}
                    subtitle={t('settings.card.archiveOpsSub')}
                    defaultCollapsed
                >
                    {/* Path Remap */}
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 6 }}>{t('settings.section.pathRemap')}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                            {t('settings.remap.description')}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input type="text" placeholder={t('settings.remap.oldPlaceholder')} value={remapOldPrefix} onChange={(e) => setRemapOldPrefix(e.target.value)}
                                style={{ fontSize: '0.76rem', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-primary)' }} />
                            <input type="text" placeholder={t('settings.remap.newPlaceholder')} value={remapNewPrefix} onChange={(e) => setRemapNewPrefix(e.target.value)}
                                style={{ fontSize: '0.76rem', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text-primary)' }} />
                            <button className="btn btn-ghost" onClick={handleRemapPaths} style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8 }}>
                                <Route size={14} /> {t('settings.remap.button')}
                            </button>
                        </div>
                    </div>

                    {/* Merge */}
                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, marginBottom: 14 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4 }}>{t('settings.section.archiveMerge')}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                            {t('settings.merge.description')}
                        </div>
                        <button className="btn btn-ghost" onClick={() => setIsMergeModalOpen(true)}
                            style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8 }}>
                            <GitMerge size={14} /> {t('settings.merge.openButton')}
                        </button>
                    </div>

                    {/* Extract */}
                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4 }}>{t('settings.section.archiveExtract')}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                            {t('settings.extract.description')}
                        </div>
                        <button className="btn btn-ghost" onClick={() => setIsExtractModalOpen(true)}
                            style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8 }}>
                            <Package size={14} /> {t('settings.extract.openButton')}
                        </button>
                    </div>
                </SettingsCard>
            )}

            {/* ── Yedekleme & Snapshot ── */}
            <SettingsCard
                icon={<Clock size={15} />}
                title={t('settings.section.backup')}
                subtitle={t('settings.card.backupSub')}
            >
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    {t('settings.backup.autoDescription')}
                </div>
                <BackupScheduleSelector />

                {canManageSnapshots && <MaxSnapshotsSelector />}

                {canManageSnapshots && (
                    <button className="btn btn-ghost" disabled={snapshotCreating}
                        onClick={async () => {
                            setSnapshotCreating(true);
                            try {
                                const result = await createSnapshot(snapshotArchiveType);
                                if (result) {
                                    await loadSnapshots();
                                    useStore.getState().addToast(t('settings.snapshot.createSuccess'), 'success');
                                } else {
                                    notifyError(t('settings.snapshot.createError'));
                                }
                            } catch { notifyError(t('settings.snapshot.createError')); }
                            finally { setSnapshotCreating(false); }
                        }}
                        style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8, marginBottom: 8 }}>
                        <Plus size={14} />
                        {snapshotCreating ? t('settings.snapshot.creating') : t('settings.snapshot.create')}
                    </button>
                )}

                {snapshots.length === 0 ? (
                    <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', padding: '8px 0' }}>
                        {t('settings.snapshot.empty')}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {snapshots.map((snap) => {
                            const date = new Intl.DateTimeFormat(i18n.language, {
                                day: 'numeric', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                            }).format(new Date(snap.createdAt));
                            return (
                                <div key={snap.fileName} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                                    borderRadius: 6, background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid var(--color-border)', fontSize: '0.72rem',
                                }}>
                                    <Clock size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{date}</span>
                                    <span style={{ color: 'var(--color-text-muted)' }}>&middot;</span>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>{formatBytes(snap.fileSize)}</span>
                                    {canManageSnapshots && (
                                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                            <button title={t('settings.snapshot.restore')} onClick={() => {
                                                useStore.getState().showConfirmDialog(
                                                    t('settings.snapshot.confirmRestore'),
                                                    t('settings.snapshot.confirmRestoreDetail', { date }),
                                                    async () => {
                                                        try {
                                                            const ok = await restoreSnapshot(snap.fileName, snapshotArchiveType);
                                                            if (ok) {
                                                                await reloadDatabaseForArchive(snapshotArchiveType);
                                                                const assets = getAllAssetsFromArchive(snapshotArchiveType);
                                                                useStore.getState().setScannedAssets(assets);
                                                                useStore.getState().setScannedRoots(getScannedRoots());
                                                                useStore.getState().addToast(t('settings.snapshot.restoreSuccess'), 'success');
                                                            } else { notifyError(t('settings.snapshot.restoreError')); }
                                                        } catch { notifyError(t('settings.snapshot.restoreError')); }
                                                    },
                                                    undefined, true
                                                );
                                            }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
                                                <RotateCcw size={13} />
                                            </button>
                                            <button title={t('settings.snapshot.delete')} onClick={() => {
                                                useStore.getState().showConfirmDialog(
                                                    t('settings.snapshot.confirmDelete'), '',
                                                    async () => {
                                                        try {
                                                            await deleteSnapshot(snap.fileName, snapshotArchiveType);
                                                            await loadSnapshots();
                                                            useStore.getState().addToast(t('settings.snapshot.deleteSuccess'), 'success');
                                                        } catch { notifyError(t('settings.snapshot.deleteError')); }
                                                    },
                                                    undefined, true
                                                );
                                            }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}>
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Taşınabilir Yedek */}
                <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 14, paddingTop: 12 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Package size={13} /> {t('settings.backup.portableTitle')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                        {t('settings.backup.portableDescription')}
                    </div>
                    <ArchiveExportImport />
                </div>

                {/* XMP Sidecar bilgi kutusu */}
                <div style={{
                    margin: '12px 0 0', padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.2)',
                    fontSize: '0.72rem', lineHeight: 1.7, color: 'var(--color-text-secondary)',
                }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Package size={13} /> {t('xmp.help.title')}
                    </div>
                    <div>{t('xmp.help.body')}</div>
                    <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                        {t('xmp.help.howTo')}
                    </div>
                </div>
            </SettingsCard>

            {/* ── Bakım ── */}
            {isAdmin && (
                <SettingsCard
                    icon={<Wrench size={15} />}
                    title={t('settings.card.maintenance')}
                    subtitle={t('settings.card.maintenanceSub')}
                    defaultCollapsed
                    accentColor="var(--color-warning)"
                >
                    {/* Sağlık kontrolü */}
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4 }}>{t('settings.section.healthCheck')}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                            {t('settings.healthCheck.description')}
                        </div>
                        <button className="btn btn-ghost" disabled={healthCheckRunning}
                            onClick={async () => {
                                setHealthCheckRunning(true); setHealthCheckDone(false); setOrphanedAssets([]);
                                try {
                                    const orphans = await findOrphanedAssets();
                                    setOrphanedAssets(orphans); setHealthCheckDone(true);
                                } catch { notifyError(t('settings.healthCheck.error')); }
                                finally { setHealthCheckRunning(false); }
                            }}
                            style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8 }}>
                            <ShieldCheck size={14} />
                            {healthCheckRunning ? t('settings.healthCheck.scanning') : t('settings.healthCheck.button')}
                        </button>
                        {healthCheckDone && orphanedAssets.length === 0 && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--color-success)', padding: '8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CheckCircle size={13} /> {t('settings.healthCheck.noOrphans')}
                            </div>
                        )}
                        {healthCheckDone && orphanedAssets.length > 0 && (
                            <div style={{ padding: '8px 0' }}>
                                <div style={{ fontSize: '0.74rem', color: 'var(--color-warning)', padding: '4px 0' }}>
                                    {t('settings.healthCheck.found', { count: orphanedAssets.length })}
                                </div>
                                <button className="btn btn-ghost" onClick={() => {
                                    const count = deleteOrphanedAssets(orphanedAssets.map(a => a.id));
                                    if (count > 0) { setOrphanedAssets([]); setHealthCheckDone(false); }
                                }} style={{ justifyContent: 'flex-start', fontSize: '0.76rem', gap: 8, color: 'var(--color-error)' }}>
                                    <XCircle size={14} />
                                    {t('settings.healthCheck.deleteButton', { count: orphanedAssets.length })}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Çöp kutusu bilgisi */}
                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4 }}>{t('settings.section.trash')}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                            {t('settings.trash.descriptionPart1')} <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: 3 }}>.archivistpro-trash/</code> {t('settings.trash.descriptionPart2')}
                        </div>
                    </div>
                </SettingsCard>
            )}
        </div>
        <ArchiveMergeModal isOpen={isMergeModalOpen} onClose={() => setIsMergeModalOpen(false)} />
        <ArchiveExtractModal isOpen={isExtractModalOpen} onClose={() => setIsExtractModalOpen(false)} />
        </>
    );
}

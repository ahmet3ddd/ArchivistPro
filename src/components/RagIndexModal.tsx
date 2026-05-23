import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    analyzeRagIndex,
    bulkIndexAssets,
    clearRagSkip,
    purgeNonIndexableChunks,
    bulkIndexMetadataAll,
    type RagIndexReport,
    type BulkIndexProgress,
    type BulkIndexHandle,
} from '../services/ragIndexStatus';
import { useStore } from '../store/useStore';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onDone?: () => void;
}

export default function RagIndexModal({ isOpen, onClose, onDone }: Props) {
    const [report, setReport] = useState<RagIndexReport | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [progress, setProgress] = useState<BulkIndexProgress | null>(null);
    const [handle, setHandle] = useState<BulkIndexHandle | null>(null);
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState('');
    const aiConfig = useStore((s) => s.aiConfig);

    const refresh = useCallback(() => {
        // V3 PRE-5f: analyzeRagIndex async (epoch>=1'de sayımlar vec.db'den).
        void analyzeRagIndex().then((r) => {
            setReport(r);
            setSelected(new Set(r.missingAssets.map((a) => a.assetId)));
        });
    }, []);

    useEffect(() => {
        if (isOpen) {
            refresh();
            setProgress(null);
        }
    }, [isOpen, refresh]);

    const filtered = useMemo(() => {
        if (!report) return [];
        const q = filter.trim().toLowerCase();
        if (!q) return report.missingAssets;
        return report.missingAssets.filter((a) =>
            a.fileName.toLowerCase().includes(q) || a.filePath.toLowerCase().includes(q)
        );
    }, [report, filter]);

    const toggleOne = (id: string) => {
        setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    };

    const selectAll = () => setSelected(new Set(filtered.map((a) => a.assetId)));
    const selectNone = () => setSelected(new Set());

    const setStoreProgress = useStore((s) => s.setAutoRagIndexProgress);
    const setStoreCancel = useStore((s) => s.setAutoRagIndexCancel);

    const runBulk = useCallback(async (assetIds: string[]) => {
        if (!report || assetIds.length === 0) return;
        const list = report.missingAssets
            .filter((a) => assetIds.includes(a.assetId))
            .map((a) => ({ assetId: a.assetId, filePath: a.filePath, fileName: a.fileName }));

        setBusy(true);
        const initial = { current: 0, total: list.length, currentFile: '', succeeded: 0, skipped: 0, failed: 0 };
        setProgress(initial);
        // Üst banner aynı progress'i göstersin — modal kapatılsa da görünür kalır
        setStoreProgress(initial);

        const { handle: h, donePromise } = await bulkIndexAssets(list, (p) => {
            setProgress({ ...p });
            setStoreProgress({
                current: p.current, total: p.total, currentFile: p.currentFile,
                succeeded: p.succeeded, skipped: p.skipped, failed: p.failed,
            });
        }, aiConfig);
        setHandle(h);
        setStoreCancel(() => h.cancel());
        try {
            await donePromise;
        } finally {
            setHandle(null);
            setBusy(false);
            setStoreCancel(null);
            setStoreProgress(null);
            refresh();
            onDone?.();
        }
    }, [report, refresh, onDone, aiConfig, setStoreProgress, setStoreCancel]);

    const handleBulkMetadata = useCallback(async () => {
        if (!confirm('Tüm aktif dosyalar için metadata chunk üretilecek (DWG/MAX dahil). Bu, AI sohbetin dosya adı, proje, etiket ve katman aramalarını yapabilmesi için gereklidir. Devam edilsin mi?')) return;
        // İlk render'da panel boş gözükmesin diye başlangıç state
        setProgress({ current: 0, total: 0, currentFile: 'Hazırlanıyor…', succeeded: 0, skipped: 0, failed: 0 });
        setBusy(true);
        let succeeded = 0;
        let skipped = 0;
        try {
            const r = await bulkIndexMetadataAll((cur, total, fname) => {
                // İşlem sırasındayken kaç dosyada başarı/atlama olduğunu yaklaşık tahmin et
                // (fonksiyon kendi içinde tutuyor; biz currentFile ile geçen dosyayı vurguluyoruz)
                if (cur > succeeded + skipped) {
                    // Yeni dosyaya geçildi — önceki başarılı say
                    succeeded = Math.max(0, cur - 1 - skipped);
                }
                setProgress({
                    current: cur,
                    total,
                    currentFile: fname,
                    succeeded,
                    skipped,
                    failed: 0,
                });
                // React'ın render etmesine fırsat ver — uzun listede UI donmasın
                if (cur % 10 === 0) {
                    return new Promise<void>((res) => setTimeout(res, 0));
                }
            });
            succeeded = r.done;
            skipped = r.skipped;
            alert(`Metadata indeksleme tamam: ${r.done} dosya işlendi, ${r.skipped} atlandı.`);
            refresh();
            onDone?.();
        } finally {
            setBusy(false);
            setProgress(null);
        }
    }, [refresh, onDone]);

    const handlePurge = useCallback(async () => {
        const r = await purgeNonIndexableChunks();
        if (r.assets > 0) {
            alert(`${r.assets} dosyadan ${r.chunks} chunk ve ${r.embeddings} embedding silindi.`);
            refresh();
            onDone?.();
        } else {
            alert('Temizlenecek çöp chunk bulunamadı.');
        }
    }, [refresh, onDone]);

    if (!isOpen) return null;

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <header style={styles.header}>
                    <div>
                        <strong style={{ fontSize: 16 }}>AI İndex Durumu</strong>
                        {report && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                Toplam <b>{report.total}</b> · <b style={{ color: '#48bb78' }}>{report.indexed}</b> hazır · <b style={{ color: '#f6ad55' }}>{report.missing}</b> eksik
                                {report.skipped > 0 && (
                                    <> · <b style={{ color: '#fc8181' }}>{report.skipped}</b> indexlenemez</>
                                )}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {!busy && (
                            <>
                                <button
                                    style={{ ...styles.closeBtn, background: '#22543d', color: '#9ae6b4' }}
                                    onClick={handleBulkMetadata}
                                    title="Tüm dosyalar için metadata chunk (filename + proje + etiket + DWG katmanları) üretir. AI sohbetin sidebar'la aynı geniş kapsamı görmesini sağlar."
                                >Tüm metadata'ları üret</button>
                                <button
                                    style={{ ...styles.closeBtn, background: '#742a2a', color: '#feb2b2' }}
                                    onClick={handlePurge}
                                    title="Yalnızca RAG sohbet için anlamlı metin üretmeyen dosyaların (örn. .bak yedek dosyaları) eski chunk/embedding kayıtlarını siler. Dosyaların kendisine dokunmaz — DWG, PDF, Office vb. dosyalarınız ve bunların metadata/önizlemeleri güvende kalır."
                                >Çöp temizle</button>
                            </>
                        )}
                        <button style={styles.closeBtn} onClick={onClose}>
                            {busy ? 'Arka planda çalıştır' : 'Kapat'}
                        </button>
                    </div>
                </header>

                {busy && progress ? (
                    <div style={styles.body}>
                        <div style={{ marginBottom: 12 }}>
                            <b>İndexleniyor:</b> {progress.current} / {progress.total}
                        </div>
                        <div style={styles.progressBar}>
                            <div style={{
                                ...styles.progressFill,
                                width: `${(progress.current / Math.max(1, progress.total)) * 100}%`,
                            }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                            {progress.currentFile}
                        </div>
                        <div style={{ marginTop: 16, fontSize: 13 }}>
                            ✅ Tamamlandı: {progress.succeeded} &nbsp;
                            ⏭️ Atlandı: {progress.skipped} &nbsp;
                            ❌ Hata: {progress.failed}
                        </div>
                        <button
                            style={{ ...styles.btn, ...styles.btnSecondary, marginTop: 20 }}
                            onClick={() => handle?.cancel()}
                            disabled={!handle}
                        >İptal Et</button>
                    </div>
                ) : report && report.missing === 0 ? (
                    <>
                        <div style={{ ...styles.body, textAlign: 'center', padding: 30 }}>
                            <div style={{ fontSize: 42, marginBottom: 10 }}>✅</div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>Her şey hazır!</div>
                            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
                                {report.indexed} dosya AI sohbet için indexli.
                            </div>
                        </div>
                        {report.skipped > 0 && <SkippedSection report={report} onRetry={refresh} />}
                    </>
                ) : report ? (
                    <>
                        <div style={styles.toolbar}>
                            <input
                                type="text"
                                placeholder="Dosya adı veya yol ile ara…"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                style={styles.search}
                            />
                            <button style={styles.linkBtn} onClick={selectAll}>Tümünü seç</button>
                            <button style={styles.linkBtn} onClick={selectNone}>Hiçbiri</button>
                        </div>

                        <div style={styles.list}>
                            {filtered.length === 0 && (
                                <div style={{ padding: 20, textAlign: 'center', opacity: 0.6 }}>
                                    Sonuç yok.
                                </div>
                            )}
                            {filtered.map((a) => (
                                <label key={a.assetId} style={styles.row}>
                                    <input
                                        type="checkbox"
                                        checked={selected.has(a.assetId)}
                                        onChange={() => toggleOne(a.assetId)}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={styles.fileName}>{a.fileName}</div>
                                        <div style={styles.filePath}>{a.filePath}</div>
                                    </div>
                                    <span style={styles.typeBadge}>{a.fileType}</span>
                                    {a.chunkCount > 0 && (
                                        <span style={styles.chunkBadge} title="Chunk var ama embedding eksik">
                                            {a.chunkCount} chunk
                                        </span>
                                    )}
                                </label>
                            ))}
                        </div>

                        <footer style={styles.footer}>
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                                <b>{selected.size}</b> dosya seçildi ({filtered.length} görünür / {report.missing} eksik)
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    style={{ ...styles.btn, ...styles.btnSecondary }}
                                    onClick={() => runBulk(Array.from(selected))}
                                    disabled={selected.size === 0}
                                >Seçilileri İndexle ({selected.size})</button>
                                <button
                                    style={{ ...styles.btn, ...styles.btnPrimary }}
                                    onClick={() => runBulk(report.missingAssets.map((a) => a.assetId))}
                                    disabled={report.missing === 0}
                                >Tümünü İndexle ({report.missing})</button>
                            </div>
                        </footer>
                        {report.skipped > 0 && <SkippedSection report={report} onRetry={refresh} />}
                    </>
                ) : (
                    <div style={{ padding: 40, textAlign: 'center' }}>Analiz ediliyor…</div>
                )}
            </div>
        </div>
    );
}

function SkippedSection({ report, onRetry }: { report: RagIndexReport; onRetry: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const handleRetry = (assetId: string) => {
        clearRagSkip(assetId);
        onRetry();
    };
    const handleRetryAll = () => {
        report.skippedAssets.forEach((a) => clearRagSkip(a.assetId));
        onRetry();
    };
    const reasonLabel = (r: string | null) => {
        if (!r) return 'bilinmiyor';
        if (r.startsWith('extract_failed')) return 'metin çıkarılamadı (bozuk/yanlış uzantı)';
        if (r === 'empty_or_too_short') return 'metin boş veya çok kısa';
        if (r === 'file_too_large') return 'dosya çok büyük';
        if (r === 'no_chunks') return 'parça üretilemedi';
        return r;
    };
    return (
        <div style={{ borderTop: '1px solid #2d3748', background: '#2a1a1a', padding: 10 }}>
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpanded(!expanded)}
            >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fc8181' }}>
                    {expanded ? '▼' : '▶'} {report.skipped} dosya indexlenemez olarak işaretli
                </div>
                {expanded && (
                    <button
                        style={{
                            background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568',
                            padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}
                        onClick={(e) => { e.stopPropagation(); handleRetryAll(); }}
                    >Hepsini tekrar dene</button>
                )}
            </div>
            {expanded && (
                <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto' }}>
                    {report.skippedAssets.map((a) => (
                        <div key={a.assetId} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: 6,
                            borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12,
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {a.fileName}
                                </div>
                                <div style={{ fontSize: 10, opacity: 0.6 }}>
                                    {reasonLabel(a.skipReason)}
                                </div>
                            </div>
                            <button
                                style={{
                                    background: 'transparent', color: '#9ae6b4',
                                    border: '1px solid #22543d', padding: '2px 8px',
                                    borderRadius: 4, cursor: 'pointer', fontSize: 10,
                                }}
                                onClick={() => handleRetry(a.assetId)}
                                title="Bu dosyayı yeniden denemeye almak için işareti kaldır"
                            >Tekrar dene</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
        width: 'min(800px, 95vw)', maxHeight: '85vh',
        background: '#1a202c', color: '#e2e8f0',
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    },
    header: {
        padding: 16, borderBottom: '1px solid #2d3748',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    },
    closeBtn: {
        background: 'transparent', color: '#a0aec0',
        border: '1px solid #4a5568', padding: '4px 12px',
        borderRadius: 6, cursor: 'pointer',
    },
    body: { padding: 20 },
    toolbar: {
        padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center',
        borderBottom: '1px solid #2d3748',
    },
    search: {
        flex: 1, padding: '6px 10px', background: '#2d3748',
        color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 6,
        fontSize: 13,
    },
    linkBtn: {
        background: 'transparent', color: '#6366f1',
        border: 'none', cursor: 'pointer', fontSize: 12, padding: '4px 8px',
    },
    list: { flex: 1, overflowY: 'auto', padding: 6 },
    row: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 8, borderRadius: 6, cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
    },
    fileName: {
        fontSize: 13, fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    },
    filePath: {
        fontSize: 11, opacity: 0.5,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    },
    typeBadge: {
        fontSize: 10, padding: '2px 6px', background: '#2d3748',
        borderRadius: 3, opacity: 0.8,
    },
    chunkBadge: {
        fontSize: 10, padding: '2px 6px', background: '#744210',
        borderRadius: 3, color: '#fbd38d',
    },
    footer: {
        padding: 14, borderTop: '1px solid #2d3748',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    },
    btn: {
        padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
        border: 'none', fontWeight: 600, fontSize: 13,
    },
    btnPrimary: { background: '#6366f1', color: 'white' },
    btnSecondary: { background: '#2d3748', color: '#e2e8f0' },
    progressBar: {
        width: '100%', height: 10, background: '#2d3748',
        borderRadius: 5, overflow: 'hidden',
    },
    progressFill: {
        height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7)',
        transition: 'width 0.2s',
    },
};

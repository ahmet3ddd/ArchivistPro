/**
 * AISetupWizard — Tek adimlik AI kurulum sihirbazi.
 *
 * Mimari ofis calisani icin: model adlari gizli, "Metin modeli: Hazir"
 * seklinde basit gosterim. Eksik modelleri otomatik indirme teklifi.
 *
 * Acilma kosullari:
 *   1. Ilk acilista (SetupWizard Step 2 yerine)
 *   2. AISettingsModal'dan "Kurulum Sihirbazi" butonu ile
 *   3. ChatPanel'den Ollama kapali uyarisi ile
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useOllamaStatus } from '../hooks/useOllamaStatus';
import {
    pullModel, setOllamaCors, checkOllamaCors, startOllama, stopOllama,
    DEFAULT_CHAT_MODEL, DEFAULT_VISION_MODEL,
} from '../services/ollamaService';
import { useStore } from '../store/useStore';
import ModalErrorBoundary from './ModalErrorBoundary';
import {
    X, CheckCircle, XCircle, Loader, Download, Power,
    ArrowRight, ArrowLeft, Sparkles, MonitorCheck,
} from 'lucide-react';

// ─── Props ─────────────────────────────────────────────────────

interface AISetupWizardProps {
    isOpen: boolean;
    onClose: () => void;
    /** true ise son adimda "Kapat" yerine onFinish callback cagrilir */
    onFinish?: () => void;
}

// ─── Types ─────────────────────────────────────────────────────

type PullStatus = 'idle' | 'pulling' | 'done' | 'error';

interface ModelPullState {
    chat: PullStatus;
    chatMsg: string;
    vision: PullStatus;
    visionMsg: string;
}

// ─── Component ─────────────────────────────────────────────────

export default function AISetupWizard({ isOpen, onClose, onFinish }: AISetupWizardProps) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const aiConfig = useStore((s) => s.aiConfig);
    const setAiConfig = useStore((s) => s.setAiConfig);

    const [step, setStep] = useState(0); // 0: Ollama, 1: Modeller, 2: Tamamlandi
    const [ollamaToggle, setOllamaToggle] = useState<'idle' | 'starting' | 'stopping'>('idle');
    const [corsStatus, setCorsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [pull, setPull] = useState<ModelPullState>({
        chat: 'idle', chatMsg: '', vision: 'idle', visionMsg: '',
    });

    const { status, recheck, isChecking } = useOllamaStatus({
        enabled: isOpen,
        pollInterval: 10_000, // wizard acikken daha sik kontrol
    });

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setStep(0);
            setOllamaToggle('idle');
            setCorsStatus('idle');
            setPull({ chat: 'idle', chatMsg: '', vision: 'idle', visionMsg: '' });
            checkOllamaCors().then((ok) => { if (ok) setCorsStatus('ok'); }).catch(() => {});
        }
    }, [isOpen]);

    // Ollama calisiyorsa otomatik Step 1'e gec
    useEffect(() => {
        if (step === 0 && status.running === true) {
            setStep(1);
        }
    }, [step, status.running]);

    // Her iki model de hazirsa otomatik Step 2'ye gec
    useEffect(() => {
        if (step === 1 && status.chatReady && status.visionReady) {
            setStep(2);
        }
    }, [step, status.chatReady, status.visionReady]);

    const handleToggleOllama = useCallback(async () => {
        if (status.running) {
            setOllamaToggle('stopping');
            try { await stopOllama(); } catch { /* ignore */ }
            setTimeout(recheck, 1000);
            setOllamaToggle('idle');
        } else {
            setOllamaToggle('starting');
            try { await startOllama(); } catch { /* ignore */ }
            setTimeout(recheck, 2000);
            setOllamaToggle('idle');
        }
    }, [status.running, recheck]);

    const handleSetCors = useCallback(async () => {
        setCorsStatus('loading');
        try {
            await setOllamaCors();
            setCorsStatus('ok');
        } catch {
            setCorsStatus('error');
        }
    }, []);

    const handlePullChat = useCallback(async () => {
        setPull(p => ({ ...p, chat: 'pulling', chatMsg: t('aiSetup.pulling') }));
        try {
            await pullModel(DEFAULT_CHAT_MODEL);
            setPull(p => ({ ...p, chat: 'done', chatMsg: '' }));
            recheck();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setPull(p => ({ ...p, chat: 'error', chatMsg: msg.substring(0, 100) }));
        }
    }, [recheck, t]);

    const handlePullVision = useCallback(async () => {
        setPull(p => ({ ...p, vision: 'pulling', visionMsg: t('aiSetup.pulling') }));
        try {
            await pullModel(DEFAULT_VISION_MODEL);
            setPull(p => ({ ...p, vision: 'done', visionMsg: '' }));
            recheck();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setPull(p => ({ ...p, vision: 'error', visionMsg: msg.substring(0, 100) }));
        }
    }, [recheck, t]);

    const handlePullAll = useCallback(async () => {
        if (!status.chatReady) handlePullChat();
        if (!status.visionReady) handlePullVision();
    }, [status.chatReady, status.visionReady, handlePullChat, handlePullVision]);

    const handleFinish = useCallback(() => {
        // Store'a Ollama + varsayilan modeller yaz
        setAiConfig(prev => ({
            ...prev,
            mode: 'local' as const,
            apiProvider: 'ollama' as const,
            chatModel: DEFAULT_CHAT_MODEL,
            visionModel: DEFAULT_VISION_MODEL,
        }));
        if (onFinish) onFinish();
        else onClose();
    }, [setAiConfig, onFinish, onClose]);

    if (!isOpen) return null;

    // ─── Step renderers ──────────────────────────────────────────

    const renderStep0_Ollama = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                {t('aiSetup.step0.desc')}
            </p>

            {/* Ollama durum karti */}
            <div style={{
                padding: '16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusDot ok={status.running} loading={isChecking || ollamaToggle !== 'idle'} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                        {t('aiSetup.step0.ollamaLabel')}
                    </span>
                    <span style={{
                        flex: 1, textAlign: 'right', fontSize: '0.8rem', fontWeight: 600,
                        color: status.running ? 'var(--color-success)' : 'var(--color-error)',
                    }}>
                        {isChecking ? '...' :
                         ollamaToggle === 'starting' ? t('aiSetup.starting') :
                         ollamaToggle === 'stopping' ? t('aiSetup.stopping') :
                         status.running ? (status.version ? `v${status.version}` : t('aiSetup.ready')) :
                         status.running === false ? t('aiSetup.notInstalled') : '...'}
                    </span>
                </div>

                {/* Ollama kapali — cift eylem */}
                {status.running === false && ollamaToggle === 'idle' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Baslat butonu */}
                        <button onClick={handleToggleOllama} style={greenBtnStyle}>
                            <Power size={14} />
                            {t('aiSetup.step0.startBtn')}
                        </button>

                        {/* Kurulum rehberi */}
                        <div style={{
                            padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                            background: 'rgba(239,68,68,0.06)',
                            fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5,
                        }}>
                            {t('aiSetup.step0.installGuide')}
                        </div>
                    </div>
                )}

                {/* Ollama calisiyor — CORS butonu */}
                {status.running && corsStatus !== 'ok' && (
                    <button onClick={handleSetCors} disabled={corsStatus === 'loading'} style={secondaryBtnStyle}>
                        {corsStatus === 'loading' ? <Loader size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                        {t('aiSetup.step0.corsBtn')}
                    </button>
                )}

                {/* Baslat/durdur toggle (calisiyorken) */}
                {status.running && ollamaToggle === 'idle' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={handleToggleOllama} style={{ ...smallBtnStyle, color: 'var(--color-error)' }}>
                            <Power size={10} /> {t('aiSetup.stop')}
                        </button>
                    </div>
                )}
            </div>

            {/* Ileri butonu — sadece Ollama calisiyorsa */}
            {status.running && (
                <button onClick={() => setStep(1)} style={primaryBtnStyle}>
                    {t('aiSetup.next')} <ArrowRight size={14} />
                </button>
            )}
        </div>
    );

    const renderStep1_Models = () => {
        const wantChat = aiConfig.chatModel || DEFAULT_CHAT_MODEL;
        const wantVision = aiConfig.visionModel || DEFAULT_VISION_MODEL;

        const bothReady = status.chatReady && status.visionReady;
        const anyPulling = pull.chat === 'pulling' || pull.vision === 'pulling';

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                    {t('aiSetup.step1.desc')}
                </p>

                {/* Model durum kartlari */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Chat model */}
                    <ModelRow
                        label={t('aiSetup.step1.chatLabel')}
                        modelName={wantChat}
                        ready={status.chatReady}
                        pullStatus={pull.chat}
                        pullMsg={pull.chatMsg}
                        onPull={handlePullChat}
                        t={t}
                    />
                    {!status.chatReady && status.chatModels.length > 0 && (
                        <div style={{ marginTop: -4, marginLeft: 16, fontSize: '0.7rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                            {t('aiSetup.step1.altHint', {
                                models: status.chatModels.slice(0, 3).join(', '),
                            })}
                        </div>
                    )}

                    {/* Vision model */}
                    <ModelRow
                        label={t('aiSetup.step1.visionLabel')}
                        modelName={wantVision}
                        ready={status.visionReady}
                        pullStatus={pull.vision}
                        pullMsg={pull.visionMsg}
                        onPull={handlePullVision}
                        t={t}
                    />
                </div>

                {/* Durum mesaji */}
                {bothReady && (
                    <div style={{
                        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                        background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                        fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <CheckCircle size={16} /> {t('aiSetup.step1.allReady')}
                    </div>
                )}

                {/* Butonlar */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setStep(0)} style={secondaryBtnStyle}>
                        <ArrowLeft size={14} /> {t('aiSetup.back')}
                    </button>
                    <div style={{ flex: 1 }} />
                    {!bothReady && !anyPulling && (
                        <button onClick={handlePullAll} style={primaryBtnStyle}>
                            <Download size={14} /> {t('aiSetup.step1.downloadAll')}
                        </button>
                    )}
                    {bothReady && (
                        <button onClick={() => setStep(2)} style={primaryBtnStyle}>
                            {t('aiSetup.next')} <ArrowRight size={14} />
                        </button>
                    )}
                </div>

                {/* Detay bilgisi */}
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    {t('aiSetup.step1.hint', {
                        chatModel: DEFAULT_CHAT_MODEL,
                        visionModel: DEFAULT_VISION_MODEL,
                    })}
                </div>
            </div>
        );
    };

    const renderStep2_Done = () => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0' }}>
            <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(34,197,94,0.12)', border: '2px solid rgba(34,197,94,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <Sparkles size={28} style={{ color: 'var(--color-success)' }} />
            </div>

            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, textAlign: 'center' }}>
                {t('aiSetup.step2.title')}
            </h3>

            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
                {t('aiSetup.step2.desc')}
            </p>

            {/* Ozet */}
            <div style={{
                width: '100%', padding: '14px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
                display: 'flex', flexDirection: 'column', gap: 8,
            }}>
                <SummaryRow label={t('aiSetup.step0.ollamaLabel')} ok={!!status.running} />
                <SummaryRow label={t('aiSetup.step1.chatLabel')} ok={status.chatReady} />
                <SummaryRow label={t('aiSetup.step1.visionLabel')} ok={status.visionReady} />
                <SummaryRow label="CLIP" ok subtitle={t('aiSetup.step2.clipBuiltin')} />
                <SummaryRow label={t('aiSetup.step2.embedding')} ok subtitle={t('aiSetup.step2.embeddingBuiltin')} />
            </div>

            <button onClick={handleFinish} style={{ ...primaryBtnStyle, width: '100%', justifyContent: 'center' }}>
                <MonitorCheck size={16} /> {t('aiSetup.step2.finishBtn')}
            </button>
        </div>
    );

    const STEPS = [renderStep0_Ollama, renderStep1_Models, renderStep2_Done];

    return (
        <ModalErrorBoundary onClose={onClose}>
            <div className="modal-overlay">
                <div ref={focusTrapRef} className="modal-content" role="dialog" aria-modal="true"
                     style={{ maxWidth: 'min(90vw, 480px)', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>

                    {/* Header */}
                    <div style={{
                        padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Sparkles size={18} style={{ color: 'var(--color-accent)' }} />
                            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                                {t('aiSetup.title')}
                            </h2>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {/* Step indicator */}
                            <div style={{ display: 'flex', gap: 4 }}>
                                {[0, 1, 2].map(i => (
                                    <div key={i} style={{
                                        width: i === step ? 20 : 8, height: 8,
                                        borderRadius: 4,
                                        background: i === step ? 'var(--color-accent)' : i < step ? 'var(--color-success)' : 'var(--color-border)',
                                        transition: 'all 0.2s',
                                    }} />
                                ))}
                            </div>
                            <button className="btn btn-icon" aria-label={t('common.aria.close')} onClick={onClose}>
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '20px', overflowY: 'auto' }}>
                        {STEPS[step]()}
                    </div>
                </div>
            </div>
        </ModalErrorBoundary>
    );
}

// ─── Sub-components ────────────────────────────────────────────

function StatusDot({ ok, loading }: { ok: boolean | null; loading?: boolean }) {
    return (
        <div style={{
            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: loading ? 'var(--color-text-muted)' :
                ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#6b7280',
            ...(loading ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
        }} />
    );
}

function ModelRow({ label, modelName, ready, pullStatus, pullMsg, onPull, t }: {
    label: string; modelName?: string; ready: boolean; pullStatus: PullStatus; pullMsg: string;
    onPull: () => void; t: (k: string) => string;
}) {
    return (
        <div style={{
            padding: '12px 14px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
            display: 'flex', alignItems: 'center', gap: 10,
        }}>
            <StatusDot ok={ready} loading={pullStatus === 'pulling'} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{label}</span>
                {modelName && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 1 }}>
                        {modelName}
                    </div>
                )}
            </div>

            {ready && (
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={14} /> {t('aiSetup.ready')}
                </span>
            )}

            {!ready && pullStatus === 'idle' && (
                <button onClick={onPull} style={smallDownloadBtnStyle}>
                    <Download size={12} /> {t('aiSetup.download')}
                </button>
            )}

            {pullStatus === 'pulling' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Loader size={12} className="animate-spin" /> {t('aiSetup.pulling')}
                </span>
            )}

            {pullStatus === 'error' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <XCircle size={12} style={{ color: 'var(--color-error)' }} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-error)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pullMsg}
                    </span>
                    <button onClick={onPull} style={{ ...smallDownloadBtnStyle, padding: '2px 6px' }}>
                        {t('aiSetup.retry')}
                    </button>
                </div>
            )}

            {pullStatus === 'done' && !ready && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={12} /> {t('aiSetup.downloaded')}
                </span>
            )}
        </div>
    );
}

function SummaryRow({ label, ok, subtitle }: { label: string; ok: boolean; subtitle?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot ok={ok} />
            <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: ok ? 'var(--color-success)' : 'var(--color-error)' }}>
                {subtitle || (ok ? '✓' : '✗')}
            </span>
        </div>
    );
}

// ─── Style sabitleri ───────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
    padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    background: 'var(--color-accent)', color: '#fff', border: 'none',
    fontWeight: 700, fontSize: '0.85rem',
    display: 'flex', alignItems: 'center', gap: 8,
};

const secondaryBtnStyle: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)',
    border: '1px solid rgba(99,102,241,0.25)',
    fontWeight: 600, fontSize: '0.8rem',
    display: 'flex', alignItems: 'center', gap: 6,
};

const greenBtnStyle: React.CSSProperties = {
    padding: '10px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    background: 'rgba(34,197,94,0.12)', color: 'var(--color-success)',
    border: '1px solid rgba(34,197,94,0.3)',
    fontWeight: 700, fontSize: '0.85rem',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};

const smallBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 'var(--radius-sm)',
};

const smallDownloadBtnStyle: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    background: 'rgba(99,102,241,0.1)', color: 'var(--color-accent)',
    border: '1px solid rgba(99,102,241,0.25)',
    fontWeight: 600, fontSize: '0.72rem',
    display: 'flex', alignItems: 'center', gap: 4,
};

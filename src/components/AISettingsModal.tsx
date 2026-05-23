import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useOllamaStatus } from '../hooks/useOllamaStatus';
import { X, Brain, CheckCircle, XCircle, Loader, Download, ChevronDown, ChevronRight, RefreshCw, Sparkles, Play } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
    pullModel,
    setOllamaCors,
    checkOllamaCors,
    startOllama,
    isOllamaVersionOld,
    isVisionModel,
    DEFAULT_CHAT_MODEL,
    DEFAULT_VISION_MODEL,
} from '../services/ollamaService';
import ModalErrorBoundary from './ModalErrorBoundary';
import { TIMINGS } from '../config/constants';

export type APIProvider = 'ollama' | 'gemini' | 'openai' | 'groq';

export interface AIConfig {
    mode?: 'local' | 'cloud';
    apiProvider: APIProvider;
    apiKey: string;
    apiUrl: string;
    /** Chat/RAG modeli — varsayilan: ollamaService.DEFAULT_CHAT_MODEL */
    chatModel?: string;
    /** Gorsel analiz modeli — varsayilan: ollamaService.DEFAULT_VISION_MODEL */
    visionModel?: string;
    /** @deprecated chatModel + visionModel kullanin */
    ollamaModel?: string;
    enableClipVision?: boolean;
}

interface AISettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: AIConfig;
    onSave: (config: AIConfig) => void;
}

type ActionStatus = 'idle' | 'loading' | 'ok' | 'error';

const PROVIDERS: { value: APIProvider; label: string; local: boolean }[] = [
    { value: 'ollama', label: 'Ollama', local: true },
    { value: 'gemini', label: 'Google Gemini', local: false },
    { value: 'openai', label: 'OpenAI (ChatGPT)', local: false },
    { value: 'groq', label: 'Groq', local: false },
];

export default function AISettingsModal({ isOpen, onClose, config, onSave }: AISettingsModalProps) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const [localConfig, setLocalConfig] = useState<AIConfig>(config);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // Ollama status — hook ile otomatik kontrol
    const { status: ollamaStatus, recheck, isChecking } = useOllamaStatus({ enabled: isOpen && localConfig.apiProvider === 'ollama' });

    // Pull/CORS durumlari
    const [chatPull, setChatPull] = useState<ActionStatus>('idle');
    const [chatPullMsg, setChatPullMsg] = useState('');
    const [visionPull, setVisionPull] = useState<ActionStatus>('idle');
    const [visionPullMsg, setVisionPullMsg] = useState('');
    const [corsStatus, setCorsStatus] = useState<ActionStatus>('idle');
    const [corsMsg, setCorsMsg] = useState('');
    const [ollamaStarting, setOllamaStarting] = useState(false);

    // Cloud test
    const [cloudTest, setCloudTest] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
    const [cloudTestMsg, setCloudTestMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            setLocalConfig(config);
            setAdvancedOpen(false);
            setChatPull('idle'); setChatPullMsg('');
            setVisionPull('idle'); setVisionPullMsg('');
            setCorsStatus('idle'); setCorsMsg('');
            setCloudTest('idle'); setCloudTestMsg('');
            checkOllamaCors().then((ok) => { if (ok) setCorsStatus('ok'); }).catch(() => {});
        }
    }, [isOpen, config]);

    // Auto-select vision model from discovered models
    useEffect(() => {
        if (!isOpen) return;
        if (ollamaStatus.running && ollamaStatus.visionModels.length > 0 && localConfig.apiProvider === 'ollama') {
            const current = localConfig.visionModel || localConfig.ollamaModel || '';
            const alreadyAvailable = ollamaStatus.visionModels.some(m => m.startsWith(current.split(':')[0]));
            if (!alreadyAvailable) {
                const best = ollamaStatus.visionModels.find(m => m.startsWith('llava'))
                    || ollamaStatus.visionModels.find(m => m.startsWith('llama3.2'))
                    || ollamaStatus.visionModels.find(m => m.startsWith('moondream'))
                    || ollamaStatus.visionModels[0];
                setLocalConfig(prev => ({ ...prev, visionModel: best.split(':')[0] }));
            }
        }
    }, [isOpen, ollamaStatus.running, ollamaStatus.visionModels, localConfig.apiProvider, localConfig.visionModel, localConfig.ollamaModel]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(localConfig);
        onClose();
    };

    const handlePullChat = async () => {
        const model = localConfig.chatModel || DEFAULT_CHAT_MODEL;
        setChatPull('loading');
        setChatPullMsg(t('aiSettings.status.pulling'));
        try {
            await pullModel(model);
            setChatPull('ok');
            setChatPullMsg(t('aiSettings.status.ready'));
            recheck();
        } catch (err: unknown) {
            setChatPull('error');
            const msg = err instanceof Error ? err.message : String(err);
            setChatPullMsg(msg.substring(0, 120));
        }
    };

    const handlePullVision = async () => {
        const model = localConfig.visionModel || DEFAULT_VISION_MODEL;
        setVisionPull('loading');
        setVisionPullMsg(t('aiSettings.status.pulling'));
        try {
            await pullModel(model);
            setVisionPull('ok');
            setVisionPullMsg(t('aiSettings.status.ready'));
            recheck();
        } catch (err: unknown) {
            setVisionPull('error');
            const msg = err instanceof Error ? err.message : String(err);
            setVisionPullMsg(msg.substring(0, 120));
        }
    };

    const handleStartOllama = async () => {
        setOllamaStarting(true);
        try {
            await startOllama();
            setTimeout(recheck, 2000);
        } catch { /* ignore */ }
        finally { setOllamaStarting(false); }
    };

    const handleSetCors = async () => {
        setCorsStatus('loading');
        setCorsMsg('');
        try {
            await setOllamaCors();
            setCorsStatus('ok');
            setCorsMsg(t('aiSettings.setCorsSuccess'));
        } catch (err: unknown) {
            setCorsStatus('error');
            const msg = err instanceof Error ? err.message : String(err);
            setCorsMsg(`${t('aiSettings.setCorsError')}: ${msg.substring(0, 120)}`);
        }
    };

    const testCloudConnection = async () => {
        setCloudTest('testing');
        setCloudTestMsg('');
        try {
            if (!localConfig.apiKey || localConfig.apiKey.trim() === '') {
                setCloudTest('error');
                setCloudTestMsg(t('aiSettings.error.noApiKey'));
                return;
            }

            let url = '';
            let headers: Record<string, string> = { 'Content-Type': 'application/json' };
            let body = {};

            if (localConfig.apiProvider === 'gemini') {
                url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${localConfig.apiKey}`;
                body = { contents: [{ parts: [{ text: 'ping' }] }] };
            } else if (localConfig.apiProvider === 'openai') {
                url = 'https://api.openai.com/v1/chat/completions';
                headers['Authorization'] = `Bearer ${localConfig.apiKey}`;
                body = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 };
            } else if (localConfig.apiProvider === 'groq') {
                url = 'https://api.groq.com/openai/v1/chat/completions';
                headers['Authorization'] = `Bearer ${localConfig.apiKey}`;
                body = { model: 'llama-3.2-11b-vision-preview', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMINGS.AI_REQUEST_TIMEOUT_MS);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            }

            setCloudTest('ok');
        } catch (err: unknown) {
            setCloudTest('error');
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('abort') || msg.includes('AbortError')) {
                setCloudTestMsg(t('aiSettings.error.timeout'));
            } else if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
                setCloudTestMsg(t('aiSettings.error.invalidApiKey'));
            } else {
                setCloudTestMsg(`${t('common.error.prefix')}: ${msg}`);
            }
        }
    };

    const statusDot = (ok: boolean | null, loading?: boolean) => (
        <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: loading ? 'var(--color-text-muted)' : ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#6b7280',
            ...(loading ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
        }} />
    );

    const actionBtn = (status: ActionStatus, handler: () => void, label: string, msg: string) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
                onClick={handler}
                disabled={status === 'loading'}
                style={{
                    background: status === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.1)',
                    border: `1px solid ${status === 'ok' ? 'rgba(34,197,94,0.3)' : status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.25)'}`,
                    borderRadius: 'var(--radius-sm)', cursor: status === 'loading' ? 'wait' : 'pointer',
                    padding: '3px 10px', fontSize: '0.7rem', fontWeight: 600,
                    color: status === 'ok' ? 'var(--color-success)' : status === 'error' ? 'var(--color-error)' : 'var(--color-accent)',
                    display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                }}
            >
                {status === 'loading' ? <Loader size={10} className="animate-spin" /> :
                 status === 'ok' ? <CheckCircle size={10} /> :
                 status === 'error' ? <XCircle size={10} /> :
                 <Download size={10} />}
                {label}
            </button>
            {msg && (
                <div style={{
                    fontSize: '0.65rem', lineHeight: 1.3, maxWidth: 180,
                    color: status === 'ok' ? 'var(--color-success)' : status === 'error' ? 'var(--color-error)' : 'var(--color-text-muted)',
                }}>
                    {msg}
                </div>
            )}
        </div>
    );

    return (
        <ModalErrorBoundary onClose={onClose}>
        <div className="modal-overlay">
            <div ref={focusTrapRef} className="modal-content" role="dialog" aria-modal="true" style={{ maxWidth: 'min(90vw, 500px)', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Brain size={20} style={{ color: 'var(--color-accent)' }} />
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t('modals.aiSettings')}</h2>
                    </div>
                    <button className="btn btn-icon" aria-label={t('common.aria.close')} onClick={onClose}><X size={18} /></button>
                </div>

                <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(90vh - 130px)' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('aiSettings.description')}
                    </p>

                    {/* Provider selector — kompakt yatay */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>{t('aiSettings.label.provider')}</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {PROVIDERS.map(p => {
                                const active = localConfig.apiProvider === p.value;
                                return (
                                    <button
                                        key={p.value}
                                        onClick={() => { setCloudTest('idle'); setLocalConfig({ ...localConfig, apiProvider: p.value }); }}
                                        style={{
                                            padding: '7px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                            border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                            background: active ? 'var(--color-accent-subtle)' : 'transparent',
                                            fontWeight: active ? 600 : 400, fontSize: '0.82rem',
                                            color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                            display: 'flex', alignItems: 'center', gap: 6,
                                        }}
                                    >
                                        {p.label}
                                        {p.local && active && (
                                            <span style={{ fontSize: '0.62rem', background: 'rgba(34,197,94,0.12)', color: 'var(--color-success)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 999, padding: '1px 6px' }}>
                                                {t('aiSettings.badge.local')}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Ollama Section ── */}
                    {localConfig.apiProvider === 'ollama' && (
                        <>
                            {/* Kurulum Sihirbazi butonu */}
                            <button
                                onClick={() => { onClose(); useStore.getState().setIsAISetupOpen(true); }}
                                style={{
                                    width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                    color: 'var(--color-accent)', fontWeight: 600, fontSize: '0.82rem',
                                }}
                            >
                                <Sparkles size={14} />
                                {t('aiSettings.openSetupWizard')}
                            </button>

                            {/* AI Durum Karti */}
                            <div style={{
                                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                                overflow: 'hidden', flexShrink: 0,
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    background: 'var(--color-bg-secondary)',
                                    borderBottom: '1px solid var(--color-border)',
                                }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                                        {t('aiSettings.status.title')}
                                    </span>
                                    <button
                                        onClick={recheck}
                                        disabled={isChecking}
                                        style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            color: 'var(--color-text-muted)', padding: 4,
                                            display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem',
                                            opacity: isChecking ? 0.5 : 1,
                                        }}
                                    >
                                        <RefreshCw size={12} className={isChecking ? 'animate-spin' : ''} />
                                        {t('aiSettings.status.refresh')}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    {/* Ollama Server */}
                                    <div style={rowStyle}>
                                        {statusDot(ollamaStatus.running, isChecking)}
                                        <span style={rowLabelStyle}>{t('aiSettings.status.ollamaServer')}</span>
                                        <span style={{ ...rowValueStyle, color: ollamaStatus.running ? 'var(--color-success)' : ollamaStatus.running === false ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                                            {isChecking ? '...' :
                                             ollamaStatus.running
                                                ? (ollamaStatus.version ? `v${ollamaStatus.version}` : t('aiSettings.status.ready'))
                                                : t('aiSettings.status.notRunning')}
                                        </span>
                                        {ollamaStatus.running === false && (
                                            <button
                                                onClick={handleStartOllama}
                                                disabled={ollamaStarting || isChecking}
                                                style={{
                                                    background: 'rgba(34,197,94,0.1)',
                                                    border: '1px solid rgba(34,197,94,0.3)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    cursor: 'pointer',
                                                    padding: '3px 10px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 600,
                                                    color: 'var(--color-success)',
                                                    display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {ollamaStarting
                                                    ? <Loader size={10} className="animate-spin" />
                                                    : <Play size={10} />}
                                                {t('aiSettings.status.start')}
                                            </button>
                                        )}
                                    </div>

                                    {/* Chat Model */}
                                    <div style={rowStyle}>
                                        {statusDot(ollamaStatus.running ? ollamaStatus.chatReady : null)}
                                        <span style={rowLabelStyle}>{t('aiSettings.status.chatModel')}</span>
                                        <span style={{ ...rowValueStyle, color: ollamaStatus.chatReady ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                            {ollamaStatus.chatReady
                                                ? t('aiSettings.status.ready')
                                                : (ollamaStatus.running
                                                    ? t('aiSettings.status.chatMissing', { model: localConfig.chatModel || DEFAULT_CHAT_MODEL })
                                                    : '—')}
                                        </span>
                                        {ollamaStatus.running && !ollamaStatus.chatReady && (
                                            actionBtn(chatPull, handlePullChat, t('aiSettings.status.downloadChat'), chatPullMsg)
                                        )}
                                    </div>
                                    {ollamaStatus.running && !ollamaStatus.chatReady && ollamaStatus.chatModels.length > 0 && (
                                        <div style={{
                                            marginTop: -4, marginBottom: 4, marginLeft: 20,
                                            fontSize: '0.68rem', color: 'var(--color-text-muted)', lineHeight: 1.4,
                                        }}>
                                            {t('aiSettings.status.chatAltHint', {
                                                models: ollamaStatus.chatModels.slice(0, 3).join(', '),
                                            })}
                                        </div>
                                    )}

                                    {/* Vision Model */}
                                    <div style={rowStyle}>
                                        {statusDot(ollamaStatus.running ? ollamaStatus.visionReady : null)}
                                        <span style={rowLabelStyle}>{t('aiSettings.status.visionModel')}</span>
                                        <span style={{ ...rowValueStyle, color: ollamaStatus.visionReady ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                            {ollamaStatus.visionReady
                                                ? t('aiSettings.status.ready')
                                                : (ollamaStatus.running
                                                    ? t('aiSettings.status.visionMissing', { model: localConfig.visionModel || DEFAULT_VISION_MODEL })
                                                    : '—')}
                                        </span>
                                        {ollamaStatus.running && !ollamaStatus.visionReady && (
                                            actionBtn(visionPull, handlePullVision, t('aiSettings.status.downloadVision'), visionPullMsg)
                                        )}
                                    </div>

                                    {/* CORS */}
                                    <div style={rowStyle}>
                                        {statusDot(corsStatus === 'ok' ? true : corsStatus === 'error' ? false : null)}
                                        <span style={rowLabelStyle}>CORS</span>
                                        <span style={{ ...rowValueStyle, color: corsStatus === 'ok' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                            {corsStatus === 'ok' ? t('aiSettings.status.configured') : '—'}
                                        </span>
                                        {ollamaStatus.running && corsStatus !== 'ok' && (
                                            actionBtn(corsStatus, handleSetCors, t('aiSettings.setCors'), corsMsg)
                                        )}
                                    </div>
                                </div>

                                {/* Version warning */}
                                {ollamaStatus.version && isOllamaVersionOld(ollamaStatus.version) && (
                                    <div style={{ padding: '8px 14px', background: 'rgba(234,179,8,0.1)', borderTop: '1px solid rgba(234,179,8,0.2)', fontSize: '0.72rem', color: '#ca8a04', lineHeight: 1.4 }}>
                                        {t('aiSettings.error.oldVersion', { version: ollamaStatus.version })}
                                    </div>
                                )}

                                {/* Ollama not running — kurulum rehberi */}
                                {ollamaStatus.running === false && (
                                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.06)', borderTop: '1px solid var(--color-border)', fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                        {t('aiSettings.status.installHint')}
                                    </div>
                                )}
                            </div>

                            {/* URL Input */}
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>{t('aiSettings.label.ollamaUrl')}</label>
                                <input
                                    className="search-input"
                                    style={{ width: '100%' }}
                                    placeholder="http://localhost:11434/v1/chat/completions"
                                    value={localConfig.apiUrl}
                                    onChange={(e) => setLocalConfig({ ...localConfig, apiUrl: e.target.value })}
                                />
                                <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                                    {t('aiSettings.hint.defaultUrl')}
                                </p>
                            </div>

                            {/* Advanced — model secimi (sadece Ollama calisirken goster) */}
                            {ollamaStatus.running && <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                <button
                                    onClick={() => setAdvancedOpen(v => !v)}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--color-bg-secondary)', border: 'none', cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: '0.82rem', fontWeight: 600, borderRadius: advancedOpen ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)' }}
                                >
                                    <span style={{ flex: 1, textAlign: 'left' }}>{t('aiSettings.status.advanced')}</span>
                                    {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                {advancedOpen && (
                                    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--color-border)' }}>
                                        {/* Chat model — vision model ile aynı pattern: dropdown varsa */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4 }}>{t('aiSettings.status.chatModel')}</label>
                                            {ollamaStatus.chatModels.length > 0 ? (
                                                <select
                                                    className="search-input"
                                                    style={{ width: '100%', padding: '8px 10px' }}
                                                    value={localConfig.chatModel || DEFAULT_CHAT_MODEL}
                                                    onChange={(e) => setLocalConfig({ ...localConfig, chatModel: e.target.value })}
                                                >
                                                    {ollamaStatus.chatModels.map((m) => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    className="search-input"
                                                    style={{ width: '100%' }}
                                                    placeholder={DEFAULT_CHAT_MODEL}
                                                    value={localConfig.chatModel || ''}
                                                    onChange={(e) => setLocalConfig({ ...localConfig, chatModel: e.target.value })}
                                                />
                                            )}
                                            <p style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                {t('aiSettings.status.chatModelHint')}
                                            </p>
                                        </div>

                                        {/* Vision model */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4 }}>{t('aiSettings.label.visionModel')}</label>
                                            {ollamaStatus.visionModels.length > 0 ? (
                                                <select
                                                    className="search-input"
                                                    style={{ width: '100%', padding: '8px 10px' }}
                                                    value={localConfig.visionModel || DEFAULT_VISION_MODEL}
                                                    onChange={(e) => setLocalConfig({ ...localConfig, visionModel: e.target.value })}
                                                >
                                                    {ollamaStatus.visionModels.map(m => (
                                                        <option key={m} value={m.split(':')[0]}>
                                                            {m} {m.startsWith('llava') ? t('aiSettings.model.llavaDesc') : m.startsWith('moondream') ? t('aiSettings.model.moondreamDesc') : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    className="search-input"
                                                    style={{ width: '100%' }}
                                                    placeholder={DEFAULT_VISION_MODEL}
                                                    value={localConfig.visionModel || ''}
                                                    onChange={(e) => setLocalConfig({ ...localConfig, visionModel: e.target.value })}
                                                />
                                            )}
                                            <p style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                {t('aiSettings.status.visionModelHint')}
                                            </p>
                                        </div>

                                        {/* All discovered models */}
                                        {ollamaStatus.allModels.length > 0 && (
                                            <div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                                                    {t('aiSettings.status.installedModels')}
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                    {ollamaStatus.allModels.map(m => (
                                                        <span key={m} style={{
                                                            padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500,
                                                            background: isVisionModel(m) ? 'rgba(168,85,247,0.12)' : 'rgba(34,197,94,0.12)',
                                                            color: isVisionModel(m) ? '#a855f7' : '#22c55e',
                                                        }}>
                                                            {m}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>}
                        </>
                    )}

                    {/* Non-Ollama: API key input */}
                    {localConfig.apiProvider !== 'ollama' && (
                        <>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>{t('aiSettings.label.apiKey')}</label>
                                <input
                                    className="search-input"
                                    type="password"
                                    style={{ width: '100%' }}
                                    placeholder={t('aiSettings.placeholder.apiKey', { provider: localConfig.apiProvider })}
                                    value={localConfig.apiKey}
                                    onChange={(e) => { setCloudTest('idle'); setLocalConfig({ ...localConfig, apiKey: e.target.value }); }}
                                />
                            </div>

                            {/* Cloud connection test */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={testCloudConnection}
                                    disabled={cloudTest === 'testing'}
                                    style={{ fontSize: '0.8rem' }}
                                >
                                    {cloudTest === 'testing' ? <Loader size={13} className="animate-spin" /> : null}
                                    {cloudTest === 'testing' ? t('aiSettings.button.testing') : t('aiSettings.button.test')}
                                </button>
                                {cloudTest === 'ok' && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--color-success)' }}>
                                        <CheckCircle size={14} /> {t('aiSettings.test.cloudOk')}
                                    </span>
                                )}
                                {cloudTest === 'error' && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--color-error)' }}>
                                        <XCircle size={14} /> {cloudTestMsg}
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {/* ── Advanced Visual Search (CLIP) ── */}
                    <div style={{ marginTop: 24, padding: '16px 14px', background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t('aiSettings.section.clip')}</div>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={localConfig.enableClipVision || false}
                                    onChange={(e) => setLocalConfig(prev => ({ ...prev, enableClipVision: e.target.checked }))}
                                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-success)' }}
                                />
                                <span style={{ marginLeft: 8, fontSize: '0.8rem', fontWeight: 600, color: localConfig.enableClipVision ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                    {localConfig.enableClipVision ? t('aiSettings.clip.on') : t('aiSettings.clip.off')}
                                </span>
                            </label>
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.4, margin: 0 }}>
                            {t('aiSettings.clip.description')}
                        </p>
                    </div>

                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--color-bg-secondary)' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('common.button.cancel')}</button>
                    <button className="btn btn-primary" onClick={handleSave}>{t('common.button.save')}</button>
                </div>
            </div>
        </div>
        </ModalErrorBoundary>
    );
}

// ─── Style sabitleri ────────────────────────────────────────────

const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 14px',
    borderBottom: '1px solid var(--color-border)',
    fontSize: '0.8rem',
};

const rowLabelStyle: React.CSSProperties = {
    fontWeight: 500, color: 'var(--color-text-secondary)',
    minWidth: 100,
};

const rowValueStyle: React.CSSProperties = {
    flex: 1, fontWeight: 600, fontSize: '0.78rem',
};

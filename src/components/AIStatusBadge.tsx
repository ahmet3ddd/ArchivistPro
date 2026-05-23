/**
 * AIStatusBadge — Kompakt AI durum gostergesi.
 *
 * TopBar'da Brain ikonu + renkli nokta olarak gosterilir.
 * Tiklaninca AI Ayarlari acilir. Hover'da detayli durum gorunur.
 *
 * Durumlar:
 *   Yesil  = Ollama + modeller hazir
 *   Sari   = Ollama calisiyor ama modeller eksik
 *   Kirmizi = Ollama kapali
 *   Gri    = Henuz kontrol edilmedi
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOllamaStatus } from '../hooks/useOllamaStatus';
import { Brain, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface AIStatusBadgeProps {
    onClick?: () => void;
    /** Wizard acma callback'i */
    onSetupClick?: () => void;
}

export default function AIStatusBadge({ onClick, onSetupClick }: AIStatusBadgeProps) {
    const { t } = useTranslation();
    const { status } = useOllamaStatus({ pollInterval: 60_000 });
    const [showTooltip, setShowTooltip] = useState(false);
    const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);

    const allReady = status.running && status.chatReady && status.visionReady && status.corsOk !== false;
    const partialReady = status.running && (!status.chatReady || !status.visionReady || status.corsOk === false);
    const offline = status.running === false;

    const dotColor = allReady ? '#22c55e'
        : partialReady ? '#f59e0b'
        : offline ? '#ef4444'
        : '#6b7280';

    // Click-disinda tooltip kapat
    useEffect(() => {
        if (!showTooltip) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowTooltip(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showTooltip]);

    const handleMouseEnter = () => {
        tooltipTimeout.current = setTimeout(() => setShowTooltip(true), 400);
    };
    const handleMouseLeave = () => {
        clearTimeout(tooltipTimeout.current);
        // Tooltip aciksa kapat (kisa gecikme ile)
        setTimeout(() => setShowTooltip(false), 200);
    };

    return (
        <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
                className="btn btn-ghost"
                onClick={onClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                aria-label={t('aiStatus.label')}
                title={t('aiStatus.label')}
                style={{ padding: '6px 10px', position: 'relative', color: 'var(--color-accent)' }}
            >
                <Brain size={15} />
                {/* Status dot */}
                <div style={{
                    position: 'absolute', top: 4, right: 6,
                    width: 7, height: 7, borderRadius: '50%',
                    background: dotColor,
                    border: '1.5px solid var(--color-bg-primary)',
                }} />
            </button>

            {/* Hover tooltip */}
            {showTooltip && (
                <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    width: 220, padding: '10px 12px',
                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1000, fontSize: '0.75rem',
                    display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                    <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: 2 }}>
                        {t('aiStatus.title')}
                    </div>

                    <TooltipRow
                        label="Ollama"
                        ok={status.running}
                        detail={status.running ? (status.version ? `v${status.version}` : '✓') : t('aiStatus.offline')}
                    />
                    {status.running && (
                        <TooltipRow
                            label="CORS"
                            ok={status.corsOk}
                            detail={status.corsOk === true ? '✓' : status.corsOk === false ? t('aiStatus.corsNotSet') : '—'}
                        />
                    )}
                    <TooltipRow
                        label={t('aiStatus.chatModel')}
                        ok={status.chatReady}
                        detail={status.chatReady ? '✓' : t('aiStatus.missing')}
                    />
                    <TooltipRow
                        label={t('aiStatus.visionModel')}
                        ok={status.visionReady}
                        detail={status.visionReady ? '✓' : t('aiStatus.missing')}
                    />
                    <TooltipRow label="CLIP" ok detail={t('aiStatus.builtin')} />

                    {/* Kurulum Sihirbazi linki — eksikler varsa */}
                    {(!allReady) && onSetupClick && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowTooltip(false); onSetupClick(); }}
                            style={{
                                marginTop: 4, padding: '6px 0', background: 'none', border: 'none',
                                color: 'var(--color-accent)', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.72rem', textAlign: 'left',
                                textDecoration: 'underline',
                            }}
                        >
                            {t('aiStatus.setupLink')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function TooltipRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
    const Icon = ok === true ? CheckCircle : ok === false ? XCircle : AlertTriangle;
    const color = ok === true ? 'var(--color-success)' : ok === false ? 'var(--color-error)' : 'var(--color-text-muted)';

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon size={11} style={{ color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 600, color }}>{detail}</span>
        </div>
    );
}

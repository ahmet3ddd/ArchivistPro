import { useTranslation } from 'react-i18next';
import { Cpu, Zap, Cloud, MonitorX, ChevronRight, RefreshCw } from 'lucide-react';
import type { HardwareProfile, HardwareTier, TierRecommendation } from '../services/hardwareDetect';
import { getTierRecommendation } from '../services/hardwareDetect';

interface PerformanceSetupModalProps {
    profile: HardwareProfile;
    onApply: (tier: HardwareTier) => void;
    onSkip: () => void;
    onRetest: () => void;
}

const TIER_COLORS: Record<HardwareTier, string> = {
    low:  '#ef4444',
    mid:  '#f59e0b',
    high: '#22c55e',
};

// TIER_LABELS moved inside component to support i18n (see useTierLabel)

const TIERS: HardwareTier[] = ['low', 'mid', 'high'];

export default function PerformanceSetupModal({ profile, onApply, onSkip, onRetest }: PerformanceSetupModalProps) {
    const { t } = useTranslation();
    const TIER_LABELS: Record<HardwareTier, string> = {
        low:  t('perfSetup.lowTier'),
        mid:  'Orta',
        high: t('perfSetup.highTier'),
    };
    const recommended = getTierRecommendation(profile.tier);

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
        }}>
            <div className="glass-card animate-fade-in" role="dialog" aria-modal="true" style={{ width: 520, padding: 0, overflow: 'hidden' }}>

                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, transparent 100%)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <Cpu size={20} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>Performans Kurulumu</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>
                        {t('perfSetup.analyzed')}
                    </p>
                </div>

                <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Donanım Özeti */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                    }}>
                        <HardwareStat
                            label="CPU Çekirdek"
                            value={t('perfSetup.cores', { count: profile.cores })}
                        />
                        <HardwareStat
                            label="RAM (tahmini)"
                            value={profile.memoryGB !== null ? `~${profile.memoryGB} GB` : 'Bilinmiyor'}
                        />
                        <HardwareStat
                            label="Benchmark"
                            value={`${Math.round(profile.benchmarkMs)} ms`}
                            hint={t('perfSetup.lowIsFast')}
                        />
                    </div>

                    {/* Tier göstergesi */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px',
                        background: `${TIER_COLORS[profile.tier]}18`,
                        border: `1px solid ${TIER_COLORS[profile.tier]}44`,
                        borderRadius: 'var(--radius-md)',
                    }}>
                        <div style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: TIER_COLORS[profile.tier], flexShrink: 0,
                        }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: TIER_COLORS[profile.tier] }}>
                                {TIER_LABELS[profile.tier]} Performans — {recommended.label}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                {recommended.description}
                            </div>
                        </div>
                        <button
                            onClick={onRetest}
                            title="Yeniden test et"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, flexShrink: 0 }}
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>

                    {/* Uyarı */}
                    {recommended.warning && (
                        <div style={{
                            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                            fontSize: '0.75rem', color: '#f59e0b',
                        }}>
                            ⚠️ {recommended.warning}
                        </div>
                    )}

                    {/* 3 Seçenek */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                            {t('perfSetup.selectMode')}
                        </div>
                        {TIERS.map(tier => (
                            <TierOption
                                key={tier}
                                tier={tier}
                                rec={getTierRecommendation(tier)}
                                isRecommended={tier === profile.tier}
                                onSelect={() => onApply(tier)}
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '12px 24px',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <button
                        onClick={onSkip}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.78rem', padding: '6px 0' }}
                    >
                        {t('perfSetup.skip')}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onApply(profile.tier)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        {t('perfSetup.applyRecommended')}
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
}

function HardwareStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div style={{
            padding: '8px 10px',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{value}</div>
            {hint && <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>{hint}</div>}
        </div>
    );
}

function TierOption({ tier, rec, isRecommended, onSelect }: {
    tier: HardwareTier;
    rec: TierRecommendation;
    isRecommended: boolean;
    onSelect: () => void;
}) {
    const { t } = useTranslation();
    const color = TIER_COLORS[tier];
    const Icon = tier === 'low' ? MonitorX : tier === 'mid' ? Zap : Cloud;

    return (
        <button
            onClick={onSelect}
            style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '10px 12px',
                background: isRecommended ? `${color}12` : 'transparent',
                border: `1px solid ${isRecommended ? color + '55' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                display: 'flex', alignItems: 'flex-start', gap: 10,
                transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = `${color}18`)}
            onMouseLeave={e => (e.currentTarget.style.background = isRecommended ? `${color}12` : 'transparent')}
        >
            <Icon size={16} style={{ color, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.82rem', color }}>
                    {rec.label}
                    {isRecommended && (
                        <span style={{
                            marginLeft: 6, fontSize: '0.65rem', fontWeight: 500,
                            background: `${color}22`, color, padding: '1px 6px', borderRadius: 99,
                        }}>
                            {t('perfSetup.recommended')}
                        </span>
                    )}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    {rec.description}
                </div>
            </div>
        </button>
    );
}

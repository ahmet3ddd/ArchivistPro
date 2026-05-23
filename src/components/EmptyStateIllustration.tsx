interface EmptyStateIllustrationProps {
    type: 'empty-archive' | 'no-results';
}

export default function EmptyStateIllustration({ type }: EmptyStateIllustrationProps) {
    if (type === 'empty-archive') {
        return (
            <svg width="160" height="140" viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <style>{`
                    .ea-box { animation: eaFloat 3s ease-in-out infinite; }
                    .ea-folder { animation: eaFloat 3s ease-in-out infinite 0.3s; }
                    .ea-sparkle1 { animation: eaSparkle 2s ease-in-out infinite; }
                    .ea-sparkle2 { animation: eaSparkle 2s ease-in-out infinite 0.7s; }
                    .ea-sparkle3 { animation: eaSparkle 2s ease-in-out infinite 1.4s; }
                    .ea-ring { animation: eaPulse 2.5s ease-in-out infinite; }
                    @keyframes eaFloat {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-6px); }
                    }
                    @keyframes eaSparkle {
                        0%, 100% { opacity: 0.15; transform: scale(0.8); }
                        50% { opacity: 0.6; transform: scale(1.2); }
                    }
                    @keyframes eaPulse {
                        0%, 100% { opacity: 0.08; transform: scale(1); }
                        50% { opacity: 0.15; transform: scale(1.06); }
                    }
                `}</style>
                {/* Background ring */}
                <circle className="ea-ring" cx="80" cy="68" r="52" stroke="var(--color-accent)" strokeWidth="1" fill="none" />
                <circle className="ea-ring" cx="80" cy="68" r="40" stroke="var(--color-accent-secondary)" strokeWidth="0.5" fill="none" style={{ animationDelay: '0.5s' }} />
                {/* Archive box */}
                <g className="ea-box">
                    <rect x="52" y="52" width="56" height="36" rx="4" fill="var(--color-bg-tertiary)" stroke="var(--color-border-hover)" strokeWidth="1.5" />
                    <rect x="52" y="52" width="56" height="12" rx="4" fill="var(--color-accent)" opacity="0.2" />
                    <rect x="72" y="68" width="16" height="4" rx="2" fill="var(--color-accent)" opacity="0.4" />
                </g>
                {/* Folder */}
                <g className="ea-folder">
                    <path d="M36 40 L36 30 L50 30 L54 34 L68 34 L68 40" fill="var(--color-bg-tertiary)" stroke="var(--color-accent-secondary)" strokeWidth="1" opacity="0.5" />
                </g>
                {/* Sparkles */}
                <circle className="ea-sparkle1" cx="32" cy="55" r="2.5" fill="var(--color-accent)" />
                <circle className="ea-sparkle2" cx="128" cy="45" r="2" fill="var(--color-accent-secondary)" />
                <circle className="ea-sparkle3" cx="112" cy="90" r="1.5" fill="var(--color-accent-hover)" />
                {/* Dashed arrow hint */}
                <path d="M80 100 L80 120" stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />
                <path d="M76 116 L80 122 L84 116" stroke="var(--color-text-muted)" strokeWidth="1" fill="none" opacity="0.3" />
            </svg>
        );
    }

    // no-results
    return (
        <svg width="160" height="140" viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <style>{`
                .nr-lens { animation: nrBob 2.5s ease-in-out infinite; }
                .nr-cross { animation: nrShake 3s ease-in-out infinite; }
                .nr-dot1 { animation: nrFade 2s ease-in-out infinite; }
                .nr-dot2 { animation: nrFade 2s ease-in-out infinite 0.6s; }
                .nr-dot3 { animation: nrFade 2s ease-in-out infinite 1.2s; }
                @keyframes nrBob {
                    0%, 100% { transform: translate(0, 0) rotate(0deg); }
                    25% { transform: translate(3px, -4px) rotate(5deg); }
                    75% { transform: translate(-3px, -2px) rotate(-3deg); }
                }
                @keyframes nrShake {
                    0%, 80%, 100% { transform: scale(1); }
                    85% { transform: scale(1.15); }
                    90% { transform: scale(0.95); }
                }
                @keyframes nrFade {
                    0%, 100% { opacity: 0.1; }
                    50% { opacity: 0.4; }
                }
            `}</style>
            {/* Scattered document outlines */}
            <rect className="nr-dot1" x="30" y="35" width="24" height="30" rx="3" stroke="var(--color-border-hover)" strokeWidth="1" fill="none" />
            <rect className="nr-dot2" x="106" y="40" width="24" height="30" rx="3" stroke="var(--color-border-hover)" strokeWidth="1" fill="none" />
            <rect className="nr-dot3" x="68" y="85" width="24" height="30" rx="3" stroke="var(--color-border-hover)" strokeWidth="1" fill="none" />
            {/* Magnifying glass */}
            <g className="nr-lens">
                <circle cx="76" cy="56" r="20" stroke="var(--color-accent)" strokeWidth="2" fill="var(--color-bg-glass)" />
                <line x1="90" y1="70" x2="104" y2="84" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
            </g>
            {/* X mark inside lens */}
            <g className="nr-cross">
                <line x1="70" y1="50" x2="82" y2="62" stroke="var(--color-danger)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
                <line x1="82" y1="50" x2="70" y2="62" stroke="var(--color-danger)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            </g>
        </svg>
    );
}

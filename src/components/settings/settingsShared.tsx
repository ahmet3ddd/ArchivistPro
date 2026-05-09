/** Ayarlar modalında paylaşılan küçük UI primitifleri */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: '16px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--color-border)' }}>
            {children}
        </h3>
    );
}

export function SettingRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: '0.74rem' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{value}</span>
        </div>
    );
}

/**
 * Kart tabanlı ayar grubu — collapsible, ikonlu, açıklamalı.
 * Tüm ayar sekmelerinde tutarlı görsel hiyerarşi sağlar.
 */
export function SettingsCard({
    icon,
    title,
    subtitle,
    children,
    defaultCollapsed = false,
    collapsible = true,
    accentColor,
}: {
    icon?: React.ReactNode;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    defaultCollapsed?: boolean;
    collapsible?: boolean;
    accentColor?: string;
}) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const accent = accentColor || 'var(--color-accent)';

    return (
        <div
            style={{
                marginBottom: 12,
                borderRadius: 12,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                overflow: 'hidden',
                transition: 'border-color 0.15s',
            }}
        >
            {/* Header */}
            <button
                type="button"
                onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    cursor: collapsible ? 'pointer' : 'default',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                }}
            >
                {icon && (
                    <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                        color: accent, flexShrink: 0,
                    }}>
                        {icon}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
                        {title}
                    </div>
                    {subtitle && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                            {subtitle}
                        </div>
                    )}
                </div>
                {collapsible && (
                    <ChevronDown
                        size={14}
                        style={{
                            color: 'var(--color-text-muted)',
                            transition: 'transform 0.2s ease',
                            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                            flexShrink: 0,
                        }}
                    />
                )}
            </button>

            {/* Content */}
            {!collapsed && (
                <div style={{
                    padding: '0 16px 14px',
                    borderTop: '1px solid var(--color-border)',
                }}>
                    {children}
                </div>
            )}
        </div>
    );
}

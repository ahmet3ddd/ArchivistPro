/** Arşiv Extract Modal — paylaşılan küçük UI bileşenleri */
import { ChevronDown, ChevronRight } from 'lucide-react';

export function FilterSection({ label, count, expanded, onToggle, children }: {
    label: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
    return (
        <div style={{ marginBottom: 8, border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={onToggle} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', background: 'var(--color-bg-primary)', border: 'none',
                cursor: 'pointer', fontSize: '0.76rem', color: 'var(--color-text-secondary)',
            }}>
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{label}</span>
                {count > 0 && (
                    <span style={{
                        marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff',
                        fontSize: '0.64rem', padding: '1px 6px', borderRadius: 999, fontWeight: 600,
                    }}>{count}</span>
                )}
            </button>
            {expanded && (
                <div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {children}
                </div>
            )}
        </div>
    );
}

export function CheckChip({ checked, onClick, label, color }: {
    checked: boolean; onClick: () => void; label: string; color?: string;
}) {
    return (
        <button onClick={onClick} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${checked ? (color || 'var(--color-accent)') : 'var(--color-border)'}`,
            background: checked ? `${color || 'var(--color-accent)'}22` : 'transparent',
            color: checked ? (color || 'var(--color-accent)') : 'var(--color-text-secondary)',
            fontSize: '0.72rem', cursor: 'pointer', fontWeight: checked ? 600 : 400,
        }}>
            {label}
        </button>
    );
}

export function CheckboxOption({ checked, onChange, label }: {
    checked: boolean; onChange: (b: boolean) => void; label: string;
}) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
                style={{ accentColor: 'var(--color-accent)' }} />
            {label}
        </label>
    );
}

export function StatRow({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 600, color: highlight ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{value}</span>
        </div>
    );
}

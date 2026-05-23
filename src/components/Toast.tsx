import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';
import { TIMINGS } from '../config/constants';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
    id: string;
    type: ToastType;
    message: string;
}

interface ToastContainerProps {
    toasts: ToastItem[];
    onRemove: (id: string) => void;
}

function ToastIcon({ type }: { type: ToastType }) {
    const size = 16;
    if (type === 'success') return <CheckCircle size={size} />;
    if (type === 'error') return <XCircle size={size} />;
    if (type === 'warning') return <AlertTriangle size={size} />;
    return <Info size={size} />;
}

const COLORS: Record<ToastType, { bg: string; border: string; color: string }> = {
    success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)', color: '#34d399' },
    error:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  color: '#f87171' },
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', color: '#fbbf24' },
    info:    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)', color: '#60a5fa' },
};

function Toast({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
    const { t } = useTranslation();
    const c = COLORS[toast.type];

    useEffect(() => {
        const t = setTimeout(() => onRemove(toast.id), TIMINGS.TOAST_DISMISS_MS);
        return () => clearTimeout(t);
    }, [toast.id, onRemove]);

    return (
        <div role="alert" aria-live="polite" aria-atomic="true" style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px',
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontSize: '0.85rem',
            lineHeight: 1.4,
            maxWidth: 360,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            animation: 'fadeInUp 0.2s ease',
        }}>
            <span aria-hidden="true" style={{ color: c.color, flexShrink: 0, marginTop: 1 }}>
                <ToastIcon type={toast.type} />
            </span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
                onClick={() => onRemove(toast.id)}
                aria-label={t('common.aria.dismiss')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, flexShrink: 0, marginTop: 1 }}
            >
                <X size={14} aria-hidden="true" />
            </button>
        </div>
    );
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
    if (toasts.length === 0) return null;
    return (
        <div style={{
            position: 'fixed', bottom: 24, right: 24,
            display: 'flex', flexDirection: 'column', gap: 10,
            zIndex: 9999,
        }}>
            {toasts.map(t => (
                <Toast key={t.id} toast={t} onRemove={onRemove} />
            ))}
        </div>
    );
}

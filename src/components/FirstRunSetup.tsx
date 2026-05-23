/**
 * ArchivistPro — İlk Kurulum Ekranı
 *
 * Kullanıcı tablosu tamamen boşsa gösterilir.
 * Kullanıcıdan admin hesabı bilgilerini alarak DB'ye kaydeder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Loader2 } from 'lucide-react';
import { createUser } from '../services/userService';

interface FirstRunSetupProps {
    onComplete: () => void;
}

export default function FirstRunSetup({ onComplete }: FirstRunSetupProps) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '10px 14px', fontSize: '0.85rem',
        background: 'var(--color-bg-tertiary, rgba(255,255,255,0.04))',
        border: '1px solid var(--color-border)',
        borderRadius: 10, color: 'var(--color-text-primary)',
        outline: 'none', boxSizing: 'border-box',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block', fontSize: '0.74rem', fontWeight: 500,
        color: 'var(--color-text-secondary)', marginBottom: 6,
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!username.trim() || !password.trim()) {
            setError(t('login.error.fieldsRequired'));
            return;
        }
        if (password.length < 6) {
            setError(t('login.firstRun.minLength'));
            return;
        }
        if (password !== confirm) {
            setError(t('login.firstRun.passwordMismatch'));
            return;
        }

        setLoading(true);
        const result = await createUser({ username: username.trim(), password, role: 'admin' });
        setLoading(false);

        if (!result.success) {
            setError(result.error ?? t('common.error.unknown'));
            return;
        }

        onComplete();
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100vh', width: '100vw',
            background: 'var(--color-bg-primary)',
            fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
        }}>
            <div style={{
                width: 380, padding: 40, borderRadius: 20,
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
                        background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <UserPlus size={26} color="#fff" />
                    </div>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                        {t('login.firstRun.title')}
                    </h1>
                    <p style={{ fontSize: '0.78rem', margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
                        {t('login.firstRun.subtitle')}
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>{t('login.firstRun.usernameLabel')}</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoFocus
                            autoComplete="username"
                            style={inputStyle}
                            onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>{t('login.firstRun.passwordLabel')}</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="new-password"
                            style={inputStyle}
                            onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>
                    <div style={{ marginBottom: 20 }}>
                        <label style={labelStyle}>{t('login.firstRun.confirmLabel')}</label>
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            autoComplete="new-password"
                            style={inputStyle}
                            onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>

                    {error && (
                        <div style={{
                            padding: '8px 12px', borderRadius: 8, marginBottom: 16,
                            fontSize: '0.74rem', color: '#ef4444',
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.2)',
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                        style={{
                            width: '100%', padding: '12px', justifyContent: 'center',
                            fontSize: '0.88rem', fontWeight: 600, borderRadius: 10,
                            opacity: loading ? 0.6 : 1,
                        }}
                    >
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                        {loading ? t('login.firstRun.creating') : t('login.firstRun.submit')}
                    </button>
                </form>
            </div>
        </div>
    );
}

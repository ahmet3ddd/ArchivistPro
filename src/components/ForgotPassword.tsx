/**
 * ArchivistPro — Şifre Sıfırlama Ekranı
 *
 * İki adım:
 *   1. recovery.key doğrulaması
 *   2. Admin kullanıcı seçimi + yeni şifre belirleme
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { readRecoveryKey } from '../services/recoveryService';
import { getAllUsers, updateUser } from '../services/userService';

interface ForgotPasswordProps {
    onBack: () => void;
    onSuccess: () => void;
}

type Step = 1 | 2;

export default function ForgotPassword({ onBack, onSuccess }: ForgotPasswordProps) {
    const { t } = useTranslation();

    const [step, setStep] = useState<Step>(1);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    // Step 2 state
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const admins = getAllUsers().filter(u => u.role === 'admin');

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

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const stored = await readRecoveryKey();
            if (!stored || stored.trim() !== code.trim()) {
                setError(t('login.forgotPassword.step1Error'));
                setLoading(false);
                return;
            }
        } catch {
            setError(t('common.error.unknown'));
            setLoading(false);
            return;
        }
        setLoading(false);
        if (admins.length === 0) {
            setError(t('login.forgotPassword.noAdmins'));
            return;
        }
        setSelectedUserId(admins[0].id);
        setStep(2);
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!newPassword.trim()) {
            setError(t('login.error.fieldsRequired'));
            return;
        }
        if (newPassword.length < 6) {
            setError(t('login.firstRun.minLength'));
            return;
        }
        if (newPassword !== confirmPassword) {
            setError(t('login.forgotPassword.step2PasswordMismatch'));
            return;
        }
        if (selectedUserId === null) return;

        setLoading(true);
        const result = await updateUser(selectedUserId, { password: newPassword });
        setLoading(false);

        if (!result.success) {
            setError(result.error ?? t('common.error.unknown'));
            return;
        }

        setDone(true);
        setTimeout(onSuccess, 1800);
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
                {/* Başarı ekranı */}
                {done ? (
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <CheckCircle2 size={48} style={{ color: 'var(--color-success)', marginBottom: 16 }} />
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            {t('login.forgotPassword.step2Success')}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Başlık */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                            <button
                                type="button"
                                onClick={onBack}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--color-text-muted)', padding: 4, borderRadius: 6,
                                    display: 'flex', alignItems: 'center',
                                }}
                                aria-label={t('login.forgotPassword.backToLogin')}
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <KeyRound size={18} style={{ color: 'var(--color-accent)' }} />
                                    <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                                        {t('login.forgotPassword.title')}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                    {step === 1
                                        ? t('login.forgotPassword.step1Title')
                                        : t('login.forgotPassword.step2Title')}
                                </div>
                            </div>
                        </div>

                        {/* Adım göstergesi */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
                            {([1, 2] as Step[]).map(s => (
                                <div key={s} style={{
                                    flex: 1, height: 3, borderRadius: 2,
                                    background: step >= s
                                        ? 'var(--color-accent)'
                                        : 'var(--color-border)',
                                    transition: 'background 0.3s',
                                }} />
                            ))}
                        </div>

                        {/* Adım 1: Kurtarma kodu */}
                        {step === 1 && (
                            <form onSubmit={handleVerifyCode}>
                                <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
                                    {t('login.forgotPassword.step1Desc')}
                                </p>
                                <div style={{ marginBottom: 20 }}>
                                    <label style={labelStyle}>{t('login.forgotPassword.step1Label')}</label>
                                    <input
                                        type="text"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        autoFocus
                                        autoComplete="off"
                                        style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.05em' }}
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
                                    disabled={loading || !code.trim()}
                                    style={{
                                        width: '100%', padding: '12px', justifyContent: 'center',
                                        fontSize: '0.88rem', fontWeight: 600, borderRadius: 10,
                                        opacity: (loading || !code.trim()) ? 0.6 : 1,
                                    }}
                                >
                                    {loading ? <Loader2 size={16} className="spinner" /> : <KeyRound size={16} />}
                                    {loading ? '...' : t('login.forgotPassword.step1Submit')}
                                </button>
                            </form>
                        )}

                        {/* Adım 2: Yeni şifre */}
                        {step === 2 && (
                            <form onSubmit={handleResetPassword}>
                                {admins.length > 1 && (
                                    <div style={{ marginBottom: 14 }}>
                                        <label style={labelStyle}>{t('login.forgotPassword.step2UserLabel')}</label>
                                        <select
                                            value={selectedUserId ?? ''}
                                            onChange={(e) => setSelectedUserId(Number(e.target.value))}
                                            style={{
                                                ...inputStyle,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {admins.map(u => (
                                                <option key={u.id} value={u.id}>
                                                    {u.displayName || u.username}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div style={{ marginBottom: 14 }}>
                                    <label style={labelStyle}>{t('login.forgotPassword.step2PassLabel')}</label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        autoFocus
                                        autoComplete="new-password"
                                        style={inputStyle}
                                        onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
                                        onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
                                    />
                                </div>
                                <div style={{ marginBottom: 20 }}>
                                    <label style={labelStyle}>{t('login.forgotPassword.step2ConfirmLabel')}</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
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
                                    {loading ? <Loader2 size={16} className="spinner" /> : <KeyRound size={16} />}
                                    {loading ? '...' : t('login.forgotPassword.step2Submit')}
                                </button>
                            </form>
                        )}

                        {/* Geri linki */}
                        <button
                            type="button"
                            onClick={onBack}
                            style={{
                                display: 'block', width: '100%', marginTop: 12, padding: '9px',
                                background: 'none', border: '1px solid var(--color-border)',
                                borderRadius: 10, cursor: 'pointer', fontSize: '0.78rem',
                                color: 'var(--color-text-muted)',
                                transition: 'border-color 0.2s, color 0.2s',
                                textAlign: 'center',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget).style.borderColor = 'var(--color-accent)'; (e.currentTarget).style.color = 'var(--color-accent)'; }}
                            onMouseLeave={(e) => { (e.currentTarget).style.borderColor = 'var(--color-border)'; (e.currentTarget).style.color = 'var(--color-text-muted)'; }}
                        >
                            {t('login.forgotPassword.backToLogin')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

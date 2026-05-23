/**
 * ArchivistPro — Login Ekranı
 *
 * DB tabanlı kullanıcı doğrulaması.
 * isFirstRun=true ise FirstRunSetup, mod=forgotPassword ise ForgotPassword gösterilir.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, Shield, Eye, Loader2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getAppRole } from '../permissions/roles';
import { APP_VERSION } from '../appVersion';
import { getUserByCredentials, getLoginLockout } from '../services/userService';
import FirstRunSetup from './FirstRunSetup';
import ForgotPassword from './ForgotPassword';

interface LoginScreenProps {
  onLogin: (username: string, role: 'admin' | 'viewer', userId: number, isBlocked: boolean, isDeveloper: boolean) => void;
  onCancel?: () => void;
  dbReady?: boolean;
  dbError?: string | null;
  isFirstRun?: boolean;
  onFirstRunComplete?: () => void;
}

export default function LoginScreen({ onLogin, onCancel, dbReady = true, dbError, isFirstRun = false, onFirstRunComplete }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgotPassword'>('login');
  const [dbSizeMb, setDbSizeMb] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslation();

  useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);

  // DB hazır değilse yüklenen dosya boyutunu göster
  useEffect(() => {
    if (dbReady) return;
    let cancelled = false;
    invoke<[string, number]>('get_database_info')
      .then(([, sizeBytes]) => {
        if (!cancelled && sizeBytes > 0) setDbSizeMb(sizeBytes / 1024 / 1024);
      })
      .catch(() => { /* sessiz */ });
    return () => { cancelled = true; };
  }, [dbReady]);

  if (isFirstRun) {
    return <FirstRunSetup onComplete={onFirstRunComplete ?? (() => {})} />;
  }

  if (mode === 'forgotPassword') {
    return (
      <ForgotPassword
        onBack={() => setMode('login')}
        onSuccess={() => setMode('login')}
      />
    );
  }

  const buildRole = getAppRole();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError(t('login.error.fieldsRequired'));
      return;
    }

    const preLock = getLoginLockout(username);
    if (preLock) {
      setError(t('login.error.lockedOut', { minutes: preLock.remainingMinutes }));
      return;
    }

    setLoading(true);
    try {
      const user = await getUserByCredentials(username, password);
      if (!user) {
        const postLock = getLoginLockout(username);
        if (postLock) {
          setError(t('login.error.lockedOut', { minutes: postLock.remainingMinutes }));
        } else {
          setError(t('login.error.invalidCredentials'));
        }
        setLoading(false);
        return;
      }

      if (buildRole === 'viewer' && user.role === 'admin') {
        setError(t('login.error.viewerModeAdminBlocked'));
        setLoading(false);
        return;
      }

      onLogin(user.username, user.role, user.id, user.isBlocked, user.isDeveloper);
    } catch {
      setError(t('login.error.loginFailed'));
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw',
      background: 'var(--color-bg-primary)',
      fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Animated background orbs */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
          top: '-15%', left: '-10%', opacity: 0.6,
          animation: 'loginOrb1 12s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, transparent 70%)',
          bottom: '-10%', right: '-8%', opacity: 0.5,
          animation: 'loginOrb2 15s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
          top: '50%', left: '60%', opacity: 0.3,
          animation: 'loginOrb3 10s ease-in-out infinite',
        }} />
        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(var(--color-border) 1px, transparent 1px),
                            linear-gradient(90deg, var(--color-border) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          opacity: 0.3,
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        }} />
      </div>

      {/* Login card */}
      <div style={{
        width: 400, padding: '44px 40px 36px', borderRadius: 24,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-modal)',
        position: 'relative', zIndex: 1,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
        transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Logo */}
        <div style={{
          textAlign: 'center', marginBottom: 32,
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(12px)',
          transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, margin: '0 auto 18px',
            background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.6rem', fontWeight: 800, color: '#fff',
            boxShadow: '0 8px 32px var(--color-accent-glow)',
            animation: 'loginLogoPulse 3s ease-in-out infinite',
          }}>
            A
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.4rem', fontWeight: 800, margin: 0,
            background: 'linear-gradient(135deg, var(--color-text-primary), var(--color-accent-hover))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
          }}>
            Archivist Pro
          </h1>
          <p style={{
            fontSize: '0.76rem', margin: '8px 0 0',
            color: 'var(--color-text-muted)',
            letterSpacing: '0.02em',
          }}>
            {t('login.subtitle')}
          </p>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 12px', borderRadius: 10, marginTop: 14,
            fontSize: '0.68rem', fontWeight: 600,
            background: buildRole === 'admin'
              ? 'var(--color-accent-subtle)' : 'rgba(168,85,247,0.08)',
            color: buildRole === 'admin'
              ? 'var(--color-accent)' : 'var(--color-accent-secondary)',
            border: `1px solid ${buildRole === 'admin' ? 'var(--color-accent-glow)' : 'rgba(168,85,247,0.15)'}`,
          }}>
            {buildRole === 'admin' ? <Shield size={11} /> : <Eye size={11} />}
            {buildRole === 'admin' ? 'Admin Build' : 'Viewer Build'}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{
            marginBottom: 16,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s',
          }}>
            <label style={{
              display: 'block', fontSize: '0.74rem', fontWeight: 500,
              color: 'var(--color-text-secondary)', marginBottom: 6,
            }}>
              {t('login.label.username')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              style={{
                width: '100%', padding: '11px 14px', fontSize: '0.85rem',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderRadius: 10, color: 'var(--color-text-primary)',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-glow)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={{
            marginBottom: 20,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <label style={{
              display: 'block', fontSize: '0.74rem', fontWeight: 500,
              color: 'var(--color-text-secondary)', marginBottom: 6,
            }}>
              {t('login.label.password')}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{
                  width: '100%', padding: '11px 40px 11px 14px', fontSize: '0.85rem',
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 10, color: 'var(--color-text-primary)',
                  outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-glow)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = 'none'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t('login.aria.hidePassword') : t('login.aria.showPassword')}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', padding: 4,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                <Eye size={16} />
              </button>
            </div>
          </div>

          {(error || dbError) && (
            <div style={{
              padding: '9px 14px', borderRadius: 10, marginBottom: 16,
              fontSize: '0.74rem', color: 'var(--color-danger)',
              background: 'rgba(244,63,94,0.06)',
              border: '1px solid rgba(244,63,94,0.15)',
              animation: 'loginShake 0.4s ease-out',
            }}>
              {error || dbError}
            </div>
          )}

          <div style={{
            textAlign: 'right', marginBottom: 14, marginTop: -6,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s 0.35s',
          }}>
            <button
              type="button"
              onClick={() => setMode('forgotPassword')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: '0.72rem', color: 'var(--color-text-muted)',
                textDecoration: 'underline', textUnderlineOffset: 3,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              {t('login.forgotPassword.link')}
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !dbReady}
            style={{
              width: '100%', padding: '12px', justifyContent: 'center',
              fontSize: '0.88rem', fontWeight: 600, borderRadius: 12,
              opacity: (loading || !dbReady) ? 0.6 : mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(8px)',
              transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.35s',
            }}
          >
            {(loading || !dbReady) ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {!dbReady ? t('login.button.preparing') : loading ? t('login.button.loggingIn') : t('login.button.submit')}
          </button>
          {!dbReady && dbSizeMb !== null && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 6 }}>
              {t('login.dbLoadingHint', { size: dbSizeMb.toFixed(1) })}
            </div>
          )}
        </form>

        <button
          type="button"
          onClick={onCancel ?? (() => { invoke('app_quit').catch(() => {}); })}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', marginTop: 10, padding: '9px',
            background: 'none', border: '1px solid var(--color-border)',
            borderRadius: 10, cursor: 'pointer', fontSize: '0.82rem',
            color: 'var(--color-text-muted)',
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-danger)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)'; }}
        >
          <X size={14} />
          {onCancel ? t('login.button.cancel') : t('login.button.exit')}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: '0.64rem', color: 'var(--color-text-muted)', opacity: 0.5 }}>
          v{APP_VERSION}
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes loginOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, 30px) scale(1.1); }
          66% { transform: translate(-20px, -15px) scale(0.95); }
        }
        @keyframes loginOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-30px, -20px) scale(1.05); }
          66% { transform: translate(25px, 15px) scale(0.9); }
        }
        @keyframes loginOrb3 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-40px, 30px); }
        }
        @keyframes loginLogoPulse {
          0%, 100% { box-shadow: 0 8px 32px var(--color-accent-glow); }
          50% { box-shadow: 0 8px 48px var(--color-accent-glow), 0 0 0 8px rgba(99, 102, 241, 0.06); }
        }
        @keyframes loginShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }
      `}</style>
    </div>
  );
}

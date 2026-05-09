/**
 * Archivist Pro — Kilit Ekranı
 *
 * Session timeout sonrası gösterilir.
 * Kullanıcı oturumu açık kalır (in-memory state korunur), sadece şifre ile kilit açılır.
 * "Kullanıcı Değiştir" ile tam logout yapılabilir.
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LogOut, Loader2, User } from 'lucide-react';
import { getUserByCredentials } from '../services/userService';

interface LockScreenProps {
  username: string;
  onUnlock: () => void;
  onSwitchUser: () => void;
}

export default function LockScreen({ username, onUnlock, onSwitchUser }: LockScreenProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const user = await getUserByCredentials(username, password);
      if (user) {
        setPassword('');
        onUnlock();
      } else {
        setError(t('lockScreen.wrongPassword'));
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError(t('lockScreen.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
    }}>
      <div style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: 'var(--radius-lg, 20px)',
        padding: '40px 36px',
        width: 360,
        textAlign: 'center',
      }}>
        {/* Kilit ikonu */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--color-bg-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <Lock size={28} style={{ color: 'var(--color-accent)' }} />
        </div>

        {/* Kullanıcı adı */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginBottom: 8,
        }}>
          <User size={16} style={{ opacity: 0.5 }} />
          <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>{username}</span>
        </div>

        <p style={{
          fontSize: '0.82rem',
          color: 'var(--color-text-muted)',
          marginBottom: 24,
        }}>
          {t('lockScreen.message')}
        </p>

        <form onSubmit={handleUnlock}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('lockScreen.passwordPlaceholder')}
            autoComplete="current-password"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm, 8px)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)',
              fontSize: '0.88rem',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 12,
            }}
          />

          {error && (
            <div style={{
              color: 'var(--color-danger)',
              fontSize: '0.8rem',
              marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 12, padding: '10px 0' }}
          >
            {loading ? (
              <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
            ) : (
              t('lockScreen.unlock')
            )}
          </button>
        </form>

        <button
          onClick={onSwitchUser}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: '0.78rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            margin: '0 auto',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm, 8px)',
          }}
        >
          <LogOut size={14} />
          {t('lockScreen.switchUser')}
        </button>
      </div>
    </div>
  );
}

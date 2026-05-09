/**
 * ArchivistPro — Kullanıcı Profil Paneli
 *
 * Her kullanıcı kendi profilini düzenleyebilir: görünen ad, şifre, avatar.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Camera, Trash2, ChevronDown, ChevronUp, Shield, Eye, Save } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getUserById, updateUser } from '../services/userService';
import type { UserInfo } from '../services/userService';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Avatar'ı 128x128 JPEG olarak resize eder. */
function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getInitials(displayName: string | null, username: string): string {
  const name = displayName || username;
  return name.slice(0, 2).toUpperCase();
}

export default function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { t } = useTranslation();
  const currentUserId = useStore((s) => s.currentUserId);
  const currentRole = useStore((s) => s.currentRole);

  const [user, setUser] = useState<UserInfo | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && currentUserId) {
      const u = getUserById(currentUserId);
      if (u) {
        setUser(u);
        setDisplayName(u.displayName || '');
        setAvatar(u.avatar);
        setAvatarChanged(false);
        setShowPasswordSection(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setError('');
      }
    }
  }, [isOpen, currentUserId]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('profile.error.imageOnly'));
      return;
    }
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
    if (file.size > MAX_FILE_SIZE) {
      setError(t('profile.error.fileTooLarge', { size: (file.size / 1024 / 1024).toFixed(1) }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setError('');
    setPendingFile(file); // State değişir → React spinner render eder → useEffect resize başlatır
  };

  // pendingFile varken resize yap — React önce spinner'ı render etmiş olur (commit sonrası effect)
  useEffect(() => {
    if (!pendingFile) return;
    let cancelled = false;
    const t0 = Date.now();
    const MIN_MS = 600; // spinner en az 600ms görünür kalsın

    resizeImage(pendingFile, 128)
      .then(base64 => {
        if (cancelled) return;
        // Minimum süre dolmadıysa bekle
        const wait = Math.max(0, MIN_MS - (Date.now() - t0));
        return new Promise<string>(res => setTimeout(() => res(base64), wait));
      })
      .then(base64 => {
        if (cancelled || !base64) return;
        setAvatar(base64);
        setAvatarChanged(true);
      })
      .catch(() => {
        if (!cancelled) setError(t('profile.error.uploadFailed'));
      })
      .finally(() => {
        if (!cancelled) {
          setPendingFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      });
    return () => { cancelled = true; };
  }, [pendingFile]);

  const handleRemoveAvatar = () => {
    setAvatar(null);
    setAvatarChanged(true);
  };

  const handleSave = async () => {
    if (!currentUserId || !user) return;
    setError('');
    setSaving(true);

    try {
      const updates: Record<string, unknown> = {};

      // Görünen ad
      if (displayName.trim() !== (user.displayName || '')) {
        updates.displayName = displayName.trim() || null;
      }

      // Avatar
      if (avatarChanged) {
        updates.avatar = avatar;
      }

      // Şifre değiştirme
      if (showPasswordSection && newPassword) {
        if (!currentPassword) {
          setError(t('profile.error.currentPasswordRequired'));
          setSaving(false);
          return;
        }
        if (newPassword.length < 3) {
          setError(t('profile.error.newPasswordTooShort'));
          setSaving(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setError(t('profile.error.passwordMismatch'));
          setSaving(false);
          return;
        }
        // Mevcut şifre doğrulama
        const { getUserByCredentials } = await import('../services/userService');
        const verified = await getUserByCredentials(user.username, currentPassword);
        if (!verified) {
          setError(t('profile.error.wrongPassword'));
          setSaving(false);
          return;
        }
        updates.password = newPassword;
      }

      if (Object.keys(updates).length === 0) {
        onClose();
        setSaving(false);
        return;
      }

      const result = await updateUser(currentUserId, updates as any);
      if (result.success) {
        // Store'daki kullanıcı adını güncelle
        if (updates.displayName !== undefined) {
          useStore.getState().addToast(t('profile.success.updated'), 'success');
        } else if (updates.password) {
          useStore.getState().addToast(t('profile.success.passwordChanged'), 'success');
        } else {
          useStore.getState().addToast(t('profile.success.updated'), 'success');
        }
        onClose();
      } else {
        setError(result.error || t('profile.error.updateFailed'));
      }
    } catch (err) {
      setError(t('profile.error.saveFailed'));
    }
    setSaving(false);
  };

  if (!isOpen || !user) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', fontSize: '0.8rem', borderRadius: 8,
    border: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.04)',
    color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="userprofile-modal-title" style={{ width: 420, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
          <h2 id="userprofile-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('modals.userProfile')}</h2>
          <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Avatar */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%', overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.4rem', fontWeight: 700, color: '#fff',
              border: '3px solid var(--color-border)',
              position: 'relative',
            }}>
              {!!pendingFile ? (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.55)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    border: '3px solid rgba(255,255,255,0.25)',
                    borderTopColor: '#fff',
                    animation: 'spin 0.75s linear infinite',
                  }} />
                  <span style={{ fontSize: '0.5rem', color: '#fff', fontWeight: 600, letterSpacing: '0.03em' }}>{t('profile.avatar.uploading').toUpperCase()}</span>
                </div>
              ) : avatar ? (
                <img src={avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                getInitials(displayName || user.displayName, user.username)
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}
                disabled={!!pendingFile}
                style={{ padding: '4px 12px', fontSize: '0.72rem', gap: 4, opacity: !!pendingFile ? 0.5 : 1 }}>
                <Camera size={13} /> {!!pendingFile ? t('profile.avatar.uploading') : t('profile.button.uploadPhoto')}
              </button>
              {avatar && (
                <button className="btn btn-ghost" onClick={handleRemoveAvatar}
                  style={{ padding: '4px 12px', fontSize: '0.72rem', gap: 4, color: 'var(--color-danger)' }}>
                  <Trash2 size={13} /> {t('profile.button.removeAvatar')}
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            </div>
            <div style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)' }}>
              {t('profile.avatar.hint')}
            </div>
          </div>

          {/* Bilgiler */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.displayName')}</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('profile.placeholder.displayName')} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.username')}</label>
              <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                {user.username}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.role')}</label>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6, fontSize: '0.74rem', fontWeight: 600,
                background: currentRole === 'admin' ? 'rgba(99,102,241,0.1)' : 'rgba(168,85,247,0.1)',
                color: currentRole === 'admin' ? '#818cf8' : '#c084fc',
              }}>
                {currentRole === 'admin' ? <Shield size={12} /> : <Eye size={12} />}
                {currentRole === 'admin' ? t('common.role.admin') : t('common.role.viewer')}
              </div>
            </div>
          </div>

          {/* Şifre Değiştir */}
          <div>
            <button onClick={() => setShowPasswordSection(!showPasswordSection)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
                fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-primary)',
              }}>
              {showPasswordSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {t('profile.button.changePassword')}
            </button>
            {showPasswordSection && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.currentPassword')}</label>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.newPassword')}</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('profile.label.confirmPassword')}</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
                </div>
              </div>
            )}
          </div>

          {/* Hata */}
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: '0.74rem', color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '8px 20px', fontSize: '0.78rem' }}>
            {t('common.button.cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', fontSize: '0.78rem', gap: 6 }}>
            <Save size={14} />
            {saving ? t('common.button.saving') : t('common.button.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

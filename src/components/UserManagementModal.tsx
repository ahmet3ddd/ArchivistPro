/**
 * ArchivistPro — Kullanıcı Yönetim Paneli (Admin)
 *
 * Tam CRUD: kullanıcı listesi, ekleme, silme, rol değiştirme, şifre sıfırlama.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, Trash2, KeyRound, Users, ImageOff, Ban, Unlock, Code2, Upload } from 'lucide-react';
import UserBatchImport from './UserBatchImport';
import { useStore } from '../store/useStore';
import { useIsAdmin } from '../permissions';
import {
  getAllUsers, createUser, updateUser, deleteUser, getAdminCount,
  type UserInfo, type CreateUserInput,
} from '../services/userService';
import { notifySuccess, notifyError, notifyWarning } from '../services/notificationCenter';
import ModalErrorBoundary from './ModalErrorBoundary';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function getInitials(displayName: string | null, username: string): string {
  const name = displayName || username;
  return name.slice(0, 2).toUpperCase();
}

export default function UserManagementModal({ isOpen, onClose }: UserManagementModalProps) {
  const { t, i18n } = useTranslation();
  const isAdmin = useIsAdmin();
  const currentUserId = useStore((s) => s.currentUserId);
  const currentUser = useStore((s) => s.currentUser);

  const [users, setUsers] = useState<UserInfo[]>([]);
  const currentIsFounder = users.find(u => u.id === currentUserId)?.isFounder ?? false;
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer');
  const [newIsDeveloper, setNewIsDeveloper] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const loadUsers = useCallback(() => {
    setUsers(getAllUsers());
  }, []);

  useEffect(() => {
    if (isOpen && isAdmin) loadUsers();
  }, [isOpen, isAdmin, loadUsers]);

  /* ── Kullanıcı Ekleme ── */

  const handleAddUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      notifyWarning(t('userMgmt.error.usernamePasswordRequired'));
      return;
    }
    const input: CreateUserInput = {
      username: newUsername.trim(),
      password: newPassword,
      role: newRole,
      displayName: newDisplayName.trim() || undefined,
      isDeveloper: newIsDeveloper,
    };
    const result = await createUser(input);
    if (result.success) {
      notifySuccess(t('userMgmt.success.userCreated'), `${input.username} (${input.role})`);
      setNewUsername(''); setNewPassword(''); setNewDisplayName(''); setNewRole('viewer'); setNewIsDeveloper(false);
      setShowAddForm(false);
      loadUsers();
    } else {
      notifyError(t('userMgmt.error.createFailed'), result.error || '');
    }
  };

  /* ── Rol Değiştirme ── */

  const handleRoleChange = async (user: UserInfo, newRole: 'admin' | 'viewer') => {
    if (newRole === user.role) return;

    // Son admin koruması
    if (user.role === 'admin' && newRole === 'viewer') {
      const adminCount = getAdminCount();
      if (adminCount <= 1) {
        notifyWarning(t('userMgmt.error.lastAdmin'));
        return;
      }
    }

    const result = await updateUser(user.id, { role: newRole });
    if (result.success) {
      notifySuccess(t('userMgmt.success.roleChanged'), `${user.username} → ${newRole === 'admin' ? t('common.role.admin') : t('common.role.viewer')}`);
      loadUsers();
      // Kendi rolünü değiştirdiyse store'u güncelle
      if (user.id === currentUserId) {
        useStore.getState().setCurrentUser(user.username, newRole, user.id);
        import('../permissions/roles').then(m => m.setRuntimeRole(newRole));
      }
    } else {
      notifyError(t('userMgmt.error.roleChangeFailed'), result.error || '');
    }
  };

  /* ── Şifre Sıfırlama ── */

  const handleResetPassword = async (userId: number) => {
    if (!resetPasswordValue.trim() || resetPasswordValue.length < 3) {
      notifyWarning(t('userMgmt.error.passwordTooShort'));
      return;
    }
    const result = await updateUser(userId, { password: resetPasswordValue });
    if (result.success) {
      notifySuccess(t('userMgmt.success.passwordReset'), t('userMgmt.success.passwordResetDetail'));
      setResetPasswordId(null);
      setResetPasswordValue('');
    } else {
      notifyError(t('userMgmt.error.passwordResetFailed'), result.error || '');
    }
  };

  /* ── Kullanıcı Silme ── */

  const handleDeleteUser = (user: UserInfo) => {
    if (user.id === currentUserId) {
      notifyWarning(t('userMgmt.error.cannotDeleteSelf'));
      return;
    }
    if (user.role === 'admin' && getAdminCount() <= 1) {
      notifyWarning(t('userMgmt.error.cannotDeleteLastAdmin'));
      return;
    }
    useStore.getState().showConfirmDialog(
      t('userMgmt.delete.confirm', { name: user.displayName || user.username }),
      t('userMgmt.delete.confirmDetail'),
      () => {
        const result = deleteUser(user.id);
        if (result.success) {
          notifySuccess(t('userMgmt.success.userDeleted'), user.username);
          loadUsers();
        } else {
          notifyError(t('userMgmt.error.deleteFailed'), result.error || '');
        }
      },
    );
  };

  /* ── Geliştirici Bayrağı Toggle ── */

  const handleToggleDeveloper = async (user: UserInfo) => {
    const newDev = !user.isDeveloper;
    const result = await updateUser(user.id, { isDeveloper: newDev });
    if (result.success) {
      notifySuccess(
        newDev ? t('userMgmt.success.developerEnabled') : t('userMgmt.success.developerDisabled'),
        user.displayName || user.username
      );
      loadUsers();
    }
  };

  /* ── Avatar Silme ── */

  const handleRemoveAvatar = async (user: UserInfo) => {
    const result = await updateUser(user.id, { avatar: null });
    if (result.success) {
      notifySuccess(t('userMgmt.success.avatarRemoved'), user.username);
      loadUsers();
    }
  };

  const handleToggleBlock = async (user: UserInfo) => {
    const newBlocked = !user.isBlocked;
    const result = await updateUser(user.id, { isBlocked: newBlocked });
    if (result.success) {
      notifySuccess(
        newBlocked ? t('userMgmt.success.userBlocked') : t('userMgmt.success.userUnblocked'),
        user.displayName || user.username
      );
      // Engellenen kullanıcıya otomatik bildirim mesajı gönder
      if (newBlocked) {
        import('../services/messageService').then(({ sendMessage }) => {
          sendMessage(
            currentUser || 'admin',
            'admin',
            'private',
            'important',
            t('userMgmt.blockNotification.body'),
            t('userMgmt.blockNotification.subject'),
            user.username,  // recipient
          );
        });
      }
      loadUsers();
    }
  };

  if (!isOpen || !isAdmin) return null;

  const optionStyle: React.CSSProperties = {
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
  };

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
    borderRadius: 6, padding: '4px 8px', fontSize: '0.72rem',
    color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', fontSize: '0.76rem', borderRadius: 6,
    border: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.04)',
    color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <ModalErrorBoundary onClose={onClose}>
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="usermgmt-modal-title" style={{ width: 720, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} style={{ color: 'var(--color-accent)' }} />
            <h2 id="usermgmt-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('modals.userManagement')}</h2>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 8 }}>
              {t('userMgmt.header.userCount', { count: users.length })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setShowAddForm(!showAddForm); setShowBatchImport(false); }} className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: '0.72rem', gap: 4, color: showAddForm ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
              <UserPlus size={14} /> {t('userMgmt.button.newUser')}
            </button>
            <button onClick={() => { setShowBatchImport(!showBatchImport); setShowAddForm(false); }} className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: '0.72rem', gap: 4, color: showBatchImport ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
              <Upload size={14} /> {t('userBatch.title')}
            </button>
            <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Yeni Kullanıcı Formu */}
        {showAddForm && (
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--color-border)',
            display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
            background: 'rgba(99,102,241,0.03)',
          }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: '0.66rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 3 }}>{t('userMgmt.form.usernameLabel')}</label>
              <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t('userMgmt.form.usernamePlaceholder')} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: '0.66rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 3 }}>{t('userMgmt.form.passwordLabel')}</label>
              <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('userMgmt.form.passwordPlaceholder')} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: '0.66rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 3 }}>{t('userMgmt.form.displayNameLabel')}</label>
              <input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder={t('userMgmt.form.displayNamePlaceholder')} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ minWidth: 100 }}>
              <label style={{ display: 'block', fontSize: '0.66rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 3 }}>{t('userMgmt.form.roleLabel')}</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'viewer')} style={selectStyle}>
                <option value="viewer" style={optionStyle}>{t('common.role.viewer')}</option>
                {currentIsFounder && <option value="admin" style={optionStyle}>{t('common.role.admin')}</option>}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.72rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', paddingBottom: 2 }}>
              <input type="checkbox" checked={newIsDeveloper} onChange={(e) => setNewIsDeveloper(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              <Code2 size={12} /> {t('userMgmt.form.developerLabel')}
            </label>
            <button onClick={handleAddUser} className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.74rem', gap: 4 }}>
              <UserPlus size={13} /> {t('userMgmt.button.add')}
            </button>
          </div>
        )}

        {/* CSV Toplu İçe Aktarma */}
        {showBatchImport && (
          <div style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(99,102,241,0.03)' }}>
            <UserBatchImport onDone={loadUsers} onClose={() => setShowBatchImport(false)} />
          </div>
        )}

        {/* Kullanıcı Tablosu */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {users.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
              {t('userMgmt.table.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 600, width: 44 }}></th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>{t('userMgmt.col.username')}</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>{t('userMgmt.col.displayName')}</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, width: 110 }}>{t('userMgmt.col.role')}</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600 }}>{t('userMgmt.col.createdAt')}</th>
                  <th style={{ padding: '10px 8px', fontWeight: 600, width: 160 }}>{t('userMgmt.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {/* Avatar */}
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', overflow: 'hidden',
                          background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.7rem', fontWeight: 700, color: '#fff',
                        }}>
                          {u.avatar
                            ? <img src={u.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : getInitials(u.displayName, u.username)
                          }
                        </div>
                      </td>
                      {/* Username */}
                      <td style={{ padding: '8px 8px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {u.username}
                        {u.isFounder && <span style={{ fontSize: '0.58rem', color: '#f59e0b', marginLeft: 4, fontWeight: 700 }}>{t('userMgmt.badge.founder')}</span>}
                        {isSelf && <span style={{ fontSize: '0.62rem', color: 'var(--color-accent)', marginLeft: 4 }}>{t('userMgmt.badge.you')}</span>}
                        {u.isDeveloper && <span style={{ fontSize: '0.58rem', color: '#22d3ee', marginLeft: 4, fontWeight: 600 }}>{t('userMgmt.badge.developer')}</span>}
                        {u.isBlocked && <span style={{ fontSize: '0.58rem', color: '#f59e0b', marginLeft: 4, fontWeight: 600 }}>{t('userMgmt.badge.blocked')}</span>}
                      </td>
                      {/* Display Name */}
                      <td style={{ padding: '8px 8px', color: 'var(--color-text-secondary)' }}>
                        {u.displayName || '-'}
                      </td>
                      {/* Rol */}
                      <td style={{ padding: '8px 8px' }}>
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'viewer')}
                          disabled={!isSelf && u.role === 'admin' && !currentIsFounder}
                          title={!isSelf && u.role === 'admin' && !currentIsFounder ? t('userMgmt.error.notFounder') : undefined}
                          style={{
                            ...selectStyle,
                            color: u.role === 'admin' ? '#818cf8' : '#c084fc',
                            fontWeight: 600,
                            opacity: (!isSelf && u.role === 'admin' && !currentIsFounder) ? 0.5 : 1,
                            cursor: (!isSelf && u.role === 'admin' && !currentIsFounder) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {currentIsFounder || u.role === 'admin' ? <option value="admin" style={optionStyle}>{t('common.role.admin')}</option> : null}
                          <option value="viewer" style={optionStyle}>{t('common.role.viewer')}</option>
                        </select>
                      </td>
                      {/* Tarih */}
                      <td style={{ padding: '8px 8px', color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString(i18n.language === 'tr' ? 'tr-TR' : 'en-US') : '-'}
                      </td>
                      {/* İşlemler */}
                      <td style={{ padding: '8px 8px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {/* Şifre sıfırla */}
                          {resetPasswordId === u.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input
                                type="text"
                                value={resetPasswordValue}
                                onChange={(e) => setResetPasswordValue(e.target.value)}
                                placeholder={t('userMgmt.form.newPasswordPlaceholder')}
                                style={{ ...inputStyle, width: 80, fontSize: '0.68rem', padding: '3px 6px' }}
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword(u.id); if (e.key === 'Escape') { setResetPasswordId(null); setResetPasswordValue(''); } }}
                              />
                              <button onClick={() => handleResetPassword(u.id)} className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: '0.64rem', color: 'var(--color-accent)' }}>
                                {t('common.button.save')}
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => { setResetPasswordId(u.id); setResetPasswordValue(''); }}
                              className="btn btn-ghost" title={t('userMgmt.tooltip.resetPassword')}
                              style={{ padding: '3px 6px', color: 'var(--color-text-muted)' }}>
                              <KeyRound size={13} />
                            </button>
                          )}
                          {/* Avatar sil */}
                          {u.avatar && (
                            <button onClick={() => handleRemoveAvatar(u)} className="btn btn-ghost" title={t('userMgmt.tooltip.removeAvatar')}
                              style={{ padding: '3px 6px', color: 'var(--color-text-muted)' }}>
                              <ImageOff size={13} />
                            </button>
                          )}
                          {/* Geliştirici toggle */}
                          {!isSelf && (
                            <button onClick={() => handleToggleDeveloper(u)} className="btn btn-ghost"
                              title={t('userMgmt.tooltip.toggleDeveloper')}
                              style={{ padding: '3px 6px', color: u.isDeveloper ? '#22d3ee' : 'var(--color-text-muted)' }}>
                              <Code2 size={13} />
                            </button>
                          )}
                          {/* Ana arşiv erişimini engelle/aç */}
                          {!isSelf && u.role !== 'admin' && (
                            <button onClick={() => handleToggleBlock(u)} className="btn btn-ghost"
                              title={u.isBlocked ? t('userMgmt.tooltip.unblockUser') : t('userMgmt.tooltip.blockUser')}
                              style={{ padding: '3px 6px', color: u.isBlocked ? 'var(--color-success)' : '#f59e0b' }}>
                              {u.isBlocked ? <Unlock size={13} /> : <Ban size={13} />}
                            </button>
                          )}
                          {/* Kullanıcı sil — admin satırları sadece kurucu silebilir */}
                          {!isSelf && (u.role !== 'admin' || currentIsFounder) && (
                            <button onClick={() => handleDeleteUser(u)} className="btn btn-ghost" title={t('userMgmt.tooltip.deleteUser')}
                              style={{ padding: '3px 6px', color: 'var(--color-danger)' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </ModalErrorBoundary>
  );
}

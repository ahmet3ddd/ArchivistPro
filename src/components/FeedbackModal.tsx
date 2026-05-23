/**
 * ArchivistPro — Mesaj / Geri Bildirim Paneli
 *
 * Viewer: mesaj gönderme + gönderilenleri görme + kendi mesajını silme
 * Admin: inbox, filtre, yanıt, durum yönetimi
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MessageSquare, Send, Lightbulb, Lock, AlertTriangle, CheckCircle, Trash2, Reply, Filter, ChevronDown, ChevronUp, Inbox, ArrowUpRight, Square, CheckSquare, Clipboard, UserCheck, UserX, Megaphone } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useIsAdmin } from '../permissions';
import { useStore } from '../store/useStore';
import { notifyWarning } from '../services/notificationCenter';
import { getAllUsers, type UserInfo } from '../services/userService';
import ModalErrorBoundary from './ModalErrorBoundary';
import {
  sendMessage, sendBroadcast, replyToMessage, getMessagesForUser, getAllMessages,
  getThread, getUnreadCount, markAsResolved, deleteMessage, deleteOwnMessage,
  getUniqueSenders, markRepliesAsReadForUser, markThreadAsRead, canSendMessage,
  claimRequest, releaseRequest,
  type UserMessage, type MessageType, type MessagePriority, type MessageStatus, type MessageFilters,
} from '../services/messageService';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const focusTrapRef = useFocusTrap(isOpen, onClose);
  const isAdmin = useIsAdmin();
  const currentUser = useStore((s) => s.currentUser);

  if (!isOpen) return null;

  return (
    <ModalErrorBoundary onClose={onClose}>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={focusTrapRef} className="glass-card animate-fade-in" role="dialog" aria-modal="true"
        style={{ width: 'min(92vw, 640px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isAdmin
          ? <AdminInbox currentUser={currentUser || 'admin'} onClose={onClose} />
          : <ViewerPanel currentUser={currentUser || 'viewer'} onClose={onClose} />
        }
      </div>
    </div>
    </ModalErrorBoundary>
  );
}

/* ══════════════════════════════════════════════════════════════
   SHARED COMPOSE FORM (DRY — viewer + admin ortak kullanır)
   ══════════════════════════════════════════════════════════════ */

interface ComposeFormProps {
  allUsers: UserInfo[];
  onSend: (data: { recipient: string; type: MessageType; priority: MessagePriority; body: string; subject: string }) => void;
  compact?: boolean;
}

function ComposeForm({ allUsers, onSend, compact }: ComposeFormProps) {
  const { t } = useTranslation();
  const [msgType, setMsgType] = useState<MessageType>('suggestion');
  const [priority, setPriority] = useState<MessagePriority>('normal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');

  const isRequest = msgType === 'request';

  const handleSend = () => {
    if (!isRequest && !selectedRecipient) return;
    if (!body.trim()) return;
    onSend({ recipient: isRequest ? '' : selectedRecipient, type: msgType, priority, body: body.trim(), subject: subject.trim() });
    setBody(''); setSubject(''); setPriority('normal'); setMsgType('suggestion'); setSelectedRecipient('');
  };

  const rows = compact ? 3 : 5;
  const minH = compact ? 80 : 120;
  const gap = compact ? 10 : 14;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {/* Tip + Öncelik — üstte; request seçince alıcı gizlenir */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('feedback.label.messageType')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <TypeButton active={msgType === 'suggestion'} onClick={() => setMsgType('suggestion')} icon={<Lightbulb size={14} />} label={t('feedback.type.suggestion')} color="#f59e0b" />
            <TypeButton active={msgType === 'private'} onClick={() => setMsgType('private')} icon={<Lock size={14} />} label={t('feedback.type.private')} color="#a855f7" />
            <TypeButton active={msgType === 'request'} onClick={() => setMsgType('request')} icon={<Clipboard size={14} />} label={t('feedback.type.request')} color="#10b981" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('feedback.label.priority')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <TypeButton active={priority === 'normal'} onClick={() => setPriority('normal')} icon={<CheckCircle size={14} />} label={t('feedback.priority.normal')} color="#10b981" />
            <TypeButton active={priority === 'important'} onClick={() => setPriority('important')} icon={<AlertTriangle size={14} />} label={t('feedback.priority.important')} color="#ef4444" />
          </div>
        </div>
      </div>
      {/* Alıcı — request seçilince "Tüm yöneticiler" yer tutar, alıcı seçimi gizlenir */}
      {isRequest ? (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: '0.76rem', color: '#10b981' }}>
          {t('feedback.request.allAdminsNote')}
        </div>
      ) : (
        <div>
          <label style={labelStyle}>{t('feedback.label.recipient')}</label>
          <select value={selectedRecipient} onChange={(e) => setSelectedRecipient(e.target.value)} style={{ width: '100%', ...selectStyle }}>
            <option value="">{t('feedback.placeholder.selectRecipient')}</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.username}>
                {u.displayName || u.username} ({u.role === 'admin' ? t('common.role.admin') : t('common.role.viewer')}{u.isDeveloper ? ` · ${t('userMgmt.badge.developer')}` : ''})
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Konu */}
      <div>
        <label style={labelStyle}>{t('feedback.label.subject')}</label>
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('feedback.placeholder.subject')} style={inputStyle} />
      </div>
      {/* Mesaj */}
      <div>
        <label style={labelStyle}>{t('feedback.label.message')}</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('feedback.placeholder.body')} rows={rows}
          style={{ ...inputStyle, minHeight: minH, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>
      {/* Gönder */}
      <button className="btn btn-primary" onClick={handleSend} disabled={!body.trim() || (!isRequest && !selectedRecipient)} style={{ alignSelf: 'flex-end', padding: '8px 24px', gap: 6 }}>
        <Send size={14} />
        {t('feedback.button.send')}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   VIEWER PANEL
   ══════════════════════════════════════════════════════════════ */

type ViewerTab = 'compose' | 'inbox' | 'sent';

function ViewerPanel({ currentUser, onClose }: { currentUser: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ViewerTab>('inbox');
  const [messages, setMessages] = useState<UserMessage[]>([]);
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const loadMessages = useCallback(() => {
    setMessages(getMessagesForUser(currentUser));
  }, [currentUser]);

  const inboxMessages = messages.filter(m => !m.parentId && m.sender !== currentUser);
  const sentMessages = messages.filter(m => !m.parentId && m.sender === currentUser);
  const currentList = activeTab === 'inbox' ? inboxMessages : sentMessages;

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === currentList.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(currentList.map(m => m.id)));
  };

  useEffect(() => {
    setAllUsers(getAllUsers().filter(u => u.username !== currentUser));
  }, [currentUser]);

  useEffect(() => {
    markRepliesAsReadForUser(currentUser);
    useStore.getState().setUnreadMessageCount(getUnreadCount(currentUser));
    loadMessages();
    const interval = setInterval(() => {
      loadMessages();
      const unread = getUnreadCount(currentUser);
      if (unread > 0) {
        markRepliesAsReadForUser(currentUser);
      }
      useStore.getState().setUnreadMessageCount(getUnreadCount(currentUser));
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadMessages, currentUser]);

  const handleSend = (data: { recipient: string; type: MessageType; priority: MessagePriority; body: string; subject: string }) => {
    const limitInfo = canSendMessage(currentUser);
    if (!limitInfo.allowed) {
      notifyWarning(t('feedback.error.dailyLimit', { limit: limitInfo.limit }));
      return;
    }
    sendMessage(currentUser, 'viewer', data.type, data.priority, data.body, data.subject || undefined, data.recipient || undefined);
    useStore.getState().addToast(t('feedback.success.sent', { remaining: limitInfo.remaining - 1 }), 'success');
    setActiveTab('sent');
    loadMessages();
  };

  const handleViewerReply = (parentId: number) => {
    const text = replyTexts[parentId] || '';
    if (!text.trim()) return;
    const limitInfo = canSendMessage(currentUser);
    if (!limitInfo.allowed) {
      notifyWarning(t('feedback.error.dailyLimit', { limit: limitInfo.limit }));
      return;
    }
    replyToMessage(parentId, currentUser, 'viewer', text.trim());
    setReplyTexts(prev => { const next = { ...prev }; delete next[parentId]; return next; });
    useStore.getState().addToast(t('feedback.reply.success'), 'success');
    loadMessages();
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    useStore.getState().showConfirmDialog(
      t('feedback.delete.confirm'),
      t('feedback.delete.confirmDetail', { count: selectedIds.size }),
      () => {
        for (const id of selectedIds) deleteOwnMessage(id, currentUser);
        setSelectedIds(new Set());
        setExpandedId(null);
        loadMessages();
      },
    );
  };

  const switchTab = (tab: ViewerTab) => { setActiveTab(tab); setSelectedIds(new Set()); setExpandedId(null); };

  const tabStyle = (tab: ViewerTab): React.CSSProperties => ({
    padding: '8px 16px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 8,
    background: activeTab === tab ? 'rgba(99,102,241,0.12)' : 'transparent',
    color: activeTab === tab ? '#818cf8' : 'var(--color-text-muted)',
  });

  return (
    <>
      {/* Header */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          <MessageSquare size={18} style={{ color: 'var(--color-accent)' }} />
          {t('modals.feedback')}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {selectedIds.size > 0 && (
            <button className="btn btn-ghost" onClick={handleDeleteSelected} style={{ fontSize: '0.72rem', gap: 4, color: '#ef4444' }}>
              <Trash2 size={13} />
              {t('feedback.button.deleteSelected', { count: selectedIds.size })}
            </button>
          )}
          <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <button style={tabStyle('inbox')} onClick={() => switchTab('inbox')}>
          <Inbox size={13} style={{ marginRight: 4 }} /> {t('feedback.tab.inbox')}
          {inboxMessages.length > 0 && (
            <span style={{ marginLeft: 6, background: '#6366f1', color: '#fff', borderRadius: 8, padding: '0px 5px', fontSize: '0.62rem' }}>
              {inboxMessages.length}
            </span>
          )}
        </button>
        <button style={tabStyle('sent')} onClick={() => switchTab('sent')}>
          <ArrowUpRight size={13} style={{ marginRight: 4 }} /> {t('feedback.tab.sent', { count: sentMessages.length })}
        </button>
        <button style={tabStyle('compose')} onClick={() => switchTab('compose')}>
          <Send size={13} style={{ marginRight: 4 }} /> {t('feedback.tab.compose')}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {activeTab === 'compose' && (
          <ComposeForm allUsers={allUsers} onSend={handleSend} />
        )}

        {(activeTab === 'inbox' || activeTab === 'sent') && (
          <div>
            {currentList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                {activeTab === 'inbox'
                  ? <Inbox size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
                  : <ArrowUpRight size={32} style={{ opacity: 0.2, marginBottom: 8 }} />}
                <div>{activeTab === 'inbox' ? t('feedback.inbox.empty') : t('feedback.sent.empty')}</div>
              </div>
            ) : (
              <>
                {/* Tümünü seç */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {selectedIds.size === currentList.length ? <CheckSquare size={14} style={{ color: '#818cf8' }} /> : <Square size={14} />}
                    <span>{t('feedback.button.selectAll')}</span>
                  </button>
                </div>
                {currentList.map(root => {
                  const replies = messages.filter(m => m.parentId === root.id);
                  const isSelected = selectedIds.has(root.id);
                  return (
                    <div key={root.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button onClick={() => toggleSelect(root.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 0 0', alignSelf: 'flex-start', color: isSelected ? '#818cf8' : 'var(--color-text-muted)', flexShrink: 0 }}>
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <MessageCard message={root} replies={replies} showSender={activeTab === 'inbox'} showRecipient={activeTab === 'sent'} onToggle={() => setExpandedId(expandedId === root.id ? null : root.id)} expanded={expandedId === root.id} showAssignment={activeTab === 'sent' && root.messageType === 'request'} />
                        {expandedId === root.id && activeTab === 'inbox' && (
                          <div style={{ marginLeft: 16, paddingLeft: 12, borderLeft: '2px solid var(--color-border)', marginBottom: 8 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <textarea value={replyTexts[root.id] || ''} onChange={(e) => setReplyTexts(prev => ({ ...prev, [root.id]: e.target.value }))} placeholder={t('feedback.placeholder.reply')} rows={2}
                                style={{ ...inputStyle, flex: 1, minHeight: 60, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.76rem' }} />
                              <button className="btn btn-primary" onClick={() => handleViewerReply(root.id)} disabled={!(replyTexts[root.id] || '').trim()} style={{ alignSelf: 'flex-end', padding: '8px 14px' }}>
                                <Reply size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADMIN INBOX
   ══════════════════════════════════════════════════════════════ */

type AdminTab = 'inbox' | 'sent' | 'broadcast';

function AdminInbox({ currentUser, onClose }: { currentUser: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [adminTab, setAdminTab] = useState<AdminTab>('inbox');
  const [messages, setMessages] = useState<UserMessage[]>([]);
  const [filters, setFilters] = useState<MessageFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [thread, setThread] = useState<UserMessage[]>([]);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [senders, setSenders] = useState<string[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const loadMessages = useCallback(() => {
    setMessages(getAllMessages(filters, currentUser));
    setSenders(getUniqueSenders());
    useStore.getState().setUnreadMessageCount(getUnreadCount(currentUser));
  }, [filters, currentUser]);

  const inboxMessages = messages.filter(m => m.sender !== currentUser);
  const sentMessages = messages.filter(m => m.sender === currentUser);
  const activeMessages = adminTab === 'inbox' ? inboxMessages : sentMessages;

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === activeMessages.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(activeMessages.map(m => m.id)));
  };

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    setAllUsers(getAllUsers().filter(u => u.username !== currentUser));
  }, [currentUser]);

  const handleComposeSend = (data: { recipient: string; type: MessageType; priority: MessagePriority; body: string; subject: string }) => {
    sendMessage(currentUser, 'admin', data.type, data.priority, data.body, data.subject || undefined, data.recipient);
    useStore.getState().addToast(t('feedback.reply.success'), 'success');
    setShowCompose(false);
    setAdminTab('sent');
    loadMessages();
  };

  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setThread([]);
      return;
    }
    setExpandedId(id);
    setThread(getThread(id));
    // Thread'deki tüm mesajları okundu yap
    markThreadAsRead(id, currentUser);
    loadMessages();
  };

  const handleReply = (parentId: number) => {
    const text = replyTexts[parentId] || '';
    if (!text.trim()) return;
    replyToMessage(parentId, currentUser, 'admin', text.trim());
    setReplyTexts(prev => { const next = { ...prev }; delete next[parentId]; return next; });
    setThread(getThread(parentId));
    useStore.getState().addToast(t('feedback.reply.success'), 'success');
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    useStore.getState().showConfirmDialog(
      t('feedback.delete.confirm'),
      t('feedback.delete.confirmDetail', { count: selectedIds.size }),
      () => {
        for (const id of selectedIds) deleteMessage(id);
        setSelectedIds(new Set());
        setExpandedId(null);
        loadMessages();
      },
    );
  };

  const switchAdminTab = (tab: AdminTab) => { setAdminTab(tab); setSelectedIds(new Set()); setExpandedId(null); setThread([]); };

  const unreadCount = inboxMessages.filter(m => m.status === 'unread').length;

  const adminTabStyle = (tab: AdminTab): React.CSSProperties => ({
    padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    border: 'none', borderRadius: 6,
    background: adminTab === tab ? 'rgba(99,102,241,0.12)' : 'transparent',
    color: adminTab === tab ? '#818cf8' : 'var(--color-text-muted)',
  });

  return (
    <>
      {/* Header */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          <MessageSquare size={18} style={{ color: 'var(--color-accent)' }} />
          {t('modals.feedbackAdmin')}
          {unreadCount > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: '0.68rem', fontWeight: 700 }}>
              {t('feedback.badge.newCount', { count: unreadCount })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {selectedIds.size > 0 && (
            <button className="btn btn-ghost" onClick={handleDeleteSelected} style={{ fontSize: '0.72rem', gap: 4, color: '#ef4444' }}>
              <Trash2 size={13} />
              {t('feedback.button.deleteSelected', { count: selectedIds.size })}
            </button>
          )}
          <button onClick={() => setShowCompose(!showCompose)} className="btn btn-ghost" style={{ fontSize: '0.72rem', gap: 4 }}>
            <Send size={13} />
            {t('feedback.button.newMessage')}
          </button>
          {adminTab === 'inbox' && (
            <button onClick={() => setShowFilters(!showFilters)} className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.72rem' }}>
              <Filter size={13} /> {t('feedback.button.filter')}
            </button>
          )}
          <button onClick={onClose} aria-label={t('common.aria.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <button style={adminTabStyle('inbox')} onClick={() => switchAdminTab('inbox')}>
          <Inbox size={13} style={{ marginRight: 4 }} />
          {t('feedback.tab.inbox')}
          {unreadCount > 0 && (
            <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 8, padding: '0px 5px', fontSize: '0.62rem' }}>
              {unreadCount}
            </span>
          )}
        </button>
        <button style={adminTabStyle('sent')} onClick={() => switchAdminTab('sent')}>
          <ArrowUpRight size={13} style={{ marginRight: 4 }} />
          {t('feedback.tab.sent', { count: sentMessages.length })}
        </button>
        <button style={adminTabStyle('broadcast')} onClick={() => switchAdminTab('broadcast')}>
          <Megaphone size={13} style={{ marginRight: 4 }} />
          {t('feedback.tab.broadcast')}
        </button>
      </div>

      {/* Filter bar — only in inbox tab */}
      {adminTab === 'inbox' && showFilters && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.72rem' }}>
          <select value={filters.type || ''} onChange={(e) => setFilters(f => ({ ...f, type: (e.target.value || undefined) as MessageType | undefined }))} style={selectStyle}>
            <option value="">{t('feedback.filter.allTypes')}</option>
            <option value="suggestion">{t('feedback.type.suggestionBadge')}</option>
            <option value="private">{t('feedback.type.private')}</option>
            <option value="request">{t('feedback.type.requestBadge')}</option>
          </select>
          <select value={filters.status || ''} onChange={(e) => setFilters(f => ({ ...f, status: (e.target.value || undefined) as MessageStatus | undefined }))} style={selectStyle}>
            <option value="">{t('feedback.filter.allStatuses')}</option>
            <option value="unread">{t('feedback.status.unread')}</option>
            <option value="read">{t('feedback.status.read')}</option>
            <option value="resolved">{t('feedback.status.resolved')}</option>
          </select>
          <select value={filters.sender || ''} onChange={(e) => setFilters(f => ({ ...f, sender: e.target.value || undefined }))} style={selectStyle}>
            <option value="">{t('feedback.filter.allSenders')}</option>
            {senders.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {/* Compose form */}
      {showCompose && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <ComposeForm allUsers={allUsers} onSend={handleComposeSend} compact />
        </div>
      )}

      {/* Broadcast tab — admin duyuru formu */}
      {adminTab === 'broadcast' && (
        <BroadcastForm currentUser={currentUser} onSent={() => { switchAdminTab('sent'); loadMessages(); }} />
      )}

      {/* Message list */}
      {!showCompose && adminTab !== 'broadcast' && <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {activeMessages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
            {adminTab === 'inbox'
              ? <Inbox size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              : <ArrowUpRight size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
            }
            <div>{adminTab === 'inbox' ? t('feedback.inbox.empty') : t('feedback.sent.empty')}</div>
          </div>
        ) : (
          <>
            {/* Tümünü seç */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {selectedIds.size === activeMessages.length ? <CheckSquare size={14} style={{ color: '#818cf8' }} /> : <Square size={14} />}
                <span>{t('feedback.button.selectAll')}</span>
              </button>
            </div>
            {activeMessages.map(msg => {
              const isSelected = selectedIds.has(msg.id);
              return (
                <div key={msg.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button onClick={() => toggleSelect(msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 0 0', alignSelf: 'flex-start', color: isSelected ? '#818cf8' : 'var(--color-text-muted)', flexShrink: 0 }}>
                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Mesaj kartı */}
                    <div
                      role="button" tabIndex={0}
                      onClick={() => handleExpand(msg.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(msg.id); } }}
                      style={{
                        padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                        border: `1px solid ${msg.status === 'unread' ? 'rgba(99,102,241,0.3)' : 'var(--color-border)'}`,
                        background: msg.status === 'unread' ? 'rgba(99,102,241,0.06)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                            {adminTab === 'sent'
                              ? <>{t('feedback.label.to')} <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{msg.recipient || '—'}</span></>
                              : <>{t('feedback.label.from')} <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{msg.sender}</span></>
                            }
                          </span>
                          <TypeBadge type={msg.messageType} />
                          <PriorityBadge priority={msg.priority} />
                          <StatusBadge status={msg.status} />
                          {msg.messageType === 'request' && <AssignBadge assignedTo={msg.assignedTo} currentUser={currentUser} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>{formatDate(msg.createdAt)}</span>
                          {expandedId === msg.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </div>
                      {msg.subject && <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>{msg.subject}</div>}
                      <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedId === msg.id ? 'normal' : 'nowrap' }}>
                        {msg.body}
                      </div>
                    </div>

                    {/* Genişletilmiş thread + yanıt */}
                    {expandedId === msg.id && (
                      <div style={{ marginLeft: 16, marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--color-border)' }}>
                        {/* Yanıtlar */}
                        {thread.filter(r => r.parentId).map(reply => (
                          <div key={reply.id} style={{
                            padding: '8px 12px', marginBottom: 6, borderRadius: 8, fontSize: '0.74rem',
                            background: reply.senderRole === 'admin' ? 'rgba(99,102,241,0.06)' : 'rgba(168,85,247,0.06)',
                            border: `1px solid ${reply.senderRole === 'admin' ? 'rgba(99,102,241,0.15)' : 'rgba(168,85,247,0.15)'}`,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                              <span style={{ fontWeight: 600, color: reply.senderRole === 'admin' ? '#818cf8' : '#c084fc', fontSize: '0.7rem' }}>
                                {reply.sender} ({reply.senderRole === 'admin' ? t('common.role.admin') : t('common.role.viewer')})
                              </span>
                              <span style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)' }}>{formatDate(reply.createdAt)}</span>
                            </div>
                            <div style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{reply.body}</div>
                          </div>
                        ))}

                        {/* Admin aksiyonları */}
                        {msg.status !== 'resolved' && (
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                            {/* Talep claim/release */}
                            {msg.messageType === 'request' && !msg.assignedTo && (
                              <button className="btn btn-ghost" onClick={() => { claimRequest(msg.id, currentUser); loadMessages(); }} style={{ fontSize: '0.7rem', padding: '4px 10px', gap: 4, color: '#10b981' }}>
                                <UserCheck size={12} /> {t('feedback.button.claim')}
                              </button>
                            )}
                            {msg.messageType === 'request' && msg.assignedTo === currentUser && (
                              <button className="btn btn-ghost" onClick={() => { releaseRequest(msg.id, currentUser); loadMessages(); }} style={{ fontSize: '0.7rem', padding: '4px 10px', gap: 4, color: '#f59e0b' }}>
                                <UserX size={12} /> {t('feedback.button.release')}
                              </button>
                            )}
                            {/* Çözüldü — sadece üstlenen veya talep değilse herkes */}
                            {(msg.messageType !== 'request' || msg.assignedTo === currentUser) && (
                              <button className="btn btn-ghost" onClick={() => { markAsResolved(msg.id); loadMessages(); }} style={{ fontSize: '0.7rem', padding: '4px 10px', gap: 4 }}>
                                <CheckCircle size={12} /> {t('feedback.button.resolve')}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Yanıt yaz */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <textarea value={replyTexts[msg.id] || ''} onChange={(e) => setReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))} placeholder={t('feedback.placeholder.reply')} rows={2}
                            style={{ ...inputStyle, flex: 1, minHeight: 60, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.76rem' }} />
                          <button className="btn btn-primary" onClick={() => handleReply(msg.id)} disabled={!(replyTexts[msg.id] || '').trim()} style={{ alignSelf: 'flex-end', padding: '8px 14px' }}>
                            <Reply size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   SHARED COMPONENTS & HELPERS
   ══════════════════════════════════════════════════════════════ */

function MessageCard({ message, replies, showSender = true, showRecipient = false, showAssignment = false, expanded: controlledExpanded, onToggle }: { message: UserMessage; replies: UserMessage[]; showSender?: boolean; showRecipient?: boolean; showAssignment?: boolean; expanded?: boolean; onToggle?: () => void }) {
  const { t } = useTranslation();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggle = onToggle || (() => setInternalExpanded(!internalExpanded));

  return (
    <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'transparent' }}>
      <div role="button" tabIndex={0} onClick={handleToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }}
        style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem' }}>
            {showSender && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{t('feedback.label.from')} <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{message.sender}</span></span>}
            {showRecipient && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{t('feedback.label.to')} <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{message.recipient || t('feedback.request.allAdminsBadge')}</span></span>}
            <TypeBadge type={message.messageType} />
            <PriorityBadge priority={message.priority} />
            <StatusBadge status={message.status} />
            {showAssignment && <AssignBadge assignedTo={message.assignedTo} currentUser={null} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>{formatDate(message.createdAt)}</span>
            {replies.length > 0 && <span style={{ fontSize: '0.64rem', color: '#818cf8' }}>{t('feedback.replyCount', { count: replies.length })}</span>}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
        {message.subject && <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>{message.subject}</div>}
        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', whiteSpace: expanded ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: expanded ? 'unset' : 'ellipsis' }}>
          {message.body}
        </div>
      </div>

      {expanded && replies.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
          {replies.map(reply => (
            <div key={reply.id} style={{
              padding: '8px 12px', marginBottom: 6, borderRadius: 8, fontSize: '0.74rem',
              background: reply.senderRole === 'admin' ? 'rgba(99,102,241,0.06)' : 'rgba(168,85,247,0.06)',
              border: `1px solid ${reply.senderRole === 'admin' ? 'rgba(99,102,241,0.15)' : 'rgba(168,85,247,0.15)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontWeight: 600, color: reply.senderRole === 'admin' ? '#818cf8' : '#c084fc', fontSize: '0.7rem' }}>
                  {reply.sender} ({reply.senderRole === 'admin' ? t('common.role.admin') : t('common.role.viewer')})
                </span>
                <span style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)' }}>{formatDate(reply.createdAt)}</span>
              </div>
              <div style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{reply.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeButton({ active, onClick, icon, label, color }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color: string }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
      fontSize: '0.76rem', fontWeight: active ? 600 : 400, border: `1px solid ${active ? color + '50' : 'var(--color-border)'}`,
      background: active ? color + '12' : 'transparent', color: active ? color : 'var(--color-text-muted)',
    }}>
      {icon} {label}
    </button>
  );
}

function AssignBadge({ assignedTo, currentUser }: { assignedTo: string | null; currentUser: string | null }) {
  const { t } = useTranslation();
  if (!assignedTo) {
    return (
      <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
        {t('feedback.claim.unclaimed')}
      </span>
    );
  }
  const isMine = currentUser && assignedTo === currentUser;
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
      {isMine ? t('feedback.claim.claimedByYou') : t('feedback.claim.claimedBy', { admin: assignedTo })}
    </span>
  );
}

function TypeBadge({ type }: { type: MessageType }) {
  const { t } = useTranslation();
  const isS = type === 'suggestion';
  const isR = type === 'request';
  if (isR) {
    return (
      <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
        {t('feedback.type.requestBadge')}
      </span>
    );
  }
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4,
      background: isS ? 'rgba(245,158,11,0.12)' : 'rgba(168,85,247,0.12)',
      color: isS ? '#f59e0b' : '#a855f7',
    }}>
      {isS ? t('feedback.type.suggestionBadge') : t('feedback.type.privateBadge')}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: MessagePriority }) {
  const { t } = useTranslation();
  if (priority === 'normal') return null;
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
      {t('feedback.priority.importantBadge')}
    </span>
  );
}

function StatusBadge({ status }: { status: MessageStatus }) {
  const { t } = useTranslation();
  const map: Record<MessageStatus, { label: string; color: string }> = {
    unread: { label: t('feedback.status.unread'), color: '#6366f1' },
    read: { label: t('feedback.status.read'), color: '#8293a7' },
    resolved: { label: t('feedback.status.resolved'), color: '#10b981' },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: s.color + '15', color: s.color }}>
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + 'Z');
    const lang = document.documentElement.lang || navigator.language || 'tr-TR';
    return d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, display: 'block',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: '0.8rem', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'rgba(255,255,255,0.04)', color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  padding: '5px 10px', fontSize: '0.72rem', borderRadius: 6, border: '1px solid var(--color-border)',
  background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
};

/* ══════════════════════════════════════════════════════════════
   BROADCAST FORM — Admin Duyuru Gönderme
   ══════════════════════════════════════════════════════════════ */

function BroadcastForm({ currentUser, onSent }: { currentUser: string; onSent: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important'>('normal');
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      const id = sendBroadcast(currentUser, subject.trim(), body.trim(), priority);
      if (id > 0) {
        useStore.getState().addToast(t('broadcast.sent'), 'success');
        setSubject('');
        setBody('');
        setPriority('normal');
        onSent();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Megaphone size={18} style={{ color: 'var(--color-accent)' }} />
        <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
          {t('broadcast.title')}
        </span>
      </div>

      <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginBottom: 14 }}>
        {t('broadcast.description')}
      </div>

      {/* Öncelik */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: '0.72rem', opacity: 0.6, display: 'block', marginBottom: 4 }}>
          {t('broadcast.priority')}
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setPriority('normal')}
            className={priority === 'normal' ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ padding: '4px 12px', fontSize: '0.74rem' }}
          >
            {t('feedback.priority.normal')}
          </button>
          <button
            onClick={() => setPriority('important')}
            className={priority === 'important' ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ padding: '4px 12px', fontSize: '0.74rem' }}
          >
            {t('feedback.priority.important')}
          </button>
        </div>
      </div>

      {/* Konu */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: '0.72rem', opacity: 0.6, display: 'block', marginBottom: 4 }}>
          {t('broadcast.subject')}
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('broadcast.subjectPlaceholder')}
          style={inputStyle}
        />
      </div>

      {/* Mesaj */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: '0.72rem', opacity: 0.6, display: 'block', marginBottom: 4 }}>
          {t('broadcast.message')}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={t('broadcast.messagePlaceholder')}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
        />
      </div>

      <button
        onClick={handleSend}
        disabled={sending || !subject.trim() || !body.trim()}
        className="btn btn-primary"
        style={{ padding: '8px 20px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Megaphone size={14} />
        {sending ? '...' : t('broadcast.sendButton')}
      </button>
    </div>
  );
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Mock database save — sadece saveMessageDatabase noop, diğer export'lar gerçek
vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return {
    ...actual,
    saveMessageDatabase: vi.fn(),
  };
});

// Mock logger
vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
  debugLog: vi.fn(),
}));

// Mock permissions — default admin
const mockGetAppRole = vi.fn(() => 'admin' as const);
vi.mock('../permissions/roles', () => ({
  getAppRole: () => mockGetAppRole(),
}));

import {
  sendMessage,
  replyToMessage,
  getAllMessages,
  getMessagesForUser,
  getThread,
  getUnreadCount,
  markAsRead,
  markThreadAsRead,
  markAsResolved,
  deleteMessage,
  deleteOwnMessage,
  canSendMessage,
  getDailyMessageCount,
  getUniqueSenders,
  setMessageDb,
} from '../services/messageService';

/** Test kullanıcılarını users tablosuna ekle (validateRecipient için gerekli) */
function insertTestUsers(db: any) {
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['admin1', 'hash', 'admin']
  );
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['viewer1', 'hash', 'viewer']
  );
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['viewer2', 'hash', 'viewer']
  );
}

describe('MessageService — Mesaj Gönderme', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('sendMessage id döner', () => {
    const id = sendMessage('admin1', 'admin', 'suggestion', 'normal', 'Merhaba');
    expect(id).toBeGreaterThan(0);
  });

  it('DB null iken -1 döner', () => {
    setMessageDb(null);
    const id = sendMessage('admin1', 'admin', 'suggestion', 'normal', 'test');
    expect(id).toBe(-1);
  });

  it('geçersiz alıcı -1 döner', () => {
    const id = sendMessage('admin1', 'admin', 'private', 'normal', 'hi', undefined, 'nonexistent');
    expect(id).toBe(-1);
  });

  it('geçerli alıcı ile başarılı', () => {
    const id = sendMessage('admin1', 'admin', 'private', 'normal', 'hello', 'Konu', 'viewer1');
    expect(id).toBeGreaterThan(0);
  });

  it('subject ve priority kaydeder', () => {
    const id = sendMessage('admin1', 'admin', 'suggestion', 'important', 'acil', 'Acil Konu');
    const msgs = getAllMessages();
    const msg = msgs.find(m => m.id === id);
    expect(msg).toBeDefined();
    expect(msg!.subject).toBe('Acil Konu');
    expect(msg!.priority).toBe('important');
  });
});

describe('MessageService — Yanıt', () => {
  let db: any;
  let rootId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
    rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('replyToMessage yanıt oluşturur', () => {
    const replyId = replyToMessage(rootId, 'admin1', 'admin', 'Teşekkürler');
    expect(replyId).toBeGreaterThan(0);
    expect(replyId).not.toBe(rootId);
  });

  it('parent_id bağlar', () => {
    const replyId = replyToMessage(rootId, 'admin1', 'admin', 'Reply body');
    const thread = getThread(rootId);
    const reply = thread.find(m => m.id === replyId);
    expect(reply).toBeDefined();
    expect(reply!.parentId).toBe(rootId);
  });
});

describe('MessageService — Rate Limiting', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('viewer');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('canSendMessage remaining bilgisi döner', () => {
    const result = canSendMessage('viewer1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
    expect(result.limit).toBe(20);
  });

  it('getDailyMessageCount doğru sayı', () => {
    expect(getDailyMessageCount('viewer1')).toBe(0);
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'msg1');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'msg2');
    expect(getDailyMessageCount('viewer1')).toBe(2);
  });
});

describe('MessageService — Sorgular', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
    // Farklı türlerde mesajlar
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri 1');
    sendMessage('admin1', 'admin', 'private', 'normal', 'Özel mesaj', 'Konu', 'viewer1');
    sendMessage('viewer2', 'viewer', 'suggestion', 'important', 'Acil öneri');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('getAllMessages kök mesajları döner', () => {
    const msgs = getAllMessages();
    expect(msgs.length).toBe(3);
    expect(msgs.every(m => m.parentId === null)).toBe(true);
  });

  it('getAllMessages type filtre çalışır', () => {
    const suggestions = getAllMessages({ type: 'suggestion' });
    expect(suggestions.length).toBe(2);
  });

  it('getMessagesForUser kullanıcı mesajlarını döner', () => {
    const msgs = getMessagesForUser('viewer1');
    // viewer1 gönderen + viewer1 alıcı olan mesajlar
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });

  it('getThread kök + yanıtları döner', () => {
    const msgs = getAllMessages();
    const rootId = msgs[0].id;
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    const thread = getThread(rootId);
    expect(thread.length).toBe(2);
  });

  it('getUnreadCount okunmamış sayı', () => {
    const count = getUnreadCount();
    expect(count).toBe(3);
  });

  it('getUniqueSenders benzersiz gönderen listesi', () => {
    const senders = getUniqueSenders();
    expect(senders).toContain('viewer1');
    expect(senders).toContain('admin1');
    expect(senders).toContain('viewer2');
  });
});

describe('MessageService — Durum', () => {
  let db: any;
  let msgId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
    msgId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'test');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('markAsRead durumu değiştirir', () => {
    markAsRead(msgId);
    const thread = getThread(msgId);
    expect(thread[0].status).toBe('read');
  });

  it('markThreadAsRead tüm mesajları okundu yapar', () => {
    replyToMessage(msgId, 'admin1', 'admin', 'reply1');
    replyToMessage(msgId, 'admin1', 'admin', 'reply2');
    markThreadAsRead(msgId, 'viewer1');
    const thread = getThread(msgId);
    // Admin yanıtları okundu olmalı (sender != viewer1)
    const adminReplies = thread.filter(m => m.sender === 'admin1');
    expect(adminReplies.every(m => m.status === 'read')).toBe(true);
  });

  it('markAsResolved durumu değiştirir', () => {
    markAsResolved(msgId);
    const thread = getThread(msgId);
    expect(thread[0].status).toBe('resolved');
  });
});

describe('MessageService — Silme', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('deleteMessage cascade siler', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'root');
    replyToMessage(rootId, 'admin1', 'admin', 'reply');
    deleteMessage(rootId);
    const thread = getThread(rootId);
    expect(thread).toHaveLength(0);
  });

  it('deleteOwnMessage kendi mesajını siler', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'mine');
    expect(deleteOwnMessage(rootId, 'viewer1')).toBe(true);
    expect(getThread(rootId)).toHaveLength(0);
  });

  it('deleteOwnMessage başkasının mesajını silemez', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'not mine');
    expect(deleteOwnMessage(rootId, 'admin1')).toBe(false);
  });

  it('deleteOwnMessage yanıtı silemez (sadece kök)', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'root');
    const replyId = replyToMessage(rootId, 'viewer1', 'viewer', 'my reply');
    expect(deleteOwnMessage(replyId, 'viewer1')).toBe(false);
  });
});

describe('MessageService — Null safety', () => {
  beforeEach(() => {
    setMessageDb(null);
  });

  it('DB null iken fonksiyonlar güvenli döner', () => {
    expect(sendMessage('x', 'admin', 'suggestion', 'normal', 'y')).toBe(-1);
    expect(replyToMessage(1, 'x', 'admin', 'y')).toBe(-1);
    expect(getAllMessages()).toEqual([]);
    expect(getMessagesForUser('x')).toEqual([]);
    expect(getThread(1)).toEqual([]);
    expect(getUnreadCount()).toBe(0);
    expect(getDailyMessageCount('x')).toBe(0);
    expect(getUniqueSenders()).toEqual([]);
    expect(deleteOwnMessage(1, 'x')).toBe(false);
    // These should not throw
    markAsRead(1);
    markThreadAsRead(1, 'x');
    markAsResolved(1);
    deleteMessage(1);
  });
});

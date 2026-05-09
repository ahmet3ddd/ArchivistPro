import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Mock database save — saveMessageDatabase noop
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
  getUnreadRepliesForUser,
  markRepliesAsReadForUser,
  getDeveloperFeedback,
  claimRequest,
  releaseRequest,
  setMessageDb,
} from '../services/messageService';

/** Test kullanıcılarını users tablosuna ekle */
function insertTestUsers(db: any) {
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['admin1', 'hash', 'admin']
  );
  db.run(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
    ['admin2', 'hash', 'admin']
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

/* ══════════════════════════════════════════════════════════
   claimRequest / releaseRequest
   ══════════════════════════════════════════════════════════ */

describe('MessageService — claimRequest', () => {
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

  it('request mesajını üstlenir ve true döner', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Yardım lazım');
    const result = claimRequest(id, 'admin1');
    expect(result).toBe(true);
    const thread = getThread(id);
    expect(thread[0].assignedTo).toBe('admin1');
    expect(thread[0].status).toBe('read');
  });

  it('suggestion mesajını üstlenemez', () => {
    const id = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    expect(claimRequest(id, 'admin1')).toBe(false);
  });

  it('private mesajını üstlenemez', () => {
    const id = sendMessage('viewer1', 'viewer', 'private', 'normal', 'Özel', undefined, 'admin1');
    expect(claimRequest(id, 'admin1')).toBe(false);
  });

  it('zaten üstlenilmiş request tekrar üstlenilemez', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Request');
    claimRequest(id, 'admin1');
    expect(claimRequest(id, 'admin2')).toBe(false);
  });

  it('resolved request üstlenilemez', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Request');
    markAsResolved(id);
    expect(claimRequest(id, 'admin1')).toBe(false);
  });

  it('var olmayan mesaj id ile false döner', () => {
    expect(claimRequest(99999, 'admin1')).toBe(false);
  });

  it('DB null iken false döner', () => {
    setMessageDb(null);
    expect(claimRequest(1, 'admin1')).toBe(false);
  });
});

describe('MessageService — releaseRequest', () => {
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

  it('üstlenilen request bırakılır', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Request');
    claimRequest(id, 'admin1');
    const result = releaseRequest(id, 'admin1');
    expect(result).toBe(true);
    const thread = getThread(id);
    expect(thread[0].assignedTo).toBeNull();
  });

  it('başka admin tarafından üstlenilmiş request bırakılamaz', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Request');
    claimRequest(id, 'admin1');
    expect(releaseRequest(id, 'admin2')).toBe(false);
  });

  it('var olmayan mesaj id ile false döner', () => {
    expect(releaseRequest(99999, 'admin1')).toBe(false);
  });

  it('DB null iken false döner', () => {
    setMessageDb(null);
    expect(releaseRequest(1, 'admin1')).toBe(false);
  });

  it('release sonrası tekrar claim yapılabilir', () => {
    const id = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Request');
    claimRequest(id, 'admin1');
    releaseRequest(id, 'admin1');
    expect(claimRequest(id, 'admin2')).toBe(true);
    const thread = getThread(id);
    expect(thread[0].assignedTo).toBe('admin2');
  });
});

/* ══════════════════════════════════════════════════════════
   getUnreadRepliesForUser
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getUnreadRepliesForUser', () => {
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

  it('admin yanıtı olan thread\'de okunmamış sayı döner', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Teşekkürler');
    replyToMessage(rootId, 'admin1', 'admin', 'Bir daha bakacağız');
    const count = getUnreadRepliesForUser('viewer1');
    expect(count).toBe(2);
  });

  it('doğrudan kullanıcıya gönderilen mesajlar sayılır', () => {
    sendMessage('admin1', 'admin', 'private', 'normal', 'Direkt mesaj', undefined, 'viewer1');
    const count = getUnreadRepliesForUser('viewer1');
    expect(count).toBe(1);
  });

  it('hem yanıt hem direkt mesaj birlikte sayılır', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    sendMessage('admin1', 'admin', 'private', 'normal', 'Direct', undefined, 'viewer1');
    const count = getUnreadRepliesForUser('viewer1');
    expect(count).toBe(2);
  });

  it('okunmuş yanıtlar sayılmaz', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    mockGetAppRole.mockReturnValue('admin');
    const replyId = replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    markAsRead(replyId);
    const count = getUnreadRepliesForUser('viewer1');
    expect(count).toBe(0);
  });

  it('yanıt yoksa 0 döner', () => {
    expect(getUnreadRepliesForUser('viewer1')).toBe(0);
  });

  it('DB null iken 0 döner', () => {
    setMessageDb(null);
    expect(getUnreadRepliesForUser('viewer1')).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════
   markRepliesAsReadForUser
   ══════════════════════════════════════════════════════════ */

describe('MessageService — markRepliesAsReadForUser', () => {
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

  it('kullanıcıya ait tüm okunmamış yanıtları okundu yapar', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 1');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 2');
    expect(getUnreadRepliesForUser('viewer1')).toBe(2);
    markRepliesAsReadForUser('viewer1');
    expect(getUnreadRepliesForUser('viewer1')).toBe(0);
  });

  it('doğrudan gelen kök mesajları da okundu yapar', () => {
    sendMessage('admin1', 'admin', 'private', 'normal', 'Direct', undefined, 'viewer1');
    expect(getUnreadRepliesForUser('viewer1')).toBe(1);
    markRepliesAsReadForUser('viewer1');
    expect(getUnreadRepliesForUser('viewer1')).toBe(0);
  });

  it('kullanıcının kendi mesajlarına dokunmaz', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kendi mesajım');
    markRepliesAsReadForUser('viewer1');
    const thread = getThread(rootId);
    // Kullanıcının kendi mesajı hala unread (sender = viewer1 olduğu için güncellenmez)
    expect(thread[0].status).toBe('unread');
  });

  it('DB null iken hata vermez', () => {
    setMessageDb(null);
    expect(() => markRepliesAsReadForUser('viewer1')).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════
   getDeveloperFeedback
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getDeveloperFeedback', () => {
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

  it('developer tipindeki kök mesajları döner', () => {
    sendMessage('viewer1', 'viewer', 'developer', 'normal', 'Bug report');
    sendMessage('viewer2', 'viewer', 'developer', 'important', 'Feature request');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Normal öneri');
    const feedback = getDeveloperFeedback();
    expect(feedback).toHaveLength(2);
    expect(feedback.every(m => m.messageType === 'developer')).toBe(true);
  });

  it('yanıtları dahil etmez', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'developer', 'normal', 'Bug');
    replyToMessage(rootId, 'admin1', 'admin', 'Bakacağız');
    const feedback = getDeveloperFeedback();
    expect(feedback).toHaveLength(1);
    expect(feedback[0].id).toBe(rootId);
  });

  it('boş tablo için boş dizi döner', () => {
    const feedback = getDeveloperFeedback();
    expect(feedback).toEqual([]);
  });

  it('DB null iken boş dizi döner', () => {
    setMessageDb(null);
    expect(getDeveloperFeedback()).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════
   getAllMessages — gelişmiş filtreleme ve pagination
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getAllMessages filtreler', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
    mockGetAppRole.mockReturnValue('admin');
    // Çeşitli mesajlar oluştur
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Suggestion 1');
    sendMessage('viewer1', 'viewer', 'request', 'important', 'Request 1');
    sendMessage('admin1', 'admin', 'private', 'normal', 'Private to viewer1', 'Konu', 'viewer1');
    sendMessage('viewer2', 'viewer', 'developer', 'normal', 'Dev feedback');
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('status filtresi çalışır', () => {
    const msgs = getAllMessages();
    markAsRead(msgs[0].id);
    const unread = getAllMessages({ status: 'unread' });
    expect(unread).toHaveLength(3);
    const read = getAllMessages({ status: 'read' });
    expect(read).toHaveLength(1);
  });

  it('sender filtresi çalışır', () => {
    const msgs = getAllMessages({ sender: 'viewer1' });
    expect(msgs).toHaveLength(2);
    expect(msgs.every(m => m.sender === 'viewer1')).toBe(true);
  });

  it('currentUser filtresi uygulanır', () => {
    // viewer1 kendi gönderdiği + kendisine gönderilen + recipient null olanları görür
    const msgs = getAllMessages(undefined, 'viewer1');
    // viewer1 gönderen (2) + admin1→viewer1 (1) + viewer2 (recipient null, 1) = 4
    expect(msgs.length).toBe(4);
  });

  it('currentUser ile sadece ilgili mesajlar gelir', () => {
    // admin1'e özel gönderilen mesaj oluştur (viewer2 göndersin)
    sendMessage('viewer2', 'viewer', 'private', 'normal', 'Only for admin1', undefined, 'admin1');
    // viewer1, admin1'e özel gönderilen mesajı göremez
    const msgs = getAllMessages(undefined, 'viewer1');
    const privateToAdmin = msgs.find(m => m.body === 'Only for admin1');
    expect(privateToAdmin).toBeUndefined();
  });

  it('birden fazla filtre kombine çalışır', () => {
    const msgs = getAllMessages({ type: 'suggestion', sender: 'viewer1' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('Suggestion 1');
  });

  it('limit parametresi çalışır', () => {
    const msgs = getAllMessages(undefined, undefined, 2);
    expect(msgs).toHaveLength(2);
  });

  it('offset parametresi çalışır', () => {
    const allMsgs = getAllMessages();
    const offsetMsgs = getAllMessages(undefined, undefined, 50, 2);
    expect(offsetMsgs).toHaveLength(allMsgs.length - 2);
  });

  it('limit + offset birlikte çalışır', () => {
    const page = getAllMessages(undefined, undefined, 1, 1);
    expect(page).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════
   getUnreadCount — currentUser parametresi ile
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getUnreadCount currentUser', () => {
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

  it('currentUser ile başkalarının gönderdiği mesajları sayar', () => {
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    sendMessage('viewer2', 'viewer', 'suggestion', 'normal', 'Başka öneri');
    // admin1 açısından: ikisi de başkasından gelmiş, recipient null
    const count = getUnreadCount('admin1');
    expect(count).toBe(2);
  });

  it('kullanıcının kendi gönderdiği mesajları saymaz', () => {
    sendMessage('admin1', 'admin', 'suggestion', 'normal', 'Kendi önerim');
    const count = getUnreadCount('admin1');
    expect(count).toBe(0);
  });

  it('kullanıcının katıldığı thread\'deki yanıtları da sayar', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    // viewer1 açısından: admin1'den gelen yanıt
    const count = getUnreadCount('viewer1');
    // kök mesaj kendi gönderdiği (sayılmaz) + admin yanıtı (1)
    expect(count).toBe(1);
  });

  it('currentUser olmadan tüm okunmamış kök mesajları sayar', () => {
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Msg 1');
    sendMessage('viewer2', 'viewer', 'suggestion', 'normal', 'Msg 2');
    sendMessage('admin1', 'admin', 'suggestion', 'normal', 'Msg 3');
    const count = getUnreadCount();
    expect(count).toBe(3);
  });

  it('okunmuş mesajları saymaz', () => {
    const id = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    markAsRead(id);
    const count = getUnreadCount('admin1');
    expect(count).toBe(0);
  });

  it('DB null iken 0 döner', () => {
    setMessageDb(null);
    expect(getUnreadCount('admin1')).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════
   getMessagesForUser — thread sıralama
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getMessagesForUser thread sıralama', () => {
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

  it('kök mesaj + yanıtları sıralı döner', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök mesaj');
    mockGetAppRole.mockReturnValue('admin');
    const reply1 = replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 1');
    const reply2 = replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 2');
    const msgs = getMessagesForUser('viewer1');
    // Sıra: kök, yanıt1, yanıt2
    expect(msgs[0].id).toBe(rootId);
    expect(msgs[1].id).toBe(reply1);
    expect(msgs[2].id).toBe(reply2);
  });

  it('alıcı olan mesajları da gösterir', () => {
    sendMessage('admin1', 'admin', 'private', 'normal', 'Sana özel', 'Konu', 'viewer1');
    const msgs = getMessagesForUser('viewer1');
    expect(msgs.some(m => m.body === 'Sana özel')).toBe(true);
  });

  it('mesaj yoksa boş dizi döner', () => {
    const msgs = getMessagesForUser('viewer2');
    expect(msgs).toEqual([]);
  });

  it('birden fazla thread doğru sıralanır', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const root1 = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Mesaj 1');
    const root2 = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Mesaj 2');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(root1, 'admin1', 'admin', 'Yanıt root1');
    replyToMessage(root2, 'admin1', 'admin', 'Yanıt root2');
    const msgs = getMessagesForUser('viewer1');
    // Her kök mesajın ardından kendi yanıtları gelmeli
    expect(msgs.length).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════
   deleteOwnMessage — alıcı silme ve kenar durumları
   ══════════════════════════════════════════════════════════ */

describe('MessageService — deleteOwnMessage edge cases', () => {
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

  it('alıcı kendi aldığı mesajı silebilir', () => {
    const id = sendMessage('admin1', 'admin', 'private', 'normal', 'Mesaj', undefined, 'viewer1');
    expect(deleteOwnMessage(id, 'viewer1')).toBe(true);
    expect(getThread(id)).toHaveLength(0);
  });

  it('var olmayan mesaj id ile false döner', () => {
    expect(deleteOwnMessage(99999, 'viewer1')).toBe(false);
  });

  it('cascade: yanıtları da siler', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    expect(deleteOwnMessage(rootId, 'viewer1')).toBe(true);
    expect(getThread(rootId)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════
   markThreadAsRead — kenar durumları
   ══════════════════════════════════════════════════════════ */

describe('MessageService — markThreadAsRead edge cases', () => {
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

  it('reader kendi gönderdiği mesajları okundu yapmaz', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    mockGetAppRole.mockReturnValue('admin');
    replyToMessage(rootId, 'admin1', 'admin', 'Admin yanıt');
    mockGetAppRole.mockReturnValue('viewer');
    replyToMessage(rootId, 'viewer1', 'viewer', 'Viewer yanıt');

    // admin1 olarak oku
    markThreadAsRead(rootId, 'admin1');
    const thread = getThread(rootId);
    // viewer1'in kök mesajı ve yanıtı → okundu olmalı (sender != admin1)
    const viewerMsgs = thread.filter(m => m.sender === 'viewer1');
    expect(viewerMsgs.every(m => m.status === 'read')).toBe(true);
    // admin1'in yanıtı → hala unread (sender = admin1, güncellenmez)
    const adminMsgs = thread.filter(m => m.sender === 'admin1');
    expect(adminMsgs.every(m => m.status === 'unread')).toBe(true);
  });

  it('yanıtsız mesajda kök mesajı okundu yapar', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    markThreadAsRead(rootId, 'admin1');
    const thread = getThread(rootId);
    expect(thread[0].status).toBe('read');
  });
});

/* ══════════════════════════════════════════════════════════
   canSendMessage — mesaj gönderildikten sonra
   ══════════════════════════════════════════════════════════ */

describe('MessageService — canSendMessage after sending', () => {
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

  it('mesaj gönderdikçe remaining azalır', () => {
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'msg1');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'msg2');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'msg3');
    const result = canSendMessage('viewer1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(17);
  });

  it('DB null iken allowed=true, remaining=20', () => {
    setMessageDb(null);
    const result = canSendMessage('viewer1');
    // getDailyMessageCount returns 0 when db is null
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
  });
});

/* ══════════════════════════════════════════════════════════
   getUniqueSenders — kenar durumları
   ══════════════════════════════════════════════════════════ */

describe('MessageService — getUniqueSenders edge cases', () => {
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

  it('yanıt gönderenleri dahil etmez (sadece kök mesajlar)', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt');
    const senders = getUniqueSenders();
    // Sadece kök mesaj göndereni (viewer1) olmalı
    expect(senders).toContain('viewer1');
    // admin1 sadece yanıt gönderdiği için olmamalı
    expect(senders).not.toContain('admin1');
  });

  it('mesaj yoksa boş dizi döner', () => {
    const senders = getUniqueSenders();
    expect(senders).toEqual([]);
  });

  it('aynı gönderen tekrarlanmaz', () => {
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Msg 1');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Msg 2');
    sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Msg 3');
    const senders = getUniqueSenders();
    expect(senders.filter(s => s === 'viewer1')).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════
   replyToMessage — DB null
   ══════════════════════════════════════════════════════════ */

describe('MessageService — replyToMessage null safety', () => {
  it('DB null iken -1 döner', () => {
    setMessageDb(null);
    expect(replyToMessage(1, 'admin1', 'admin', 'test')).toBe(-1);
  });
});

/* ══════════════════════════════════════════════════════════
   deleteMessage — kenar durumları
   ══════════════════════════════════════════════════════════ */

describe('MessageService — deleteMessage edge cases', () => {
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

  it('var olmayan mesaj silme hata vermez', () => {
    expect(() => deleteMessage(99999)).not.toThrow();
  });

  it('yanıtlı kök mesajı silerken yanıtlar da silinir', () => {
    const rootId = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Kök');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 1');
    replyToMessage(rootId, 'admin1', 'admin', 'Yanıt 2');
    deleteMessage(rootId);
    const thread = getThread(rootId);
    expect(thread).toHaveLength(0);
    // Toplam mesaj sayısı da azalmalı
    const all = getAllMessages();
    expect(all).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════
   Entegrasyon: tam yaşam döngüsü
   ══════════════════════════════════════════════════════════ */

describe('MessageService — integration lifecycle', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setMessageDb(db);
    insertTestUsers(db);
  });

  afterEach(() => {
    setMessageDb(null);
    db.close();
  });

  it('request: oluştur → claim → yanıtla → resolve tam akış', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const reqId = sendMessage('viewer1', 'viewer', 'request', 'normal', 'Dosya lazım');

    // Admin claim eder
    mockGetAppRole.mockReturnValue('admin');
    expect(claimRequest(reqId, 'admin1')).toBe(true);
    expect(getThread(reqId)[0].assignedTo).toBe('admin1');

    // Admin yanıt yazar
    const replyId = replyToMessage(reqId, 'admin1', 'admin', 'Gönderiyorum');
    expect(replyId).toBeGreaterThan(0);

    // Admin resolve eder
    markAsResolved(reqId);
    expect(getThread(reqId)[0].status).toBe('resolved');

    // Resolved request tekrar claim edilemez
    expect(claimRequest(reqId, 'admin2')).toBe(false);
  });

  it('mesaj gönder → oku → sil tam akış', () => {
    mockGetAppRole.mockReturnValue('viewer');
    const id = sendMessage('viewer1', 'viewer', 'suggestion', 'normal', 'Öneri');
    expect(getUnreadCount()).toBe(1);

    markAsRead(id);
    expect(getUnreadCount()).toBe(0);

    const thread = getThread(id);
    expect(thread[0].status).toBe('read');

    expect(deleteOwnMessage(id, 'viewer1')).toBe(true);
    expect(getThread(id)).toHaveLength(0);
  });
});

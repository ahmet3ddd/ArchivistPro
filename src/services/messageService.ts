/**
 * ArchivistPro — Mesaj Servisi
 *
 * Kullanıcı → Yönetici mesajlaşma (öneri + özel mesaj).
 * mainDb üzerinde çalışır — viewer'ın user_messages tablosuna yazma istisnası vardır.
 */

import { saveMessageDatabase } from './database';
import { auditLog, debugLog } from './logger';
import { getAppRole, type AppRole } from '../permissions/roles';

/* ── Tipler ── */

export type MessageType = 'suggestion' | 'private' | 'developer' | 'request' | 'broadcast';
export type MessagePriority = 'normal' | 'important';
export type MessageStatus = 'unread' | 'read' | 'resolved';

export interface UserMessage {
  id: number;
  sender: string;
  senderRole: AppRole;
  recipient: string | null;
  messageType: MessageType;
  priority: MessagePriority;
  subject: string | null;
  body: string;
  status: MessageStatus;
  parentId: number | null;
  assignedTo: string | null;
  createdAt: string;
}

export interface MessageFilters {
  type?: MessageType;
  status?: MessageStatus;
  sender?: string;
}

/* ── DB Referansı (mainDb) ── */

type SqlJsDb = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (params: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
};

let _db: SqlJsDb | null = null;

export function setMessageDb(db: unknown): void {
  _db = db as SqlJsDb;
}

/* ── Yardımcılar ── */

function rowToMessage(row: Record<string, unknown>): UserMessage {
  return {
    id: row.id as number,
    sender: row.sender as string,
    senderRole: row.sender_role as AppRole,
    recipient: (row.recipient as string) || null,
    messageType: row.message_type as MessageType,
    priority: row.priority as MessagePriority,
    subject: (row.subject as string) || null,
    body: row.body as string,
    status: row.status as MessageStatus,
    parentId: (row.parent_id as number) || null,
    assignedTo: (row.assigned_to as string) || null,
    createdAt: row.created_at as string,
  };
}

function queryMessages(sql: string, params: unknown[] = []): UserMessage[] {
  if (!_db) return [];
  try {
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    const results: UserMessage[] = [];
    while (stmt.step()) {
      results.push(rowToMessage(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  } catch (err) {
    debugLog('MessageService', 'query error', err);
    return [];
  }
}

/* ── Limit ── */

const DAILY_MESSAGE_LIMIT = 20;

/** Alıcı kullanıcının var olup olmadığını doğrula. */
function validateRecipient(recipient: string): boolean {
  if (!_db) return false;
  try {
    const stmt = _db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE username = ?');
    stmt.bind([recipient]);
    let exists = false;
    if (stmt.step()) {
      exists = (stmt.getAsObject().cnt as number) > 0;
    }
    stmt.free();
    return exists;
  } catch { return false; }
}

/** Kullanıcının bugün gönderdiği mesaj sayısı (kök + yanıt). */
export function getDailyMessageCount(username: string): number {
  if (!_db) return 0;
  try {
    const stmt = _db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_messages
       WHERE sender = ?
       AND date(created_at) = date('now','localtime')`
    );
    stmt.bind([username]);
    let count = 0;
    if (stmt.step()) {
      count = (stmt.getAsObject().cnt as number) ?? 0;
    }
    stmt.free();
    return count;
  } catch { return 0; }
}

/** Kullanıcının günlük limit durumu. */
export function canSendMessage(username: string): { allowed: boolean; remaining: number; limit: number } {
  const sent = getDailyMessageCount(username);
  return { allowed: sent < DAILY_MESSAGE_LIMIT, remaining: Math.max(0, DAILY_MESSAGE_LIMIT - sent), limit: DAILY_MESSAGE_LIMIT };
}

/* ── CRUD ── */

/** Yeni mesaj gönder. Hem viewer hem admin kullanabilir. */
export function sendMessage(
  sender: string,
  _senderRole: AppRole,
  type: MessageType,
  priority: MessagePriority,
  body: string,
  subject?: string,
  recipient?: string,
): number {
  if (!_db) return -1;
  const senderRole = getAppRole();
  if (recipient && !validateRecipient(recipient)) return -1;
  _db.run(
    `INSERT INTO user_messages (sender, sender_role, recipient, message_type, priority, subject, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sender, senderRole, recipient || null, type, priority, subject || null, body],
  );
  const result = _db.exec('SELECT last_insert_rowid() AS id');
  const id = (result[0]?.values[0]?.[0] as number) ?? -1;
  saveMessageDatabase();
  auditLog('MESSAGE_SEND', `message#${id}`, { type, priority, subject });
  return id;
}

/**
 * Admin duyurusu gönder — tüm kullanıcılara (recipient=null, type='broadcast').
 * Günlük limiti uygulanmaz.
 */
export function sendBroadcast(
  sender: string,
  subject: string,
  body: string,
  priority: MessagePriority = 'normal',
): number {
  if (!_db) return -1;
  const senderRole = getAppRole();
  _db.run(
    `INSERT INTO user_messages (sender, sender_role, recipient, message_type, priority, subject, body)
     VALUES (?, ?, NULL, 'broadcast', ?, ?, ?)`,
    [sender, senderRole, priority, subject, body],
  );
  const result = _db.exec('SELECT last_insert_rowid() AS id');
  const id = (result[0]?.values[0]?.[0] as number) ?? -1;
  saveMessageDatabase();
  auditLog('BROADCAST_SEND', `broadcast#${id}`, { priority, subject });
  return id;
}

/**
 * Okunmamış broadcast mesajlarını getir (belirli kullanıcı için).
 * Broadcast'ler recipient=null olduğu için tüm kullanıcılara görünür.
 */
export function getUnreadBroadcasts(username: string): UserMessage[] {
  return queryMessages(
    `SELECT * FROM user_messages
     WHERE message_type = 'broadcast'
       AND status = 'unread'
       AND sender != ?
     ORDER BY created_at DESC`,
    [username],
  );
}

/** Bir mesaja yanıt yaz. */
export function replyToMessage(
  parentId: number,
  sender: string,
  _senderRole: AppRole,
  body: string,
): number {
  if (!_db) return -1;
  const senderRole = getAppRole();
  _db.run(
    `INSERT INTO user_messages (sender, sender_role, message_type, priority, subject, body, parent_id, status)
     VALUES (?, ?, 'private', 'normal', NULL, ?, ?, 'unread')`,
    [sender, senderRole, body, parentId],
  );
  const result = _db.exec('SELECT last_insert_rowid() AS id');
  const id = (result[0]?.values[0]?.[0] as number) ?? -1;
  saveMessageDatabase();
  auditLog('MESSAGE_REPLY', `message#${parentId}→reply#${id}`, { sender });
  return id;
}

/** Kullanıcının kendi mesajları + yanıtları (viewer için). */
export function getMessagesForUser(username: string): UserMessage[] {
  // Kök mesajlar: kullanıcının gönderdiği + kullanıcıya gönderilen
  const roots = queryMessages(
    `SELECT * FROM user_messages WHERE (sender = ? OR recipient = ?) AND parent_id IS NULL ORDER BY created_at DESC`,
    [username, username],
  );
  if (roots.length === 0) return [];
  const ids = roots.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const replies = queryMessages(
    `SELECT * FROM user_messages WHERE parent_id IN (${placeholders}) ORDER BY created_at ASC`,
    ids,
  );
  // Yanıtları kök mesajların arasına yerleştir (thread sıralı)
  const result: UserMessage[] = [];
  for (const root of roots) {
    result.push(root);
    result.push(...replies.filter(r => r.parentId === root.id));
  }
  return result;
}

/** Tüm mesajlar (inbox). currentUser: gizlilik filtresi, limit/offset: pagination. */
export function getAllMessages(filters?: MessageFilters, currentUser?: string, limit = 50, offset = 0): UserMessage[] {
  let sql = 'SELECT * FROM user_messages WHERE parent_id IS NULL';
  const params: unknown[] = [];

  if (currentUser) {
    sql += ' AND (sender = ? OR recipient = ? OR recipient IS NULL)';
    params.push(currentUser, currentUser);
  }

  if (filters?.type) {
    sql += ' AND message_type = ?';
    params.push(filters.type);
  }
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.sender) {
    sql += ' AND sender = ?';
    params.push(filters.sender);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return queryMessages(sql, params);
}

/** Bir mesajın thread'i (kök + yanıtlar). */
export function getThread(messageId: number): UserMessage[] {
  const root = queryMessages('SELECT * FROM user_messages WHERE id = ?', [messageId]);
  const replies = queryMessages(
    'SELECT * FROM user_messages WHERE parent_id = ? ORDER BY created_at ASC',
    [messageId],
  );
  return [...root, ...replies];
}

/** Kullanıcıya ait okunmamış mesaj sayısı (kök + yanıt). */
export function getUnreadCount(currentUser?: string): number {
  if (!_db) return 0;
  try {
    if (!currentUser) {
      const result = _db.exec("SELECT COUNT(*) FROM user_messages WHERE status = 'unread' AND parent_id IS NULL");
      return (result[0]?.values[0]?.[0] as number) ?? 0;
    }
    // Kök mesajlar: alıcısı ben olan veya alıcısı olmayan, benim göndermediğim
    const s1 = _db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_messages
       WHERE status = 'unread' AND parent_id IS NULL AND sender != ?
       AND (recipient = ? OR recipient IS NULL)`
    );
    s1.bind([currentUser, currentUser]);
    let count = 0;
    if (s1.step()) count += (s1.getAsObject().cnt as number) ?? 0;
    s1.free();
    // Yanıtlar: benim katıldığım thread'lerdeki başkalarının yanıtları
    const s2 = _db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_messages r
       WHERE r.status = 'unread' AND r.parent_id IS NOT NULL AND r.sender != ?
       AND r.parent_id IN (
         SELECT id FROM user_messages WHERE parent_id IS NULL AND (sender = ? OR recipient = ?)
       )`
    );
    s2.bind([currentUser, currentUser, currentUser]);
    if (s2.step()) count += (s2.getAsObject().cnt as number) ?? 0;
    s2.free();
    return count;
  } catch { return 0; }
}

/** Mesajı okundu olarak işaretle. */
export function markAsRead(id: number): void {
  if (!_db) return;
  _db.run("UPDATE user_messages SET status = 'read' WHERE id = ?", [id]);
  saveMessageDatabase();
  auditLog('MESSAGE_READ', `message#${id}`);
}

/** Thread'deki tüm mesajları okundu yap (kök + yanıtlar, gönderen hariç). */
export function markThreadAsRead(messageId: number, readerUsername: string): void {
  if (!_db) return;
  _db.run(
    `UPDATE user_messages SET status = 'read'
     WHERE status = 'unread' AND sender != ?
     AND (id = ? OR parent_id = ?)`,
    [readerUsername, messageId, messageId]
  );
  saveMessageDatabase();
}

/** Mesajı çözüldü olarak işaretle. */
export function markAsResolved(id: number): void {
  if (!_db) return;
  _db.run("UPDATE user_messages SET status = 'resolved' WHERE id = ?", [id]);
  saveMessageDatabase();
  auditLog('MESSAGE_RESOLVE', `message#${id}`);
}

/** Talebi üstlen (sadece atanmamış request mesajlarında çalışır). */
export function claimRequest(id: number, adminUsername: string): boolean {
  if (!_db) return false;
  try {
    const stmt = _db.prepare('SELECT message_type, assigned_to, status FROM user_messages WHERE id = ? AND parent_id IS NULL');
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return false; }
    const row = stmt.getAsObject();
    stmt.free();
    if (row.message_type !== 'request') return false;
    if (row.assigned_to !== null && row.assigned_to !== undefined && row.assigned_to !== '') return false;
    if (row.status === 'resolved') return false;
    _db.run(
      "UPDATE user_messages SET assigned_to = ?, status = 'read' WHERE id = ?",
      [adminUsername, id],
    );
    saveMessageDatabase();
    auditLog('REQUEST_CLAIM', `message#${id}`, { admin: adminUsername });
    return true;
  } catch { return false; }
}

/** Üstlenilen talebi bırak (sadece üstlenen admin yapabilir). */
export function releaseRequest(id: number, adminUsername: string): boolean {
  if (!_db) return false;
  try {
    const stmt = _db.prepare('SELECT assigned_to FROM user_messages WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return false; }
    const row = stmt.getAsObject();
    stmt.free();
    if (row.assigned_to !== adminUsername) return false;
    _db.run("UPDATE user_messages SET assigned_to = NULL WHERE id = ?", [id]);
    saveMessageDatabase();
    auditLog('REQUEST_RELEASE', `message#${id}`, { admin: adminUsername });
    return true;
  } catch { return false; }
}

/** Mesajı sil (admin). Yanıtları da CASCADE ile silinir. */
export function deleteMessage(id: number): void {
  if (!_db) return;
  _db.run('DELETE FROM user_messages WHERE id = ? OR parent_id = ?', [id, id]);
  saveMessageDatabase();
  auditLog('MESSAGE_DELETE', `message#${id}`);
}

/** Kullanıcının kendi gönderdiği veya kendisine gelen kök mesajını silmesi. */
export function deleteOwnMessage(id: number, username: string): boolean {
  if (!_db) return false;
  try {
    const stmt = _db.prepare('SELECT sender, recipient, parent_id FROM user_messages WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return false; }
    const row = stmt.getAsObject();
    stmt.free();
    if (row.parent_id !== null) return false;
    if (row.sender !== username && row.recipient !== username) return false;
    _db.run('DELETE FROM user_messages WHERE id = ? OR parent_id = ?', [id, id]);
    saveMessageDatabase();
    auditLog('MESSAGE_DELETE_OWN', `message#${id}`, { username });
    return true;
  } catch { return false; }
}

/** Viewer için: admin yanıtları + doğrudan gelen mesajlardan okunmamış olanların sayısı. */
export function getUnreadRepliesForUser(username: string): number {
  if (!_db) return 0;
  try {
    // Admin yanıtları (eski mantık)
    const stmtReplies = _db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_messages r
       INNER JOIN user_messages p ON r.parent_id = p.id
       WHERE p.sender = ? AND r.sender_role = 'admin' AND r.status = 'unread'`
    );
    stmtReplies.bind([username]);
    let replyCount = 0;
    if (stmtReplies.step()) {
      replyCount = (stmtReplies.getAsObject().cnt as number) ?? 0;
    }
    stmtReplies.free();

    // Doğrudan kullanıcıya gönderilen mesajlar
    const stmtDirect = _db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_messages
       WHERE recipient = ? AND parent_id IS NULL AND status = 'unread'`
    );
    stmtDirect.bind([username]);
    let directCount = 0;
    if (stmtDirect.step()) {
      directCount = (stmtDirect.getAsObject().cnt as number) ?? 0;
    }
    stmtDirect.free();

    return replyCount + directCount;
  } catch { return 0; }
}

/** Kullanıcıya ait tüm okunmamış mesajları (kök + yanıt) okundu yap. */
export function markRepliesAsReadForUser(username: string): void {
  if (!_db) return;
  try {
    // Doğrudan gelen kök mesajlar
    _db.run(
      `UPDATE user_messages SET status = 'read'
       WHERE status = 'unread' AND sender != ? AND recipient = ? AND parent_id IS NULL`,
      [username, username]
    );
    // Kullanıcının katıldığı thread'lerdeki yanıtlar (başkalarından gelen)
    _db.run(
      `UPDATE user_messages SET status = 'read'
       WHERE status = 'unread' AND sender != ?
       AND parent_id IN (
         SELECT id FROM user_messages WHERE parent_id IS NULL AND (sender = ? OR recipient = ?)
       )`,
      [username, username, username]
    );
    saveMessageDatabase();
  } catch (err) {
    debugLog('MessageService', 'markRepliesAsReadForUser error', err);
  }
}

/** Benzersiz gönderen listesi (admin filtre için). */
/** Tüm geliştirici geri bildirimlerini döner (kök mesajlar, admin için). */
export function getDeveloperFeedback(): UserMessage[] {
  if (!_db) return [];
  return queryMessages(
    `SELECT * FROM user_messages WHERE message_type = 'developer' AND parent_id IS NULL ORDER BY created_at DESC`,
    [],
  );
}

export function getUniqueSenders(): string[] {
  if (!_db) return [];
  try {
    const result = _db.exec('SELECT DISTINCT sender FROM user_messages WHERE parent_id IS NULL ORDER BY sender');
    if (result.length === 0) return [];
    return result[0].values.map(r => r[0] as string);
  } catch { return []; }
}

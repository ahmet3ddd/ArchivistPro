import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Mock database save — sadece saveUserDatabase noop, diğer export'lar gerçek
// (test helper _applySchemaForTesting / _applyMigrationsForTesting kullanıyor)
vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return {
    ...actual,
    saveUserDatabase: vi.fn(),
  };
});

// Mock logger
vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
  debugLog: vi.fn(),
}));

// Mock i18n
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k },
}));

import {
  hashPassword,
  verifyPassword,
  createUser,
  updateUser,
  deleteUser,
  getUserByCredentials,
  getAllUsers,
  getUserById,
  getAdminCount,
  ensureDefaultAdmin,
  setUserDb,
} from '../services/userService';

describe('UserService — Şifre Hash (PBKDF2)', () => {
  it('hashPassword salt:hash formatında üretir', async () => {
    const h = await hashPassword('test123');
    expect(h).toContain(':');
    const [saltHex, hashHex] = h.split(':');
    expect(saltHex).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    expect(hashHex).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
  });

  it('farklı çağrılar farklı salt üretir', async () => {
    const h1 = await hashPassword('test123');
    const h2 = await hashPassword('test123');
    expect(h1).not.toBe(h2); // Farklı salt → farklı hash
  });

  it('verifyPassword doğru şifreyi kabul eder', async () => {
    const hash = await hashPassword('mypassword');
    const valid = await verifyPassword('mypassword', hash);
    expect(valid).toBe(true);
  });

  it('verifyPassword yanlış şifreyi reddeder', async () => {
    const hash = await hashPassword('mypassword');
    const valid = await verifyPassword('wrongpassword', hash);
    expect(valid).toBe(false);
  });

  it('farklı şifreler farklı hash üretir', async () => {
    const h1 = await hashPassword('password1');
    const h2 = await hashPassword('password2');
    // Hash kısımları farklı olmalı (salt zaten farklı)
    expect(h1.split(':')[1]).not.toBe(h2.split(':')[1]);
  });
});

describe('UserService — Kullanıcı Oluşturma', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
  });

  afterEach(() => {
    setUserDb(null);
    db.close();
  });

  it('createUser başarılı oluşturur', async () => {
    const result = await createUser({
      username: 'testuser',
      password: 'pass123',
      role: 'viewer',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
    expect(result.userId).toBeGreaterThan(0);
  });

  it('aynı username hata verir', async () => {
    await createUser({ username: 'duplicate', password: 'pass', role: 'viewer' });
    const result = await createUser({ username: 'duplicate', password: 'pass2', role: 'admin' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('boş username hata verir', async () => {
    const result = await createUser({ username: '', password: 'pass', role: 'viewer' });
    expect(result.success).toBe(false);
  });

  it('boş password hata verir', async () => {
    const result = await createUser({ username: 'user', password: '  ', role: 'viewer' });
    expect(result.success).toBe(false);
  });

  it('username lowercase kaydedilir', async () => {
    await createUser({ username: 'UPPERCASE', password: 'pass', role: 'viewer' });
    const users = getAllUsers();
    expect(users[0].username).toBe('uppercase');
  });
});

describe('UserService — Varsayılan Admin', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
  });

  afterEach(() => {
    setUserDb(null);
    db.close();
  });

  it('ensureDefaultAdmin boş DB de admin oluşturur', async () => {
    await ensureDefaultAdmin();
    const users = getAllUsers();
    expect(users.length).toBe(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].role).toBe('admin');
  });

  it('ensureDefaultAdmin kullanıcı varken atlar', async () => {
    await createUser({ username: 'existing', password: 'pass', role: 'viewer' });
    await ensureDefaultAdmin();
    const users = getAllUsers();
    expect(users.length).toBe(1);
    expect(users[0].username).toBe('existing');
  });
});

describe('UserService — Login', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    await createUser({ username: 'alice', password: 'secret', role: 'admin', displayName: 'Alice' });
  });

  afterEach(() => {
    setUserDb(null);
    db.close();
  });

  it('doğru kimlik ile kullanıcı döner', async () => {
    const user = await getUserByCredentials('alice', 'secret');
    expect(user).not.toBeNull();
    expect(user!.username).toBe('alice');
    expect(user!.role).toBe('admin');
  });

  it('yanlış şifre null döner', async () => {
    const user = await getUserByCredentials('alice', 'wrong');
    expect(user).toBeNull();
  });

  it('olmayan kullanıcı null döner', async () => {
    const user = await getUserByCredentials('nobody', 'pass');
    expect(user).toBeNull();
  });
});

describe('UserService — Sorgular', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    await createUser({ username: 'admin1', password: 'pass', role: 'admin' });
    await createUser({ username: 'viewer1', password: 'pass', role: 'viewer' });
    await createUser({ username: 'admin2', password: 'pass', role: 'admin' });
  });

  afterEach(() => {
    setUserDb(null);
    db.close();
  });

  it('getAllUsers listeler', () => {
    const users = getAllUsers();
    expect(users).toHaveLength(3);
  });

  it('getUserById döner', () => {
    const users = getAllUsers();
    const firstId = users[0].id;
    const user = getUserById(firstId);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(firstId);
  });

  it('getAdminCount doğru sayı', () => {
    expect(getAdminCount()).toBe(2);
  });
});

describe('UserService — Güncelleme/Silme', () => {
  let db: any;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    const result = await createUser({
      username: 'testuser',
      password: 'original',
      role: 'viewer',
      displayName: 'Original Name',
    });
    userId = result.userId!;
  });

  afterEach(() => {
    setUserDb(null);
    db.close();
  });

  it('updateUser displayName günceller', async () => {
    const result = await updateUser(userId, { displayName: 'New Name' });
    expect(result.success).toBe(true);
    const user = getUserById(userId);
    expect(user!.displayName).toBe('New Name');
  });

  it('updateUser password günceller (login ile doğrula)', async () => {
    await updateUser(userId, { password: 'newpass' });
    const user = await getUserByCredentials('testuser', 'newpass');
    expect(user).not.toBeNull();
    // Eski şifre artık çalışmaz
    const oldLogin = await getUserByCredentials('testuser', 'original');
    expect(oldLogin).toBeNull();
  });

  it('updateUser role günceller', async () => {
    await updateUser(userId, { role: 'admin' });
    const user = getUserById(userId);
    expect(user!.role).toBe('admin');
  });

  it('updateUser isBlocked günceller', async () => {
    await updateUser(userId, { isBlocked: true });
    const user = getUserById(userId);
    expect(user!.isBlocked).toBe(true);
  });

  it('deleteUser siler', () => {
    const result = deleteUser(userId);
    expect(result.success).toBe(true);
    expect(getUserById(userId)).toBeNull();
  });
});

describe('UserService — Null safety', () => {
  beforeEach(() => {
    setUserDb(null);
  });

  it('DB null iken fonksiyonlar güvenli döner', async () => {
    expect(getAllUsers()).toEqual([]);
    expect(getUserById(1)).toBeNull();
    expect(getAdminCount()).toBe(0);
    expect(await getUserByCredentials('x', 'y')).toBeNull();
    const createResult = await createUser({ username: 'x', password: 'y', role: 'viewer' });
    expect(createResult.success).toBe(false);
    const updateResult = await updateUser(1, { displayName: 'x' });
    expect(updateResult.success).toBe(false);
    const deleteResult = deleteUser(1);
    expect(deleteResult.success).toBe(false);
  });
});

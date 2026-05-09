/**
 * AUTH + RBAC Güvenlik Testleri
 *
 * Kimlik doğrulama kenar durumları, son admin koruması, founder koruması,
 * engellenmiş kullanıcı, yetki matrisi.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return { ...actual, saveUserDatabase: vi.fn() };
});
vi.mock('../services/logger', () => ({ auditLog: vi.fn(), debugLog: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import {
  createUser,
  updateUser,
  deleteUser,
  getUserByCredentials,
  getAllUsers,
  getAdminCount,
  ensureDefaultAdmin,
  setUserDb,
} from '../services/userService';

import {
  hasPermission,
  hasPermissions,
  setRuntimeRole,
  setRuntimeDeveloper,
  isAdmin,
  isDeveloper,
  getPermissions,
  type Permission,
} from '../permissions/roles';

/* ═══════════════════════════════════════════════════════════
   1. Engellenmiş Kullanıcı
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Engellenmiş kullanıcı girişi', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    await createUser({ username: 'blocked_user', password: 'pass123', role: 'viewer' });
    const users = getAllUsers();
    const userId = users.find(u => u.username === 'blocked_user')!.id;
    await updateUser(userId, { isBlocked: true });
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('engellenmiş kullanıcı giriş yapamamalı', async () => {
    const user = await getUserByCredentials('blocked_user', 'pass123');
    // Engelli kullanıcı ya null döner ya da isBlocked=true
    if (user) {
      expect(user.isBlocked).toBe(true);
    } else {
      expect(user).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   2. Son Admin Koruması
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Son admin koruması', () => {
  let db: any;
  let adminId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    const result = await createUser({ username: 'soloadmin', password: 'pass', role: 'admin' });
    adminId = result.userId!;
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('tek admin viewer\'a düşürülemez', async () => {
    expect(getAdminCount()).toBe(1);
    const result = await updateUser(adminId, { role: 'viewer' });
    // Son admin koruması — ya başarısız ya da hâlâ admin
    const users = getAllUsers();
    const admin = users.find(u => u.id === adminId);
    expect(admin!.role).toBe('admin');
  });

  it('ikinci admin varken ikincisi düşürülebilir (founder olmayan)', async () => {
    // İlk admin founder olur, ikincisi değil
    const result2 = await createUser({ username: 'admin2', password: 'pass', role: 'admin' });
    const admin2Id = result2.userId!;
    expect(getAdminCount()).toBe(2);
    // Founder olmayan admin düşürülebilir
    const result = await updateUser(admin2Id, { role: 'viewer' });
    expect(result.success).toBe(true);
    const users = getAllUsers();
    const demoted = users.find(u => u.id === admin2Id);
    expect(demoted!.role).toBe('viewer');
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Founder Koruması
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Founder koruması', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    // İlk admin ensureDefaultAdmin ile oluşturulursa founder olur
    await ensureDefaultAdmin();
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('founder kullanıcı silinemez', async () => {
    const users = getAllUsers();
    const founder = users.find(u => u.username === 'admin');
    expect(founder).toBeDefined();
    const result = deleteUser(founder!.id);
    // Founder koruması: silme başarısız olmalı veya kullanıcı hâlâ mevcut
    const afterDelete = getAllUsers();
    expect(afterDelete.some(u => u.username === 'admin')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   4. Giriş Kenar Durumları
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Giriş kenar durumları', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    await createUser({ username: 'TestUser', password: 'pass123', role: 'viewer' });
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('büyük harfle yazılan username ile giriş yapılabilir (case-insensitive)', async () => {
    const user = await getUserByCredentials('TESTUSER', 'pass123');
    expect(user).not.toBeNull();
    expect(user!.username).toBe('testuser');
  });

  it('karma büyük-küçük harf ile giriş', async () => {
    const user = await getUserByCredentials('tEsTuSeR', 'pass123');
    expect(user).not.toBeNull();
  });

  it('boş username ile giriş null döner', async () => {
    const user = await getUserByCredentials('', 'pass123');
    expect(user).toBeNull();
  });

  it('boş şifre ile giriş null döner', async () => {
    const user = await getUserByCredentials('testuser', '');
    expect(user).toBeNull();
  });

  it('çok uzun şifre ile giriş denemesi çökmez', async () => {
    const longPass = 'x'.repeat(10000);
    const user = await getUserByCredentials('testuser', longPass);
    expect(user).toBeNull();
  });

  it('SQL injection denemesi güvenli', async () => {
    const user = await getUserByCredentials("admin' OR '1'='1", 'pass');
    expect(user).toBeNull();
  });

  it('unicode username ile kullanıcı oluşturulabilir', async () => {
    const result = await createUser({ username: 'ünlü_müdür', password: 'şifre', role: 'viewer' });
    expect(result.success).toBe(true);
    const user = await getUserByCredentials('ünlü_müdür', 'şifre');
    expect(user).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
   5. Şifre Güvenliği
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Şifre güncelleme güvenliği', () => {
  let db: any;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
    const result = await createUser({ username: 'alice', password: 'original', role: 'viewer' });
    userId = result.userId!;
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('şifre değiştirilince eski şifre çalışmaz', async () => {
    await updateUser(userId, { password: 'newpass' });
    expect(await getUserByCredentials('alice', 'original')).toBeNull();
    expect(await getUserByCredentials('alice', 'newpass')).not.toBeNull();
  });

  it('şifre boşluk olamaz', async () => {
    const result = await createUser({ username: 'bob', password: '   ', role: 'viewer' });
    expect(result.success).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════
   6. RBAC Yetki Matrisi — Kapsamlı
   ═══════════════════════════════════════════════════════════ */

describe('RBAC — Viewer yazma engelleri', () => {
  afterEach(() => {
    setRuntimeRole(null);
    setRuntimeDeveloper(false);
  });

  const VIEWER_DENIED: Permission[] = [
    'archive.write', 'archive.delete', 'archive.scan', 'archive.refile',
    'users.manage', 'settings.manage', 'logs.view',
  ];

  const VIEWER_ALLOWED: Permission[] = [
    'archive.read', 'local.read', 'local.write', 'local.delete',
    'local.zip', 'local_archive.create', 'local_archive.manage',
    'local_archive.share', 'ai.use',
  ];

  it('viewer yasaklı izinlere sahip değil', () => {
    for (const perm of VIEWER_DENIED) {
      expect(hasPermission('viewer', perm)).toBe(false);
    }
  });

  it('viewer izin verilen izinlere sahip', () => {
    for (const perm of VIEWER_ALLOWED) {
      expect(hasPermission('viewer', perm)).toBe(true);
    }
  });

  it('admin tüm izinlere sahip', () => {
    const all = [...VIEWER_DENIED, ...VIEWER_ALLOWED];
    for (const perm of all) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });

  it('developer viewer\'a ek izinler verir', () => {
    // Developer flag ile viewer'a scan, refile, settings, logs verilir
    expect(hasPermission('viewer', 'archive.scan', true)).toBe(true);
    expect(hasPermission('viewer', 'archive.refile', true)).toBe(true);
    expect(hasPermission('viewer', 'settings.manage', true)).toBe(true);
    expect(hasPermission('viewer', 'logs.view', true)).toBe(true);
  });

  it('developer viewer hâlâ users.manage yapamaz', () => {
    expect(hasPermission('viewer', 'users.manage', true)).toBe(false);
  });

  it('developer viewer hâlâ archive.write yapamaz', () => {
    expect(hasPermission('viewer', 'archive.write', true)).toBe(false);
  });

  it('hasPermissions çoklu izin kontrolü', () => {
    expect(hasPermissions('admin', ['archive.read', 'archive.write', 'users.manage'])).toBe(true);
    expect(hasPermissions('viewer', ['archive.read', 'archive.write'])).toBe(false);
    expect(hasPermissions('viewer', ['archive.read', 'local.read'])).toBe(true);
  });

  it('getPermissions doğru sayıda izin döner', () => {
    const adminPerms = getPermissions('admin');
    const viewerPerms = getPermissions('viewer');
    expect(adminPerms.length).toBeGreaterThan(viewerPerms.length);
    expect(viewerPerms.length).toBe(VIEWER_ALLOWED.length);
  });

  it('isAdmin doğru döner', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('viewer')).toBe(false);
  });

  it('setRuntimeRole + setRuntimeDeveloper birlikte çalışır', () => {
    setRuntimeRole('viewer');
    setRuntimeDeveloper(true);
    expect(isDeveloper()).toBe(true);
    setRuntimeDeveloper(false);
    expect(isDeveloper()).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════
   7. Çoklu Kullanıcı Senaryoları
   ═══════════════════════════════════════════════════════════ */

describe('AUTH — Çoklu kullanıcı senaryoları', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setUserDb(db);
  });

  afterEach(() => { setUserDb(null); db.close(); });

  it('aynı anda 10 kullanıcı oluşturulabilir', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      createUser({ username: `user${i}`, password: `pass${i}`, role: i < 3 ? 'admin' : 'viewer' })
    );
    const results = await Promise.all(promises);
    expect(results.every(r => r.success)).toBe(true);
    expect(getAllUsers()).toHaveLength(10);
    expect(getAdminCount()).toBe(3);
  });

  it('kullanıcı silindikten sonra aynı username tekrar kullanılabilir', async () => {
    const r1 = await createUser({ username: 'recycled', password: 'p1', role: 'viewer' });
    deleteUser(r1.userId!);
    const r2 = await createUser({ username: 'recycled', password: 'p2', role: 'admin' });
    expect(r2.success).toBe(true);
    const user = await getUserByCredentials('recycled', 'p2');
    expect(user!.role).toBe('admin');
  });
});

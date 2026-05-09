import { describe, it, expect, afterEach } from 'vitest';
import {
  hasPermission,
  hasPermissions,
  getPermissions,
  isAdmin,
  setRuntimeRole,
  setRuntimeDeveloper,
  isDeveloper,
  getAppRole,
  DEVELOPER_EXTRA_PERMISSIONS,
  type Permission,
} from '../permissions/roles';

/** Her testten sonra runtime rolü ve developer bayrağını sıfırla */
afterEach(() => {
  setRuntimeRole(null);
  setRuntimeDeveloper(false);
});

describe('roles — setRuntimeRole / getAppRole', () => {
  it('null iken varsayılan viewer döner', () => {
    setRuntimeRole(null);
    // VITE_APP_ROLE env set değilse viewer fallback
    const role = getAppRole();
    expect(['admin', 'viewer']).toContain(role);
  });

  it('admin set edilince admin döner', () => {
    setRuntimeRole('admin');
    expect(getAppRole()).toBe('admin');
  });

  it('viewer set edilince viewer döner', () => {
    setRuntimeRole('viewer');
    expect(getAppRole()).toBe('viewer');
  });

  it('setRuntimeRole null ile sıfırlanabilir', () => {
    setRuntimeRole('admin');
    setRuntimeRole(null);
    // artık env fallback — admin veya viewer
    expect(['admin', 'viewer']).toContain(getAppRole());
  });
});

describe('roles — hasPermission', () => {
  it('admin tüm izinlere sahiptir', () => {
    const allPerms: Permission[] = [
      'archive.read', 'archive.write', 'archive.delete', 'archive.scan', 'archive.refile',
      'local.read', 'local.write', 'local.delete', 'local.zip',
      'local_archive.create', 'local_archive.manage', 'local_archive.share',
      'ai.use', 'users.manage', 'settings.manage', 'logs.view',
    ];
    for (const p of allPerms) {
      expect(hasPermission('admin', p)).toBe(true);
    }
  });

  it('viewer archive.write iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'archive.write')).toBe(false);
  });

  it('viewer archive.delete iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'archive.delete')).toBe(false);
  });

  it('viewer archive.scan iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'archive.scan')).toBe(false);
  });

  it('viewer archive.refile iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'archive.refile')).toBe(false);
  });

  it('viewer users.manage iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'users.manage')).toBe(false);
  });

  it('viewer settings.manage iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'settings.manage')).toBe(false);
  });

  it('viewer logs.view iznine sahip değildir', () => {
    expect(hasPermission('viewer', 'logs.view')).toBe(false);
  });

  it('viewer archive.read iznine sahiptir', () => {
    expect(hasPermission('viewer', 'archive.read')).toBe(true);
  });

  it('viewer ai.use iznine sahiptir', () => {
    expect(hasPermission('viewer', 'ai.use')).toBe(true);
  });

  it('viewer local.read iznine sahiptir', () => {
    expect(hasPermission('viewer', 'local.read')).toBe(true);
  });

  it('viewer local.write iznine sahiptir', () => {
    expect(hasPermission('viewer', 'local.write')).toBe(true);
  });

  it('viewer local.delete iznine sahiptir', () => {
    expect(hasPermission('viewer', 'local.delete')).toBe(true);
  });

  it('viewer local_archive.create iznine sahiptir', () => {
    expect(hasPermission('viewer', 'local_archive.create')).toBe(true);
  });
});

describe('roles — hasPermissions', () => {
  it('admin birden fazla izne sahiptir', () => {
    expect(hasPermissions('admin', ['archive.read', 'archive.write', 'users.manage'])).toBe(true);
  });

  it('viewer gereken izin yoksa false döner', () => {
    expect(hasPermissions('viewer', ['archive.read', 'archive.write'])).toBe(false);
  });

  it('viewer sahip olduğu izinlerde true döner', () => {
    expect(hasPermissions('viewer', ['archive.read', 'ai.use'])).toBe(true);
  });

  it('boş izin listesi true döner (every semantiği)', () => {
    expect(hasPermissions('viewer', [])).toBe(true);
    expect(hasPermissions('admin', [])).toBe(true);
  });

  it('tek izin ile çalışır', () => {
    expect(hasPermissions('admin', ['logs.view'])).toBe(true);
    expect(hasPermissions('viewer', ['logs.view'])).toBe(false);
  });
});

describe('roles — getPermissions', () => {
  it('admin izin listesi 16 elemanlıdır', () => {
    expect(getPermissions('admin')).toHaveLength(16);
  });

  it('viewer izin listesi 9 elemanlıdır', () => {
    expect(getPermissions('viewer')).toHaveLength(9);
  });

  it('admin listesi archive.write içerir', () => {
    expect(getPermissions('admin')).toContain('archive.write');
  });

  it('viewer listesi archive.write içermez', () => {
    expect(getPermissions('viewer')).not.toContain('archive.write');
  });

  it('her rol için dizi döner', () => {
    expect(Array.isArray(getPermissions('admin'))).toBe(true);
    expect(Array.isArray(getPermissions('viewer'))).toBe(true);
  });
});

describe('roles — isAdmin', () => {
  it('admin rolü için true döner', () => {
    expect(isAdmin('admin')).toBe(true);
  });

  it('viewer rolü için false döner', () => {
    expect(isAdmin('viewer')).toBe(false);
  });
});

describe('roles — viewer izin kümesi tam doğrulama', () => {
  const viewerPerms = getPermissions('viewer');

  const expectedInViewer: Permission[] = [
    'archive.read',
    'local.read', 'local.write', 'local.delete', 'local.zip',
    'local_archive.create', 'local_archive.manage', 'local_archive.share',
    'ai.use',
  ];

  const expectedNotInViewer: Permission[] = [
    'archive.write', 'archive.delete', 'archive.scan', 'archive.refile',
    'users.manage', 'settings.manage', 'logs.view',
  ];

  for (const p of expectedInViewer) {
    it(`viewer ${p} iznine sahiptir`, () => {
      expect(viewerPerms).toContain(p);
    });
  }

  for (const p of expectedNotInViewer) {
    it(`viewer ${p} iznine sahip değildir`, () => {
      expect(viewerPerms).not.toContain(p);
    });
  }
});

describe('roles — developer flag', () => {
  it('setRuntimeDeveloper ve isDeveloper çalışır', () => {
    expect(isDeveloper()).toBe(false);
    setRuntimeDeveloper(true);
    expect(isDeveloper()).toBe(true);
    setRuntimeDeveloper(false);
    expect(isDeveloper()).toBe(false);
  });

  it('DEVELOPER_EXTRA_PERMISSIONS 4 elemanlıdır', () => {
    expect(DEVELOPER_EXTRA_PERMISSIONS).toHaveLength(4);
    expect(DEVELOPER_EXTRA_PERMISSIONS).toContain('archive.scan');
    expect(DEVELOPER_EXTRA_PERMISSIONS).toContain('archive.refile');
    expect(DEVELOPER_EXTRA_PERMISSIONS).toContain('settings.manage');
    expect(DEVELOPER_EXTRA_PERMISSIONS).toContain('logs.view');
  });

  it('viewer+developer archive.scan iznine sahiptir', () => {
    expect(hasPermission('viewer', 'archive.scan', true)).toBe(true);
  });

  it('viewer+developer archive.refile iznine sahiptir', () => {
    expect(hasPermission('viewer', 'archive.refile', true)).toBe(true);
  });

  it('viewer+developer settings.manage iznine sahiptir', () => {
    expect(hasPermission('viewer', 'settings.manage', true)).toBe(true);
  });

  it('viewer+developer logs.view iznine sahiptir', () => {
    expect(hasPermission('viewer', 'logs.view', true)).toBe(true);
  });

  it('viewer+developer archive.write iznine sahip DEĞİLDİR', () => {
    expect(hasPermission('viewer', 'archive.write', true)).toBe(false);
  });

  it('viewer+developer archive.delete iznine sahip DEĞİLDİR', () => {
    expect(hasPermission('viewer', 'archive.delete', true)).toBe(false);
  });

  it('viewer+developer users.manage iznine sahip DEĞİLDİR', () => {
    expect(hasPermission('viewer', 'users.manage', true)).toBe(false);
  });

  it('isDev=false iken viewer ek izin almaz', () => {
    expect(hasPermission('viewer', 'archive.scan', false)).toBe(false);
    expect(hasPermission('viewer', 'settings.manage', false)).toBe(false);
  });

  it('hasPermissions viewer+developer çoklu izin kontrolü', () => {
    expect(hasPermissions('viewer', ['archive.scan', 'archive.refile', 'logs.view'], true)).toBe(true);
    expect(hasPermissions('viewer', ['archive.scan', 'archive.write'], true)).toBe(false);
  });

  it('admin isDev parametresinden bağımsız tüm izinlere sahiptir', () => {
    expect(hasPermission('admin', 'archive.scan', false)).toBe(true);
    expect(hasPermission('admin', 'archive.scan', true)).toBe(true);
    expect(hasPermission('admin', 'users.manage', false)).toBe(true);
  });
});

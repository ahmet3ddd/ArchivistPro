/* ── ArchivistPro: Role-Based Access Control ── */

export type AppRole = 'admin' | 'viewer';

export type Permission =
  // Ana arşiv
  | 'archive.read'
  | 'archive.write'
  | 'archive.delete'
  | 'archive.scan'
  | 'archive.refile'
  // Yerel dosya işlemleri
  | 'local.read'
  | 'local.write'
  | 'local.delete'
  | 'local.zip'
  // Yerel arşiv
  | 'local_archive.create'
  | 'local_archive.manage'
  | 'local_archive.share'
  // AI
  | 'ai.use'
  // Yönetim
  | 'users.manage'
  | 'settings.manage'
  | 'logs.view';

const ADMIN_PERMISSIONS: readonly Permission[] = [
  'archive.read', 'archive.write', 'archive.delete',
  'archive.scan', 'archive.refile',
  'local.read', 'local.write', 'local.delete', 'local.zip',
  'local_archive.create', 'local_archive.manage', 'local_archive.share',
  'ai.use',
  'users.manage', 'settings.manage', 'logs.view',
] as const;

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'archive.read',
  'local.read', 'local.write', 'local.delete', 'local.zip',
  'local_archive.create', 'local_archive.manage', 'local_archive.share',
  'ai.use',
] as const;

const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  admin: ADMIN_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/** Developer rolüne ek olarak verilen yetkiler */
export const DEVELOPER_EXTRA_PERMISSIONS: readonly Permission[] = [
  'archive.scan', 'archive.refile', 'settings.manage', 'logs.view',
] as const;

/** Runtime'da belirlenen aktif rol (login sonrası set edilir) */
let _runtimeRole: AppRole | null = null;

/** Runtime'da belirlenen geliştirici bayrağı */
let _runtimeIsDeveloper = false;

/** Login sonrası çağrılır — runtime rolünü ayarlar */
export function setRuntimeRole(role: AppRole | null): void {
  _runtimeRole = role;
}

/** Login sonrası çağrılır — geliştirici bayrağını ayarlar */
export function setRuntimeDeveloper(isDev: boolean): void {
  _runtimeIsDeveloper = isDev;
}

/** Runtime geliştirici bayrağını döndürür */
export function isDeveloper(): boolean {
  return _runtimeIsDeveloper;
}

/** Aktif rolü döndürür: runtime > build-time sırası */
export function getAppRole(): AppRole {
  if (_runtimeRole) return _runtimeRole;
  const envRole = import.meta.env.VITE_APP_ROLE;
  if (envRole === 'admin') return 'admin';
  return 'viewer';
}

/** Verilen rolün belirli bir yetkiye sahip olup olmadığını kontrol eder */
export function hasPermission(role: AppRole, permission: Permission, isDev?: boolean): boolean {
  if (ROLE_PERMISSIONS[role].includes(permission)) return true;
  // Developer bayrağı varsa ek yetkileri kontrol et
  if (isDev && (DEVELOPER_EXTRA_PERMISSIONS as readonly string[]).includes(permission)) return true;
  return false;
}

/** Verilen rolün birden fazla yetkiye sahip olup olmadığını kontrol eder */
export function hasPermissions(role: AppRole, permissions: Permission[], isDev?: boolean): boolean {
  return permissions.every(p => hasPermission(role, p, isDev));
}

/** Verilen rolün yetki listesini döndürür */
export function getPermissions(role: AppRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Admin mi? */
export function isAdmin(role: AppRole): boolean {
  return role === 'admin';
}

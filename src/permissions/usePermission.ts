/* ── ArchivistPro: Permission Hook ── */

import { useMemo } from 'react';
import { getAppRole, hasPermission, hasPermissions, isAdmin, type AppRole, type Permission } from './roles';
import { useStore } from '../store/useStore';

/** Tek bir yetki kontrolü — runtime rolü + developer bayrağı kullanır */
export function usePermission(permission: Permission): boolean {
  const storeRole = useStore((s) => s.currentRole);
  const isDev = useStore((s) => s.isDeveloper);
  const role = storeRole || getAppRole();
  return useMemo(() => hasPermission(role, permission, isDev), [role, permission, isDev]);
}

/** Birden fazla yetki kontrolü (hepsi gerekli) */
export function usePermissions(permissions: Permission[]): boolean {
  const storeRole = useStore((s) => s.currentRole);
  const isDev = useStore((s) => s.isDeveloper);
  const role = storeRole || getAppRole();
  return useMemo(() => hasPermissions(role, permissions, isDev), [role, permissions, isDev]);
}

/** Mevcut rolü döndürür (runtime > build-time) */
export function useAppRole(): AppRole {
  const storeRole = useStore((s) => s.currentRole);
  return storeRole || getAppRole();
}

/** Admin mi? */
export function useIsAdmin(): boolean {
  const storeRole = useStore((s) => s.currentRole);
  const role = storeRole || getAppRole();
  return isAdmin(role);
}

/** Geliştirici mi? */
export function useIsDeveloper(): boolean {
  return useStore((s) => s.isDeveloper);
}

/* ── ArchivistPro: Protected Action Component ── */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppRole, useIsDeveloper } from './usePermission';
import { hasPermission, hasPermissions, type Permission } from './roles';

interface ProtectedActionProps {
  /** Gerekli tek yetki */
  permission?: Permission;
  /** Gerekli birden fazla yetki (hepsi gerekli) */
  permissions?: Permission[];
  /** Yetki varsa gösterilecek içerik */
  children: ReactNode;
  /** Yetki yoksa gösterilecek içerik (opsiyonel) */
  fallback?: ReactNode;
  /**
   * Görünüm modu:
   * - 'hidden' (varsayılan): yetki yoksa gizle (veya fallback göster)
   * - 'disabled': yetki yoksa devre dışı + tooltip göster
   */
  mode?: 'hidden' | 'disabled';
}

export function ProtectedAction({ permission, permissions, children, fallback = null, mode = 'hidden' }: ProtectedActionProps) {
  const { t } = useTranslation();
  const role = useAppRole();
  const isDev = useIsDeveloper();

  const singleOk = permission ? hasPermission(role, permission, isDev) : true;
  const multiOk = permissions ? hasPermissions(role, permissions, isDev) : true;

  if (singleOk && multiOk) return <>{children}</>;

  if (mode === 'disabled') {
    return (
      <span
        title={t('permission.adminRequired')}
        style={{ opacity: 0.4, pointerEvents: 'none', cursor: 'not-allowed', display: 'inline-block' }}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}

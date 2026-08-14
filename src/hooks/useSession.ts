// Oturum hook'u — aktif oturumu store'dan okur + rol turetmeleri (gorunurluk icin).
//
// `role` oturumdan gelir (giris yoksa null). `isAdmin`/`isEditor`/`canWrite` UI
// gorunurluk kararlari icindir; GERCEK yetki Rust command icinde zorlanir (rbac.rs).
// `refresh` sunucu oturumunu yeniden ceker (logout/disardan degisim sonrasi).

import { useCallback } from "react";

import type { Role, Session } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useSessionStore } from "../store/useSessionStore";

export interface UseSession {
  session: Session | null;
  /** Aktif rol (giris yoksa null). */
  role: Role | null;
  /** admin? (kullanici yonetimi + ingest gorunurlugu). */
  isAdmin: boolean;
  /** Arşivin tek ana admini mi? */
  isFounder: boolean;
  /** editor veya admin? (kurasyon yazma gorunurlugu; viewer salt-okuma). */
  isEditor: boolean;
  /** Yazma kontrollerini goster mi? (= isEditor; viewer false). */
  canWrite: boolean;
  /** Sunucu oturumunu yeniden cek ve store'u guncelle. */
  refresh: () => Promise<void>;
}

export function useSession(): UseSession {
  const session = useSessionStore((s) => s.session);
  const setSession = useSessionStore((s) => s.setSession);

  const role = session?.role ?? null;
  const isAdmin = role === "admin";
  const isFounder = session?.is_founder === true && isAdmin;
  const isEditor = role === "admin" || role === "editor";

  const refresh = useCallback(async () => {
    const s = await ipc.currentSession();
    setSession(s);
  }, [setSession]);

  return { session, role, isAdmin, isFounder, isEditor, canWrite: isEditor, refresh };
}

// Oturum durumu — Zustand slice (tek-bag store YOK; odakli auth dilimi).
//
// Sunucu-tarafi kimlik-dogrulanmis oturumun renderer kopyasi. ROL BURADAN OKUNUR
// (istemci secemez; gercek yetki Rust command'da). `login`/`current_session`
// donusunu `setSession` ile yazar, `logout` sonrasi `clear` ile temizler.
// `must_change` yalniz `login` sonucundan gelir (zorunlu parola-degistir akisi).

import { create } from "zustand";

import type { Session } from "../ipc/client";

interface SessionState {
  /** Aktif oturum (giris yapilmamissa null). Rol gorunurluk kararlari buradan. */
  session: Session | null;
  /** Giris/oturum-tazeleme sonucu oturumu ata. */
  setSession: (session: Session | null) => void;
  /** Cikis sonrasi oturumu temizle. */
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clear: () => set({ session: null }),
}));

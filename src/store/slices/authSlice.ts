/**
 * Kullanıcı kimlik doğrulama ve oturum yönetimi state'i.
 */
import type { AppRole } from '../../permissions/roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetFn = (partial: any) => void;

export interface AuthSlice {
    currentUser: string | null;
    currentRole: AppRole | null;
    currentUserId: number | null;
    isBlockedFromMain: boolean;
    isDeveloper: boolean;
    setCurrentUser: (user: string | null, role: AppRole | null, userId?: number | null, isBlocked?: boolean, isDeveloper?: boolean) => void;
    setIsBlockedFromMain: (blocked: boolean) => void;
    isLoggedIn: boolean;
    logout: () => void;
    /** Kilit ekranı: oturum açık ama ekran kilitli (timeout sonrası). */
    isLocked: boolean;
    /** Ekranı kilitle — kullanıcı/rol/veri korunur, sadece şifre gerekir. */
    lockScreen: () => void;
    /** Kilit ekranından çık. */
    unlockScreen: () => void;
    /** Session timeout süresi (dakika). 0 = devre dışı. */
    sessionTimeoutMinutes: number;
    setSessionTimeoutMinutes: (minutes: number) => void;
    isSwitchingUser: boolean;
    startSwitchUser: () => void;
    cancelSwitchUser: () => void;
}

export function createAuthSlice(set: SetFn): AuthSlice {
    return {
        currentUser: null,
        currentRole: null,
        currentUserId: null,
        isLoggedIn: false,
        isBlockedFromMain: false,
        isDeveloper: false,
        setCurrentUser: (currentUser, currentRole, currentUserId = null, isBlocked = false, isDeveloper = false) =>
            set({ currentUser, currentRole, currentUserId, isBlockedFromMain: isBlocked, isDeveloper, isLoggedIn: currentUser !== null, isSwitchingUser: false }),
        setIsBlockedFromMain: (isBlockedFromMain) => set({ isBlockedFromMain }),
        logout: () => set({ currentUser: null, currentRole: null, currentUserId: null, isBlockedFromMain: false, isDeveloper: false, isLoggedIn: false, isSwitchingUser: false, isLocked: false }),
        isLocked: false,
        lockScreen: () => set({ isLocked: true }),
        unlockScreen: () => set({ isLocked: false }),
        sessionTimeoutMinutes: 30,
        setSessionTimeoutMinutes: (sessionTimeoutMinutes) => set({ sessionTimeoutMinutes }),
        isSwitchingUser: false,
        startSwitchUser: () => set({ isSwitchingUser: true }),
        cancelSwitchUser: () => set({ isSwitchingUser: false }),
    };
}

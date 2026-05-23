/**
 * Modal bayrakları — tüm boolean modal açık/kapalı state'leri,
 * confirm dialog, input dialog ve duplicate finder kontrolü.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetFn = (partial: any) => void;

export interface ModalSlice {
    /* ── Scan ── */
    isScanModalOpen: boolean;
    setIsScanModalOpen: (open: boolean) => void;
    /* ── AI / Chat ── */
    isAiConfigOpen: boolean;
    setIsAiConfigOpen: (open: boolean) => void;
    isAISetupOpen: boolean;
    setIsAISetupOpen: (open: boolean) => void;
    isChatOpen: boolean;
    setIsChatOpen: (open: boolean) => void;
    /* ── Görsel arama ── */
    isVisualSearchOpen: boolean;
    setIsVisualSearchOpen: (open: boolean) => void;
    isShapeSearchOpen: boolean;
    setIsShapeSearchOpen: (open: boolean) => void;
    /* ── DWG benzerlik araması ── */
    dwgSimilarityAssetId: string | null;
    setDwgSimilarityAssetId: (id: string | null) => void;
    /* ── Diğer modaller ── */
    isRefileModalOpen: boolean;
    setIsRefileModalOpen: (open: boolean) => void;
    isFeedbackModalOpen: boolean;
    setIsFeedbackModalOpen: (open: boolean) => void;
    isUserProfileOpen: boolean;
    setIsUserProfileOpen: (open: boolean) => void;
    isUserManagementOpen: boolean;
    setIsUserManagementOpen: (open: boolean) => void;
    isTagManagerOpen: boolean;
    setIsTagManagerOpen: (open: boolean) => void;
    isOnboardingTourOpen: boolean;
    setIsOnboardingTourOpen: (open: boolean) => void;
    /* ── Confirm / Input dialog ── */
    confirmDialog: { message: string; detail?: string; onConfirm: () => void; confirmLabel?: string; isDanger?: boolean; hideCancel?: boolean } | null;
    showConfirmDialog: (message: string, detail: string | undefined, onConfirm: () => void, confirmLabel?: string, isDanger?: boolean, hideCancel?: boolean) => void;
    dismissConfirmDialog: () => void;
    inputDialog: { message: string; defaultValue?: string; onConfirm: (value: string) => void } | null;
    showInputDialog: (message: string, defaultValue: string | undefined, onConfirm: (value: string) => void) => void;
    dismissInputDialog: () => void;
    /* ── Duplicate Finder ── */
    duplicateFinderOpen: boolean;
    duplicateFinderSeedAssetId: string | null;
    /** Sağ tık → "Benzerini Bul" alt seçeneğinden gelen başlangıç eşiği (0-100). null = default kullan. */
    duplicateFinderInitialThreshold: number | null;
    setDuplicateFinderOpen: (open: boolean, seedAssetId?: string | null, initialThreshold?: number | null) => void;
}

export function createModalSlice(set: SetFn): ModalSlice {
    return {
        isScanModalOpen: false,
        setIsScanModalOpen: (isScanModalOpen) => set({ isScanModalOpen }),
        isAiConfigOpen: false,
        setIsAiConfigOpen: (isAiConfigOpen) => set({ isAiConfigOpen }),
        isAISetupOpen: false,
        setIsAISetupOpen: (isAISetupOpen) => set({ isAISetupOpen }),
        isChatOpen: false,
        setIsChatOpen: (isChatOpen) => set({ isChatOpen }),
        isVisualSearchOpen: false,
        setIsVisualSearchOpen: (isVisualSearchOpen) => set({ isVisualSearchOpen }),
        isShapeSearchOpen: false,
        setIsShapeSearchOpen: (isShapeSearchOpen) => set({ isShapeSearchOpen }),
        dwgSimilarityAssetId: null,
        setDwgSimilarityAssetId: (dwgSimilarityAssetId) => set({ dwgSimilarityAssetId }),
        isRefileModalOpen: false,
        setIsRefileModalOpen: (isRefileModalOpen) => set({ isRefileModalOpen }),
        isFeedbackModalOpen: false,
        setIsFeedbackModalOpen: (isFeedbackModalOpen) => set({ isFeedbackModalOpen }),
        isUserProfileOpen: false,
        setIsUserProfileOpen: (isUserProfileOpen) => set({ isUserProfileOpen }),
        isUserManagementOpen: false,
        setIsUserManagementOpen: (isUserManagementOpen) => set({ isUserManagementOpen }),
        isTagManagerOpen: false,
        setIsTagManagerOpen: (isTagManagerOpen) => set({ isTagManagerOpen }),
        isOnboardingTourOpen: false,
        setIsOnboardingTourOpen: (isOnboardingTourOpen) => set({ isOnboardingTourOpen }),

        confirmDialog: null,
        showConfirmDialog: (message, detail, onConfirm, confirmLabel, isDanger, hideCancel) =>
            set({ confirmDialog: { message, detail, onConfirm, confirmLabel, isDanger, hideCancel } }),
        dismissConfirmDialog: () => set({ confirmDialog: null }),

        inputDialog: null,
        showInputDialog: (message, defaultValue, onConfirm) =>
            set({ inputDialog: { message, defaultValue, onConfirm } }),
        dismissInputDialog: () => set({ inputDialog: null }),

        duplicateFinderOpen: false,
        duplicateFinderSeedAssetId: null,
        duplicateFinderInitialThreshold: null,
        setDuplicateFinderOpen: (open, seedAssetId = null, initialThreshold = null) =>
            set({
                duplicateFinderOpen: open,
                duplicateFinderSeedAssetId: open ? (seedAssetId ?? null) : null,
                duplicateFinderInitialThreshold: open ? (initialThreshold ?? null) : null,
            }),
    };
}

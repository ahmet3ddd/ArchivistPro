import { create } from "zustand";

interface OnboardingState {
  open: boolean;
  openTour: () => void;
  closeTour: () => void;
}

/** AppShell'in otomatik açılışı ve Ayarlar'daki “rehberi göster” eylemi için küçük UI sinyali. */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,
  openTour: () => set({ open: true }),
  closeTour: () => set({ open: false }),
}));

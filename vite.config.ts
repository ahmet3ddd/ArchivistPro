import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri ile uyumlu Vite konfigurasyonu (sabit port; ekran temizleme kapali).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        // Buyuk ve nadiren degisen kutuphaneleri uygulama kodundan ayir. Bu, Tauri'nin ilk
        // yuklemesinde paralel indirme/cache saglar ve tek parca 1 MB+ bundle'i onler.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "zustand"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-virtuoso": ["react-virtuoso"],
          "vendor-tauri": ["@tauri-apps/api", "@tauri-apps/plugin-dialog"],
          "locale-tr": ["./src/i18n/locales/tr.json"],
          "locale-en": ["./src/i18n/locales/en.json"],
          "locale-ar": ["./src/i18n/locales/ar.json"],
          "locale-ja": ["./src/i18n/locales/ja.json"],
          "locale-zh": ["./src/i18n/locales/zh.json"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

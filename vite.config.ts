import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['sql.js'],
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['node_modules', '.git', 'e2e', '.claude/worktrees'],
    coverage: {
      exclude: [
        'src/i18n/locales/**',
        'src/tests/**',
        'node_modules/**',
        'e2e/**',
        '.claude/**',
      ],
    },
  },
})

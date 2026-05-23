import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['sql.js'],
    // @huggingface/transformers'ı pre-bundle ETME: v4 internal olarak co-bundled
    // ort wasm/mjs dosyalarını import.meta.url ile çözümlüyor. Pre-bundle bu
    // çözümlemeyi bozar.
    exclude: ['@huggingface/transformers'],
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

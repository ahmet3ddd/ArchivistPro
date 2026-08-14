// Vitest yapilandirmasi (frontend birim testleri; R4 — DENETIM_2026-07-07). Saf yardimci
// fonksiyonlar (format/paths/refileError) node ortaminda test edilir; DOM/bilesen testi ⏳
// (gerektiginde jsdom + @testing-library eklenir). vite.config'ten AYRI → build'i etkilemez.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

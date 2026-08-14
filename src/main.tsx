import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n"; // i18n'i render oncesi baslat (tr varsayilan)
import "./theme"; // tema/accent'i render oncesi <html>'e uygula (Faz 8.3; FOUC yok)
// Fontlar yerel paketlerden (tam offline; CDN yok) — Faz 8.1 gorsel tema temeli.
import "@fontsource-variable/sora"; // display/basliklar → font-display
import "@fontsource-variable/inter"; // govde → font-sans (varsayilan)
import "./index.css";

// Bu probe yalniz Vite gelistirme modundaki E2E URL parametresi durdukca hata atar. Test,
// "Devam Et"ten hemen once parametreyi kaldirir; bu nedenle hem fallback'i hem gecici hata
// sonrasi kurtarmayi gercekten kanitlar. Yalniz Playwright'in ayri `e2e` Vite modunda etkindir;
// uretim ve normal gelistirmede etkisizdir.
const E2E_RENDER_ERROR_PARAM = "__arsiv_h3_e2e_throw_render";
function E2eRenderErrorProbe() {
  const requested =
    (import.meta.env.MODE === "e2e" ||
      (window as Window & { __ARSIV_H3_E2E__?: boolean }).__ARSIV_H3_E2E__ === true) &&
    new URLSearchParams(window.location.search).has(E2E_RENDER_ERROR_PARAM);
  if (requested) throw new Error("E2E intentional ErrorBoundary render failure");
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  // ErrorBoundary EN DISTA: App icindeki her sey (gate ekranlari dahil) korunur —
  // yakalanmamis bir render hatasi bos pencere birakmasin (bkz ErrorBoundary.tsx).
  <React.StrictMode>
    <ErrorBoundary>
      <E2eRenderErrorProbe />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

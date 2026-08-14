// Kok hata siniri (React ErrorBoundary) — H2 `ErrorBoundary.tsx` paritesi.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu):
// H3'te hicbir ErrorBoundary YOKTU. React 19'da yakalanmamis bir render hatasi TUM agaci
// unmount eder → pencere tamamen bos kalir (ne mesaj ne buton) ve uygulamayi oldurmekten
// baska cikis yoktur. Ustelik hata teshis kanalina da DUSMEZ: admin'in "Crash raporlari"
// paneli yalniz Rust panik hook'unu okur → kullanici "ekran bembeyaz oldu" der, panelde
// hicbir kayit olmaz. H2 ayni olayda kurtarma karti + `writeCrashReport('react_error')`
// kaydi uretiyordu (H2 ErrorBoundary.tsx:17-39).
//
// Iki cikis yolu (H2 ile ayni):
//   - "Devam Et"      → state sifirlanir, uygulama AYNI oturumda yasamaya devam eder
//                       (gecici/render-anlik hatalarda veri kaybettirmez)
//   - "Yeniden Yukle" → tam reload (kalici bozulmada temiz baslangic)
//
// Hata backend'e `report_frontend_error` ile yazilir (best-effort; raporlama ikinci bir
// hataya yol acmamali → catch yutulur). i18n: t() burada KULLANILMAZ — hata i18n
// baslatmadan once/ici de olabilir; sabit TR+EN metin gosterilir (kurtarma yuzeyi
// her kosulda render olabilmeli).

import { Component, type ErrorInfo, type ReactNode } from "react";

import { ipc } from "../ipc/client";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort teshis kaydi. `componentStack` hatanin HANGI bilesende oldugunu soyler
    // (saha teshisinde asil degerli olan bu). Basarisizlik yutulur.
    void ipc
      .reportFrontendError(
        error.message || String(error),
        (info.componentStack ?? "").trim().split("\n")[0]?.trim() ?? "",
        error.stack ?? "",
      )
      .catch(() => undefined);
  }

  private handleDismiss = (): void => this.setState({ error: null });

  private handleReload = (): void => window.location.reload();

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-bg-primary p-8 text-center"
      >
        <span aria-hidden className="text-4xl">
          ⚠
        </span>
        <h1 className="font-display text-lg font-bold text-text-primary">
          Beklenmeyen bir hata olustu
          <span className="block text-sm font-normal text-text-muted">
            Something went wrong
          </span>
        </h1>
        {/* Hata metni: teshis icin gorunur ama tasmasin (uzun stack'ler pencereyi ezmesin). */}
        <pre className="max-h-40 max-w-xl overflow-auto rounded-md border border-border bg-bg-tertiary p-3 text-start text-xs text-text-secondary">
          {error.message || String(error)}
        </pre>
        <p className="max-w-md text-xs text-text-muted">
          Bu hata teshis kaydina yazildi (Ayarlar → Bakim → Crash raporlari). &quot;Devam
          Et&quot; calismaya kaldiginiz yerden devam etmeyi dener; sorun surerse yeniden
          yukleyin.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={this.handleDismiss}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-primary transition hover:bg-bg-tertiary hover:border-border-hover"
          >
            Devam Et
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Yeniden Yukle
          </button>
        </div>
      </div>
    );
  }
}

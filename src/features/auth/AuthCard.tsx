// Auth ekran kabugu — tam-ekran ortali kart (login/setup/parola-degistir paylasir).
// DRY: ortak yerlesim + baslik + dil secici; icerik children olarak gecer.

import type { ReactNode } from "react";

import { LanguageSelect } from "../settings/LanguageSelect";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: Props) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-bg-primary text-text-primary">
      <div className="absolute end-4 top-4">
        <LanguageSelect />
      </div>
      <div className="glass w-full max-w-sm p-6 shadow-xl">
        <h1 className="font-display text-xl font-bold text-accent">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** Ortak etiketli metin/parola girisi (auth formlari icin). */
export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoFocus,
  autoComplete,
  testId,
}: {
  label: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  /** Yalniz test-kancasi (E2E locator); UI davranisini/gorunumu ETKILEMEZ. Verilmezse oznitelik yazilmaz. */
  testId?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        data-testid={testId}
        className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm
                   text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/** Ortak birincil submit butonu (yukleme durumu destekli). */
export function AuthSubmit({
  label,
  busyLabel,
  busy,
  disabled,
  testId,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  /** Yalniz test-kancasi (E2E locator); UI davranisini/gorunumu ETKILEMEZ. Verilmezse oznitelik yazilmaz. */
  testId?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      data-testid={testId}
      className="mt-1 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition
                 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? busyLabel : label}
    </button>
  );
}

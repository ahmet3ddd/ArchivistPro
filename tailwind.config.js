/** @type {import('tailwindcss').Config} */
//
// Arsiv-H3 — Gorsel tema TEMELI (Faz 8.1)
//
// H2'nin tasarim token'lari `src/index.css` icinde `:root`'ta CSS-degiskeni
// olarak tanimli. Burada o degiskenleri Tailwind utility'lerine eslestiririz;
// boylece 8.2'de bilesenler `bg-bg-primary`, `text-text-muted`, `border-border`,
// `rounded-lg`, `font-display` gibi anlamsal siniflar kullanabilir. Hardcode
// renk YOK — tek dogruluk kaynagi CSS degiskenleridir (tema degisimi ileride
// yalniz degiskenleri degistirir).
//
// NOT: Mevcut bilesenler hala Tailwind'in yerlesik `slate-*` paletini kullanir.
// `theme.extend` kullandigimiz icin o palet KORUNUR; bu eklemeler uzerine biner.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `.glass` `@layer components` icinde tanimli; henuz hicbir bilesen kullanmadigi
  // icin (yeniden-stilleme 8.2) Tailwind onu agac-budar. Safelist ile her zaman
  // uretilmesini garanti ederiz → 8.2 `className="glass"` ekledigi an hazirdir.
  safelist: ["glass"],
  theme: {
    extend: {
      colors: {
        // Arka plan yuzeyleri → bg-bg-primary / bg-bg-secondary / bg-bg-tertiary / bg-bg-glass
        bg: {
          primary: "var(--color-bg-primary)",
          secondary: "var(--color-bg-secondary)",
          tertiary: "var(--color-bg-tertiary)",
          glass: "var(--color-bg-glass)",
          // Sol serit (ActivityBar) — temadan ayrisan SICAK gri → bg-bg-rail / bg-bg-rail-hover.
          rail: "var(--color-rail-bg)",
          "rail-hover": "var(--color-rail-bg-hover)",
        },
        // Vurgu → bg-accent (DEFAULT) / bg-accent-secondary / bg-accent-hover / bg-accent-glow
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          glow: "var(--color-accent-glow)",
          secondary: "var(--color-accent-secondary)",
        },
        // Metin → text-text-primary / text-text-secondary / text-text-muted
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        // Kenarlik → border-border (DEFAULT) / border-border-hover
        border: {
          DEFAULT: "var(--color-border)",
          hover: "var(--color-border-hover)",
        },
        // Durum → bg-success / text-warning / border-danger ...
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
      },
      borderRadius: {
        // rounded-sm/md/lg/xl → H2 yaricaplari (Tailwind varsayilanlarini ezer)
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        // font-display = Sora (basliklar) · font-sans = Inter (govde, varsayilan)
        display: [
          "Sora Variable",
          "Sora",
          "Inter Variable",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "Inter Variable",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        // shadow-glow → accent parilti (cam yuzey hover'i icin)
        glow: "var(--shadow-glow)",
      },
      // Toast giris animasyonu (alttan kayarak belirme). motion-reduce ile kapanir.
      keyframes: {
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "toast-in": "toast-in 180ms ease-out",
      },
    },
  },
  plugins: [],
};

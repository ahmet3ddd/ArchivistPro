// Parola politikasi (frontend kopyasi) — H2 `FirstRunSetup.tsx:46-47` paritesi.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H2 ilk kurulumda **≥6 karakter**
// dayatiyordu; H3'te bu kural sessizce dusmustu (`archivist-db/src/auth.rs` yalniz
// `is_empty()` bakiyordu) → arsivin tek admin hesabina `a` parolasi verilebiliyordu.
//
// ⚠️ GERCEK dayatma BACKEND'dedir (`auth.rs` → `password_too_short`); buradaki deger yalniz
// kullaniciya ANINDA geri bildirim icindir. Ikisi degisirse BIRLIKTE degismeli.

/** Asgari parola uzunlugu (H2 ile ayni: 6). */
export const MIN_PASSWORD_LEN = 6;

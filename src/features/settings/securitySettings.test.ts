import { describe, expect, it } from "vitest";

import {
  idlePhase,
  parseTimeoutMin,
  SESSION_TIMEOUT_DEFAULT_MIN,
  SESSION_WARNING_SECS,
} from "./securitySettings";

const MIN = 60_000;

describe("parseTimeoutMin", () => {
  it("eksik/bozuk deger → H2 varsayilani (30)", () => {
    expect(parseTimeoutMin(null)).toBe(SESSION_TIMEOUT_DEFAULT_MIN);
    expect(parseTimeoutMin("abc")).toBe(SESSION_TIMEOUT_DEFAULT_MIN);
    expect(parseTimeoutMin("-5")).toBe(SESSION_TIMEOUT_DEFAULT_MIN);
  });

  it("`0` GECERLIDIR (asla kilitleme) — varsayilana dusmez", () => {
    // Regresyon nobeti: `0` falsy oldugu icin `|| DEFAULT` yazilirsa "asla" secenegi
    // sessizce 30 dk'ya doner ve kullanici kapatamadigi bir kilitle karsilasir.
    expect(parseTimeoutMin("0")).toBe(0);
  });

  it("gecerli sayi aynen okunur", () => {
    expect(parseTimeoutMin("15")).toBe(15);
    expect(parseTimeoutMin("120")).toBe(120);
  });
});

describe("idlePhase", () => {
  it("`0` (asla) → hicbir zaman uyarmaz/kilitlemez", () => {
    expect(idlePhase(999 * MIN, 0).phase).toBe("active");
  });

  it("sure dolmadan once aktif", () => {
    expect(idlePhase(10 * MIN, 30).phase).toBe("active");
    // Uyari esiginin 1 sn oncesi hala aktif olmali (sinir testi).
    expect(idlePhase(30 * MIN - (SESSION_WARNING_SECS + 1) * 1000, 30).phase).toBe("active");
  });

  it("kilitten SESSION_WARNING_SECS once uyari asamasi baslar (H2: 60 sn)", () => {
    const r = idlePhase(30 * MIN - SESSION_WARNING_SECS * 1000, 30);
    expect(r.phase).toBe("warning");
    expect(r.secondsLeft).toBe(SESSION_WARNING_SECS);
  });

  it("uyari asamasinda kalan saniye geri sayar", () => {
    expect(idlePhase(30 * MIN - 10_000, 30).secondsLeft).toBe(10);
    expect(idlePhase(30 * MIN - 1_000, 30).secondsLeft).toBe(1);
  });

  it("sure dolunca kilit", () => {
    expect(idlePhase(30 * MIN, 30).phase).toBe("lock");
    expect(idlePhase(31 * MIN, 30).phase).toBe("lock");
  });
});

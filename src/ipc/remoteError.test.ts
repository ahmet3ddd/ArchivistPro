// Uzak arsiv hata token'i eslemesi (LAN Faz 2). Token'lar backend `RemoteError::token()`
// ile BIREBIR eslesir; burada TS tarafinin onlari dogru tanidigi + taninmayani YUTMADIGI
// dogrulanir (sessiz yutma teshisi imkansiz kilar — projenin bilinen dersi).

import { describe, expect, it } from "vitest";

import ar from "../i18n/locales/ar.json";
import en from "../i18n/locales/en.json";
import ja from "../i18n/locales/ja.json";
import tr from "../i18n/locales/tr.json";
import zh from "../i18n/locales/zh.json";
import { remoteErrorMessage, remoteErrorToken } from "./remote-archive";

/** ⚠️ Backend `RemoteError::token()` ile senkron olmali (Rust tarafinda da test var).
 *  Bu liste hem token tanimayi hem 5-dil i18n karsiligini besler — tek kaynak. */
const TOKENS = [
  "not_configured",
  "auth_failed",
  "timeout",
  "server_busy",
  "network_error",
  "bad_response",
  "remote_not_indexed", // LAN Faz 5: host'ta model/indeks yok (HTTP 503)
];

describe("remoteErrorToken", () => {
  it("backend'in tum tipli token'larini tanir", () => {
    for (const tok of TOKENS) {
      expect(remoteErrorToken(tok)).toBe(tok);
    }
  });

  it("Error nesnesinden ve bosluklu metinden token cikarir", () => {
    // Tauri invoke reject'i bazen string, bazen Error tasir.
    expect(remoteErrorToken(new Error("auth_failed"))).toBe("auth_failed");
    expect(remoteErrorToken("  timeout  ")).toBe("timeout");
  });

  it("taninmayan hatayi YUTMAZ (null doner → cagiran ham metni gosterir)", () => {
    expect(remoteErrorToken("bilinmeyen_hata")).toBeNull();
    expect(remoteErrorToken("veritabani kilitli")).toBeNull();
    expect(remoteErrorToken(null)).toBeNull();
    expect(remoteErrorToken(undefined)).toBeNull();
  });

  it("token'i iceren ama esit OLMAYAN metni eslestirmez", () => {
    // Gevsek `includes` eslemesi yanlis mesaj gosterirdi.
    expect(remoteErrorToken("failed: auth_failed happened somewhere")).toBeNull();
  });
});

describe("remoteErrorMessage (ortak esleme — ham token ekrana SIZMAZ)", () => {
  // ⚠️ REGRESYON: bu esleme once yalniz Pano ve gezginde vardi, Sohbet'in hata balonu
  // atlanmisti → canli testte ekranda ham "remote_not_indexed" cikti (2026-07-22 ekran
  // goruntusu). Tek fonksiyona cekildi; burasi sozlesmeyi kelepceler.
  const fakeT = (key: string) => `T[${key}]`;

  it("tipli token → cevrilmis metin (anahtar remote_archive.err_*)", () => {
    for (const tok of TOKENS) {
      expect(remoteErrorMessage(tok, fakeT)).toBe(`T[remote_archive.err_${tok}]`);
    }
  });

  it("Error nesnesi de cevrilir (Tauri reject bazen Error tasir)", () => {
    expect(remoteErrorMessage(new Error("remote_not_indexed"), fakeT)).toBe(
      "T[remote_archive.err_remote_not_indexed]",
    );
  });

  it("taninmayan hata YUTULMAZ — ham metniyle gecer", () => {
    expect(remoteErrorMessage("veritabani kilitli", fakeT)).toBe("veritabani kilitli");
    expect(remoteErrorMessage(new Error("beklenmedik"), fakeT)).toBe("Error: beklenmedik");
  });
});

describe("token → i18n karsiligi (5 dil)", () => {
  // Cagiranlar anahtari SABLONLA kurar: t(`remote_archive.err_${token}`) — RemoteArchiveSummary
  // ve useAssets. Sablonlu anahtar STATIK taramayla bulunamaz, tsc de kontrol etmez ⇒ eksik
  // ceviri ancak KULLANICI hatayi gordugunde ("remote_archive.err_timeout" ham metni) ortaya
  // cikardi. Bu test o bosluğu kapatir: yeni token ekleyen 5 dili de eklemek ZORUNDA.
  const LOCALES: Record<string, { remote_archive: Record<string, string> }> = { tr, en, ar, ja, zh };

  for (const [lang, dict] of Object.entries(LOCALES)) {
    it(`${lang}: her token icin err_* metni var (bos degil)`, () => {
      for (const tok of TOKENS) {
        const msg = dict.remote_archive[`err_${tok}`];
        expect(msg, `${lang}.remote_archive.err_${tok} eksik`).toBeTruthy();
        expect(msg.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it("5 dil AYNI token kumesini kapsar (bir dilde fazla/eksik err_* kalmaz)", () => {
    const expected = TOKENS.map((t) => `err_${t}`).sort();
    for (const [lang, dict] of Object.entries(LOCALES)) {
      const actual = Object.keys(dict.remote_archive)
        .filter((k) => k.startsWith("err_"))
        .sort();
      expect(actual, `${lang} err_* kumesi`).toEqual(expected);
    }
  });
});

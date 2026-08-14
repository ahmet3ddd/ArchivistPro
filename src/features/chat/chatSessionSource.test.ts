// Sohbet oturumu ↔ arsiv kaynagi karari (v26).
//
// Neden bu testler var: burasi "yanlis dosya" hatasinin son savunma hatti. Bir sohbet UZAK
// modda uretilmisse atiflari HOST id'leridir; yerel modda o id BASKA dosyadir. Kapi acilir
// kalirsa kullanici sessizce yanlis dosyayi acar — Faz 2'de kapatilan sinifin aynisi.
// Ozellikle "bilinmiyor"un (null host etiketi) ESLESME sayilmamasi kelepcelenir.

import { describe, expect, it } from "vitest";

import ar from "../../i18n/locales/ar.json";
import en from "../../i18n/locales/en.json";
import ja from "../../i18n/locales/ja.json";
import tr from "../../i18n/locales/tr.json";
import zh from "../../i18n/locales/zh.json";
import type { ChatSession } from "../../ipc/client";
import {
  citationGate,
  openOtherSession,
  partitionSessions,
  sessionSource,
  type CitationBlockReason,
} from "./chatSessionSource";

/** Test oturumu — yalniz ilgilenilen alanlar ezilir. */
function session(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "cs_1",
    title: "S",
    createdAt: 1,
    updatedAt: 1,
    source: "local",
    hostLabel: null,
    ...over,
  };
}

describe("sessionSource", () => {
  it("'remote' disindaki her sey yerel sayilir (bilinmeyen deger uzak SAYILMAZ)", () => {
    expect(sessionSource(session({ source: "remote" }))).toBe("remote");
    expect(sessionSource(session({ source: "local" }))).toBe("local");
    // Bozuk/eski veri uzak sayilsaydi, yanlis host'a soru sorulurdu.
    expect(sessionSource(session({ source: "sacma" }))).toBe("local");
  });
});

describe("partitionSessions", () => {
  const sessions = [
    session({ id: "a", source: "local" }),
    session({ id: "b", source: "remote", hostLabel: "10.0.0.2:9471" }),
    session({ id: "c", source: "local" }),
  ];

  it("aktif kaynagi 'current', digerini 'other' yapar", () => {
    const local = partitionSessions(sessions, "local");
    expect(local.current.map((s) => s.id)).toEqual(["a", "c"]);
    expect(local.other.map((s) => s.id)).toEqual(["b"]);

    const remote = partitionSessions(sessions, "remote");
    expect(remote.current.map((s) => s.id)).toEqual(["b"]);
    expect(remote.other.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("sirayi KORUR (backend updated_at DESC verir; bolme yeniden siralamaz)", () => {
    const ordered = [
      session({ id: "yeni", source: "local", updatedAt: 300 }),
      session({ id: "orta", source: "local", updatedAt: 200 }),
      session({ id: "eski", source: "local", updatedAt: 100 }),
    ];
    expect(partitionSessions(ordered, "local").current.map((s) => s.id)).toEqual([
      "yeni",
      "orta",
      "eski",
    ]);
  });

  it("hicbir oturum DUSMEZ (current + other = girdi)", () => {
    const p = partitionSessions(sessions, "local");
    expect(p.current.length + p.other.length).toBe(sessions.length);
  });
});

describe("citationGate — atif tiklamasi ne zaman acik", () => {
  it("yerel oturum + yerel kaynak → ACIK", () => {
    expect(citationGate(session(), "local", null)).toEqual({ ok: true });
  });

  it("uzak oturum + AYNI host → ACIK", () => {
    const s = session({ source: "remote", hostLabel: "10.0.0.2:9471" });
    expect(citationGate(s, "remote", "10.0.0.2:9471")).toEqual({ ok: true });
  });

  it("🔒 kaynak uyusmuyor → KAPALI (host id'si yerel DB'de BASKA dosyadir)", () => {
    const uzak = session({ source: "remote", hostLabel: "10.0.0.2:9471" });
    expect(citationGate(uzak, "local", null)).toEqual({
      ok: false,
      reason: "source_mismatch",
    });
    const yerel = session({ source: "local" });
    expect(citationGate(yerel, "remote", "10.0.0.2:9471")).toEqual({
      ok: false,
      reason: "source_mismatch",
    });
  });

  it("🔒 ikisi de uzak AMA farkli host → KAPALI (id uzayi yine degisti)", () => {
    const s = session({ source: "remote", hostLabel: "10.0.0.2:9471" });
    expect(citationGate(s, "remote", "192.168.1.5:9471")).toEqual({
      ok: false,
      reason: "host_mismatch",
    });
  });

  it("🔒 host etiketi BILINMIYOR → KAPALI ('bilinmiyor' asla 'ayni' sayilmaz)", () => {
    // Ikisi de null olsa bile ACILMAZ: iki farkli host da 'etiketsiz' olabilir.
    expect(citationGate(session({ source: "remote", hostLabel: null }), "remote", null)).toEqual({
      ok: false,
      reason: "host_mismatch",
    });
    expect(
      citationGate(session({ source: "remote", hostLabel: "10.0.0.2:9471" }), "remote", null),
    ).toEqual({ ok: false, reason: "host_mismatch" });
    expect(citationGate(session({ source: "remote", hostLabel: null }), "remote", "10.0.0.2:9471"))
      .toEqual({ ok: false, reason: "host_mismatch" });
  });

  it("oturum YOK (kalicilik kurulamamis canli sohbet) → ACIK", () => {
    // Atiflar o anki kaynaktan yeni uretildi; kisitlamak islevi bosuna kapatirdi.
    expect(citationGate(null, "remote", "10.0.0.2:9471")).toEqual({ ok: true });
    expect(citationGate(undefined, "local", null)).toEqual({ ok: true });
  });
});

describe("openOtherSession — diger kaynagin sohbetini acmak", () => {
  it("yerele donmek daima serbest", () => {
    expect(openOtherSession(session({ source: "local" }), false)).toEqual({
      kind: "switch",
      to: "local",
    });
  });

  it("uzak oturum + uzak arsiv hazir → kaynak degisimi", () => {
    const s = session({ source: "remote", hostLabel: "10.0.0.2:9471" });
    expect(openOtherSession(s, true)).toEqual({ kind: "switch", to: "remote" });
  });

  it("uzak oturum AMA ana arsive ulasilamiyor → ENGELLI (tipli sebep)", () => {
    const s = session({ source: "remote", hostLabel: "10.0.0.2:9471" });
    expect(openOtherSession(s, false)).toEqual({ kind: "blocked", reason: "not_paired" });
  });
});

describe("sebep token'lari → i18n karsiligi (5 dil)", () => {
  // Anahtarlar SABLONLA kuruluyor: t(`chat.cite_blocked.${reason}`) ve
  // t(`chat.open_other_blocked.${reason}`). Sablonlu anahtari ne tsc ne statik tarama gorur →
  // eksik ceviri ancak kullanici ham anahtari ekranda gorunce anlasilirdi (remote_archive.err_*
  // ile ayni tuzak, bkz src/ipc/remoteError.test.ts).
  const CITE_REASONS: CitationBlockReason[] = ["source_mismatch", "host_mismatch"];
  const OPEN_REASONS = ["not_paired"];
  // Yalniz DOKUNULAN alt-bolumler tiplenir — `chat` duz metin anahtarlari da tasidigi icin
  // tumunu `Record<string, Record<string, string>>` saymak yanlis olurdu.
  interface ChatLocale {
    chat: {
      cite_blocked: Record<string, string>;
      open_other_blocked: Record<string, string>;
      other_source: Record<string, string>;
    };
  }
  const LOCALES: Record<string, ChatLocale> = { tr, en, ar, ja, zh };

  for (const [lang, dict] of Object.entries(LOCALES)) {
    it(`${lang}: her sebep icin metin var (bos degil)`, () => {
      for (const r of CITE_REASONS) {
        const msg = dict.chat.cite_blocked[r];
        expect(msg, `${lang}.chat.cite_blocked.${r} eksik`).toBeTruthy();
      }
      for (const r of OPEN_REASONS) {
        const msg = dict.chat.open_other_blocked[r];
        expect(msg, `${lang}.chat.open_other_blocked.${r} eksik`).toBeTruthy();
      }
      // Bolum basliklari da sablonsuz ama ayni ozellige ait — birlikte tutulur.
      expect(dict.chat.other_source.remote).toBeTruthy();
      expect(dict.chat.other_source.local).toBeTruthy();
      expect(dict.chat.other_source.open_hint).toBeTruthy();
    });
  }
});

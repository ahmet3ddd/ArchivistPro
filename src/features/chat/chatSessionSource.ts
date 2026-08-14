// Sohbet oturumu ↔ ARSIV KAYNAGI eslemesi — saf karar katmani (test'li; `assetSource.ts` deseni).
//
// SORUN (kullanici bulgusu, canli test): "Ana arsiv" ile "Bu makine" arasinda gecince AYNI sohbet
// listesi goruluyordu — oysa uzak modda cevabin ATIFLARI HOST asset id'leridir. Oturum kaynaksiz
// oldugu icin, uzak modda uretilmis bir sohbet yerelde acilip atifina tiklandiginda
// `get_asset(hostId)` YEREL DB'de BASKA dosyayi getiriyordu (sessizce). Bu, Faz 2'de kapatilan
// "yanlis dosya" sinifinin ta kendisi; sohbet gecmisi kapidan kacmisti cunku store state DEGIL,
// DB'de kaliciydi (migration 0026 etiketi ekledi).
//
// BURADAKI IKI KARAR:
//  1) Liste kaynaga gore BOLUNUR — aktif kaynagin sohbetleri gorunur, digerleri GIZLENMEZ
//     (gorunur bir bolumde sayisiyla durur). "Fazla kapatma" dersi: sessizce kaybolan gecmis
//     veri kaybi gibi okunur; gorunur ama ayri durmali.
//  2) Atif tiklamasi yalniz oturumun KENDI kaynagi aktifken calisir. Kapi burada, tek yerde.

import type { ChatSession } from "../../ipc/client";
import type { AssetSource } from "../../store/assetSource";

/** Oturumun kaynagi (v26 oncesi satirlar backend'de 'local' ile dolduruldu → alan daima dolu).
 *  Yine de savunmaci: taninmayan/eksik deger 'local' sayilir (yerel = kisitlayici olmayan taraf
 *  DEGIL; ama uzak saymak yanlis host'a soru sormaya yol acardi). */
export function sessionSource(s: ChatSession): AssetSource {
  return s.source === "remote" ? "remote" : "local";
}

/** Kaynaga gore bolunmus oturum listesi — `current` cizilir, `other` gorunur bir bolumde sayilir. */
export interface SessionPartition {
  current: ChatSession[];
  other: ChatSession[];
}

/** Listeyi aktif kaynaga gore bol. Sira KORUNUR (backend updated_at DESC verir). */
export function partitionSessions(
  sessions: ChatSession[],
  source: AssetSource,
): SessionPartition {
  const current: ChatSession[] = [];
  const other: ChatSession[] = [];
  for (const s of sessions) (sessionSource(s) === source ? current : other).push(s);
  return { current, other };
}

/** Atif tiklamasinin neden kapali oldugu — UI tipli mesaj gosterir (ham token DEGIL). */
export type CitationBlockReason =
  /** Oturum baska bir arsivin sohbeti (uzak sohbet yereldeyken acik vb.). */
  | "source_mismatch"
  /** Uzak oturum AMA su an BASKA bir ana arsive eslesik → id uzayi yine farkli. */
  | "host_mismatch";

export type CitationGate = { ok: true } | { ok: false; reason: CitationBlockReason };

/**
 * Bu oturumun atiflari su anki baglamda ACILABILIR mi?
 *
 * Kural: atif id'si yalniz KENDI arsivinde anlamlidir.
 *  - oturum kaynagi ≠ aktif kaynak → `source_mismatch` (yerel DB'de host id'si BASKA dosyadir).
 *  - ikisi de uzak AMA host etiketi farkli → `host_mismatch` (baska ana arsive eslesilmis;
 *    id uzayi yine degisti). Etiketlerden biri bilinmiyorsa (null) ESLESMIS SAYILMAZ —
 *    "bilinmiyor"u "ayni" saymak tam da sessiz yanlis-dosyayi geri getirirdi.
 *
 * `currentHostLabel`: su anki eslesmenin host etiketi (`useRemoteArchive` → hostLabel).
 */
export function citationGate(
  session: ChatSession | null | undefined,
  currentSource: AssetSource,
  currentHostLabel: string | null | undefined,
): CitationGate {
  // Oturum yok (kalicilik kurulamamis canli sohbet) → atiflar o anki kaynaga aittir, serbest.
  if (!session) return { ok: true };

  if (sessionSource(session) !== currentSource) return { ok: false, reason: "source_mismatch" };
  if (currentSource === "local") return { ok: true };

  const sessionHost = session.hostLabel ?? null;
  const current = currentHostLabel ?? null;
  if (sessionHost === null || current === null || sessionHost !== current) {
    return { ok: false, reason: "host_mismatch" };
  }
  return { ok: true };
}

/** "Diger kaynak" bolumundeki bir oturumu acmaya calisinca ne olur. Acmak KAYNAK DEGISIMI
 *  demektir (uzak sohbet ancak uzak arsiv aktifken dogru calisir) → sessizce yapilmaz:
 *  UI "Ana arsive gec ve ac" gibi ACIK bir eylem gosterir, ya da neden yapilamadigini soyler. */
export type OpenOtherSession =
  | { kind: "switch"; to: AssetSource }
  | { kind: "blocked"; reason: "not_paired" };

/** `remoteAvailable`: su an uzak arsiv kullanilabilir mi (eslesme var + host'a ulasilabiliyor —
 *  `useRemoteArchive`). Uzak bir oturumu acmak icin SART; yerele donmek daima serbest. */
export function openOtherSession(
  session: ChatSession,
  remoteAvailable: boolean,
): OpenOtherSession {
  const target = sessionSource(session);
  if (target === "remote" && !remoteAvailable) return { kind: "blocked", reason: "not_paired" };
  return { kind: "switch", to: target };
}

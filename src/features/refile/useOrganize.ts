// "Kural ile duzenle" akisi (paylasimli hook) — refile'in devami. Cok-seviyeli KOMPOZISYON
// (structures[]) + Tasi/Kopyala (mode) + plan (onizleme) + calistir durumunu yonetir.
//
// Bu hook TUM kompozisyon durumunu sahiplenir (structures + mode) → modal yalniz gorunum/etkilesim:
//   • structures: sirali boyut listesi (her biri bir klasor katmani). add/remove/move ile duzenlenir.
//   • Boyut listesi HER degistiginde plan otomatik yeniden yuklenir (salt-okuma ONIZLEME).
//     Yaris korumasi: hizli degisimde (surukle-sirala) yalniz SON istegin sonucu uygulanir.
//   • execute(destRoot) → organizeAssets(ids, destRoot, structures, mode; Channel/ilerleme) →
//     ozet toast + onComplete (bumpData). Basari → true (modal kapansin), hata → false (acik kalir).
// Yetki ADMIN (gate backend'de; UI yalniz gorunum). i18n zorunlu; hatalar organizeErrorMessage ile.

import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OrganizePlanItem } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { refileErrorMessage } from "./refileError";

/** Duzenleme boyutu — bir klasor katmani. Backend `structures` degeri ile birebir. */
export type OrganizeDimension =
  | "byExt"
  | "byClient"
  | "byTag"
  | "byApproval"
  | "byVersion"
  | "byYear";

/** Islem modu — backend `mode` degeri ile birebir. `move` = tasi, `copy` = kopyala. */
export type OrganizeMode = "move" | "copy";

/** 6 boyutun UI siralamasi ("seviye ekle" butonlari bu sirayla cizilir). */
export const ORGANIZE_DIMENSIONS: readonly OrganizeDimension[] = [
  "byExt",
  "byClient",
  "byTag",
  "byApproval",
  "byVersion",
  "byYear",
];

/** Baslangic kompozisyonu — 2 seviyeli (H2 tek-sablonunu asar): Musteri › Dosya turu. */
const DEFAULT_STRUCTURES: OrganizeDimension[] = ["byClient", "byExt"];

/** Organize hata cevirisi — komut-geneli kodlar → organize.err.*; digerleri refile eslemesine duser
 *  (source_missing/target_exists/io:<detay>… → refile.err.*). */
function organizeErrorMessage(err: unknown, t: TFunction): string {
  const raw = (typeof err === "string" ? err : err instanceof Error ? err.message : String(err)).trim();
  if (raw === "invalid_structure") return t("organize.err.invalid_structure");
  if (raw === "invalid_mode") return t("organize.err.invalid_mode");
  if (raw === "invalid_dest") return t("organize.err.invalid_dest");
  if (raw.startsWith("dest_create_failed")) return t("organize.err.dest_create_failed");
  return refileErrorMessage(err, t);
}

export interface UseOrganize {
  /** Sirali boyut kompozisyonu (her oge bir klasor katmani; yol onizlemesi + agac bundan turer). */
  structures: OrganizeDimension[];
  /** Sona boyut ekle (zaten varsa yok sayilir). */
  addStructure: (dim: OrganizeDimension) => void;
  /** `index`'teki boyutu kaldir. */
  removeStructure: (index: number) => void;
  /** Boyutu `from` → `to` tasi (surukle-sirala). */
  moveStructure: (from: number, to: number) => void;
  /** Islem modu (Tasi/Kopyala) — buton metnini ve calistirmayi etkiler. */
  mode: OrganizeMode;
  setMode: (mode: OrganizeMode) => void;
  /** Son plan sonucu (hedef-koke goreli klasor segmentleri + dosya adi). */
  plan: OrganizePlanItem[];
  /** planOrganize su an calisiyor mu (onizleme yukleniyor). */
  planning: boolean;
  /** Plan hatasi (or. invalid_structure) → yerel metin; null = hata yok. */
  planError: string | null;
  /** organizeAssets su an calisiyor mu (buton kilidi). */
  running: boolean;
  /** Canli ilerleme (buton metni: "Duzenleniyor… processed/total"). */
  progress: { processed: number; total: number };
  /** Kurala gore tasi/kopyala → ozet toast + onComplete. Basari → true (kapat), hata → false. */
  execute: (destRoot: string) => Promise<boolean>;
}

/** `onComplete` duzenleme BASARIYLA calistiktan sonra (grid tazeleme / bumpData). */
export function useOrganize(ids: number[], onComplete?: () => void): UseOrganize {
  const { t } = useTranslation();
  const toast = useToast();
  const [structures, setStructures] = useState<OrganizeDimension[]>(DEFAULT_STRUCTURES);
  const [mode, setMode] = useState<OrganizeMode>("move");
  const [plan, setPlan] = useState<OrganizePlanItem[]>([]);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  // Yaris korumasi: kompozisyon hizli degisince (surukle-sirala) yalniz SON istegin sonucu uygulanir.
  const reqRef = useRef(0);

  // Onizlemeyi (yeniden) yukle. `structures`/`ids` degisince tetiklenir; eskimis cevaplar yutulur.
  const reload = useCallback(async () => {
    const req = ++reqRef.current;
    setPlanning(true);
    setPlanError(null);
    if (ids.length === 0) {
      setPlan([]);
      setPlanning(false);
      return;
    }
    try {
      const items = await ipc.planOrganize(ids, structures);
      if (req !== reqRef.current) return; // eskimis → yut
      setPlan(items);
    } catch (e) {
      if (req !== reqRef.current) return;
      setPlan([]);
      setPlanError(organizeErrorMessage(e, t));
    } finally {
      if (req === reqRef.current) setPlanning(false);
    }
  }, [ids, structures, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addStructure = useCallback((dim: OrganizeDimension) => {
    setStructures((prev) => (prev.includes(dim) ? prev : [...prev, dim]));
  }, []);

  const removeStructure = useCallback((index: number) => {
    setStructures((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveStructure = useCallback((from: number, to: number) => {
    setStructures((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const execute = useCallback(
    async (destRoot: string): Promise<boolean> => {
      if (running || ids.length === 0) return false;
      setRunning(true);
      setProgress({ processed: 0, total: ids.length });
      try {
        const report = await ipc.organizeAssets(ids, destRoot, structures, mode, (p) =>
          setProgress({ processed: p.processed, total: p.total }),
        );
        const summary = t("organize.summary", {
          moved: report.moved,
          skipped: report.skipped.length,
          failed: report.failed.length,
        });
        if (report.failed.length > 0) toast.error(summary);
        else toast.success(summary);
        onComplete?.();
        return true;
      } catch (e) {
        // Ust-seviye hata (or. yetki reddi / invalid_structure / invalid_mode) → thrown kod → i18n.
        toast.error(organizeErrorMessage(e, t));
        return false;
      } finally {
        setRunning(false);
      }
    },
    [running, ids, structures, mode, t, toast, onComplete],
  );

  return {
    structures,
    addStructure,
    removeStructure,
    moveStructure,
    mode,
    setMode,
    plan,
    planning,
    planError,
    running,
    progress,
    execute,
  };
}

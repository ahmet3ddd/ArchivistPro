// H2 → H3 KAYIPSIZ veri aktarimi sihirbazi (kullanici karari 2026-08-10).
//
// Adimlar: ① aday sec → ② envanter → ③ secenekler + KURU KOSU → ④ onay + UYGULA → ⑤ sonuc.
// Kuru kosu raporu uygulamayla AYNI motordan cikar (backend simetri testiyle kilitli) —
// kullanicinin "kuru kosuda gordugum = uygulanan" guveni bu simetriye dayanir.
// Uygula oncesi backend OTOMATIK yedek alir (snapshots/pre-h2-import-*.db); islem
// idempotent'tir: yarida kesilirse yeniden kosmak guvenlidir (ikinci kosu no-op).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  H2CandidateDb,
  H2ImportOptions,
  H2ImportProgress,
  H2ImportReport,
  H2Inventory,
} from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { Spinner } from "../../components/Spinner";
import { formatBytes, formatNumber } from "../../lib/format";
import { RootsPanel } from "../roots/RootsPanel";

type Step = "pick" | "inventory" | "dryrun" | "confirm" | "applying" | "done";

export function H2ImportWizard({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>("pick");
  const [candidates, setCandidates] = useState<H2CandidateDb[] | null>(null);
  const [picked, setPicked] = useState<H2CandidateDb | null>(null);
  const [inventory, setInventory] = useState<H2Inventory | null>(null);
  const [opts, setOpts] = useState<H2ImportOptions>({
    includeDeleted: true,
    includeThumbnails: true,
  });
  const [dryReport, setDryReport] = useState<H2ImportReport | null>(null);
  const [result, setResult] = useState<H2ImportReport | null>(null);
  const [progress, setProgress] = useState<H2ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sonuc adimindan acilan "Kaynak Klasorler" paneli — devir teslimin kendisi (asagi bak).
  const [rootsOpen, setRootsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void ipc
      .h2ImportCandidates()
      .then((c) => {
        if (alive) setCandidates(c);
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const num = (n: number) => formatNumber(n, i18n.language);

  const pick = async (c: H2CandidateDb) => {
    setPicked(c);
    setBusy(true);
    setError(null);
    try {
      setInventory(await ipc.h2ImportInventory(c.path));
      setStep("inventory");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runDry = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      setDryReport(await ipc.h2ImportDryRun(picked.path, opts, setProgress));
      setStep("dryrun");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runApply = async () => {
    if (!picked) return;
    setStep("applying");
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      setResult(await ipc.h2ImportApply(picked.path, opts, setProgress));
      setStep("done");
    } catch (e) {
      setError(String(e));
      setStep("confirm"); // yeniden denenebilir (idempotent)
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Rapor satiri: yalniz 0'dan farkli degerler gosterilir (gurultusuz ozet).
  const reportRows = (r: H2ImportReport): [string, number][] =>
    (
      [
        ["legacy.import.res_inserted", r.assetsInserted],
        ["legacy.import.res_existing", r.assetsExisting],
        ["legacy.import.res_deleted_carried", r.assetsDeletedCarried],
        ["legacy.import.res_deleted_conflicts", r.deletedConflicts],
        ["legacy.import.res_duplicates", r.duplicateH2Rows],
        ["legacy.import.res_ai", r.aiWritten],
        ["legacy.import.res_ai_skipped", r.aiSkippedExisting],
        ["legacy.import.res_ai_thin", r.aiSkippedThin],
        ["legacy.import.res_gorsel_turu", r.gorselTuruWritten],
        ["legacy.import.res_tags", r.tagsWritten],
        ["legacy.import.res_favorites", r.favoritesWritten],
        ["legacy.import.res_collections", r.collectionsCreated],
        ["legacy.import.res_collection_items", r.collectionItemsWritten],
        ["legacy.import.res_project_meta", r.projectMetaWritten],
        ["legacy.import.res_roots", r.rootsAdded],
        ["legacy.import.res_groups", r.groupsCreated],
        ["legacy.import.res_root_tags", r.rootTagsWritten],
        ["legacy.import.res_thumbnails", r.thumbnailsCarried],
        ["legacy.import.res_bad_times", r.unparsableTimes],
        ["legacy.import.res_errors", r.errors.length + r.droppedErrors],
      ] as [string, number][]
    ).filter(([, v]) => v > 0);

  const label = "flex items-center gap-2 text-xs text-text-secondary";
  const btn =
    "rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
  const btnGhost =
    "rounded-md border border-text-muted/30 px-4 py-1.5 text-sm text-text-secondary transition hover:text-text-primary";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-accent/40 bg-bg-secondary p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">{t("legacy.import.title")}</h4>
        <button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">
          {t("common.close")}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* ① Aday sec */}
      {step === "pick" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">{t("legacy.import.pick_hint")}</p>
          {candidates == null && <Spinner />}
          {candidates != null && candidates.filter((c) => c.exists).length === 0 && (
            <p className="text-xs text-text-muted">{t("legacy.import.no_candidates")}</p>
          )}
          {candidates?.filter((c) => c.exists).map((c) => (
            <button
              key={c.path}
              type="button"
              disabled={busy}
              onClick={() => void pick(c)}
              className="flex flex-col gap-0.5 rounded-md border border-text-muted/20 bg-bg-tertiary px-3 py-2 text-left transition hover:border-accent"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                {c.label}
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                  {t(`legacy.import.kind_${c.kind}`)}
                </span>
                {c.lockedHint && (
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                    {t("legacy.import.locked_hint")}
                  </span>
                )}
                {c.trashed && (
                  <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger">
                    {t("legacy.import.trashed")}
                  </span>
                )}
              </span>
              <span dir="ltr" className="truncate text-[11px] text-text-muted" title={c.path}>
                {c.path}
              </span>
              <span className="text-[11px] text-text-muted">
                {formatBytes(c.sizeBytes, i18n.language)}
                {c.assetCount != null &&
                  ` · ${t("legacy.import.asset_count", { count: c.assetCount })}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ② Envanter */}
      {step === "inventory" && inventory && (
        <div className="flex flex-col gap-2">
          <table className="text-xs text-text-secondary">
            <tbody>
              {(
                [
                  ["legacy.import.inv_assets", num(inventory.assets)],
                  ["legacy.import.inv_deleted", num(inventory.assetsDeleted)],
                  ["legacy.import.inv_ai", num(inventory.assetsWithAi)],
                  ["legacy.import.inv_thumbs", num(inventory.assetsWithThumbnail)],
                  ["legacy.import.inv_tags", num(inventory.assetTags)],
                  ["legacy.import.inv_favorites", num(inventory.favorites)],
                  ["legacy.import.inv_collections", num(inventory.collections)],
                  ["legacy.import.inv_roots", num(inventory.scannedRoots)],
                  ["legacy.import.inv_project", num(inventory.projectMetaRows)],
                ] as [string, string][]
              ).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4">{t(k)}</td>
                  <td className="text-right tabular-nums text-text-primary">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!inventory.hasCuratedData && (
            <p className="text-[11px] text-text-muted">{t("legacy.import.inv_no_curated")}</p>
          )}
          {(inventory.users.length > 0 || inventory.chatSessions > 0) && (
            <p className="rounded-md bg-bg-tertiary px-3 py-2 text-[11px] leading-relaxed text-text-muted">
              {t("legacy.import.not_carried", {
                users: inventory.users.map((u) => u.username).join(", ") || "—",
                chats: num(inventory.chatSessions),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label className={label}>
              <input
                type="checkbox"
                checked={opts.includeDeleted}
                onChange={(e) => setOpts({ ...opts, includeDeleted: e.target.checked })}
              />
              {t("legacy.import.opt_deleted")}
            </label>
            <label className={label}>
              <input
                type="checkbox"
                checked={opts.includeThumbnails}
                onChange={(e) => setOpts({ ...opts, includeThumbnails: e.target.checked })}
              />
              {t("legacy.import.opt_thumbnails")}
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void runDry()} disabled={busy} className={btn}>
              {busy ? t("legacy.import.running_dry") : t("legacy.import.run_dry")}
            </button>
            <button type="button" onClick={() => setStep("pick")} className={btnGhost}>
              {t("common.back")}
            </button>
          </div>
          {busy && progress && (
            <p className="text-[11px] tabular-nums text-text-muted">
              {t(`legacy.import.stage_${progress.stage}`)} · {num(progress.done)}/{num(progress.total)}
            </p>
          )}
        </div>
      )}

      {/* ③ Kuru kosu raporu */}
      {step === "dryrun" && dryReport && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-text-primary">{t("legacy.import.dry_title")}</p>
          <table className="text-xs text-text-secondary">
            <tbody>
              {reportRows(dryReport).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4">{t(k)}</td>
                  <td className="text-right tabular-nums text-text-primary">{num(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("confirm")} className={btn}>
              {t("common.continue")}
            </button>
            <button type="button" onClick={() => setStep("inventory")} className={btnGhost}>
              {t("common.back")}
            </button>
          </div>
        </div>
      )}

      {/* ④ Onay + uygula */}
      {(step === "confirm" || step === "applying") && (
        <div className="flex flex-col gap-2">
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
            {t("legacy.import.confirm_body")}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void runApply()} disabled={busy} className={btn}>
              {step === "applying" ? t("legacy.import.applying") : t("legacy.import.apply")}
            </button>
            {step === "confirm" && (
              <button type="button" onClick={() => setStep("dryrun")} className={btnGhost}>
                {t("common.back")}
              </button>
            )}
          </div>
          {step === "applying" && (
            <p className="flex items-center gap-2 text-[11px] tabular-nums text-text-muted">
              <Spinner />
              {progress
                ? `${t(`legacy.import.stage_${progress.stage}`)} · ${num(progress.done)}/${num(progress.total)}`
                : t("legacy.import.applying")}
            </p>
          )}
        </div>
      )}

      {/* ⑤ Sonuc */}
      {step === "done" && result && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-success">{t("legacy.import.done_title")}</p>
          <table className="text-xs text-text-secondary">
            <tbody>
              {reportRows(result).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4">{t(k)}</td>
                  <td className="text-right tabular-nums text-text-primary">{num(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.usersNotMigrated.length > 0 && (
            <p className="text-[11px] leading-relaxed text-text-muted">
              {t("legacy.import.users_note", {
                users: result.usersNotMigrated.map((u) => u.username).join(", "),
              })}
            </p>
          )}
          {/* DEVIR TESLIM (kullanici bulgusu 2026-08-11): burasi eskiden yalniz "simdi
              klasorlerinizi taratin" CUMLESI + Kapat dugmesiydi. Cumle HANGI klasorleri
              soylemiyordu — aktarim kokleri `scanned_roots`'a yaziyor ama kullanicinin onlari
              bulmasi icin sihirbazi kapatip Ayarlar → Tarama → "Kaynak klasorleri yonet"
              yolunu KENDI basina bulmasi gerekiyordu. Artik: somut sayi + oraya goturen dugme.
              Kokler panelde bekleyen sayisi ve "erisilemiyor" rozetiyle listelenir. */}
          <p className="rounded-md bg-bg-tertiary px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            {t("legacy.import.rescan_hint")}
          </p>
          {result.assetsInserted > 0 && (
            <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
              {t("legacy.import.handoff", {
                roots: num(result.rootsAdded),
                pending: num(result.assetsInserted),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {/* Tarama BASLATMAZ, oraya GOTURUR: tarama uzun surer ve mod secimi ("Birlestir"
                silmez / "Degistir" kayiplari cope atar) kullaniciya aittir — aktarim biter
                bitmez kendiliginden koşmasi sürpriz ve riskli olurdu. */}
            <button type="button" onClick={() => setRootsOpen(true)} className={btn}>
              {t("legacy.import.review_roots")}
            </button>
            <button type="button" onClick={onClose} className={btnGhost}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {rootsOpen && <RootsPanel onClose={() => setRootsOpen(false)} />}
    </div>
  );
}

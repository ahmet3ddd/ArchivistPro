// Proje-durum alanlari (H2 pariti) — Bilgi sekmesi alt-bolumu. Musteri / onay-durumu /
// red-sebebi (yalniz reddedildi) / versiyon / termin. Editor+ duzenler+kaydeder; viewer
// salt-okuma (input'lar disabled, Kaydet gizli). Gercek yetki Rust command'da (UI yalniz
// gorunum).
//
// ⚠️ FORM SENKRONU (veri-riski): yerel form durumu detail.project'ten baslar ama gelen
// tazeleme formu KOSULSUZ EZMEZ. Eski davranis `useEffect(..., [assetId, project])` icinde
// sartsiz setForm(toForm(project)) idi; `project` referansi HER refetch'te degistigi icin
// kullanici musteri adini yazip ardindan bir etiket eklediginde (AssetDetailPanel →
// onChanged → refetch) yazdigi metin UYARISIZ SILINIYORDU. Kural:
//   • asset DEGISTI       → kosulsuz sifirla (onceki dosyanin yazilari tasinmasin)
//   • form TEMIZ          → disaridan geleni al (dis degisiklik kazanir)
//   • form KIRLI + dis degisiklik → kullanicinin yazdigini KORU + "disaridan degisti" uyar
//     (kullanici uyaridaki dugmeyle gelen degerleri acikca yukleyebilir)

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssignedProject, ProjectMeta } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { authErrorMessage } from "../../auth/authError";
import { ProtectedAction } from "../../../permissions";
import { useSession } from "../../../hooks/useSession";
import { useUiStore } from "../../../store/useUiStore";
import { useToast } from "../../toast/useToast";
import { ApprovalHistory } from "./ApprovalHistory";
import { APPROVAL_STATUSES } from "./projectStatus";

interface Props {
  assetId: number;
  project: ProjectMeta;
  /** Asset'in atandigi proje (entity). `client_name` bosken projeninki devralinir (inheritance). */
  assignedProject?: AssignedProject | null;
  /** UZAK arsiv (LAN): degerler GORUNUR ama duzenleme KAPALI.
   *  ⚠️ Neden: `project_set` YEREL DB'ye `assetId` ile yazar; uzak modda bu id HOST'un id'sidir →
   *  ayni numaradaki BASKA bir yerel dosyaya musteri/onay/versiyon islenirdi (sessiz yanlis
   *  YAZMA — okuma hatasindan agir). Canli test bulgusu, 2026-07-22.
   *  Gizlemek yerine salt-okuma: viewer rolunun zaten kullandigi yol (`canWrite=false`). */
  readOnly?: boolean;
}

/** Yerel form alanlari — daima string (kontrollu input'lar); kaydederken bos → null. */
interface FormState {
  clientName: string;
  approvalStatus: string;
  rejectionReason: string;
  versionLabel: string;
  deadline: string;
}

function toForm(p: ProjectMeta): FormState {
  return {
    clientName: p.client_name ?? "",
    approvalStatus: p.approval_status ?? "",
    rejectionReason: p.rejection_reason ?? "",
    versionLabel: p.version_label ?? "",
    deadline: p.deadline ?? "",
  };
}

/** Iki form durumu ayni mi? (kirlilik testi: form ↔ yuklenen `project` degerleri) */
function sameForm(a: FormState, b: FormState): boolean {
  return (
    a.clientName === b.clientName &&
    a.approvalStatus === b.approvalStatus &&
    a.rejectionReason === b.rejectionReason &&
    a.versionLabel === b.versionLabel &&
    a.deadline === b.deadline
  );
}

/** Bos/whitespace string → null (sunucu zaten temizler; agda da normalleyelim). */
function clean(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}

const INPUT_CLS =
  "w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary " +
  "placeholder:text-text-muted transition focus:border-accent focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60";

// Serbest-metin alan sinirlari — H2 `DetailPanel.tsx:615` (musteri 150) / `:712` (versiyon 20).
// 2026-07-18 H2-gerileme taramasi: H3'te ne sinir ne sayac vardi → yanlislikla yapistirilan bir
// paragraf oldugu gibi DB'ye yazilip Teknik gorunumde/panelde tasarak gorunuyordu. Sinir
// GORUNMEZ olmamali: kullanici yaklastikca sayac uyari rengine doner (H2 `:637-639`/`:729-731`).
const MAX_CLIENT_LEN = 150;
const MAX_VERSION_LEN = 20;
/** Sayacin uyari rengine dondugu esik (kalan karakter). H2: 150'de 140, 20'de 18 → son ~%7-10. */
const WARN_AT_REMAINING = 10;

/** "N/M" karakter sayaci — yalniz kullanici yazmaya basladiysa gorunur (bos alanda gurultu yok). */
function CharCount({ value, max }: { value: string; max: number }) {
  if (value.length === 0) return null;
  const near = max - value.length <= Math.min(WARN_AT_REMAINING, Math.ceil(max * 0.1));
  return (
    <span className={`self-end text-[10px] ${near ? "text-warning" : "text-text-muted"}`}>
      {value.length}/{max}
    </span>
  );
}

export function ProjectSection({ assetId, project, assignedProject, readOnly }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  // Rol (sunucu oturumu) VE arsiv kaynagi birlikte karar verir: uzak arsivde en yetkili
  // kullanici bile duzenleyemez (yazma yerel DB'ye, yanlis id ile giderdi).
  const { canWrite } = useSession();
  const canEdit = canWrite && !readOnly;
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  const [form, setForm] = useState<FormState>(() => toForm(project));
  const [saving, setSaving] = useState(false);
  // Formun temel aldigi (en son senkronlanan) sunucu degerleri — kirlilik testi bunun
  // uzerinden yapilir: form !== base ⇒ kaydedilmemis kullanici degisikligi var.
  const baseRef = useRef<FormState>(toForm(project));
  const assetIdRef = useRef<number>(assetId);
  // Kirli formun uzerine dis degisiklik geldi mi? (uyari banneri; veri EZILMEZ)
  const [conflict, setConflict] = useState(false);

  // Gelen `project` tazelemesini forma UYARLA (bkz dosya basi FORM SENKRONU kurali).
  useEffect(() => {
    const next = toForm(project);
    const assetChanged = assetIdRef.current !== assetId;
    assetIdRef.current = assetId;

    // 1) Baska dosyaya gecildi → kosulsuz sifirla.
    if (assetChanged) {
      baseRef.current = next;
      setForm(next);
      setConflict(false);
      return;
    }
    // 2) Gelen veri zaten formdakiyle ayni (or. kendi kaydimiz geri dondu) → yalniz temeli hizala.
    if (sameForm(next, form)) {
      baseRef.current = next;
      setConflict(false);
      return;
    }
    // 3) Form TEMIZ → disaridan geleni al (dis degisiklik kazanir; eski davranis).
    if (sameForm(form, baseRef.current)) {
      baseRef.current = next;
      setForm(next);
      setConflict(false);
      return;
    }
    // 4) Form KIRLI + veri disaridan degisti → kullanicinin yazdigini KORU, uyar.
    setConflict(true);
  }, [assetId, project, form]);

  // Uyaridaki dugme: gelen (dis) degerleri acikca yukle — kullanicinin bilincli karari.
  const loadIncoming = () => {
    const next = toForm(project);
    baseRef.current = next;
    setForm(next);
    setConflict(false);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const meta: ProjectMeta = {
        client_name: clean(form.clientName),
        approval_status: clean(form.approvalStatus),
        // Onay 'rejected' degilse red-sebebini gonderme (temizlensin).
        rejection_reason: form.approvalStatus === "rejected" ? clean(form.rejectionReason) : null,
        version_label: clean(form.versionLabel),
        deadline: clean(form.deadline),
      };
      await ipc.setProjectMeta(assetId, meta);
      // Kaydedilen degerler artik YENI temel → form temizlenir (bekleyen refetch'e bagli
      // kalmadan): sonraki dis tazeleme yanlislikla "catisma" saymaz.
      baseRef.current = form;
      setConflict(false);
      bumpData(); // liste (approval filtresi) tazelensin
      bumpFacets(); // onay-durumu faceti tazelensin
      toast.success(t("project.saved"));
    } catch (e) {
      toast.error(authErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const showRejection = form.approvalStatus === "rejected";

  return (
    <section className="mt-3 border-t border-border pt-3">
      <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        {t("project.title")}
      </h3>

      {/* Atandigi proje (entity, 0019) — hangi projeye ait (salt-gosterim; atama Projeler panelinden). */}
      {assignedProject && (
        <p className="mb-2 text-xs text-text-secondary">
          {t("project.assigned")}:{" "}
          <span className="font-medium text-text-primary">{assignedProject.name}</span>
        </p>
      )}

      {/* Catisma uyarisi: kaydedilmemis yazi varken veriler DISARIDAN degisti (toplu islem /
          geri-al / baska bir panel). Yazdiklarin korunur; "gelenleri yukle" ile devralinabilir. */}
      {conflict && (
        <div
          role="status"
          data-testid="project-external-change"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning"
        >
          <span>{t("project.external_changed")}</span>
          <button
            type="button"
            onClick={loadIncoming}
            className="rounded border border-warning/50 px-1.5 py-0.5 transition hover:bg-warning/20"
          >
            {t("project.external_reload")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 text-xs">
        {/* Musteri (+ inheritance ipucu: asset'in kendi client'i bosken projeninki gorunumde devralinir). */}
        <Labeled label={t("project.client")}>
          <input
            type="text"
            value={form.clientName}
            disabled={!canEdit}
            maxLength={MAX_CLIENT_LEN}
            onChange={(e) => set("clientName", e.target.value)}
            className={INPUT_CLS}
          />
          <CharCount value={form.clientName} max={MAX_CLIENT_LEN} />
          {form.clientName.trim() === "" && assignedProject?.client_name && (
            <span className="text-[10px] text-text-muted">
              {t("project.client_inherited", { name: assignedProject.client_name })}
            </span>
          )}
        </Labeled>

        {/* Onay durumu */}
        <Labeled label={t("project.approval")}>
          <select
            value={form.approvalStatus}
            disabled={!canEdit}
            onChange={(e) => set("approvalStatus", e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">{t("project.status_unset")}</option>
            {APPROVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`project.status_${s}`)}
              </option>
            ))}
          </select>
        </Labeled>

        {/* Red sebebi (yalniz reddedildi) */}
        {showRejection && (
          <Labeled label={t("project.rejection_reason")}>
            <textarea
              value={form.rejectionReason}
              disabled={!canEdit}
              rows={2}
              onChange={(e) => set("rejectionReason", e.target.value)}
              className={`${INPUT_CLS} resize-y`}
            />
          </Labeled>
        )}

        {/* Versiyon */}
        <Labeled label={t("project.version")}>
          <input
            type="text"
            value={form.versionLabel}
            disabled={!canEdit}
            maxLength={MAX_VERSION_LEN}
            onChange={(e) => set("versionLabel", e.target.value)}
            className={INPUT_CLS}
          />
          <CharCount value={form.versionLabel} max={MAX_VERSION_LEN} />
        </Labeled>

        {/* Termin */}
        <Labeled label={t("project.deadline")}>
          <input
            type="date"
            value={form.deadline}
            disabled={!canEdit}
            onChange={(e) => set("deadline", e.target.value)}
            className={`${INPUT_CLS} [color-scheme:dark]`}
          />
        </Labeled>

        {/* Kaydet — editor/admin aktif; viewer'a soluk+pasif (kesfedilebilirlik).
            UZAKTA da pasif: `save()` zaten `!canEdit`'te no-op'tur ama AKTIF gorunen bir dugme
            "kaydettim" yanilgisi yaratir (sessizce hicbir sey olmaz) → gorunur sekilde kapali. */}
        <ProtectedAction require="editor" mode="disabled">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !canEdit}
            className="mt-1 self-start rounded-md bg-accent px-3 py-1 text-xs font-medium text-white
                       transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("project.save")}
          </button>
        </ProtectedAction>
      </div>

      {/* Onay durumu GECIS gecmisi (H2 approval_log pariti) — her rol gorur, salt-okuma. */}
      <ApprovalHistory assetId={assetId} />
    </section>
  );
}

/** Etiket + alan dikey cifti (RTL: text-start; mantiksal akis). */
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-start text-text-muted">{label}</span>
      {children}
    </label>
  );
}

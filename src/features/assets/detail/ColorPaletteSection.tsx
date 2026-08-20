// RENK KARTELASI (detay paneli) — baskın renkleri okunur ve KULLANILABİLİR kılar.
//
// Öncesi: 32×20px'lik bir çubuk ve tooltip'te "#4f6a7d 34%". Veri zaten iyiydi (çıkarım CIELAB
// k-means ile 5 rengi yüzdeleriyle buluyor) ama kullanıcı değeri panele bakarak alamıyordu.
//
// Şimdi (kullanıcı isteği 2026-08-20): çubuk SEÇİLEBİLİR — bir segmente tıklayınca o rengin
// değerleri altta açılır: HEX · RGB · HSL · ≈ en yakın RAL Classic. Her değer tıklanınca panoya
// kopyalanır (şartnameye/müşteriye renk verirken en çok işe yarayan davranış).
//
// ⚠️ RAL DAİMA YAKLAŞIKTIR ve öyle sunulur: "≈" öneki + ΔE mesafesi + uzak eşleşmede açık uyarı.
// Gerekçe `ralClassic.ts` başlığında: RAL fiziksel bir boya standardı, elimizdeki renk ise
// fotoğraftan/render'dan gelen sRGB. Boya kararı fiziksel kartela ile verilir.
//
// Panel dar (`w-80` = 320px) → değerler tek sütun, kırpılmadan sığacak boyda.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { DominantColor } from "../../../ipc/client";
import { useUiStore } from "../../../store/useUiStore";
import { useToast } from "../../toast/useToast";
import { rgbToHsl, rgbToHex } from "../colorMath";
import { DominantColorPalette } from "../DominantColorPalette";
import { normalizeDominantColors } from "../dominantColors";
import { nearestRal } from "../ralClassic";

interface Props {
  colors?: readonly DominantColor[] | null;
}

/** Tek değer satırı: etiket + tıklanınca panoya kopyalanan değer.
 *  ⚠️ Modül düzeyinde: bileşen içinde tanımlanan bileşen her render'da YENİ tiptir (React onu
 *  unmount/remount eder). Burada durum yok ama desen yanlış — kopyalanmasın. */
function ValueRow({
  label,
  value,
  onCopy,
  hint,
  testId,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  hint: string;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <button
        type="button"
        data-testid={testId}
        onClick={onCopy}
        title={hint}
        className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-start font-mono text-[11px] text-text-primary transition hover:bg-bg-tertiary"
      >
        {value}
      </button>
    </div>
  );
}

export function ColorPaletteSection({ colors }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const setColorSearch = useUiStore((s) => s.setColorSearch);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const [selected, setSelected] = useState(0);

  const normalized = normalizeDominantColors(colors);
  if (normalized.length === 0) return null;

  // Seçim listeden taşarsa (asset değişti, renk sayısı azaldı) ilk renge düş.
  const index = selected < normalized.length ? selected : 0;
  const color = normalized[index];
  const hex = rgbToHex(color);
  const hsl = rgbToHsl(color);
  const ral = nearestRal(color);

  const copy = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("toast.copied")))
      .catch(() => toast.error(t("toast.copy_failed")));
  };

  return (
    <section className="flex flex-col gap-2 px-1 pt-1" data-testid="color-palette">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {t("colors.title")}
        </h3>
        <span className="ms-auto text-[10px] tabular-nums text-text-muted">
          {t("colors.share", { percent: Math.round(color.percentage) })}
        </span>
      </div>

      {/* Çubuk artık ETKİLEŞİMLİ: segment = renk seçimi (klavye ile de gezilir). */}
      <DominantColorPalette
        colors={normalized}
        selectedIndex={index}
        onSelect={setSelected}
        className="w-full"
      />

      <div className="flex items-start gap-2">
        <span
          aria-hidden
          style={{ backgroundColor: hex }}
          className="mt-0.5 h-8 w-8 shrink-0 rounded border border-border"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ValueRow
            label={t("colors.hex")}
            value={hex}
            onCopy={() => copy(hex)}
            hint={t("colors.copy_hint")}
            testId="color-hex"
          />
          <ValueRow
            label={t("colors.rgb")}
            value={`${color.r}, ${color.g}, ${color.b}`}
            // Kopyalanan biçim CSS'e yapıştırılabilir olsun (ekranda sade dursa da).
            onCopy={() => copy(`rgb(${color.r}, ${color.g}, ${color.b})`)}
            hint={t("colors.copy_hint")}
            testId="color-rgb"
          />
          <ValueRow
            label={t("colors.hsl")}
            value={`${Math.round(hsl.h)}°, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%`}
            onCopy={() =>
              copy(`hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`)
            }
            hint={t("colors.copy_hint")}
            testId="color-hsl"
          />
          {ral && (
            <ValueRow
              label={t("colors.ral")}
              // "≈" ÖNEKİ EKRANDA KALIR (değer yaklaşıktır); panoya giden KODUN kendisidir.
              value={`≈ ${ral.code}${ral.far ? "" : ` · ${ral.name}`}`}
              onCopy={() => copy(ral.code)}
              hint={
                ral.far
                  ? t("colors.ral_far_hint", { delta: ral.delta.toFixed(1) })
                  : t("colors.ral_hint", { name: ral.name, delta: ral.delta.toFixed(1) })
              }
              testId="color-ral"
            />
          )}
        </div>
      </div>

      {/* "Bu renge yakin gorselleri bul" — arsiv genelinde renk-yakinligi aramasi. Sonuc gezginde
          bir SONUC KAPSAMI olarak acilir (benzer-gorseller ile ayni desen: serit + temizle).
          Kartela detay panelinde, sonuc gezginde → gorunum de degistirilir. */}
      <button
        type="button"
        data-testid="color-search"
        onClick={() => {
          setColorSearch({ r: color.r, g: color.g, b: color.b });
          setViewMode("explorer");
        }}
        className="flex items-center gap-1.5 self-start rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-text-primary transition hover:border-border-hover hover:bg-bg-secondary"
      >
        {/* Kutucuk: "bu renk" ifadesinin HANGI renk oldugunu yoruma birakmaz (kullanici sorusu
            2026-08-20). Secili segment degisince kutucuk da degisir. */}
        <span
          aria-hidden
          style={{ backgroundColor: hex }}
          className="h-3 w-3 shrink-0 rounded-[3px] border border-border"
        />
        {t("colors.search_action")}
      </button>

      {ral?.far && (
        <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] leading-snug text-warning">
          {t("colors.ral_far_notice")}
        </p>
      )}
    </section>
  );
}

// GÖRÜNÜM-DÜZEYİ SAĞ-TIK MENÜSÜ — Pano · Teknik · Harita · Sohbet ortak menüsü.
//
// NEDEN VAR (kullanıcı bulgusu 2026-08-20): bu görünümlerde sağ-tık uygulamanın değil,
// WebView2'nin tarayıcı menüsünü açıyordu ("Yeniden yükle · Farklı kaydet · Yazdır · Kaynağı
// görüntüle") — masaüstü arşiv uygulamasında hem anlamsız hem de web kabuğunu sızdırıyor.
// Gezgin (asset + boş alan) ve Klasörler menüleri baştan beri vardı.
//
// Menü İKİ ortak bölüm + görünüme özel BİR bölümden oluşur:
//   · KOPYALA — yalnız metin seçiliyken. Tarayıcı menüsünü kapattığımız için bu yeteneği biz
//     sunarız (metin girişlerinde menü zaten engellenmez; bkz `useViewContextMenu`).
//   · GÖRÜNÜM — gezgin boş-alan menüsüyle AYNI üçlü (`MENU_VIEW_MODES`). Menünün açıldığı
//     görünüm üçlünün DIŞINDAYSA (harita/sohbet) ✓ sütunu hiç çizilmez: hiçbiri işaretli
//     olmayan bir seçim listesi "bozuk radyo" gibi okunurdu.
//   · [görünüme özel] — çağıranın verdiği başlık + öğeler. Öğeler KOŞULLU üretilir: anlamsız
//     olan çizilmez (sahte öğe yasak — bkz BgTaskBanner'daki aynı ilke).

import { useTranslation } from "react-i18next";

import { ContextMenu, MenuDivider, MenuItem, MenuSectionLabel } from "../../components/ContextMenu";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { MENU_VIEW_MODES } from "./viewModes";

const MENU_W = 224;

/** Görünüme özel menü öğesi (çağıran üretir; boş dizi → o bölüm çizilmez). */
export interface ViewMenuItem {
  label: string;
  onClick: () => void;
  /** E2E tutamağı — menü metni yerelden yerele değişir, testler bunu kullanır. */
  testId?: string;
  disabled?: boolean;
  disabledHint?: string;
}

interface Props {
  x: number;
  y: number;
  /** Sağ-tık anındaki metin seçimi (boş → "Kopyala" çizilmez). */
  selectedText: string;
  onClose: () => void;
  /** Görünüme özel bölümün başlığı (öğe yoksa kullanılmaz). */
  sectionTitle?: string;
  items?: ViewMenuItem[];
  testId: string;
  ariaLabel: string;
}

export function ViewContextMenu({
  x,
  y,
  selectedText,
  onClose,
  sectionTitle,
  items = [],
  testId,
  ariaLabel,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);

  /** Önce menüyü kapat, sonra eylemi çalıştır (menü açık kalıp yanıltmasın). */
  const run = (action: () => void) => {
    onClose();
    action();
  };

  // Pano erişimi reddedilebilir → SESSİZ kalma, toast ile söyle (AssetContextMenu `copy_path` deseni).
  const copySelection = () =>
    run(() => {
      void navigator.clipboard
        .writeText(selectedText)
        .then(() => toast.success(t("toast.copied")))
        .catch(() => toast.error(t("toast.copy_failed")));
    });

  // Menünün açıldığı görünüm üçlünün içinde mi → ✓ sütunu yalnız o zaman anlamlı.
  const inTriple = MENU_VIEW_MODES.some((m) => m.mode === viewMode);

  return (
    <ContextMenu
      x={x}
      y={y}
      width={MENU_W}
      onClose={onClose}
      testId={testId}
      ariaLabel={ariaLabel}
    >
      {selectedText !== "" && (
        <>
          <MenuItem
            label={t("context.copy_selection")}
            testId="view-context-copy"
            onClick={copySelection}
          />
          <MenuDivider />
        </>
      )}

      <MenuSectionLabel>{t("blank_menu.section_view")}</MenuSectionLabel>
      {MENU_VIEW_MODES.map(({ mode, labelKey }) => (
        <MenuItem
          key={mode}
          label={t(labelKey)}
          checked={inTriple ? viewMode === mode : undefined}
          onClick={() => run(() => setViewMode(mode))}
        />
      ))}

      {items.length > 0 && (
        <>
          <MenuDivider />
          {sectionTitle && <MenuSectionLabel>{sectionTitle}</MenuSectionLabel>}
          {items.map((item) => (
            <MenuItem
              key={item.testId ?? item.label}
              label={item.label}
              testId={item.testId}
              disabled={item.disabled}
              disabledHint={item.disabledHint}
              onClick={() => run(item.onClick)}
            />
          ))}
        </>
      )}
    </ContextMenu>
  );
}

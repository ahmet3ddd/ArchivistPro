// PAYLAŞIK BAĞLAM MENÜSÜ İSKELETİ — konumlandırma + kapanma + öğe ilkelleri.
//
// NEDEN VAR (2026-08-20): aynı iskelet ÜÇ yerde kopyalanmıştı (asset · gezgin boş alan · klasör)
// ve kopyalar birbirinden SESSİZCE ayrışmıştı:
//   · AssetContextMenu  → `Math.min(y, innerHeight - 320)`  (sihirli 320; ALT sınır yok → küçük
//     pencerede menü ekranın DIŞINA, negatif konuma kayabiliyordu)
//   · FolderContextMenu → `menuH = treeBlankTarget ? 96 : treeTarget ? 420 : 560` (üç sihirli sayı;
//     içerik değişince kayar)
//   · BlankContextMenu  → gerçek ölçüm (`getBoundingClientRect`) — ÜÇÜNÜN DE doğrusu buydu.
// Pano menüsü eklenirken dördüncü kopya çıkarmak yerine doğru olan tek yere alındı: menü kendi
// boyutunu ÖLÇER, ekran içine sıkıştırılır (her iki eksende ≥8px). Sihirli yükseklik yok.
//
// Kapanma sözleşmesi (üç kopyanın birleşimi): dışarı-tık (capture) · Esc · kaydırma (capture) ·
// pencere yeniden boyutlanması. Capture kullanılır ki VirtuosoGrid'in kendi kaydırma dinleyicisi
// olayı yutmadan menü kapansın.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Varsayılan genişlik (asset + gezgin menüleri); klasör menüsü 248 kullanır. */
const DEFAULT_WIDTH = 224;
/** Ekran kenarına bırakılan boşluk. */
const EDGE = 8;

interface ContextMenuProps {
  /** İmleç konumu (viewport koordinatı). */
  x: number;
  y: number;
  /** Menü genişliği (px). */
  width?: number;
  /** Dışarı-tık / Esc / kaydırma → çağıran menüyü kapatır. */
  onClose: () => void;
  children: ReactNode;
  /** E2E tutamağı — menü metni yerelden yerele değişir, testler bunu kullanır. */
  testId?: string;
  /** Ekran okuyucu için menünün neye ait olduğu. */
  ariaLabel?: string;
}

export function ContextMenu({
  x,
  y,
  width = DEFAULT_WIDTH,
  onClose,
  children,
  testId,
  ariaLabel,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Gerçek boyutu render SONRASI ölç: pencere kenarında menü her zaman görünür kalsın.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = {
      x: Math.max(EDGE, Math.min(x, window.innerWidth - rect.width - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - rect.height - EDGE)),
    };
    if (next.x !== position.x || next.y !== position.y) setPosition(next);
  }, [x, y, position.x, position.y]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      data-context-menu
      data-testid={testId}
      style={{ position: "fixed", left: position.x, top: position.y, width }}
      className="z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-border bg-bg-secondary/95 py-1 text-sm text-text-primary shadow-xl backdrop-blur-lg"
      // Menünün ÜSTÜNDE sağ-tık → WebView2'nin kendi menüsü açılmasın.
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

/** Bölüm başlığı (GÖRÜNÜM / SIRALAMA …). */
export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </p>
  );
}

/** Ayırıcı — `subtle` (ölçüt↔yön arası gibi yakın akrabalar) daha ince/iç-girintili. */
export function MenuDivider({ subtle }: { subtle?: boolean }) {
  return subtle ? (
    <div className="mx-3 my-1 border-t border-border/60" />
  ) : (
    <div className="my-1 border-t border-border" />
  );
}

interface MenuItemProps {
  label: string;
  onClick?: () => void;
  /** Pasif öğe GİZLENMEZ, kilitlenir (keşfedilebilirlik) — sebebi `disabledHint`te söylenir. */
  disabled?: boolean;
  disabledHint?: string;
  /** Yıkıcı eylem (çöp vb.) → danger rengi. */
  danger?: boolean;
  /** Tanımlıysa öğe bir SEÇİM'dir → solda ✓ yuvası ayrılır (true ise işaret görünür). */
  checked?: boolean;
  /** E2E tutamağı — menü metni yerelden yerele değişir, testler bunu kullanır. */
  testId?: string;
}

export function MenuItem({
  label,
  onClick,
  disabled,
  disabledHint,
  danger,
  checked,
  testId,
}: MenuItemProps) {
  const showCheckSlot = checked !== undefined;
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={
        "flex w-full items-center px-3 py-1.5 text-start transition-colors " +
        (disabled
          ? "cursor-not-allowed text-text-muted"
          : danger
            ? "text-danger hover:bg-danger/15"
            : "text-text-primary hover:bg-bg-tertiary")
      }
    >
      {showCheckSlot && (
        <span aria-hidden className="me-2 w-3.5 flex-none text-accent">
          {checked ? "✓" : ""}
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

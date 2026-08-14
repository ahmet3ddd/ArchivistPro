// Etiket/koleksiyon secici modal (combobox) — `window.prompt` yerine (ux-polish §U).
//
// Tek string adi dondurur: cagiran (useBulkActions) find-or-create yapar → hem mevcut
// adi sec hem yeni ad yaz ayni yol. Autocomplete: yazdikca mevcut secenekler suzulur;
// tam eslesme yoksa basa "oluştur «...»" satiri eklenir. Klavye: ↑/↓ gez, Enter sec/
// olustur, Esc kapat. Disari-tik kapatir. Scrim+kart deseni (TrashPanel/UserAdminPanel
// pariti). RTL: text-start + ms-* mantiksal siniflar.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useModalDialog } from "../../hooks/useModalDialog";

interface Props {
  title: string;
  placeholder: string;
  options: string[]; // mevcut adlar (autocomplete kaynagi)
  count: number; // etkilenecek asset sayisi (baslik baglami)
  /** true (vars.) → find-or-create: yazilan yeni ad da gonderilebilir ("oluştur" satiri).
   *  false → yalniz MEVCUT secenekler secilebilir (or. "etiket kaldir" — olmayani uretmek anlamsiz). */
  allowCreate?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

interface Entry {
  value: string;
  isCreate: boolean; // true → "oluştur" satiri (mevcutta yok)
}

export function PickerModal({
  title,
  placeholder,
  options,
  count,
  allowCreate = true,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useModalDialog<HTMLDivElement>(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Acilista input'a odaklan (hizli yazim).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Gosterilecek satirlar: (tam eslesme yoksa) oluştur + suzulmus mevcutlar.
  const entries = useMemo<Entry[]>(() => {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const matched = options.filter((o) => o.toLowerCase().includes(lower));
    const exact = options.some((o) => o.toLowerCase() === lower);
    const list: Entry[] = [];
    if (allowCreate && trimmed && !exact) list.push({ value: trimmed, isCreate: true });
    for (const o of matched) list.push({ value: o, isCreate: false });
    return list;
  }, [input, options, allowCreate]);

  // Liste degisince aktif indeksi sinir icine al (basa don).
  useEffect(() => {
    setActive((a) => (a >= entries.length ? 0 : a));
  }, [entries.length]);

  // Aktif satiri gorus alanina kaydir (klavye gezinme).
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Aktif satir varsa onu gonder; yoksa yalniz find-or-create modunda yazilan metni.
      // allowCreate=false iken eslesme yok ise (yalniz-secim) sessizce yok say.
      const chosen = entries[active]?.value;
      if (chosen != null) submit(chosen);
      else if (allowCreate) submit(input);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-sm flex-col rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-bold text-accent">
            {title}
            <span className="ms-2 text-xs font-normal text-text-muted">
              {t("batch.selected", { count })}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        <div className="p-3">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={entries.length > 0}
            aria-autocomplete="list"
            className="w-full rounded-md border border-border bg-bg-tertiary px-2.5 py-1.5 text-sm
                       text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />

          {entries.length > 0 && (
            <ul ref={listRef} role="listbox" className="mt-2 max-h-56 overflow-auto">
              {entries.map((entry, i) => (
                <li key={`${entry.isCreate ? "+" : "="}${entry.value}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => submit(entry.value)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors ${
                      i === active
                        ? "bg-bg-tertiary text-text-primary"
                        : "text-text-secondary hover:bg-bg-tertiary"
                    }`}
                  >
                    {entry.isCreate ? (
                      <>
                        <span className="text-accent">＋</span>
                        <span className="truncate">{t("picker.create", { name: entry.value })}</span>
                      </>
                    ) : (
                      <span className="truncate">{entry.value}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Arama kutusu — debounce'lu (girdi durunca store.query guncellenir → FTS arama).
// + Arama gecmisi / oneri dropdown (ux-polish §U — H2 pariti):
//   • Odakta: son aramalar (en yeni basta).
//   • Yazarken: yazilan terimi iceren gecmis suzulur (oneri).
//   • Klavye: ↑/↓ gez · Enter sec/uygula · Esc kapat.
//   • Disari-tik kapatir; kapanirken non-empty terim gecmise yazilir.
//   • Her satirda × (tek sil) + altta "tumunu temizle".
// Gecmis localStorage'da (searchHistory) — renderer DB tutmaz; salt-UI kolaylik.
// Dropdown `absolute` (header `backdrop-blur` → `fixed` containing-block tuzagina
// dusmemek icin) + opak zemin (bg-bg-primary), .glass DEGIL (gorunurluk).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUiStore } from "../../store/useUiStore";
import { addToHistory, clearHistory, loadHistory, removeFromHistory } from "./searchHistory";

export function SearchBar() {
  const { t } = useTranslation();
  const setQuery = useUiStore((s) => s.setQuery);
  const storeQuery = useUiStore((s) => s.query);
  // Anlamli-ara modu (LAN Faz 5) — keyword↔anlamli gecisi (kutunun sagindaki ✨ dugmesi).
  const semanticMode = useUiStore((s) => s.semanticMode);
  const setSemanticMode = useUiStore((s) => s.setSemanticMode);
  const [text, setText] = useState(storeQuery);
  const [history, setHistory] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = oneri secili degil
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Yazarken debounce ile store'a yaz.
  useEffect(() => {
    const id = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(id);
  }, [text, setQuery]);

  // Disaridan degisirse (or. preset uygulama) kutuyu esitle (yaziyorken degil → no-op).
  useEffect(() => {
    setText(storeQuery);
  }, [storeQuery]);

  // Gosterilecek oneriler: yazi bossa tum gecmis; doluysa eslesen (tam-ayni haric).
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => {
      const hl = h.toLowerCase();
      return hl.includes(q) && hl !== q;
    });
  }, [text, history]);

  // Acikken disari-tik kapatir + non-empty terimi gecmise yazar (gercekten arama yapildi).
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        const v = text.trim();
        if (v) setHistory(addToHistory(v));
        setOpen(false);
        setActive(-1);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, text]);

  // Liste degisince aktif indeksi sinir icine al (oneri kalmadi → secimi birak).
  useEffect(() => {
    setActive((a) => (a >= suggestions.length ? -1 : a));
  }, [suggestions.length]);

  // Aktif satiri gorus alanina kaydir (klavye gezinme).
  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Bir terimi uygula: kutuya yaz + store'a anlik (debounce'u beklemeden) + gecmise kaydet.
  const commit = (value: string) => {
    const v = value.trim();
    setText(v);
    setQuery(v);
    if (v) setHistory(addToHistory(v));
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Escape iki asamali (H2 `Sidebar.tsx:433` daha da ileri gidip her durumda temizlerdi):
      //   1) oneri listesi acikken → yalniz listeyi kapat (kullanici yazdigini kaybetmesin)
      //   2) liste kapaliyken → ARAMAYI TEMIZLE
      // (2) 2026-07-18 H2-gerileme taramasinda eksikti: kaslarina "Escape = temizle" yerlesmis
      // kullanici Escape'e basiyor, HICBIR SEY olmuyordu (global katman da input-guard ile
      // erken donuyor) → metni elle silmek gerekiyordu, her aramada tekrarlayan surtunme.
      e.preventDefault();
      if (open) {
        setOpen(false);
        setActive(-1);
      } else if (text.length > 0) {
        setText("");
        setQuery("");
        setActive(-1);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setHistory(loadHistory());
        setOpen(true);
      } else {
        setActive((a) => Math.min(a + 1, suggestions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Aktif oneri varsa onu, yoksa yazilan metni uygula.
      commit(active >= 0 && suggestions[active] ? suggestions[active] : text);
    }
  };

  const showList = open && suggestions.length > 0;

  return (
    <div ref={rootRef} className="relative flex-1">
      <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted">
        🔎
      </span>
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setHistory(loadHistory());
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("search.placeholder")}
        title={t("search.hint")}
        aria-keyshortcuts="Control+K /"
        data-testid="search-input"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-history-list"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
        className="w-full rounded-md border border-border bg-bg-tertiary py-2 ps-9 pe-24 text-sm
                   text-text-primary placeholder:text-text-muted transition focus:border-accent focus:outline-none"
      />

      {/* Keyword↔anlamli gecisi — kutunun saginda kompakt pill. AÇIK + sorgu dolu iken vektor
          (semantik) arama; KAPALI klasik FTS. Durum bir bakista gorunur (aktifken accent dolgu);
          ayrinti `title` ipucunda. Odagi input'ta tut (onMouseDown preventDefault → dropdown
          erken kapanmasin). */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setSemanticMode(!semanticMode)}
        aria-pressed={semanticMode}
        title={t("search_mode.semantic_hint")}
        className={`absolute end-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition motion-reduce:transition-none ${
          semanticMode
            ? "bg-accent text-white"
            : "border border-border text-text-secondary hover:text-text-primary"
        }`}
      >
        <span aria-hidden>✨</span>
        <span className="whitespace-nowrap">{t("search_mode.semantic_label")}</span>
      </button>

      {showList && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1 flex flex-col overflow-hidden rounded-md
                     border border-border bg-bg-primary shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <span className="text-xs font-medium text-text-muted">{t("search.recent")}</span>
            <button
              type="button"
              // Odak input'ta kalsin (blur ile erken kapanma yok); listeyi temizle.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHistory(clearHistory())}
              className="rounded px-1.5 text-xs text-text-secondary transition hover:text-text-primary"
            >
              {t("search.clear_history")}
            </button>
          </div>
          <ul id="search-history-list" ref={listRef} role="listbox" className="max-h-72 overflow-auto py-1">
            {suggestions.map((item, i) => (
              <li
                key={item}
                id={`search-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex items-center gap-1 px-1.5 ${
                  i === active ? "bg-bg-tertiary" : ""
                }`}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(item)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-start text-sm
                             text-text-secondary transition-colors hover:text-text-primary"
                >
                  <span aria-hidden className="text-text-muted">
                    🕘
                  </span>
                  <span className="truncate">{item}</span>
                </button>
                <button
                  type="button"
                  aria-label={t("search.remove_history", { term: item })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setHistory(removeFromHistory(item))}
                  className="shrink-0 rounded px-1.5 py-1 text-text-muted transition hover:text-text-primary"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

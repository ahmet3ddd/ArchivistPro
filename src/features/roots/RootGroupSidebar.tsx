// Kaynak-klasor panelinin SOL sutunu: gruplar. Filtre girisleri (Tum klasorler / Grupsuz / her
// grup — tikla → sagdaki kartlari filtrele) + grup CRUD (yeni grup [ad+renk] · yeniden adlandir ·
// renk degistir · sil). Grup silme kokleri SILMEZ (yalniz grup atamasi kalkar). Yazma editor+
// (ProtectedAction). Sunum-odakli: IPC/toast/tazeleme ebeveyn (RootsPanel) sorumlulugu.

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { RootGroup } from "../../ipc/client";
import { ProtectedAction } from "../../permissions";
import { DEFAULT_GROUP_COLOR, ROOT_GROUP_COLORS } from "./rootGroupMeta";

/** Aktif grup filtresi — hangi kokler sag sutunda gosterilecek. */
export type GroupFilter =
  | { kind: "all" }
  | { kind: "ungrouped" }
  | { kind: "group"; id: number };

interface Props {
  groups: RootGroup[];
  filter: GroupFilter;
  onFilterChange: (f: GroupFilter) => void;
  onCreate: (name: string, color: string) => void;
  onRename: (id: number, name: string) => void;
  onRecolor: (id: number, color: string) => void;
  onDelete: (id: number) => void;
}

/** Bir filtre satiri (secili → vurgulu). */
function FilterRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs transition ${
        active
          ? "bg-accent/15 text-accent"
          : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function RootGroupSidebar({
  groups,
  filter,
  onFilterChange,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_GROUP_COLOR);

  const submitCreate = () => {
    const v = newName.trim();
    if (!v) return;
    onCreate(v, newColor);
    setNewName("");
    setNewColor(DEFAULT_GROUP_COLOR);
    setCreating(false);
  };

  return (
    <div className="flex w-52 shrink-0 flex-col gap-1 border-e border-border pe-3">
      <h3 className="px-2 pb-1 font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("roots.groups.title")}
      </h3>

      <FilterRow active={filter.kind === "all"} onClick={() => onFilterChange({ kind: "all" })}>
        <span aria-hidden>🗂️</span>
        <span className="min-w-0 flex-1 truncate">{t("roots.groups.all")}</span>
      </FilterRow>
      <FilterRow
        active={filter.kind === "ungrouped"}
        onClick={() => onFilterChange({ kind: "ungrouped" })}
      >
        <span aria-hidden>➖</span>
        <span className="min-w-0 flex-1 truncate">{t("roots.groups.ungrouped")}</span>
      </FilterRow>

      <div className="my-1 h-px bg-border" />

      {groups.length === 0 ? (
        <p className="px-2 py-1 text-[11px] text-text-muted">{t("roots.groups.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              active={filter.kind === "group" && filter.id === g.id}
              onSelect={() => onFilterChange({ kind: "group", id: g.id })}
              onRename={(name) => onRename(g.id, name)}
              onRecolor={(color) => onRecolor(g.id, color)}
              onDelete={() => onDelete(g.id)}
            />
          ))}
        </ul>
      )}

      {/* Yeni grup */}
      <ProtectedAction require="editor" mode="disabled">
        <div className="mt-1 border-t border-border pt-2">
          {creating ? (
            <div className="flex flex-col gap-1.5">
              <input
                data-escape-local
                type="text"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCreate();
                  else if (e.key === "Escape") setCreating(false);
                }}
                placeholder={t("roots.groups.name_placeholder")}
                className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-xs
                           text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <ColorSwatches value={newColor} onChange={setNewColor} />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary transition hover:bg-bg-tertiary"
                >
                  {t("roots.groups.cancel")}
                </button>
                <button
                  type="button"
                  onClick={submitCreate}
                  disabled={newName.trim() === ""}
                  className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
                >
                  {t("roots.groups.create")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full rounded border border-dashed border-border px-2 py-1 text-xs text-text-secondary
                         transition hover:border-border-hover hover:text-text-primary"
            >
              + {t("roots.groups.new")}
            </button>
          )}
        </div>
      </ProtectedAction>
    </div>
  );
}

interface GroupRowProps {
  group: RootGroup;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}

/** Bir grup satiri — tikla-filtrele + (editor+) satir-ici yeniden adlandir / renk / sil. */
function GroupRow({ group, active, onSelect, onRename, onRecolor, onDelete }: GroupRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);

  const commitName = () => {
    const v = nameDraft.trim();
    setEditing(false);
    if (v && v !== group.name) onRename(v);
    else setNameDraft(group.name);
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-1.5 rounded border border-border bg-bg-tertiary p-1.5">
        <input
          data-escape-local
          type="text"
          value={nameDraft}
          autoFocus
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            else if (e.key === "Escape") {
              setNameDraft(group.name);
              setEditing(false);
            }
          }}
          className="w-full rounded border border-border bg-bg-primary px-2 py-0.5 text-xs
                     text-text-primary focus:border-accent focus:outline-none"
        />
        <ColorSwatches value={group.color} onChange={onRecolor} />
        {/* İptal: ad taslagini geri al + duzenlemeyi kapat. Silme artik SATIR-ICI cop kutusunda
            (kullanici istegi 2026-07-27) → düzenleme penceresi yalniz ad/renk icin. */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setNameDraft(group.name);
              setEditing(false);
            }}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary transition hover:bg-bg-tertiary"
          >
            {t("roots.groups.cancel")}
          </button>
          <button
            type="button"
            onClick={commitName}
            className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-accent-hover"
          >
            {t("roots.groups.save")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-start text-xs transition ${
          active
            ? "bg-accent/15 text-accent"
            : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
        }`}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
        <span className="min-w-0 flex-1 truncate">{group.name}</span>
        <span className="shrink-0 text-[10px] text-text-muted">{group.rootCount}</span>
      </button>
      <ProtectedAction require="editor" mode="disabled">
        <button
          type="button"
          onClick={() => {
            setNameDraft(group.name);
            setEditing(true);
          }}
          aria-label={t("roots.groups.rename")}
          title={t("roots.groups.rename")}
          className="shrink-0 px-1 text-xs text-text-muted opacity-0 transition hover:text-text-primary group-hover:opacity-100"
        >
          ✎
        </button>
      </ProtectedAction>
      {/* Satir-ici SIL — duzenleme moduna girmeye gerek yok (kullanici istegi 2026-07-27). Ebeveyn
          onay diyalogu + toast gosterir; silme artik GERI ALINABILIR (undo paneli, kalem ⑨). */}
      <ProtectedAction require="editor" mode="disabled">
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("roots.groups.delete")}
          title={t("roots.groups.delete")}
          className="shrink-0 px-1 text-xs text-text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
        >
          🗑
        </button>
      </ProtectedAction>
    </li>
  );
}

/** Renk swatch satiri — secili renk cerceveli. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ROOT_GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          className={`h-5 w-5 rounded-full border-2 transition ${
            value.toLowerCase() === c.toLowerCase() ? "border-text-primary" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

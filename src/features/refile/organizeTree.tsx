// Onizleme agaci (plan segmentlerinden kurulur) — OrganizeModal'in saf, bilesen-disi
// yardimcilari. Plan ogeleri `segments`'e gore ic-ice agaca donusur; agac duz satir
// dizisine acilir (klasor + alt-dosya sayilari + dosya adlari). Yol/dosya gosterimleri
// dir="ltr"; girinti paddingInlineStart (RTL 1. sinif). i18n zorunlu (t ile).

import type { ReactNode } from "react";
import type { TFunction } from "i18next";

import type { OrganizePlanItem } from "../../ipc/client";
import { formatNumber } from "../../lib/format";

/** Bir klasor grubunda listelenecek azami dosya adi (fazlasi "+N daha" ile ozetlenir). */
const NAME_CAP = 40;

export interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  files: string[];
}

/** Plan ogelerini `segments`'e gore ic-ice agaca donustur (dosyalar en derin dugumde). */
export function buildTree(plan: OrganizePlanItem[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map(), files: [] };
  for (const item of plan) {
    let node = root;
    for (const seg of item.segments) {
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, children: new Map(), files: [] };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(item.fileName);
  }
  return root;
}

/** Bir dugum ve altindaki tum dosya sayisi (klasor rozeti). */
export function countFiles(node: TreeNode): number {
  let n = node.files.length;
  node.children.forEach((c) => (n += countFiles(c)));
  return n;
}

/** Yaprak (alt-klasoru olmayan) klasor sayisi — olusacak hedef klasorler (maket ile birebir). */
export function countLeafFolders(node: TreeNode): number {
  if (node.children.size === 0) return 0;
  let n = 0;
  node.children.forEach((c) => (n += c.children.size ? countLeafFolders(c) : 1));
  return n;
}

export const folderIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-accent"
    aria-hidden="true"
  >
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

/** Bir agac dugumunu (alt-klasorler + dosyalar) duz satir dizisine ac; girinti derinlige gore. */
export function renderNode(node: TreeNode, depth: number, path: string, t: TFunction): ReactNode[] {
  const rows: ReactNode[] = [];
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of kids) {
    const total = countFiles(child);
    rows.push(
      <div
        key={`d:${path}/${child.name}`}
        className="flex items-center gap-2 whitespace-nowrap rounded px-2 py-[3px]"
        style={{ paddingInlineStart: 8 + depth * 18 }}
      >
        {folderIcon}
        <span className="font-semibold text-text-primary">{child.name}</span>
        <span
          title={t("organize.file_count", { count: total })}
          className="rounded-full bg-bg-tertiary px-1.5 py-px text-[10px] font-semibold tabular-nums text-text-muted"
        >
          {formatNumber(total)}
        </span>
      </div>,
    );
    rows.push(...renderNode(child, depth + 1, `${path}/${child.name}`, t));
  }
  const files = [...node.files].sort((a, b) => a.localeCompare(b));
  const shown = files.slice(0, NAME_CAP);
  shown.forEach((f, i) => {
    rows.push(
      <div
        key={`f:${path}:${i}:${f}`}
        className="flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-[3px] text-text-muted"
        style={{ paddingInlineStart: 8 + depth * 18 }}
      >
        <span className="text-border" aria-hidden="true">
          └
        </span>
        <span dir="ltr" className="truncate font-mono text-[11px]">
          {f}
        </span>
      </div>,
    );
  });
  if (files.length > shown.length) {
    rows.push(
      <div
        key={`m:${path}`}
        className="px-2 py-[3px] text-[11px] italic text-text-muted"
        style={{ paddingInlineStart: 8 + depth * 18 }}
      >
        {t("organize.more", { count: files.length - shown.length })}
      </div>,
    );
  }
  return rows;
}

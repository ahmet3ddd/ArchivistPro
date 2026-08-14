// Klasor AGAC gorunumu — FoldersView'in "Agac" modu. folder_summary'nin DUZ yol listesinden
// client-side hiyerarsik agac kurar: ust-dizinler sentezlenir, dosya sayilari alt-agaca toplanir.
// Renderer'da DB YOK (mimari): yalniz mevcut folder_summary verisi kullanilir. Tikla → o klasoru
// ac (pathPrefix; alt-dizinler dahil) → explorer. Sag-tik → FoldersView baglam menusu (kartlarla
// AYNI). Non-destructive gezinme.
//
// GIDIS-DONUS SIMETRISI: genisletme durumu MODUL hafizasinda tutulur (gorunum degisiminde
// unmount olsa da korunur; restart'ta ust seviye acik baslar — gezinme durumu ayar degil).
// Aktif klasor filtresi (`activePath` = store.pathPrefix) vurgulanir; atalari otomatik acilir
// ve satir gorunume kaydirilir → Explorer'dan (breadcrumb "Klasorler") donen kullanici agaci
// BIRAKTIGI YERDE bulur.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { FolderSummaryDto } from "../../ipc/client";
import { ancestors } from "../../lib/paths";
import { formatNumber } from "../../lib/format";

interface TreeNode {
  /** Yol segmenti (gorunen ad). */
  name: string;
  /** Birikimli tam yol (filtre + baglam menusu icin; DB path prefix'iyle birebir). */
  path: string;
  /** Bu klasorde DOGRUDAN dosya (folder_summary; sentezlenen ata → 0). */
  directCount: number;
  /** Alt-agac toplami (rozet) — tiklayinca gosterilecek dosya sayisiyla ayni. */
  count: number;
  children: Map<string, TreeNode>;
}

/** Agac dugumune ozel sag-tik bilgisi. Kart-siralamasi yerine genislet/daralt sunulur. */
export interface TreeContextTarget {
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/** Agacin bos alanina ozel sag-tik eylemleri. */
export interface TreeBlankContextTarget {
  hasExpandSnapshot: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRestorePrevious: () => void;
}

// Duz folder_summary listesinden ic-ice agac (kok = sentetik kapsayici). Ayni on-eki paylasan
// klasorler ara dugumleri PAYLASIR; sayilar post-order toplanir.
function buildTree(folders: FolderSummaryDto[]): TreeNode {
  const root: TreeNode = { name: "", path: "", directCount: 0, count: 0, children: new Map() };
  for (const f of folders) {
    let node = root;
    for (const seg of ancestors(f.path)) {
      let child = node.children.get(seg.path);
      if (!child) {
        child = { name: seg.name, path: seg.path, directCount: 0, count: 0, children: new Map() };
        node.children.set(seg.path, child);
      }
      node = child;
    }
    node.directCount = f.file_count; // yaprak = tam yol eslesmesi
  }
  const agg = (n: TreeNode): number => {
    let c = n.directCount;
    n.children.forEach((ch) => (c += agg(ch)));
    n.count = c;
    return c;
  };
  root.children.forEach((ch) => agg(ch));
  return root;
}

/** Dugum cocuklarini ada gore (yerel-duyarli) sirala — agac dogal sirasi. */
function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Kok altindaki tum dugum yollarini toplar; "Tumunu genislet" her derinligi acar. */
function allNodePaths(root: TreeNode): Set<string> {
  const paths = new Set<string>();
  const visit = (node: TreeNode) => {
    for (const child of node.children.values()) {
      paths.add(child.path);
      visit(child);
    }
  };
  visit(root);
  return paths;
}

// Oturum-ici genisletme hafizasi (modul-duzeyi): FoldersView unmount olunca (Explorer'a gecis)
// KAYBOLMAZ; app yeniden acilinca sifirlanir (ust seviye acik). Tek FolderTree ornegi var.
let expandedMemory: string[] | null = null;

interface Props {
  folders: FolderSummaryDto[];
  /** Aktif klasor filtresi (store.pathPrefix) — vurgu + atalarini ac + gorunume kaydir. */
  activePath?: string | null;
  /** Bir klasoru ac (pathPrefix filtresi + explorer). */
  onOpen: (path: string) => void;
  /** Sag-tik → baglam menusu (FoldersView; kartlarla ayni handler). */
  onContextMenu: (path: string, e: MouseEvent, target: TreeContextTarget) => void;
  /** Bos agac alani → agac-geneli eylemler. */
  onBlankContextMenu: (e: MouseEvent, target: TreeBlankContextTarget) => void;
}

export function FolderTree({ folders, activePath, onOpen, onContextMenu, onBlankContextMenu }: Props) {
  const root = useMemo(() => buildTree(folders), [folders]);
  // Ilk-mount: hafiza varsa onu kullan (donuste birakildigi gibi), yoksa ust seviye acik.
  // Aktif yolun atalari HER mount'ta acilir → tiklanan/donulen dugum daima gorunur.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const base = expandedMemory ? new Set(expandedMemory) : new Set(root.children.keys());
    if (activePath) for (const a of ancestors(activePath).slice(0, -1)) base.add(a.path);
    return base;
  });
  // "Tumunu genislet" gecici bir gorunumdur: kullanicinin onceki acik/kapali duzeni burada
  // saklanir ve genel menuden tek hamlede geri yuklenir.
  const expandedBeforeExpandAll = useRef<Set<string> | null>(null);
  const [hasExpandSnapshot, setHasExpandSnapshot] = useState(false);
  const { t } = useTranslation();
  // Genisletme durumunu modul hafizasina yaz (gorunum gecislerinde korunur).
  useEffect(() => {
    expandedMemory = [...expanded];
  }, [expanded]);
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const top = useMemo(() => sortedChildren(root), [root]);

  return (
    <div
      className="flex min-h-full flex-col gap-0.5 p-2 text-sm"
      role="tree"
      onContextMenu={(e) => {
        // Dugum sag-tiklari kendi satirinda ele alinir. Burasi yalniz agacin bos alanidir;
        // target esitlemesi, satir menusunun bu genel menuyla ezilmesini onler.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onBlankContextMenu(e, {
          hasExpandSnapshot: expandedBeforeExpandAll.current !== null,
          onExpandAll: () => {
            // Tekrar "tumunu genislet" tiklanirsa ilk durum korunur; geri donus her zaman
            // kullanicinin genisletmeden ONCEKI kendi duzenine gider.
            if (!expandedBeforeExpandAll.current) {
              expandedBeforeExpandAll.current = new Set(expanded);
              setHasExpandSnapshot(true);
            }
            setExpanded(allNodePaths(root));
          },
          onCollapseAll: () => {
            expandedBeforeExpandAll.current = null;
            setHasExpandSnapshot(false);
            setExpanded(new Set());
          },
          onRestorePrevious: () => {
            const previous = expandedBeforeExpandAll.current;
            expandedBeforeExpandAll.current = null;
            setHasExpandSnapshot(false);
            setExpanded(previous ? new Set(previous) : new Set());
          },
        });
      }}
    >
      {hasExpandSnapshot && (
        <button
          type="button"
          onClick={() => {
            const previous = expandedBeforeExpandAll.current;
            expandedBeforeExpandAll.current = null;
            setHasExpandSnapshot(false);
            setExpanded(previous ? new Set(previous) : new Set());
          }}
          className="sticky top-1 z-10 self-start rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs font-medium text-text-secondary shadow-sm transition hover:bg-bg-tertiary hover:text-text-primary"
        >
          {t("folders.ctx.tree_restore_previous")}
        </button>
      )}
      {top.map((n) => (
        <TreeRow
          key={n.path}
          node={n}
          depth={0}
          expanded={expanded}
          activePath={activePath ?? null}
          onToggle={toggle}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (path: string, e: MouseEvent, target: TreeContextTarget) => void;
}

function TreeRow({ node, depth, expanded, activePath, onToggle, onOpen, onContextMenu }: RowProps) {
  const { t } = useTranslation();
  const hasChildren = node.children.size > 0;
  const isOpen = expanded.has(node.path);
  const isActive = node.path === activePath;
  const kids = useMemo(() => (isOpen ? sortedChildren(node) : []), [isOpen, node]);

  // Aktif dugumu mount aninda gorunume kaydir (Explorer'dan donuste yerini goster).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: "nearest" });
    // Yalniz mount: donus ani; sonraki render'larda kaydirma kullaniciyi rahatsiz eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        ref={rowRef}
        className={`group flex items-center rounded-md ${
          isActive ? "bg-accent/15" : "hover:bg-bg-tertiary"
        }`}
        style={{ paddingInlineStart: 4 + depth * 14 }}
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-current={isActive ? "true" : undefined}
        onContextMenu={(e) => {
          // FoldersView de savunmaci olarak preventDefault eder; burada da yapmak agac
          // dugumunun tarayici/OS menusu gostermeyecegini garanti eder.
          e.preventDefault();
          onContextMenu(node.path, e, {
            hasChildren,
            expanded: isOpen,
            onToggle: () => onToggle(node.path),
          });
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            aria-label={isOpen ? t("folders.collapse") : t("folders.expand")}
            className="flex size-5 shrink-0 items-center justify-center text-text-muted transition hover:text-text-primary"
          >
            <span className={`text-[10px] transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onOpen(node.path)}
          title={node.path}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pe-2 text-start transition ${
            isActive ? "font-medium text-accent" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <span aria-hidden className="shrink-0">
            📁
          </span>
          <span className="min-w-0 truncate">{node.name}</span>
          <span className="ms-auto shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-xs tabular-nums text-text-muted">
            {formatNumber(node.count)}
          </span>
        </button>
      </div>
      {kids.map((k) => (
        <TreeRow
          key={k.path}
          node={k}
          depth={depth + 1}
          expanded={expanded}
          activePath={activePath}
          onToggle={onToggle}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

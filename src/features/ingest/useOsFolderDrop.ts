// OS klasor surukle-birak → IngestModal (Faz A) — AppShell'de BIR KEZ monte edilir.
//
// Tauri v2'de `dragDropEnabled` VARSAYILAN TRUE → HTML5 drop olaylari webview'e ULASMAZ; OS-drop
// yalniz Tauri webview olayi (`getCurrentWebview().onDragDropEvent`) ile alinir. Olay turleri:
//   enter/over → drop overlay goster · leave → gizle · drop → overlay gizle + ilk klasor yolu ile
//   IngestModal'i ac (useUiStore.openIngest → IngestButton okuyup path on-dolulu acar).
//
// YETKI: klasor indeksleme YALNIZ admin'dir (ingest komutu backend'de admin-gated; IngestButton
// da `require="admin"`). Bu yuzden burada `isAdmin` ile kapatilir (canWrite=editor+ DEGIL — editor
// ingest edemez, ona modal acmak yaniltici olurdu). Non-admin drop → sessiz + ipucu toast.
//
// Dosya (klasor degil) birakilirsa en yakin klasore duseriz (uzanti-heuristigi); kullanici zaten
// IngestModal'da yolu gorup duzeltebilir (guvenlik agi). Kaynak-yolu cozulemezse sessiz.
//
// Guvenlik: `getCurrentWebview()` Tauri-disi ortamda (e2e/tarayici) window.__TAURI_INTERNALS__
// eksikliginden FIRLATIR → try/catch ile yutulur (OS-drop devre disi kalir, uygulama cokmez).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

/** Son segment bir dosya gibi mi gorunuyor? (kisa uzanti: `.dwg`, `.pdf`, `.docx`…) */
function looksLikeFile(segment: string): boolean {
  return /\.[^\\/.]{1,12}$/.test(segment);
}

/** Yolun son parcasi (dosya/klasor adi; Windows + POSIX, sondaki ayirici atilir). */
function baseSegment(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/** Ust klasor yolu (son ayiriciya kadar; kok/kalansiz durumda kendisini dondurur). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

/** Birakilan yollardan taranacak KLASOR yolunu coz: dosya gelirse ust klasore dus. */
function resolveFolderPath(paths: string[]): string | null {
  const first = paths.find((p) => p && p.trim().length > 0);
  if (!first) return null;
  if (looksLikeFile(baseSegment(first))) {
    return parentDir(first) || null;
  }
  return first;
}

/** Suruklenen klasor overlay'ini gostermek icin `dragActive` doner (yalniz admin surukleme). */
export function useOsFolderDrop(): boolean {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const toast = useToast();
  const openIngest = useUiStore((s) => s.openIngest);
  const [dragActive, setDragActive] = useState(false);

  // Degerleri ref'te tut → abonelik BIR KEZ kurulur (rol/dil degisince yeniden kurulup olay
  // kacirmaz; useAutoIndex/useFolderWatcher deseni).
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;
  const openIngestRef = useRef(openIngest);
  openIngestRef.current = openIngest;

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    const attach = async () => {
      try {
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          const payload = event.payload;

          // Non-admin: overlay YOK; yalniz drop aninda kisa ipucu toast (klasor indeksleme admin'e ozel).
          if (!isAdminRef.current) {
            if (payload.type === "drop") toastRef.current.info(tRef.current("dropzone.admin_only"));
            return;
          }

          switch (payload.type) {
            case "enter":
            case "over":
              setDragActive(true);
              break;
            case "leave":
              setDragActive(false);
              break;
            case "drop": {
              setDragActive(false);
              const folder = resolveFolderPath(payload.paths);
              if (folder) openIngestRef.current(folder);
              break;
            }
          }
        });
        if (disposed) fn();
        else unlisten = fn;
      } catch {
        /* Tauri webview yok (e2e/tarayici) → OS-drop devre disi (sessiz). */
      }
    };

    void attach();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Overlay yalniz admin suruklerken gorunur (non-admin icin dragActive zaten hic true olmaz).
  return isAdmin && dragActive;
}

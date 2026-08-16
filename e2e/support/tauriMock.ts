// Tauri v2 IPC mock — E2E altin-akis icin (P2.5 kalem ③).
//
// Neden: Tauri v2 uygulamasi Windows/WebView2'de Playwright ile DOGRUDAN surulemez;
// gercek backend zaten 81 lib testiyle kapsaniyor. Bu katman yalniz FRONTEND altin-akisini
// CI-dostu bicimde dogrular: Vite frontend'i gercek Chromium'da acilir, `@tauri-apps/api`'nin
// dokundugu `window.__TAURI_INTERNALS__` katmani uygulama script'lerinden ONCE enjekte edilir.
//
// Dogrulanmis sozlesme (node_modules/@tauri-apps/api/core.js + event.js):
//   • invoke(cmd,args,opts)          → window.__TAURI_INTERNALS__.invoke(...)  (Promise doner)
//   • transformCallback(cb,once)     → window.__TAURI_INTERNALS__.transformCallback(...) (Channel/listen)
//   • window.__TAURI_INTERNALS__.unregisterCallback(id)               (Channel kapanis)
//   • window.__TAURI_INTERNALS__.convertFileSrc(path,protocol)        (thumbnail src)
//   • listen()  → invoke("plugin:event|listen",...)  → eventId (number)
//   • unlisten  → window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event,id)
//                 + invoke("plugin:event|unlisten",...)

import type { Page } from "@playwright/test";

// ── Kanned DTO tipleri (yalniz test; src/ipc/client.ts sekilleriyle birebir) ──
export interface MockAsset {
  id: number;
  path: string;
  file_name: string;
  ext: string | null;
  size_bytes: number;
  mime: string | null;
  title: string | null;
  created_at: number;
  modified_at: number;
  indexed_at: number | null;
  favorite: boolean;
  snippet: string | null;
  /** AI vision alanlari (grid kartinda ✨ rozeti + renkli tur hapi). Opsiyonel: kanned
   *  varliklar analiz edilmemis sayilir; birim-yukseklik testi bunlari acikca kurar. */
  ai_analyzed?: boolean;
  ai_gorsel_turu?: string | null;
}

export interface MockSession {
  user_id: number;
  username: string;
  role: "admin" | "editor" | "viewer";
  must_change: boolean;
}

export interface TauriMockOptions {
  /** `current_session` donusu (acilista oturum). Varsayilan null → LoginScreen. */
  session?: MockSession | null;
  /** `needs_setup` donusu. Varsayilan false. */
  needsSetup?: boolean;
  /** `login` donusundeki rol/must_change. Varsayilan admin, must_change=false. */
  loginRole?: "admin" | "editor" | "viewer";
  loginMustChange?: boolean;
  /** Eslestirilmis ve ulasilabilir ana arsiv varmis gibi davran. Viewer'da backend reddi taklit edilir. */
  remoteConfigured?: boolean;
  /** Arsiv varliklari (grid/arama/detay). Varsayilan CANNED_ASSETS. */
  assets?: MockAsset[];
}

/** Uc kanonik varlik (dwg/pdf/docx) — altin-akis grid + arama + detayini besler. */
export const CANNED_ASSETS: MockAsset[] = [
  {
    id: 1,
    path: "C:/arsiv/projeler/Site Plani.dwg",
    file_name: "Site Plani.dwg",
    ext: "dwg",
    size_bytes: 1_048_576,
    mime: "image/vnd.dwg",
    title: "Site Plani",
    created_at: 1_700_000_000,
    modified_at: 1_700_100_000,
    indexed_at: 1_700_100_500,
    favorite: false,
    snippet: null,
  },
  {
    id: 2,
    path: "C:/arsiv/projeler/Kat Plani.pdf",
    file_name: "Kat Plani.pdf",
    ext: "pdf",
    size_bytes: 2_097_152,
    mime: "application/pdf",
    title: null,
    created_at: 1_700_000_000,
    modified_at: 1_700_200_000,
    indexed_at: 1_700_200_500,
    favorite: true,
    snippet: null,
  },
  {
    id: 3,
    path: "C:/arsiv/projeler/Kesit Detay.docx",
    file_name: "Kesit Detay.docx",
    ext: "docx",
    size_bytes: 524_288,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    title: "Kesit Detay",
    created_at: 1_700_000_000,
    modified_at: 1_700_300_000,
    indexed_at: 1_700_300_500,
    favorite: false,
    snippet: null,
  },
];

interface MockData {
  session: MockSession | null;
  needsSetup: boolean;
  loginRole: "admin" | "editor" | "viewer";
  loginMustChange: boolean;
  remoteConfigured: boolean;
  assets: MockAsset[];
}

/**
 * Tauri IPC mock'unu sayfaya kur. `page.addInitScript` ile uygulama script'lerinden ONCE
 * calisir → `isTauri()` true olur ve tum `invoke` cagrilari mock'a duser. Tekrar-kullanilabilir
 * + parametrik (oturum/varlik/rol secilebilir).
 */
export async function installTauriMock(page: Page, opts: TauriMockOptions = {}): Promise<void> {
  const data: MockData = {
    session: opts.session ?? null,
    needsSetup: opts.needsSetup ?? false,
    loginRole: opts.loginRole ?? "admin",
    loginMustChange: opts.loginMustChange ?? false,
    remoteConfigured: opts.remoteConfigured ?? false,
    assets: opts.assets ?? CANNED_ASSETS,
  };

  await page.addInitScript((d: MockData) => {
    // Varsayılan E2E senaryoları ürünün yerleşik akışlarını doğrular; ilk-kullanım
    // rehberi onların tıklamalarını örtmesin. Onboarding'e özel test bu anahtarı
    // sonraki init-script'te kaldırarak gerçek ilk giriş davranışını sınar.
    localStorage.setItem("arsiv.onboarding.v1.user.1", "done");

    // ── invoke komut yonlendirici ───────────────────────────────────────────────
    // Golden-path komutlari anlamli kanned veri doner. Bilinmeyen komut → sekle-uygun
    // BOS default (liste→[], sayi→0, aksi→null) ki UI cokmesin (iteratif kosarken
    // konsol/pageerror'a bakip eksik komut buraya eklenir).
    const emptyProject = {
      client_name: null,
      approval_status: null,
      rejection_reason: null,
      version_label: null,
      deadline: null,
    };

    // Cop'e atilan (soft-delete) id'ler: `list_assets` bunlari ELER, `get_asset` ise
    // dondurmeye devam eder (bkz asagida trash_assets aciklamasi).
    const trashed = new Set<number>();
    // Mevcut normal Vite sunucusu Playwright tarafindan yeniden kullanilsa bile test probe'u
    // etkin kalir; bu bayrak yalniz addInitScript ile test sayfasina enjekte edilir.
    Object.defineProperty(window, "__ARSIV_H3_E2E__", {
      value: true,
      configurable: true,
    });
    // ErrorBoundary E2E'si renderer hatasinin gercek IPC kaydina donustugunu bu test-yalniz
    // gozlem kaydindan dogrular. Uretim kodunda karsiligi yoktur.
    const frontendErrors: Array<{ message: string; location: string; stack: string }> = [];
    Object.defineProperty(window, "__ARSIV_H3_E2E_FRONTEND_ERRORS__", {
      value: frontendErrors,
      configurable: true,
    });
    // E2E'ler bir renderer eyleminin dogru IPC komutuna gittigini bu test-yalniz
    // kayittan dogrular. Uretim yuzeyine dahil degildir.
    const ipcCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    Object.defineProperty(window, "__ARSIV_H3_E2E_IPC_CALLS__", {
      value: ipcCalls,
      configurable: true,
    });

    function listAssets(args: Record<string, unknown>): { total: number; items: MockAsset[] } {
      const opts = (args?.opts ?? {}) as {
        query?: string | null;
        page?: number;
        page_size?: number;
        ai_analyzed?: boolean;
        favorites_only?: boolean;
      };
      const q = (opts.query ?? "").trim().toLowerCase();
      let filtered = d.assets.filter((a) => !trashed.has(a.id));
      if (opts.favorites_only === true) {
        filtered = filtered.filter((a) => a.favorite);
      }
      if (opts.ai_analyzed != null) {
        filtered = filtered.filter((a) => Boolean(a.ai_analyzed) === opts.ai_analyzed);
      }
      if (q) {
        filtered = filtered.filter((a) =>
          `${a.file_name} ${a.title ?? ""}`.toLowerCase().includes(q),
        );
      }
      const page = opts.page ?? 0;
      const size = opts.page_size ?? 60;
      const start = page * size;
      return { total: filtered.length, items: filtered.slice(start, start + size) };
    }

    function getAsset(args: Record<string, unknown>): unknown {
      const id = args?.id as number | undefined;
      const asset = d.assets.find((a) => a.id === id);
      if (!asset) return null;
      return {
        asset,
        metadata: [],
        tags: [],
        collections: [],
        project: emptyProject,
        rag_excluded: false,
      };
    }

    // cmd → deger (veya args'tan hesaplayan fn). Golden-path + AppShell mount kapsanir.
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      // Boot / auth
      needs_setup: () => d.needsSetup,
      current_session: () => d.session,
      login: (args) => {
        const session = {
          user_id: 1,
          username: (args?.username as string) ?? "admin",
          role: d.loginRole,
          must_change: d.loginMustChange,
        };
        d.session = session;
        return session;
      },
      logout: () => null,
      change_password: () => null,
      // AppShell mount durum okumalari
      recovery_status: () => ({ outcome: "healthy", snapshot: null, quarantined: null }),
      location_status: () => ({
        archiveHost: null,
        currentHost: "TEST-PC",
        hostMismatch: false,
        sampled: 0,
        accessible: 0,
        likelyForeign: false,
      }),
      auto_index_status: () => ({ enabled: true, active: false, skipped: 0 }),
      reset_local_ai_indexes: () => ({
        textVectors: 3,
        imageVectors: 5,
        chunks: 2,
        skipped: 1,
      }),
      // LAN eslesmesi olmayan yerel test ortami. Bu komut null donerse
      // ArchiveSourceSwitcher `status.configured` okurken ErrorBoundary'ye duser.
      remote_archive_status: () => {
        if (d.loginRole === "viewer") throw new Error("yetki reddedildi");
        return {
          configured: d.remoteConfigured,
          reachable: d.remoteConfigured,
          appVersion: d.remoteConfigured ? "0.1.0" : null,
          hostLabel: d.remoteConfigured ? "10.0.0.2:9471" : null,
        };
      },
      db_health: () => ({
        schema_version: 1,
        integrity_ok: true,
        asset_count: d.assets.length,
        orphan_count: 0,
      }),
      system_info: () => ({
        appVersion: "0.1.0-test",
        buildProfile: "debug",
        targetOs: "windows",
        targetArch: "x86_64",
        buildFeatures: ["tauri-desktop", "offline-native", "profile:debug", "target:windows-x86_64"],
        hostname: "TEST-PC",
        localIp: "192.168.1.42",
        archivePath: "C:/arsiv-h3",
        disk: { freeBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 },
        diskError: null,
      }),
      report_frontend_error: (args) => {
        frontendErrors.push({
          message: String(args?.message ?? ""),
          location: String(args?.location ?? ""),
          stack: String(args?.stack ?? ""),
        });
        return null;
      },
      stop_all_watchers: () => null,
      trash_count: () => 0,
      // Adlandirilmis yerel arsivler: mock yalniz ANA arsivi bildirir (aktif).
      list_local_archives: () => [
        { id: "main", name: "", color: null, isMain: true, active: true, assetCount: 0 },
      ],
      // Onay durumu gecis gecmisi (mock: bos).
      list_approval_log: () => [],
      // XMP sidecar export (mock: hicbir sey yazilmadi).
      export_xmp_sidecars: () => ({ written: 0, fallback: 0, errors: [] }),
      // Liste / arama / detay / thumbnail
      list_assets: (args) => listAssets(args),
      get_asset: (args) => getAsset(args),
      // Cop'e at (soft-delete). LISTE'den duser ama `get_asset` cop'tekini DE dondurur —
      // bu, backend'de soft-delete guard'i OLMAYAN mevcut durumu taklit eder. Boylece
      // "cop'e atilinca detay paneli kapanir" testi YALNIZ frontend duzeltmesiyle gecer
      // (mock asset'i tumden silseydi test, duzeltme geri alindiginda da yesil kalirdi).
      trash_assets: (args) => {
        const ids = (args?.ids as number[] | undefined) ?? [];
        for (const id of ids) trashed.add(id);
        return ids.length;
      },
      get_thumbnails: () => [],
      find_duplicates: () => ({
        groups: [
          {
            kind: "exact_hash",
            score: 100,
            members: d.assets.slice(0, 2).map((a) => ({
              id: a.id,
              path: a.path,
              fileName: a.file_name,
              sizeBytes: a.size_bytes,
            })),
          },
        ],
        totalGroups: d.assets.length >= 2 ? 1 : 0,
        totalFiles: Math.min(d.assets.length, 2),
      }),
      // Facet'ler (sidebar)
      ext_facets: () => [
        { value: "dwg", count: 1 },
        { value: "pdf", count: 1 },
        { value: "docx", count: 1 },
      ],
      dashboard_stats: () => ({
        total_assets: d.assets.length,
        total_size: d.assets.reduce((sum, asset) => sum + asset.size_bytes, 0),
        ext_counts: [
          { value: "dwg", count: 1 },
          { value: "pdf", count: 1 },
          { value: "docx", count: 1 },
        ],
        month_counts: [{ month: "2026-07", count: d.assets.length }],
        approval_counts: [
          { value: "review", count: 1 },
          { value: "approved", count: 1 },
        ],
        size_by_ext: [],
        active_projects: 0,
        indexed_assets: 0,
        architectural_styles: [],
        material_groups: [],
      }),
      tag_facets: () => [],
      favorite_count: () => 1,
      image_analysis_status: () => {
        const active = d.assets.filter((asset) => !trashed.has(asset.id));
        const analyzed = active.filter((asset) => Boolean(asset.ai_analyzed)).length;
        const pending = active.length - analyzed;
        // Gercek sunucu gibi: "denendi, sonuc alinamadi" bekleyenin bir ALT KUMESI ama "analiz
        // edilmemis"ten AYRIDIR (ikisi kesismez). Mock veride isaretli asset yok → 0.
        const attemptFailed = active.filter((asset) =>
          Boolean((asset as { ai_attempt_failed?: unknown }).ai_attempt_failed),
        ).length;
        return {
          analyzed,
          pending,
          pendingNeverAttempted: pending - attemptFailed,
          attemptFailed,
          total: active.length,
          embedReady: true,
        };
      },
      list_collections: () => [],
      approval_facets: () => [],
      client_facets: () => [],
      version_facets: () => [],
      deadline_year_facets: () => [],
      metadata_facets: () => [],
    };

    // Sekle-uygun bos default (bilinmeyen komut). Ad ipucu ile liste/sayi tahmini.
    function fallback(cmd: string): unknown {
      if (cmd.startsWith("plugin:event|listen")) return nextEventId++;
      if (cmd.startsWith("plugin:")) return null;
      if (/count$/i.test(cmd)) return 0;
      if (/(facets|_facets|reports|models|chunks|relations|snapshots|users|candidates|duplicates|shapes|thumbnails|trash|list_|_list|collections|assets|warnings|errors|ids)$/i.test(cmd)) {
        return [];
      }
      return null;
    }

    // ── Tauri internals ─────────────────────────────────────────────────────────
    let nextCbId = 1;
    let nextEventId = 1;
    const callbacks: Record<number, (payload: unknown) => void> = {};
    const w = window as unknown as Record<string, unknown>;

    w.__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
        ipcCalls.push({ cmd, args: args ?? {} });
        const h = handlers[cmd];
        try {
          const value = h ? h(args ?? {}) : fallback(cmd);
          return Promise.resolve(value);
        } catch (e) {
          return Promise.reject(e);
        }
      },
      transformCallback(cb: (payload: unknown) => void): number {
        const id = nextCbId++;
        callbacks[id] = cb;
        return id;
      },
      unregisterCallback(id: number): void {
        delete callbacks[id];
      },
      convertFileSrc(path: string): string {
        return path;
      },
    };

    // Event eklentisi unlisten yolu (effect cleanup'ta cagrilir).
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(): void {
        /* no-op: mock olay yaymaz */
      },
    };

    // isTauri() kimi surumlerde globalThis.isTauri, kimi surumlerde __TAURI_INTERNALS__ bakar.
    w.isTauri = true;
  }, data);
}

// RAG Sohbet gorunumu (Artim 5) — 5. ana view. H2 ChatPanel pariti.
//
// Mesaj listesi + canli token stream + model oto-kesif secici + atifli kaynak kartlari
// (tiklayinca asset detay panelinde acilir). Niyet (selamlama/liste) backend'de; UI yalniz
// gosterir. Ollama yoksa: model listesi bos → uyari; selamlama/liste-niyeti yine calisir,
// icerik sorularinda backend acik hata doner (error turn).
//
// KALICILIK (H2 pariti): sohbet artik cok-oturumlu + native SQLite'ta kalici. Sol kenar-cubugu
// (ChatSessionSidebar) oturumlari listeler; oturum ILK mesajda olusur (baslik = backend'in
// deterministik onerisi — §3, bkz `chat_suggest_title`). Her tur DB'ye yazilir (user +
// assistant); reload'da role/content/citations geri
// gelir. kind/diag KALICI DEGIL (canli-only). Hata turu DB'ye YAZILMAZ (gecici). Renderer DB
// gormez; yalniz sorgu-hook/komut cagirir. RTL + i18n + glassmorphic.

import { confirm, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ContextualHelp, type HelpSection } from "../../components/ContextualHelp";
import { useRemoteArchive } from "../../hooks/useRemoteArchive";
import type { ChatMsg, ChatSession, Citation, RetrieveDiag } from "../../ipc/client";
import { ipc, remoteErrorMessage } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { getDefaultChatModel } from "../settings/aiSettings";
import { ViewContextMenu, type ViewMenuItem } from "../shell/ViewContextMenu";
import { useViewContextMenu } from "../shell/useViewContextMenu";
import { useToast } from "../toast/useToast";
import { ChatSessionSidebar } from "./ChatSessionSidebar";
import { citationGate, openOtherSession, partitionSessions } from "./chatSessionSource";
import { getRagSettings } from "./ragSettings";
import { parseScopeKind, useChatScope, type ScopeKind } from "./useChatScope";

/** Sohbet yardim icerigi (§11). Rozetler UI'daki alan adlarina bagli (`labelKey`) → dil
 *  degisince yardim da degisir; sabit teknik terim yalniz "Ollama". */
const CHAT_HELP_SECTIONS: HelpSection[] = [
  {
    titleKey: "chat.help.sec_ask",
    items: [
      { labelKey: "chat.scope.label", descKey: "chat.help.scope_desc" },
      { labelKey: "chat.model", descKey: "chat.help.model_desc" },
    ],
  },
  {
    titleKey: "chat.help.sec_answer",
    items: [
      { labelKey: "chat.sources", descKey: "chat.help.sources_desc" },
      { labelKey: "chat.help.list_label", descKey: "chat.help.list_desc" },
      { labelKey: "chat.diag_toggle", descKey: "chat.help.diag_desc" },
      { labelKey: "chat.stop", descKey: "chat.help.stop_desc" },
    ],
  },
  {
    titleKey: "chat.help.sec_session",
    items: [
      { labelKey: "chat.help.session_label", descKey: "chat.help.session_desc" },
      { labelKey: "chat.export.title", descKey: "chat.help.export_desc" },
    ],
  },
];

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  kind?: string;
  diag?: RetrieveDiag;
}

/** Kalici mesajin `citationsJson`'ini guvenli parse et → Citation[] (bos/bozuk → undefined). */
function parseCitations(json?: string | null): Citation[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Citation[]) : undefined;
  } catch {
    return undefined;
  }
}

export function ChatView() {
  const { t } = useTranslation();
  const toast = useToast(); // yazma-eylem bildirimleri + geri-al (undo) toast'i
  const select = useUiStore((s) => s.select); // citation → detay panelinde ac
  // Arsiv kaynagi (LAN Faz 5): `remote` iken retrieval HOST'un onceden insa ettigi indeksinden
  // (ragChat remote=true), uretim yine ISTEMCI Ollama'sinda. Atif tiklamasi (aşağıda `select`)
  // uzak modda UZAK detay panelini acar: AssetDetailPanel global render'li + `useAssetDetail`
  // kaynaga gore `remote_get_asset`'e yonlenir; citation.assetId zaten HOST id'sidir → dogru dosya.
  const remoteSource = useUiStore((s) => s.assetSource === "remote");
  // Aktif kaynak + eslesme etiketi: oturumlar bu ETIKETLE yazilir ve bununla suzulur (v26).
  // Kaynaksiz oturum, kaynak degistikten sonra acilinca atifi YANLIS dosyaya goturuyordu —
  // bkz `chatSessionSource.ts` ve migration 0026.
  const assetSource = useUiStore((s) => s.assetSource);
  const setAssetSource = useUiStore((s) => s.setAssetSource);
  const { status: remoteStatus } = useRemoteArchive();
  const hostLabel = remoteStatus.hostLabel;
  const remoteAvailable = remoteStatus.configured && remoteStatus.reachable;
  // Kapsam (scope) seçici — retrieval NEREDE arayacak (Tümü / Aktif filtre / Belirli dosyalar).
  const { scopeKind, setScopeKind, hasFilter, selectedCount, resolveScope } = useChatScope();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [trashed, setTrashed] = useState<ChatSession[]>([]); // copteki (soft-delete) oturumlar
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const modelsRef = useRef<string[]>([]); // en guncel model listesi (loadSession validasyonu icin)
  // Baslangic: Ayarlar'daki varsayilan sohbet modeli (yoksa oto-kesifte ilk model).
  const [model, setModel] = useState(() => getDefaultChatModel());
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Acilista Ollama model oto-kesif (yoksa: selamlama/liste yine calisir).
  useEffect(() => {
    let active = true;
    void ipc
      .ollamaModels()
      .then((list) => {
        if (!active) return;
        setModels(list);
        modelsRef.current = list;
        // Bayat-model guard: secili model kurulu listede yoksa (ya da bos) ilk modele dus
        // (localStorage varsayilani Ollama'da yoksa backend'e gidip "model not found" vermesin).
        setModel((m) => (m && list.includes(m) ? m : (list[0] ?? "")));
      })
      .catch(() => {
        /* Ollama yok → models bos kalir → UI uyari gosterir (selam/liste yine calisir) */
      });
    return () => {
      active = false;
    };
  }, []);

  // Bir oturumun mesajlarini yukle (ChatMessage → Turn; citationsJson → Citation[]). Kapsam
  // TURU oturumun `scopeJson`'indan geri yuklenir (yalniz ScopeKind; somut deger her sorguda
  // canli store'dan cozulur — bkz useChatScope). Bozuk/uyumsuz/canli-gecersiz → "all".
  const loadSession = useCallback(
    async (id: string, scopeJson?: string | null, sessionModel?: string | null) => {
      setCurrentSessionId(id);
      setScopeKind(parseScopeKind(scopeJson));
      // Oturumun kayitli modelini geri yukle (bayat-model guard'li): kurulu ise sec,
      // degilse ilk kurulu modele dus (bkz item #2 (a) oturum modeli + (b) bayat guard).
      const saved = (sessionModel ?? "").trim();
      if (saved) {
        const list = modelsRef.current;
        setModel(list.length === 0 || list.includes(saved) ? saved : (list[0] ?? saved));
      }
      try {
        const msgs = await ipc.chatListMessages(id);
        setTurns(
          msgs.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
            citations: parseCitations(m.citationsJson),
          })),
        );
      } catch {
        setTurns([]);
      }
    },
    [setScopeKind],
  );

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await ipc.chatListSessions(100));
    } catch {
      /* liste alinamadi → mevcut kalir */
    }
  }, []);

  // Copteki (soft-delete) oturumlari tazele → kurtarma listesi (ChatTrashList) veri kaynagi.
  const refreshTrashed = useCallback(async () => {
    try {
      setTrashed(await ipc.chatListTrashedSessions());
    } catch {
      /* liste alinamadi → mevcut kalir */
    }
  }, []);

  // Acilista VE kaynak degisiminde oturumlari yukle → AKTIF KAYNAGIN en yenisini (updated_at
  // DESC → ilk) sec + mesajlarini yukle.
  //
  // ⚠️ Kaynaga bagli olmasi kasitli: "Ana arsiv" ↔ "Bu makine" gecisi sohbeti de degistirir.
  // Aksi halde uzak bir sohbet ekranda ACIK kalirken kaynak yerele donerdi → atif tiklamasi
  // host id'siyle YEREL dosya acardi (kapatilan hata sinifinin ta kendisi). Kaynagin sohbeti
  // yoksa bos-durum gosterilir (yeni sohbet o kaynakla olusur).
  useEffect(() => {
    let active = true;
    void ipc
      .chatListSessions(100)
      .then((list) => {
        if (!active) return;
        setSessions(list);
        const mine = partitionSessions(list, assetSource).current;
        if (mine.length > 0) void loadSession(mine[0].id, mine[0].scopeJson, mine[0].model);
        else {
          // Bu kaynagin sohbeti yok → onceki kaynagin acik sohbeti EKRANDA KALMASIN.
          setCurrentSessionId(null);
          setTurns([]);
        }
      })
      .catch(() => {
        /* liste alinamadi → bos-durum (currentSessionId=null, turns=[]) */
      });
    return () => {
      active = false;
    };
  }, [loadSession, assetSource]);

  // Acilista copteki oturumlari yukle (kurtarma listesi; katlanmis olsa da sayac icin hazir).
  useEffect(() => {
    void refreshTrashed();
  }, [refreshTrashed]);

  // Yeni mesaj / token → en alta kaydir.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streamingText]);

  // Mesaj eklenince oturum updated_at tazelenir → listede basa tasi (optimistik).
  const bumpSessionToTop = useCallback((id: string) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const updated: ChatSession = { ...prev[idx], updatedAt: Date.now() };
      return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  // ⚠️ `send` bunu bagimlilik olarak kullanir → BURADA (send'den ONCE) tanimli olmali; asagi
  // alinirsa dep dizisi degerlendirilirken TDZ hatasi verir.
  const handleRename = useCallback(
    (id: string, title: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      void ipc.chatRenameSession(id, title).catch(() => {
        void refreshSessions(); // hata → sunucudan tazele (optimistik geri-al)
      });
    },
    [refreshSessions],
  );

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || streaming) return;
    const history: ChatMsg[] = turns.map((tr) => ({ role: tr.role, content: tr.content }));
    // Kapsami CANLI store'dan coz (secim/filtre snapshot'i degil) → oturuma da bu yazilir.
    const scope = resolveScope();

    // Oturum yoksa ILK mesajda olustur (scopeJson = kapsam).
    //
    // Baslik (§3): eski davranis `q.slice(0, 40)` idi → listede *"hangi dosyalarda yalıtım
    // şartnamesi ge…"* gibi kirik basliklar. Artik backend'in DETERMINISTIK onerisi kullanilir
    // (stop-word'ler atilir, anlamli kelimeler kalir; Ollama gerekmez). Oneri bos donerse
    // (yalniz stop-word'den olusan sorgu) `chat.untitled`'a duseriz. Bu cagri saf metin islemi —
    // hata halinde sohbeti engellememeli, o yuzden catch ile eski kisaltmaya duser.
    let sid = currentSessionId;
    const isNewSession = !sid;
    if (!sid) {
      const suggested = await ipc.chatSuggestTitle(q).catch(() => "");
      try {
        const created = await ipc.chatCreateSession(
          suggested || q.slice(0, 40) || t("chat.untitled"),
          JSON.stringify(scope),
          model || undefined,
          // Oturum HANGI arsivle konustugunu tasir (v26). Uzakta host etiketi de yazilir:
          // baska bir ana arsive eslesilince atif id'leri artik gecerli olmaz.
          remoteSource ? "remote" : "local",
          remoteSource ? hostLabel : null,
        );
        sid = created.id;
        setSessions((prev) => [created, ...prev]);
        setCurrentSessionId(created.id);
      } catch {
        // Olusturulamadi → kalicilik olmadan canli devam (reload'da gelmez). SESSIZ DEGIL:
        // kullanici "sohbet kaydedilmiyor"u ancak toast'la ogrenebilir (2026-08-13 saha bulgusu —
        // ek arsivdeki FK ihlali haftalarca sessiz yutulmustu).
        sid = null;
        toast.error(t("chat.persist_failed"));
      }
    }

    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    if (sid) void ipc.chatAppendMessage(sid, "user", q).catch(() => {});

    try {
      const ans = await ipc.ragChat(
        q,
        model,
        history,
        getRagSettings(),
        scope,
        remoteSource,
        (tok) => setStreamingText((s) => s + tok),
      );
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: ans.answer,
          citations: ans.citations,
          kind: ans.kind,
          diag: ans.diagnostics,
        },
      ]);
      if (sid) {
        void ipc
          .chatAppendMessage(
            sid,
            "assistant",
            ans.answer,
            JSON.stringify(ans.citations ?? []),
            null,
            null,
          )
          .catch(() => {});
        bumpSessionToTop(sid);

        // Baslik RAFINESI (§3, opsiyonel): yalniz oturumun ILK alisverisinde ve model seciliyse.
        // Ollama varsa H2'nin LLM basligini dener; yoksa/hata verirse deterministik taban
        // OLDUGU GIBI kalir. Arka planda (await YOK) — kullanici cevabi beklemez.
        if (isNewSession && model) {
          const target = sid;
          void ipc
            .chatSuggestTitle(q, ans.answer, model)
            .then((refined) => {
              if (refined) handleRename(target, refined);
            })
            .catch(() => {});
        }
      }
    } catch (e: unknown) {
      // Hata turu yalniz canli gosterilir; DB'ye YAZILMAZ (reload'da gelmesin).
      // Uzak sohbette hata TIPLI token olabilir (or. host'ta AI indeksi yok → remote_not_indexed)
      // → ham token DEGIL, yonlendirici cumle gosterilir (ortak `remoteErrorMessage`).
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: t("chat.error", { message: remoteErrorMessage(e, t) }),
          kind: "error",
        },
      ]);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }, [
    input,
    streaming,
    turns,
    model,
    currentSessionId,
    t,
    toast,
    bumpSessionToTop,
    handleRename,
    resolveScope,
    remoteSource,
    hostLabel,
  ]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ── Oturum yonetimi (kenar-cubugu geri-cagrilari) ──
  const handleNewSession = useCallback(() => {
    if (streaming) return;
    setCurrentSessionId(null);
    setTurns([]);
    setInput("");
    setScopeKind("all"); // yeni sohbet → kapsam varsayilana (Tümü)
  }, [streaming, setScopeKind]);

  // Sag-tik menusu — Pano/Teknik/Harita ile ayni kanca. ⚠️ Yazi alani (`textarea`) HARIC: orada
  // WebView2'nin duzenleme menusu kalir (kes/kopyala/yapistir bizde yok) — bkz `useViewContextMenu`.
  const { menu, open: openMenu, close: closeMenu } = useViewContextMenu();

  // ── Kaynak ayrimi (v26) ──
  // Liste aktif kaynaga gore bolunur; digerleri gorunur bir bolumde durur (gizlenmez).
  const { current: visibleSessions, other: otherSessions } = partitionSessions(
    sessions,
    assetSource,
  );

  // Acik oturumun atiflari su anki baglamda gecerli mi (kaynak + host etiketi uyusuyor mu).
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;
  const citeGate = citationGate(currentSession, assetSource, hostLabel);

  // "Diger kaynak" bolumunden bir oturum acmak = KAYNAK DEGISIMI. Sessiz yapilmaz: uzak
  // arsiv ulasilamazsa acilmaz (tipli uyari), aksi halde kaynak degisir → yukaridaki effect
  // listeyi yeniden bolup oturumu secer.
  const handleOpenOtherSession = useCallback(
    (id: string) => {
      if (streaming) return;
      const s = sessions.find((sess) => sess.id === id);
      if (!s) return;
      const action = openOtherSession(s, remoteAvailable);
      if (action.kind === "blocked") {
        toast.error(t(`chat.open_other_blocked.${action.reason}`));
        return;
      }
      setAssetSource(action.to);
      void loadSession(id, s.scopeJson, s.model);
    },
    [streaming, sessions, remoteAvailable, setAssetSource, loadSession, toast, t],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      if (streaming || id === currentSessionId) return;
      // Oturumun kayitli kapsam TURUNU + modelini geri yukle (somut kapsam degeri sorguda
      // canli store'dan cozulur; model bayat-model guard'li loadSession icinde dogrulanir).
      const s = sessions.find((sess) => sess.id === id);
      void loadSession(id, s?.scopeJson, s?.model);
    },
    [streaming, currentSessionId, loadSession, sessions],
  );

  // Aktif oturumu Markdown olarak dışa aktar (H2 chatExport pariti). `save()` diyaloğu hedef
  // dosyayı seçer; backend owner-scoped okuyup biçimler+yazar. Dosya adı oturum başlığından
  // türetilir (Windows'ta geçersiz karakterler `_`; ≤60 karakter). İptal (dest=null) → no-op.
  const handleExport = useCallback(async () => {
    if (!currentSessionId) return;
    const safe =
      (currentSession?.title ?? "sohbet").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) ||
      "sohbet";
    const dest = await save({
      defaultPath: `${safe}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!dest) return;
    try {
      await ipc.exportChatMarkdown(currentSessionId, dest, {
        date: t("chat.export.labels.date"),
        model: t("chat.export.labels.model"),
        scope: t("chat.export.labels.scope"),
        allArchive: t("chat.export.labels.allArchive"),
        customScope: t("chat.export.labels.customScope"),
        user: t("chat.export.labels.user"),
        assistant: t("chat.export.labels.assistant"),
        sources: t("chat.export.labels.sources"),
        unknown: t("chat.export.labels.unknown"),
        pagePrefix: t("chat.export.labels.pagePrefix"),
        pageSuffix: t("chat.export.labels.pageSuffix"),
      });
      toast.success(t("chat.export.done"));
    } catch {
      toast.error(t("chat.export.error"));
    }
  }, [currentSessionId, currentSession, toast, t]);

  // Restore ortak yolu: soft-delete geri yukle → aktif + cop listelerini tazele + bildir.
  // NOT: geri-yuklenen oturum otomatik ACILMAZ; kullanici listeden secer (secince loadSession
  // oturumun kayitli modelini de geri yukler + bayat-model guard uygular — bkz item #2).
  const restoreSession = useCallback(
    (id: string) => {
      void ipc
        .chatRestoreSession(id)
        .then(() => {
          void refreshSessions();
          void refreshTrashed();
          toast.success(t("chat.restored_toast"));
        })
        .catch(() => {
          toast.error(t("chat.restore_failed"));
          void refreshSessions();
          void refreshTrashed();
        });
    },
    [refreshSessions, refreshTrashed, toast, t],
  );

  // Sil = SOFT-DELETE (onay diyalogu YOK) → geri-alinabilir undo-toast ("Geri al").
  const handleDelete = useCallback(
    async (id: string) => {
      if (streaming) return;
      try {
        await ipc.chatDeleteSession(id);
      } catch {
        toast.error(t("chat.delete_failed"));
        void refreshSessions();
        void refreshTrashed();
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === currentSessionId) {
        setCurrentSessionId(null);
        setTurns([]);
      }
      void refreshTrashed();
      toast.info(t("chat.deleted_toast"), {
        label: t("chat.undo"),
        onClick: () => restoreSession(id),
      });
    },
    [streaming, currentSessionId, t, toast, refreshSessions, refreshTrashed, restoreSession],
  );

  // Kurtarma listesinden "Geri yükle" — undo ile ayni yol (restoreSession).
  const handleRestoreTrashed = useCallback((id: string) => restoreSession(id), [restoreSession]);

  // Kurtarma listesinden "Kalıcı sil" — SERT onay (geri alinamaz) → purge.
  const handlePurgeTrashed = useCallback(
    async (id: string) => {
      const title = trashed.find((s) => s.id === id)?.title || t("chat.untitled");
      const ok = await confirm(t("chat.purge_confirm", { title }), {
        title: t("chat.purge"),
        kind: "warning",
      });
      if (!ok) return;
      try {
        await ipc.chatPurgeSession(id);
        toast.success(t("chat.purged_toast"));
      } catch {
        toast.error(t("chat.purge_failed"));
      }
      void refreshTrashed();
    },
    [trashed, t, toast, refreshTrashed],
  );

  // Sohbete ozel menu ogeleri: ikisi de mevcut dugmelerin ikizi (yeni dogruluk kaynagi degil).
  // "Yeni sohbet" yanit uretilirken KILITLI (handleNewSession zaten erken doner; menu de sebebi
  // soylesin). "Disa aktar" yalniz KAYITLI oturumda anlamli → aksi halde cizilmez.
  const menuItems: ViewMenuItem[] = [
    {
      label: t("chat.new_session"),
      testId: "chat-context-new",
      onClick: handleNewSession,
      disabled: streaming,
      disabledHint: t("chat.ctx.busy_hint"),
    },
  ];
  if (currentSessionId != null) {
    menuItems.push({
      label: t("chat.export.button"),
      testId: "chat-context-export",
      onClick: () => void handleExport(),
    });
  }

  return (
    <div className="flex h-full" data-testid="chat-view" onContextMenu={openMenu}>
      {menu && (
        <ViewContextMenu
          x={menu.x}
          y={menu.y}
          selectedText={menu.text}
          onClose={closeMenu}
          sectionTitle={t("chat.title")}
          items={menuItems}
          testId="chat-context-menu"
          ariaLabel={t("chat.ctx.aria_label")}
        />
      )}
      <ChatSessionSidebar
        sessions={visibleSessions}
        currentSessionId={currentSessionId}
        busy={streaming}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onRenameSession={handleRename}
        onDeleteSession={(id) => void handleDelete(id)}
        trashed={trashed}
        onRestoreTrashed={handleRestoreTrashed}
        onPurgeTrashed={(id) => void handlePurgeTrashed(id)}
        /* Diger arsivin sohbetleri: GIZLENMEZ (veri kaybi gibi okunur) — ayri bir bolumde
           durur; acmak KAYNAK DEGISIMI demektir, o yuzden acik bir eylemle yapilir. */
        otherSessions={otherSessions}
        otherSource={assetSource === "remote" ? "local" : "remote"}
        onOpenOtherSession={handleOpenOtherSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Baslik + model secici */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
          <span className="font-display text-sm font-bold text-accent">{t("chat.title")}</span>
          {/* Baglam-ici yardim (§11) — sohbetin kavramlari: kapsam, kaynak kartlari, liste
              yaniti, teshis, oturum/disa aktarma. Ollama yokken ne calisir da burada. */}
          <ContextualHelp
            titleKey="chat.help.title"
            introKey="chat.help.intro"
            sections={CHAT_HELP_SECTIONS}
            hintKey="chat.help.hint"
            buttonLabelKey="chat.help.button"
          />
          {models.length > 0 ? (
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              {t("chat.model")}
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-xs text-warning">{t("chat.ollama_down")}</span>
          )}

          {/* Kapsam (scope) seçici — retrieval NEREDE arayacak. Devre-disi secenekler (filtre/
              secim yok) title ile aciklanir; gecersizlesirse useChatScope "all"a duser. */}
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            {t("chat.scope.label")}
            <select
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as ScopeKind)}
              className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="all">{t("chat.scope.all")}</option>
              <option
                value="filter"
                disabled={!hasFilter}
                title={hasFilter ? undefined : t("chat.scope.filter_disabled_hint")}
              >
                {t("chat.scope.filter")}
              </option>
              <option
                value="ids"
                disabled={selectedCount === 0}
                title={selectedCount === 0 ? t("chat.scope.specific_disabled_hint") : undefined}
              >
                {selectedCount > 0
                  ? t("chat.scope.specific_count", { count: selectedCount })
                  : t("chat.scope.specific")}
              </option>
            </select>
          </label>

          {/* Secili kapsam ozeti (Tümü disinda) — kapsamin ne oldugu bir bakista gorunur. */}
          {scopeKind === "ids" && selectedCount > 0 && (
            <span className="text-[11px] text-text-muted">
              {t("chat.scope.specific_count", { count: selectedCount })}
            </span>
          )}

          {/* Markdown dışa aktar — yalnız aktif + mesajlı oturumda (sağa yaslı). Akış sırasında pasif. */}
          {currentSessionId && turns.length > 0 && (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={streaming}
              title={t("chat.export.title")}
              className="ms-auto rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
            >
              {t("chat.export.button")}
            </button>
          )}
        </div>

        {/* Mesaj listesi */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {turns.length === 0 && !streaming ? (
            <div className="mx-auto mt-12 max-w-md text-center">
              <p className="text-sm font-medium text-text-primary">{t("chat.empty_title")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("chat.empty_hint")}</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {turns.map((tr, i) => (
                <ChatBubble
                  key={i}
                  turn={tr}
                  onCite={(c) => select(c.assetId)}
                  /* Atif id'si yalniz KENDI arsivinde anlamli → kapi tek yerde (saf fonksiyon).
                     Kapaliysa tiklama devre disi + neden yazili (sessizce yanlis dosya YOK). */
                  citeBlocked={citeGate.ok ? null : t(`chat.cite_blocked.${citeGate.reason}`)}
                  t={t}
                />
              ))}
              {streaming && (
                <div className="self-start rounded-lg border border-border bg-bg-secondary/60 px-3 py-2 text-sm text-text-primary">
                  {streamingText ? (
                    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {streamingText}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-text-muted">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
                      {t("chat.thinking")}
                    </span>
                  )}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Giris */}
        <div className="border-t border-border px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={t("chat.placeholder")}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-y rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            {streaming ? (
              // Uzun cevap iptali — akan uretimi durdur (backend CHAT_STOP → kismi cevap commit'lenir).
              <button
                type="button"
                onClick={() => void ipc.stopRagChat()}
                className="rounded-md border border-danger/50 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/20"
              >
                {t("chat.stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={input.trim().length === 0}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("chat.send")}
              </button>
            )}
          </div>
          <p className="mx-auto mt-1 max-w-3xl text-[11px] text-text-muted">
            {t("chat.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}

interface BubbleProps {
  turn: Turn;
  onCite: (c: Citation) => void;
  /** Atif tiklamasi KAPALI ise gosterilecek aciklama (null = acik). Kaynak/host uyusmazliginda
   *  dolu gelir: id baska bir arsivin uzayina ait → tiklama YANLIS dosyayi acardi. */
  citeBlocked: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Bir turda AYNI ANDA render edilen atif karti sayisi (H2 `ChatMessageList` LIST_PAGE_SIZE=50
 *  pariti). Liste-niyeti cevaplari yuzlerce dosya donebilir; hepsini birden basmak DOM/scroll
 *  darbogazi yaratir. "Daha fazla goster" ile bu kadar artar. */
const CITATION_PAGE_SIZE = 50;

function ChatBubble({ turn, onCite, citeBlocked, t }: BubbleProps) {
  const isUser = turn.role === "user";
  const cites = turn.citations ?? [];
  const [shown, setShown] = useState(CITATION_PAGE_SIZE);
  const visibleCites = cites.slice(0, shown);
  return (
    <div className={isUser ? "self-end" : "self-start"} style={{ maxWidth: "85%" }}>
      <div
        className={`rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-accent/15 text-text-primary"
            : turn.kind === "error"
              ? "border border-danger/40 bg-danger/10 text-danger"
              : "border border-border bg-bg-secondary/60 text-text-primary"
        }`}
      >
        <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {turn.content}
        </span>
      </div>

      {/* Kaynak kartlari (atif) — tiklayinca asset detay panelinde acilir. */}
      {cites.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t("chat.sources")}
          </span>
          {/* Kapali durumda atiflar GIZLENMEZ (hangi kaynaklarin kullanildigi bilgi olarak
              degerli) — yalniz tiklama kapanir ve nedeni yazilir. */}
          {citeBlocked && <span className="text-[11px] text-warning">{citeBlocked}</span>}
          {visibleCites.map((c) => (
            <button
              key={c.index}
              type="button"
              onClick={() => onCite(c)}
              disabled={citeBlocked != null}
              title={citeBlocked ?? c.path}
              className="flex flex-col rounded-md border border-border bg-bg-tertiary/40 px-2.5 py-1.5 text-start transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-bg-tertiary/40"
            >
              <span className="truncate text-xs font-medium text-text-primary">
                [{c.index}] {c.fileName}
                {c.page != null ? ` (s.${c.page})` : ""}
              </span>
              {c.snippet && (
                <span className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">{c.snippet}</span>
              )}
            </button>
          ))}
          {/* Kademeli acilim (§2, H2 pariti) — kalan atif varsa sayaçli dugme. */}
          {shown < cites.length && (
            <button
              type="button"
              onClick={() => setShown((n) => n + CITATION_PAGE_SIZE)}
              className="rounded-md border border-border bg-bg-tertiary/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:border-border-hover hover:bg-bg-tertiary hover:text-text-primary"
            >
              {t("chat.show_more_sources", {
                shown: visibleCites.length,
                total: cites.length,
              })}
            </button>
          )}
        </div>
      )}

      {/* Retrieval tani (A5) — katlanabilir; "neden bu/bos sonuc" seffaf. Greeting/error gizli. */}
      {!isUser && <DiagDetails diag={turn.diag} t={t} />}
    </div>
  );
}

/** Retrieval tani satiri (A5) — yalniz anlamli token veya aday varsa gosterilir (greeting'i eler). */
function DiagDetails({
  diag,
  t,
}: {
  diag?: RetrieveDiag;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!diag) return null;
  const hasSignal =
    diag.queryTokens.length > 0 || diag.ftsCandidates > 0 || diag.knnCandidates > 0;
  if (!hasSignal) return null;
  const tokens =
    diag.queryTokens.length > 0 ? diag.queryTokens.join(", ") : t("chat.diag_no_tokens");
  return (
    <details className="mt-1.5 text-[11px] text-text-muted">
      <summary className="cursor-pointer select-none transition hover:text-text-secondary">
        {t("chat.diag_toggle")}
      </summary>
      <div className="mt-1 space-y-0.5 ps-2">
        <div>
          {t("chat.diag_tokens")}: <span className="text-text-secondary">{tokens}</span>
          {diag.expandedTokens > 0 && (
            <span> {t("chat.diag_expanded", { count: diag.expandedTokens })}</span>
          )}
        </div>
        <div dir="ltr">
          {t("chat.diag_fts")}: {diag.ftsCandidates} · {t("chat.diag_knn")}: {diag.knnCandidates} ·{" "}
          {t("chat.diag_gated")}: {diag.gated} · {t("chat.diag_returned")}: {diag.returned}
        </div>
      </div>
    </details>
  );
}

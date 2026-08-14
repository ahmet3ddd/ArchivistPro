// IPC alan modulu: kalici cok-oturumlu sohbet (chat_sessions + chat_messages).
// H2 chatStorage porti — sohbet gecmisi artik native SQLite'ta kalici (renderer DB gormez).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.
//
// Backend komut adlari snake_case; DTO alanlari camelCase (serde). createdAt/updatedAt =
// number (i64 epoch ms). RBAC gate YOK (sohbet kisisel; rag_chat/okuma deseni).

import { invoke } from "@tauri-apps/api/core";

/** Sohbet oturumu (sunucu `ChatSessionDto`, camelCase). `scopeJson`/`model` opsiyonel.
 *  `createdAt`/`updatedAt` = epoch ms. Liste updated_at DESC (en yeni ilk). */
export interface ChatSession {
  id: string;
  title: string;
  scopeJson?: string | null;
  model?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Soft-delete zaman damgasi (epoch ms) — dolu ise oturum copte. `chat_list_sessions`
   *  yalniz null olanlari doner; copteki oturumlar `chat_list_trashed_sessions` ile gelir. */
  deletedAt?: number | null;
  /** Oturumun konustugu ARSIV (v26): `"local"` = bu makine · `"remote"` = LAN ana arsiv.
   *  `AssetSource` ile ayni degerler. Atiflar asset **id**'sidir ve id uzayi kaynaga gore
   *  degisir → liste bununla suzulur, atif kapisi bununla acilir/kapanir. */
  source: string;
  /** Uzak oturumun konustugu ana arsiv etiketi ("192.168.1.5:9471"); yerelde null.
   *  Baska host'a eslesilince id uzayi YINE degisir → "ayni ana arsiv mi" sorusu bununla
   *  cevaplanir (uyusmazlikta atif tiklamasi kapatilir). */
  hostLabel?: string | null;
}

/** Sohbet mesaji (sunucu `ChatMessageDto`, camelCase). `citationsJson` = atiflarin JSON'u
 *  (yukleme aninda `Citation[]`'e parse edilir). `role` = "user" | "assistant". */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  citationsJson?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  createdAt: number;
}

export interface ChatExportLabels {
  date: string;
  model: string;
  scope: string;
  allArchive: string;
  customScope: string;
  user: string;
  assistant: string;
  sources: string;
  unknown: string;
  pagePrefix: string;
  pageSuffix: string;
}

/** Kalici sohbet oturumu/mesaj komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const chatSessionsIpc = {
  /** Yeni oturum olustur → olusan satir (frontend hemen aktif sohbet yapar). `title` = ilk
   *  sorunun kisaltmasi; `scopeJson`/`model` opsiyonel.
   *
   *  `source` ZORUNLU (v26): oturumun konustugu arsiv. Varsayilani YOK — backend taninmayan
   *  degeri reddeder — cunku atif id'lerinin hangi uzaya ait oldugu sonradan turetilemez.
   *  `hostLabel` yalniz uzakta anlamli (hangi ana arsiv). */
  chatCreateSession: (
    title: string,
    scopeJson: string | null | undefined,
    model: string | null | undefined,
    source: "local" | "remote",
    hostLabel?: string | null,
  ): Promise<ChatSession> =>
    invoke<ChatSession>("chat_create_session", { title, scopeJson, model, source, hostLabel }),

  /** Oturumlari son-guncellenen ilk (updated_at DESC) listele. `limit <= 0` → 100. */
  chatListSessions: (limit: number): Promise<ChatSession[]> =>
    invoke<ChatSession[]>("chat_list_sessions", { limit }),

  /** Oturumu sil — SOFT-DELETE (deleted_at doldurulur; mesajlar korunur). Geri-alinabilir:
   *  `chatRestoreSession`. Listeden duser (`chat_list_sessions` deleted_at IS NULL suzegi). */
  chatDeleteSession: (sessionId: string): Promise<void> =>
    invoke<void>("chat_delete_session", { sessionId }),

  /** Soft-delete edilmis oturumu geri yukle (deleted_at temizlenir) → tekrar aktif listede. */
  chatRestoreSession: (id: string): Promise<void> =>
    invoke<void>("chat_restore_session", { id }),

  /** Copteki oturumu KALICI sil (deleted_at dolu satir + mesajlar; geri alinamaz). */
  chatPurgeSession: (id: string): Promise<void> => invoke<void>("chat_purge_session", { id }),

  /** Copteki (deleted_at dolu) oturumlari listele — kurtarma UI'si icin. */
  chatListTrashedSessions: (): Promise<ChatSession[]> =>
    invoke<ChatSession[]>("chat_list_trashed_sessions"),

  /** Copteki oturum sayisi (listeyi yuklemeden yalniz ozet gerekirse). Sohbet copunde rozet,
   *  zaten gorunen `chatListTrashedSessions` sonucunun uzunlugundan gelir; ikinci IPC sorgusu
   *  yapmaz. Bu sarmalayici gelecekteki ozet ekranlari icin korunur. */
  chatTrashCount: (): Promise<number> => invoke<number>("chat_trash_count"),

  /** Oturum basligini degistir + updated_at tazele. */
  chatRenameSession: (sessionId: string, title: string): Promise<void> =>
    invoke<void>("chat_rename_session", { sessionId, title }),

  /** Mesaj ekle + oturum updated_at tazele (tek TX) → olusan mesaj. `citationsJson` = atif
   *  JSON'u (assistant); `tokensIn`/`tokensOut` opsiyonel (null serbest). */
  chatAppendMessage: (
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    citationsJson?: string | null,
    tokensIn?: number | null,
    tokensOut?: number | null,
  ): Promise<ChatMessage> =>
    invoke<ChatMessage>("chat_append_message", {
      sessionId,
      role,
      content,
      citationsJson,
      tokensIn,
      tokensOut,
    }),

  /** Oturum mesajlarini eskiden yeniye (created_at ASC) listele. */
  chatListMessages: (sessionId: string): Promise<ChatMessage[]> =>
    invoke<ChatMessage[]>("chat_list_messages", { sessionId }),

  /** Sohbet oturumunu Markdown olarak `destPath`'e yaz (H2 chatExport pariti). Owner-scoped
   *  (backend `owner_id`; yabancı/yok-olan → hata). `destPath` frontend `save()` diyalogundan. */
  exportChatMarkdown: (
    sessionId: string,
    destPath: string,
    labels: ChatExportLabels,
  ): Promise<void> => invoke<void>("export_chat_markdown", { sessionId, destPath, labels }),

  /** Oturum icin baslik onerisi (H2 parite §3). `answer`+`model` VERILMEZSE saf deterministik
   *  (Ollama gerekmez, aninda doner) — oturum olusturulurken bu kullanilir. Ikisi de verilirse
   *  LLM rafinesi denenir, basarisizlikta sessizce deterministik tabana duser.
   *
   *  Bos string = sorguda anlamli kelime yok → cagiran `chat.untitled`'a duser. */
  chatSuggestTitle: (
    query: string,
    answer?: string | null,
    model?: string | null,
  ): Promise<string> => invoke<string>("chat_suggest_title", { query, answer, model }),
};

// Tipli Tauri IPC istemcisi — Rust komut/sorgu kontratiyla birebir.
//
// Kaynak: src-tauri/src/commands.rs + crates/archivist-db/src/query.rs DTO'lari.
// Tauri v2: ust-seviye invoke arg'lari camelCase (JS) → snake_case (Rust) cevrilir;
// `opts` gibi struct arg'larin IC alanlari serde adlariyla (snake_case) gecer.
//
// FACADE (saf refactor; ≤500 satir kurali): tipler + komut sarmalayicilari alan-bazli
// modullere bolundu (assets / curation / ingest / files / admin / ai-chat / ai-index).
// Bu dosya tum tipleri yeniden ihrac eder ve `ipc` nesnesini AYNI yuzeyle sunar —
// import siteleri (`../ipc/client`) DEGISMEZ, davranis birebir aynidir.

import { adminIpc } from "./admin";
import { aiChatIpc } from "./ai-chat";
import { aiIndexIpc } from "./ai-index";
import { archivesIpc } from "./archives";
import { assetsIpc } from "./assets";
import { chatSessionsIpc } from "./chat-sessions";
import { curationIpc } from "./curation";
import { filesIpc } from "./files";
import { ingestIpc } from "./ingest";
import { lanIpc } from "./lan";
import { lanClientIpc } from "./lan-client";
import { messagesIpc } from "./messages";
import { remoteArchiveIpc } from "./remote-archive";
import { rootsIpc } from "./roots";

export * from "./admin";
export * from "./ai-chat";
export * from "./ai-index";
export * from "./archives";
export * from "./assets";
export * from "./chat-sessions";
export * from "./curation";
export * from "./files";
export * from "./ingest";
export * from "./lan";
export * from "./lan-client";
export * from "./messages";
export * from "./remote-archive";
export * from "./roots";

/** Tipli komut sarmalayicilari (renderer DB'yi gormez; yalniz bunlari cagirir). */
export const ipc = {
  ...archivesIpc,
  ...assetsIpc,
  ...curationIpc,
  ...ingestIpc,
  ...filesIpc,
  ...adminIpc,
  ...aiChatIpc,
  ...aiIndexIpc,
  ...chatSessionsIpc,
  ...lanIpc,
  ...lanClientIpc,
  ...messagesIpc,
  ...remoteArchiveIpc,
  ...rootsIpc,
};

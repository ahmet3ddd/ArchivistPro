// Ana admin'e tek yonlu yerel oneriler. Alici IPC argumani degildir; backend mesajlari
// tek founder kullaniciya yonlendirir ve gelen kutusunu yalniz ona acar.

import { invoke } from "@tauri-apps/api/core";

/** Backend UserMessageDto'nun camelCase IPC bicimi. createdAt/readAt unix saniyedir. */
export interface UserMessage {
  id: number;
  senderId: number | null;
  senderUsername: string;
  recipientId: number;
  body: string;
  createdAt: number;
  readAt: number | null;
  resolvedAt: number | null;
  resolvedBy: number | null;
}

export const messagesIpc = {
  /** Oturumdaki kullanicinin ana admin'e onerisi. Alici secilemez. */
  sendUserMessage: (body: string): Promise<UserMessage> =>
    invoke<UserMessage>("send_user_message", { body }),

  /** Yalniz ana adminin kendi gelen kutusu. */
  listReceivedUserMessages: (): Promise<UserMessage[]> =>
    invoke<UserMessage[]>("list_received_user_messages"),

  /** Yalniz ana adminin kendi gelen kutusundaki mesaji okundu isaretlemesi. */
  markUserMessageRead: (messageId: number): Promise<void> =>
    invoke<void>("mark_user_message_read", { messageId }),

  /** Yalniz ana adminin kendi gelen kutusundaki oneriyi tamamlamasi. */
  resolveUserMessage: (messageId: number): Promise<void> =>
    invoke<void>("resolve_user_message", { messageId }),
};

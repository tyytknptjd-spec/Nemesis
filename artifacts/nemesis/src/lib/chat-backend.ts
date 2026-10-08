import {
  getNemesisStatus,
  sendNemesisMessage,
} from "@workspace/api-client-react";

export type ChatMessageRole = "user" | "assistant";
export type ChatBackendStatus = "ready" | "offline";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  text: string;
  createdAt: string;
};

export type ChatBackendResult =
  | { status: "offline"; reason: "provider-not-selected" }
  | { status: "reply"; text: string };

export interface ChatBackend {
  getStatus(signal: AbortSignal): Promise<ChatBackendStatus>;
  complete(input: {
    messages: readonly ChatMessage[];
    signal: AbortSignal;
  }): Promise<ChatBackendResult>;
}

export const chatBackend: ChatBackend = {
  async getStatus(signal) {
    try {
      const result = await getNemesisStatus({ signal });
      return result.status;
    } catch {
      return "offline";
    }
  },
  async complete({ messages, signal }) {
    const result = await sendNemesisMessage(
      {
        messages: messages.slice(-10).map(({ role, text }) => ({ role, text })),
      },
      { signal },
    );
    return { status: "reply", text: result.reply };
  },
};

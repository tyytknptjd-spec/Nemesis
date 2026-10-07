export type ChatMessageRole = "user" | "assistant";

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
  readonly status: "offline" | "connected";
  complete(input: {
    messages: readonly ChatMessage[];
    signal: AbortSignal;
  }): Promise<ChatBackendResult>;
}

/**
 * Default until the user chooses an AI provider. This adapter is local-only
 * and deliberately performs no network requests.
 */
export const chatBackend: ChatBackend = {
  status: "offline",
  async complete() {
    return { status: "offline", reason: "provider-not-selected" };
  },
};

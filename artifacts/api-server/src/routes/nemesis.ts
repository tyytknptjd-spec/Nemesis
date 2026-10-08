import { Router, type IRouter } from "express";
import {
  GetNemesisStatusResponse,
  SendNemesisMessageBody,
  SendNemesisMessageResponse,
  type ApiError,
} from "@workspace/api-zod";

const router: IRouter = Router();
const OPENAI_MODEL = "gpt-6-luna";
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const MAX_HISTORY_MESSAGES = 10;
const MAX_TOTAL_MESSAGE_CHARACTERS = 20_000;
const MAX_OUTPUT_TOKENS = 1024;

let requestWindowStartedAt = 0;
let requestsInWindow = 0;

function errorResponse(error: string): ApiError {
  return { error };
}

function tryUseRequestSlot(): boolean {
  const now = Date.now();
  if (now - requestWindowStartedAt >= REQUEST_WINDOW_MS) {
    requestWindowStartedAt = now;
    requestsInWindow = 0;
  }

  if (requestsInWindow >= MAX_REQUESTS_PER_WINDOW) return false;
  requestsInWindow += 1;
  return true;
}

function extractReplyText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const response = value as {
    output_text?: unknown;
    output?: unknown;
  };

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (!Array.isArray(response.output)) return "";

  return response.output
    .flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const message = item as { role?: unknown; content?: unknown };
      if (message.role !== "assistant" || !Array.isArray(message.content)) {
        return [];
      }
      return message.content.flatMap((part: unknown) => {
        if (!part || typeof part !== "object") return [];
        const output = part as { type?: unknown; text?: unknown };
        return output.type === "output_text" && typeof output.text === "string"
          ? [output.text]
          : [];
      });
    })
    .join("")
    .trim();
}

router.get("/nemesis/status", (_req, res): void => {
  const status = process.env.OPENAI_API_KEY?.trim() ? "ready" : "offline";
  res.json(
    GetNemesisStatusResponse.parse({
      status,
      model: OPENAI_MODEL,
    }),
  );
});

router.post("/nemesis/chat", async (req, res): Promise<void> => {
  const parsed = SendNemesisMessageBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn("Rejected invalid Nemesis chat request");
    res.status(400).json(errorResponse("The chat request is invalid."));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json(errorResponse("Nemesis is not connected yet."));
    return;
  }

  const messages = parsed.data.messages.slice(-MAX_HISTORY_MESSAGES);
  const totalCharacters = messages.reduce(
    (total, message) => total + message.text.length,
    0,
  );
  if (totalCharacters > MAX_TOTAL_MESSAGE_CHARACTERS) {
    res.status(400).json(errorResponse("The conversation is too long to send."));
    return;
  }

  if (!tryUseRequestSlot()) {
    res.setHeader("Retry-After", "60");
    res.status(429).json(errorResponse("Nemesis is receiving too many requests. Try again shortly."));
    return;
  }

  const controller = new AbortController();
  let clientDisconnected = false;
  let timedOut = false;
  const abortForDisconnect = () => {
    clientDisconnected = true;
    controller.abort();
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  req.once("aborted", abortForDisconnect);
  res.once("close", () => {
    if (!res.writableEnded) abortForDisconnect();
  });

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "developer",
            content:
              "You are Nemesis, a helpful text assistant. Answer the user's latest message clearly and honestly, using the recent conversation for context. Do not claim to have performed actions outside this chat.",
          },
          ...messages.map(({ role, text }) => ({
            role,
            content: text,
          })),
        ],
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      req.log.error(
        { statusCode: upstream.status },
        "OpenAI rejected a Nemesis chat request",
      );
      res.status(502).json(errorResponse("Nemesis could not finish the reply."));
      return;
    }

    const reply = extractReplyText(await upstream.json());
    const output = SendNemesisMessageResponse.safeParse({ reply });
    if (!output.success) {
      req.log.error("OpenAI returned no usable text for Nemesis");
      res.status(502).json(errorResponse("Nemesis did not receive a usable reply."));
      return;
    }

    res.json(output.data);
  } catch (error) {
    if (clientDisconnected || res.destroyed) return;

    if (timedOut) {
      req.log.warn("Nemesis chat request timed out");
    } else {
      req.log.error({ err: error }, "Nemesis chat request failed");
    }
    res.status(502).json(errorResponse("Nemesis could not finish the reply."));
  } finally {
    clearTimeout(timeout);
    req.off("aborted", abortForDisconnect);
  }
});

export default router;

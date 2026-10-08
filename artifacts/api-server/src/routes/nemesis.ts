import { Router, type IRouter } from "express";
import {
  GetNemesisStatusResponse,
  SendNemesisMessageBody,
  SendNemesisMessageResponse,
  type ApiError,
} from "@workspace/api-zod";

const router: IRouter = Router();
const GEMINI_MODEL = "gemini-3.8-flash";
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const MAX_HISTORY_MESSAGES = 10;
const MAX_TOTAL_MESSAGE_CHARACTERS = 20_000;
const MAX_OUTPUT_TOKENS = 8192;

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
  const response = value as { candidates?: unknown };
  if (!Array.isArray(response.candidates)) return "";
  const candidate = response.candidates[0];
  if (!candidate || typeof candidate !== "object") return "";
  const content = (candidate as { content?: unknown }).content;
  if (!content || typeof content !== "object") return "";
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .flatMap((part: unknown) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("")
    .trim();
}

router.get("/nemesis/status", (_req, res): void => {
  const status = process.env.GEMINI_API_KEY?.trim() ? "ready" : "offline";
  res.json(
    GetNemesisStatusResponse.parse({
      status,
      model: GEMINI_MODEL,
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

  const apiKey = process.env.GEMINI_API_KEY?.trim();
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
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are Nemesis, a helpful text assistant. Answer the user's latest message clearly and honestly, using the recent conversation for context. Do not claim to have performed actions outside this chat.",
            },
          ],
        },
        contents: messages.map(({ role, text }) => ({
          role: role === "assistant" ? "model" : "user",
          parts: [{ text }],
        })),
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: controller.signal,
      },
    );

    if (!upstream.ok) {
      req.log.error(
        { statusCode: upstream.status },
        "Gemini rejected a Nemesis chat request",
      );
      res.status(502).json(errorResponse("Gemini could not finish the reply."));
      return;
    }

    const reply = extractReplyText(await upstream.json());
    const output = SendNemesisMessageResponse.safeParse({ reply });
    if (!output.success) {
      req.log.error("Gemini returned no usable text for Nemesis");
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

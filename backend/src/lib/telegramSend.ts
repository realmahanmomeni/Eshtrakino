import type { Api } from "grammy";
import type { InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";

const DEFAULT_INTER_SEND_MS = 55;

export type SendMessageOptions = {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: InlineKeyboard;
  disable_web_page_preview?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { error_code?: number; description?: string };
  if (e.error_code === 429) return true;
  return typeof e.description === "string" && e.description.toLowerCase().includes("too many");
}

function retryAfterMs(err: unknown): number {
  if (!err || typeof err !== "object") return 1500;
  const params = (err as { parameters?: { retry_after?: number } }).parameters;
  const sec = params?.retry_after;
  if (typeof sec === "number" && sec > 0) return sec * 1000;
  return 1500;
}

/**
 * sendMessage with 429 retry and optional throttle between calls.
 */
export async function sendMessageWithRetry(
  api: Api,
  chatId: number,
  text: string,
  options?: SendMessageOptions,
  maxAttempts = 5,
): Promise<Message.TextMessage | null> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await api.sendMessage(chatId, text, options);
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxAttempts) {
        await sleep(retryAfterMs(err));
        continue;
      }
      throw err;
    }
  }
  return null;
}

let lastSendAt = 0;

export async function sendMessageThrottled(
  api: Api,
  chatId: number,
  text: string,
  options?: SendMessageOptions,
): Promise<Message.TextMessage | null> {
  const now = Date.now();
  const wait = DEFAULT_INTER_SEND_MS - (now - lastSendAt);
  if (wait > 0) await sleep(wait);
  lastSendAt = Date.now();
  try {
    return await sendMessageWithRetry(api, chatId, text, options);
  } catch (err) {
    console.warn(`[telegramSend] sendMessage failed for chat ${chatId}:`, err);
    return null;
  }
}

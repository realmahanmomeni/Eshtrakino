import type { BotContext } from "../context";

/** Best-effort exit from all active grammY conversations (safe for /start and menu resets). */
export async function exitAllConversations(ctx: BotContext): Promise<void> {
  const conv = ctx.conversation;
  if (!conv) return;

  try {
    const controls = conv as unknown as {
      exitAll?: () => Promise<void>;
      exit?: () => Promise<void>;
    };
    if (typeof controls.exitAll === "function") {
      await controls.exitAll();
      return;
    }
    if (typeof controls.exit === "function") {
      await controls.exit();
    }
  } catch {
    /* no active conversation */
  }
}

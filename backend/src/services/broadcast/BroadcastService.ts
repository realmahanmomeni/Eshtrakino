import { Api } from "grammy";
import { prisma } from "../../lib/prisma";

export type BroadcastAudience = "ALL" | "BUYERS" | "WALLET_ONLY" | "INACTIVE";

export class BroadcastService {
  /**
   * Returns the count and IDs of the target audience.
   */
  async getAudience(audience: BroadcastAudience): Promise<{ count: number; userIds: bigint[] }> {
    let users: { telegramId: bigint }[] = [];

    switch (audience) {
      case "ALL":
        users = await prisma.user.findMany({ select: { telegramId: true } });
        break;

      case "BUYERS":
        users = await prisma.user.findMany({
          where: {
            invoices: { some: { status: "PAID", productId: { not: null } } }
          },
          select: { telegramId: true }
        });
        break;

      case "WALLET_ONLY":
        users = await prisma.user.findMany({
          where: {
            balance: { gt: 0 },
            invoices: { none: { status: "PAID", productId: { not: null } } }
          },
          select: { telegramId: true }
        });
        break;

      case "INACTIVE":
        users = await prisma.user.findMany({
          where: {
            balance: 0,
            invoices: { none: { status: "PAID", productId: { not: null } } }
          },
          select: { telegramId: true }
        });
        break;
    }

    return {
      count: users.length,
      userIds: users.map(u => u.telegramId),
    };
  }

  /**
   * Resilient broadcast loop that handles its own errors without breaking.
   */
  async runBroadcast(
    api: Api,
    userIds: bigint[],
    messageFn: (api: Api, chatId: string | number) => Promise<unknown>,
    onComplete?: (success: number, blocked: number, errors: number) => Promise<void>
  ): Promise<void> {
    let success = 0;
    let blocked = 0;
    let errors = 0;

    // Process in batches of 25 to avoid overwhelming the loop, but send sequentially with delay
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (let i = 0; i < userIds.length; i++) {
      const tgId = userIds[i];
      try {
        await messageFn(api, Number(tgId));
        success++;
      } catch (err: any) {
        const msg = err.message || err.description || String(err);
        if (msg.includes("blocked") || msg.includes("deactivated") || msg.includes("not found")) {
          blocked++;
        } else {
          errors++;
          console.error(`Broadcast error for user ${tgId}:`, err);
        }
      }
      
      // Throttle 50ms per message (20 msgs / sec max)
      await delay(50);
    }

    if (onComplete) {
      await onComplete(success, blocked, errors).catch(console.error);
    }
  }
}

export const broadcastService = new BroadcastService();

import { createConversation } from "@grammyjs/conversations";
import type { Bot } from "grammy";
import type { BotContext } from "../context";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { Callbacks } from "../keyboards/callbacks";
import {
  collectCredentialsConversation,
  createTicketConversation,
  walletTopUpConversation,
} from "./conversations";
import { presentCmsPage } from "../cms/presentPage";

export function registerUserHandlers(bot: Bot<BotContext>): void {
  bot.use(createConversation(collectCredentialsConversation, "collectCredentials"));
  bot.use(createConversation(createTicketConversation, "support"));
  bot.use(createConversation(walletTopUpConversation, "walletTopUp"));

  bot.callbackQuery(Callbacks.wallet, async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();
    await presentCmsPage(ctx, "wallet", "edit");
  });

  bot.callbackQuery(/^wallet:custom:(\d+)$/, async (ctx) => {
    const methodId = Number(ctx.match![1]);
    const method = await paymentMethodService.getById(methodId);
    if (!method || !method.isActive) {
      await ctx.answerCallbackQuery({
        text: "روش پرداخت غیرفعال است",
        show_alert: true,
      });
      return;
    }

    ctx.session.walletTopUpMethodId = methodId;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("walletTopUp");
  });

  /** Legacy entry — falls back to first active CARD inside the conversation */
  bot.callbackQuery(Callbacks.walletTopUp, async (ctx) => {
    ctx.session.walletTopUpMethodId = undefined;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("walletTopUp");
  });

  bot.callbackQuery(/^user:provide_creds:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    ctx.session.credentialsInvoiceId = invoiceId;
    await ctx.answerCallbackQuery();

    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }

    await ctx.conversation.enter("collectCredentials");
  });

  bot.callbackQuery(/^user:tkt:reply:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("support");
  });
}

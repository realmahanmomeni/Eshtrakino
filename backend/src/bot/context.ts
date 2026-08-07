import type { Context, SessionFlavor } from "grammy";
import type {
  Conversation,
  ConversationFlavor,
} from "@grammyjs/conversations";

export interface SessionData {
  lastCategoryId?: number;
  /** Internal DB id for the current admin target (product/payment/user/…) */
  adminTargetId?: number;
  adminTargetType?: "product" | "payment" | "category" | "invoice" | "ticket" | "user";
  /** Invoice id pending interactive rejection reason from admin */
  adminRejectInvoiceId?: number;
  checkoutProductId?: number;
  receiptInvoiceId?: number;
  credentialsInvoiceId?: number;
  /** Selected PaymentMethod.id for wallet top-up conversation */
  walletTopUpMethodId?: number;
  newUserJustCreated?: boolean;
  /** Last interactive user-list filter/page (for profile Back) */
  adminUsersListFilter?: "all" | "active" | "ghost" | "buyers";
  adminUsersListPage?: number;
  /** CMS: pageKey being edited via contextual admin button */
  adminCmsPageKey?: string;
  /** CMS shop: category/product targets for Fluid conversations */
  adminCmsCategoryId?: number;
  adminCmsProductId?: number;
  /** Last CMS panel message (for Fluid remount text↔media) */
  cmsPanelChatId?: number;
  cmsPanelMessageId?: number;
}

/** Explicit defaults for `session({ initial })` — keeps keys defined. */
export function createInitialSession(): SessionData {
  return {
    lastCategoryId: undefined,
    adminTargetId: undefined,
    adminTargetType: undefined,
    adminRejectInvoiceId: undefined,
    checkoutProductId: undefined,
    receiptInvoiceId: undefined,
    credentialsInvoiceId: undefined,
    walletTopUpMethodId: undefined,
    newUserJustCreated: undefined,
    adminUsersListFilter: undefined,
    adminUsersListPage: undefined,
    adminCmsPageKey: undefined,
    adminCmsCategoryId: undefined,
    adminCmsProductId: undefined,
    cmsPanelChatId: undefined,
    cmsPanelMessageId: undefined,
  };
}

/** Context used inside conversations (no ConversationFlavor). */
export type SessionContext = Context & SessionFlavor<SessionData>;

/** Outside middleware context (has ctx.conversation). */
export type BotContext = ConversationFlavor<SessionContext>;

export type EshtrakinoConversation = Conversation<BotContext, SessionContext>;

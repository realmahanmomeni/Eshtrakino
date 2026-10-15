import type { Bot } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, EshtrakinoConversation, SessionContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { prisma } from "../../lib/prisma";
import { ensurePanel, panelFromCtx, waitTextOnPanel, type PanelRef } from "../conversations/wait";
import { supplierPendingImportService } from "../../services/suppliers/SupplierPendingImportService";
import {
  presentPlacementConfirm,
  presentSubCategoryPicker,
} from "./supplierPendingAdminUi";

async function namePrompt(kind: "category" | "subcategory"): Promise<string> {
  const label = kind === "category" ? "دسته‌بندی" : "زیردسته";
  return [
    `➕ <b>افزودن ${label} جدید</b>`,
    "",
    `نام ${label} را وارد کنید:`,
    "",
    "▫️ برای انصراف /cancel را ارسال کنید.",
  ].join("\n");
}

async function runNameConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  kind: "category" | "subcategory",
  pendingId: number,
  categoryIdForSub?: number,
): Promise<void> {
  let panel: PanelRef | null = panelFromCtx(ctx);
  let prompt = await namePrompt(kind);

  while (true) {
    const input = await waitTextOnPanel(conversation, ctx, prompt, panel, {
      parse_mode: "HTML",
    });
    panel = input.panel;

    if (!input.text) {
      return;
    }

    const trimmed = input.text.trim();
    if (trimmed.length < 2) {
      prompt = "⚠️ نام باید حداقل ۲ کاراکتر باشد. دوباره وارد کنید:";
      await ensurePanel(ctx, "⚠️ نام باید حداقل ۲ کاراکتر باشد.", undefined, panel);
      continue;
    }

    if (kind === "category") {
      const dup = await conversation.external(() =>
        prisma.category.findFirst({ where: { name: trimmed } }),
      );
      if (dup) {
        prompt = "⚠️ این دسته از قبل وجود دارد. نام دیگری انتخاب کنید:";
        await ensurePanel(ctx, "⚠️ این دسته از قبل وجود دارد.", undefined, panel);
        continue;
      }

      const category = await conversation.external(() =>
        catalogService.createCategory(trimmed, { isAdminManaged: true }),
      );

      const subs = await conversation.external(() =>
        catalogService.listSubCategoriesByCategory(category.id, true),
      );
      if (subs.length === 0) {
        await conversation.external(() =>
          supplierPendingImportService.savePlacementDraft(pendingId, category.id, null),
        );
        await conversation.external(async (outerCtx) => {
          await presentPlacementConfirm(outerCtx as BotContext, pendingId);
        });
        return;
      }

      await conversation.external(async (outerCtx) => {
        await presentSubCategoryPicker(outerCtx as BotContext, pendingId, category.id);
      });
      return;
    }

    if (!categoryIdForSub) return;

    const dupSub = await conversation.external(() =>
      prisma.subCategory.findFirst({
        where: { categoryId: categoryIdForSub, name: trimmed },
      }),
    );
    if (dupSub) {
      prompt = "⚠️ این زیردسته در همین دسته وجود دارد. نام دیگری وارد کنید:";
      await ensurePanel(ctx, "⚠️ این زیردسته تکراری است.", undefined, panel);
      continue;
    }

    const sub = await conversation.external(() =>
      catalogService.createSubCategory({
        name: trimmed,
        categoryId: categoryIdForSub,
        isAdminManaged: true,
      }),
    );

    await conversation.external(() =>
      supplierPendingImportService.savePlacementDraft(
        pendingId,
        categoryIdForSub,
        sub.id,
      ),
    );

    await conversation.external(async (outerCtx) => {
      await presentPlacementConfirm(outerCtx as BotContext, pendingId);
    });
    return;
  }
}

export async function pendingImportAddCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  pendingIdFromEnter?: number,
): Promise<void> {
  const pendingId =
    pendingIdFromEnter ??
    (await conversation.external((c) => c.session?.adminTargetId));
  if (!pendingId) return;
  await runNameConversation(conversation, ctx, "category", pendingId);
}

export async function pendingImportAddSubCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  pendingIdFromEnter?: number,
  categoryIdFromEnter?: number,
): Promise<void> {
  const pendingId =
    pendingIdFromEnter ??
    (await conversation.external((c) => c.session?.adminTargetId));
  const categoryId =
    categoryIdFromEnter ??
    (await conversation.external((c) => c.session?.adminCmsCategoryId));
  if (!pendingId || !categoryId) return;
  await runNameConversation(conversation, ctx, "subcategory", pendingId, categoryId);
}

export function registerPendingImportPlacementConversations(bot: Bot<BotContext>): void {
  bot.use(
    createConversation(pendingImportAddCategoryConversation, "pendingImportAddCategory"),
  );
  bot.use(
    createConversation(pendingImportAddSubCategoryConversation, "pendingImportAddSubCategory"),
  );
}

import type { EshtrakinoConversation, SessionContext } from "../context";
import { waitText } from "./wait";
import {
  searchCatalogProducts,
  shouldSearchIncludeInactiveProducts,
} from "../../services/catalog/productSearchService";
import { isProductOutOfStockById } from "../../services/catalog/catalogAvailability";
import { searchResultsKeyboard } from "../keyboards/builders";
import { sanitizeCustomerCatalogText } from "../utils/catalogUi";
import { ensureShopCatalogFresh } from "../../services/catalog/shopAvailability";
import { hasAnyAdminAccess } from "../admin/rbac";
import { readShopShowOutOfStock } from "../utils/shopSession";

const SEARCH_PROMPT = [
  "🔍 **جستجو در محصولات اشتراکینو**",
  "",
  "لطفاً نام محصول، برند یا ابزار مورد نظر خود را بنویسید (مثال: Grok، اسپاتیفای، ChatGPT):",
  "",
  "▫️ برای لغو جستجو، دستور /cancel را ارسال کنید.",
].join("\n");

type SearchResultUiRow = {
  id: number;
  name: string;
  outOfStock: boolean;
};

export async function shopSearchConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  if (!ctx.from) return;

  try {
    await ctx.reply(SEARCH_PROMPT, { parse_mode: "Markdown" });

    const query = await waitText(conversation, ctx, "🔍 عبارت جستجو را بنویسید:");
    if (!query) {
      await ctx.reply("❌ جستجو لغو شد.");
      return;
    }

    const displayQuery = sanitizeCustomerCatalogText(query.trim());
    const telegramId = ctx.from.id;

    const sessionShowOos = await conversation.external(async (outerCtx) =>
      readShopShowOutOfStock(outerCtx.session),
    );

    const productsUi = await conversation.external(async (): Promise<SearchResultUiRow[]> => {
      await ensureShopCatalogFresh();
      const isAdmin = await hasAnyAdminAccess(telegramId);
      const showOos = sessionShowOos && isAdmin;
      const hits = await searchCatalogProducts(query, {
        includeInactiveProducts: shouldSearchIncludeInactiveProducts(isAdmin, sessionShowOos),
      });
      const list: SearchResultUiRow[] = [];
      for (const p of hits) {
        const outOfStock = await isProductOutOfStockById(p.id);
        if (!showOos && outOfStock) continue;
        list.push({
          id: p.id,
          name: sanitizeCustomerCatalogText(p.name),
          outOfStock,
        });
      }
      return list;
    });

    if (productsUi.length === 0) {
      await ctx.reply(
        [
          `❌ متاسفانه محصولی با عبارت «${displayQuery}» پیدا نشد.`,
          "می‌توانید نام دیگری را جستجو کنید یا از دسته‌بندی‌های فروشگاه دیدن فرمایید.",
        ].join("\n"),
        {
          reply_markup: searchResultsKeyboard([], displayQuery),
        },
      );
      return;
    }

    await ctx.reply(
      [
        `🔍 **نتایج جستجو برای «${displayQuery}» (${productsUi.length} مورد):**`,
        "",
        "جهت مشاهده و خرید، محصول مورد نظر را انتخاب کنید:",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: searchResultsKeyboard(productsUi, displayQuery),
      },
    );
  } catch (err) {
    console.error("[shopSearchConversation] failed:", err);
    await ctx.reply(
      "⚠️ خطا در جستجو. لطفاً دوباره از منوی فروشگاه «جستجو در محصولات» را بزنید.",
    );
  }
}

import type { EshtrakinoConversation, SessionContext } from "../context";
import { waitText } from "./wait";
import { searchCatalogProducts } from "../../services/catalog/productSearchService";
import { isProductOutOfStockById } from "../../services/catalog/catalogAvailability";
import { searchResultsKeyboard } from "../keyboards/builders";
import { sanitizeCustomerCatalogText } from "../utils/catalogUi";

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

  await ctx.reply(SEARCH_PROMPT, { parse_mode: "Markdown" });

  const query = await waitText(conversation, ctx, "🔍 عبارت جستجو را بنویسید:");
  if (!query) return;

  const displayQuery = sanitizeCustomerCatalogText(query.trim());

  const productsUi = await conversation.external(async (): Promise<SearchResultUiRow[]> => {
    const hits = await searchCatalogProducts(query);
    const list: SearchResultUiRow[] = [];
    for (const p of hits) {
      list.push({
        id: p.id,
        name: sanitizeCustomerCatalogText(p.name),
        outOfStock: await isProductOutOfStockById(p.id),
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
}

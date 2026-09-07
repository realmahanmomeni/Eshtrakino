import type { CredentialRequirement, DeliveryType } from "@prisma/client";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { inventoryService } from "../../services/inventory/InventoryService";
import { prisma } from "../../lib/prisma";
import { formatToman, parsePrice } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { deliveryTypeLabel } from "../keyboards/grid";
import {
  ensurePanel,
  panelFromCtx,
  waitCallbackOnPanel,
  waitOptionalPhoto,
  waitText,
  waitTextOnPanel,
  type PanelRef,
} from "../conversations/wait";
import { InlineKeyboard } from "grammy";
import { exchangeRateService, convertUsdToToman } from "../../services/exchangeRateService";
import {
  adminCatalogKeyboard,
  adminSubCategoriesKeyboard,
  adminProductPickKeyboard,
  convCategoryPickKeyboard,
  convProductPickCategoryKeyboard,
  convProductPickCategoryContentsKeyboard,
  convProductPickSubCategoryPlansKeyboard,
  convProductPickKeyboard,
  convSubCategoryPickKeyboard,
  convSubCategoryEditKeyboard,
  convDeliveryTypeEditKeyboard,
  convProductDurationKeyboard,
  convProductEditKeyboard,
  ConvCb,
} from "./keyboards";

const cancelOnlyKeyboard = {
  inline_keyboard: [[{ text: "❌ لغو", callback_data: ConvCb.cancel }]],
};

const emptyKeyboard = { inline_keyboard: [] as never[] };

function clearProductSession(conversation: EshtrakinoConversation): Promise<void> {
  return conversation.external((c) => {
    c.session.adminTargetId = undefined;
    c.session.adminTargetType = undefined;
  });
}

async function runRestockInput(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productId: number,
  productName: string,
): Promise<boolean> {
  const raw = await waitText(
    conversation,
    ctx,
    [
      "📦 *شارژ انبار*",
      "",
      `📦 محصول: *${productName}*`,
      "",
      "لایسنس ها یا اکانت ها را بفرستید.",
      "هر **خط جدید** برابر با **یک آیتم** انبار است.",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n"),
  );
  if (!raw) return false;

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const count = await conversation.external(async () =>
    inventoryService.bulkRestock(productId, lines),
  );

  if (count === 0) {
    await ctx.reply(
      [
        "⚠️ *هیچ آیتمی ثبت نشد*",
        "",
        "لطفا حداقل یک خط معتبر بفرستید.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return true;
  }

  await ctx.reply(`✅ \`${count}\` آیتم با موفقیت به انبار این محصول اضافه شد.`, {
    parse_mode: "Markdown",
  });
  return true;
}

export async function restockProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!productId) {
      await ctx.reply("محصولی انتخاب نشده.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const product = await conversation.external(async () =>
      toPlain(await catalogService.getProduct(productId, false)),
    );
    if (!product) {
      await clearProductSession(conversation);
      await ctx.reply("محصول یافت نشد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    if (product.deliveryType !== "READY") {
      await clearProductSession(conversation);
      await ctx.reply(
        [
          "⚠️ *شارژ انبار فقط برای محصولات موجودی آماده*",
          "",
          "ابتدا نوع تحویل محصول را روی «موجودی آماده» قرار دهید.",
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
      );
      return;
    }

    await runRestockInput(conversation, ctx, productId, product.name);
    await clearProductSession(conversation);
    await ctx.reply("از منوی کاتالوگ می توانید ادامه دهید.", {
      reply_markup: adminCatalogKeyboard(),
    });
  } catch (err) {
    console.error("restockProductConversation error:", err);
    await clearProductSession(conversation);
    await ctx.reply(
      ["⚠️ *خطا در شارژ انبار*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

export async function setProductStockAlertConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!productId) {
      await ctx.reply("محصولی انتخاب نشده.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const result = await runSetStockAlert(conversation, ctx, productId, {
      finishMarkup: adminCatalogKeyboard(),
    });
    await clearProductSession(conversation);
    if (result === "missing") {
      await ctx.reply("محصول یافت نشد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    // cancel / ok already rendered on the Fluid UI panel
  } catch (err) {
    console.error("setProductStockAlertConversation error:", err);
    try {
      await clearProductSession(conversation);
    } catch {
      /* ignore */
    }
    await ctx.reply(
      ["⚠️ *خطا در تنظیم هشدار موجودی*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

/** Lean stock-alert flow. Fluid UI — single panel, user text deleted. */
async function runSetStockAlert(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productId: number,
  options?: { panel?: PanelRef | null; finishMarkup?: unknown; announceSuccess?: boolean },
): Promise<"ok" | "cancel" | "missing"> {
  const product = await conversation.external(async () =>
    prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, lowStockThreshold: true },
    }),
  );
  if (!product) return "missing";

  let prompt = [
    "⚠️ *تنظیم هشدار موجودی*",
    "",
    `📦 محصول: *${product.name}*`,
    `آستانه فعلی: *${product.lowStockThreshold}*`,
    "",
    "وقتی موجودی به چند عدد رسید ربات هشدار دهد؟",
    "",
    "یک عدد بفرستید:",
  ].join("\n");

  let panel = options?.panel ?? panelFromCtx(ctx);
  if (!panel) {
    panel = await ensurePanel(ctx, prompt, cancelOnlyKeyboard, null);
  }

  while (true) {
    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;
    if (!waited.text) return "cancel";

    const parsedNumber = Number(waited.text.trim().replace(/[,،\s]/g, ""));
    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      prompt = [
        "⚠️ *عدد نامعتبر*",
        "",
        "لطفاً یک عدد صحیح بزرگ تر از صفر بفرستید:",
      ].join("\n");
      continue;
    }

    await conversation.external(async () => {
      await prisma.product.update({
        where: { id: productId },
        data: { lowStockThreshold: parsedNumber },
        select: { id: true },
      });
    });

    if (options?.announceSuccess !== false) {
      await ensurePanel(
        ctx,
        `✅ هشدار موجودی این محصول روی *${parsedNumber}* عدد تنظیم شد.`,
        options?.finishMarkup ?? emptyKeyboard,
        panel,
      );
    }
    return "ok";
  }
}

export async function setProductDurationConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!productId) {
      await ctx.reply("محصولی انتخاب نشده.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const result = await runSetProductDuration(conversation, ctx, productId, {
      finishWithCatalog: true,
    });
    await clearProductSession(conversation);
    if (result === "missing") {
      await ctx.reply("محصول یافت نشد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    // cancel / ok already rendered on the Fluid UI panel
  } catch (err) {
    console.error("setProductDurationConversation error:", err);
    try {
      await clearProductSession(conversation);
    } catch {
      /* ignore */
    }
    await ctx.reply(
      ["⚠️ *خطا در تنظیم مدت اشتراک*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

/**
 * Lean duration flow with presets. Fluid UI — presets via safeEdit,
 * manual input deletes user text and edits the original panel.
 */
async function runSetProductDuration(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productId: number,
  options?: {
    finishWithCatalog?: boolean;
    panel?: PanelRef | null;
    announceSuccess?: boolean;
  },
): Promise<"ok" | "cancel" | "missing"> {
  const product = await conversation.external(async () =>
    prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, durationDays: true },
    }),
  );
  if (!product) return "missing";

  const current =
    product.durationDays != null
      ? `مدت فعلی: *${product.durationDays}* روز`
      : "مدت فعلی: *تنظیم نشده*";

  const finishMarkup = options?.finishWithCatalog
    ? adminCatalogKeyboard()
    : emptyKeyboard;

  const prompt = [
    "⏱ *تنظیم مدت اشتراک*",
    "",
    `📦 محصول: *${product.name}*`,
    current,
    "",
    "یکی از بازه های آماده را انتخاب کنید یا مدت را دستی وارد کنید:",
  ].join("\n");

  const saveDuration = async (days: number, panel: PanelRef): Promise<"ok"> => {
    await conversation.external(async () => {
      await prisma.product.update({
        where: { id: productId },
        data: { durationDays: days },
        select: { id: true },
      });
    });
    if (options?.announceSuccess !== false) {
      await ensurePanel(
        ctx,
        `✅ مدت اشتراک محصول *${product.name}* روی *${days}* روز تنظیم شد.`,
        finishMarkup,
        panel,
      );
    }
    return "ok";
  };

  let panel = options?.panel ?? panelFromCtx(ctx);

  while (true) {
    const waited = await waitCallbackOnPanel(
      conversation,
      ctx,
      prompt,
      convProductDurationKeyboard(),
      panel,
    );
    panel = waited.panel;
    const data = waited.data;
    if (!data) return "cancel";

    const presetMatch = /^conv:dur:(\d+)$/.exec(data);
    if (presetMatch) {
      return saveDuration(Number(presetMatch[1]), panel);
    }

    if (data !== ConvCb.durationManual) {
      continue;
    }

    let manualPrompt = [
      "⌨️ *وارد کردن دستی مدت اشتراک*",
      "",
      `📦 محصول: *${product.name}*`,
      "",
      "تعداد روز اشتراک را به صورت عدد وارد کنید (مثلاً ۴۵):",
    ].join("\n");

    while (true) {
      const manual = await waitTextOnPanel(conversation, ctx, manualPrompt, panel);
      panel = manual.panel;
      if (!manual.text) return "cancel";

      const parsedNumber = Number(manual.text.replace(/[,،\s]/g, ""));
      if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
        manualPrompt = [
          "⚠️ *عدد نامعتبر*",
          "",
          "لطفاً یک عدد صحیح بزرگ تر از صفر بفرستید:",
        ].join("\n");
        continue;
      }

      return saveDuration(parsedNumber, panel);
    }
  }
}

export async function setCredentialReqConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!productId) {
      await ctx.reply("محصولی انتخاب نشده.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const result = await runSetCredentialReq(conversation, ctx, productId, {
      finishMarkup: adminCatalogKeyboard(),
    });
    await clearProductSession(conversation);
    if (result === "missing" || result === "unsupported") {
      await ctx.reply(
        result === "missing"
          ? "محصول یافت نشد."
          : [
              "⚠️ *این محصول نیاز به دریافت اطلاعات اکانت ندارد*",
              "",
              "ابتدا نوع تحویل محصول را روی حالت مرتبط با اطلاعات اکانت قرار دهید.",
            ].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
      );
      return;
    }
    // cancel / ok already rendered on the Fluid UI panel
  } catch (err) {
    console.error("setCredentialReqConversation error:", err);
    try {
      await clearProductSession(conversation);
    } catch {
      /* ignore */
    }
    await ctx.reply(
      ["⚠️ *خطا در تنظیم فیلدهای دریافتی*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

async function runSetCredentialReq(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productId: number,
  options?: { panel?: PanelRef | null; finishMarkup?: unknown; announceSuccess?: boolean },
): Promise<"ok" | "cancel" | "missing" | "unsupported"> {
  const product = await conversation.external(async () =>
    prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, deliveryType: true, credentialReq: true },
    }),
  );
  if (!product) return "missing";

  if (
    product.deliveryType !== "CREDENTIALS_REQUIRED" &&
    product.deliveryType !== "USER_CHOICE"
  ) {
    return "unsupported";
  }

  const waited = await waitCallbackOnPanel(
    conversation,
    ctx,
    [
      "🔑 *تنظیم فیلدهای دریافتی*",
      "",
      `📦 محصول: *${product.name}*`,
      "",
      "لطفاً مشخص کنید ربات برای این محصول چه اطلاعاتی را از مشتری دریافت کند؟",
    ].join("\n"),
    {
      inline_keyboard: [
        [{ text: "📧 فقط ایمیل", callback_data: "conv:credreq:EMAIL_ONLY" }],
        [{ text: "📧 + 🔑 ایمیل و پسورد", callback_data: "conv:credreq:BOTH" }],
        [{ text: "❌ لغو", callback_data: ConvCb.cancel }],
      ],
    },
    options?.panel ?? panelFromCtx(ctx),
  );

  const choice = waited.data;
  if (!choice) return "cancel";

  const match = /^conv:credreq:(EMAIL_ONLY|BOTH)$/.exec(choice);
  if (!match) return "cancel";

  const credentialReq = match[1] as CredentialRequirement;
  await conversation.external(async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { credentialReq },
      select: { id: true },
    });
  });

  if (options?.announceSuccess !== false) {
    await ensurePanel(
      ctx,
      credentialReq === "EMAIL_ONLY"
        ? "✅ فیلدهای دریافتی این محصول روی *فقط ایمیل* تنظیم شد."
        : "✅ فیلدهای دریافتی این محصول روی *ایمیل و پسورد* تنظیم شد.",
      options?.finishMarkup ?? emptyKeyboard,
      waited.panel,
    );
  }
  return "ok";
}

export async function editProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let productId = await conversation.external((c) => c.session.adminTargetId ?? null);
    let panel: PanelRef | null = panelFromCtx(ctx);

    if (!productId) {
      let currentTier: "categories" | "category" | "subcategory" = "categories";
      let selectedCategoryId: number | null = null;
      let selectedCategoryName = "";
      let selectedSubCategoryId: number | null = null;
      let selectedSubCategoryName = "";

      while (!productId) {
        if (currentTier === "categories") {
          const categories = await conversation.external(async () =>
            toPlain(await catalogService.listActiveCategories()),
          );
          if (categories.length === 0) {
            await ensurePanel(
              ctx,
              ["ℹ️ *ویرایش محصول*", "", "دسته‌بندی فعالی وجود ندارد."].join("\n"),
              adminCatalogKeyboard(),
              panel,
            );
            return;
          }

          const pick = await waitCallbackOnPanel(
            conversation,
            ctx,
            [
              "✏️ *ویرایش محصول (مرحله ۱)*",
              "",
              "📁 لطفاً دسته‌بندی مورد نظر را انتخاب کنید:",
            ].join("\n"),
            convProductPickCategoryKeyboard(categories),
            panel,
          );
          panel = pick.panel;
          if (!pick.data || pick.data === ConvCb.cancel) {
            await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
            return;
          }

          const catMatch = /^(?:conv:pick:cat|conv:cat):(\d+)$/.exec(pick.data);
          if (catMatch) {
            selectedCategoryId = Number(catMatch[1]);
            const cat = categories.find((c) => c.id === selectedCategoryId);
            selectedCategoryName = cat?.name ?? "دسته‌بندی";
            currentTier = "category";
            continue;
          }

          await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
          return;
        }

        if (currentTier === "category") {
          const categoryData = await conversation.external(async () => {
            const [subCats, prods] = await Promise.all([
              catalogService.listSubCategoriesByCategory(selectedCategoryId!, true),
              catalogService.listActiveProductsByCategory(selectedCategoryId!),
            ]);
            return {
              subCategories: toPlain(subCats),
              standaloneProducts: toPlain(prods.filter((p: any) => p.subCategoryId == null)),
            };
          });

          const { subCategories, standaloneProducts } = categoryData;

          if (subCategories.length === 0 && standaloneProducts.length === 0) {
            const pick = await waitCallbackOnPanel(
              conversation,
              ctx,
              [
                "✏️ *ویرایش محصول*",
                "",
                `📁 دسته‌بندی: *${selectedCategoryName}*`,
                "",
                "هیچ محصول یا سرویس فعالی در این دسته‌بندی وجود ندارد.",
              ].join("\n"),
              new InlineKeyboard().text("🔙 بازگشت به دسته‌بندی‌ها", ConvCb.pickBackCats),
              panel,
            );
            panel = pick.panel;
            currentTier = "categories";
            continue;
          }

          const pick = await waitCallbackOnPanel(
            conversation,
            ctx,
            [
              "✏️ *ویرایش محصول (مرحله ۲)*",
              "",
              `📁 دسته‌بندی: *${selectedCategoryName}*`,
              "",
              "سرویس یا محصول مورد نظر را انتخاب کنید:",
            ].join("\n"),
            convProductPickCategoryContentsKeyboard(subCategories, standaloneProducts),
            panel,
          );
          panel = pick.panel;
          if (!pick.data || pick.data === ConvCb.cancel) {
            await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
            return;
          }

          if (pick.data === ConvCb.pickBackCats) {
            currentTier = "categories";
            continue;
          }

          const subCatMatch = /^conv:pick:subcat:(\d+)$/.exec(pick.data);
          if (subCatMatch) {
            selectedSubCategoryId = Number(subCatMatch[1]);
            const sub = subCategories.find((s) => s.id === selectedSubCategoryId);
            selectedSubCategoryName = sub?.name ?? "سرویس";
            currentTier = "subcategory";
            continue;
          }

          const prodMatch = /^(?:conv:pick:prod|adm:prd:edit):(\d+)$/.exec(pick.data);
          if (prodMatch) {
            productId = Number(prodMatch[1]);
            break;
          }

          await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
          return;
        }

        if (currentTier === "subcategory") {
          const plans = await conversation.external(async () =>
            toPlain(await catalogService.listActiveProductsBySubCategory(selectedSubCategoryId!)),
          );

          if (plans.length === 0) {
            const pick = await waitCallbackOnPanel(
              conversation,
              ctx,
              [
                "✏️ *ویرایش محصول*",
                "",
                `📑 سرویس: *${selectedSubCategoryName}*`,
                "",
                "هیچ پلن فعالی برای این سرویس وجود ندارد.",
              ].join("\n"),
              new InlineKeyboard().text(
                `🔙 بازگشت به ${selectedCategoryName}`,
                ConvCb.pickBackCat,
              ),
              panel,
            );
            panel = pick.panel;
            currentTier = "category";
            continue;
          }

          const pick = await waitCallbackOnPanel(
            conversation,
            ctx,
            [
              "✏️ *ویرایش محصول (مرحله ۳: پلن‌ها)*",
              "",
              `📑 سرویس: *${selectedSubCategoryName}*`,
              `📁 دسته‌بندی: *${selectedCategoryName}*`,
              "",
              "پلن مورد نظر را جهت ویرایش انتخاب کنید:",
            ].join("\n"),
            convProductPickSubCategoryPlansKeyboard(plans, selectedCategoryName),
            panel,
          );
          panel = pick.panel;
          if (!pick.data || pick.data === ConvCb.cancel) {
            await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
            return;
          }

          if (pick.data === ConvCb.pickBackCat) {
            currentTier = "category";
            continue;
          }

          const prodMatch = /^(?:conv:pick:prod|adm:prd:edit):(\d+)$/.exec(pick.data);
          if (prodMatch) {
            productId = Number(prodMatch[1]);
            break;
          }

          await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
          return;
        }
      }

      await conversation.external((c) => {
        c.session.adminTargetId = productId!;
        c.session.adminTargetType = "product";
      });
    }

    while (true) {
      // Lean select + toPlain — Prisma Decimal/BigInt cannot cross conversation.external()
      const product = await conversation.external(async () => {
        const row: any = await (prisma.product.findFirst as any)({
          where: { id: productId!, isActive: true },
          select: {
            id: true,
            name: true,
            price: true,
            currency: true,
            usdPrice: true,
            description: true,
            deliveryType: true,
            durationDays: true,
            lowStockThreshold: true,
            credentialReq: true,
            bannerFileId: true,
            categoryId: true,
            subCategoryId: true,
            subCategory: { select: { id: true, name: true } },
          },
        });
        return row ? toPlain(row) : null;
      });
      if (!product) {
        await clearProductSession(conversation);
        await ensurePanel(ctx, "محصول یافت نشد.", adminCatalogKeyboard(), panel);
        return;
      }

      const stockCount =
        product.deliveryType === "READY"
          ? await conversation.external(async () => inventoryService.countAvailable(productId!))
          : 0;

      const stockLine =
        product.deliveryType === "READY"
          ? `📦 موجودی انبار: *${stockCount}*`
          : null;

      const durationLine =
        product.durationDays != null
          ? `⏱ مدت اشتراک: *${product.durationDays}* روز`
          : "⏱ مدت اشتراک: *تنظیم نشده*";

      const subCatLine = (product as any).subCategory?.name
        ? `📑 سرویس: *${(product as any).subCategory.name}*`
        : "📑 سرویس: *تنظیم نشده (بدون سرویس)*";

      const prod = product as typeof product & { currency?: string; usdPrice?: number | null };
      const priceLine =
        prod.currency === "USD" && prod.usdPrice != null
          ? `💵 قیمت: *${formatToman(product.price)}* ($${prod.usdPrice})`
          : `💵 قیمت: *${formatToman(product.price)}*`;

      const menu = await waitCallbackOnPanel(
        conversation,
        ctx,
        [
          "✏️ *ویرایش محصول*",
          "",
          `📦 محصول: *${product.name}*`,
          subCatLine,
          priceLine,
          `🚚 نوع تحویل: *${deliveryTypeLabel(product.deliveryType)}*`,
          durationLine,
          `⚠️ آستانه موجودی: *${product.lowStockThreshold}*`,
          ...(stockLine ? [stockLine] : []),
          "",
          "کدام بخش را می خواهید ویرایش کنید؟",
        ].join("\n"),
        convProductEditKeyboard(product),
        panel,
      );
      panel = menu.panel;
      const action = menu.data;

      if (!action || action === ConvCb.cancel) {
        await clearProductSession(conversation);
        await ensurePanel(
          ctx,
          ["❌ *عملیات لغو شد*", "", "از منوی کاتالوگ دوباره شروع کنید."].join("\n"),
          adminCatalogKeyboard(),
          panel,
        );
        return;
      }

      // Handle Edit Product SubCategory
      if (action === ConvCb.editProductSubCategory) {
        const subCategories = await conversation.external(async () =>
          toPlain(await catalogService.listSubCategoriesByCategory((product as any).categoryId, true)),
        );

        const pickSub = await waitCallbackOnPanel(
          conversation,
          ctx,
          [
            "📑 *تغییر سرویس / زیردسته محصول*",
            "",
            `📦 محصول: *${product.name}*`,
            subCatLine,
            "",
            "سرویس جدید را انتخاب کنید (یا «بدون سرویس»):",
          ].join("\n"),
          convSubCategoryPickKeyboard(subCategories, {
            allowSkip: true,
            cancelCb: ConvCb.cancel,
          }),
          panel,
        );
        panel = pickSub.panel;
        if (!pickSub.data || pickSub.data === ConvCb.cancel) {
          continue;
        }

        let newSubCatId: number | null = null;
        if (pickSub.data === "conv:subcat:none") {
          newSubCatId = null;
        } else {
          const m = /^conv:subcat:(\d+)$/.exec(pickSub.data);
          if (m) newSubCatId = Number(m[1]);
        }

        await conversation.external(async () => {
          await catalogService.updateProductSubCategory(productId!, newSubCatId);
        });

        await ensurePanel(
          ctx,
          "✅ سرویس محصول بروزرسانی شد.",
          emptyKeyboard,
          panel,
        );
        continue;
      }

      // Nested edit actions — handled inside this conversation (not adm:* handlers)
      if (
        action === ConvCb.editProductRestock ||
        /^adm:prd:restock:(\d+)$/.test(action)
      ) {
        await runRestockInput(conversation, ctx, productId!, product.name);
        continue;
      }

      if (
        action === ConvCb.editProductAlert ||
        /^adm:prd:alert:(\d+)$/.test(action)
      ) {
        await runSetStockAlert(conversation, ctx, productId!, {
          panel,
          announceSuccess: true,
          finishMarkup: emptyKeyboard,
        });
        continue;
      }

      if (
        action === ConvCb.editProductDuration ||
        /^adm:prd:duration:(\d+)$/.test(action)
      ) {
        await runSetProductDuration(conversation, ctx, productId!, {
          panel,
          finishWithCatalog: false,
          announceSuccess: true,
        });
        continue;
      }

      if (
        action === ConvCb.editProductCredReq ||
        /^adm:prd:cred_req:(\d+)$/.test(action)
      ) {
        const credResult = await runSetCredentialReq(conversation, ctx, productId!, {
          panel,
          announceSuccess: true,
          finishMarkup: emptyKeyboard,
        });
        if (credResult === "unsupported") {
          await ensurePanel(
            ctx,
            [
              "⚠️ *این محصول نیاز به دریافت اطلاعات اکانت ندارد*",
              "",
              "ابتدا نوع تحویل را تغییر دهید.",
            ].join("\n"),
            emptyKeyboard,
            panel,
          );
        }
        continue;
      }

      if (action === ConvCb.editProductDelivery) {
        const del = await waitCallbackOnPanel(
          conversation,
          ctx,
          [
            "🚚 *ویرایش نوع تحویل*",
            "",
            `نوع فعلی: *${deliveryTypeLabel(product.deliveryType)}*`,
            "",
            "نوع تحویل جدید را انتخاب کنید:",
          ].join("\n"),
          convDeliveryTypeEditKeyboard(),
          panel,
        );
        panel = del.panel;
        if (!del.data || del.data === ConvCb.cancel) {
          continue;
        }
        const delMatch =
          /^conv:deledit:(READY|MANUAL|CREDENTIALS_REQUIRED|USER_CHOICE)$/.exec(del.data);
        if (!delMatch) {
          await ensurePanel(ctx, "انتخاب نامعتبر بود.", emptyKeyboard, panel);
          continue;
        }
        const deliveryType = delMatch[1] as DeliveryType;
        await conversation.external(async () => {
          await catalogService.updateProductDeliveryType(productId!, deliveryType);
        });
        await ensurePanel(
          ctx,
          [
            "✅ *نوع تحویل به روز شد*",
            "",
            `🚚 نوع جدید: *${deliveryTypeLabel(deliveryType)}*`,
          ].join("\n"),
          emptyKeyboard,
          panel,
        );
        continue;
      }

      if (action === ConvCb.editProductName) {
        const nameWait = await waitTextOnPanel(
          conversation,
          ctx,
          [
            "📝 *ویرایش نام*",
            "",
            `نام فعلی: *${product.name}*`,
            "",
            "نام جدید را بفرستید:",
          ].join("\n"),
          panel,
        );
        panel = nameWait.panel;
        if (!nameWait.text) {
          continue;
        }
        await conversation.external(async () => {
          await catalogService.updateProductName(productId!, nameWait.text!);
        });
        await ensurePanel(
          ctx,
          ["✅ *نام به روز شد*", "", `📦 نام جدید: *${nameWait.text}*`].join("\n"),
          emptyKeyboard,
          panel,
        );
        continue;
      }

      if (action === ConvCb.editProductPrice) {
        const prod = product as typeof product & { currency?: string; usdPrice?: number | null };
        const currentPriceDisplay =
          prod.currency === "USD" && prod.usdPrice != null
            ? `$${prod.usdPrice} (${formatToman(product.price)})`
            : formatToman(product.price);

        const currPrompt = [
          "💰 *ویرایش قیمت محصول*",
          "",
          `محصول: *${product.name}*`,
          `قیمت فعلی: *${currentPriceDisplay}*`,
          "",
          "واحد پول قیمت گذاری را انتخاب کنید:",
        ].join("\n");

        const currWait = await waitCallbackOnPanel(
          conversation,
          ctx,
          currPrompt,
          new InlineKeyboard()
            .text("💵 قیمت دلاری (USD)", "conv:prd:edit:curr:USD")
            .text("🇮🇷 قیمت تومانی (TOMAN)", "conv:prd:edit:curr:TOMAN")
            .row()
            .text("❌ لغو", ConvCb.cancel),
          panel,
        );
        panel = currWait.panel;
        if (!currWait.data || currWait.data === ConvCb.cancel) {
          continue;
        }

        if (currWait.data === "conv:prd:edit:curr:USD") {
          let usdPrice: number | null = null;
          let usdPrompt = [
            "💰 *ویرایش قیمت محصول (دلاری)*",
            "",
            `محصول: *${product.name}*`,
            "",
            "قیمت جدید به دلار (USD) را بفرستید (مثلاً 5 یا 9.99):",
            "",
            "(برای انصراف /cancel را بفرستید)",
          ].join("\n");

          for (let attempt = 0; attempt < 5 && usdPrice === null; attempt++) {
            const usdWait = await waitTextOnPanel(
              conversation,
              ctx,
              usdPrompt,
              panel,
            );
            panel = usdWait.panel;
            if (!usdWait.text) break;
            const parsed = parseFloat(usdWait.text.trim().replace(/,/g, "."));
            if (!Number.isFinite(parsed) || parsed <= 0) {
              usdPrompt = [
                "⚠️ *قیمت نامعتبر*",
                "",
                "لطفاً یک عدد معتبر به دلار وارد کنید (مثلاً 5 یا 9.99):",
              ].join("\n");
            } else {
              usdPrice = Math.round(parsed * 100) / 100;
            }
          }

          if (usdPrice !== null) {
            const price = await conversation.external(async () => {
              const rate = await exchangeRateService.getUsdRate();
              return convertUsdToToman(usdPrice!, rate);
            });
            await conversation.external(async () => {
              await catalogService.updateProductPrice(productId!, price, "USD", usdPrice);
            });
            await ensurePanel(
              ctx,
              [
                "✅ *قیمت محصول به روز شد*",
                "",
                `💵 قیمت جدید: *$${usdPrice}* (معادل فعلی: *${formatToman(price)}*)`,
              ].join("\n"),
              emptyKeyboard,
              panel,
            );
          }
        } else {
          let price: number | null = null;
          let pricePrompt = [
            "💰 *ویرایش قیمت محصول (تومانی)*",
            "",
            `محصول: *${product.name}*`,
            "",
            "قیمت جدید به تومان را بفرستید (فقط عدد):",
            "",
            "(برای انصراف /cancel را بفرستید)",
          ].join("\n");

          for (let attempt = 0; attempt < 5 && price === null; attempt++) {
            const priceWait = await waitTextOnPanel(
              conversation,
              ctx,
              pricePrompt,
              panel,
            );
            panel = priceWait.panel;
            if (!priceWait.text) break;
            price = parsePrice(priceWait.text);
            if (price === null || price <= 0) {
              pricePrompt = [
                "⚠️ *عدد نامعتبر*",
                "",
                "دوباره قیمت تومان را بفرستید (فقط عدد):",
              ].join("\n");
            }
          }

          if (price !== null && price > 0) {
            await conversation.external(async () => {
              await catalogService.updateProductPrice(productId!, price!, "TOMAN", null);
            });
            await ensurePanel(
              ctx,
              [
                "✅ *قیمت محصول به روز شد*",
                "",
                `💵 قیمت جدید: *${formatToman(price)}*`,
              ].join("\n"),
              emptyKeyboard,
              panel,
            );
          }
        }
        continue;
      }

      if (action === ConvCb.editProductDesc) {
        const descWait = await waitTextOnPanel(
          conversation,
          ctx,
          [
            "🔖 *ویرایش توضیحات (کپشن)*",
            "",
            "توضیحات جدید را بفرستید:",
          ].join("\n"),
          panel,
        );
        panel = descWait.panel;
        if (!descWait.text) {
          continue;
        }
        await conversation.external(async () => {
          await catalogService.updateProductDescription(productId!, descWait.text!);
        });
        await ensurePanel(ctx, "✅ *توضیحات به روز شد.*", emptyKeyboard, panel);
        continue;
      }

      if (action === ConvCb.editProductBanner) {
        const bannerRaw = await waitOptionalPhoto(
          conversation,
          ctx,
          [
            "🖼 *ویرایش بنر محصول*",
            "",
            "تصویر بنر جدید را بفرستید، یا «بدون بنر» را بزنید:",
          ].join("\n"),
        );
        if (bannerRaw === null) {
          continue;
        }
        const bannerFileId = bannerRaw.length > 0 ? bannerRaw : null;
        await conversation.external(async () => {
          await catalogService.updateProductBanner(productId!, bannerFileId);
        });
        await ensurePanel(
          ctx,
          bannerFileId ? "✅ *بنر محصول به روز شد.*" : "✅ *بنر محصول حذف شد.*",
          emptyKeyboard,
          panel,
        );
        continue;
      }

      await ensurePanel(ctx, "گزینه نامعتبر بود.", emptyKeyboard, panel);
    }
  } catch (err) {
    console.error("[EditProduct Error]:", err);
    try {
      await clearProductSession(conversation);
    } catch {
      /* ignore */
    }
    await ctx.reply(
      ["⚠️ *خطا در ویرایش محصول*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

export async function editSubCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let panel: PanelRef | null = panelFromCtx(ctx);

    const categories = await conversation.external(async () =>
      toPlain(await catalogService.listActiveCategories()),
    );
    if (categories.length === 0) {
      await ensurePanel(
        ctx,
        "⚠️ دسته‌ای برای انتخاب وجود ندارد.",
        adminSubCategoriesKeyboard(),
        panel,
      );
      return;
    }

    const catPick = await waitCallbackOnPanel(
      conversation,
      ctx,
      [
        "📑 *ویرایش سرویس — مرحله ۱*",
        "",
        "ابتدا دسته والد سرویس را انتخاب کنید:",
      ].join("\n"),
      convCategoryPickKeyboard(categories),
      panel,
    );
    panel = catPick.panel;
    if (!catPick.data || catPick.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminSubCategoriesKeyboard(), panel);
      return;
    }

    const catMatch = /^conv:cat:(\d+)$/.exec(catPick.data);
    if (!catMatch) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminSubCategoriesKeyboard(), panel);
      return;
    }
    const categoryId = Number(catMatch[1]);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      await ensurePanel(ctx, "دسته یافت نشد.", adminSubCategoriesKeyboard(), panel);
      return;
    }

    const subCategories = await conversation.external(async () =>
      toPlain(await catalogService.listSubCategoriesByCategory(categoryId, true)),
    );
    if (subCategories.length === 0) {
      await ensurePanel(
        ctx,
        `ℹ️ هیچ سرویسی برای دسته *${category.name}* ثبت نشده است.`,
        adminSubCategoriesKeyboard(),
        panel,
      );
      return;
    }

    const subPick = await waitCallbackOnPanel(
      conversation,
      ctx,
      [
        "📑 *ویرایش سرویس — مرحله ۲*",
        "",
        `دسته: *${category.name}*`,
        "",
        "سرویس مورد نظر برای ویرایش یا حذف را انتخاب کنید:",
      ].join("\n"),
      convSubCategoryPickKeyboard(subCategories, { allowSkip: false }),
      panel,
    );
    panel = subPick.panel;
    if (!subPick.data || subPick.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminSubCategoriesKeyboard(), panel);
      return;
    }

    const subMatch = /^conv:subcat:(\d+)$/.exec(subPick.data);
    if (!subMatch) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminSubCategoriesKeyboard(), panel);
      return;
    }
    const subCategoryId = Number(subMatch[1]);

    while (true) {
      const subCategory = await conversation.external(async () =>
        toPlain(await catalogService.getSubCategoryById(subCategoryId)),
      );
      if (!subCategory || !subCategory.isActive) {
        await ensurePanel(ctx, "سرویس یافت نشد یا حذف شده است.", adminSubCategoriesKeyboard(), panel);
        return;
      }

      const productsCount = await conversation.external(async () => {
        const prods = await catalogService.listActiveProductsBySubCategory(subCategoryId);
        return prods.length;
      });

      const menu = await waitCallbackOnPanel(
        conversation,
        ctx,
        [
          "✏️ *مدیریت سرویس*",
          "",
          `📑 نام سرویس: *${subCategory.name}*`,
          `🗂 دسته والد: *${category.name}*`,
          `📦 تعداد پلن‌ها/محصولات فعال: *${productsCount}*`,
          `🔖 توضیحات: ${subCategory.description || "ثبت نشده"}`,
          "",
          "کدام بخش را می‌خواهید ویرایش کنید؟",
        ].join("\n"),
        convSubCategoryEditKeyboard(),
        panel,
      );
      panel = menu.panel;
      const action = menu.data;

      if (!action || action === ConvCb.cancel) {
        await ensurePanel(ctx, "عملیات لغو شد.", adminSubCategoriesKeyboard(), panel);
        return;
      }

      if (action === ConvCb.editSubCategoryName) {
        const newName = await waitText(
          conversation,
          ctx,
          [
            "📝 *ویرایش نام سرویس*",
            "",
            `نام فعلی: *${subCategory.name}*`,
            "",
            "نام جدید را ارسال کنید:",
          ].join("\n"),
        );
        if (newName) {
          await conversation.external(async () => {
            await catalogService.updateSubCategory(subCategoryId, { name: newName });
          });
          await ensurePanel(ctx, "✅ نام سرویس بروزرسانی شد.", emptyKeyboard, panel);
        }
        continue;
      }

      if (action === ConvCb.editSubCategoryDesc) {
        const newDesc = await waitText(
          conversation,
          ctx,
          [
            "🔖 *ویرایش توضیحات سرویس*",
            "",
            `توضیحات فعلی: ${subCategory.description || "ثبت نشده"}`,
            "",
            "توضیحات جدید را ارسال کنید (یا برای حذف `-` بفرستید):",
          ].join("\n"),
        );
        if (newDesc !== null) {
          const descVal = newDesc.trim() === "-" ? null : newDesc.trim();
          await conversation.external(async () => {
            await catalogService.updateSubCategory(subCategoryId, { description: descVal });
          });
          await ensurePanel(ctx, "✅ توضیحات سرویس بروزرسانی شد.", emptyKeyboard, panel);
        }
        continue;
      }

      if (action === ConvCb.deleteSubCategory) {
        await conversation.external(async () => {
          await catalogService.deleteSubCategory(subCategoryId);
        });
        await ensurePanel(
          ctx,
          [
            "✅ *سرویس با موفقیت حذف شد*",
            "",
            `نام سرویس: *${subCategory.name}*`,
            "(محصولات وابسته به این سرویس همچنان در دسته اصلی باقی می‌مانند)",
          ].join("\n"),
          adminSubCategoriesKeyboard(),
          panel,
        );
        return;
      }
    }
  } catch (err) {
    console.error("editSubCategoryConversation error:", err);
    await ctx.reply("⚠️ خطا در ویرایش سرویس.", {
      reply_markup: adminSubCategoriesKeyboard(),
    });
  }
}

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
import {
  adminCatalogKeyboard,
  adminProductPickKeyboard,
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
      const products = await conversation.external(async () =>
        toPlain(await catalogService.listActiveProducts()),
      );
      if (products.length === 0) {
        await ensurePanel(
          ctx,
          ["ℹ️ *ویرایش محصول*", "", "محصول فعالی نیست."].join("\n"),
          adminCatalogKeyboard(),
          panel,
        );
        return;
      }

      const pick = await waitCallbackOnPanel(
        conversation,
        ctx,
        [
          "✏️ *ویرایش محصول*",
          "",
          "محصول مورد نظر را انتخاب کنید:",
        ].join("\n"),
        adminProductPickKeyboard(products, "edit"),
        panel,
      );
      panel = pick.panel;
      if (!pick.data) {
        await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
        return;
      }

      const pickMatch = /^adm:prd:edit:(\d+)$/.exec(pick.data);
      if (!pickMatch) {
        await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
        return;
      }
      productId = Number(pickMatch[1]);
      await conversation.external((c) => {
        c.session.adminTargetId = productId!;
        c.session.adminTargetType = "product";
      });
    }

    while (true) {
      // Lean select + toPlain — Prisma Decimal/BigInt cannot cross conversation.external()
      const product = await conversation.external(async () => {
        const row = await prisma.product.findFirst({
          where: { id: productId!, isActive: true },
          select: {
            id: true,
            name: true,
            price: true,
            description: true,
            deliveryType: true,
            durationDays: true,
            lowStockThreshold: true,
            credentialReq: true,
            bannerFileId: true,
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

      const menu = await waitCallbackOnPanel(
        conversation,
        ctx,
        [
          "✏️ *ویرایش محصول*",
          "",
          `📦 محصول: *${product.name}*`,
          `💵 قیمت: *${formatToman(product.price)}*`,
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
        let price: number | null = null;
        let pricePrompt = [
          "💰 *ویرایش قیمت*",
          "",
          `قیمت فعلی: *${formatToman(product.price)}*`,
          "",
          "قیمت جدید (تومان) را بفرستید:",
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
          if (price === null) {
            pricePrompt = [
              "⚠️ *عدد نامعتبر*",
              "",
              "دوباره قیمت تومان را بفرستید:",
            ].join("\n");
          }
        }
        if (price !== null) {
          await conversation.external(async () => {
            await catalogService.updateProductPrice(productId!, price!);
          });
          await ensurePanel(
            ctx,
            ["✅ *قیمت به روز شد*", "", `💵 قیمت جدید: *${formatToman(price)}*`].join(
              "\n",
            ),
            emptyKeyboard,
            panel,
          );
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

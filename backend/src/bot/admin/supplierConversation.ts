import { InlineKeyboard } from "grammy";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { supplierManager } from "../../services/suppliers";
import { prisma } from "../../lib/prisma";
import { DeliveryType } from "@prisma/client";
import {
  ensurePanel,
  panelFromCtx,
  waitCallbackOnPanel,
  waitTextOnPanel,
  type PanelRef,
} from "../conversations/wait";
import { adminSuppliersKeyboard } from "./keyboards";
import { Callbacks } from "../keyboards/callbacks";
import { SupplierManager } from "../../services/suppliers/SupplierManager";

export async function addSupplierApiKeyConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel: PanelRef | null = panelFromCtx(ctx);

  try {
    // 1. Inspect existing suppliers from DB
    const suppliers = await conversation.external(async () => {
      const list = await prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isActive: true },
        orderBy: { id: "asc" },
      });
      return list.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive }));
    });

    const supKb = new InlineKeyboard();

    // Check if QuantumVault/Quantum Bot is already in the list
    const hasQuantum = suppliers.some(
      (s) => s.name.toLowerCase() === "quantumvault" || s.name.toLowerCase() === "quantum bot",
    );

    if (!hasQuantum) {
      supKb.text("🤖 کوانتوم بات (Quantum Bot / QuantumVault)", "conv:sup:preset:QuantumVault").row();
    }

    for (const s of suppliers) {
      supKb.text(`🔹 ${s.name}`, `conv:sup:id:${s.id}`).row();
    }

    supKb.text("➕ وارد کردن نام تامین‌کننده جدید", "conv:sup:new").row();
    supKb.text("❌ لغو", "conv:cancel");

    const supPrompt = [
      "🔗 <b>افزودن کلید تامین‌کننده (API Key)</b>",
      "",
      "لطفاً تامین‌کننده مورد نظر را انتخاب کنید یا نام جدید وارد نمایید:",
    ].join("\n");

    const supRes = await waitCallbackOnPanel(conversation, ctx, supPrompt, supKb, panel);
    panel = supRes.panel;

    if (!supRes.data || supRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    let supplierName: string;

    if (supRes.data === "conv:sup:preset:QuantumVault") {
      supplierName = "QuantumVault";
    } else if (supRes.data === "conv:sup:new") {
      const nameRes = await waitTextOnPanel(
        conversation,
        ctx,
        [
          "🏷 <b>نام تامین‌کننده جدید</b>",
          "",
          "لطفاً نام تامین‌کننده را وارد کنید (مثلاً <code>Quantum Bot</code> یا <code>CustomSupplier</code>):",
          "",
          "(برای انصراف /cancel را ارسال کنید)",
        ].join("\n"),
        panel,
      );
      panel = nameRes.panel;
      if (!nameRes.text) {
        await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
        return;
      }
      supplierName = nameRes.text.trim();
    } else {
      const supMatch = /^conv:sup:id:(\d+)$/.exec(supRes.data);
      if (!supMatch || !supMatch[1]) {
        await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminSuppliersKeyboard(), panel);
        return;
      }
      const supplierMatchId = parseInt(supMatch[1] ?? "", 10);
      const found = suppliers.find((s) => s.id === supplierMatchId);
      if (!found) {
        await ensurePanel(ctx, "تامین‌کننده یافت نشد.", adminSuppliersKeyboard(), panel);
        return;
      }
      supplierName = found.name;
    }

    // Upsert supplier in DB
    const supplier = await conversation.external(async () => {
      let sup = await prisma.supplier.findFirst({
        where: {
          OR: [{ name: supplierName }, { name: supplierName.trim() }],
        },
        select: { id: true, name: true, isActive: true },
      });
      if (!sup) {
        sup = await prisma.supplier.create({
          data: { name: supplierName.trim(), isActive: true },
          select: { id: true, name: true, isActive: true },
        });
      } else if (!sup.isActive) {
        sup = await prisma.supplier.update({
          where: { id: sup.id },
          data: { isActive: true },
          select: { id: true, name: true, isActive: true },
        });
      }
      return { id: sup.id, name: sup.name, isActive: sup.isActive };
    });

    // 2. Prompt for API Key
    const keyPrompt = [
      `🔑 <b>ورود کلید API تامین‌کننده</b>`,
      "",
      `تامین‌کننده: <b>${supplier.name}</b>`,
      "",
      "لطفاً مقدار <b>API Key</b> را ارسال کنید:",
      "",
      "(برای انصراف /cancel را ارسال کنید)",
    ].join("\n");

    const keyRes = await waitTextOnPanel(conversation, ctx, keyPrompt, panel);
    panel = keyRes.panel;
    if (!keyRes.text) {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }
    const keyValue = keyRes.text.trim();

    // 3. Prompt for Key Label
    const keyCount = await conversation.external(async () =>
      prisma.supplierApiKey.count({ where: { supplierId: supplier.id } }),
    );
    const defaultKeyName = `Key-${keyCount + 1}`;

    const labelPrompt = [
      `🏷 <b>نام‌گذاری کلید تامین‌کننده</b>`,
      "",
      `تامین‌کننده: <b>${supplier.name}</b>`,
      "",
      `یک نام یا برچسب برای این کلید مشخص کنید (پیش‌فرض: <code>${defaultKeyName}</code>):`,
    ].join("\n");

    const labelKb = new InlineKeyboard()
      .text(`استفاده از ${defaultKeyName}`, "conv:label:default")
      .row()
      .text("✏️ تایپ نام دلخواه", "conv:label:custom")
      .row()
      .text("❌ لغو", "conv:cancel");

    const labelRes = await waitCallbackOnPanel(conversation, ctx, labelPrompt, labelKb, panel);
    panel = labelRes.panel;

    if (!labelRes.data || labelRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    let keyName = defaultKeyName;
    if (labelRes.data === "conv:label:custom") {
      const customLabelRes = await waitTextOnPanel(
        conversation,
        ctx,
        `✏️ <b>نام سفارشی کلید</b>\n\nتامین‌کننده: <b>${supplier.name}</b>\n\nلطفاً نام یا برچسب کلید را وارد کنید:`,
        panel,
      );
      panel = customLabelRes.panel;
      if (!customLabelRes.text) {
        await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
        return;
      }
      keyName = customLabelRes.text.trim();
    }

    // 4. Save and Encrypt Key
    const encryptedKey = await conversation.external(() => SupplierManager.encryptKey(keyValue));

    const newKeyId = await conversation.external(async () => {
      const created = await prisma.supplierApiKey.create({
        data: {
          supplierId: supplier.id,
          keyName,
          encryptedKey,
          isActive: true,
          isValid: false,
        },
        select: { id: true },
      });
      return created.id;
    });

    // 5. Validate Key
    const validationResult = await conversation.external(async () => {
      try {
        if (supplierManager.hasAdapter(supplier.name)) {
          const adapter = supplierManager.getAdapter(supplier.name);
          const result = await adapter.validateKey(keyValue);
          if (result.isValid) {
            await prisma.supplierApiKey.update({
              where: { id: newKeyId },
              data: {
                isValid: true,
                lastBalance: result.balance ?? null,
                lastValidatedAt: new Date(),
                lastError: null,
              },
            });
            return {
              success: true,
              balance:
                typeof result.balance === "number"
                  ? result.balance
                  : result.balance != null
                  ? String(result.balance)
                  : null,
              error: null,
            };
          } else {
            await prisma.supplierApiKey.update({
              where: { id: newKeyId },
              data: {
                isValid: false,
                lastError: result.errorMessage ?? "Invalid key response",
                lastValidatedAt: new Date(),
              },
            });
            return {
              success: false,
              balance: null,
              error: result.errorMessage ?? "پاسخ نامعتبر از سرور تامین‌کننده",
            };
          }
        } else {
          return {
            success: false,
            balance: null,
            error: "آداپتور مستقیمی برای این تامین‌کننده متصل نیست (ذخیره شد بدون اعتبارسنجی خودکار).",
          };
        }
      } catch (err: any) {
        await prisma.supplierApiKey.update({
          where: { id: newKeyId },
          data: {
            isValid: false,
            lastError: err.message,
            lastValidatedAt: new Date(),
          },
        });
        return {
          success: false,
          balance: null,
          error: String(err?.message || "خطای نامشخص"),
        };
      }
    });

    // 6. Success Feedback
    const successLines = [
      "✅ <b>کلید تامین‌کننده با موفقیت ذخیره شد</b>",
      "",
      `🔗 تامین‌کننده: <b>${supplier.name}</b>`,
      `🔑 نام کلید: <b>${keyName}</b>`,
      `📊 وضعیت اعتبارسنجی: ${validationResult.success ? "✅ معتبر" : "⚠️ ذخیره شد (نیاز به بررسی)"}`,
    ];

    if (validationResult.success && validationResult.balance != null) {
      successLines.push(`💵 موجودی در پنل تامین‌کننده: <b>${validationResult.balance}</b>`);
    } else if (!validationResult.success && validationResult.error) {
      successLines.push(`⚠️ پیام وضعیت: ${validationResult.error}`);
    }

    const finishKb = new InlineKeyboard()
      .text("➕ افزودن کلید دیگر", "adm:sup:addkey")
      .row()
      .text("🔄 تنظیم نگاشت محصولات", "adm:sup:map")
      .row()
      .text("🔗 مدیریت تامین‌کنندگان", "adm:suppliers")
      .row()
      .text("🔙 بازگشت به پنل", Callbacks.adminHome);

    await ensurePanel(ctx, successLines.join("\n"), finishKb, panel);
  } catch (err) {
    console.error("addSupplierApiKeyConversation error:", err);
    await ensurePanel(
      ctx,
      "⚠️ خطا در افزودن کلید تامین‌کننده. لطفاً مجدداً تلاش کنید.",
      adminSuppliersKeyboard(),
      panel,
    );
  }
}

export async function mapSupplierProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel: PanelRef | null = panelFromCtx(ctx);

  try {
    // 1. Fetch active products (only primitive fields to prevent DataCloneError)
    const products = await conversation.external(async () => {
      const list = await prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          deliveryType: true,
          supplierProductMapping: {
            select: {
              id: true,
              supplierProductKey: true,
            },
          },
        },
        orderBy: [
          { deliveryType: "asc" },
          { id: "asc" },
        ],
      });
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        deliveryType: p.deliveryType,
        supplierProductMapping: p.supplierProductMapping
          ? {
              id: p.supplierProductMapping.id,
              supplierProductKey: p.supplierProductMapping.supplierProductKey,
            }
          : null,
      }));
    });

    if (products.length === 0) {
      await ensurePanel(ctx, "⚠️ هیچ محصول فعالی برای نگاشت وجود ندارد.", adminSuppliersKeyboard(), panel);
      return;
    }

    const prodKb = new InlineKeyboard();
    for (const p of products) {
      const mark = p.supplierProductMapping ? "🔄" : (p.deliveryType === "SUPPLIER_AUTO" ? "🤖" : "📦");
      const sub = p.supplierProductMapping ? ` (مپ شده: ${p.supplierProductMapping.supplierProductKey})` : "";
      const label = `${mark} ${p.name}${sub}`;
      prodKb.text(label.length > 50 ? `${label.slice(0, 48)}…` : label, `conv:map:p:${p.id}`).row();
    }
    prodKb.text("❌ لغو", "conv:cancel");

    const prodPrompt = [
      "🔄 <b>تنظیم نگاشت محصولات (Product Mapping)</b>",
      "",
      "محصول مورد نظر را برای اتصال به تامین‌کننده انتخاب کنید:",
      "💡 علامت 🔄 = دارای نگاشت فعلی",
      "💡 علامت 🤖 = نوع تحویل خودکار (<code>SUPPLIER_AUTO</code>)",
    ].join("\n");

    const prodRes = await waitCallbackOnPanel(conversation, ctx, prodPrompt, prodKb, panel);
    panel = prodRes.panel;

    if (!prodRes.data || prodRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    const prodMatch = /^conv:map:p:(\d+)$/.exec(prodRes.data);
    if (!prodMatch || !prodMatch[1]) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminSuppliersKeyboard(), panel);
      return;
    }
    const productId = parseInt(prodMatch[1] ?? "", 10);
    if (!productId || Number.isNaN(productId) || productId <= 0) {
      await ensurePanel(ctx, "شناسه محصول نامعتبر است.", adminSuppliersKeyboard(), panel);
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) {
      await ensurePanel(ctx, "محصول یافت نشد.", adminSuppliersKeyboard(), panel);
      return;
    }

    // 2. Fetch or ensure suppliers
    let suppliers = await conversation.external(async () => {
      const list = await prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isActive: true },
        orderBy: { id: "asc" },
      });
      return list.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive }));
    });

    if (suppliers.length === 0) {
      const defaultSup = await conversation.external(async () => {
        let sup = await prisma.supplier.findFirst({
          where: {
            OR: [
              { name: "QuantumVault" },
              { name: "Quantum Bot" },
              { name: { contains: "quantum", mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, isActive: true },
        });
        if (!sup) {
          sup = await prisma.supplier.create({
            data: { name: "QuantumVault", isActive: true },
            select: { id: true, name: true, isActive: true },
          });
        } else if (!sup.isActive) {
          sup = await prisma.supplier.update({
            where: { id: sup.id },
            data: { isActive: true },
            select: { id: true, name: true, isActive: true },
          });
        }
        return { id: sup.id, name: sup.name, isActive: sup.isActive };
      });
      suppliers = [defaultSup];
    }

    const supKb = new InlineKeyboard();
    for (const s of suppliers) {
      const isQ = /quantum/i.test(s.name);
      supKb.text(`${isQ ? "🤖" : "🔹"} ${s.name}`, `conv:map:s:${s.id}`).row();
    }
    supKb.text("❌ لغو", "conv:cancel");

    const supPrompt = [
      `🔄 <b>انتخاب تامین‌کننده برای ${product.name}</b>`,
      "",
      "تامین‌کننده متصل به این محصول را انتخاب کنید:",
    ].join("\n");

    const supRes = await waitCallbackOnPanel(conversation, ctx, supPrompt, supKb, panel);
    panel = supRes.panel;

    if (!supRes.data || supRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    const supMatch2 = /^conv:map:s:(\d+)$/.exec(supRes.data);
    if (!supMatch2 || !supMatch2[1]) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminSuppliersKeyboard(), panel);
      return;
    }
    const supplierId = parseInt(supMatch2[1] ?? "", 10);
    if (!supplierId || Number.isNaN(supplierId) || supplierId <= 0) {
      await ensurePanel(ctx, "شناسه تامین‌کننده نامعتبر است.", adminSuppliersKeyboard(), panel);
      return;
    }
    let supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) {
      const dbSup = await conversation.external(async () => {
        const found = await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { id: true, name: true, isActive: true },
        });
        return found ? { id: found.id, name: found.name, isActive: found.isActive } : null;
      });
      supplier = dbSup ?? suppliers[0]!;
    }

    // 3. Select or enter supplierProductKey (with known Quantum Bot presets)
    const codeKb = new InlineKeyboard()
      .text("🤖 gemini_18_month_link (جمنای ۱۸ ماهه)", "conv:map:code:gemini_18_month_link")
      .row()
      .text("🤖 gemini_18_month (جمنای ۱۸ ماه)", "conv:map:code:gemini_18_month")
      .row()
      .text("🤖 gemini_advanced (جمنای ادونسد)", "conv:map:code:gemini_advanced")
      .row()
      .text("🤖 chatgpt_plus (چت جی‌پی‌تی پلاس)", "conv:map:code:chatgpt_plus")
      .row()
      .text("⌨️ وارد کردن کد دستی دیگر", "conv:map:code:manual")
      .row()
      .text("❌ لغو", "conv:cancel");

    const codePrompt = [
      `🔑 <b>کد محصول در سیستم تامین‌کننده (supplierProductKey)</b>`,
      "",
      `محصول: <b>${product.name}</b>`,
      `تامین‌کننده: <b>${supplier.name}</b>`,
      "",
      "یکی از کدهای شناخته‌شده کوانتوم بات را انتخاب کنید یا کد دستی وارد نمایید:",
    ].join("\n");

    const codeRes = await waitCallbackOnPanel(conversation, ctx, codePrompt, codeKb, panel);
    panel = codeRes.panel;

    if (!codeRes.data || codeRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    let supplierProductKey: string;

    if (codeRes.data.startsWith("conv:map:code:") && codeRes.data !== "conv:map:code:manual") {
      supplierProductKey = codeRes.data.replace("conv:map:code:", "");
    } else {
      const customCodeRes = await waitTextOnPanel(
        conversation,
        ctx,
        [
          "🔑 <b>ورود کد دستی محصول تامین‌کننده</b>",
          "",
          "مقدار <code>supplierProductKey</code> را ارسال کنید (مثلاً <code>gemini_18_month_link</code>):",
          "",
          "(برای انصراف /cancel را ارسال کنید)",
        ].join("\n"),
        panel,
      );
      panel = customCodeRes.panel;
      if (!customCodeRes.text) {
        await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
        return;
      }
      supplierProductKey = customCodeRes.text.trim();
    }

    // 4. Variant Key
    const varKb = new InlineKeyboard()
      .text("بدون variant (پیش‌فرض)", "conv:map:var:none")
      .row()
      .text("✏️ وارد کردن variantKey دستی", "conv:map:var:custom")
      .row()
      .text("❌ لغو", "conv:cancel");

    const varPrompt = [
      `🏷 <b>تعیین Variant Key (اختیاری)</b>`,
      "",
      `کد محصول: <code>${supplierProductKey}</code>`,
      "",
      "آیا این محصول در سیستم تامین‌کننده نیاز به <code>variantKey</code> دارد؟",
    ].join("\n");

    const varRes = await waitCallbackOnPanel(conversation, ctx, varPrompt, varKb, panel);
    panel = varRes.panel;

    if (!varRes.data || varRes.data === "conv:cancel") {
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
      return;
    }

    let supplierVariantKey: string | null = null;
    if (varRes.data === "conv:map:var:custom") {
      const customVarRes = await waitTextOnPanel(
        conversation,
        ctx,
        "لطفاً مقدار <code>variantKey</code> را وارد کنید:",
        panel,
      );
      panel = customVarRes.panel;
      if (!customVarRes.text) {
        await ensurePanel(ctx, "❌ عملیات لغو شد.", adminSuppliersKeyboard(), panel);
        return;
      }
      supplierVariantKey = customVarRes.text.trim();
    }

    // 5. Save to Database & ensure product deliveryType is SUPPLIER_AUTO
    await conversation.external(async () => {
      let targetSupplier = await prisma.supplier.findUnique({
        where: { id: supplier.id },
        select: { id: true },
      });

      if (!targetSupplier) {
        const activeKey = await prisma.supplierApiKey.findFirst({
          where: { isActive: true },
          select: { supplierId: true },
        });
        if (activeKey) {
          targetSupplier = { id: activeKey.supplierId };
        } else {
          const firstActive = await prisma.supplier.findFirst({
            where: { isActive: true },
            select: { id: true },
          });
          targetSupplier = firstActive ?? (await prisma.supplier.findFirst({ select: { id: true } }));
        }
      }

      if (!targetSupplier) {
        let defaultSup = await prisma.supplier.findFirst({
          where: {
            OR: [
              { name: "QuantumVault" },
              { name: "Quantum Bot" },
              { name: { contains: "quantum", mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        if (!defaultSup) {
          defaultSup = await prisma.supplier.create({
            data: { name: "QuantumVault", isActive: true },
            select: { id: true },
          });
        }
        targetSupplier = defaultSup;
      }

      const finalSupplierId = targetSupplier.id;

      const existing = await prisma.supplierProductMapping.findFirst({
        where: { productId },
        select: { id: true },
      });

      if (existing) {
        await prisma.supplierProductMapping.update({
          where: { id: existing.id },
          data: {
            supplierId: finalSupplierId,
            supplierProductKey,
            supplierVariantKey: supplierVariantKey || null,
            isAutoPurchase: true,
          },
          select: { id: true },
        });
      } else {
        await prisma.supplierProductMapping.create({
          data: {
            productId,
            supplierId: finalSupplierId,
            supplierProductKey,
            supplierVariantKey: supplierVariantKey || null,
            isAutoPurchase: true,
          },
          select: { id: true },
        });
      }

      await prisma.product.update({
        where: { id: productId },
        data: { deliveryType: DeliveryType.SUPPLIER_AUTO },
        select: { id: true },
      });

      return true;
    });

    const finishKb = new InlineKeyboard()
      .text("🔄 نگاشت محصول دیگر", "adm:sup:map")
      .row()
      .text("➕ افزودن کلید تامین‌کننده", "adm:sup:addkey")
      .row()
      .text("🔗 مدیریت تامین‌کنندگان", "adm:suppliers")
      .row()
      .text("🔙 بازگشت به پنل", Callbacks.adminHome);

    const successMsg = [
      "✅ <b>نگاشت محصول با موفقیت ذخیره شد</b>",
      "",
      `📦 محصول: <b>${product.name}</b>`,
      `🔗 تامین‌کننده: <b>${supplier.name}</b>`,
      `🔑 کد محصول تامین‌کننده: <code>${supplierProductKey}</code>`,
      supplierVariantKey ? `🏷 شناسه Variant: <code>${supplierVariantKey}</code>` : "🏷 شناسه Variant: <b>ندارد</b>",
      "🚚 نوع تحویل محصول: <b>کوانتوم بات 🤖 (<code>SUPPLIER_AUTO</code>)</b>",
      "",
      "سفارش‌های این محصول پس از پرداخت به صورت خودکار از طریق این تامین‌کننده ثبت خواهند شد.",
    ].join("\n");

    await ensurePanel(ctx, successMsg, finishKb, panel);
  } catch (err) {
    console.error("[mapSupplierProductConversation] Error saving mapping:", err);
    await ensurePanel(
      ctx,
      "⚠️ خطا در تنظیم نگاشت محصول. لطفاً مجدداً تلاش کنید.",
      adminSuppliersKeyboard(),
      panel,
    );
  }
}

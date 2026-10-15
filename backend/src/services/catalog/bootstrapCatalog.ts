import { DeliveryType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { exchangeRateService } from "../exchangeRateService";
import {
  settingsService,
  CATALOG_BOOTSTRAP_DONE_KEY,
  CHATGPT_SUBCAT_MIGRATED_KEY,
} from "../settings/SettingsService";

/**
 * Ensures that Category "ابزارهای هوش مصنوعی", SubCategory "جمنای",
 * and Product "جمنای پرو 18 ماهه" exist with Canboso delivery (SUPPLIER_AUTO).
 * Adheres strictly to the Inspect-Before-Create rule to prevent duplicate records.
 */
export async function ensureGeminiProProduct(): Promise<void> {
  try {
    // 1. Inspect Category "ابزارهای هوش مصنوعی"
    const categoryName = "ابزارهای هوش مصنوعی";
    let category = await prisma.category.findFirst({
      where: { name: categoryName },
    });

    if (!category) {
      category = await prisma.category.create({
        data: {
          name: categoryName,
          isActive: true,
        },
      });
      console.log(`[BOOTSTRAP] Created category "${categoryName}" (ID: ${category.id})`);
    } else if (!category.isActive) {
      category = await prisma.category.update({
        where: { id: category.id },
        data: { isActive: true },
      });
      console.log(`[BOOTSTRAP] Re-activated category "${categoryName}" (ID: ${category.id})`);
    }

    // 2. Inspect SubCategory "جمنای" (Gemini) under this category
    const subCategoryName = "جمنای";
    let subCategory = await (prisma as any).subCategory.findFirst({
      where: {
        name: subCategoryName,
        categoryId: category.id,
      },
    });

    if (!subCategory) {
      // Check if it exists under another category or unlinked
      const existingSub = await (prisma as any).subCategory.findFirst({
        where: { name: subCategoryName },
      });

      if (existingSub) {
        subCategory = await (prisma as any).subCategory.update({
          where: { id: existingSub.id },
          data: {
            categoryId: category.id,
            isActive: true,
          },
        });
        console.log(
          `[BOOTSTRAP] Re-linked existing subcategory "${subCategoryName}" (ID: ${subCategory.id}) to category ID ${category.id}`,
        );
      } else {
        subCategory = await (prisma as any).subCategory.create({
          data: {
            name: subCategoryName,
            categoryId: category.id,
            description: "اکانت و اشتراک هوش مصنوعی جمنای گوگل (Google Gemini)",
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Created subcategory "${subCategoryName}" (ID: ${subCategory.id})`);
      }
    } else if (!subCategory.isActive) {
      subCategory = await (prisma as any).subCategory.update({
        where: { id: subCategory.id },
        data: { isActive: true },
      });
      console.log(`[BOOTSTRAP] Re-activated subcategory "${subCategoryName}" (ID: ${subCategory.id})`);
    }

    // 3. Inspect Product "جمنای پرو 18 ماهه"
    const productName = "جمنای پرو 18 ماهه";
    const existingProduct = await prisma.product.findFirst({
      where: {
        name: productName,
      },
    });

    if (!existingProduct) {
      const newProduct = await (prisma.product.create as any)({
        data: {
          name: productName,
          price: 1850000,
          currency: "TOMAN",
          usdPrice: 20.0,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          deliveryType: DeliveryType.SUPPLIER_AUTO, // Canboso supplier dispatch
          durationDays: 540, // 18 months (~540 days)
          description: "اشتراک ۱۸ ماهه جمنای پرو با دسترسی کامل به مدل هوش مصنوعی Gemini 1.5 Pro و Google Advanced",
          isActive: true,
          requiredFields: [],
        },
      });
      console.log(`[BOOTSTRAP] Created product "${productName}" (ID: ${newProduct.id}) with deliveryType SUPPLIER_AUTO.`);
    } else {
      // Reuse existing ID, ensure proper category, subcategory, deliveryType, and active status
      const updatedProduct = await (prisma.product.update as any)({
        where: { id: existingProduct.id },
        data: {
          categoryId: category.id,
          subCategoryId: subCategory.id,
          deliveryType: DeliveryType.SUPPLIER_AUTO,
          durationDays: existingProduct.durationDays ?? 540,
          isActive: true,
        },
      });
      console.log(
        `[BOOTSTRAP] Verified & updated product "${productName}" (ID: ${updatedProduct.id}) with deliveryType SUPPLIER_AUTO.`,
      );
    }

    // 4. Inspect Supplier "Canboso" (primary digital supplier)
    const targetProduct = existingProduct ?? (await prisma.product.findFirst({ where: { name: productName } }));
    let supplier = await prisma.supplier.findFirst({
      where: {
        OR: [
          { name: "Canboso" },
          { name: { contains: "canboso", mode: "insensitive" } },
        ],
      },
    });

    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: "Canboso",
          isActive: true,
        },
      });
      console.log(`[BOOTSTRAP] Created default supplier "Canboso" (ID: ${supplier.id}).`);
    } else if (!supplier.isActive) {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: { isActive: true },
      });
      console.log(`[BOOTSTRAP] Re-activated supplier "${supplier.name}" (ID: ${supplier.id}).`);
    }

    // 5. Inspect SupplierProductMapping for "جمنای پرو 18 ماهه"
    if (targetProduct && supplier) {
      const existingMapping = await prisma.supplierProductMapping.findUnique({
        where: { productId: targetProduct.id },
      });

      if (!existingMapping) {
        await prisma.supplierProductMapping.create({
          data: {
            productId: targetProduct.id,
            supplierId: supplier.id,
            supplierProductKey: "gemini_18_month_link",
            isAutoPurchase: true,
          },
        });
        console.log(
          `[BOOTSTRAP] Created initial mapping for product "${targetProduct.name}" -> supplier "${supplier.name}" (key: gemini_18_month_link).`,
        );
      }
    }
  } catch (err) {
    console.error("[BOOTSTRAP] Error ensuring Gemini Pro 18-month product & supplier:", err);
  }
}

/**
 * Ensures that Category "ابزارهای هوش مصنوعی" has a dedicated SubCategory "ChatGPT"
 * and product "ChatGPT Plus (1 ماه)" relocated under it, priced at 22.0 USD
 * (converted to Toman rounded to nearest 1,000).
 * Adheres strictly to the Inspect-Before-Create rule to prevent duplicate records.
 */
export async function ensureChatGPTSubCategory(): Promise<void> {
  try {
    // 1. Inspect Category "ابزارهای هوش مصنوعی"
    const categoryName = "ابزارهای هوش مصنوعی";
    let category = await prisma.category.findFirst({
      where: {
        OR: [
          { name: categoryName },
          { name: { contains: "هوش مصنوعی" } },
        ],
      },
    });

    if (!category) {
      category = await prisma.category.create({
        data: {
          name: categoryName,
          isActive: true,
        },
      });
      console.log(`[BOOTSTRAP] Created category "${categoryName}" (ID: ${category.id})`);
    } else if (!category.isActive) {
      category = await prisma.category.update({
        where: { id: category.id },
        data: { isActive: true },
      });
      console.log(`[BOOTSTRAP] Re-activated category "${categoryName}" (ID: ${category.id})`);
    }

    // 2. Inspect SubCategory "ChatGPT" under this category
    const subCategoryName = "ChatGPT";
    let subCategory = await (prisma as any).subCategory.findFirst({
      where: {
        categoryId: category.id,
        OR: [
          { name: subCategoryName },
          { name: "چت جی‌پی‌تی" },
          { name: "چت جیپیتی" },
          { name: "چت جی پی تی" },
          { name: { contains: "ChatGPT", mode: "insensitive" } },
        ],
      },
    });

    if (!subCategory) {
      // Check if it exists globally under another category or unlinked
      const existingSub = await (prisma as any).subCategory.findFirst({
        where: {
          OR: [
            { name: subCategoryName },
            { name: "چت جی‌پی‌تی" },
            { name: "چت جیپیتی" },
            { name: "چت جی پی تی" },
            { name: { contains: "ChatGPT", mode: "insensitive" } },
          ],
        },
      });

      if (existingSub) {
        subCategory = await (prisma as any).subCategory.update({
          where: { id: existingSub.id },
          data: {
            name: subCategoryName,
            categoryId: category.id,
            isActive: true,
          },
        });
        console.log(
          `[BOOTSTRAP] Re-linked existing subcategory "${subCategory.name}" (ID: ${subCategory.id}) to category ID ${category.id}`,
        );
      } else {
        subCategory = await (prisma as any).subCategory.create({
          data: {
            name: subCategoryName,
            categoryId: category.id,
            description: "اکانت و اشتراک هوش مصنوعی چت جی‌پی‌تی (OpenAI ChatGPT)",
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Created subcategory "${subCategoryName}" (ID: ${subCategory.id})`);
      }
    } else {
      if (subCategory.name !== subCategoryName || !subCategory.isActive) {
        subCategory = await (prisma as any).subCategory.update({
          where: { id: subCategory.id },
          data: {
            name: subCategoryName,
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Updated subcategory ID ${subCategory.id} to "${subCategoryName}" (active)`);
      }
    }

    // 3. Compute live USD to Toman rate
    let usdRate = 110_000;
    try {
      const liveRate = await exchangeRateService.getUsdRate();
      if (liveRate > 0) usdRate = liveRate;
    } catch {
      // fallback
    }

    const usdPrice = 22.0;
    const tomanPrice = Math.round((usdPrice * usdRate) / 1000) * 1000;
    const targetProductName = "ChatGPT Plus (1 ماه)";

    // 4. Inspect Product "ChatGPT Plus (1 ماه)"
    const existingProduct = await prisma.product.findFirst({
      where: {
        OR: [
          { name: targetProductName },
          { name: { contains: "ChatGPT Plus" } },
          { name: { contains: "ChatGPT" } },
          { name: { contains: "چت جی‌پی‌تی" } },
          { name: { contains: "چت جیپیتی" } },
        ],
      },
    });

    if (!existingProduct) {
      const created = await (prisma.product.create as any)({
        data: {
          name: targetProductName,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          usdPrice: usdPrice,
          price: tomanPrice,
          currency: "TOMAN",
          deliveryType: DeliveryType.READY,
          durationDays: 30,
          description: "اشتراک ۱ ماهه ChatGPT Plus با دسترسی کامل به مدل‌های GPT-4o و ابزارهای هوش مصنوعی OpenAI",
          requiredFields: [],
          isActive: true,
        },
      });
      console.log(
        `[BOOTSTRAP] Created product "${created.name}" (ID: ${created.id}, ${usdPrice} USD / ${tomanPrice} Toman) under SubCategory "${subCategory.name}"`,
      );
    } else {
      const updated = await (prisma.product.update as any)({
        where: { id: existingProduct.id },
        data: {
          name: targetProductName,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          usdPrice: usdPrice,
          price: tomanPrice,
          currency: "TOMAN",
          durationDays: 30,
          isActive: true,
          // Preserve deliveryType if already configured, or default to READY
          deliveryType: existingProduct.deliveryType || DeliveryType.READY,
        },
      });
      console.log(
        `[BOOTSTRAP] Relocated product "${updated.name}" (ID: ${updated.id}) to SubCategory "${subCategory.name}" (ID: ${subCategory.id}) at ${usdPrice} USD / ${tomanPrice} Toman`,
      );
    }
  } catch (err) {
    console.error("[BOOTSTRAP] Error ensuring ChatGPT SubCategory:", err);
  }
}

/**
 * STEP 1: Purge "مایکروسافت" (Microsoft) Category and its products completely.
 */
export async function purgeMicrosoftCatalog(): Promise<void> {
  try {
    const msCategories = await prisma.category.findMany({
      where: {
        OR: [
          { name: { contains: "مایکروسافت" } },
          { name: { contains: "Microsoft", mode: "insensitive" } },
        ],
      },
      include: {
        products: true,
        subCategories: true,
      },
    });

    if (msCategories.length === 0) {
      return;
    }

    for (const cat of msCategories) {
      const productIds = cat.products.map((p) => p.id);
      if (productIds.length > 0) {
        await prisma.productItem.deleteMany({
          where: { productId: { in: productIds } },
        }).catch(() => {});

        await prisma.supplierProductMapping.deleteMany({
          where: { productId: { in: productIds } },
        }).catch(() => {});

        await prisma.invoice.updateMany({
          where: { productId: { in: productIds } },
          data: { productId: null },
        }).catch(() => {});

        await prisma.product.deleteMany({
          where: { id: { in: productIds } },
        });
        console.log(`[BOOTSTRAP] Deleted ${productIds.length} Microsoft products from category "${cat.name}" (ID: ${cat.id})`);
      }

      const subCategoryIds = cat.subCategories.map((s) => s.id);
      if (subCategoryIds.length > 0) {
        await (prisma as any).subCategory.deleteMany({
          where: { id: { in: subCategoryIds } },
        });
      }

      await prisma.category.delete({
        where: { id: cat.id },
      });
      console.log(`[BOOTSTRAP] Deleted Microsoft category "${cat.name}" (ID: ${cat.id})`);
    }
  } catch (err) {
    console.error("[BOOTSTRAP] Error purging Microsoft catalog:", err);
  }
}

/**
 * STEP 2: Bootstrap "استارز تلگرام" (Telegram Stars) Category & 7 Star Products
 * Rates: base 0.0171 USD per star, dynamic Toman conversion via exchangeRateService.
 */
export async function bootstrapTelegramStars(): Promise<void> {
  try {
    const categoryName = "استارز تلگرام";

    // 1. Inspect Category
    let category = await prisma.category.findFirst({
      where: {
        OR: [
          { name: categoryName },
          { name: "استارز" },
          { name: "Telegram Stars" },
          { name: "استارز تلگرام" },
        ],
      },
    });

    if (!category) {
      category = await prisma.category.create({
        data: {
          name: categoryName,
          description: "خرید مستقیم استارز تلگرام (Telegram Stars) با تحویل فوری",
          isActive: true,
        },
      });
      console.log(`[BOOTSTRAP] Created category "${categoryName}" (ID: ${category.id})`);
    } else {
      if (category.name !== categoryName || !category.isActive) {
        category = await prisma.category.update({
          where: { id: category.id },
          data: {
            name: categoryName,
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Updated category name to "${categoryName}" (ID: ${category.id})`);
      }
    }

    // 2. Exchange rate
    let usdRate = 110_000;
    try {
      const liveRate = await exchangeRateService.getUsdRate();
      if (liveRate > 0) usdRate = liveRate;
    } catch {
      // fallback
    }

    // 3. 7 Star Products (Prices in USD, cleanly converted to Toman, NO prices in names)
    const starPackages = [
      { name: "50 استارز", starCount: 50, usdPrice: 0.855 },
      { name: "75 استارز", starCount: 75, usdPrice: 1.2825 },
      { name: "100 استارز", starCount: 100, usdPrice: 1.71 },
      { name: "200 استارز", starCount: 200, usdPrice: 3.42 },
      { name: "250 استارز", starCount: 250, usdPrice: 4.275 },
      { name: "500 استارز", starCount: 500, usdPrice: 8.55 },
      { name: "1000 استارز", starCount: 1000, usdPrice: 17.1 },
    ];

    for (const pkg of starPackages) {
      const tomanPrice = Math.round((pkg.usdPrice * usdRate) / 1000) * 1000;

      // Inspect-Before-Create: look for existing product by exact name or matching package quantity
      const existingProduct = await prisma.product.findFirst({
        where: {
          OR: [
            { name: pkg.name, categoryId: category.id },
            { name: pkg.name },
            {
              categoryId: category.id,
              name: { contains: `${pkg.starCount} استارز` },
            },
          ],
        },
      });

      if (!existingProduct) {
        const created = await (prisma.product.create as any)({
          data: {
            name: pkg.name,
            categoryId: category.id,
            subCategoryId: null,
            usdPrice: pkg.usdPrice,
            price: tomanPrice,
            currency: "TOMAN",
            deliveryType: DeliveryType.SUPPLIER_AUTO,
            isActive: true,
            requiredFields: [],
            description: `بسته ${pkg.name} با تحویل فوری و اتوماتیک به اکانت تلگرام شما`,
          },
        });
        console.log(`[BOOTSTRAP] Created product "${created.name}" (ID: ${created.id}, ${pkg.usdPrice} USD / ${tomanPrice} Toman)`);
      } else {
        const updated = await (prisma.product.update as any)({
          where: { id: existingProduct.id },
          data: {
            name: pkg.name,
            categoryId: category.id,
            subCategoryId: null,
            usdPrice: pkg.usdPrice,
            price: tomanPrice,
            currency: "TOMAN",
            deliveryType: DeliveryType.SUPPLIER_AUTO,
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Updated product "${updated.name}" (ID: ${updated.id}, ${pkg.usdPrice} USD / ${tomanPrice} Toman)`);
      }
    }
  } catch (err) {
    console.error("[BOOTSTRAP] Error bootstrapping Telegram Stars:", err);
  }
}

/**
 * STEP 3: Bootstrap "تلگرام پریمیوم" (Telegram Premium) Category & 3 Subscription Products
 */
export async function bootstrapTelegramPremium(): Promise<void> {
  try {
    const categoryName = "تلگرام پریمیوم";

    // 1. Inspect Category
    let category = await prisma.category.findFirst({
      where: {
        OR: [
          { name: categoryName },
          { name: "تلگرام پرمیوم" },
          { name: "Telegram Premium" },
        ],
      },
    });

    if (!category) {
      category = await prisma.category.create({
        data: {
          name: categoryName,
          description: "اشتراک رسمی تلگرام پریمیوم (Telegram Premium) بدون نیاز به پسورد اکانت",
          isActive: true,
        },
      });
      console.log(`[BOOTSTRAP] Created category "${categoryName}" (ID: ${category.id})`);
    } else {
      if (category.name !== categoryName || !category.isActive) {
        category = await prisma.category.update({
          where: { id: category.id },
          data: {
            name: categoryName,
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Updated category name to "${categoryName}" (ID: ${category.id})`);
      }
    }

    // 2. Exchange rate
    let usdRate = 110_000;
    try {
      const liveRate = await exchangeRateService.getUsdRate();
      if (liveRate > 0) usdRate = liveRate;
    } catch {
      // fallback
    }

    // 3. 3 Subscription Products (Strictly NO prices in names)
    const premiumProducts = [
      {
        name: "تلگرام پریمیوم سه ماهه",
        altNames: ["تلگرام پرمیوم سه ماهه"],
        usdPrice: 13.3,
        durationDays: 90,
      },
      {
        name: "تلگرام پریمیوم شش ماهه",
        altNames: ["تلگرام پرمیوم شش ماهه"],
        usdPrice: 18.0,
        durationDays: 180,
      },
      {
        name: "تلگرام پریموم یک ساله",
        altNames: ["تلگرام پریمیوم یک ساله"],
        usdPrice: 32.0,
        durationDays: 365,
      },
    ];

    for (const item of premiumProducts) {
      const tomanPrice = Math.round((item.usdPrice * usdRate) / 1000) * 1000;

      // Inspect-Before-Create
      const existingProduct = await prisma.product.findFirst({
        where: {
          OR: [
            { name: item.name, categoryId: category.id },
            { name: item.name },
            ...item.altNames.map((n) => ({ name: n, categoryId: category.id })),
            ...item.altNames.map((n) => ({ name: n })),
          ],
        },
      });

      if (!existingProduct) {
        const created = await (prisma.product.create as any)({
          data: {
            name: item.name,
            categoryId: category.id,
            subCategoryId: null,
            usdPrice: item.usdPrice,
            price: tomanPrice,
            currency: "TOMAN",
            deliveryType: DeliveryType.SUPPLIER_AUTO,
            durationDays: item.durationDays,
            isActive: true,
            requiredFields: [],
            description: `اشتراک ${item.name} با فعال‌سازی قانونی و سریع بدون نیاز به اطلاعات خصوصی اکانت`,
          },
        });
        console.log(`[BOOTSTRAP] Created product "${created.name}" (ID: ${created.id}, ${item.usdPrice} USD / ${tomanPrice} Toman)`);
      } else {
        const updated = await (prisma.product.update as any)({
          where: { id: existingProduct.id },
          data: {
            name: item.name,
            categoryId: category.id,
            subCategoryId: null,
            usdPrice: item.usdPrice,
            price: tomanPrice,
            currency: "TOMAN",
            deliveryType: DeliveryType.SUPPLIER_AUTO,
            durationDays: item.durationDays,
            isActive: true,
          },
        });
        console.log(`[BOOTSTRAP] Updated product "${updated.name}" (ID: ${updated.id}, ${item.usdPrice} USD / ${tomanPrice} Toman)`);
      }
    }
  } catch (err) {
    console.error("[BOOTSTRAP] Error bootstrapping Telegram Premium:", err);
  }
}

/**
 * One-time purge of deprecated zombie products that might linger in the database.
 */
export async function purgeDeprecatedProducts(): Promise<void> {
  try {
    const deprecatedNames = [
      "Claude Pro (1 ماه)",
      "Claude Pro",
      "Gemini Advanced",
      "Gemini Advanced ",
    ];

    const zombieProducts = await prisma.product.findMany({
      where: {
        OR: [
          ...deprecatedNames.map((n) => ({ name: n })),
          { name: { contains: "Claude Pro" } },
          { name: { contains: "Gemini Advanced" } },
        ],
      },
      select: { id: true, name: true },
    });

    if (zombieProducts.length === 0) {
      return;
    }

    const ids = zombieProducts.map((p) => p.id);

    // Clean dependent references to respect foreign keys
    await prisma.productItem.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
    await prisma.supplierProductMapping.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
    await prisma.invoice.updateMany({ where: { productId: { in: ids } }, data: { productId: null } }).catch(() => {});

    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    console.log(
      `[BOOTSTRAP] Purged ${zombieProducts.length} deprecated zombie products:`,
      zombieProducts.map((p) => p.name),
    );
  } catch (err) {
    console.error("[BOOTSTRAP] Error purging deprecated products:", err);
  }
}

/**
 * Composite bootstrap function: runs initial catalog integrity routines once,
 * then permanently locks CATALOG_BOOTSTRAP_DONE = true so the PostgreSQL database
 * remains the SOLE authority across all future restarts and rebuilds.
 */
export async function bootstrapCatalog(): Promise<void> {
  try {
    // 1. Check one-time ChatGPT subcategory migration
    const isChatGptMigrated = await settingsService.getBoolSetting(
      CHATGPT_SUBCAT_MIGRATED_KEY,
      false,
    );
    if (!isChatGptMigrated) {
      console.log("[BOOTSTRAP] Executing one-time migration: ChatGPT dedicated SubCategory & 22 USD pricing...");
      await ensureChatGPTSubCategory();
      await settingsService.setBoolSetting(CHATGPT_SUBCAT_MIGRATED_KEY, true);
      console.log("[BOOTSTRAP] ChatGPT SubCategory migration completed successfully.");
    }

    const isBootstrapDone = await settingsService.getBoolSetting(
      CATALOG_BOOTSTRAP_DONE_KEY,
      false,
    );
    if (isBootstrapDone) {
      console.log("[BOOTSTRAP] Catalog already initialized. Skipping all catalog mutations.");
      return;
    }

    console.log("[BOOTSTRAP] Performing first-time catalog setup & cleanup...");
    await purgeDeprecatedProducts();
    await purgeMicrosoftCatalog();
    await ensureGeminiProProduct();
    await ensureChatGPTSubCategory();
    await bootstrapTelegramStars();
    await bootstrapTelegramPremium();

    await settingsService.setBoolSetting(CATALOG_BOOTSTRAP_DONE_KEY, true);
    console.log("[BOOTSTRAP] Initial bootstrap completed and locked permanently.");
  } catch (err) {
    console.error("[BOOTSTRAP] Error during initial catalog bootstrap:", err);
  }
}

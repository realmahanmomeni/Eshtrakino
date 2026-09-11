import { PrismaClient, DeliveryType, PaymentMethodType } from "@prisma/client";

declare const process: any;

interface SeedProduct {
  name: string;
  price: number;
  currency?: string;
  usdPrice?: number;
  deliveryType?: any;
  durationDays?: number;
  description?: string;
  requiredFields?: any;
}

interface SeedSubCategory {
  name: string;
  description?: string;
  products?: SeedProduct[];
}

interface SeedCategory {
  name: string;
  subCategories?: SeedSubCategory[];
  products?: SeedProduct[];
}

const prisma = new PrismaClient();

/**
 * Idempotent demo seed — safe to re-run anytime.
 * Enforces "Inspect-Before-Create" rule across all entities.
 */
async function main(): Promise<void> {
  const categoryCount = await prisma.category.count();
  if (categoryCount > 0) {
    console.log("[SEED] Database already contains categories. Skipping seed to respect database authority.");
    return;
  }

  const categories: SeedCategory[] = [
    {
      name: "ابزارهای هوش مصنوعی",
      subCategories: [
        {
          name: "جمنای",
          description: "اکانت و اشتراک هوش مصنوعی جمنای گوگل (Google Gemini)",
          products: [
            {
              name: "جمنای پرو 18 ماهه",
              price: 1850000,
              currency: "TOMAN",
              usdPrice: 20.0,
              deliveryType: DeliveryType.SUPPLIER_AUTO,
              durationDays: 540,
              requiredFields: [] as string[],
              description: "اشتراک ۱۸ ماهه جمنای پرو با تحویل اتوماتیک کوانتوم بات",
            },
          ],
        },
        {
          name: "ChatGPT",
          description: "اکانت و اشتراک هوش مصنوعی چت جی‌پی‌تی (OpenAI ChatGPT)",
          products: [
            {
              name: "ChatGPT Plus (1 ماه)",
              price: 2420000,
              currency: "TOMAN",
              usdPrice: 22.0,
              deliveryType: DeliveryType.READY,
              durationDays: 30,
              requiredFields: [] as string[],
              description: "اکانت آماده چت جی پی تی پلاس با دسترسی به GPT-4o",
            },
          ],
        },
      ],
      products: [],
    },
  ];

  for (const cat of categories) {
    // Inspect-Before-Create for Category
    let category = await prisma.category.findFirst({ where: { name: cat.name } });
    if (!category) {
      category = await prisma.category.create({
        data: { name: cat.name, isActive: true },
      });
      console.log(`[SEED] Created category: ${category.name}`);
    } else if (!category.isActive) {
      category = await prisma.category.update({
        where: { id: category.id },
        data: { isActive: true },
      });
    }

    // Inspect-Before-Create for SubCategories
    if (cat.subCategories && cat.subCategories.length > 0) {
      for (const sub of cat.subCategories) {
        let subCat = await (prisma as any).subCategory.findFirst({
          where: { name: sub.name, categoryId: category.id },
        });
        if (!subCat) {
          subCat = await (prisma as any).subCategory.create({
            data: {
              name: sub.name,
              categoryId: category.id,
              description: sub.description,
              isActive: true,
            },
          });
          console.log(`[SEED] Created subcategory: ${subCat.name} under ${category.name}`);
        } else if (!subCat.isActive) {
          subCat = await (prisma as any).subCategory.update({
            where: { id: subCat.id },
            data: { isActive: true },
          });
        }

        // Subcategory products
        for (const p of sub.products || []) {
          const existing = await prisma.product.findFirst({
            where: { name: p.name, categoryId: category.id },
          });
          if (!existing) {
            await (prisma.product.create as any)({
              data: {
                name: p.name,
                price: p.price,
                currency: p.currency,
                usdPrice: p.usdPrice,
                categoryId: category.id,
                subCategoryId: subCat.id,
                deliveryType: p.deliveryType,
                durationDays: p.durationDays,
                description: p.description,
                requiredFields: p.requiredFields,
                isActive: true,
              },
            });
            console.log(`[SEED] Created product: ${p.name}`);
          } else {
            await (prisma.product.update as any)({
              where: { id: existing.id },
              data: {
                price: p.price,
                currency: p.currency,
                usdPrice: p.usdPrice,
                subCategoryId: subCat.id,
                deliveryType: p.deliveryType,
                durationDays: p.durationDays,
                description: p.description,
                requiredFields: p.requiredFields,
                isActive: true,
              },
            });
          }
        }
      }
    }

    // Category standalone products
    for (const p of cat.products || []) {
      const existing = await prisma.product.findFirst({
        where: { name: p.name, categoryId: category.id },
      });
      if (!existing) {
        await (prisma.product.create as any)({
          data: {
            name: p.name,
            price: p.price,
            currency: p.currency,
            usdPrice: p.usdPrice,
            categoryId: category.id,
            deliveryType: p.deliveryType,
            durationDays: p.durationDays,
            description: p.description,
            requiredFields: p.requiredFields,
            isActive: true,
          },
        });
        console.log(`[SEED] Created product: ${p.name}`);
      } else {
        await (prisma.product.update as any)({
          where: { id: existing.id },
          data: {
            price: p.price,
            currency: p.currency,
            usdPrice: p.usdPrice,
            deliveryType: p.deliveryType,
            durationDays: p.durationDays,
            description: p.description,
            requiredFields: p.requiredFields,
            isActive: true,
          },
        });
      }
    }
  }

  const paymentMethods = [
    {
      name: "کارت به کارت",
      type: PaymentMethodType.CARD,
      config: JSON.stringify({ cardNumber: "6037-0000-0000-0000" }),
    },
    {
      name: "ZarinPal",
      type: PaymentMethodType.GATEWAY,
      config: JSON.stringify({ token: "REPLACE_ZARINPAL_MERCHANT_ID" }),
    },
  ];

  for (const pm of paymentMethods) {
    const existing = await prisma.paymentMethod.findFirst({ where: { name: pm.name } });
    if (!existing) {
      await prisma.paymentMethod.create({
        data: { ...pm, isActive: true },
      });
    }
  }

  console.log("[SEED] Completed successfully.");
}

main()
  .catch((e) => {
    console.error("[SEED] Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Idempotent demo seed — safe to re-run.
 * Enforces "Inspect-Before-Create" rule across all entities.
 */
import { PrismaClient, DeliveryType, PaymentMethodType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const categoryCount = await prisma.category.count();
  if (categoryCount > 0) {
    console.log("[SEED] Database already contains categories. Skipping seed to respect database authority.");
    return;
  }

  const categories = [
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
              requiredFields: [],
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
              requiredFields: [],
              description: "اکانت آماده چت جی پی تی پلاس با دسترسی به GPT-4o",
            },
          ],
        },
      ],
      products: [],
    },
  ];

  for (const cat of categories) {
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

    if (cat.subCategories && cat.subCategories.length > 0) {
      for (const sub of cat.subCategories) {
        let subCat = await prisma.subCategory.findFirst({
          where: { name: sub.name, categoryId: category.id },
        });
        if (!subCat) {
          subCat = await prisma.subCategory.create({
            data: {
              name: sub.name,
              categoryId: category.id,
              description: sub.description,
              isActive: true,
            },
          });
          console.log(`[SEED] Created subcategory: ${subCat.name} under ${category.name}`);
        } else if (!subCat.isActive) {
          subCat = await prisma.subCategory.update({
            where: { id: subCat.id },
            data: { isActive: true },
          });
        }

        for (const p of sub.products) {
          const existing = await prisma.product.findFirst({
            where: { name: p.name, categoryId: category.id },
          });
          if (!existing) {
            await prisma.product.create({
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
            await prisma.product.update({
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

    for (const p of cat.products) {
      const existing = await prisma.product.findFirst({
        where: { name: p.name, categoryId: category.id },
      });
      if (!existing) {
        await prisma.product.create({
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
        await prisma.product.update({
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
      config: JSON.stringify({
        cardNumber: "6037000000000000",
        cardName: "نام صاحب کارت",
      }),
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

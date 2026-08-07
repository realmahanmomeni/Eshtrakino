/**
 * Idempotent demo seed — safe to re-run.
 */
import { PrismaClient, DeliveryType, PaymentMethodType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const categories = [
    {
      name: "ابزارهای هوش مصنوعی",
      products: [
        {
          name: "ChatGPT Plus (1 ماه)",
          price: 750000,
          deliveryType: DeliveryType.READY,
          requiredFields: [],
        },
        {
          name: "Claude Pro (1 ماه)",
          price: 850000,
          deliveryType: DeliveryType.MANUAL,
          requiredFields: ["Email"],
        },
        {
          name: "Gemini Advanced",
          price: 650000,
          deliveryType: DeliveryType.MANUAL,
          requiredFields: ["Email", "Password"],
        },
      ],
    },
    {
      name: "مایکروسافت",
      products: [
        {
          name: "Microsoft 365 Personal",
          price: 450000,
          deliveryType: DeliveryType.READY,
          requiredFields: [],
        },
        {
          name: "Windows 11 Pro Key",
          price: 920000,
          deliveryType: DeliveryType.MANUAL,
          requiredFields: [],
        },
      ],
    },
  ];

  for (const cat of categories) {
    let category = await prisma.category.findFirst({ where: { name: cat.name } });
    if (!category) {
      category = await prisma.category.create({
        data: { name: cat.name, isActive: true },
      });
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
            categoryId: category.id,
            deliveryType: p.deliveryType,
            requiredFields: p.requiredFields,
            isActive: true,
          },
        });
      } else {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            price: p.price,
            deliveryType: p.deliveryType,
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

  console.log("[eshtrakino] Seed completed.");
}

main()
  .catch((e) => {
    console.error("[eshtrakino] Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

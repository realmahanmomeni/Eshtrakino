import { PrismaClient, DeliveryType, PaymentMethodType } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Demo seed — prefer `node prisma/seed.mjs` in Docker.
 * Kept for local `tsx` usage.
 */
async function main(): Promise<void> {
  const categories = [
    {
      name: "ابزارهای هوش مصنوعی",
      products: [
        {
          name: "ChatGPT Plus (1 ماه)",
          price: 750000,
          deliveryType: DeliveryType.READY,
          requiredFields: [] as string[],
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

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

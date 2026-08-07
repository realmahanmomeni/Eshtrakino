import { prisma } from "../../lib/prisma";
import type { PaymentMethod, PaymentMethodType } from "@prisma/client";

export type PaymentMethodConfig =
  | { cardNumber: string; cardName?: string }
  | { token: string }
  | Record<string, unknown>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class PaymentMethodService {
  parseConfig(raw: string): PaymentMethodConfig {
    try {
      return JSON.parse(raw) as PaymentMethodConfig;
    } catch {
      return {};
    }
  }

  stringifyConfig(config: PaymentMethodConfig): string {
    return JSON.stringify(config);
  }

  async listActive(): Promise<PaymentMethod[]> {
    return prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
  }

  /** Lean rows for payment keyboards (no config blob). */
  async listActiveForButtons(): Promise<
    Array<{ id: number; name: string; type: PaymentMethodType }>
  > {
    return prisma.paymentMethod.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { id: "asc" },
    });
  }

  async listAll(): Promise<PaymentMethod[]> {
    return prisma.paymentMethod.findMany({ orderBy: { id: "asc" } });
  }

  async getById(id: number): Promise<PaymentMethod | null> {
    return prisma.paymentMethod.findUnique({ where: { id } });
  }

  async create(input: {
    name: string;
    type: PaymentMethodType;
    config: PaymentMethodConfig;
    isActive?: boolean;
  }): Promise<PaymentMethod> {
    return prisma.paymentMethod.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        config: this.stringifyConfig(input.config),
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateConfig(id: number, config: PaymentMethodConfig): Promise<PaymentMethod> {
    return prisma.paymentMethod.update({
      where: { id },
      data: { config: this.stringifyConfig(config) },
    });
  }

  async toggleActive(id: number): Promise<PaymentMethod> {
    const current = await this.getById(id);
    if (!current) throw new Error(`PaymentMethod #${id} not found`);
    return prisma.paymentMethod.update({
      where: { id },
      data: { isActive: !current.isActive },
    });
  }

  getCardNumber(method: PaymentMethod): string | null {
    if (method.type !== "CARD") return null;
    const config = this.parseConfig(method.config);
    return "cardNumber" in config && typeof config.cardNumber === "string"
      ? config.cardNumber
      : null;
  }

  getCardName(method: PaymentMethod): string | null {
    if (method.type !== "CARD") return null;
    const config = this.parseConfig(method.config);
    return "cardName" in config && typeof config.cardName === "string" && config.cardName.trim()
      ? config.cardName.trim()
      : null;
  }

  /**
   * Human-readable payment instructions (HTML).
   * Card number uses <code> for Telegram tap-to-copy.
   */
  buildInstructions(method: PaymentMethod, amount: string, productName: string): string {
    const config = this.parseConfig(method.config);

    if (method.type === "CARD") {
      const card =
        "cardNumber" in config && typeof config.cardNumber === "string"
          ? config.cardNumber.replace(/\s+/g, "")
          : "—";
      const cardName =
        "cardName" in config && typeof config.cardName === "string" && config.cardName.trim()
          ? config.cardName.trim()
          : null;

      const lines = [
        `💳 <b>پرداخت کارت به کارت</b>`,
        "",
        `روش: <b>${escapeHtml(method.name)}</b>`,
        `📦 محصول: <b>${escapeHtml(productName)}</b>`,
        `💵 مبلغ: <b>${escapeHtml(amount)}</b>`,
        `💳 شماره کارت: <code>${escapeHtml(card)}</code>`,
      ];
      if (cardName) {
        lines.push(`👤 به نام: ${escapeHtml(cardName)}`);
      }
      lines.push(
        "",
        "پس از واریز، <b>عکس رسید</b> را در همین گفتگو ارسال کنید.",
      );
      return lines.join("\n");
    }

    const tokenHint =
      "token" in config && typeof config.token === "string" && config.token.length > 0
        ? "درگاه پیکربندی شده و آماده اتصال است."
        : "توکن درگاه هنوز کامل تنظیم نشده — از پنل ادمین مقدار را وارد کنید.";

    return [
      `🌐 <b>پرداخت آنلاین</b>`,
      "",
      `روش: <b>${escapeHtml(method.name)}</b>`,
      `📦 محصول: <b>${escapeHtml(productName)}</b>`,
      `💵 مبلغ: <b>${escapeHtml(amount)}</b>`,
      "",
      escapeHtml(tokenHint),
      "",
      "به زودی لینک درگاه فعال می شود.",
    ].join("\n");
  }

  /** Compact card deposit block for wallet top-up (HTML). */
  buildCardDepositBlock(method: PaymentMethod, amountLabel: string): string {
    const card = this.getCardNumber(method)?.replace(/\s+/g, "") ?? "—";
    const cardName = this.getCardName(method);
    const lines = [
      "💳 <b>اطلاعات واریز</b>",
      "",
      `💵 مبلغ: <b>${escapeHtml(amountLabel)}</b>`,
      `💳 شماره کارت: <code>${escapeHtml(card)}</code>`,
    ];
    if (cardName) {
      lines.push(`👤 به نام: ${escapeHtml(cardName)}`);
    }
    lines.push(
      "",
      "پس از واریز، <b>عکس رسید</b> را در همین گفتگو ارسال کنید:",
    );
    return lines.join("\n");
  }
}

export const paymentMethodService = new PaymentMethodService();

import type { DeliveryType, Product } from "@prisma/client";
import { truncateInlineButtonLabel } from "../../lib/telegramLabel";
import { deliveryTypeLabel, emojiForLabel } from "../keyboards/grid";
import { formatToman } from "../../lib/money";
import { sanitizeCustomerCatalogText } from "./catalogUi";

export const TELEGRAM_PHOTO_CAPTION_MAX = 1024;
export const TELEGRAM_TEXT_MESSAGE_MAX = 4096;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Truncate on line or word boundary with ellipsis. */
export function truncateCatalogText(text: string, maxLen: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) {
    return { text: trimmed, truncated: false };
  }
  if (maxLen <= 1) {
    return { text: "…", truncated: true };
  }

  const budget = maxLen - 1;
  const slice = trimmed.slice(0, budget);
  const lastNewline = slice.lastIndexOf("\n");
  const lastSpace = slice.lastIndexOf(" ");
  let cut = budget;
  if (lastNewline > budget * 0.35) {
    cut = lastNewline;
  } else if (lastSpace > budget * 0.4) {
    cut = lastSpace;
  }
  const head = trimmed.slice(0, cut).trimEnd();
  return { text: `${head}…`, truncated: true };
}

export function splitDescriptionIntoChunks(
  description: string,
  chunkSize = TELEGRAM_TEXT_MESSAGE_MAX - 80,
): string[] {
  const chunks: string[] = [];
  let rest = description.trim();
  while (rest.length > 0) {
    const { text, truncated } = truncateCatalogText(rest, chunkSize);
    chunks.push(text);
    if (!truncated) break;
    const consumed = text.endsWith("…") ? text.slice(0, -1).length : text.length;
    rest = rest.slice(consumed).trimStart();
  }
  return chunks.length > 0 ? chunks : [""];
}

export type ProductDetailPayload = {
  captionHtml: string;
  parseMode: "HTML";
  descriptionTruncated: boolean;
  fullDescription: string;
  /** Plain-text remainder after the caption excerpt (empty if nothing truncated). */
  descriptionRemainder: string;
};

export function buildProductDetailPayload(input: {
  product: Pick<Product, "name" | "deliveryType">;
  description: string;
  effectivePrice: number;
  maxCaptionLen?: number;
}): ProductDetailPayload {
  const safeDescription = sanitizeCustomerCatalogText(input.description);
  const headerLines = [
    `${emojiForLabel(input.product.name)} <b>${escapeHtml(input.product.name)}</b>`,
    "",
    `💰 قیمت: <b>${escapeHtml(formatToman(input.effectivePrice))}</b>`,
    `⏱ زمان تحویل: <b>${escapeHtml(deliveryTypeLabel(input.product.deliveryType as DeliveryType))}</b>`,
    "",
    "🔖 <b>توضیحات محصول</b>",
    "",
  ];
  const footerLines = ["", "👇 برای ادامه، دکمه خرید را بزنید:"];
  const header = headerLines.join("\n");
  const footer = footerLines.join("\n");
  const maxCaptionLen = input.maxCaptionLen ?? TELEGRAM_PHOTO_CAPTION_MAX;
  const descBudget = Math.max(
    120,
    maxCaptionLen - header.length - footer.length - 16,
  );
  const { text: descPart, truncated } = truncateCatalogText(safeDescription, descBudget);
  const captionHtml = [header, escapeHtml(descPart), footer].join("\n");
  const shownPlain = truncated && descPart.endsWith("…") ? descPart.slice(0, -1) : descPart;
  const descriptionRemainder = truncated
    ? safeDescription.slice(shownPlain.length).trimStart()
    : "";

  return {
    captionHtml,
    parseMode: "HTML",
    descriptionTruncated: truncated,
    fullDescription: safeDescription,
    descriptionRemainder,
  };
}

export function buildDescriptionContinuationMessages(remainder: string): string[] {
  if (!remainder.trim()) return [];
  return splitDescriptionIntoChunks(remainder);
}

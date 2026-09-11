/**
 * Telegram Premium Custom Emoji mappings for bot buttons.
 */
export const BUTTON_CUSTOM_EMOJIS = {
  // Brand-specific Products
  CHATGPT: "5188653289108949659",
  GEMINI: "5188334830168853961",
  TELEGRAM_STARS: "5287479631891420667",
  TELEGRAM_PREMIUM: "5456135459937733007",

  // Generic Product fallback
  PRODUCT: "5983591923883972553",

  // Navigation & Actions
  CATEGORY: "5258024802010026053",
  AI_TOOLS: "5926806284362847699",
  BUY: "5373052667671093676",
  READY_ACCOUNT: "5226656353744862682",
  EMAIL_DELIVERY: "4994508827320648491",
  SEARCH: "5319230516929502602",
  BANK_GATEWAY: "5301166339749070453",
  CRYPTO: "5298718534807857899",
  WALLET: "6001287064589439895",
  DISCOUNT: "5839378789078930519",
  CONFIRM_PAYMENT: "5370727947902658109",
  BACK: "5994442901059276913",
  CANCEL: "5161208387957950108",

  // Account & Support
  ACCOUNT: "5256143829672672750",
  SUPPORT: "5839301436717929423",
  SUPPORT_TICKET: "5924740881834840527",

  // Top-Up & Deposits
  CARD_TO_CARD: "5783135105711084620",
  DEPOSIT_AMOUNT: "4956601935592424315",
} as const;

export const PRODUCT_CUSTOM_EMOJIS = BUTTON_CUSTOM_EMOJIS;

/**
 * Determines the Telegram Custom Emoji ID for a product based on its name.
 * Priority:
 * 1. ChatGPT -> 5188653289108949659
 * 2. Gemini -> 5188334830168853961
 * 3. Telegram Stars -> 5287479631891420667
 * 4. Telegram Premium -> 5454365533979825405
 * 5. Other / unmatched products -> Generic Product Custom Emoji (5983591923883972553)
 */
export function getProductCustomEmojiId(productName: string): string {
  const norm = productName.toLowerCase().trim();

  // 1. ChatGPT and all ChatGPT-related products
  if (
    /\bchatgpt\b/i.test(norm) ||
    /chat\s*gpt/i.test(norm) ||
    /چت\s*جی\s*پی\s*تی/i.test(norm) ||
    /چت\s*جیپیتی/i.test(norm) ||
    /چت\s*جی\s*پیتی/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.CHATGPT;
  }

  // 2. Gemini and all Gemini-related products
  if (/\bgemini\b/i.test(norm) || /gemini/i.test(norm) || /جمنای/i.test(norm) || /جمینی/i.test(norm)) {
    return BUTTON_CUSTOM_EMOJIS.GEMINI;
  }

  // 3. Telegram Stars and all Telegram Stars-related products
  if (
    /telegram\s+stars?/i.test(norm) ||
    /stars?\s+(?:of\s+)?(?:telegram|تلگرام)/i.test(norm) ||
    /تلگرام\s+استار(?:ز)?/i.test(norm) ||
    /استار(?:ز)?\s*(?:های\s*)?تلگرام/i.test(norm) ||
    /\b(?:telegram\s+stars?|تلگرام\s+استارز?)\b/i.test(norm) ||
    /^(?:telegram\s+)?stars?\s*(?:pack|\d+|\(\d+)/i.test(norm) ||
    /^(?:تلگرام\s+)?استار(?:ز)?\s*(?:بسته|\d+|\(\d+)/i.test(norm) ||
    /^\d+\s*(?:telegram\s+)?stars?\b/i.test(norm) ||
    /^\d+\s*(?:تلگرام\s+)?استار(?:ز)?\b/i.test(norm) ||
    /\d+\s*استار(?:ز)?/i.test(norm) ||
    /استار(?:ز)?\s*\d+/i.test(norm) ||
    /\bstars?\b/i.test(norm) ||
    /استار(?:ز)?/i.test(norm) ||
    /^telegram\s+stars?$/i.test(norm) ||
    /^stars?$/i.test(norm) ||
    /^استار(?:ز)?$/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_STARS;
  }

  // 4. Telegram Premium and all Telegram Premium-related products
  if (
    /telegram\s+premium/i.test(norm) ||
    /premium\s+telegram/i.test(norm) ||
    /تلگرام\s*پری?م[ی]?وم/i.test(norm) ||
    /پری?م[ی]?وم\s*تلگرام/i.test(norm) ||
    /پری?م[ی]?وم/i.test(norm) ||
    /premium/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_PREMIUM;
  }

  // 5. Unmatched products -> Generic Product Custom Emoji
  return BUTTON_CUSTOM_EMOJIS.PRODUCT;
}

export type ButtonCustomEmojiKey = keyof typeof BUTTON_CUSTOM_EMOJIS;

export function depositAmountButton(
  text: string,
  data: string,
): { text: string; data: string; icon_custom_emoji_id: string } {
  return {
    text,
    data,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.DEPOSIT_AMOUNT,
  };
}

/**
 * Determines the Telegram Custom Emoji ID for a category based on its name.
 */
export function getCategoryCustomEmojiId(categoryName: string): string {
  const norm = categoryName.toLowerCase().trim();

  // 1. AI Tools
  if (/ابزار\s*های\s*هوش\s*مصنوعی/i.test(norm)) {
    return BUTTON_CUSTOM_EMOJIS.AI_TOOLS;
  }

  // 2. Telegram Stars
  if (
    /telegram\s+stars?/i.test(norm) ||
    /stars?\s+(?:of\s+)?(?:telegram|تلگرام)/i.test(norm) ||
    /تلگرام\s+استار(?:ز)?/i.test(norm) ||
    /استار(?:ز)?\s*(?:های\s*)?تلگرام/i.test(norm) ||
    /استار(?:ز)?\s*تلگرام/i.test(norm) ||
    /\b(?:telegram\s+stars?|تلگرام\s+استارز?)\b/i.test(norm) ||
    /^telegram\s+stars?$/i.test(norm) ||
    /^stars?$/i.test(norm) ||
    /^استار(?:ز)?$/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_STARS;
  }

  // 3. Telegram Premium
  if (
    /telegram\s+premium/i.test(norm) ||
    /premium\s+telegram/i.test(norm) ||
    /تلگرام\s*پری?م[ی]?وم/i.test(norm) ||
    /پری?م[ی]?وم\s*تلگرام/i.test(norm) ||
    /پری?م[ی]?وم/i.test(norm) ||
    /premium/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_PREMIUM;
  }

  // 4. Gemini SubCategory / Service
  if (/gemini/i.test(norm) || /جمنای/i.test(norm) || /جمینی/i.test(norm)) {
    return BUTTON_CUSTOM_EMOJIS.GEMINI;
  }

  // 5. ChatGPT SubCategory / Service
  if (
    /\bchatgpt\b/i.test(norm) ||
    /chat\s*gpt/i.test(norm) ||
    /چت\s*جی\s*پی\s*تی/i.test(norm) ||
    /چت\s*جیپیتی/i.test(norm) ||
    /چت\s*جی\s*پیتی/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.CHATGPT;
  }

  // 6. Default Category
  return BUTTON_CUSTOM_EMOJIS.CATEGORY;
}

/**
 * Determines the Telegram Custom Emoji ID for a SubCategory / Service based on its name.
 */
export function getSubCategoryCustomEmojiId(subCategoryName: string): string {
  const norm = subCategoryName.toLowerCase().trim();

  // 1. Gemini
  if (/gemini/i.test(norm) || /جمنای/i.test(norm) || /جمینی/i.test(norm)) {
    return BUTTON_CUSTOM_EMOJIS.GEMINI;
  }

  // 2. ChatGPT
  if (
    /\bchatgpt\b/i.test(norm) ||
    /chat\s*gpt/i.test(norm) ||
    /چت\s*جی\s*پی\s*تی/i.test(norm) ||
    /چت\s*جیپیتی/i.test(norm) ||
    /چت\s*جی\s*پیتی/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.CHATGPT;
  }

  // 3. Telegram Stars
  if (
    /telegram\s+stars?/i.test(norm) ||
    /stars?\s+(?:of\s+)?(?:telegram|تلگرام)/i.test(norm) ||
    /تلگرام\s+استار(?:ز)?/i.test(norm) ||
    /استار(?:ز)?\s*(?:های\s*)?تلگرام/i.test(norm) ||
    /استار(?:ز)?\s*تلگرام/i.test(norm) ||
    /\b(?:telegram\s+stars?|تلگرام\s+استارز?)\b/i.test(norm) ||
    /^telegram\s+stars?$/i.test(norm) ||
    /^stars?$/i.test(norm) ||
    /^استار(?:ز)?$/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_STARS;
  }

  // 4. Telegram Premium
  if (
    /telegram\s+premium/i.test(norm) ||
    /premium\s+telegram/i.test(norm) ||
    /تلگرام\s*پری?م[ی]?وم/i.test(norm) ||
    /پری?م[ی]?وم\s*تلگرام/i.test(norm) ||
    /پری?م[ی]?وم/i.test(norm) ||
    /premium/i.test(norm)
  ) {
    return BUTTON_CUSTOM_EMOJIS.TELEGRAM_PREMIUM;
  }

  // 5. Fallback to category custom emoji or generic product emoji
  return getCategoryCustomEmojiId(subCategoryName);
}

import assert from "node:assert";
import { BUTTON_CUSTOM_EMOJIS, PRODUCT_CUSTOM_EMOJIS, getProductCustomEmojiId, getCategoryCustomEmojiId, getSubCategoryCustomEmojiId } from "./src/bot/keyboards/buttonEmojis";
import { mainMenuKeyboard, paymentMethodsKeyboard, checkoutPaymentChoiceKeyboard } from "./src/bot/keyboards/builders";
import { walletMenuKeyboard } from "./src/bot/user/keyboards";
import { supportPageKeyboard } from "./src/bot/cms/presentPage";
import { depositAmountsKeyboard } from "./src/bot/user/swapHandlers";
import { Callbacks } from "./src/bot/keyboards/callbacks";

console.log("=== 1. VERIFYING ALL CUSTOM EMOJI CONSTANTS ===");
const EXPECTED_EMOJIS: Record<string, string> = {
  CATEGORY: "5258024802010026053",
  BUY: "5373052667671093676",
  PRODUCT: "5983591923883972553",
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
  CHATGPT: "5188653289108949659",
  GEMINI: "5188334830168853961",
  TELEGRAM_STARS: "5287479631891420667",
  TELEGRAM_PREMIUM: "5454365533979825405",

  ACCOUNT: "5256143829672672750",
  SUPPORT: "5839301436717929423",
  SUPPORT_TICKET: "5924740881834840527",
  CARD_TO_CARD: "5783135105711084620",
  DEPOSIT_AMOUNT: "4956601935592424315",
  AI_TOOLS: "5926806284362847699",
};

for (const [k, expectedId] of Object.entries(EXPECTED_EMOJIS)) {
  const actualId = (BUTTON_CUSTOM_EMOJIS as any)[k];
  assert.strictEqual(actualId, expectedId, `Mismatch for ${k}: expected ${expectedId}, got ${actualId}`);
  console.log(`  ✓ ${k.padEnd(18)} = ${actualId}`);
}

console.log("\n=== 2. VERIFYING CATEGORY LOGIC ===");
const cats = {
  "ابزار های هوش مصنوعی": "5926806284362847699",
  "تلگرام پریمیوم": "5454365533979825405",
  "استارز تلگرام": "5287479631891420667",
  "other": "5258024802010026053"
};

for (const [k, expectedId] of Object.entries(cats)) {
  const actualId = getCategoryCustomEmojiId(k);
  assert.strictEqual(actualId, expectedId, `Mismatch for category ${k}`);
  console.log(`  ✓ ${k} = ${actualId}`);
}

console.log("\n=== 3. VERIFYING SUBCATEGORY / SERVICE LOGIC ===");
const subCats = {
  "Gemini": "5188334830168853961",
  "جمنای": "5188334830168853961",
  "جمینی": "5188334830168853961",
  "ChatGPT": "5188653289108949659",
  "استارز": "5287479631891420667",
  "General Service": "5258024802010026053",
};

for (const [k, expectedId] of Object.entries(subCats)) {
  const actualId = getSubCategoryCustomEmojiId(k);
  assert.strictEqual(actualId, expectedId, `Mismatch for subcategory ${k}`);
  console.log(`  ✓ ${k} = ${actualId}`);
}

console.log("\n=== 4. VERIFYING PRODUCT LOGIC ===");
const prods = {
  "ChatGPT Plus": "5188653289108949659",
  "Gemini": "5188334830168853961",
  "Gemini Advanced": "5188334830168853961",
  "اکانت جمنای پرو": "5188334830168853961",
  "Telegram Stars 100": "5287479631891420667",
  "Telegram Premium 3 Months": "5454365533979825405",
  "Claude Pro": "5983591923883972553"
};

for (const [k, expectedId] of Object.entries(prods)) {
  const actualId = getProductCustomEmojiId(k);
  assert.strictEqual(actualId, expectedId, `Mismatch for product ${k}`);
  console.log(`  ✓ ${k} = ${actualId}`);
}

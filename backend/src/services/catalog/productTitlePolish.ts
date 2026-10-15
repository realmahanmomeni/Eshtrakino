/**
 * Transforms supplier catalog titles into concise Persian customer-facing names.
 * Idempotent — safe to run on every sync.
 */

import {
  isolateEmbeddedLatin,
  normalizeArabicToPersianChars,
} from "../../lib/telegramLabel";

function normalizeKey(input: string): string {
  return input
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Exact or near-exact supplier titles → polished display name */
const EXACT_TITLE_MAP: Array<[RegExp, string]> = [
  [
    /chatgpt\s*plus\s*k12\s*edu.*۲\s*سال|k12\s*edu.*۲\s*سال/i,
    "چت‌جی‌پی‌تی پلاس ۲ ساله (تحصیلی Edu)",
  ],
  [
    /چت\s*جی.?پی.?تی\s*اپل\s*پی\s*۳۰\s*روز/i,
    "چت‌جی‌پی‌تی پلاس ۱ ماهه (پرداخت رسمی اپل)",
  ],
  [/چت\s*جی.?پی.?تی\s*پرو\s*یکس\s*۵\s*یک\s*ماه|pro\s*x\s*5/i, "چت‌جی‌پی‌تی پرو ۱ ماهه (سقف پیام ۵ برابری)"],
  [
    /chatgpt\s*gmail\s*آماده|gmail\s*آماده.*پیشنهاد/i,
    "چت‌جی‌پی‌تی پلاس ۱ ماهه (با جیمیل اختصاصی)",
  ],
  [/chatgpt\s*go\s*1\s*ماه/i, "چت‌جی‌پی‌تی Go یک ماهه"],
  [/پیست\s*پرواز\s*حرفه.?ای\s*12\s*متری|runway.*12/i, "ران‌وی ۱ ساله (Runway ML)"],
  [/fil\s*mora\s*3m|filmora\s*3/i, "فیلمورا ۳ ماهه (Wondershare)"],
  [/پریم\s*ویدیو\s*6\s*م|prime\s*video\s*6/i, "پرایم ویدیو ۶ ماهه (Amazon)"],
  [/ایلیفن\s*لبز\s*۳\s*ماه|elevenlabs\s*3/i, "الون‌لبز ۳ ماهه (ElevenLabs)"],
  [/xingtu\s*svip/i, "شینگ‌تو SVIP یک ماهه"],
  [/wink\s*vip\+?/i, "وینک VIP هفت روزه"],
  [/meitu\s*vip/i, "میتو VIP هفت روزه"],
  [/پنل\s*کانوا\s*۵۰۰|canva.*500/i, "کانوا پرو ۱ ساله"],
  [/freepik\s*1m/i, "فری‌پیک ۱ ماهه"],
];

function stripTitleGarbage(name: string): string {
  return name
    .replace(/\(\s*گارانتی\s*کامل\s*\)/gi, "")
    .replace(/\(\s*\d+\s*روز\s*گارانتی\s*\)/gi, "")
    .replace(/بدون\s*گارانتی/gi, "")
    .replace(/بدون\s*گا\b/gi, "")
    .replace(/\(\s*۲۵\s*روز\s*گارانتی\s*\)/gi, "")
    .replace(/یک\s*پیش[\w\s]*\.?\.?\.?/gi, "")
    .replace(/\bFW\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/[-—–]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDurationPhrases(name: string): string {
  let n = name;
  n = n.replace(/\b1\s*ماهه?\b/gi, "۱ ماهه");
  n = n.replace(/\b3\s*ماه?\b/gi, "۳ ماهه");
  n = n.replace(/\b6\s*م\s*\b/gi, "۶ ماهه");
  n = n.replace(/\b6\s*ماهه?\b/gi, "۶ ماهه");
  n = n.replace(/\b12\s*م(?:تر|اه)?\b/gi, "۱ ساله");
  n = n.replace(/\b1\s*y\b/gi, "۱ ساله");
  n = n.replace(/\b7\s*روز\b/gi, "۷ روزه");
  n = n.replace(/\b30\s*روز\b/gi, "۱ ماهه");
  n = n.replace(/\b90\s*روز\b/gi, "۳ ماهه");
  n = n.replace(/\b365\s*روز\b/gi, "۱ ساله");
  return n;
}

function applySemanticAliases(name: string): string {
  let n = name;
  if (/k12|edu|تحصیلی/i.test(n) && /chatgpt|چت.?جی.?پی.?تی|gpt/i.test(n)) {
    n = n.replace(/k12\s*edu/gi, "تحصیلی Edu");
  }
  if (/apple\s*pay|اپل\s*پی/i.test(n)) {
    n = n.replace(/apple\s*pay|اپل\s*پی/gi, "پرداخت رسمی اپل");
  }
  return n;
}

export function polishCustomerProductTitle(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return trimmed;

  const key = normalizeKey(trimmed);
  for (const [pattern, replacement] of EXACT_TITLE_MAP) {
    if (pattern.test(trimmed) || pattern.test(key)) {
      return replacement;
    }
  }

  let name = stripTitleGarbage(trimmed);
  name = applySemanticAliases(name);
  name = normalizeDurationPhrases(name);
  name = normalizeArabicToPersianChars(name);
  name = name.replace(/\s+/g, " ").trim() || trimmed;
  return isolateEmbeddedLatin(name);
}

export async function polishAllProductTitles(): Promise<number> {
  const { prisma } = await import("../../lib/prisma.js");
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  let updated = 0;
  for (const p of products) {
    const polished = polishCustomerProductTitle(p.name);
    if (polished !== p.name) {
      await prisma.product.update({ where: { id: p.id }, data: { name: polished } });
      updated += 1;
    }
  }
  return updated;
}

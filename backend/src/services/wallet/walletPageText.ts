import { formatToman } from "../../lib/money";
import type { Decimal } from "@prisma/client/runtime/library";

/** Strip stale CMS balance lines / placeholders before injecting live balance. */
export function injectLiveWalletBalanceInCmsText(
  cmsText: string,
  balanceFormatted: string,
): string {
  let text = cmsText.replace(/\{balance\}/gi, balanceFormatted);

  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^موجودی\s*فعلی\s*:/u.test(trimmed)) return false;
    if (/^💎\s*موجودی/u.test(trimmed)) return false;
    return true;
  });

  return lines.join("\n").trim();
}

export function buildWalletPageCaption(params: {
  cmsText: string;
  balance: Decimal | string | number;
  topUpHint: string;
}): string {
  const balanceFormatted = formatToman(params.balance);
  const body = injectLiveWalletBalanceInCmsText(params.cmsText, balanceFormatted);
  return [
    body,
    "",
    `موجودی فعلی: *${balanceFormatted}*`,
    "",
    params.topUpHint,
  ].join("\n");
}

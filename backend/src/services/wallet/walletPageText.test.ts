import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWalletPageCaption,
  injectLiveWalletBalanceInCmsText,
} from "./walletPageText";
import {
  formatAdminWalletAdjustmentNotification,
  formatAdminWalletIncreaseNotification,
  formatAdminWalletDecreaseNotification,
} from "./adminBalanceNotification";

test("wallet CMS with static 0 balance shows live 242,000 تومان", () => {
  const cms = [
    "💰 *کیف پول من*",
    "",
    "موجودی فعلی: 0 تومان",
    "",
    "موجودی خود را ببینید.",
  ].join("\n");

  const caption = buildWalletPageCaption({
    cmsText: cms,
    balance: 242_000,
    topUpHint: "روش شارژ را انتخاب کنید:",
  });

  assert.match(caption, /242,000 تومان/);
  assert.equal(/موجودی فعلی: 0 تومان/u.test(caption), false);
  assert.equal((caption.match(/242,000/g) ?? []).length, 1);
});

test("injectLiveWalletBalanceInCmsText replaces {balance} placeholder", () => {
  const out = injectLiveWalletBalanceInCmsText(
    "Hello {balance} world",
    "242,000 تومان",
  );
  assert.match(out, /242,000 تومان/);
  assert.equal(out.includes("{balance}"), false);
});

test("admin credit notification formatting", () => {
  const msg = formatAdminWalletIncreaseNotification(242_000, 242_000);
  assert.match(msg, /242,000 تومان/);
  assert.match(msg, /افزایش موجودی/);
  assert.match(msg, /موجودی فعلی شما/);
});

test("admin debit notification formatting", () => {
  const msg = formatAdminWalletDecreaseNotification(-50_000, 192_000);
  assert.match(msg, /50,000 تومان/);
  assert.match(msg, /192,000 تومان/);
  assert.match(msg, /کسر از موجودی/);
});

test("formatAdminWalletAdjustmentNotification picks credit vs debit", () => {
  const credit = formatAdminWalletAdjustmentNotification({
    balance: 242_000,
    previousBalance: 0,
    delta: 242_000,
    telegramId: "567798739",
  });
  assert.match(credit, /افزایش موجودی/);

  const debit = formatAdminWalletAdjustmentNotification({
    balance: 100_000,
    previousBalance: 150_000,
    delta: -50_000,
    telegramId: "567798739",
  });
  assert.match(debit, /کسر از موجودی/);
});

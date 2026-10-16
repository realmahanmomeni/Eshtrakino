import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSupplierNameSyncProposal } from "./supplierNameSyncGuard";
import { shortenSupplierProductName } from "./shortenSupplierProductName";
import { namesAreEquivalentForSync } from "./supplierNameSyncCompare";

function assertRejected(current: string, remote: string, proposed?: string) {
  const p = proposed ?? shortenSupplierProductName(remote, { keepWarranty: true, durationHintFrom: current });
  const safe = sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: remote, proposedName: p });
  assert.equal(safe, null, `expected reject for remote=${remote} proposed=${p}`);
}

test("name sync rejects Outlook → Adobe mismatch (#30)", () => {
  assertRejected("ایمیل اوت‌لوک اختصاصی", "Adobe email outlook dedicated");
});

test("name sync rejects truncated Prime Video (#43)", () => {
  const proposed = shortenSupplierProductName("Prime Video 6 month premium");
  const safe = sanitizeSupplierNameSyncProposal({
    currentName: "پرایم ویدیو ۶ ماهه",
    remoteName: "Prime Video 6 month",
    proposedName: proposed,
  });
  assert.equal(safe, null);
});

test("name sync rejects 2FA token reorder (#94)", () => {
  const current = "اپل آی‌دی 2FA جیمیل";
  const proposed = "اپل آی‌دی FA2 جیمیل";
  assert.equal(
    sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: current, proposedName: proposed }),
    null,
  );
});

test("name sync rejects dropping warranty parens (#32)", () => {
  const current = "Cursor Ultra یک ماه (۷ روز گارانتی)";
  const proposed = "Cursor Ultra یک ماه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({
      currentName: current,
      remoteName: "Cursor Ultra 1 month (7 day warranty)",
      proposedName: proposed,
    }),
    null,
  );
});

test("name sync rejects ChatGPT emoji and duration swap (#22)", () => {
  const current = "چت‌جی‌پی‌تی پلاس ۱ ماهه";
  const proposed = "🔥 جی‌پی‌تی پلاس ۳۰ روزه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: current, proposedName: proposed }),
    null,
  );
});

test("name sync rejects cosmetic duration surface change (#40)", () => {
  const current = "اینواتو ۱ ماهه";
  const proposed = "۱ ماه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: current, proposedName: proposed }),
    null,
  );
});

test("name sync rejects emoji-only prefix drop (#147)", () => {
  const current = "🔥لینک - جیمنی AI پرو ۱۸ ماه";
  const proposed = "جیمنی AI پرو ۱۸ ماه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: current, proposedName: proposed }),
    null,
  );
});

test("name sync rejects Sales Navigator duration form-only change (#71)", () => {
  const current = "سیلز ناویگیتور ۱ ماهه";
  const proposed = "لینکدین سیلز ناویگیتور ۱ ماه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({
      currentName: current,
      remoteName: "LinkedIn Sales Navigator 1 month",
      proposedName: proposed,
    }),
    null,
  );
});

test("namesAreEquivalentForSync treats whitespace and bidi as equal (#18-style no-op)", () => {
  assert.ok(namesAreEquivalentForSync("محصول A", "  محصول A  "));
});

test("name sync rejects Netflix typo and glued 1م (#29)", () => {
  const current = "نتفلیکس تک صفحه ۱ ماه جهانی";
  const proposed = "تتفلیکس تک صفحه 1م جهانی";
  assert.equal(
    sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: current, proposedName: proposed }),
    null,
  );
});

test("name sync rejects dropping Ultra on Cursor (#32 tier)", () => {
  const current = "Cursor Ultra یک ماه";
  const proposed = "Cursor Pro یک ماه";
  assert.equal(
    sanitizeSupplierNameSyncProposal({
      currentName: current,
      remoteName: "Cursor Ultra 1 month",
      proposedName: proposed,
    }),
    null,
  );
});

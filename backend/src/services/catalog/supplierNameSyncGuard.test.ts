import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSupplierNameSyncProposal } from "./supplierNameSyncGuard";
import { shortenSupplierProductName } from "./shortenSupplierProductName";

function assertRejected(current: string, remote: string) {
  const proposed = shortenSupplierProductName(remote);
  const safe = sanitizeSupplierNameSyncProposal({ currentName: current, remoteName: remote, proposedName: proposed });
  assert.equal(safe, null, `expected reject for remote=${remote} proposed=${proposed}`);
}

test("name sync rejects Outlook → Adobe mismatch (#30)", () => {
  assertRejected("ایمیل اوت‌لوک اختصاصی", "Adobe email outlook dedicated");
});

test("name sync rejects Filmora → Fil Mora assets (#42)", () => {
  assertRejected("فیلمورا ۳ ماهه", "Fil Mora creative assets 3 month");
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

test("name sync rejects truncated Cursor API phrase (#34)", () => {
  const remote = "API Cursor Pro 400 اعتبار در روز 1 ماه گارانتی کامل";
  assertRejected("API Cursor Pro 400 اعتبار در روز 1 ماه", remote);
});

test("name sync rejects dropping API on Cursor packs (#35/#36)", () => {
  assertRejected(
    "API Cursor Pro 2600 اعتبار",
    "API Cursor Pro 2600 credits 1 month",
  );
});

test("name sync rejects losing days on Cursor mouse title (#33)", () => {
  const remote = "ماوس Cursor pro یک ماه و ده روز گارانتی تعویض";
  const proposed = shortenSupplierProductName(remote);
  const safe = sanitizeSupplierNameSyncProposal({
    currentName: remote,
    remoteName: remote,
    proposedName: proposed,
  });
  assert.equal(safe, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/library";
import { toCloneSafeAdminBalanceResult } from "./WalletService";

test("toCloneSafeAdminBalanceResult is structuredClone-safe", () => {
  const result = toCloneSafeAdminBalanceResult({
    balance: new Decimal("242000"),
    previousBalance: new Decimal("0"),
    delta: new Decimal("242000"),
    telegramId: 567798739n,
  });

  assert.equal(typeof result.balance, "number");
  assert.equal(typeof result.telegramId, "string");
  assert.doesNotThrow(() => structuredClone(result));

  const cloned = structuredClone(result);
  assert.deepEqual(cloned, {
    balance: 242_000,
    previousBalance: 0,
    delta: 242_000,
    telegramId: "567798739",
  });
});

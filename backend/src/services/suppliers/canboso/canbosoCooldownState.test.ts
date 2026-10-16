import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  applyCanbosoRateLimitCooldown,
  clearCanbosoCooldownForTests,
  hydrateCanbosoCooldownFromSettings,
  isCanbosoApiRefreshAllowed,
  getCanbosoBlockedUntilMs,
  CANBOSO_COOLDOWN_UNTIL_MS_KEY,
} from "./canbosoCooldownState";
import { settingsService } from "../../settings/SettingsService";

test("cooldown blocks refresh until window ends", async () => {
  clearCanbosoCooldownForTests();
  assert.equal(isCanbosoApiRefreshAllowed(), true);
  await applyCanbosoRateLimitCooldown(30);
  assert.equal(isCanbosoApiRefreshAllowed(), false);
  assert.ok(getCanbosoBlockedUntilMs() > Date.now());
});

test("hydrate restores persisted cooldown after restart", async () => {
  clearCanbosoCooldownForTests();
  const future = String(Date.now() + 120_000);
  const getMock = mock.method(settingsService, "getSetting", async (key: string) => {
    if (key === CANBOSO_COOLDOWN_UNTIL_MS_KEY) return future;
    return null;
  });
  try {
    await hydrateCanbosoCooldownFromSettings();
    assert.equal(isCanbosoApiRefreshAllowed(), false);
  } finally {
    getMock.mock.restore();
    clearCanbosoCooldownForTests();
  }
});

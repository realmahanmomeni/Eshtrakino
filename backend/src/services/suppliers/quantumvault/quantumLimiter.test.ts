import test from "node:test";
import assert from "node:assert/strict";
import { SupplierRateLimitError } from "../SupplierAdapter";
import {
  QuantumRequestGate,
  quantumRetryDelayMs,
} from "./quantumLimiter";

test("token bucket allows the per-minute cap, then waits for a refill", async () => {
  let now = 1_000_000;
  const gate = new QuantumRequestGate({
    maxPerMinute: 60,
    maxConcurrent: 2,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  for (let i = 0; i < 60; i++) {
    await gate.acquire();
    gate.release();
  }

  const before = now;
  await gate.acquire();
  assert.ok(now - before >= 1000);
  gate.release();
});

test("concurrency cap holds the third caller until a slot is released", async () => {
  const gate = new QuantumRequestGate({ maxPerMinute: 60, maxConcurrent: 2 });
  await gate.acquire();
  await gate.acquire();

  let entered = false;
  const third = gate.acquire().then(() => {
    entered = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entered, false);

  gate.release();
  await third;
  assert.equal(entered, true);
  gate.release();
  gate.release();
});

test("backoff honors Retry-After and otherwise grows with jitter", () => {
  assert.equal(quantumRetryDelayMs({ attempt: 4, retryAfterMs: 2500, random: () => 1 }), 2500);
  assert.equal(quantumRetryDelayMs({ attempt: 1, random: () => 0 }), 500);
  assert.equal(quantumRetryDelayMs({ attempt: 3, random: () => 0 }), 2000);
  assert.equal(quantumRetryDelayMs({ attempt: 2, random: () => 1 }), 1200);
});

test("circuit opens after repeated 429 or 401 and alerts once", async () => {
  let now = 0;
  const gate = new QuantumRequestGate({
    now: () => now,
    pauseMs: 60_000,
    rateStrikeThreshold: 3,
    authStrikeThreshold: 2,
    sleep: async () => {
      throw new Error("should not wait while the circuit is open");
    },
  });

  assert.equal(gate.noteHardFailure("429").opened, false);
  assert.equal(gate.noteHardFailure("429").opened, false);
  const rate = gate.noteHardFailure("429");
  assert.equal(rate.opened, true);
  assert.equal(rate.shouldAlert, true);
  assert.equal(gate.noteHardFailure("429").shouldAlert, false);
  await assert.rejects(() => gate.acquire(), SupplierRateLimitError);

  now = 60_000;
  assert.equal(gate.isPaused(), false);

  gate.resetForTests();
  assert.equal(gate.noteHardFailure("401").shouldAlert, false);
  const auth = gate.noteHardFailure("403");
  assert.equal(auth.opened, true);
  assert.equal(auth.shouldAlert, true);
  assert.equal(gate.noteHardFailure("401").shouldAlert, false);
});

import { SupplierRateLimitError } from "../SupplierAdapter";

/** Well under Quantum's 120 requests/minute per key. */
export const QUANTUM_MAX_REQUESTS_PER_MINUTE = 60;
export const QUANTUM_MAX_CONCURRENT = 2;
/** Pause every Quantum call after repeated 429 / 401 / 403. */
export const QUANTUM_CIRCUIT_PAUSE_MS = 10 * 60 * 1000;
export const QUANTUM_STRIKE_WINDOW_MS = 10 * 60 * 1000;
export const QUANTUM_RATE_STRIKE_THRESHOLD = 3;
export const QUANTUM_AUTH_STRIKE_THRESHOLD = 2;

export const QUANTUM_CIRCUIT_OPEN_MESSAGE =
  "Quantum API circuit is open; requests are paused.";

export type QuantumStrikeKind = "429" | "401" | "403";

export type QuantumBackoffInput = {
  /** 1 for the first retry. */
  attempt: number;
  retryAfterMs?: number | null;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
};

/**
 * Honor Retry-After when the server sends one. Otherwise exponential backoff
 * with a little jitter. GET callers use this; POST /purchase must not.
 */
export function quantumRetryDelayMs(input: QuantumBackoffInput): number {
  if (input.retryAfterMs != null && Number.isFinite(input.retryAfterMs) && input.retryAfterMs >= 0) {
    return Math.round(input.retryAfterMs);
  }
  const base = input.baseMs ?? 500;
  const cap = input.capMs ?? 30_000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, input.attempt - 1));
  const rand = input.random ?? Math.random;
  const jitter = exp * 0.2 * rand();
  return Math.round(exp + jitter);
}

export function parseRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (headerValue == null) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

type GateOptions = {
  maxPerMinute?: number;
  maxConcurrent?: number;
  pauseMs?: number;
  strikeWindowMs?: number;
  rateStrikeThreshold?: number;
  authStrikeThreshold?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Token bucket + small concurrency cap, plus a circuit breaker.
 * One shared instance fronts every Quantum HTTP call.
 */
export class QuantumRequestGate {
  private tokens: number;
  private lastRefillMs: number;
  private inFlight = 0;
  private waiters: Array<() => void> = [];
  private strikes: Array<{ at: number; kind: QuantumStrikeKind }> = [];
  private pausedUntilMs = 0;
  private alertedPauseUntilMs = 0;

  private readonly maxPerMinute: number;
  private readonly maxConcurrent: number;
  private readonly pauseMs: number;
  private readonly strikeWindowMs: number;
  private readonly rateStrikeThreshold: number;
  private readonly authStrikeThreshold: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GateOptions = {}) {
    this.maxPerMinute = options.maxPerMinute ?? QUANTUM_MAX_REQUESTS_PER_MINUTE;
    this.maxConcurrent = options.maxConcurrent ?? QUANTUM_MAX_CONCURRENT;
    this.pauseMs = options.pauseMs ?? QUANTUM_CIRCUIT_PAUSE_MS;
    this.strikeWindowMs = options.strikeWindowMs ?? QUANTUM_STRIKE_WINDOW_MS;
    this.rateStrikeThreshold = options.rateStrikeThreshold ?? QUANTUM_RATE_STRIKE_THRESHOLD;
    this.authStrikeThreshold = options.authStrikeThreshold ?? QUANTUM_AUTH_STRIKE_THRESHOLD;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.tokens = this.maxPerMinute;
    this.lastRefillMs = this.now();
  }

  isPaused(now = this.now()): boolean {
    return now < this.pausedUntilMs;
  }

  pausedUntil(): number {
    return this.pausedUntilMs;
  }

  /** Hydrate a pause that survived a process restart. Does not alert again. */
  pauseUntil(untilMs: number): void {
    if (!Number.isFinite(untilMs) || untilMs <= this.now()) return;
    this.pausedUntilMs = Math.max(this.pausedUntilMs, untilMs);
    this.alertedPauseUntilMs = this.pausedUntilMs;
  }

  resetForTests(): void {
    this.tokens = this.maxPerMinute;
    this.lastRefillMs = this.now();
    this.inFlight = 0;
    this.waiters = [];
    this.strikes = [];
    this.pausedUntilMs = 0;
    this.alertedPauseUntilMs = 0;
  }

  async acquire(): Promise<void> {
    for (;;) {
      if (this.isPaused()) {
        throw new SupplierRateLimitError(QUANTUM_CIRCUIT_OPEN_MESSAGE);
      }
      this.refill();
      if (this.inFlight < this.maxConcurrent && this.tokens >= 1) {
        this.tokens -= 1;
        this.inFlight += 1;
        return;
      }
      if (this.inFlight >= this.maxConcurrent) {
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
        continue;
      }
      await this.sleep(this.msUntilNextToken());
    }
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  noteSuccess(): void {
    this.strikes = [];
  }

  /**
   * Record a 429 / 401 / 403. After repeated hits, pause every Quantum call
   * and ask the caller to alert admins once.
   */
  noteHardFailure(kind: QuantumStrikeKind): { opened: boolean; shouldAlert: boolean } {
    const now = this.now();
    this.strikes.push({ at: now, kind });
    this.strikes = this.strikes.filter((s) => now - s.at <= this.strikeWindowMs);

    const auth = this.strikes.filter((s) => s.kind === "401" || s.kind === "403").length;
    const rate = this.strikes.filter((s) => s.kind === "429").length;
    const trip = auth >= this.authStrikeThreshold || rate >= this.rateStrikeThreshold;
    if (!trip) return { opened: false, shouldAlert: false };

    const wasOpen = this.isPaused(now);
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + this.pauseMs);
    const shouldAlert = !wasOpen && this.alertedPauseUntilMs !== this.pausedUntilMs;
    if (shouldAlert) this.alertedPauseUntilMs = this.pausedUntilMs;
    return { opened: true, shouldAlert };
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    const add = (elapsed / 60_000) * this.maxPerMinute;
    this.tokens = Math.min(this.maxPerMinute, this.tokens + add);
    this.lastRefillMs = now;
  }

  private msUntilNextToken(): number {
    const perToken = 60_000 / this.maxPerMinute;
    return Math.max(5, Math.ceil(perToken));
  }
}

export const quantumRequestGate = new QuantumRequestGate();

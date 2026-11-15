import { env } from "../../../config/env";
import {
  SupplierAuthenticationError,
  SupplierInvalidResponseError,
  SupplierNetworkError,
  SupplierRateLimitError,
} from "../SupplierAdapter";
import {
  parseRetryAfterMs,
  quantumRequestGate,
  quantumRetryDelayMs,
  QuantumRequestGate,
  type QuantumStrikeKind,
} from "./quantumLimiter";
import { buildQuantumCircuitAlert } from "./quantumNotify";

export const QUANTUM_DEFAULT_BASE_URL = "https://www.quantumvault.me/api/v1";
export const QUANTUM_GET_MAX_ATTEMPTS = 4;
export const QUANTUM_DEFAULT_TIMEOUT_MS = 20_000;
export const QUANTUM_CATALOG_TIMEOUT_MS = 45_000;

export type QuantumFetch = (url: string, init: RequestInit) => Promise<Response>;

export type QuantumHttpResult = {
  status: number;
  ok: boolean;
  body: unknown;
  message: string;
};

type AlertHandler = (text: string) => void | Promise<void>;

let circuitAlertHandler: AlertHandler | null = null;

/** Admin DM when the circuit opens. Called at most once per pause window. */
export function setQuantumCircuitAlertHandler(handler: AlertHandler | null): void {
  circuitAlertHandler = handler;
}

export type QuantumRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** POST /purchase must leave this false. Timeouts are not retried. */
  retry?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

export class QuantumVaultHttpClient {
  private readonly fetchImpl: QuantumFetch;
  private readonly gate: QuantumRequestGate;
  private readonly baseUrl: string;

  constructor(deps?: {
    fetchImpl?: QuantumFetch;
    gate?: QuantumRequestGate;
    baseUrl?: string;
  }) {
    this.fetchImpl = deps?.fetchImpl ?? ((url, init) => fetch(url, init));
    this.gate = deps?.gate ?? quantumRequestGate;
    this.baseUrl = (deps?.baseUrl ?? env.QUANTUMVAULT_BASE_URL ?? QUANTUM_DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  async request(
    path: string,
    apiKey: string,
    options: QuantumRequestOptions = {},
  ): Promise<QuantumHttpResult> {
    const method = options.method ?? "GET";
    const allowRetry = method === "GET" && options.retry !== false;
    const maxAttempts = allowRetry ? QUANTUM_GET_MAX_ATTEMPTS : 1;
    const timeoutMs =
      options.timeoutMs ??
      (path.startsWith("/products") ? QUANTUM_CATALOG_TIMEOUT_MS : QUANTUM_DEFAULT_TIMEOUT_MS);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.gate.acquire();
      try {
        const response = await this.fetchOnce(path, apiKey, method, options, timeoutMs);
        const parsed = await this.readBody(response, apiKey);

        if (response.ok) {
          this.gate.noteSuccess();
          return parsed;
        }

        if (response.status === 401 || response.status === 403) {
          this.recordStrike(response.status === 401 ? "401" : "403");
          return parsed;
        }

        if (response.status === 429 || response.status === 503) {
          if (response.status === 429) {
            const opened = this.recordStrike("429");
            if (opened || !allowRetry || attempt === maxAttempts) return parsed;
          } else if (!allowRetry || attempt === maxAttempts) {
            return parsed;
          }
          const retryAfter = parseRetryAfterMs(response.headers.get("Retry-After"));
          const bodyRetry = readBodyRetryAfterMs(parsed.body);
          await sleep(
            quantumRetryDelayMs({
              attempt,
              retryAfterMs: retryAfter ?? bodyRetry,
            }),
          );
          continue;
        }

        return parsed;
      } catch (error) {
        if (error instanceof SupplierRateLimitError || error instanceof SupplierInvalidResponseError) {
          throw error;
        }
        const wrapped = this.asNetworkError(error, apiKey);
        lastError = wrapped;
        if (!allowRetry || attempt === maxAttempts) throw wrapped;
        await sleep(quantumRetryDelayMs({ attempt }));
      } finally {
        this.gate.release();
      }
    }

    throw lastError ?? new SupplierNetworkError("Quantum request failed.");
  }

  private recordStrike(kind: QuantumStrikeKind): boolean {
    const result = this.gate.noteHardFailure(kind);
    if (result.shouldAlert && circuitAlertHandler) {
      const reason =
        kind === "429"
          ? "محدودیت تعداد درخواست (429) چند بار تکرار شد."
          : kind === "401"
            ? "کلید API رد شد (401)."
            : "حساب Quantum مسدود است (403).";
      void Promise.resolve(circuitAlertHandler(buildQuantumCircuitAlert(reason))).catch((err) => {
        console.warn("[Quantum] circuit alert failed:", err instanceof Error ? err.message : "error");
      });
    }
    return result.opened;
  }

  private async fetchOnce(
    path: string,
    apiKey: string,
    method: "GET" | "POST",
    options: QuantumRequestOptions,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("X-API-Key", apiKey);
    headers.set("Accept", "application/json");
    if (method === "POST") headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(response: Response, apiKey: string): Promise<QuantumHttpResult> {
    const text = await response.text();
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        if (response.ok) {
          throw new SupplierInvalidResponseError("Quantum response is not valid JSON.");
        }
        body = null;
      }
    }
    const message = redactSecrets(
      errorMessageFromBody(body, `HTTP ${response.status}`),
      [apiKey],
    );
    return { status: response.status, ok: response.ok, body, message };
  }

  private asNetworkError(error: unknown, apiKey: string): SupplierNetworkError {
    const name = error instanceof Error ? error.name : "";
    const raw = error instanceof Error ? error.message : "network error";
    const message = redactSecrets(raw, [apiKey]);
    if (name === "AbortError" || name === "TimeoutError") {
      return new SupplierNetworkError(`Quantum request timed out. ${message}`.trim());
    }
    if (error instanceof SupplierInvalidResponseError) {
      return new SupplierNetworkError(redactSecrets(error.message, [apiKey]));
    }
    return new SupplierNetworkError(`Quantum network error: ${message}`);
  }
}

function readBodyRetryAfterMs(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const retryAfter = (body as { retryAfter?: unknown }).retryAfter;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.round(retryAfter * 1000);
  }
  return null;
}

export function throwForQuantumStatus(result: QuantumHttpResult): void {
  if (result.status === 401) {
    throw new SupplierAuthenticationError(result.message || "Invalid or revoked API key.");
  }
  if (result.status === 403) {
    throw new SupplierAuthenticationError(result.message || "Quantum account is blocked.");
  }
  if (result.status === 429) {
    throw new SupplierRateLimitError(result.message || "Quantum rate limit.");
  }
}

export const quantumVaultHttp = new QuantumVaultHttpClient();

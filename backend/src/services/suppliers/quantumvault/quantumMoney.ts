/**
 * Decimal-safe USD amounts from Quantum JSON.
 * Values are kept as integer 1/10000 USD (4 decimal places) so 0.1 + 0.2
 * style drift does not change a stored supplier cost.
 */

const USD_SCALE = 10_000;

export function usdToMicro(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "0000").slice(0, 4);
    const micro = Number(whole) * USD_SCALE + Number(fracPadded);
    if (!Number.isSafeInteger(micro)) return null;
    return micro;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * USD_SCALE);
  }

  return null;
}

export function microToUsd(micro: number): number {
  return micro / USD_SCALE;
}

/** Finite non-negative USD rounded to 4 decimal places, or null. */
export function parseUsdAmount(value: unknown): number | null {
  const micro = usdToMicro(value);
  if (micro == null) return null;
  return microToUsd(micro);
}

export function formatUsdAmount(value: number): string {
  const micro = Math.round(value * USD_SCALE);
  const whole = Math.trunc(micro / USD_SCALE);
  const frac = String(Math.abs(micro % USD_SCALE)).padStart(4, "0");
  return `${whole}.${frac}`;
}

let requestCountSinceReport = 0;
let lastReportAt = Date.now();
const REPORT_INTERVAL_MS = 5 * 60 * 1000;

/** One line per real HTTP call to Canboso (no secrets). */
export function logCanbosoHttpRequest(
  endpoint: string,
  status: number | "skipped" | "error",
  reason: string,
): void {
  console.log(`[CanbosoHTTP] endpoint=${endpoint} status=${status} reason=${reason}`);
  if (status !== "skipped") {
    requestCountSinceReport += 1;
  }
  const now = Date.now();
  if (now - lastReportAt >= REPORT_INTERVAL_MS) {
    console.log(
      `[CanbosoHTTP] periodic count=${requestCountSinceReport} windowSec=${Math.round((now - lastReportAt) / 1000)}`,
    );
    requestCountSinceReport = 0;
    lastReportAt = now;
  }
}

export function resetCanbosoRequestLogForTests(): void {
  requestCountSinceReport = 0;
  lastReportAt = Date.now();
}

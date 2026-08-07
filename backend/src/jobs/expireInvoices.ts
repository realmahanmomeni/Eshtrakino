import { invoiceService } from "../services/invoices/InvoiceService";

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Periodically marks PENDING invoices past expiresAt as EXPIRED.
 * Default TTL: INVOICE_TTL_HOURS (5h) from env.
 */
export function startInvoiceExpirationJob(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  const tick = async () => {
    try {
      const count = await invoiceService.expireOverdue();
      if (count > 0) {
        console.log(`[invoice-expiry] expired ${count} pending invoice(s)`);
      }
    } catch (err) {
      console.error("[invoice-expiry] job failed:", err);
    }
  };

  void tick();
  return setInterval(tick, intervalMs);
}

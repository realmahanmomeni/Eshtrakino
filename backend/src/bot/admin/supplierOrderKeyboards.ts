import { InlineKeyboard } from "grammy";
import { Callbacks } from "../keyboards/callbacks";

/** Full supplier-order action row set (log group + admin DM). */
export function buildSupplierAdminActionKeyboard(invoiceId: number): InlineKeyboard {
  return supplierOrderAdminKeyboard(invoiceId);
}

/** Inline actions on supplier / manual-delivery admin alerts in the log group. */
export function supplierOrderAdminKeyboard(invoiceId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚀 تایید شارژ و ارسال خودکار", Callbacks.adminDispatchOrder(invoiceId))
    .row()
    .text("🔗 ارسال دستی لینک / اکانت", Callbacks.adminManualDeliver(invoiceId))
    .row()
    .text("✅ ثبت تحویل (بدون پیام به مشتری)", Callbacks.adminMarkDelivered(invoiceId))
    .row()
    .text("❌ لغو و بازگشت به کیف پول", Callbacks.adminCancelSupplierOrder(invoiceId));
}

/** Manual-only queue (supplier OOS) — no auto-dispatch. */
export function manualDeliveryAdminKeyboard(invoiceId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔗 ارسال لینک / اکانت به مشتری", Callbacks.adminManualDeliver(invoiceId))
    .row()
    .text("✅ ثبت تحویل (بدون پیام به مشتری)", Callbacks.adminMarkDelivered(invoiceId));
}

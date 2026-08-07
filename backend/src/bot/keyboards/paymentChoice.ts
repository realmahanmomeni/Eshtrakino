/**
 * Shared helpers to build payment-choice keyboards with all active DB methods.
 */
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import {
  settingsService,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import {
  checkoutPaymentChoiceKeyboard,
  type CheckoutMethodButton,
} from "../keyboards/builders";
import { toPlain } from "../../lib/plain";

export async function loadActivePaymentButtons(): Promise<CheckoutMethodButton[]> {
  const rows = await paymentMethodService.listActiveForButtons();
  return toPlain(rows);
}

export async function buildCheckoutPaymentKeyboard(
  invoiceId: number,
  balanceLabel: string,
): Promise<ReturnType<typeof checkoutPaymentChoiceKeyboard>> {
  const [methods, swapEnabled] = await Promise.all([
    loadActivePaymentButtons(),
    settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
  ]);
  return checkoutPaymentChoiceKeyboard(invoiceId, balanceLabel, {
    methods,
    swapEnabled,
  });
}

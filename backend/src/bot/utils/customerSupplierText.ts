/**
 * Customer-facing copy must never name a supplier. Admin screens do not use this.
 */
const SUPPLIER_NAME_REPLACEMENTS: Array<[RegExp, string]> = [
  [/quantum\s*vault/gi, "اشتراکینو"],
  [/quantumvault/gi, "اشتراکینو"],
  [/\bquantum\b/gi, "اشتراکینو"],
  [/canboso/gi, "اشتراکینو"],
  [/کوانتوم\s*ولت/g, "اشتراکینو"],
  [/کوانتوم/g, "اشتراکینو"],
  [/کنبوسo/g, "اشتراکینو"],
  [/کنبوسو/g, "اشتراکینو"],
  [/کانبوسو/g, "اشتراکینو"],
];

export const CUSTOMER_SUPPLIER_LEAK_RE =
  /quantumvault|\bquantum\b|canboso|کوانتوم|کنبوسو|کانبوسو|کنبوسo/i;

export function stripSupplierNames(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SUPPLIER_NAME_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/(?:اشتراکینو)(?:\s+اشتراکینو)+/g, "اشتراکینو");
}

export function customerTextLeaksSupplier(text: string): boolean {
  return CUSTOMER_SUPPLIER_LEAK_RE.test(text);
}

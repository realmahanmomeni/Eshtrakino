/**
 * grammY conversations v2 clone return values of `conversation.external()`
 * via structuredClone. Prisma Decimal / BigInt cannot be cloned — convert
 * everything to JSON-safe plain data first.
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}

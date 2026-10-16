import type { SessionData } from "../context";

/** Safe read — conversations may receive ctx without session attached. */
export function readShopShowOutOfStock(session: SessionData | undefined | null): boolean {
  return session?.shopShowOutOfStock === true;
}

import { prisma } from "../../lib/prisma";

export const LOG_GROUP_ID_KEY = "LOG_GROUP_ID";
export const LOG_PURCHASE_TOPIC_ID_KEY = "LOG_PURCHASE_TOPIC_ID";
export const LOG_BACKUP_TOPIC_ID_KEY = "LOG_BACKUP_TOPIC_ID";
export const LOG_OTHER_TOPIC_ID_KEY = "LOG_OTHER_TOPIC_ID";
export const LOG_INVENTORY_TOPIC_ID_KEY = "LOG_INVENTORY_TOPIC_ID";
export const LOG_TICKET_TOPIC_ID_KEY = "LOG_TICKET_TOPIC_ID";
export const LOW_STOCK_THRESHOLD_KEY = "LOW_STOCK_THRESHOLD";
export const AUTO_BACKUP_HOURS_KEY = "AUTO_BACKUP_HOURS";
export const LAST_AUTO_BACKUP_TIME_KEY = "LAST_AUTO_BACKUP_TIME";
/** Swap Wallet Bearer API key (admin-managed, not env). */
export const SWAPPAY_API_KEY = "SWAPPAY_API_KEY";
/** Swap Wallet USDT receive address (admin-managed; env is fallback only). */
export const SWAPPAY_WALLET_ADDRESS = "SWAPPAY_WALLET_ADDRESS";
/** "true" | "false" — whether Swap Wallet appears for users */
export const SWAPPAY_ENABLED = "SWAPPAY_ENABLED";

export class SettingsService {
  async getSetting(key: string): Promise<string | null> {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async getNumberSetting(key: string, fallback: number): Promise<number> {
    const raw = await this.getSetting(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Boolean SystemSetting — missing key uses `fallback`. */
  async getBoolSetting(key: string, fallback = false): Promise<boolean> {
    const raw = await this.getSetting(key);
    if (raw == null) return fallback;
    const v = raw.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    return fallback;
  }

  async setBoolSetting(key: string, value: boolean): Promise<void> {
    await this.setSetting(key, value ? "true" : "false");
  }
}

export const settingsService = new SettingsService();

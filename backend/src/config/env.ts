import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Prefer process env (Docker Compose). Also load .env files when present.
const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../../../.env"), // monorepo root when running from /backend
  resolve(__dirname, "../../.env"), // /backend/.env when compiled to dist/
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    loadEnv({ path: p, override: false });
  }
}

function parseAdminIds(raw: string | undefined): number[] {
  if (!raw || raw.trim() === "" || raw.includes("REPLACE_WITH")) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  BOT_HEALTH_PORT: z.coerce.number().int().positive().default(3100),
  INVOICE_TTL_HOURS: z.coerce.number().positive().default(5),
  PAYMENT_GATEWAY: z.enum(["balance", "stub"]).default("balance"),
  /** Comma-separated Telegram numeric IDs with full /admin access. */
  ADMIN_IDS: z.string().optional().default(""),
  /** USDT receive address for Swap Wallet express-withdraw */
  SWAPPAY_WALLET_ADDRESS: z.string().optional().default(""),
  SWAPPAY_WALLET_NETWORK: z.string().optional().default("BSC"),
  SWAPPAY_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(90),
  /** Canboso Telegram Buyer API (primary digital supplier). */
  CANBOSO_API_KEY: z
    .string()
    .optional()
    .default("tgb_c72724412e4364cf9e1934c1c4d5a53333b93dcf53b1d6c1"),
  CANBOSO_BASE_URL: z.string().optional().default("https://canboso.com"),
  CANBOSO_CATALOG_TTL_MS: z.coerce.number().int().positive().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed. Copy .env.example → .env and set values.");
}

const adminIds = parseAdminIds(parsed.data.ADMIN_IDS);

export const env = {
  ...parsed.data,
  adminIds,
};

export const INVOICE_TTL_MS = env.INVOICE_TTL_HOURS * 60 * 60 * 1000;

export function isAdminTelegramId(telegramId: number | undefined): boolean {
  if (telegramId === undefined || env.adminIds.length === 0) return false;
  return env.adminIds.includes(telegramId);
}

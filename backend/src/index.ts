import { createServer } from "node:http";
import { Bot, session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { env } from "./config/env";
import type { BotContext, SessionData } from "./bot/context";
import { createInitialSession } from "./bot/context";
import { TtlMemorySessionStorage } from "./bot/session/ttlMemoryStorage";
import { ensureUserMiddleware } from "./bot/middlewares/ensureUser";
import { registerHandlers } from "./bot/handlers";
import { registerAdmin } from "./bot/admin/handlers";
import { startInvoiceExpirationJob } from "./jobs/expireInvoices";
import { startRenewalCron } from "./services/cron/RenewalCron";
import { startSwapWalletCron } from "./services/cron/SwapWalletCron";
import { prisma } from "./lib/prisma";
import { groupLogger } from "./services/logger/GroupLogger";
import { backupService } from "./services/backup/BackupService";
import { bootstrapCatalog } from "./services/catalog/bootstrapCatalog";
import { runIdempotentCatalogDataFixes } from "./services/catalog/catalogDataFixes";
import { syncStarsPackTomanPrices } from "./services/catalog/starsPricingService";
import { exitAllConversations } from "./bot/utils/conversations";
import { ensureWhiteLabelCatalog } from "./services/catalog/whiteLabelCatalog";
import {
  AUTO_BACKUP_HOURS_KEY,
  DEFAULT_PROFIT_MARGIN_PERCENT,
  DEFAULT_PROFIT_MARGIN_PERCENT_KEY,
  LAST_AUTO_BACKUP_TIME_KEY,
  settingsService,
} from "./services/settings/SettingsService";
import { lazyCacheService } from "./services/catalog/LazyCacheService";
import { canbosoSyncService, setCanbosoSyncNotifyApi } from "./services/suppliers/CanbosoSyncService";
import { hydrateCanbosoCooldownFromSettings } from "./services/suppliers/canboso/canbosoCooldownState";

async function runAutoBackupCheck(bot: Bot<BotContext>): Promise<void> {
  const hours = await settingsService.getNumberSetting(AUTO_BACKUP_HOURS_KEY, 0);
  if (hours <= 0) return;

  const lastRaw = await settingsService.getSetting(LAST_AUTO_BACKUP_TIME_KEY);
  const lastMs = lastRaw ? Number(lastRaw) : 0;
  const now = Date.now();
  const intervalMs = hours * 60 * 60 * 1000;

  if (lastMs > 0 && now - lastMs < intervalMs) {
    return;
  }

  let filePath: string | undefined;
  try {
    filePath = await backupService.createDump();
    const stamp = new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    await groupLogger.logBackup(
      bot.api,
      filePath,
      ["🤖 *بکاپ خودکار دیتابیس*", "", `🕐 زمان: *${stamp}*`].join("\n"),
    );
    await settingsService.setSetting(LAST_AUTO_BACKUP_TIME_KEY, String(now));
  } catch (err) {
    console.error("auto backup check failed:", err);
    await groupLogger.logError(bot.api, "خطا در ارسال بکاپ خودکار", err).catch(console.error);
  } finally {
    if (filePath) {
      await backupService.cleanup(filePath).catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  if (env.BOT_TOKEN.includes("REPLACE_WITH")) {
    console.warn(
      "⚠ BOT_TOKEN is still a placeholder. Set a real token in /.env before production use.",
    );
  }

  if (env.adminIds.length === 0) {
    console.warn(
      "⚠ ADMIN_IDS is not set. /admin is locked until you add Telegram numeric IDs to .env.",
    );
  } else {
    console.log(`Admin panel enabled for Telegram IDs: ${env.adminIds.join(", ")}`);
  }

  await prisma.$connect();
  console.log("Connected to PostgreSQL via Prisma");

  await hydrateCanbosoCooldownFromSettings().catch((err) => {
    console.warn("[Canboso] Cooldown hydrate skipped:", err);
  });

  // Ensure initial catalog integrity (Inspect-Before-Create)
  await bootstrapCatalog();
  await runIdempotentCatalogDataFixes();

  try {
    const marginDefault = await settingsService.getSetting(DEFAULT_PROFIT_MARGIN_PERCENT_KEY);
    if (!marginDefault) {
      await settingsService.setSetting(
        DEFAULT_PROFIT_MARGIN_PERCENT_KEY,
        String(DEFAULT_PROFIT_MARGIN_PERCENT),
      );
    }
    await ensureWhiteLabelCatalog();
    await lazyCacheService.markCatalogSynced();
    await lazyCacheService.hydrateFromSettings();
    await syncStarsPackTomanPrices().catch((err) => {
      console.warn("[StarsPricing] Startup Toman sync skipped:", err);
    });
    console.log("[CanbosoSync] Startup catalog + supplier sync complete (via ensureWhiteLabelCatalog).");
  } catch (err) {
    console.warn("[CanbosoSync] Startup sync skipped or failed:", err);
  }

  // One-time startup check/cleanup: Clear individual product banners while keeping Category & SubCategory banners intact
  try {
    const clearedBanners = await prisma.product.updateMany({
      where: {
        bannerFileId: { not: null },
      },
      data: {
        bannerFileId: null,
      },
    });
    if (clearedBanners.count > 0) {
      console.log(`[CLEANUP] Cleared product-level banners on ${clearedBanners.count} products.`);
    }
  } catch (err) {
    console.warn("[CLEANUP] Could not clear product banners:", err);
  }

  const bot = new Bot<BotContext>(env.BOT_TOKEN);
  const sessionStorage = new TtlMemorySessionStorage<SessionData>({
    ttlMs: 24 * 60 * 60 * 1000,
    maxEntries: 5_000,
    cleanupIntervalMs: 15 * 60 * 1000,
  });

  bot.use(
    session({
      initial: (): SessionData => createInitialSession(),
      storage: sessionStorage,
    }),
  );
  bot.use(conversations());
  bot.use(ensureUserMiddleware);

  // Forcibly exit any active conversation on /start before handlers run to prevent freeze/trapping
  bot.command("start", async (ctx, next) => {
    await exitAllConversations(ctx);
    return next();
  });

  // Admin conversations + /admin must register before general handlers that might swallow updates
  registerAdmin(bot);
  registerHandlers(bot);

  setCanbosoSyncNotifyApi(bot.api);
  void canbosoSyncService.syncProductAvailability().catch((err) => {
    console.warn("[CanbosoSync] Post-start supplier sync failed:", err);
  });
  void import("./services/suppliers/SupplierPendingImportService.js")
    .then(({ supplierPendingImportService }) =>
      supplierPendingImportService.flushPendingAdminNotifications(bot.api),
    )
    .catch((err) => {
      console.warn("[CanbosoSync] Pending admin notification flush failed:", err);
    });

  bot.catch((err) => {
    const e = err.error;
    const msg = e instanceof Error ? e.message : String(e);
    // Harmless: user tapped the same menu button twice
    if (msg.includes("message is not modified")) return;
    console.error("Bot error:", e);
    if (err.ctx) {
      void groupLogger
        .logError(err.ctx.api, "خطای سیستمی در ربات", e)
        .catch(console.error);
    }
  });

  const expiryTimer = startInvoiceExpirationJob();
  const renewalTimer = startRenewalCron(bot.api);
  const swapWalletTimer = startSwapWalletCron(bot.api);
  const autoBackupTimer = setInterval(() => {
    void runAutoBackupCheck(bot);
  }, 60 * 60 * 1000);
  void runAutoBackupCheck(bot);

  const healthServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "eshtrakino-bot" }));
  });

  healthServer.listen(env.BOT_HEALTH_PORT, "0.0.0.0", () => {
    console.log(`Health endpoint on 0.0.0.0:${env.BOT_HEALTH_PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down…`);
    clearInterval(expiryTimer);
    clearInterval(renewalTimer);
    clearInterval(swapWalletTimer);
    clearInterval(autoBackupTimer);
    sessionStorage.stop();
    healthServer.close();
    bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("Starting Eshtrakino bot (long polling)…");

  // Menu button commands (replaces any leftover /wallet, /market, etc.)
  await bot.api.setMyCommands([
    { command: "start", description: "🏠 منوی اصلی" },
    { command: "shop", description: "🛒 فروشگاه" },
    { command: "account", description: "👤 حساب من" },
    { command: "support", description: "🎧 پشتیبانی" },
  ]);
  console.log("Bot menu commands registered: /start /shop /account /support");

  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} is running`),
  });
}

main().catch(async (err) => {
  console.error("Fatal startup error:", err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

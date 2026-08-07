import { PrismaClient } from "@prisma/client";

/**
 * Strict Prisma singleton.
 * Always cache on globalThis so hot-reload / multiple imports never open extra pools.
 * Prefer DATABASE_URL with ?connection_limit=5 to cap Postgres connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;

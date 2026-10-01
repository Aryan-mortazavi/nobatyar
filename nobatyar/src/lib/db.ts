import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client per process. Next.js dev-mode hot reloads would otherwise
 * open a new connection pool on every edit and exhaust SQLite handles.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type { Prisma } from "@prisma/client";

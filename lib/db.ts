import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../app/generated/prisma/client";

/*
 * Local, file-based SQLite database. No online database or DATABASE_URL
 * is required — the database is created on first use at prisma/dev.db.
 */
const databaseUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;

const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

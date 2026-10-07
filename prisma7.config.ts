import path from "node:path";

import { defineConfig } from "prisma/config";

/*
 * Local SQLite database. No DATABASE_URL / online database is required.
 * The file lives at prisma/dev.db and is created by `prisma db push`.
 */
const databaseUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { prisma } from "@/lib/db";

const OPS = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "LIKE",
  "ILIKE",
] as const;

/*
 * SQLite has no ILIKE operator; its LIKE is already case-insensitive for
 * ASCII, so ILIKE is mapped onto LIKE instead of passed through.
 */
function sqlOp(op: (typeof OPS)[number]): string {
  return op === "ILIKE" ? "LIKE" : op;
}

const filterSchema = z.object({
  column: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/, "column must be a sanitized identifier"),
  op: z.enum(OPS),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const schema = z.object({
  tableName: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/, "tableName must be a sanitized identifier"),
  filters: z.array(filterSchema).max(20).optional(),
  orderBy: z
    .object({
      column: z
        .string()
        .regex(/^[a-z0-9_]{1,64}$/, "column must be a sanitized identifier"),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const TABLE_NAME_RE = /^[a-z0-9_]{1,64}$/;

function quoteIdent(name: string): string {
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

export const queryDataset = tool(
  async ({ tableName, filters, orderBy, limit }) => {
    if (!TABLE_NAME_RE.test(tableName)) {
      throw new Error("Invalid tableName");
    }
    const dataset = await prisma.dataset.findUnique({
      where: { tableName },
      select: {
        id: true,
        tableName: true,
        status: true,
        columns: true,
      },
    });

    if (!dataset) {
      throw new Error("Dataset table not found.");
    }

    if (dataset.status === "FAILED") {
      throw new Error("Dataset is in a failed state and cannot be queried.");
    }

    const knownColumns = new Set(
      (dataset.columns as Array<{ name: string }>).map((c) => c.name),
    );

    const params: unknown[] = [];
    const where: string[] = [];
    if (filters?.length) {
      for (const f of filters) {
        if (!knownColumns.has(f.column)) {
          throw new Error(
            `Unknown column "${f.column}". Available: ${Array.from(
              knownColumns,
            )
              .slice(0, 10)
              .join(", ")}`,
          );
        }
        params.push(f.value);
        where.push(`${quoteIdent(f.column)} ${sqlOp(f.op)} ?`);
      }
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const orderClause = (() => {
      if (!orderBy) return "";
      if (!knownColumns.has(orderBy.column)) {
        throw new Error(`Unknown orderBy column "${orderBy.column}"`);
      }
      const dir = orderBy.direction === "desc" ? "DESC" : "ASC";
      return ` ORDER BY ${quoteIdent(orderBy.column)} ${dir}`;
    })();

    const whereClause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const query = `SELECT * FROM ${quoteIdent(
      tableName,
    )}${whereClause}${orderClause} LIMIT ${safeLimit}`;

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      query,
      ...params,
    );

    return JSON.stringify({
      tableName,
      count: rows.length,
      rows,
    });
  },
  {
    name: "query_dataset",
    description:
      "Query actual records from a merchant dataset. Inputs: tableName (sanitized id from get_dataset_context), optional filters (array of {column, op, value} where op is one of =, !=, >, <, >=, <=, LIKE, ILIKE), optional orderBy ({column, direction: 'asc'|'desc'}), and limit (1-100, default 50). Returns rows from that table. Read-only.",
    schema,
  },
);

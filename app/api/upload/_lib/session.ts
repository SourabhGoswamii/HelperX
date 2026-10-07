import { promises as fs } from "node:fs";
import path from "node:path";

import Papa from "papaparse";

import { prisma } from "@/lib/db";

export const BATCH_SIZE = 500;

/*
 * SQLite has no enum type, so dataset status is stored as a plain string.
 * This is the single source of truth used by the server routes.
 */
export const DatasetStatus = {
  UPLOADING: "UPLOADING",
  ANALYZING: "ANALYZING",
  READY: "READY",
  FAILED: "FAILED",
} as const;

export type DatasetStatus = (typeof DatasetStatus)[keyof typeof DatasetStatus];

export type Column = { original: string; name: string; type: string };

/*
 * Uploaded files are persisted to the local ./file folder (project root),
 * separate from the online/postgres flow this app used to rely on.
 */
export const UPLOAD_DIR = path.join(process.cwd(), "file");

export function uploadedFilePath(datasetId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "dataset.csv";
  return path.join(UPLOAD_DIR, `${datasetId}_${safe}`);
}

/*
 * Writes the uploaded CSV to ./file as chunks arrive. The first chunk
 * writes the header row, later chunks append rows only.
 * ponytail: appendFile is not atomic, but one dataset is streamed by a
 * single sequential client, so ordering is guaranteed. Upgrade path:
 * write per-chunk part files and merge on completion for parallelism.
 */
export async function saveUploadedChunk(args: {
  datasetId: string;
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  first: boolean;
}): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = uploadedFilePath(args.datasetId, args.fileName);

  if (args.first) {
    const headerLine = Papa.unparse([args.headers]);
    const body = args.rows.length
      ? Papa.unparse(args.rows, { columns: args.headers, header: false })
      : "";
    await fs.writeFile(
      filePath,
      body ? `${headerLine}\r\n${body}\r\n` : `${headerLine}\r\n`,
      "utf8",
    );
  } else if (args.rows.length) {
    const body = Papa.unparse(args.rows, {
      columns: args.headers,
      header: false,
    });
    await fs.appendFile(filePath, `${body}\r\n`, "utf8");
  }

  return filePath;
}

export function sanitizeName(value: string, fallback: string): string {
  const name = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return name || fallback;
}

export function createTableName(fileName: string): string {
  const base = sanitizeName(fileName.replace(/\.csv$/i, ""), "dataset");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${base.slice(0, 48)}_${suffix}`;
}

export function makeUniqueColumnNames(
  columns: string[],
): { original: string; name: string }[] {
  const used = new Map<string, number>();
  return columns.map((original) => {
    const base = sanitizeName(original, "column");
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return { original, name: count === 1 ? base : `${base}_${count}` };
  });
}

export function detectType(values: string[]): string {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (!nonEmpty.length) return "TEXT";
  if (nonEmpty.every((v) => !Number.isNaN(Number(v))))
    return "DOUBLE PRECISION";
  if (
    nonEmpty.every(
      (v) => !Number.isNaN(new Date(v).getTime()) && /[-/]/.test(v),
    )
  )
    return "TIMESTAMP";
  return "TEXT";
}

export function inferColumns(
  headers: string[],
  sampleRows: Record<string, string>[],
): Column[] {
  const named = makeUniqueColumnNames(headers);
  return named.map((c) => ({
    ...c,
    type: detectType(sampleRows.map((r) => r[c.original] ?? "")),
  }));
}

export async function insertBatch(
  tableName: string,
  columns: Column[],
  rows: Record<string, string>[],
): Promise<void> {
  if (!rows.length) return;
  const values: unknown[] = [];
  const groups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      const value = row[column.original];
      values.push(
        value === undefined || value.trim() === "" ? null : value,
      );
      return "?";
    });
    return `(${placeholders.join(", ")})`;
  });
  const columnNames = columns.map((c) => `"${c.name}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${tableName}" (${columnNames}) VALUES ${groups.join(", ")}`,
    ...values,
  );
}

export async function createDatasetTable(
  tableName: string,
  columns: Column[],
): Promise<void> {
  const definitions = columns
    .map((c) => `"${c.name}" ${c.type}`)
    .join(", ");
  await prisma.$executeRawUnsafe(
    `CREATE TABLE "${tableName}" (${definitions})`,
  );
}

export type CreateDatasetResult = {
  datasetId: string;
  tableName: string;
};

export async function createDataset(args: {
  fileName: string;
  tableName: string;
  columns: Column[];
}): Promise<CreateDatasetResult> {
  const dataset = await prisma.dataset.create({
    data: {
      fileName: args.fileName,
      tableName: args.tableName,
      columns: args.columns,
      status: DatasetStatus.UPLOADING,
    },
  });
  return { datasetId: dataset.id, tableName: args.tableName };
}

export async function finalizeDataset(
  datasetId: string,
  rowCount: number,
): Promise<void> {
  await prisma.dataset.update({
    where: { id: datasetId },
    data: { rowCount, status: DatasetStatus.READY },
  });
}

export async function markDatasetFailed(
  datasetId: string,
  message: string,
): Promise<void> {
  await prisma.dataset.update({
    where: { id: datasetId },
    data: { status: DatasetStatus.FAILED, error: message },
  });
}

/*
 * ponytail: server-side Papa.parse kept here only for the /api/analyze
 * semantic pass, which still receives a small CSV sample. The browser
 * does the main CSV parse for upload; this helper stays for that one
 * use case.
 */
export function parseCsvText(csv: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data,
  };
}

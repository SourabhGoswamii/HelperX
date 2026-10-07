import { promises as fs } from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  BATCH_SIZE,
  createDataset,
  createDatasetTable,
  finalizeDataset,
  inferColumns,
  insertBatch,
  markDatasetFailed,
  saveUploadedChunk,
  uploadedFilePath,
} from "./_lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StartBody = {
  fileName?: unknown;
  headers?: unknown;
  rows?: unknown;
  complete?: unknown;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isRowArray(value: unknown): value is Record<string, string>[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v && typeof v === "object" && !Array.isArray(v))
  );
}

export async function POST(request: NextRequest) {
  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const fileName =
    typeof body.fileName === "string" ? body.fileName.trim() : "";
  if (!fileName || !fileName.toLowerCase().endsWith(".csv")) {
    return NextResponse.json(
      { error: "fileName must be a .csv file" },
      { status: 400 },
    );
  }
  if (!isStringArray(body.headers) || !body.headers.length) {
    return NextResponse.json(
      { error: "headers must be a non-empty string array" },
      { status: 400 },
    );
  }
  if (!isRowArray(body.rows) || !body.rows.length) {
    return NextResponse.json(
      { error: "rows must be a non-empty array" },
      { status: 400 },
    );
  }
  if (typeof body.complete !== "boolean") {
    return NextResponse.json(
      { error: "complete must be a boolean" },
      { status: 400 },
    );
  }

  const allRows = body.rows as Record<string, string>[];
  if (allRows.length > BATCH_SIZE) {
    return NextResponse.json(
      {
        error: `first chunk must be <= ${BATCH_SIZE} rows; got ${allRows.length}`,
      },
      { status: 400 },
    );
  }

  const columns = inferColumns(body.headers, allRows);
  const tableName = `ds_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  let datasetId: string;
  try {
    const result = await createDataset({ fileName, tableName, columns });
    datasetId = result.datasetId;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create dataset",
      },
      { status: 500 },
    );
  }

  try {
    await createDatasetTable(tableName, columns);
    await insertBatch(tableName, columns, allRows);
    await saveUploadedChunk({
      datasetId,
      fileName,
      headers: body.headers,
      rows: allRows,
      first: true,
    });
    if (body.complete) {
      await finalizeDataset(datasetId, allRows.length);
    } else {
      await prisma.dataset.update({
        where: { id: datasetId },
        data: { rowCount: allRows.length },
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Database upload failed";
    await markDatasetFailed(datasetId, message).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}"`).catch(() => {});
    await fs.unlink(uploadedFilePath(datasetId, fileName)).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    datasetId,
    tableName,
    rowsReceived: allRows.length,
    complete: body.complete,
  });
}

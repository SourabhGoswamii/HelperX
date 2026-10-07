import { promises as fs } from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  BATCH_SIZE,
  DatasetStatus,
  finalizeDataset,
  insertBatch,
  markDatasetFailed,
  saveUploadedChunk,
  uploadedFilePath,
  type Column,
} from "@/app/api/upload/_lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChunkBody = {
  rows?: unknown;
  complete?: unknown;
};

function isRowArray(value: unknown): value is Record<string, string>[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v && typeof v === "object" && !Array.isArray(v))
  );
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/upload/[datasetId]/chunk">,
) {
  const { datasetId } = await params;
  if (!UUID_RE.test(datasetId)) {
    return NextResponse.json(
      { error: "Invalid datasetId" },
      { status: 400 },
    );
  }

  let body: ChunkBody;
  try {
    body = (await request.json()) as ChunkBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.complete !== "boolean") {
    return NextResponse.json(
      { error: "complete must be a boolean" },
      { status: 400 },
    );
  }

  /*
   * The final-chunk signal is mandatory, but a "complete" chunk may
   * legally be empty (e.g. a file whose row count is an exact multiple
   * of BATCH_SIZE — the last call carries no extra rows, just the
   * finalization signal). A non-complete chunk must carry rows.
   */
  if (body.complete) {
    if (body.rows !== undefined && !isRowArray(body.rows)) {
      return NextResponse.json(
        { error: "rows must be an array" },
        { status: 400 },
      );
    }
  } else {
    if (!isRowArray(body.rows) || !body.rows.length) {
      return NextResponse.json(
        { error: "non-final chunks must include a non-empty rows array" },
        { status: 400 },
      );
    }
  }

  const rows = isRowArray(body.rows) ? (body.rows as Record<string, string>[]) : [];
  if (rows.length > BATCH_SIZE) {
    return NextResponse.json(
      {
        error: `chunk must be <= ${BATCH_SIZE} rows; got ${rows.length}`,
      },
      { status: 400 },
    );
  }

  const dataset = await prisma.dataset.findUnique({
    where: { id: datasetId },
    select: {
      id: true,
      fileName: true,
      tableName: true,
      status: true,
      columns: true,
      rowCount: true,
    },
  });

  if (!dataset) {
    return NextResponse.json(
      { error: "Dataset not found" },
      { status: 404 },
    );
  }

  if (dataset.status !== DatasetStatus.UPLOADING) {
    return NextResponse.json(
      {
        error: `Dataset is ${String(dataset.status).toLowerCase()}; cannot append`,
      },
      { status: 409 },
    );
  }

  const columns = dataset.columns as Column[];

  try {
    if (rows.length > 0) {
      await insertBatch(dataset.tableName, columns, rows);
      await saveUploadedChunk({
        datasetId: dataset.id,
        fileName: dataset.fileName,
        headers: columns.map((column) => column.original),
        rows,
        first: false,
      });
    }
    const newRowCount = dataset.rowCount + rows.length;
    if (body.complete) {
      await finalizeDataset(dataset.id, newRowCount);
    } else {
      await prisma.dataset.update({
        where: { id: dataset.id },
        data: { rowCount: newRowCount },
      });
    }
    return NextResponse.json({
      success: true,
      datasetId: dataset.id,
      rowsReceived: newRowCount,
      complete: body.complete,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chunk insert failed";
    await markDatasetFailed(dataset.id, message).catch(() => {});
    await fs.unlink(uploadedFilePath(dataset.id, dataset.fileName)).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

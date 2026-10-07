import { NextRequest, NextResponse } from "next/server";

import type { InputJsonValue } from "@/app/generated/prisma/internal/prismaNamespace";
import { DatasetStatus } from "@/app/api/upload/_lib/session";
import { prisma } from "@/lib/db";

type Column = { original: string; name: string; type: string };

const TABLE_NAME_RE = /^[a-z0-9_]{1,64}$/;

function toJsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/datasets/[id]/analyze">,
) {
  const { id } = await params;
  const dataset = await prisma.dataset.findUnique({ where: { id } });

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const force = new URL(request.url).searchParams.get("force") === "true";

  /*
   * Strict READY gate: only a fully uploaded dataset can be analyzed.
   * `UPLOADING` means chunks are still arriving or the client hasn't
   * sent the final `complete: true` signal yet. `FAILED` means a
   * previous attempt errored; require an explicit re-analysis path.
   * The "re-analyse" button uses ?force=true, which is handled below
   * (READY + force re-runs the semantic pass).
   */
  if (dataset.status === DatasetStatus.UPLOADING) {
    return NextResponse.json(
      {
        error: "Dataset upload is not complete yet",
        status: dataset.status,
      },
      { status: 409 },
    );
  }

  if (dataset.status === DatasetStatus.FAILED) {
    if (!force) {
      return NextResponse.json(
        {
          error: "Dataset analysis previously failed; retry with force=true",
          status: dataset.status,
        },
        { status: 409 },
      );
    }
  }

  if (dataset.status === DatasetStatus.ANALYZING) {
    return NextResponse.json(
      {
        error: "Analysis already in progress",
        status: dataset.status,
      },
      { status: 409 },
    );
  }

  if (
    dataset.status !== DatasetStatus.READY &&
    !(dataset.status === DatasetStatus.FAILED && force)
  ) {
    return NextResponse.json(
      {
        error: `Cannot analyze dataset in status ${String(dataset.status)}`,
        status: dataset.status,
      },
      { status: 409 },
    );
  }

  /*
   * From here, dataset.status === READY. With force=true, re-run the
   * semantic pass; otherwise short-circuit as a no-op success.
   */
  if (!force) {
    return NextResponse.json({ success: true, status: dataset.status });
  }

  if (!TABLE_NAME_RE.test(dataset.tableName)) {
    return NextResponse.json(
      { error: "Invalid dataset table name" },
      { status: 500 },
    );
  }

  await prisma.dataset.update({
    where: { id },
    data: { status: DatasetStatus.ANALYZING, error: null },
  });

  try {
    const columns = dataset.columns as Column[];
    const sampleRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${dataset.tableName}" LIMIT 5`,
    );

    const INNER_TIMEOUT_MS = 90_000;
    const innerAbort = new AbortController();
    const innerTimer = setTimeout(() => innerAbort.abort(), INNER_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(new URL("/api/analyze", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_name: dataset.tableName,
          file_name: dataset.fileName,
          columns: columns.map((column) => ({
            name: column.name,
            original_name: column.original,
            type: column.type,
          })),
          sample_rows: sampleRows,
        }),
        signal: innerAbort.signal,
      });
    } finally {
      clearTimeout(innerTimer);
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
      };
      throw new Error(errBody.error ?? "AI analysis failed");
    }

    const context = (await response.json()) as Record<string, unknown>;
    const contextJson = toJsonValue(context);

    await prisma.datasetContext.upsert({
      where: { datasetId: id },
      create: { datasetId: id, context: contextJson },
      update: { context: contextJson },
    });

    await prisma.dataset.update({
      where: { id },
      data: { status: DatasetStatus.READY, error: null },
    });

    return NextResponse.json({ success: true, status: DatasetStatus.READY });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI analysis failed";
    await prisma.dataset.update({
      where: { id },
      data: { status: DatasetStatus.FAILED, error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { InputJsonValue } from "@/app/generated/prisma/internal/prismaNamespace";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["ANALYSIS", "INSIGHT", "DECISION", "RESEARCH"] as const;
type LogbookType = (typeof VALID_TYPES)[number];

function toJsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function isLogbookType(value: unknown): value is LogbookType {
  return (
    typeof value === "string" &&
    (VALID_TYPES as readonly string[]).includes(value)
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) ? limitParam : 50;

  const entries = await prisma.logbookEntry.findMany({
    where: isLogbookType(typeParam) ? { type: typeParam } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  let body: {
    title?: unknown;
    summary?: unknown;
    type?: unknown;
    evidence?: unknown;
    datasetIds?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";

  if (!title || !summary) {
    return NextResponse.json(
      { error: "title and summary are required" },
      { status: 400 },
    );
  }

  const type: LogbookType = isLogbookType(body.type) ? body.type : "INSIGHT";

  const entry = await prisma.logbookEntry.create({
    data: {
      type,
      title,
      summary,
      evidence:
        body.evidence && typeof body.evidence === "object"
          ? toJsonValue(body.evidence)
          : undefined,
      datasetIds: Array.isArray(body.datasetIds)
        ? toJsonValue(
            body.datasetIds.filter((id): id is string => typeof id === "string"),
          )
        : undefined,
    },
  });

  return NextResponse.json({ success: true, entry });
}

export async function PATCH(request: NextRequest) {
  let body: {
    id?: unknown;
    title?: unknown;
    summary?: unknown;
    type?: unknown;
    evidence?: unknown;
    datasetIds?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  const existing = await prisma.logbookEntry.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Logbook entry not found" }, { status: 404 });
  }

  const data: Prisma.LogbookEntryUpdateInput = {};

  if (isLogbookType(body.type)) data.type = body.type;
  if (typeof body.title === "string" && body.title.trim())
    data.title = body.title.trim();
  if (typeof body.summary === "string" && body.summary.trim())
    data.summary = body.summary.trim();
  if (body.evidence === null) {
    data.evidence = Prisma.DbNull;
  } else if (body.evidence && typeof body.evidence === "object") {
    data.evidence = toJsonValue(body.evidence);
  }
  if (body.datasetIds === null) {
    data.datasetIds = Prisma.DbNull;
  } else if (Array.isArray(body.datasetIds)) {
    data.datasetIds = toJsonValue(
      body.datasetIds.filter((entryId): entryId is string => typeof entryId === "string"),
    );
  }

  const entry = await prisma.logbookEntry.update({ where: { id }, data });

  return NextResponse.json({ success: true, entry });
}

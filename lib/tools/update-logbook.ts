import { tool } from "@langchain/core/tools";
import type { InputJsonValue } from "@/app/generated/prisma/internal/prismaNamespace";
import { z } from "zod";

import { prisma } from "@/lib/db";

const schema = z.object({
  id: z.string().min(1),
  type: z.enum(["ANALYSIS", "INSIGHT", "DECISION", "RESEARCH"]).optional(),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  datasetIds: z.array(z.string()).optional(),
});

function toJsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

export const updateLogbook = tool(
  async ({ id, type, title, summary, evidence, datasetIds }) => {
    const existing = await prisma.logbookEntry.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Logbook entry ${id} not found.`);
    }

    const entry = await prisma.logbookEntry.update({
      where: { id },
      data: {
        ...(type !== undefined ? { type } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(evidence !== undefined ? { evidence: toJsonValue(evidence) } : {}),
        ...(datasetIds !== undefined
          ? { datasetIds: toJsonValue(datasetIds) }
          : {}),
      },
    });

    return JSON.stringify({
      success: true,
      entry,
    });
  },
  {
    name: "update_logbook",
    description:
      "Edit an existing logbook entry by id. Use get_logbook first to find the entry id, then update its type, title, summary, evidence, or datasetIds.",
    schema,
  },
);
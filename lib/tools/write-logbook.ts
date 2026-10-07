import { tool } from "@langchain/core/tools";
import type { InputJsonValue } from "@/app/generated/prisma/internal/prismaNamespace";
import { z } from "zod";

import { prisma } from "@/lib/db";

const schema = z.object({
  type: z.enum(["ANALYSIS", "INSIGHT", "DECISION", "RESEARCH"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
  datasetIds: z.array(z.string()).optional(),
});

function toJsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

export const writeLogbook = tool(
  async ({ type, title, summary, evidence, datasetIds }) => {
    const entry = await prisma.logbookEntry.create({
      data: {
        type,
        title,
        summary,
        evidence: evidence !== undefined ? toJsonValue(evidence) : undefined,
        datasetIds:
          datasetIds !== undefined ? toJsonValue(datasetIds) : undefined,
      },
    });

    return JSON.stringify({
      success: true,
      entry,
    });
  },
  {
    name: "write_logbook",
    description:
      "Save an important business analysis, insight, decision, or research finding into the persistent HelperX logbook.",
    schema,
  },
);

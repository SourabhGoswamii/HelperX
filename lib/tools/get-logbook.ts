import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { prisma } from "@/lib/db";

const schema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z
    .enum([
      "ANALYSIS",
      "INSIGHT",
      "DECISION",
      "RESEARCH",
    ])
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getLogbook = tool(
  async ({ from, to, type, limit }) => {
    const entries = await prisma.logbookEntry.findMany({
      where: {
        ...(type
          ? {
              type,
            }
          : {}),

        ...(from || to
          ? {
              createdAt: {
                ...(from
                  ? {
                      gte: new Date(from),
                    }
                  : {}),

                ...(to
                  ? {
                      lte: new Date(to),
                    }
                  : {}),
              },
            }
          : {}),
      },

      orderBy: {
        createdAt: "desc",
      },

      take: Math.min(Math.max(limit ?? 20, 1), 100),
    });

    return JSON.stringify({
      entries,
    });
  },
  {
    name: "get_logbook",
    description:
      "Retrieve historical HelperX business analysis, insights, decisions, and research from the merchant logbook.",
    schema,
  },
);
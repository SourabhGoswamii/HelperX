import { NextRequest, NextResponse } from "next/server";

import { SEMANTIC_PROMPT } from "@/lib/prompts";
import {
  getRotatedOpenRouterApiKeys,
  isOpenRouterQuotaError,
} from "@/lib/openrouter";

type AnalyzeRequest = {
  table_name: string;
  file_name: string;

  columns: {
    name: string;
    original_name: string;
    type: string;
  }[];

  sample_rows: Record<string, string>[];
};

type SemanticObject = {
  table: string;
  entity: string;
  description: string;
  columns: Record<string, string>;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      (await request.json()) as AnalyzeRequest;

    if (
      !body.table_name ||
      !body.columns ||
      !body.sample_rows
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid analysis request",
        },
        {
          status: 400,
        },
      );
    }

    const apiKeys = getRotatedOpenRouterApiKeys();

    if (!apiKeys.length) {
      return NextResponse.json(
        {
          error:
            "OPENROUTER_API_KEY or OPENROUTER_API_KEYS is not configured",
        },
        {
          status: 500,
        },
      );
    }

    const columnInformation =
      body.columns
        .map(
          (column) =>
            `- ${column.name} | original: "${column.original_name}" | type: ${column.type}`,
        )
        .join("\n");

    const sampleData =
      JSON.stringify(
        body.sample_rows,
        null,
        2,
      );

    const systemPrompt = SEMANTIC_PROMPT;

    const userPrompt = `
Dataset:
Table name:
${body.table_name}

File name:
${body.file_name}

Columns:
${columnInformation}

Sample rows:
${sampleData}
`;

    console.log(
      `Analyzing dataset: ${body.table_name}`,
    );

    const ANALYSIS_TIMEOUT_MS = 60_000;
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(),
      ANALYSIS_TIMEOUT_MS,
    );

    let response: Response | undefined;
    let lastError: unknown;
    for (const apiKey of apiKeys) {
      try {
        response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",

              Authorization: `Bearer ${apiKey}`,
            },

            body: JSON.stringify({
              model:
                process.env.OPENROUTER_MODEL ||
                "openai/gpt-4o-mini",

              temperature: 0.5,

              messages: [
                {
                  role: "system",
                  content: systemPrompt,
                },
                {
                  role: "user",
                  content: userPrompt,
                },
              ],
              response_format: {
                type: "json_object",
              },
            }),
            signal: abort.signal,
          },
        );
        if (response.ok) break;
        const body = await response.clone().text();
        if (!isOpenRouterQuotaError(new Error(`${response.status} ${body}`))) {
          break;
        }
      } catch (error) {
        lastError = error;
        if (!isOpenRouterQuotaError(error)) throw error;
      }
    }
    clearTimeout(timer);

    if (!response) {
      throw lastError instanceof Error
        ? lastError
        : new Error("OpenRouter request failed");
    }

    const responseText = await response.text();
    let result: {
      error?: { message?: string; code?: number };
      choices?: Array<{ message?: { content?: string } }>;
    };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      result = {};
    }

    if (!response.ok || result.error) {
      const providerMessage =
        result.error?.message ||
        responseText ||
        `HTTP ${response.status}`;

      console.error(
        "OpenRouter error:",
        providerMessage,
      );

      return NextResponse.json(
        {
          error: `AI analysis failed: ${providerMessage}`,
        },
        {
          status: response.ok ? 502 : response.status,
        },
      );
    }

    const content =
      result?.choices?.[0]?.message
        ?.content;

    if (!content) {
      throw new Error(
        "AI returned no analysis content",
      );
    }

    let semanticObject: SemanticObject;

    try {
      semanticObject =
        JSON.parse(content);
    } catch {
      console.error(
        "Invalid AI JSON:",
        content,
      );

      throw new Error(
        "AI returned invalid JSON",
      );
    }

    if (
      !semanticObject.table ||
      !semanticObject.entity ||
      !semanticObject.description ||
      !semanticObject.columns
    ) {
      throw new Error(
        "AI returned incomplete semantic object",
      );
    }

    return NextResponse.json(
      semanticObject,
    );
  } catch (error) {
    console.error(
      "Analysis error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to analyze dataset",
      },
      {
        status: 500,
      },
    );
  }
}
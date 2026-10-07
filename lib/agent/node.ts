import { AIMessage, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenRouter } from "@langchain/openrouter";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";

import {
  getDatasetContext,
  getLogbook,
  queryDataset,
  updateLogbook,
  webSearch,
  writeLogbook,
} from "@/lib/tools/index";

import { extractText } from "./extractText";

import { AGENT_SYSTEM_PROMPT as SYSTEM_PROMPT } from "@/lib/prompts";
import {
  getRotatedOpenRouterApiKeys,
  isOpenRouterQuotaError,
} from "@/lib/openrouter";

import type { AgentState, Insight } from "./state";

export { SYSTEM_PROMPT };

const tools = [
  getDatasetContext,
  queryDataset,
  webSearch,
  getLogbook,
  writeLogbook,
  updateLogbook,
];

function createModel(apiKey: string, modelOverride?: string): ChatOpenRouter {
  const model =
    modelOverride ||
    process.env.OPENROUTER_MODEL ||
    "openai/gpt-4o-mini";
  return new ChatOpenRouter({
    apiKey,
    model,
    temperature: 0.4,
  });
}

function getLlm(apiKey: string): ChatOpenRouter {
  return createModel(apiKey);
}

function getLlmWithTools(apiKey: string): Runnable {
  return getLlm(apiKey).bindTools(tools);
}

function getFallbackLlm(apiKey: string): ChatOpenRouter {
  const fallbackModel =
    process.env.OPENROUTER_FALLBACK_MODEL || "openai/gpt-4o-mini";
  return createModel(apiKey, fallbackModel);
}

function getFallbackLlmWithTools(apiKey: string): Runnable {
  return getFallbackLlm(apiKey).bindTools(tools);
}

function isProviderFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("reading '0'") ||
    message.includes('reading "0"') ||
    message.includes("provider_overloaded") ||
    message.includes("temporarily overloaded") ||
    message.includes("status code 503")
  );
}

async function invokeAgentModel(
  messages: BaseMessage[],
): Promise<AIMessage> {
  const keys = getRotatedOpenRouterApiKeys();
  if (!keys.length) throw new Error("OPENROUTER_API_KEY is not configured");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      return (await getLlmWithTools(apiKey).invoke(messages)) as AIMessage;
    } catch (error) {
      lastError = error;
      if (!isOpenRouterQuotaError(error)) {
        if (!isProviderFailure(error)) throw error;
        try {
          return (await getFallbackLlmWithTools(apiKey).invoke(messages)) as AIMessage;
        } catch (fallbackError) {
          lastError = fallbackError;
          if (!isOpenRouterQuotaError(fallbackError)) throw fallbackError;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

async function invokeChatModel(messages: BaseMessage[]): Promise<AIMessage> {
  const keys = getRotatedOpenRouterApiKeys();
  if (!keys.length) throw new Error("OPENROUTER_API_KEY is not configured");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      return await getLlm(apiKey).invoke(messages);
    } catch (error) {
      lastError = error;
      if (!isOpenRouterQuotaError(error)) {
        if (!isProviderFailure(error)) throw error;
        try {
          return await getFallbackLlm(apiKey).invoke(messages);
        } catch (fallbackError) {
          lastError = fallbackError;
          if (!isOpenRouterQuotaError(fallbackError)) throw fallbackError;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

async function invokeStructuredInsights(
  messages: BaseMessage[],
): Promise<{ insights?: z.infer<typeof InsightsSchema>["insights"] }> {
  const keys = getRotatedOpenRouterApiKeys();
  if (!keys.length) throw new Error("OPENROUTER_API_KEY is not configured");

  let lastError: unknown;
  for (const apiKey of keys) {
    try {
      return await getLlm(apiKey)
        .withStructuredOutput(InsightsSchema)
        .invoke(messages);
    } catch (error) {
      lastError = error;
      if (!isOpenRouterQuotaError(error)) {
        if (!isProviderFailure(error)) throw error;
        try {
          return await getFallbackLlm(apiKey)
            .withStructuredOutput(InsightsSchema)
            .invoke(messages);
        } catch (fallbackError) {
          lastError = fallbackError;
          if (!isOpenRouterQuotaError(fallbackError)) throw fallbackError;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

export async function agentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const system = new SystemMessage(SYSTEM_PROMPT);
  const messages: BaseMessage[] = [system, ...state.messages];
  const response = await invokeAgentModel(messages);
  const toolCalls = (response as AIMessage).tool_calls?.length ?? 0;
  return {
    messages: [response],
    toolCallCount: toolCalls,
  };
}

const InsightSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  recommendedAction: z.string().optional(),
});

const InsightsSchema = z.object({
  insights: z.array(InsightSchema).default([]),
});

export async function formatInsightsNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  let last = [...state.messages]
    .reverse()
    .find((m) => m instanceof AIMessage) as AIMessage | undefined;
  if (!last) return { insights: [] };

  const lastHasText =
    typeof last.content === "string"
      ? last.content.trim().length > 0
      : Array.isArray(last.content)
        ? last.content.length > 0
        : false;

  let newMessages: BaseMessage[] = [];
  if (!lastHasText || (Array.isArray(last.tool_calls) && last.tool_calls.length > 0)) {
    const synth = new SystemMessage(
      `You have reached the maximum number of tool calls. Based on the
conversation and tool results so far, write the final business answer the
merchant should see. Follow the same answer style as the system prompt:
## Finding / ## Evidence / ## Why it matters / ## Recommended next step.
Use exactly those four markdown headings, in that order. Do not call any more
tools. Do not include JSON or code fences.`,
    );
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      ...state.messages,
      synth,
    ];
    try {
      const finalAi = await invokeChatModel(messages);
      newMessages = [finalAi];
      last = finalAi as AIMessage;
    } catch {
      // ignore synthesis errors
    }
  }

  const lastContent = extractText(last.content);

  const transcript = state.messages
    .map((m) => {
      try {
        const role =
          m.getType() === "system"
            ? "system"
            : m.getType() === "human"
              ? "user"
              : m.getType() === "ai"
                ? "assistant"
                : m.getType() === "tool"
                  ? "tool"
                  : "other";
        const content = extractText(m.content);
        return `${role}: ${content}`;
      } catch {
        return "other: <unserializable>";
      }
    })
    .join("\n");

  const extractionPrompt = [
    new SystemMessage(
      `You extract structured business insights from a HelperX agent
conversation. The merchant only sees the assistant's final text plus your
insights array. Keep insights actionable, evidence-based, and non-overlapping.
Return valid JSON matching the provided schema. If the final message is a
clarifying question or contains no insight, return an empty insights array.`,
    ),
    new SystemMessage(`Conversation:\n${transcript}`),
    new SystemMessage(`Final assistant message:\n${lastContent}`),
  ];

  try {
    const parsed = await invokeStructuredInsights(extractionPrompt);
    const insights = Array.isArray(parsed?.insights)
      ? (parsed.insights as Insight[])
      : [];
    return {
      insights,
      messages: newMessages.length > 0 ? newMessages : [],
    };
  } catch {
    return { insights: [], messages: newMessages };
  }
}

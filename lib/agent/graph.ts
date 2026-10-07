import { END, START, StateGraph } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import {
  getDatasetContext,
  getLogbook,
  queryDataset,
  updateLogbook,
  webSearch,
  writeLogbook,
} from "@/lib/tools/index";

import { agentNode, formatInsightsNode } from "./node";
import { withAudit } from "./withAudit";
import {
  AgentModeSchema,
  MAX_TOOL_CALLS,
  type AgentState,
} from "./state";

const tools = [
  withAudit(getDatasetContext),
  withAudit(queryDataset),
  withAudit(webSearch),
  withAudit(getLogbook),
  withAudit(writeLogbook),
  withAudit(updateLogbook),
];

const toolNode = new ToolNode(tools);

function shouldContinue(state: AgentState): "tools" | "format" {
  const last = state.messages[state.messages.length - 1];
  if (last instanceof AIMessage && last.tool_calls?.length) {
    if ((state.toolCallCount ?? 0) >= MAX_TOOL_CALLS) {
      return "format";
    }
    return "tools";
  }
  return "format";
}

const graph = new StateGraph(AgentModeSchema)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("format", formatInsightsNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    format: "format",
  })
  .addEdge("tools", "agent")
  .addEdge("format", END);

export const compiledAgent = graph
  .compile()
  .withConfig({ runName: "helperx-agent" });

export { MAX_TOOL_CALLS };
export type { AgentState } from "./state";
export { SYSTEM_PROMPT } from "./node";

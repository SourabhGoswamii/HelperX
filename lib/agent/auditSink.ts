"use server";

/*
 * In-process sink for agent streaming events. The agent route sets a
 * sink (closure that writes to its ReadableStream controller) and
 * the agent graph / tools push events through it via logAgentEvent.
 * No external pub-sub, no filesystem, no cross-request state.
 */

type AgentAuditLevel = "info" | "ok" | "warn" | "error";

export type AgentAuditEvent = {
  ts: number;
  level: AgentAuditLevel;
  type: string;
  message: string;
  meta?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __helperx_agent_log:
    | ((event: Omit<AgentAuditEvent, "ts">) => void)
    | undefined;
}

export function setAgentLogSink(
  sink: ((event: Omit<AgentAuditEvent, "ts">) => void) | null,
) {
  if (sink) {
    globalThis.__helperx_agent_log = sink;
  } else {
    delete globalThis.__helperx_agent_log;
  }
}

export function logAgentEvent(event: Omit<AgentAuditEvent, "ts">): void {
  globalThis.__helperx_agent_log?.(event);
}

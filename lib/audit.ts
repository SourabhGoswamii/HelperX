"use client";

export type AuditLevel = "info" | "ok" | "warn" | "error";

export type AuditEvent = {
  id: string;
  ts: number;
  page: string;
  level: AuditLevel;
  type: AuditEventType;
  message: string;
  meta?: Record<string, unknown>;
};

export type AuditEventType =
  | "page.nav"
  | "page.load"
  | "api.request"
  | "api.response"
  | "api.error"
  | "upload.session.create"
  | "upload.chunk.start"
  | "upload.chunk.sent"
  | "upload.chunk.ack"
  | "upload.chunk.error"
  | "upload.finalize"
  | "upload.assembled"
  | "upload.parsed"
  | "upload.table.created"
  | "upload.rows.inserted"
  | "upload.complete"
  | "upload.error"
  | "analyze.request"
  | "analyze.response"
  | "analyze.error"
  | "agent.start"
  | "agent.tool.start"
  | "agent.tool.end"
  | "agent.tool.error"
  | "agent.end"
  | "agent.error"
  | "tool.execute"
  | "dataset.create"
  | "warn"
  | "error"
  | "info";

const MAX_EVENTS = 500;
const STORAGE_KEY = "helperx.audit.v1";
const PAGE_KEY = "helperx.audit.page.v1";

type Listener = (events: AuditEvent[]) => void;

class AuditStore {
  private events: AuditEvent[] = [];
  private listeners = new Set<Listener>();
  private page: string = "unknown";
  private hydrated = false;

  setPage(page: string) {
    this.page = page;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(PAGE_KEY, page);
      } catch {}
    }
  }

  getPage(): string {
    return this.page;
  }

  hydrate() {
    if (this.hydrated || typeof window === "undefined") return;
    this.hydrated = true;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) this.events = JSON.parse(stored) as AuditEvent[];
    } catch {}
    try {
      const storedPage = sessionStorage.getItem(PAGE_KEY);
      if (storedPage) this.page = storedPage;
    } catch {}
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.events);
    return () => {
      this.listeners.delete(fn);
    };
  }

  record(
    partial: Omit<AuditEvent, "id" | "ts" | "page"> & {
      ts?: number;
      id?: string;
    },
  ): AuditEvent {
    if (typeof window === "undefined") {
      return {
        id: partial.id ?? crypto.randomUUID(),
        ts: partial.ts ?? Date.now(),
        page: this.page,
        level: partial.level,
        type: partial.type,
        message: partial.message,
        meta: partial.meta,
      };
    }
    const event: AuditEvent = {
      id: partial.id ?? crypto.randomUUID(),
      ts: partial.ts ?? Date.now(),
      page: this.page,
      level: partial.level,
      type: partial.type,
      message: partial.message,
      meta: partial.meta,
    };
    this.events = [event, ...this.events].slice(0, MAX_EVENTS);
    this.persist();
    this.emit();
    return event;
  }

  clear() {
    this.events = [];
    this.persist();
    this.emit();
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch {}
  }

  private emit() {
    for (const fn of this.listeners) fn(this.events);
  }
}

export const audit = new AuditStore();

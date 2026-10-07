"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { runAgentStream } from "@/lib/agentClient";

type Column = { original: string; name: string; type: string };

type SemanticContext = {
  entity?: string;
  description?: string;
  columns?: Record<string, string>;
};

type Insight = {
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence?: string[];
  recommendedAction?: string;
};

type Dataset = {
  id: string;
  fileName: string;
  tableName: string;
  rowCount: number;
  columns: Column[];
  status: "UPLOADING" | "ANALYZING" | "READY" | "FAILED";
  error?: string | null;
  context?: { context: SemanticContext } | null;
};

type AgentSection = {
  id: string;
  title: string;
  body: string;
  kind: "finding" | "evidence" | "action" | "roadmap" | "research" | "other";
};

type AgentMode = "initial_analysis" | "chat";

const statusLabel: Record<Dataset["status"], string> = {
  UPLOADING: "Uploading",
  ANALYZING: "Understanding",
  READY: "Ready",
  FAILED: "Needs attention",
};

const MAX_CARD_CHARS = 330;

function parseAgentSections(text: string): AgentSection[] {
  if (!text?.trim()) return [];

  const normalized = text.replace(/\r\n/g, "\n").trim();
  const matches = [
    ...normalized.matchAll(/(?:^|\n)\s*#{1,6}\s*([^\n#]+?)\s*(?=\n|$)/g),
  ];

  if (!matches.length) {
    return [{ id: "response", title: "HelperX response", body: normalized, kind: "other" }];
  }

  const sections: AgentSection[] = [];

  matches.forEach((match, index) => {
    const title = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index ?? normalized.length
        : normalized.length;
    const body = normalized.slice(start, end).trim();

    if (!body) return;

    const lower = title.toLowerCase();
    let kind: AgentSection["kind"] = "other";
    if (lower.includes("finding") || lower.includes("insight") || lower.includes("signal")) kind = "finding";
    else if (lower.includes("evidence") || lower.includes("data") || lower.includes("why")) kind = "evidence";
    else if (lower.includes("recommend") || lower.includes("next") || lower.includes("action") || lower.includes("tip")) kind = "action";
    else if (lower.includes("roadmap") || lower.includes("plan")) kind = "roadmap";
    else if (lower.includes("research") || lower.includes("market")) kind = "research";

    sections.push({ id: `${index}-${title}`, title, body, kind });
  });

  return sections.length
    ? sections
    : [{ id: "response", title: "HelperX response", body: normalized, kind: "other" }];
}

function compactText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CARD_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_CARD_CHARS).trimEnd()}…`, truncated: true };
}

export default function DashboardPage() {
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentRequest, setAgentRequest] = useState<string>("");
  const [agentMessage, setAgentMessage] = useState<string>("");
  const [latestMode, setLatestMode] = useState<AgentMode | null>(null);
  const [logbookEntries, setLogbookEntries] = useState<string[]>([]);
  const [logbookPrompt, setLogbookPrompt] = useState<boolean>(false);
  const [savingToLogbook, setSavingToLogbook] = useState<boolean>(false);
  const [savedToLogbookAt, setSavedToLogbookAt] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    try {
      const response = await fetch("/api/datasets", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load datasets");
      }

      setDatasets(data.datasets);
      setSelectedId((current) =>
        current && data.datasets.some((dataset: Dataset) => dataset.id === current)
          ? current
          : data.datasets[0]?.id ?? null,
      );
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDatasets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDatasets]);

  useEffect(() => {
    const working = datasets.some(
      (dataset) => dataset.status === "ANALYZING" || dataset.status === "UPLOADING",
    );

    if (!working) return;

    const timer = window.setInterval(() => void loadDatasets(), 4000);
    return () => window.clearInterval(timer);
  }, [datasets, loadDatasets]);

  const readyDatasets = useMemo(
    () => datasets.filter((dataset) => dataset.status === "READY"),
    [datasets],
  );

  const selected = datasets.find((dataset) => dataset.id === selectedId) ?? null;
  const detailsDataset = datasets.find((dataset) => dataset.id === detailsId) ?? null;
  const totalRows = datasets.reduce((total, dataset) => total + dataset.rowCount, 0);
  const sections = useMemo(() => parseAgentSections(agentMessage), [agentMessage]);

  /*
   * The agent receives whatever datasets exist. No READY gate — the user
   * can ask questions even with empty context.
   */
  async function runAgent(mode: AgentMode) {
    if (agentLoading) return;

    const message = mode === "chat" ? agentRequest.trim() : undefined;
    if (mode === "chat" && !message) return;

    setAgentLoading(true);

    try {
      const data = await runAgentStream({ mode, message });

      setAgentMessage(data.response ?? "");
      setLatestMode(mode);

      if (mode === "chat") {
        setAgentRequest("");
        setLogbookPrompt(true);
      } else {
        setLogbookPrompt(false);
      }
    } catch (error) {
      setAgentMessage(
        error instanceof Error ? error.message : "HelperX could not complete the analysis.",
      );
      setLatestMode(mode);
    } finally {
      setAgentLoading(false);
    }
  }

  /*
   * Agents only run on explicit user action. No automatic analysis on
   * mount, dataset creation, or status change.
   */

  async function reanalyse(dataset: Dataset) {
    if (dataset.status !== "FAILED") return;

    setAgentMessage("");
    setLatestMode(null);
    setLogbookPrompt(false);

    setDatasets((current) =>
      current.map((item) =>
        item.id === dataset.id ? { ...item, status: "ANALYZING", error: null } : item,
      ),
    );

    try {
      const response = await fetch(`/api/datasets/${dataset.id}/analyze?force=true`, {
        method: "POST",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Re-analysis failed");
      }

      await loadDatasets();
    } catch (error) {
      setAgentMessage(error instanceof Error ? error.message : "Re-analysis failed.");
      await loadDatasets();
    }
  }

  function addToLogbook() {
    if (!agentMessage.trim()) return;

    setLogbookEntries((entries) => [...entries, agentMessage.trim()]);
    setLogbookPrompt(false);
  }

  async function deleteDataset(id: string) {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/datasets/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${response.status})`);
      }
      setDatasets((current) => current.filter((d) => d.id !== id));
      if (selectedId === id) setSelectedId(null);
      if (detailsId === id) setDetailsId(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function saveAgentReplyToLogbook() {
    if (!agentMessage.trim() || savingToLogbook) return;

    setSavingToLogbook(true);
    try {
      const today = new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const primary = sections[0]?.title ?? "Agent response";

      await fetch("/api/logbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: latestMode === "initial_analysis" ? "ANALYSIS" : "INSIGHT",
          title: `${primary} · ${today}`,
          summary: agentMessage.trim(),
          evidence: {
            source: "dashboard",
            mode: latestMode ?? "chat",
            sectionCount: sections.length,
            readyDatasets: readyDatasets.map((dataset) => ({
              id: dataset.id,
              fileName: dataset.fileName,
            })),
          },
          datasetIds: readyDatasets.map((dataset) => dataset.id),
        }),
      });

      setSavedToLogbookAt(Date.now());
      setLogbookPrompt(false);
    } finally {
      setSavingToLogbook(false);
    }
  }

  return (
    <main className="dash-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="dash-header">
        <button type="button" onClick={() => router.push("/")} className="dash-brand">
          <svg className="h-6 w-6" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="11.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5" />
            <path d="M13 6.6 7.4 16.2M13 6.6l5.6 9.6M7.4 16.2h11.2" stroke="currentColor" strokeWidth="1.1" fill="none" opacity=".8" />
            <circle cx="13" cy="6.6" r="2.1" fill="currentColor" />
            <circle cx="7.4" cy="16.2" r="2.1" fill="currentColor" />
            <circle cx="18.6" cy="16.2" r="2.1" fill="currentColor" />
          </svg>
          <span className="serif text-lg font-medium">HelperX</span>
          <span className="mono ml-2 hidden text-[10px] tracking-[.14em] text-[var(--ink-3)] sm:inline">
            / workspace
          </span>
        </button>

        <div className="dash-header-actions">
          <span className="mono hidden text-[10px] tracking-[.14em] text-[var(--ink-3)] lg:inline">
            STEP 02 OF 03 · AI GROWTH
          </span>
        </div>
      </header>

      {/* =====================================================
          BENTO GRID — every tile is a grid area
      ===================================================== */}
      <div className="bento">
        {/* HERO */}
        <section className="tile t-hero">
          <p className="kicker">AI Growth Strategist</p>
          <h1 className="serif">
            Your business, <em>understood</em>.
          </h1>
          <p className="dash-hero-copy">
            One shared context for your datasets, historical decisions, and current market signals.
          </p>
          <span className="hero-badge">ALL DATASETS</span>
        </section>

        {/* STATS */}
        <section className="tile t-stats" aria-label="Workspace stats">
          <div className="stat">
            <span>Datasets</span>
            <strong>{datasets.length}</strong>
          </div>
          <div className="stat">
            <span>Ready</span>
            <strong>{readyDatasets.length}</strong>
          </div>
          <div className="stat wide">
            <span>Total rows</span>
            <strong>{totalRows.toLocaleString()}</strong>
          </div>
        </section>

        {/* DATASETS */}
        <aside className="tile t-datasets" aria-label="Datasets">
          <div className="rail-head">
            <span className="rail-title">Datasets</span>
            <span className="rail-count">{datasets.length}</span>
          </div>

          <p className="rail-note">Every uploaded CSV becomes part of the shared agent context.</p>

          {loading && <p className="rail-loading">Loading workspace…</p>}

          {!loading && datasets.length === 0 && (
            <div className="rail-empty">No datasets yet. Add a CSV to begin.</div>
          )}

          <ul className="dataset-list">
            {datasets.map((dataset) => {
              const active = dataset.id === selectedId;
              const statusKey =
                dataset.status === "READY" ? "ready" : dataset.status === "FAILED" ? "failed" : "working";

              return (
                <li key={dataset.id}>
                  <div className={`dataset-item ${active ? "active" : ""}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(dataset.id)}
                      className="dataset-select"
                      title={`Use ${dataset.fileName} in the inspector`}
                    >
                      <span className="name block truncate">{dataset.fileName}</span>
                      <span className="meta">
                        <span>{dataset.rowCount.toLocaleString()} rows</span>
                        <span className="sep" />
                        <span>{dataset.columns.length} cols</span>
                      </span>
                    </button>

                    <span className={`dataset-status ${statusKey}`}>
                      <span className="dot" aria-hidden="true" />
                      {statusLabel[dataset.status]}
                    </span>

                    <div className="dataset-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(dataset.id);
                          setDetailsId(dataset.id);
                        }}
                        className="dataset-action"
                      >
                        Details
                      </button>

                      {dataset.status === "FAILED" && (
                        <button
                          type="button"
                          onClick={() => void reanalyse(dataset)}
                          className="dataset-action"
                        >
                          Re-analyse
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          const confirmed = window.confirm(
                            `Delete ${dataset.fileName}? This will remove its data table and any analysis.`,
                          );
                          if (confirmed) void deleteDataset(dataset.id);
                        }}
                        disabled={deletingId === dataset.id}
                        className="dataset-action danger"
                      >
                        {deletingId === dataset.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <button type="button" onClick={() => router.push("/upload")} className="add-csv">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            Add another CSV
          </button>
        </aside>

        {/* SIGNAL */}
        <section className="tile t-signal">
          <div className="section-caption-row">
            <div>
              <span className="section-kicker">Today&apos;s signal</span>
              <h2 className="serif section-title">
                {agentLoading ? "Research in progress" : sections.length ? "Tips to upscale" : "Intelligence"}
              </h2>
            </div>

            <span className={`state-flag ${agentLoading ? "working" : ""}`}>
              <span className="dot" aria-hidden="true" />
              {agentLoading ? "Working" : "Updates"}
            </span>
          </div>

          {agentLoading ? (
            <div className="working-stage">
              <div className="working-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 3.5h9l5 5v12H5z" />
                  <path d="M14 3.5V9h5" />
                  <path d="m12.4 17.6 4.3-4.3 1.6 1.6-4.3 4.3-2 .4.4-2z" />
                </svg>
              </div>

              <div className="working-copy">
                <h3 className="serif">Agent is working on your dataset</h3>
                <p>
                  It is reading the shared datasets and gathering relevant market context. Your first
                  actionable signals will appear here when the research is complete.
                </p>
                <div className="working-ticks" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          ) : sections.length ? (
            <div className="tip-grid">
              {sections.slice(0, 3).map((section, index) => {
                const compact = compactText(section.body);

                return (
                  <article key={section.id} className={`tip-card tip-${index + 1}`}>
                    <span className="tip-no">TIP {String(index + 1).padStart(2, "0")}</span>
                    <h3 className="serif">{section.title}</h3>
                    <p>{compact.text}</p>

                    {compact.truncated && (
                      <button
                        type="button"
                        className="view-details"
                        onClick={() => setDetailsId(`agent:${section.id}`)}
                      >
                        View details →
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-signal">
              <span className="empty-glyph" aria-hidden="true">⌁</span>
              <div>
                <strong>No actionable signal yet.</strong>
                <p>Ask HelperX a specific business question below to start an investigation.</p>
              </div>
            </div>
          )}
        </section>

        {/* AGENT */}
        <section className="tile t-agent">
          <div className="section-caption-row">
            <div>
              <span className="section-kicker">Ask HelperX</span>
              <h2 className="serif section-title">Work with the agent.</h2>
            </div>
            <span className="section-side">
              {datasets.length} dataset{datasets.length === 1 ? "" : "s"} · shared context
            </span>
          </div>

          {agentMessage && !agentLoading && latestMode === "chat" ? (
            <>
              <div className="answer-stack">
                {sections.slice(0, 3).map((section, index) => {
                  const compact = compactText(section.body);

                  return (
                    <article
                      key={section.id}
                      className={`answer-card ${index === 0 ? "lead" : ""} ${section.kind === "roadmap" ? "roadmap" : ""}`}
                    >
                      <span className="answer-kicker">
                        {index === 0 ? "HelperX's answer" : section.kind === "roadmap" ? "Roadmap" : section.kind}
                      </span>
                      <h3 className="serif">{section.title}</h3>
                      <p>{compact.text}</p>

                      {compact.truncated && (
                        <button
                          type="button"
                          className="view-details"
                          onClick={() => setDetailsId(`agent:${section.id}`)}
                        >
                          View details →
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>

              {agentMessage && !agentLoading && (
                <div className="logbook-save-row">
                  <button
                    type="button"
                    onClick={() => void saveAgentReplyToLogbook()}
                    disabled={savingToLogbook}
                    className="logbook-save-btn"
                  >
                    {savingToLogbook
                      ? "Saving…"
                      : savedToLogbookAt
                        ? "Saved to today's logbook ✓"
                        : "Save today's content to logbook"}
                  </button>
                </div>
              )}

              {logbookPrompt && (
                <div className="logbook-question">
                  <span>Can I enter this in the logbook?</span>
                  <button type="button" onClick={addToLogbook}>Yes</button>
                  <button type="button" onClick={() => setLogbookPrompt(false)}>No</button>
                </div>
              )}
            </>
          ) : (
            <div className="chat-placeholder">
              <p>
                {agentLoading
                  ? "HelperX is working through your shared business context…"
                  : datasets.length
                    ? "Ask a question about your business. HelperX will use every uploaded dataset as context."
                    : "Ask HelperX anything. Upload a CSV any time to add context."}
              </p>
            </div>
          )}

          <div className="agent-input">
            <span className="agent-input-label">Agent search</span>

            <input
              value={agentRequest}
              onChange={(event) => setAgentRequest(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runAgent("chat");
              }}
              disabled={agentLoading}
              placeholder={
                datasets.length
                  ? "Ask HelperX anything about your business…"
                  : "Ask HelperX anything — datasets give it context."
              }
            />

            <button
              type="button"
              onClick={() => void runAgent("chat")}
              disabled={!agentRequest.trim() || agentLoading}
              className="agent-send"
              aria-label="Send message"
            >
              {agentLoading ? "…" : "→"}
            </button>
          </div>

          <p className="agent-footnote">
            HelperX will read ALL ready datasets · research is used when available
          </p>
        </section>

        {/* INSPECTOR */}
        <aside className="tile t-inspector dataset-inspector" aria-label="Dataset inspector">
          {selected ? (
            <DatasetInspector dataset={selected} />
          ) : (
            <div className="inspector-empty">
              <div className="inspector-icon">▤</div>
              <span className="inspector-kicker">Dataset inspector</span>
              <h2 className="serif">Explore a dataset.</h2>
              <p>
                Click <strong>Details</strong> under any CSV to inspect its semantic context and data.
              </p>
              <span className="inspector-footnote">The agent&apos;s context does not change</span>
            </div>
          )}
        </aside>

        {/* LOGBOOK */}
        <section className="tile t-logbook">
          <div className="section-caption-row">
            <div>
              <span className="section-kicker">Persistent memory</span>
              <h2 className="serif section-title">Log book</h2>
            </div>
            <span className="section-side">Old entry</span>
          </div>

          {logbookEntries.length ? (
            <div className="logbook-list">
              {logbookEntries.slice(-3).map((entry, index) => (
                <article key={`${entry}-${index}`} className="logbook-entry">
                  <span className="logbook-index">{String(index + 1).padStart(2, "0")}</span>
                  <p>{entry}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="logbook-empty">
              <span className="logbook-index">01</span>
              <div>
                <strong>No previous entries.</strong>
                <p>
                  Important findings, decisions, and research from future investigations will appear here.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* MODALS — unchanged conditions */}

      {detailsId?.startsWith("agent:") && (
        <AgentDetailsModal
          sections={sections}
          id={detailsId.slice("agent:".length)}
          onClose={() => setDetailsId(null)}
        />
      )}

      {detailsDataset && !detailsId?.startsWith("agent:") && (
        <DatasetDetailsModal dataset={detailsDataset} onClose={() => setDetailsId(null)} />
      )}

      <style jsx global>{`
        .dash-page {
          background-image: radial-gradient(rgba(70, 60, 45, 0.055) 1px, transparent 1px);
          background-size: 24px 24px;
        }

        /* HEADER */
        .dash-header {
          position: sticky; top: 0; z-index: 40;
          display: flex; height: 64px; align-items: center; justify-content: space-between;
          padding: 0 20px;
          border-bottom: 1.5px solid var(--line-2);
          background: rgba(245, 243, 237, 0.9);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        }
        @media (min-width: 640px) { .dash-header { padding: 0 24px; } }
        .dash-brand {
          display: flex; align-items: center; gap: 8px;
          border: 0; background: transparent; color: var(--sage-deep); cursor: pointer; padding: 0;
        }
        .dash-header-actions { display: flex; align-items: center; gap: 10px; }

        /* BENTO GRID */
        .bento {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          grid-template-areas:
            "hero      hero    stats"
            "datasets  signal  signal"
            "datasets  agent   agent"
            "inspector agent   agent"
            "inspector logbook logbook";
          gap: 14px;
          width: min(1240px, calc(100vw - 36px));
          margin: 0 auto;
          padding: 22px 0 42px;
        }
        .tile {
          min-width: 0;
          overflow: hidden;
          padding: 18px;
          border: 1.5px solid var(--line-2);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.72);
          box-shadow: 0 2px 10px rgba(45, 40, 32, 0.04);
        }
        .t-hero { grid-area: hero; display: flex; flex-direction: column; justify-content: center;
          background: rgba(217, 226, 207, 0.4); border-color: var(--sage-deep); padding: 26px; }
        .t-stats { grid-area: stats; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-content: stretch; }
        .t-datasets { grid-area: datasets; }
        .t-signal { grid-area: signal; }
        .t-agent { grid-area: agent; }
        .t-inspector { grid-area: inspector; border-style: dashed; background: rgba(255, 255, 255, 0.5); }
        .t-logbook { grid-area: logbook; }

        @media (max-width: 960px) {
          .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: none; }
          .t-hero, .t-signal, .t-agent, .t-logbook { grid-area: auto; grid-column: 1 / -1; }
          .t-stats, .t-datasets, .t-inspector { grid-area: auto; }
          .t-datasets, .t-inspector { grid-column: span 1; }
        }
        @media (max-width: 640px) {
          .bento { grid-template-columns: 1fr; width: min(100% - 24px, 620px); }
          .t-stats, .t-datasets, .t-inspector { grid-column: 1 / -1; }
          .tip-grid, .answer-stack { grid-template-columns: 1fr !important; }
          .working-stage { flex-direction: column; }
          .agent-input-label { display: none; }
          .modal-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .modal-schema-row { grid-template-columns: 1fr !important; gap: 5px !important; }
        }

        /* HERO + STATS */
        .t-hero h1 { margin: 2px 0 10px; font-size: clamp(30px, 3.4vw, 48px); line-height: 0.98; letter-spacing: -0.035em; }
        .t-hero h1 em { color: var(--clay-deep); }
        .dash-hero-copy { max-width: 520px; margin: 0; color: var(--ink-2); font-size: 12px; line-height: 1.55; }
        .hero-badge {
          align-self: flex-start; margin-top: 14px; padding: 5px 10px;
          border: 1px dashed var(--line-2); border-radius: 999px;
          font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.13em; color: var(--sage-deep);
        }
        .stat { display: flex; flex-direction: column; justify-content: center; padding: 12px; border: 1px solid var(--line-2); border-radius: 14px; background: rgba(250, 248, 243, 0.78); }
        .stat.wide { grid-column: 1 / -1; }
        .stat span { font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); }
        .stat strong { margin-top: 4px; font-family: var(--serif, Georgia, serif); font-size: 28px; font-weight: 500; line-height: 1; }

        /* SHARED HEADINGS */
        .rail-head, .section-caption-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .rail-title { font-family: var(--serif, Georgia, serif); font-size: 17px; font-weight: 500; line-height: 1.05; }
        .section-title { margin: 3px 0 0; font-size: 19px; line-height: 1.05; font-weight: 500; }
        .section-kicker, .answer-kicker { font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--clay-deep); }
        .section-side { margin-top: 4px; font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--ink-3); }
        .rail-count { display: inline-flex; min-width: 20px; height: 20px; align-items: center; justify-content: center; border: 1px solid var(--line-2); border-radius: 999px; font-family: var(--mono, monospace); font-size: 9px; color: var(--ink-3); }
        .rail-note { margin: 8px 0 12px; font-family: var(--mono, monospace); font-size: 8px; line-height: 1.5; letter-spacing: 0.05em; color: var(--ink-3); }
        .rail-loading { margin: 0; font-size: 12px; color: var(--ink-3); }
        .rail-empty { padding: 12px; border: 1.5px dashed var(--line-2); border-radius: 12px; background: rgba(250, 248, 243, 0.7); font-size: 11px; line-height: 1.5; color: var(--ink-2); }

        /* DATASET LIST */
        .dataset-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .dataset-item { padding: 10px; border: 1.5px solid var(--line-2); border-radius: 14px; background: rgba(255, 255, 255, 0.55); transition: border-color 150ms ease, background 150ms ease; }
        .dataset-item:hover, .dataset-item.active { border-color: var(--clay-deep); background: rgba(255, 255, 255, 0.8); }
        .dataset-item.active { box-shadow: inset 3px 0 0 var(--clay-deep); }
        .dataset-select { display: block; width: 100%; min-width: 0; border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; }
        .dataset-item .name { font-size: 10.5px; line-height: 1.3; color: var(--ink); font-weight: 500; }
        .dataset-item .meta { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-family: var(--mono, monospace); font-size: 7.5px; letter-spacing: 0.04em; color: var(--ink-3); }
        .dataset-item .meta .sep { width: 2px; height: 2px; border-radius: 50%; background: currentColor; }
        .dataset-status { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; font-family: var(--mono, monospace); font-size: 7px; text-transform: uppercase; letter-spacing: 0.07em; }
        .dataset-status .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
        .dataset-status.ready { color: var(--sage-deep); }
        .dataset-status.working { color: #a18b65; }
        .dataset-status.failed { color: var(--clay-deep); }
        .dataset-actions { display: flex; gap: 6px; margin-top: 10px; }
        .dataset-action { flex: 1; min-width: 0; padding: 5px 6px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--paper); color: var(--ink-2); cursor: pointer; font-family: var(--mono, monospace); font-size: 7.5px; line-height: 1; text-transform: lowercase; transition: border-color 150ms ease, color 150ms ease, background 150ms ease; }
        .dataset-action:hover { border-color: var(--clay-deep); color: var(--clay-deep); background: rgba(255, 255, 255, 0.7); }
        .dataset-action:disabled { cursor: not-allowed; opacity: 0.5; }
        .dataset-action.danger { color: var(--clay-deep); }
        .dataset-action.danger:hover { color: #fff9f5; background: var(--clay-deep); }
        .add-csv { display: flex; width: 100%; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; padding: 9px 10px; border: 1.5px dashed var(--clay-deep); border-radius: 999px; background: transparent; color: var(--clay-deep); cursor: pointer; font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.06em; transition: background 150ms ease; }
        .add-csv:hover { background: rgba(255, 255, 255, 0.5); }

        /* SIGNAL */
        .state-flag { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
        .state-flag .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
        .state-flag.working { color: #a18b65; }
        .state-flag.working .dot { animation: flag-pulse 1.4s ease-in-out infinite; }
        @keyframes flag-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

        .working-stage { display: flex; align-items: flex-start; gap: 16px; margin-top: 14px; padding: 22px 20px; border: 1.5px dashed var(--line-2); border-radius: 14px; background: rgba(250, 248, 243, 0.75); }
        .working-mark { display: flex; width: 58px; height: 58px; flex-shrink: 0; align-items: center; justify-content: center; border: 1.5px dashed var(--clay-deep); border-radius: 50%; background: rgba(255, 255, 255, 0.7); color: var(--clay-deep); animation: sketch-breathe 2.6s ease-in-out infinite; }
        @keyframes sketch-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
        .working-copy { min-width: 0; }
        .working-copy h3 { margin: 0 0 8px; font-size: 22px; line-height: 1.08; letter-spacing: -0.015em; font-weight: 500; }
        .working-copy p { margin: 0; max-width: 560px; color: var(--ink-2); font-size: 10.5px; line-height: 1.6; }
        .working-ticks { display: flex; gap: 5px; margin-top: 14px; }
        .working-ticks i { width: 24px; height: 3px; border-radius: 2px; background: var(--line-2); animation: tick-pulse 1.5s ease-in-out infinite; }
        .working-ticks i:nth-child(2) { animation-delay: 0.18s; }
        .working-ticks i:nth-child(3) { animation-delay: 0.36s; }
        @keyframes tick-pulse { 0%, 100% { background: var(--line-2); } 50% { background: var(--clay-deep); } }

        .tip-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
        .tip-card { display: flex; min-height: 168px; flex-direction: column; padding: 14px 13px 12px; border: 1.5px solid var(--line-2); border-radius: 14px; background: rgba(255, 255, 255, 0.78); transition: border-color 160ms ease; }
        .tip-card:hover { border-color: var(--clay-deep); }
        .tip-no { align-self: flex-start; margin-bottom: 10px; padding: 4px 9px; border: 1px dashed var(--clay-deep); border-radius: 7px; color: var(--clay-deep); font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.15em; }
        .tip-card h3 { margin: 0 0 7px; font-size: 16px; line-height: 1.1; font-weight: 500; }
        .tip-card p { margin: 0; flex: 1; color: var(--ink-2); font-size: 10px; line-height: 1.6; white-space: pre-line; }
        .view-details { align-self: flex-start; margin-top: 10px; padding: 0; border: 0; background: transparent; color: var(--clay-deep); cursor: pointer; font-family: var(--mono, monospace); font-size: 8px; letter-spacing: 0.04em; }
        .view-details:hover { text-decoration: underline; }

        .empty-signal, .logbook-empty { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px; padding: 16px; border: 1.5px dashed var(--line-2); border-radius: 12px; background: rgba(250, 248, 243, 0.72); }
        .empty-glyph { font-size: 16px; color: var(--ink-3); line-height: 1; }
        .empty-signal strong, .logbook-empty strong { display: block; font-size: 11px; font-weight: 500; }
        .empty-signal p, .logbook-empty p { margin: 4px 0 0; color: var(--ink-2); font-size: 9.5px; line-height: 1.55; }

        /* LOGBOOK */
        .logbook-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .logbook-entry { display: flex; gap: 10px; padding: 11px; border: 1px solid var(--line-2); border-radius: 12px; background: rgba(250, 248, 243, 0.65); }
        .logbook-entry p { margin: 0; color: var(--ink-2); font-size: 9.5px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .logbook-index { display: flex; flex: 0 0 auto; width: 22px; height: 22px; align-items: center; justify-content: center; border: 1px solid var(--line-2); border-radius: 50%; font-family: var(--mono, monospace); font-size: 7.5px; color: var(--ink-3); }

        /* AGENT */
        .answer-stack { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin-top: 14px; }
        .answer-card { min-width: 0; min-height: 120px; padding: 13px; border: 1.5px solid var(--line-2); border-radius: 14px; background: rgba(252, 250, 246, 0.82); }
        .answer-card.lead { grid-column: 1 / -1; border-color: var(--sage-deep); background: rgba(217, 226, 207, 0.3); }
        .answer-card.roadmap { border-style: dashed; }
        .answer-card.roadmap .answer-kicker { color: var(--sage-deep); }
        .answer-kicker { display: inline-block; margin-bottom: 9px; }
        .answer-card h3 { margin: 0 0 7px; font-size: 17px; line-height: 1.1; font-weight: 500; }
        .answer-card p { margin: 0; color: var(--ink-2); font-size: 10px; line-height: 1.6; white-space: pre-line; }
        .chat-placeholder { margin-top: 12px; padding: 14px 15px; border: 1.5px dashed var(--line-2); border-radius: 12px; color: var(--ink-3); font-size: 9.5px; line-height: 1.55; }
        .chat-placeholder p { margin: 0; }
        .logbook-save-row { display: flex; justify-content: flex-end; margin-top: 12px; }
        .logbook-save-btn { padding: 9px 16px; border: 1.5px solid var(--sage-deep); border-radius: 999px; background: var(--sage-deep); color: #f4f2e9; cursor: pointer; font-family: var(--mono, monospace); font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; transition: background 150ms ease, transform 150ms ease; }
        .logbook-save-btn:hover:not(:disabled) { background: #28392e; transform: translateY(-1px); }
        .logbook-save-btn:disabled { cursor: not-allowed; opacity: 0.7; }
        .logbook-question { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--line-2); border-radius: 10px; font-family: var(--mono, monospace); font-size: 7.5px; letter-spacing: 0.03em; color: var(--ink-2); }
        .logbook-question span { margin-right: auto; }
        .logbook-question button { min-width: 38px; padding: 5px 8px; border: 1px solid var(--line-2); border-radius: 999px; background: transparent; cursor: pointer; font-family: var(--mono, monospace); font-size: 7.5px; transition: border-color 150ms ease, color 150ms ease; }
        .logbook-question button:first-of-type:hover { border-color: var(--sage-deep); color: var(--sage-deep); }
        .logbook-question button:last-of-type:hover { border-color: var(--clay-deep); color: var(--clay-deep); }

        .agent-input { display: flex; align-items: center; gap: 8px; margin-top: 13px; padding: 5px; border: 1.5px solid var(--line-2); border-radius: 16px; background: rgba(255, 255, 255, 0.85); }
        .agent-input:focus-within { border-color: var(--clay-deep); }
        .agent-input-label { flex-shrink: 0; padding: 0 10px 0 8px; border-right: 1px dashed var(--line-2); font-family: var(--mono, monospace); font-size: 7.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); white-space: nowrap; }
        .agent-input input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; padding: 8px 6px; color: var(--ink); font-size: 10.5px; }
        .agent-input input::placeholder { color: var(--ink-3); }
        .agent-send { display: flex; flex: 0 0 auto; width: 32px; height: 32px; align-items: center; justify-content: center; border: 0; border-radius: 50%; background: var(--clay-deep); color: #fff; cursor: pointer; font-size: 14px; line-height: 1; transition: transform 150ms ease; }
        .agent-send:hover:not(:disabled) { transform: translateY(-1px); }
        .agent-send:disabled { cursor: not-allowed; opacity: 0.4; }
        .agent-footnote { margin: 11px 0 0; text-align: center; font-family: var(--mono, monospace); font-size: 7.5px; letter-spacing: 0.11em; color: var(--ink-3); }

        /* INSPECTOR */
        .inspector-empty { display: flex; min-height: 280px; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center; }
        .inspector-icon { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; margin-bottom: 12px; border: 1px dashed var(--line-2); border-radius: 50%; background: rgba(250, 248, 243, 0.9); color: var(--ink-3); font-size: 13px; }
        .inspector-kicker { font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); }
        .inspector-empty h2, .inspector-content h2 { margin: 7px 0 8px; font-family: var(--serif, Georgia, serif); font-size: 20px; font-weight: 500; line-height: 1.05; }
        .inspector-empty p { max-width: 210px; margin: 0; color: var(--ink-2); font-size: 9.5px; line-height: 1.55; }
        .inspector-empty p strong { color: var(--clay-deep); }
        .inspector-footnote { margin-top: 18px; font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.11em; color: var(--ink-3); }
        .inspector-content > .inspector-icon { margin-top: 14px; }
        .inspector-status { margin: 10px 0 0; font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.13em; color: var(--clay-deep); }
        .inspector-lede { margin: 0; color: var(--ink-2); font-size: 9.5px; line-height: 1.55; }
        .inspector-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin-top: 14px; }
        .inspector-metrics > div { padding: 9px 10px; border: 1px solid var(--line-2); border-radius: 12px; background: rgba(250, 248, 243, 0.78); }
        .inspector-metrics span, .modal-stats span { display: block; font-family: var(--mono, monospace); font-size: 7px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--ink-3); }
        .inspector-metrics strong, .modal-stats strong { display: block; margin-top: 4px; font-size: 12px; font-weight: 500; }
        .inspector-columns { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }
        .inspector-columns-label { font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.13em; color: var(--ink-3); }
        .inspector-column { padding: 9px; border-bottom: 1px solid var(--line); }
        .inspector-column > div { display: flex; align-items: baseline; justify-content: space-between; gap: 5px; }
        .inspector-column strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 9.5px; font-weight: 500; }
        .inspector-column span { flex: 0 0 auto; font-family: var(--mono, monospace); font-size: 7px; color: var(--ink-3); }
        .inspector-column p { margin: 4px 0 0; color: var(--ink-3); font-size: 8px; line-height: 1.45; }

        /* MODALS */
        .modal-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(37, 33, 27, 0.3); backdrop-filter: blur(4px); }
        .details-modal { width: min(760px, 100%); max-height: min(82vh, 760px); overflow: hidden; border: 1.5px solid var(--line-2); border-radius: 22px; background: var(--paper); box-shadow: 0 20px 70px rgba(35, 30, 24, 0.22); }
        .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; padding: 19px 20px 14px; border-bottom: 1px solid var(--line); }
        .modal-head-kicker { font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--clay-deep); }
        .modal-head h2 { margin: 5px 0 0; font-family: var(--serif, Georgia, serif); font-size: 25px; font-weight: 500; line-height: 1.05; }
        .modal-close { display: flex; width: 30px; height: 30px; align-items: center; justify-content: center; border: 1px solid var(--line-2); border-radius: 50%; background: transparent; color: var(--ink-2); cursor: pointer; font-size: 18px; line-height: 1; transition: border-color 150ms ease, color 150ms ease; }
        .modal-close:hover { border-color: var(--clay-deep); color: var(--clay-deep); }
        .details-modal > .lede { margin: 0; padding: 14px 20px; color: var(--ink-2); font-size: 10.5px; line-height: 1.6; }
        .modal-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 0 20px 14px; }
        .modal-stats > div { padding: 10px; border: 1px solid var(--line-2); border-radius: 12px; }
        .modal-schema { max-height: 47vh; overflow: auto; border-top: 1px solid var(--line); padding: 11px 20px 20px; }
        .modal-schema-row { display: grid; grid-template-columns: minmax(130px, 1fr) 2fr; gap: 15px; padding: 10px 0; border-bottom: 1px solid var(--line); }
        .modal-schema-row > div { display: flex; flex-direction: column; gap: 3px; }
        .modal-schema-row strong { font-size: 9.5px; font-weight: 500; }
        .modal-schema-row span { font-family: var(--mono, monospace); font-size: 7px; color: var(--ink-3); }
        .modal-schema-row p { margin: 0; color: var(--ink-2); font-size: 9px; line-height: 1.5; }
        .agent-details-modal { max-width: 820px; }
        .full-agent-section { max-height: 66vh; overflow: auto; padding: 18px 20px 22px; color: var(--ink-2); font-size: 10.5px; line-height: 1.7; }
        .full-agent-kicker { font-family: var(--mono, monospace); font-size: 8px; text-transform: uppercase; letter-spacing: 0.13em; color: var(--sage-deep); }
        .full-agent-section > div { margin-top: 11px; }
      `}</style>
    </main>
  );
}

/* =========================================================
   DATASET INSPECTOR — logic identical
========================================================= */

function DatasetInspector({ dataset }: { dataset: Dataset }) {
  const context = dataset.context?.context;

  return (
    <div className="inspector-content">
      <div className="rail-head">
        <span className="rail-title">Dataset inspector</span>
        <span className="mono text-[8px] tracking-[.1em] text-[var(--sage-deep)]">DETAILS</span>
      </div>

      <div className="inspector-icon">▤</div>

      <p className="inspector-status">{dataset.status}</p>

      <h2>{context?.entity ?? dataset.fileName}</h2>

      <p className="inspector-lede">
        {context?.description ??
          "Semantic understanding for this dataset will appear here after analysis."}
      </p>

      <div className="inspector-metrics">
        <div>
          <span>Rows</span>
          <strong>{dataset.rowCount.toLocaleString()}</strong>
        </div>
        <div>
          <span>Columns</span>
          <strong>{dataset.columns.length}</strong>
        </div>
      </div>

      <div className="inspector-columns">
        <span className="inspector-columns-label">Schema</span>

        {dataset.columns.slice(0, 12).map((column) => (
          <div key={column.name} className="inspector-column">
            <div>
              <strong>{column.name}</strong>
              <span>{column.type}</span>
            </div>
            <p>{context?.columns?.[column.name] ?? "No semantic description available yet."}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   DATASET DETAILS MODAL — logic identical
========================================================= */

function DatasetDetailsModal({
  dataset,
  onClose,
}: {
  dataset: Dataset;
  onClose: () => void;
}) {
  const context = dataset.context?.context;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${dataset.fileName} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="modal-head-kicker">Dataset details</span>
            <h2>{context?.entity ?? dataset.fileName}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="lede">{context?.description ?? "No semantic description available yet."}</p>

        <div className="modal-stats">
          <div>
            <span>File</span>
            <strong>{dataset.fileName}</strong>
          </div>
          <div>
            <span>Rows</span>
            <strong>{dataset.rowCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Columns</span>
            <strong>{dataset.columns.length}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{statusLabel[dataset.status]}</strong>
          </div>
        </div>

        <div className="modal-schema">
          {dataset.columns.map((column) => (
            <div key={column.name} className="modal-schema-row">
              <div>
                <strong>{column.name}</strong>
                <span>{column.type}</span>
              </div>
              <p>{context?.columns?.[column.name] ?? "No semantic description available."}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   AGENT DETAILS MODAL — logic identical
========================================================= */

function AgentDetailsModal({
  sections,
  id,
  onClose,
}: {
  sections: AgentSection[];
  id: string;
  onClose: () => void;
}) {
  const section = sections.find((item) => item.id === id);

  if (!section) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="details-modal agent-details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${section.title} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="modal-head-kicker">Full analysis</span>
            <h2>{section.title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="full-agent-section">
          <span className="full-agent-kicker">{section.kind}</span>
          <div className="whitespace-pre-wrap">{section.body}</div>
        </div>
      </div>
    </div>
  );
}

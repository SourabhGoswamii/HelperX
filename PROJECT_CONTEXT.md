# Project Context — HelperX (razorpay)

> Generated on 2026-09-02. Snapshot of the project structure, stack, data flow, and key files at this point in time.

## 1. Overview

**HelperX** is an "AI merchant intelligence" web app. Merchants upload CSV exports (orders, customers, products, transactions, returns), the app ingests each file into a dynamically created SQLite table and saves the CSV under `file/`, uses an LLM (via OpenRouter) to build a *semantic understanding* of each dataset, and then a LangGraph agent answers business questions and records insights in a persistent logbook.

The repo sits in a folder named `razorpay` but the product is branded **HelperX**.

## 2. Tech Stack

| Area | Technology |
|---|---|
| Framework | Next.js 16.3.3 (App Router) + React 19.2.8 + TypeScript 5 |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`), plus heavy inline `<style>` blocks and inline styles per page |
| ORM / DB | Prisma ORM 7 (`@prisma/client` 7.10, `prisma` 7.10) with `@prisma/adapter-better-sqlite3` against local SQLite; raw SQL used for dynamic table creation/query |
| AI / Agents | `langchain` 1.5, `@langchain/langgraph` 1.4, `@langchain/openrouter` 0.4 (LLM calls), `zod` 4 (tool schemas), direct OpenRouter HTTP calls for the semantic analysis pass |
| Data parsing | `papaparse` 5.7 (CSV) |
| Linting | ESLint 9 + `eslint-config-next` |
| Fonts | `next/font` — Geist + Geist Mono (layout); pages define their own serif/sans/mono families inline |

## 3. Project Structure

```
razorpay/
├── app/                                # Next.js App Router
│   ├── api/
│   │   ├── agent/
│   │   │   └── tools/route.ts          # POST — generic tool-execution proxy (/api/agent/tools)
│   │   ├── analyze/route.ts           # POST /api/analyze — LLM semantic analysis of a dataset
│   │   ├── datasets/
│   │   │   ├── route.ts               # GET /api/datasets — list datasets (force-dynamic)
│   │   │   └── [id]/analyze/route.ts  # POST — run semantic pass for one dataset
│   │   └── upload/route.ts            # POST /api/upload — CSV → PG table + Dataset row
│   ├── generated/prisma/              # Generated Prisma client (browser + server entry points)
│   │   ├── browser.ts / client.ts / commonInputTypes.ts / enums.ts / models.ts
│   │   ├── internal/ (class, prismaNamespace, prismaNamespaceBrowser)
│   │   └── models/ (Dataset.ts, DatasetContext.ts, LogbookEntry.ts)
│   ├── agent-lab/page.tsx             # Tool playground: test each agent tool independently
│   ├── dashboard/page.tsx             # Workspace: dataset list, semantic view, agent chat box, intelligence sidebar
│   ├── upload/page.tsx                # CSV upload flow (queue, per-file confirm, worker pool)
│   ├── page.tsx                       # Marketing landing page (hero, data workspace mock, workflow)
│   ├── layout.tsx                     # Root layout (Geist fonts, metadata "HelperX")
│   ├── globals.css                    # Tailwind entry
│   └── favicon.ico
├── lib/
│   ├── db.ts                          # PrismaClient singleton with PrismaPg driver adapter
│   ├── agent/                         # EMPTY placeholder files (0 lines)
│   │   └── graph.ts, node.ts, state.ts  # intended LangGraph wiring — not implemented yet
│   ├── generated/prisma/              # Generated Prisma client (gitignored copy: /lib/generated/prisma)
│   │   └── ... (same shape as app/generated/prisma)
│   └── tools/                         # LangChain tool definitions (exported via index.ts)
│       ├── index.ts                   # Barrel: getDatasetContext, queryDataset, webSearch, getLogbook, writeLogbook
│       ├── get-dataset-context.ts     # get_dataset_context — READY datasets + their semantic context
│       ├── query-dataset.ts           # query_dataset — read-only row queries w/ SQL-injection guard
│       ├── web-search.ts              # web_search — Tavily search (needs TAVILY_API_KEY)
│       ├── get-logbook.ts             # get_logbook — read LogbookEntry rows
│       └── write-logbook.ts           # write_logbook — create LogbookEntry
├── prisma/
│   └── schema.prisma                  # Prisma schema (see §6); datasource has NO url (Prisma 7 config style)
├── public/                            # SVG assets (next/vercel/globe/file/window)
├── .agents/skills/, .claude/skills/, .windsurf/skills/   # ~6 duplicated Prisma skill packages for agent runners
├── .env                               # env vars (gitignored); template in sampleenv
├── sampleenv                          # Env template: OpenRouter and optional Tavily settings
├── AGENTS.md                          # Next.js agent rules (managed by `next dev`)
├── CLAUDE.md                          # Just imports @AGENTS.md
├── README.md                          # Default create-next-app README (+ stray "HelperX" footer line)
├── prisma7.config.ts                  # Prisma 7 config (schema, migrations path, datasource url)
├── next.config.ts                     # Empty/default (no options)
├── postcss.config.mjs / eslint.config.mjs / tsconfig.json
├── package.json / package-lock.json
├── skills-lock.json
└── .gitignore
```

## 4. Database Schema (`prisma/schema.prisma`)

- Generator: `prisma-client`, output `../app/generated/prisma`.
- Datasource: `provider = "sqlite"` using the local `prisma/dev.db` file.

```prisma
enum DatasetStatus { UPLOADING  ANALYZING  READY  FAILED }   // lifecycle of a dataset

model Dataset {
  id        String        @id @default(uuid())
  fileName  String        @map("file_name")
  tableName String        @unique @map("table_name")   // sanitized name + random suffix
  rowCount  Int           @default(0) @map("row_count")
  columns   Json                                       // Column[]: { original, name, type }
  status    DatasetStatus @default(UPLOADING)
  error     String?
  createdAt DateTime      @default(now()) @map("created_at")
  updatedAt DateTime      @updatedAt @map("updated_at")
  context   DatasetContext?                            // 1:1 optional
  @@map("datasets")
}

model DatasetContext {
  id        String   @id @default(uuid())
  datasetId String   @unique @map("dataset_id")
  context   Json     // semantic object: { table, entity, description, columns }
  createdAt / updatedAt
  dataset   Dataset  @relation(fields: [datasetId], references: [id], onDelete: Cascade)
  @@map("dataset_context")
}

enum LogbookEntryType { ANALYSIS  INSIGHT  DECISION  RESEARCH }

model LogbookEntry {
  id         String          @id @default(uuid())
  type       LogbookEntryType
  title      String
  summary    String
  evidence   Json?
  datasetIds Json?
  createdAt / updatedAt
  @@index([createdAt])
  @@index([type])
  @@map("logbook_entries")
}
```

Note: each uploaded CSV also materializes a real SQLite table named after the Dataset's `tableName`, with columns created from the parsed CSV (`"name" type`), and is saved under `file/`.

## 5. Data Flow (Upload → Analysis → Ask)

1. **Upload** (`/upload` page → `POST /api/upload`): client sends one CSV at a time (worker pool of 3). Server parses with PapaParse, sanitizes column names (`a-z0-9_`, dedupes with `_2` suffixes), detects per-column types (`TEXT | DOUBLE PRECISION | TIMESTAMP`), creates `Dataset` row (`UPLOADING`) + a real `CREATE TABLE`, inserts rows in batches of 500, then marks `ANALYZING`.
2. **Semantic pass** (detached by design — `void fetch()` from upload page): `POST /api/datasets/[id]/analyze` reads 5 sample rows, delegates to `POST /api/analyze`, which calls OpenRouter (`openai/gpt-4o-mini` default via `OPENROUTER_MODEL`) with a system prompt that demands a strict JSON semantic object `{ table, entity, description, columns }`. On success the context is upserted into `DatasetContext` and status → `READY`; on failure status → `FAILED` with error message.
3. **Agent**: Dashboard `POST /api/agent` (mode `initial_analysis` | `chat`) is *intended* to run the agent, returning `{ response, insights }`. LangGraph scaffolding lives in `lib/agent/` (empty). Tools are implemented and testable at `/agent-lab`.
4. **Logbook**: agent tools read/write `LogbookEntry` rows, which persist "analysis / insight / decision / research" memory across sessions.

## 6. API Endpoints

| Method & Path | Purpose |
|---|---|
| `POST /api/upload` | Parse CSV → create PG table + Dataset row (`UPLOADING → ANALYZING`); 1 file/request, max batch 500 rows |
| `POST /api/datasets/[id]/analyze` | Run semantic analysis for dataset id → `READY` + DatasetContext upsert (or `FAILED`) |
| `GET /api/datasets` | List all datasets (with context), newest first, force-dynamic |
| `POST /api/analyze` | Chat-completions call to OpenRouter; returns semantic object; used internally by `[id]/analyze` |
| `POST /api/agent/tools` | Tool proxy: body `{ tool, input }` dispatches via switch to one of the 5 lib tools, returns parsed result |
| (`/api/agent`) | Referenced by dashboard (`POST` w/ `mode`), route file does NOT exist on disk (stale git index; see §9) |

## 7. Agent Tools (LangChain)

| Tool | Name | Description |
|---|---|---|
| `getDatasetContext` | `get_dataset_context` | Fetch datasets + semantic context for `READY` datasets (filterable by `id`/`tableName`) |
| `queryDataset` | `query_dataset` | `SELECT *` from a dataset table with optional `WHERE` (blocks `;`, `--`, `/*`, DML/DDL keywords); LIMIT 1–100 |
| `webSearch` | `web_search` | Tavily search, `maxResults` 1–10 (requires `TAVILY_API_KEY`) |
| `getLogbook` | `get_logbook` | Read logbook entries (filter by type/date, limit ≤ 100) |
| `writeLogbook` | `write_logbook` | Create a logbook entry (type, title, summary, optional evidence/datasetIds) |

Security notes: `queryDataset` limits SQL to `SELECT ... WHERE ... LIMIT n` with an allowlist tokenizer; `webSearch` uuses the Tavily HTTP API. Tools only call via `@/lib/db` and are not open to arbitrary SQL.

## 8. Environment Variables

From `sampleenv` (user provides values in `.env`):

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Primary OpenRouter key for AI analysis + agent LLM |
| `OPENROUTER_API_KEYS` | Optional comma- or newline-separated key pool; keys rotate on quota/rate-limit failures |
| `OPENROUTER_MODEL` | Model name (e.g. `openai/gpt-4o-mini`) — defaulted in `api/analyze` |

Additional secret expected by `web-search.ts` (not in sampleenv): `TAVILY_API_KEY`.

## 9. Observations / Heads-Up (worth noting)

1. **Stale git index.** `git ls-files` lists files that don't exist on disk (`lib/tools.ts`, `lib/tools/read-dataset.ts`, `lib/tools/rename-dataset.ts`, `app/api/agent/route.ts`), while current files (`lib/tools/*.ts`, `app/api/agent/tools/route.ts`) are untracked. Likely an in-progress rename/refactor.
2. **Missing `/api/agent`.** `app/dashboard/page.tsx` posts to `/api/agent` for `initial_analysis` and `chat` and expects `{ message, insights }`. No such route file exists → the agent UI would 404 / fail. `lib/agent/{graph,node,state}.ts` are empty placeholders.
3. **Duplicated Prisma skill packages** exist under `.agents/`, `.claude/`, and `.windsurf/skills/` (identical content); likely also duplicated under `lib/generated/prisma` vs `app/generated/prisma` (the `lib/` copy is .gitignored).
4. **Inline styling everywhere:** pages use `<style dangerouslySetInnerHTML>` + Tailwind classes; `app/page.tsx` contains a full ~500-line embedded stylesheet and demo mock datasets — the landing page is static/hardcoded (no API calls).
5. **`README.md` is mostly default** create-next-app boilerplate with a stray `# MERCH-MOD` footer line.
6. **Per-page lockstep:** The dashboard and upload pages both call `prisma` directly; no shared memory with the tools beyond `lib/db.ts` singleton.

## 8. Notes-to-self for future context

- The 5 tools are individually testable on `/agent/tools` (Agent Lab) without LangGraph.
- DatasetContext JSON schema shape: `{ table, entity, description, columns: { [columnName]: "meaning. Data type: X" } }`.
- Table names are not frozens: they're randomized suffix of sanitized filename (e.g. `orders_a1b2c3d4e5`).
- The schema files are in the root `prisma/` folder only; migrations dir configured in `prisma7.config.ts` but `prisma/migrations/` doesn't exist yet.
- `.columns` in the `Dataset` model only stores *col-arrows* metadata (`{original, name, type}`), not the actual data; the actual data lives only in the dynamic PG tables.